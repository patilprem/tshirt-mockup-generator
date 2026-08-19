#!/usr/bin/env python3
"""Score candidate garment clips before spending a full bake on them.

The plate library is generated, not filmed, so the workflow is: ask Flow for
twenty clips, keep the few that survive. Baking costs ~75 s per clip and
`build_plate.py` only reports one failure mode (too few trackers), which is far
too late and far too narrow a signal to run a batch against.

This screens at half resolution on a frame subsample in a few seconds per clip,
and it checks the failure modes that are specific to *generated* footage rather
than filmed footage:

- **boil** — the signature artifact of video diffusion. Fabric that shimmers and
  re-forms frame to frame instead of moving. Trackers stay alive, so the survival
  count looks healthy, but the mesh jitters and the print swims. Measured as
  temporal jerk (second difference) of tracker paths, which separates real motion
  from re-synthesis: a walking model has high displacement and low jerk, a boiling
  one has the reverse.
- **hue drift** — the garment slowly changing colour over the clip. Harmless to
  look at, fatal to a chroma-key matte.
- **matte instability** — the garment silhouette flickering or morphing. Catches
  a tee that grows a pocket, a collar that changes shape, a hem that breathes.
- **occlusion** — hair, hands or crossed arms over the chest. Costs trackers
  exactly where the mesh needs them.
- **exposure** — blown or crushed fabric. The shade layer is a ratio, so clipped
  pixels carry no recoverable fold information.
- **survival / motion** — the same gate `build_plate.py` applies, plus a whip-pan
  check, so a clip that will fail the bake fails here instead.

Usage:
    python3 scratch/video/screen_plates.py candidates/*.mp4
    python3 scratch/video/screen_plates.py clip.mp4 --key-hue 145 --json report.json

Requires: opencv-python-headless, numpy, ffmpeg on PATH.
"""
import argparse, json, os, subprocess, sys, tempfile
import cv2
import numpy as np

# Each gate is (label, worse-direction, threshold). Thresholds were set against
# the three filmed reference clips, which pass every gate with margin - filmed
# footage is the control group that says the scorer is not simply strict.
GATES = [
    ('survival',  'lo', 0.35),   # fraction of seed trackers alive at the last frame
    ('boil',      'hi', 1.50),   # px of median tracker jerk
    ('hue_drift', 'hi', 4.00),   # std of the garment's median hue, OpenCV units
    ('matte_cv',  'hi', 0.18),   # coefficient of variation of garment area
    ('occlusion', 'hi', 0.25),   # fraction of frames with the chest blocked
    ('clipped',   'hi', 0.06),   # fraction of garment pixels blown or crushed
    ('motion',    'hi', 12.0),   # px of median per-frame tracker displacement
]
# Tracking runs on consecutive frames. Subsampling would inflate jerk and
# depress survival in proportion to the stride, which silently penalises longer
# clips for being longer; appearance metrics, which are per-frame, can stride.
MAX_FRAMES = 300
APPEARANCE_STRIDE = 2


def load(video, scale=0.5):
    tmp = tempfile.mkdtemp()
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', video,
                    '-vf', f'scale=iw*{scale}:ih*{scale}', os.path.join(tmp, '%04d.png')],
                   check=True)
    files = sorted(os.path.join(tmp, f) for f in os.listdir(tmp) if f.endswith('.png'))
    return [cv2.imread(f) for f in files[:MAX_FRAMES]]


def garment_key(img):
    """Guess how to key the blank: a saturated hue if there is one, else neutral.

    Auto-detection rather than a required flag because a screening run is meant
    to be pointed at a directory of fresh generations without per-clip setup.
    """
    h, w = img.shape[:2]
    band = cv2.cvtColor(img[int(h * .40):int(h * .80), int(w * .25):int(w * .75)],
                        cv2.COLOR_BGR2HSV)
    sat = band[:, :, 1] > 80
    if sat.mean() > 0.35:
        return int(np.median(band[:, :, 0][sat]))
    return None                                        # neutral / white blank


