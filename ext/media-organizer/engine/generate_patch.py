"""Generate's arithmetic: what the model is shown, where it may work, and the patch made of its answer.

Nothing here needs the graphics card or the model (numpy and Pillow only), so
all of it can be checked on any machine: tests/probes/generate-engine-check.py.

The words used:
    cut     the area of the photo being worked on, at the photo's own pixels
    small   that area at the size the model works at (what it is shown)
    seen    `small` as the model's own coder returns it when nothing is changed
    answer  the model's picture, the size of `small`
    mark    white where the photo may change (a picture the size of `cut`)
    tile    one 16 x 16 square of `small`: the unit the model works in
"""

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

MAX_SIDE = 2048          # the longest side the model is given
MAX_PIXELS = 2_000_000   # and the largest area: it reads the photo at this size too, so the two together are its load
MIN_SIDE = 1024          # a small cut-out is enlarged to this before the model sees it
GRID = 32                # the model's sizes come in 32s
TILE = 16                # one tile of the model's own picture, in pixels of `small`
STRIP = 1024             # rows of the photo worked on at a time, so a 60 megapixel area stays within memory
KEPT_FROM, KEPT_FULL = 0.5, 0.8   # how alike the answer and the photo must be, there, for none and for all of the detail to come back (measured on real photos through the real coder: the same content is above 0.8 on 99% of a picture, unrelated content below 0.42)


def cut_out_box(mark_box, size):
    """The area the model sees: the mark and half as much again on each side, inside the picture."""
    x0, y0, x1, y1 = mark_box
    w, h = x1 - x0, y1 - y0
    px, py = max(256, w // 2), max(256, h // 2)
    if w >= size[0] * 0.9:   # a band across the picture (a sky): what borders it is enough
        px, py = 0, max(256, int(h * 0.35))
    if h >= size[1] * 0.9:
        px, py = max(256, int(w * 0.35)), 0
    return (max(0, x0 - px), max(0, y0 - py), min(size[0], x1 + px), min(size[1], y1 + py))


def model_size(w, h, shrink=1.0):
    """The size the model works at for a cut-out of w x h: within its limits, sides in 32s."""
    s = min(1.0, MAX_SIDE / max(w, h), (MAX_PIXELS / (w * h)) ** 0.5)
    if max(w, h) * s < MIN_SIDE:
        s = MIN_SIDE / max(w, h)
    s *= shrink
    return max(256, int(round(w * s / GRID)) * GRID), max(256, int(round(h * s / GRID)) * GRID)


def reads_at(width, height, resolution):
    """The size the pipeline reads a picture at for its `output_resolution` (its own arithmetic, repeated)."""
    ratio = width / height
    w = (resolution * resolution * ratio) ** 0.5
    return int(round(w / GRID)) * GRID, int(round((w / ratio) / GRID)) * GRID


# ── blurs and growth that cost the same whatever their radius ──

def _box(a, r, axis):
    """The mean over 2r + 1 neighbours along one axis, edges repeated."""
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, r):
    """A soft blur of about radius r (a box three times over, which is close to a Gaussian)."""
    a = np.asarray(a, dtype=np.float32)
    for _ in range(3):
        a = _box(_box(a, r, 0), r, 1)
    return a


def grow(mask, r):
    """A yes/no picture with every yes spread r pixels each way."""
    return blur_once(mask.astype(np.float32), r) > 1e-6 if r >= 1 else mask.astype(bool)


def blur_once(a, r):
    return _box(_box(a, r, 0), r, 1)


# ── where the model may work ──

def free_tiles(mark_small):
    """
    The tiles the model may repaint: every tile the mark touches and one more
    tile all round it, so it has room to join its work to the photo. Everything
    else is held as it was. `mark_small` is yes/no, the size of `small`.
    """
    h, w = mark_small.shape
    gh, gw = h // TILE, w // TILE
    tiles = mark_small[:gh * TILE, :gw * TILE].reshape(gh, TILE, gw, TILE).any(axis=(1, 3))
    return grow(tiles, 1)


