#!/usr/bin/env python3
"""Compress a baked plate into the bundle the browser actually downloads.

A baked plate is a directory of lossless PNGs - 220 MB for six seconds, which is
fine for the studio and impossible to ship. This packs it to a few megabytes so
the renderer can move into the browser and keep the "files never leave the
device" wedge that the whole product is positioned on.

Three layers, each encoded the way its content wants:

- **plate.mp4** - the despilled garment footage. Ordinary H.264.
- **matte.mp4** / **shade.mp4** - single-channel data carried in luma, with flat
  chroma. Both compress hard because a matte is mostly flat and a shade layer is
  smooth by construction.
- **mesh.i16.gz** - vertex positions quantised to 1/16 px. Sub-pixel accuracy
  costs nothing here and float32 would triple the size for precision no warp can
  use.

The frames must already be despilled by `build_plate.py`, which is why that step
happens at bake time: 4:2:0 chroma subsampling smears the blank's colour across
the silhouette, and once encoded there is no recovering it.

Usage:
    python3 scratch/video/pack_plate.py scratch/video/plates/street-ai
"""
import argparse, glob, gzip, json, os, subprocess
import numpy as np

QUANT = 16.0     # mesh quantisation steps per pixel


def encode(src_dir, dst, fps, crf, grey=False):
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-framerate', str(fps), '-i', os.path.join(src_dir, '%04d.png'),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', str(crf), '-preset', 'slow']
    if grey:
        # Chroma carries nothing for a matte or a shade layer; flattening it
        # costs a few bytes and stops the encoder spending bitrate on noise.
        args += ['-vf', 'format=gray,format=yuv420p']
    subprocess.run(args + [dst], check=True)
    return os.path.getsize(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('plate')
    ap.add_argument('--out', default=None, help='defaults to <plate>/bundle')
    ap.add_argument('--crf', type=int, default=21, help='quality for the garment footage')
    ap.add_argument('--layer-crf', type=int, default=20, help='quality for matte and shade')
    a = ap.parse_args()

    meta = json.load(open(os.path.join(a.plate, 'plate.json')))
    out = a.out or os.path.join(a.plate, 'bundle')
    os.makedirs(out, exist_ok=True)
    fps = meta['fps']

    sizes = {
        'plate.mp4': encode(os.path.join(a.plate, 'frames'),
                            os.path.join(out, 'plate.mp4'), fps, a.crf),
        'matte.mp4': encode(os.path.join(a.plate, 'matte'),
                            os.path.join(out, 'matte.mp4'), fps, a.layer_crf, grey=True),
        'shade.mp4': encode(os.path.join(a.plate, 'shade'),
                            os.path.join(out, 'shade.mp4'), fps, a.layer_crf, grey=True),
    }

    mesh = np.load(os.path.join(a.plate, 'mesh.npy'))
    q = np.round(mesh * QUANT).astype(np.int16)
    blob = gzip.compress(q.tobytes(), 9)
    open(os.path.join(out, 'mesh.i16.gz'), 'wb').write(blob)
    sizes['mesh.i16.gz'] = len(blob)
    err = float(np.abs(mesh - q / QUANT).max())

    meta = dict(meta, meshQuant=QUANT,
                bundle={k: v for k, v in sizes.items()})
    json.dump(meta, open(os.path.join(out, 'plate.json'), 'w'), indent=2)

    raw = sum(os.path.getsize(f) for f in glob.glob(os.path.join(a.plate, '*', '*.png')))
    total = sum(sizes.values())
    for k, v in sizes.items():
        print(f'  {k:<14} {v/1048576:7.2f} MB')
    print(f'  {"total":<14} {total/1048576:7.2f} MB   '
          f'(from {raw/1048576:.0f} MB raw, {raw/max(total,1):.0f}x)')
    print(f'  mesh quantisation error: {err:.3f} px')
    print('bundle written to', out)


if __name__ == '__main__':
    main()