def matte(img, key):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0].astype(np.int16), hsv[:, :, 1], hsv[:, :, 2]
    if key is None:
        m = ((s < 70) & (v > 105))
    else:
        dh = np.minimum(np.abs(h - key), 180 - np.abs(h - key))
        m = ((dh < 22) & (s > 60) & (v > 45))
    m = cv2.morphologyEx((m * 255).astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        m = np.where(lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
    return m


def screen(video, key_override=None):
    imgs = load(video)
    if len(imgs) < 8:
        return {'error': 'too few frames'}
    grays = [cv2.cvtColor(i, cv2.COLOR_BGR2GRAY) for i in imgs]
    H, W = grays[0].shape
    key = key_override if key_override is not None else garment_key(imgs[0])

    appear = imgs[::APPEARANCE_STRIDE]
    mattes = [matte(i, key) for i in appear]
    areas = np.array([(m > 128).sum() for m in mattes], float)
    if areas.max() < 0.02 * H * W:
        return {'error': 'no garment found - check --key-hue'}

    # Silhouette steadiness. Detrended so a model walking toward camera, which
    # legitimately grows the garment, is not scored as morphing.
    t = np.arange(len(areas))
    trend = np.polyval(np.polyfit(t, areas, 2), t)
    matte_cv = float(np.std(areas - trend) / max(areas.mean(), 1))

    hues, clipped = [], []
    for img, m in zip(appear, mattes):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        sel = m > 128
        if sel.sum() < 500:
            continue
        v = hsv[:, :, 2][sel]
        clipped.append(float(((v >= 250) | (v <= 12)).mean()))
        if key is not None:
            hues.append(float(np.median(hsv[:, :, 0][sel])))
    # Only meaningful for a keyed blank. A neutral blank has no hue for the
    # matte to depend on, so the gate is reported as n/a rather than as a zero
    # that would read like a measurement that passed.
    hue_drift = float(np.std(hues)) if hues else float('nan')

    # Chest box: the upper-middle of the garment bounding box, which is where the
    # print area lands and therefore the only region whose occlusion matters.
    ys, xs = np.nonzero(mattes[0] > 128)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cx0, cx1 = int(x0 + .25 * (x1 - x0)), int(x0 + .75 * (x1 - x0))
    cy0, cy1 = int(y0 + .10 * (y1 - y0)), int(y0 + .55 * (y1 - y0))
    chest = [(m[cy0:cy1, cx0:cx1] > 128).mean() for m in mattes]
    occlusion = float(np.mean([c < 0.80 for c in chest]))

    seed = np.zeros((H, W), np.uint8)
    seed[y0:y1, x0:x1] = 255
    lk = dict(winSize=(21, 21), maxLevel=4,
              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
    p0 = cv2.goodFeaturesToTrack(grays[0], 900, 0.005, 7, mask=seed, blockSize=7)
    if p0 is None:
        return {'error': 'garment has no trackable texture'}
    paths = np.full((len(p0), len(grays), 2), np.nan, np.float32)
    paths[:, 0] = p0[:, 0]
    alive, cur = np.arange(len(p0)), p0.copy()
    for i in range(1, len(grays)):
        nxt, s1, _ = cv2.calcOpticalFlowPyrLK(grays[i - 1], grays[i], cur, None, **lk)
        bak, s2, _ = cv2.calcOpticalFlowPyrLK(grays[i], grays[i - 1], nxt, None, **lk)
        ok = ((s1.ravel() == 1) & (s2.ravel() == 1)
              & (np.linalg.norm(cur - bak, axis=2).ravel() < 1.0))
        alive, cur = alive[ok], nxt[ok]
        paths[alive, i] = cur[:, 0]
    survival = float(len(alive) / len(p0))

    full = paths[~np.isnan(paths[:, :, 0]).any(1)]
    if len(full) < 12:
        motion = boil = float('inf')
    else:
        d1 = np.diff(full, axis=1)
        motion = float(np.median(np.linalg.norm(d1, axis=2)))
        # Jerk, not speed. Smooth real motion has near-zero second difference
        # however fast it is; diffusion boil has small net travel and large
        # frame-to-frame reversals, so this is what separates them.
        boil = float(np.median(np.linalg.norm(np.diff(d1, axis=1), axis=2)))

    return {'survival': survival, 'boil': boil, 'hue_drift': hue_drift,
            'matte_cv': matte_cv, 'occlusion': occlusion,
            'clipped': float(np.mean(clipped)) if clipped else 0.0,
            'motion': motion, 'key_hue': key, 'frames': len(imgs)}


def verdict(m):
    fails = [n for n, d, th in GATES
             if n in m and not np.isnan(m[n])
             and ((m[n] < th) if d == 'lo' else (m[n] > th))]
    return ('PASS' if not fails else 'FAIL'), fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('videos', nargs='+')
    ap.add_argument('--key-hue', type=int, default=None)
    ap.add_argument('--json', default=None)
    a = ap.parse_args()

    cols = [g[0] for g in GATES]
    print(f'{"clip":<34}' + ''.join(f'{c:>11}' for c in cols) + '  verdict')
    print('-' * (34 + 11 * len(cols) + 10))
    report = {}
    for v in a.videos:
        m = screen(v, a.key_hue)
        name = os.path.basename(v)[:33]
        if 'error' in m:
            print(f'{name:<34}{m["error"]:>{11*len(cols)}}  FAIL')
            report[v] = m
            continue
        vd, fails = verdict(m)
        row = ''.join('        n/a' if np.isnan(m[c]) else f'{m[c]:>11.3f}' for c in cols)
        note = '' if vd == 'PASS' else '  <- ' + ', '.join(fails)
        print(f'{name:<34}{row}  {vd}{note}')
        report[v] = dict(m, verdict=vd, failed=fails)
    print('\nthresholds: ' + ', '.join(
        f'{n} {"min" if d == "lo" else "max"} {th}' for n, d, th in GATES))
    if a.json:
        json.dump(report, open(a.json, 'w'), indent=2)
        print('wrote', a.json)


if __name__ == '__main__':
    main()
