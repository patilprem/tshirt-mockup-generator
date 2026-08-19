#!/usr/bin/env python3
"""Render a seller's design onto a baked plate and encode the mockup video.

This is the hot path: it runs once per customer, so everything expensive already
happened in build_plate.py. Nothing here is generative. The design's pixels are
resampled and shaded, never re-synthesised, which is the whole reason typography
and thin linework survive - the failure mode that sinks the obvious approach of
feeding a finished mockup still to an image-to-video model.

Usage:
    python3 scratch/video/render_mockup.py scratch/video/plates/park-f design.png \
        --color '#1c2a5c' --out mockup.mp4
"""
import argparse, json, os, subprocess, tempfile
import cv2
import numpy as np

SPEC = 0.28
# Hue half-window used to recognise the blank, matching build_plate.garment_matte.
TOL = 22


def relight_lut(rgb, ambient, rel_max):
    """Port of onModelRelightLut() in src/scripts/onmodel-engine.js.

    Kept numerically identical so a video mockup and a still mockup of the same
    garment colour agree; a seller who exports both to one Etsy listing will put
    them side by side, and a hue drift between them reads as a bug.
    """
    rgb = np.asarray(rgb, float)
    t_lum = rgb.sum() / 765.0
    gamma, tint = 1 - 0.55 * t_lum, 0.35 * t_lum
    rel = (np.arange(256) / 255.0) * rel_max
    diff = np.minimum(rel, 1) ** gamma
    wgt = (1 - diff) * tint
    out = rgb[None, :] * diff[:, None] * (1 - wgt[:, None] + wgt[:, None] * np.asarray(ambient)[None, :])
    hot = rel > 1
    sp = np.clip((rel - 1) / max(rel_max - 1, 1e-6), 0, 1) * SPEC
    out[hot] += (255 - out[hot]) * sp[hot, None]
    return np.clip(out, 0, 255)


