#!/usr/bin/env python3
"""Bake a garment video into a reusable mockup plate.

A plate is the video analogue of one row in `public/assets/on-model/templates.json`.
That file already stores, per still template, a `photo` / `weight` / `shade` triple
plus a print `quad`, and `src/scripts/onmodel-engine.js` recolours and prints
against it. A plate stores the same thing per *frame*, plus the one extra layer a
still never needs: a mesh saying where the print area moved to.

The split matters commercially. Baking is slow, runs once per plate, and never
touches the seller's artwork. Rendering is fast, runs once per seller, and is pure
compositing. So the expensive AI/filming cost is amortised across every customer,
and the marginal cost of the millionth mockup video is a few seconds of CPU.

Two trackers, because generated plates and filmed plates fail differently.
Filmed cotton has weave, print and shadow detail, so Lucas-Kanade finds corners
and holds them. Generated cotton is smooth: video models render fabric as broad
soft gradients, and on a 720p Flow clip sparse tracking recovered only 79 usable
corners against the 120 this needs. So `--tracker auto` falls back to dense
optical flow, which propagates through gradients instead of requiring corners.

Both feed the same regulariser, and that part is not optional. Advecting mesh
vertices directly through per-frame flow lets each vertex accumulate its own
drift; at 0.33 px median round-trip error the mesh still tore the artwork apart
within a hundred frames, because the errors are differential rather than common.
Fitting one RANSAC affine per frame across a large cloud of virtual trackers
averages that noise out, and matches what the reference clips actually do - their
prints are close to affine with a slight bend, not freely deforming sheets.

Usage:
    python3 scratch/video/build_plate.py plate.mp4 --out scratch/video/plates/park-f \
        --print-rect 776 904 168 168

Requires: opencv-python-headless, numpy, ffmpeg on PATH.
"""
import argparse, json, os, subprocess, sys
import cv2
import numpy as np

# Matches meta.relMax in templates.json: how far above diffuse white the
# brightest lit fabric sits. Keep in step with onmodel-engine.js.
REL_MAX = 1.45


def extract_frames(video, dst):
    os.makedirs(dst, exist_ok=True)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', video, os.path.join(dst, '%04d.png')], check=True)
    return sorted(os.path.join(dst, f) for f in os.listdir(dst) if f.endswith('.png'))


def track_sparse(grays, seed_mask):
    """Forward-backward validated LK tracks that live the whole clip.

    Points are kept only if every hop survives a round trip under one pixel.
    That throws away roughly a fifth of the seeds on filmed footage, and it is
    exactly the fifth that would otherwise drag the mesh - a tracker that slides
    onto the background is far more damaging than a tracker that is not there.
    """
    lk = dict(winSize=(31, 31), maxLevel=5,
              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))
    p0 = cv2.goodFeaturesToTrack(grays[0], 2500, 0.004, 10, mask=seed_mask, blockSize=9)
    if p0 is None:
        return np.zeros((0, 2), np.float32), np.zeros((0, len(grays), 2), np.float32)
    n = len(grays)
    tracks = np.full((len(p0), n, 2), np.nan, np.float32)
    tracks[:, 0] = p0[:, 0]
    alive, cur = np.arange(len(p0)), p0.copy()
    for t in range(1, n):
        nxt, s1, _ = cv2.calcOpticalFlowPyrLK(grays[t - 1], grays[t], cur, None, **lk)
        bak, s2, _ = cv2.calcOpticalFlowPyrLK(grays[t], grays[t - 1], nxt, None, **lk)
        ok = ((s1.ravel() == 1) & (s2.ravel() == 1)
              & (np.linalg.norm(cur - bak, axis=2).ravel() < 1.0))
        alive, cur = alive[ok], nxt[ok]
        tracks[alive, t] = cur[:, 0]
    keep = ~np.isnan(tracks[:, :, 0]).any(1)
    return tracks[keep][:, 0], tracks[keep]


def _sample_flow(flow, pts, W, H):
    x = np.clip(pts[:, 0], 0, W - 1).astype(np.float32).reshape(-1, 1)
    y = np.clip(pts[:, 1], 0, H - 1).astype(np.float32).reshape(-1, 1)
    return np.stack([cv2.remap(flow[:, :, 0], x, y, cv2.INTER_LINEAR).ravel(),
                     cv2.remap(flow[:, :, 1], x, y, cv2.INTER_LINEAR).ravel()], 1)