def patch_alpha(mark_small):
    """
    How much of the answer is laid over the photo, 0 to 1, the size of `small`:
    all of it everywhere inside the mark, fading to none across the tile beside
    it. Nothing of the old picture is left inside the mark, so a removed thing
    leaves no outline.
    """
    wide = grow(mark_small, TILE).astype(np.float32)
    return np.maximum(blur(wide, TILE // 4), mark_small.astype(np.float32))


# ── the photo's own detail, given back ──

def _lum(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def kept_and_gain(seen, answer):
    """
    Where the answer still shows what the photo showed, and how much brighter
    or darker it made it. Two maps the size of the answer:

        kept  1 where the shapes are the photo's own (the same edges and
              texture, whatever was done to light or colour, and flat areas
              that stayed flat), 0 where something else is there now
        gain  the answer's brightness over the photo's, there

    `seen` is the photo as the model's own coder returns it when nothing is
    changed, so what the two share is compared like with like.
    """
    a, s = _lum(np.asarray(answer, dtype=np.float32)), _lum(np.asarray(seen, dtype=np.float32))
    band_a, band_s = blur(a, 1) - blur(a, 4), blur(s, 1) - blur(s, 4)
    va, vs = blur(band_a * band_a, 6), blur(band_s * band_s, 6)
    same = blur(band_a * band_s, 6) / np.sqrt(va * vs + 1e-6)
    kept = np.clip((same - KEPT_FROM) / (KEPT_FULL - KEPT_FROM), 0, 1)
    kept = kept * kept * (3 - 2 * kept)
    quiet = np.clip(1 - np.maximum(va, vs) / 4.0, 0, 1)   # both flat: nothing to compare, and only grain to give back
    kept = np.maximum(kept, quiet)
    gain = np.clip((blur(a, 6) + 4) / (blur(s, 6) + 4), 0.25, 4)
    return blur(kept, 2), gain


def _up(img, size, region, resample=Image.BICUBIC):
    """
    The part `region` (x0, y0, x1, y1) of `img` enlarged to `size`, without
    making the whole enlarged picture. A margin is enlarged with it and cut
    off, so parts made one after another join without a line.
    """
    x0, y0, x1, y1 = region
    m = 16
    ax, ay, bx, by = max(0, x0 - m), max(0, y0 - m), min(size[0], x1 + m), min(size[1], y1 + m)
    kx, ky = img.size[0] / size[0], img.size[1] / size[1]
    out = np.asarray(img.resize((bx - ax, by - ay), resample, box=(ax * kx, ay * ky, bx * kx, by * ky)))
    return out[y0 - ay:y0 - ay + (y1 - y0), x0 - ax:x0 - ax + (x1 - x0)]


def _f(a):
    return Image.fromarray(np.ascontiguousarray(a, dtype=np.float32), 'F')


def _planes(img):
    """A picture as three pictures of numbers, one a colour: enlarging those part by part is exact, which enlarging bytes is not."""
    a = np.asarray(img.convert('RGB'), dtype=np.float32)
    return [_f(a[..., c]) for c in range(3)]


def _up3(planes, size, region):
    return np.dstack([_up(p, size, region) for p in planes])


def make_patch(cut, seen, answer, mark, mark_small):
    """
    The patch for one answer, at the photo's own pixels.

    `seen` is the area as the model's coder returns it untouched (the size of
    the answer); the area as it was shown to the model will do, less well.
    Inside the mark the patch is the answer. Where the answer still shows the
    photo (a change of light or colour, or a part of the mark the model left
    alone) the patch is the answer plus everything the photo has that `seen`
    has not: the detail finer than the model draws, and the detail its coder
    loses. So an answer that changed nothing gives back the photo itself, and
    a patch laid over a 32 megapixel photo is not a soft square in a sharp
    picture. Past the mark it fades out over what the model was holding still.

    Returns (RGBA picture cropped to where it is not empty, its box in `cut`,
    the share of the mark that shows something new).
    """
    W, H = cut.size
    small, answer = seen.convert('RGB'), answer.convert('RGB')
    if answer.size != small.size:
        answer = answer.resize(small.size, Image.LANCZOS)
    kept, gain = kept_and_gain(small, answer)
    alpha_small = patch_alpha(mark_small)
    inside = mark_small > 0
    new_share = float((1 - kept)[inside].mean()) if inside.any() else 0.0

    ys, xs = np.nonzero(alpha_small > 1 / 255)
    if not len(ys):
        return None, None, 0.0
    kx, ky = W / small.size[0], H / small.size[1]
    box = (max(0, int(xs.min() * kx) - 1), max(0, int(ys.min() * ky) - 1), min(W, int((xs.max() + 1) * kx) + 2), min(H, int((ys.max() + 1) * ky) + 2))
    kept_i, gain_i, alpha_i = _f(kept), _f(gain), _f(alpha_small)
    small_p, answer_p = _planes(small), _planes(answer)
    mark = mark.convert('L')
    out = np.zeros((box[3] - box[1], box[2] - box[0], 4), dtype=np.uint8)
    for y0 in range(box[1], box[3], STRIP):
        y1 = min(box[3], y0 + STRIP)
        part = (box[0], y0, box[2], y1)
        photo = np.asarray(cut.crop(part), dtype=np.float32)
        seen = _up3(small_p, (W, H), part)
        new = _up3(answer_p, (W, H), part)
        k = _up(kept_i, (W, H), part, Image.BILINEAR)[..., None]
        g = _up(gain_i, (W, H), part, Image.BILINEAR)[..., None]
        a = np.maximum(_up(alpha_i, (W, H), part, Image.BILINEAR), np.asarray(mark.crop(part), dtype=np.float32) >= 128)
        rgb = new + k * g * (photo - seen)
        out[y0 - box[1]:y1 - box[1], :, :3] = np.clip(rgb + 0.5, 0, 255).astype(np.uint8)
        out[y0 - box[1]:y1 - box[1], :, 3] = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA'), box, new_share


def laid(small, answer, mark_small):
    """The area as it will look with the answer laid on it, at the model's size: what a check of the edit is shown."""
    a = patch_alpha(mark_small)[..., None]
    before, new = np.asarray(small.convert('RGB'), dtype=np.float32), np.asarray(answer.convert('RGB').resize(small.size), dtype=np.float32)
    return Image.fromarray(np.clip(new * a + before * (1 - a) + 0.5, 0, 255).astype(np.uint8), 'RGB')


def held_db(small, answer, free):
    """
    How close the answer is to the photo where the model was holding it still
    (PSNR, dB; higher is closer). Two tiles in from the edge of where it was
    free to work, so its join does not count. 99 when nothing was held.
    """
    a, b = np.asarray(small.convert('RGB'), dtype=np.float32), np.asarray(answer.convert('RGB'), dtype=np.float32)
    held = ~np.repeat(np.repeat(grow(free, 2), TILE, axis=0), TILE, axis=1)
    h, w = min(held.shape[0], a.shape[0]), min(held.shape[1], a.shape[1])
    d = (a[:h, :w] - b[:h, :w])[held[:h, :w]]
    if not d.size:
        return 99.0
    mse = float((d ** 2).mean())
    return 99.0 if mse == 0 else float(10 * np.log10(255 ** 2 / mse))


def outlined(small, mark_small, side=1024):
    """The picture with the mark's edge drawn on it, for the model that writes the instruction out."""
    k = min(1.0, side / max(small.size))
    size = (max(1, round(small.size[0] * k)), max(1, round(small.size[1] * k)))
    view = np.asarray(small.convert('RGB').resize(size, Image.LANCZOS)).copy()
    m = np.asarray(Image.fromarray((mark_small > 0).astype(np.uint8) * 255, 'L').resize(size, Image.NEAREST)) > 0
    line = max(2, round(max(size) / 250))
    outer = grow(m, 2 * line) & ~m
    view[outer] = (255, 255, 255)
    view[grow(m, line) & ~m] = (255, 0, 255)
    return Image.fromarray(view, 'RGB')