def cell_maps(verts, src_grid, grid, W, H):
    """Inverse map from frame pixels back to design pixels, one mesh cell at a time.

    Filling per cell rather than interpolating a global field keeps the seams
    exact: adjacent cells share their corner vertices, so the perspective
    transforms agree along the shared edge and the print shows no cracks.
    """
    mx = np.full((H, W), -1, np.float32)
    my = np.full((H, W), -1, np.float32)
    v = verts.reshape(grid + 1, grid + 1, 2)
    for r in range(grid):
        for c in range(grid):
            dst = np.array([v[r, c], v[r, c + 1], v[r + 1, c + 1], v[r + 1, c]], np.float32)
            src = np.array([src_grid[r, c], src_grid[r, c + 1],
                            src_grid[r + 1, c + 1], src_grid[r + 1, c]], np.float32)
            x0, y0 = np.maximum(np.floor(dst.min(0)).astype(int) - 1, 0)
            x1, y1 = np.minimum(np.ceil(dst.max(0)).astype(int) + 2, [W, H])
            if x1 <= x0 or y1 <= y0:
                continue
            sub = np.zeros((y1 - y0, x1 - x0), np.uint8)
            cv2.fillConvexPoly(sub, (dst - [x0, y0]).astype(np.int32), 1)
            ys, xs = np.nonzero(sub)
            if not len(ys):
                continue
            M = cv2.getPerspectiveTransform(dst, src)
            uvw = M @ np.stack([xs + x0, ys + y0, np.ones(len(xs))], 0)
            mx[ys + y0, xs + x0] = uvw[0] / uvw[2]
            my[ys + y0, xs + x0] = uvw[1] / uvw[2]
    return mx, my


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('plate')
    ap.add_argument('design')
    ap.add_argument('--out', required=True)
    ap.add_argument('--color', default=None, help='garment hex, e.g. #1c2a5c; omit to keep the plate colour')
    ap.add_argument('--crf', type=int, default=18)
    a = ap.parse_args()

    meta = json.load(open(os.path.join(a.plate, 'plate.json')))
    W, H, N, g = meta['width'], meta['height'], meta['frames'], meta['grid']
    mesh = np.load(os.path.join(a.plate, 'mesh.npy'))
    rx, ry, rw, rh = meta['printRect']

    raw = cv2.imread(a.design, cv2.IMREAD_UNCHANGED)
    if raw.shape[2] == 3:
        raw = np.dstack([raw, np.full(raw.shape[:2], 255, np.uint8)])
    # Resample the artwork to roughly 2.5x its on-screen size first. Going
    # straight from a 4000px print file to a 170px chest patch through bilinear
    # remap undersamples every edge, and the result reads as jagged clip-art
    # rather than ink. INTER_AREA is the cheap stand-in for a mip chain.
    tgt = max(int(max(rw, rh) * 2.5), 64)
    scale = tgt / max(raw.shape[1], raw.shape[0])
    design = cv2.resize(raw, (max(int(raw.shape[1] * scale), 1),
                              max(int(raw.shape[0] * scale), 1)), interpolation=cv2.INTER_AREA)
    dh, dw = design.shape[:2]
    gu, gv = np.meshgrid(np.linspace(0, 1, g + 1), np.linspace(0, 1, g + 1))
    src_grid = np.stack([gu.ravel() * (dw - 1), gv.ravel() * (dh - 1)], 1).reshape(g + 1, g + 1, 2)

    key_hue = meta.get('keyHue')
    lut = None
    if a.color:
        h = a.color.lstrip('#')
        rgb = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
        lut = relight_lut(rgb, meta['ambientTint'], meta['relMax'])[:, ::-1]  # -> BGR

    tmp = tempfile.mkdtemp()
    for t in range(N):
        frame = cv2.imread(os.path.join(a.plate, 'frames', f'{t + 1:04d}.png'))
        matte = cv2.imread(os.path.join(a.plate, 'matte', f'{t:04d}.png'), 0).astype(np.float32) / 255.0
        shade = cv2.imread(os.path.join(a.plate, 'shade', f'{t:04d}.png'), 0)

        out = frame.astype(np.float32)
        if lut is not None:
            out = out * (1 - matte[:, :, None]) + lut[shade] * matte[:, :, None]
            # Despill. The garment silhouette is anti-aliased, so its edge pixels
            # are part fabric and part background and never reach full matte.
            # Recolouring by the matte alone leaves their share of the key colour
            # behind as a violet fringe, which is the one artifact that reads as
            # "keyed" rather than "filmed". Push whatever still carries the key
            # hue in that transition ring the rest of the way to the target.
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            hh, ss = hsv[:, :, 0].astype(np.int16), hsv[:, :, 1].astype(np.float32)
            dh = np.minimum(np.abs(hh - key_hue), 180 - np.abs(hh - key_hue))
            keyness = np.clip((TOL - dh) / TOL, 0, 1) * np.clip((ss - 40) / 60.0, 0, 1)
            ring = cv2.dilate((matte > 0.02).astype(np.uint8), np.ones((7, 7), np.uint8)) \
                - (matte > 0.98).astype(np.uint8)
            w = cv2.GaussianBlur(keyness * np.clip(ring, 0, 1) * (1 - matte), (0, 0), 1.2)
            out = out * (1 - w[:, :, None]) + lut[shade] * w[:, :, None]

        mx, my = cell_maps(mesh[t], src_grid, g, W, H)
        warped = cv2.remap(design, mx, my, cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        # A sub-pixel feather stands in for ink wicking into the weave. Without it
        # the print has a die-cut edge that no real screen print or DTF has.
        alpha = cv2.GaussianBlur((warped[:, :, 3].astype(np.float32) / 255.0)
                                 * (mx >= 0) * matte, (0, 0), 0.9)[:, :, None]
        # The same illumination the garment gets, so the print sinks into folds
        # instead of floating over them.
        lit = warped[:, :, :3].astype(np.float32) * (shade.astype(np.float32) / 255.0 * meta['relMax'])[:, :, None]
        out = out * (1 - alpha) + np.clip(lit, 0, 255) * alpha
        cv2.imwrite(os.path.join(tmp, f'{t:04d}.png'), np.clip(out, 0, 255).astype(np.uint8))

    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-framerate', str(meta['fps']), '-i', os.path.join(tmp, '%04d.png'),
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', str(a.crf), a.out], check=True)
    print('wrote', a.out)


if __name__ == '__main__':
    main()