def track_dense(grays, matte0, step=6):
    """Virtual trackers advected through dense optical flow.

    For generated plates, where there are no corners to lock onto. A lattice of
    points seeded inside the garment is carried frame to frame by DIS flow and
    dropped as soon as a hop fails its round trip, which yields the same
    (points, tracks) contract as the sparse path.
    """
    H, W = grays[0].shape
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    dis.setUseSpatialPropagation(True)
    ys, xs = np.nonzero(matte0 > 128)
    if not len(ys):
        return np.zeros((0, 2), np.float32), np.zeros((0, len(grays), 2), np.float32)
    pts = np.array([[x, y] for y in range(ys.min(), ys.max(), step)
                    for x in range(xs.min(), xs.max(), step) if matte0[y, x] > 128], np.float32)
    tracks = np.full((len(pts), len(grays), 2), np.nan, np.float32)
    tracks[:, 0] = pts
    cur, ok = pts.copy(), np.ones(len(pts), bool)
    for t in range(1, len(grays)):
        fw = dis.calc(grays[t - 1], grays[t], None)
        bw = dis.calc(grays[t], grays[t - 1], None)
        d = _sample_flow(fw, cur, W, H)
        cur = cur + d
        ok &= np.linalg.norm(d + _sample_flow(bw, cur, W, H), axis=1) < 1.2
        tracks[ok, t] = cur[ok]
    keep = ~np.isnan(tracks[:, :, 0]).any(1)
    return tracks[keep][:, 0], tracks[keep]


def mls_affine(v, p, q, softness=16.0):
    """Moving-least-squares affine warp of `v` under the correspondence p -> q.

    Schaefer et al. 2006. Each output vertex solves its own weighted affine fit,
    so a vertex over the sternum follows the sternum trackers and one over the
    hem follows the hem, instead of both averaging into a rigid slab.
    """
    d = v[:, None, :] - p[None]
    w = 1.0 / (np.sum(d * d, 2) + softness)
    w /= w.sum(1, keepdims=True)
    pstar, qstar = w @ p, w @ q
    ph, qh = p[None] - pstar[:, None], q[None] - qstar[:, None]
    wp = w[:, :, None] * ph
    A = np.einsum('vci,vcj->vij', wp, ph) + np.eye(2) * 1e-6
    B = np.einsum('vci,vcj->vij', wp, qh)
    return np.einsum('vi,vij->vj', v - pstar, np.linalg.solve(A, B)) + qstar


def build_mesh(v0, c0, tracks, bend=0.0, mls_cap=800):
    """One RANSAC affine per frame, optionally softened toward a local MLS fit.

    The affine is what keeps the print from tearing: it is a six-parameter
    consensus over hundreds of trackers, so per-tracker drift cancels instead of
    accumulating. `bend` then blends back a fraction of the moving-least-squares
    solution, which lets the print follow the chest a little without handing each
    vertex its own error budget again. Keep it well under 1.
    """
    n = tracks.shape[1]
    mesh = np.empty((n, len(v0), 2), np.float32)
    mesh[0] = v0
    hom = np.hstack([v0, np.ones((len(v0), 1))]).T
    sub = np.linspace(0, len(c0) - 1, min(mls_cap, len(c0))).astype(int) if len(c0) else []
    # estimateAffine2D wants contiguous Nx1x2 float32; a column slice of `tracks`
    # is neither, and OpenCV reports that as a bare count error.
    src = np.ascontiguousarray(c0, np.float32).reshape(-1, 1, 2)
    prev = None
    for t in range(1, n):
        dst = np.ascontiguousarray(tracks[:, t], np.float32).reshape(-1, 1, 2)
        A, _ = cv2.estimateAffine2D(src, dst, method=cv2.RANSAC,
                                    ransacReprojThreshold=2.5)
        if A is None:
            A = prev
        if A is None:
            mesh[t] = v0
            continue
        prev = A
        aff = (A @ hom).T
        if bend > 0 and len(sub):
            loc = mls_affine(v0.astype(np.float64), c0[sub].astype(np.float64),
                             tracks[sub, t].astype(np.float64))
            aff = aff + bend * (loc - aff)
        mesh[t] = aff
    return mesh


