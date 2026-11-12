"""Generate: change a marked part of a picture by a written instruction.

    python generate.py --job JOB.json

Runs in the runtime Parallx installs for it (generate-engine.js); the model's
files are in the folder named by PARALLX_RUNTIME_FILES, listed in
generate-models.json. The model is Qwen-Image-2.1.

No model works at a camera photo's size, and none returns the pixels it was
not asked to change exactly as they were. So the picture is never handed over
whole and never taken back whole: the area around the mask is cut out at the
photo's own pixels, the model edits that piece, and only the masked part of
its answer, feathered at the edge and matched in colour to what surrounds it,
is kept. What is written is a patch to lay over the original, not a picture.

JOB.json:
    input        the picture, at its full size (PNG, JPEG, TIFF)
    mask         a picture of the same size; white is what may change
    instruction  what to do there, in words
    output       a folder; made if missing
    steps        optional, 40
    seed         optional, 42
    tries        optional, 1: that many answers, each from its own seed

Written to `output`: try-1.png ... (RGBA, the size of the cut-out, transparent
outside the mask) and result.json with the cut-out's place in the picture and,
for each try, its seconds and how far the model's raw answer drifted outside
the mask (dB, higher is closer).

Progress: one JSON object per line on stdout. A failure: one plain sentence on
stderr after "GENERATE-ERROR: ", and exit code 2.
"""

import argparse
import json
import os
import sys
import time

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))

MAX_SIDE = 2048          # the model's largest side
MAX_PIXELS = 4_000_000   # and its largest area
MIN_SIDE = 1024          # a small cut-out is enlarged to this before the model sees it
NEEDS_FREE_GB = 21       # measured peak on an RTX 5090: 19.1 GB at 1584 x 1104


def say(**kw):
    print(json.dumps(kw), flush=True)


class Problem(Exception):
    """A failure the user is told about, in one plain sentence."""


def model_folder():
    """Lay the runtime's flat files out as the folder the pipeline loads (hard links, nothing stored twice)."""
    files = os.environ.get('PARALLX_RUNTIME_FILES')
    if not files:
        raise Problem('The Generate engine is not set up.')
    with open(os.path.join(HERE, 'generate-models.json'), encoding='utf-8') as f:
        entries = json.load(f)['files']
    target = os.path.join(os.path.dirname(files), 'home', 'qwen-image-2.1')
    for e in entries:
        src, dest = os.path.join(files, e['name']), os.path.join(target, *e['path'].split('/'))
        if not os.path.isfile(src):
            raise Problem(f"A model file is missing ({e['name']}). Set the Generate engine up again.")
        if os.path.isfile(dest) and os.path.getsize(dest) == os.path.getsize(src):
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest):
            os.remove(dest)
        try:
            os.link(src, dest)
        except OSError:
            import shutil
            shutil.copyfile(src, dest)
    return target


def cut_out_box(mask_box, size):
    """The area the model sees: the mask and as much again around it, inside the picture."""
    x0, y0, x1, y1 = mask_box
    w, h = x1 - x0, y1 - y0
    px, py = max(256, w), max(256, h)
    if w >= size[0] * 0.9:   # a band across the picture (a sky): what borders it is enough
        px, py = 0, max(256, int(h * 0.35))
    if h >= size[1] * 0.9:
        px, py = max(256, int(w * 0.35)), 0
    return (max(0, x0 - px), max(0, y0 - py), min(size[0], x1 + px), min(size[1], y1 + py))


def model_size(w, h):
    """The size the model works at for a cut-out of w x h: within its limits, sides in 16s."""
    s = min(1.0, MAX_SIDE / max(w, h), (MAX_PIXELS / (w * h)) ** 0.5)
    if max(w, h) * s < MIN_SIDE:
        s = MIN_SIDE / max(w, h)
    return max(256, int(round(w * s / 16)) * 16), max(256, int(round(h * s / 16)) * 16)


def feather_of(mask_box):
    return max(8, int(min(mask_box[2] - mask_box[0], mask_box[3] - mask_box[1]) * 0.04))


def drift_db(a, b, where):
    """How close the model's answer is to the original where it should not have changed (PSNR)."""
    d = (a.astype(np.float32) - b.astype(np.float32))[where]
    mse = float((d ** 2).mean()) if d.size else 0.0
    return 99.0 if mse == 0 else float(10 * np.log10(255 ** 2 / mse))


