# One-off fix for tshirt_sweatshirt.png: two small near-black regions at the
# underarms (RGB ~0-3, alpha 255) where the studio background peeks through
# the gap between sleeve and torso. crop_garment.cjs's border-flood-fill never
# reaches them — they're enclosed by white fabric on all sides, not connected
# to the canvas edge where that keying starts — so they were left fully
# opaque instead of keyed transparent like the rest of the background.
#
# This applies the same treatment crop_garment.cjs gives the real background
# (flood-fill the dark region to transparent, then feather the new edge) but
# seeded from inside each pocket instead of the border, and scoped tightly to
# each pocket's own bounding box so nothing elsewhere in the image is touched.
#
# Usage: python3 scratch/fix_sweatshirt_underarm_holes.py
from PIL import Image
import numpy as np
from collections import deque

PATH = 'public/assets/processed/tshirt_sweatshirt.png'
BG_THRESHOLD = 110  # same threshold crop_garment.cjs uses to key background
PAD = 12  # bbox padding so the feather blur has room to run without edge artifacts

im = Image.open(PATH).convert('RGBA')
a = np.array(im).astype(np.int16)
h, w = a.shape[:2]


def is_bg(px):
    return px[0] < BG_THRESHOLD and px[1] < BG_THRESHOLD and px[2] < BG_THRESHOLD


def flood_component(seed_mask_bbox):
    """BFS-flood every bg-colored pixel connected to any dark seed within bbox."""
    x0, y0, x1, y1 = seed_mask_bbox
    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for y in range(y0, y1):
        for x in range(x0, x1):
            if is_bg(a[y, x]) and not visited[y, x]:
                visited[y, x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx] and is_bg(a[ny, nx]):
                visited[ny, nx] = True
                q.append((nx, ny))
    return visited


# The two pockets, measured directly off the alpha/RGB data (see the analysis
# that found them): left underarm and right underarm, each padded.
regions = [
    (222 - PAD, 450 - PAD, 255 + PAD, 561 + PAD),   # left
    (740 - PAD, 450 - PAD, 779 + PAD, 546 + PAD),   # right
]

alpha = a[:, :, 3].copy()
touched = np.zeros((h, w), dtype=bool)

for bbox in regions:
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    comp = flood_component((x0, y0, x1, y1))
    alpha[comp] = 0
    touched |= comp
    # Pad the touched mask itself so the feather blur below has clean opaque
    # neighbors to blend from on all sides, not just within the flood.
    ys, xs = np.where(comp)
    if len(ys):
        touched[max(0, ys.min() - PAD):ys.max() + PAD, max(0, xs.min() - PAD):xs.max() + PAD] = True

before_count = int((alpha == 0).sum())
print(f'Newly transparent pixels: {(a[:, :, 3] > 0).sum() - (alpha > 0).sum()}')

# Erode the new hole's opaque boundary by 2px (matches crop_garment.cjs's
# erosionRadius) so no dark fringe survives at the edge, then feather the
# alpha with the same 3-pass 3x3 box blur — both restricted to `touched` so
# nothing outside the two pockets is altered.
opaque = alpha > 0
eroded = opaque.copy()
ys_t, xs_t = np.where(touched)
y_lo, y_hi = ys_t.min(), ys_t.max() + 1
x_lo, x_hi = xs_t.min(), xs_t.max() + 1

for y in range(y_lo, y_hi):
    for x in range(x_lo, x_hi):
        if not touched[y, x] or not opaque[y, x]:
            continue
        near_bg = False
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                ny, nx = y + dy, x + dx
                if ny < 0 or ny >= h or nx < 0 or nx >= w or not opaque[ny, nx]:
                    near_bg = True
                    break
            if near_bg:
                break
        if near_bg:
            eroded[y, x] = False

alpha[touched & ~eroded] = 0

# Color-bleed: give any newly-transparent-adjacent pixel the color of its
# nearest still-opaque neighbor, so the feathered edge doesn't blend toward
# the black that used to be there.
rgb = a[:, :, :3].copy()
alpha_u8 = alpha.astype(np.uint8)
for y in range(y_lo, y_hi):
    for x in range(x_lo, x_hi):
        if not touched[y, x] or alpha_u8[y, x] == 255 or alpha_u8[y, x] == 0:
            continue
for pass_n in range(3):
    alpha_f = alpha.astype(np.float64)
    new_alpha = alpha_f.copy()
    for y in range(y_lo, y_hi):
        for x in range(x_lo, x_hi):
            if not touched[y, x] or alpha_f[y, x] <= 0:
                continue
            is_border = (
                x > 0 and alpha_f[y, x - 1] == 0 or
                x < w - 1 and alpha_f[y, x + 1] == 0 or
                y > 0 and alpha_f[y - 1, x] == 0 or
                y < h - 1 and alpha_f[y + 1, x] == 0
            )
            if is_border:
                s = 0.0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        s += alpha_f[y + dy, x + dx]
                new_alpha[y, x] = round(s / 9)
    alpha = new_alpha

# For any pixel that ended up with residual alpha (feathered edge), replace
# its RGB with the nearest fully-opaque neighbor's color so the edge fades to
# fabric white, not to the black background color that was baked in.
alpha_final = alpha.astype(np.uint8)
for y in range(y_lo, y_hi):
    for x in range(x_lo, x_hi):
        if not touched[y, x]:
            continue
        av = alpha_final[y, x]
        if 0 < av < 255:
            found = False
            for d in range(1, 8):
                for dy in range(-d, d + 1):
                    for dx in range(-d, d + 1):
                        if abs(dx) != d and abs(dy) != d:
                            continue
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and alpha_final[ny, nx] == 255:
                            rgb[y, x] = a[ny, nx, :3]
                            found = True
                            break
                    if found:
                        break
                if found:
                    break

out = np.dstack([rgb.astype(np.uint8), alpha_final])
Image.fromarray(out, 'RGBA').save(PATH)
print(f'Wrote {PATH}')