def garment_matte(bgr, key_hue, tol=22, sat_min=60, val_min=45):
    """Chroma-key the blank garment.

    Plates are filmed (or generated) in a saturated key colour precisely so this
    step is a hue window rather than a segmentation model: hue is stable frame to
    frame, so the matte does not crawl the way a learned mask does. The repo
    already shoots stills this way - see `violetBase` in templates.json.
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0].astype(np.int16), hsv[:, :, 1], hsv[:, :, 2]
    dh = np.minimum(np.abs(h - key_hue), 180 - np.abs(h - key_hue))
    m = (((dh < tol) & (s > sat_min) & (v > val_min)) * 255).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        m = np.where(lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
    return cv2.GaussianBlur(m, (0, 0), 2.5)


def shade_layer(bgr, matte, sigma=42):
    """Illumination as a ratio against the garment's own low-pass.

    Dividing by the blur cancels the base colour of the blank, so the same layer
    drives a black tee and a white one. The byte encoding matches the still
    pipeline: `rel = shade/255 * REL_MAX`, where rel == 1 is diffuse white.
    """
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sel = matte > 128
    if not sel.any():
        return np.zeros(g.shape, np.uint8)
    base = cv2.GaussianBlur(g, (0, 0), sigma)
    rel = np.clip(g / np.maximum(base, 1.0), 0.0, REL_MAX)
    return np.clip(rel / REL_MAX * 255, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--out', required=True)
    ap.add_argument('--print-rect', nargs=4, type=float, required=True,
                    metavar=('X', 'Y', 'W', 'H'),
                    help='print area on frame 0, in plate pixels')
    ap.add_argument('--seed-rect', nargs=4, type=float, default=None,
                    metavar=('X', 'Y', 'W', 'H'),
                    help='where to look for trackers; defaults to the whole garment')
    ap.add_argument('--key-hue', type=int, default=145,
                    help='OpenCV hue (0-179) of the blank; 145 is the violet blank')
    ap.add_argument('--grid', type=int, default=14)
    ap.add_argument('--tracker', choices=('auto', 'sparse', 'dense'), default='auto',
                    help='auto tries corners first and falls back to dense flow')
    ap.add_argument('--bend', type=float, default=0.35,
                    help='0 = pure affine, 1 = pure local fit; above ~0.5 the print tears')
    ap.add_argument('--fps', type=float, default=24.0)
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    frame_dir = os.path.join(a.out, 'frames')
    files = extract_frames(a.video, frame_dir)
    imgs = [cv2.imread(f) for f in files]
    grays = [cv2.cvtColor(i, cv2.COLOR_BGR2GRAY) for i in imgs]
    H, W = grays[0].shape
    print(f'{len(imgs)} frames at {W}x{H}')

    seed = np.zeros((H, W), np.uint8)
    if a.seed_rect:
        x, y, w, h = map(int, a.seed_rect)
        cv2.rectangle(seed, (x, y), (x + w, y + h), 255, -1)
    else:
        seed[:] = garment_matte(imgs[0], a.key_hue)

    matte0 = garment_matte(imgs[0], a.key_hue)
    c0, tracks = (np.zeros((0, 2), np.float32), None)
    if a.tracker in ('auto', 'sparse'):
        c0, tracks = track_sparse(grays, seed)
        print(f'sparse: {len(c0)} corners survive all {len(imgs)} frames')
    if a.tracker == 'dense' or (a.tracker == 'auto' and len(c0) < 120):
        if a.tracker == 'auto':
            print('too few corners - falling back to dense flow')
        c0, tracks = track_dense(grays, matte0)
        print(f'dense: {len(c0)} virtual trackers survive all {len(imgs)} frames')
    if len(c0) < 120:
        sys.exit(f'only {len(c0)} trackers survived; the plate is too shaky, too '
                 'featureless or too occluded to mesh reliably')

    rx, ry, rw, rh = a.print_rect
    g = a.grid
    gu, gv = np.meshgrid(np.linspace(0, 1, g + 1), np.linspace(0, 1, g + 1))
    v0 = np.stack([rx + gu.ravel() * rw, ry + gv.ravel() * rh], 1)

    for sub in ('matte', 'shade'):
        os.makedirs(os.path.join(a.out, sub), exist_ok=True)
    mesh = build_mesh(v0, c0, tracks, bend=a.bend)
    for t, img in enumerate(imgs):
        m = garment_matte(img, a.key_hue)
        cv2.imwrite(os.path.join(a.out, 'matte', f'{t:04d}.png'), m)
        cv2.imwrite(os.path.join(a.out, 'shade', f'{t:04d}.png'), shade_layer(img, m))
        if t % 50 == 0:
            print('baked', t, flush=True)

    np.save(os.path.join(a.out, 'mesh.npy'), mesh)
    json.dump({
        'id': os.path.basename(a.out.rstrip('/')),
        'width': W, 'height': H, 'frames': len(imgs), 'fps': a.fps,
        'grid': g, 'printRect': [rx, ry, rw, rh], 'keyHue': a.key_hue,
        'tracker': a.tracker, 'bend': a.bend, 'trackers': int(len(c0)),
        'relMax': REL_MAX, 'ambientTint': [1, 0.9786, 0.9251],
    }, open(os.path.join(a.out, 'plate.json'), 'w'), indent=2)
    print('plate written to', a.out)


if __name__ == '__main__':
    main()