def make_patch(cut, answer, mask, feather):
    """
    The patch for one answer: the answer where the mask is, feathered, its colour
    brought to the photo's in the band just outside the mask. Returns (RGBA
    picture, drift in dB).
    """
    back = answer.convert('RGB').resize(cut.size, Image.LANCZOS)
    a, b = np.asarray(cut), np.asarray(back)
    grown = np.asarray(mask.filter(ImageFilter.MaxFilter(2 * feather + 1)))
    outside = grown == 0
    ring = (np.asarray(mask.filter(ImageFilter.MaxFilter(6 * feather + 1))) > 0) & outside
    fixed = b.astype(np.float32)
    if int(ring.sum()) > 500:
        for c in range(3):
            fixed[..., c] += float(a[..., c][ring].mean()) - float(b[..., c][ring].mean())
    rgba = np.dstack([np.clip(fixed, 0, 255).astype(np.uint8), np.asarray(mask.filter(ImageFilter.GaussianBlur(feather)))])
    return Image.fromarray(rgba, 'RGBA'), drift_db(a, b, outside)


def read_job(path):
    try:
        with open(path, encoding='utf-8') as f:
            job = json.load(f)
    except (OSError, ValueError):
        raise Problem('The job could not be read.')
    for key in ('input', 'mask', 'instruction', 'output'):
        if not isinstance(job.get(key), str) or not job[key].strip():
            raise Problem(f'The job has no {key}.')
    return job


def run(job):
    try:
        picture = Image.open(job['input']).convert('RGB')
        mask_full = Image.open(job['mask']).convert('L')
    except OSError:
        raise Problem('The picture or its mask could not be opened.')
    if mask_full.size != picture.size:
        raise Problem('The mask is not the size of the picture.')
    mask_box = mask_full.point(lambda v: 255 if v >= 128 else 0).getbbox()
    if not mask_box:
        raise Problem('Nothing is marked to change.')
    box = cut_out_box(mask_box, picture.size)
    cut = picture.crop(box)
    mask = mask_full.crop(box).point(lambda v: 255 if v >= 128 else 0)
    width, height = model_size(*cut.size)
    feather = feather_of(mask_box)
    steps = int(job.get('steps') or 40)
    seed = int(job.get('seed') or 42)
    tries = max(1, min(8, int(job.get('tries') or 1)))
    os.makedirs(job['output'], exist_ok=True)

    import torch
    if not torch.cuda.is_available():
        raise Problem('Generate needs an NVIDIA graphics card PyTorch can use.')
    free = torch.cuda.mem_get_info()[0] / 2 ** 30
    if free < NEEDS_FREE_GB:
        raise Problem(f'Generate needs about {NEEDS_FREE_GB} GB of free graphics memory; {free:.0f} GB is free. Set the chat model aside and try again.')

    say(stage='load')
    from diffusers import QwenImage21Pipeline
    pipe = QwenImage21Pipeline.from_pretrained(model_folder(), torch_dtype=torch.bfloat16)
    pipe.enable_model_cpu_offload()
    small = cut.resize((width, height), Image.LANCZOS)
    done = []
    for n in range(1, tries + 1):
        def on_step(_pipe, step, _timestep, kwargs, n=n):
            say(stage='generate', **{'try': n}, of=tries, step=step + 1, steps=steps)
            return kwargs
        torch.cuda.reset_peak_memory_stats()
        started = time.time()
        answer = pipe(prompt=job['instruction'].strip(), image=small, height=height, width=width,
                      num_inference_steps=steps, callback_on_step_end=on_step,
                      generator=torch.Generator('cuda').manual_seed(seed + n - 1)).images[0]
        patch, drift = make_patch(cut, answer, mask, feather)
        name = f'try-{n}.png'
        patch.save(os.path.join(job['output'], name))
        done.append({'file': name, 'seed': seed + n - 1, 'seconds': round(time.time() - started, 1), 'drift_db': round(drift, 1)})
        say(stage='try', **{'try': n}, of=tries, file=name)
    result = {'box': list(box), 'model_size': [width, height], 'steps': steps, 'tries': done,
              'peak_gb': round(torch.cuda.max_memory_allocated() / 2 ** 30, 1)}
    with open(os.path.join(job['output'], 'result.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=1)
    say(stage='done', **result)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', required=True)
    args = parser.parse_args()
    try:
        run(read_job(args.job))
    except Problem as e:
        print('GENERATE-ERROR: ' + str(e), file=sys.stderr, flush=True)
        sys.exit(2)
    except Exception as e:  # the last line the app shows must still be a sentence
        text = str(e).strip().splitlines()[-1] if str(e).strip() else type(e).__name__
        if 'out of memory' in text.lower():
            text = 'The graphics card ran out of memory. Set the chat model aside, or mark a smaller area.'
        print('GENERATE-ERROR: ' + text, file=sys.stderr, flush=True)
        sys.exit(2)


if __name__ == '__main__':
    main()
