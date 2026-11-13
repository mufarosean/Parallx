"""Generate: change a marked part of a picture by a written instruction.

    python generate.py --job JOB.json

Runs in the runtime Parallx installs for it (generate-engine.js); the model's
files are in the folder named by PARALLX_RUNTIME_FILES, listed in
generate-models.json. The model is Qwen-Image-2.1.

No model works at a camera photo's size, and none returns the pixels it was
not asked to change exactly as they were. So the picture is never handed over
whole and never taken back whole. What is done instead, in order:

1. The area around the mark is cut out at the photo's own pixels and shown to
   the model at a size it works at. It reads the photo and paints its answer
   at one and the same size: its sense of where things are is a grid counted
   from the middle, so two sizes would put the answer out of step with the
   photo.
2. The model is told where. It never sees the mark, so "remove what is
   marked" means nothing to it. The model's own reader of pictures and words
   (an 8B vision model, loaded anyway) is shown the area with the mark's edge
   drawn on it and writes the instruction out: what is there, where, what to
   do with it.
3. Outside the mark the picture is held still while the model works. After
   every step, everything but the marked tiles is put back to the photo, as
   noisy as that step expects. The model fills the mark knowing exactly what
   borders it, and what it returns lines up with the photo by construction.
4. Only the mark comes back: all of the answer inside it, fading out over the
   tile beside it. Wherever the answer still shows the photo, everything the
   photo has that the model's own coder loses is put back: the photo is
   turned into the model's numbers and straight back, and the difference
   between that and the photo is what the answer is owed. What is written is
   a patch to lay over the original, not a picture. The arithmetic is in
   generate_patch.py.

JOB.json:
    input         the picture (PNG, JPEG, TIFF)
    mask          a picture of the same size; white is what may change
    instruction   what to do there, in words
    output        a folder; made if missing
    steps         optional, 40
    seed          optional, 42
    tries         optional, 1: that many answers, each from its own seed
    cut_out       optional, true. false: `input` is already the area to work
                  on (the editor cuts it out itself), so all of it is used
    write_prompt  optional, true. false: the instruction goes to the model
                  as it was written

Written to `output`: for each try, try-N.png (RGBA, at the picture's own
pixels, cropped to where it is not empty) and try-N-small.png (the same,
small, to look at); and result.json with the instruction the model was given
and, for each try, its box in `input`, its seconds, how close the held part
stayed to the photo as the coder returns it (dB, higher is closer) and the
share of the mark that shows something new.

Progress: one JSON object per line on stdout. A failure: one plain sentence on
stderr after "GENERATE-ERROR: ", and exit code 2.
"""

import argparse
import gc
import json
import os
import sys
import time

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_patch as gp  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

NEEDS_FREE_GB = 21       # measured peak on an RTX 5090: 19.1 GB at 1584 x 1104
WRITER_GUARD = 400       # the written instruction is three sentences; this only stops a reply that never ends

WRITER = (
    'You write the instruction for a model that edits photographs. You are shown part of a photo. '
    'A magenta line with a white edge is drawn round the area that may change; the line is not in the photo. '
    'You are told what the person wants done there. Write the instruction for the editing model: '
    'name what is inside the line and say where it is in the picture (left, right, top, bottom, middle, beside or behind what); '
    'say exactly what to do with it; and say how the result must fit what surrounds it (the light, the colours, the texture, the perspective). '
    'Everything outside the line stays as it is. Never mention the line, the marking or magenta. '
    'Answer with the instruction alone, in one to three sentences, in English.'
)


JUDGE = (
    'You check the work of a model that edits photographs. Picture 1 is part of a photo before the edit; {where} '
    'Picture 2 is the same part of the photo after the edit. You are told what the person asked for. '
    'Look at Picture 2 as a whole, compare it with Picture 1, and answer three questions.\n'
    'DONE: was what the person asked for carried out, there?\n'
    'FITS: does what changed fit the rest of the picture: the same light, colours, sharpness and perspective, '
    'no visible outline or patch where the area was, nothing doubled or cut off?\n'
    'CLEAN: is what changed free of things that should not be there: smears, garbled shapes, pieces left over of what was to go?\n'
    'Answer in exactly this form and nothing else:\n'
    'DONE: yes or no\nFITS: yes or no\nCLEAN: yes or no\nWHY: one short sentence naming the worst problem, or "nothing" if there is none.'
)
JUDGE_MARKED = 'a magenta line with a white edge is drawn round the area that was allowed to change (the line is not in the photo).'
JUDGE_WHOLE = 'all of it was allowed to change.'


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


class Hold:
    """
    Holds the picture still outside the mark while the model works.

    The model paints its answer from noise, a step at a time. After each step
    every tile it is not free to change is put back to the photo, with the
    noise that step still expects (the same noise the answer started from).
    At the last step that noise is none, so those tiles are the photo.

    The pipeline hands its steps the picture in progress but not the photo it
    read, so the photo and the starting noise are taken as it prepares them.
    With every tile free (the whole picture) nothing is held; the photo is
    still taken, for `seen`.
    """

    def __init__(self, pipe, free):
        import torch
        self.pipe = pipe
        self.everything = bool(free.all())
        self.free = torch.from_numpy(np.ascontiguousarray(free).reshape(1, -1, 1))
        self.photo = self.noise = None

    def __enter__(self):
        prepare = self.pipe.prepare_latents
        self.was = vars(self.pipe).get('prepare_latents')

        def taking(*args, **kwargs):
            latents, photo = prepare(*args, **kwargs)
            self.noise, self.photo = latents.clone(), photo
            return latents, photo

        self.pipe.prepare_latents = taking
        return self

    def __exit__(self, *_exc):
        if self.was is not None:
            self.pipe.prepare_latents = self.was
        else:
            vars(self.pipe).pop('prepare_latents', None)

    def after(self, step, latents):
        import torch
        if self.everything:
            return latents
        if self.photo is None or self.photo.shape != latents.shape or self.free.shape[1] != latents.shape[1]:
            raise Problem('The model did not read the picture at the size it was working at, so the area outside the mark could not be held still. Nothing was changed.')
        sigma = self.pipe.scheduler.sigmas[step + 1].to(latents.device, latents.dtype)
        known = (1 - sigma) * self.photo.to(latents.dtype) + sigma * self.noise
        return torch.where(self.free.to(latents.device), latents, known)


def seen_by(pipe, hold, width, height):
    """
    The photo as the model's coder returns it when nothing is changed: what it
    read, turned straight back into a picture. The patch is made against this,
    so what the coder loses is not taken for something the model changed, and
    is given back with the rest of the photo's detail.
    """
    import torch
    with torch.no_grad():
        vae = pipe.vae
        latents = pipe._unpack_latents(hold.photo, height, width, pipe.vae_scale_factor).to(vae.dtype)
        shape = (1, vae.config.z_dim, 1, 1, 1)
        mean = torch.tensor(vae.config.latents_mean).view(shape).to(latents.device, latents.dtype)
        std = torch.tensor(vae.config.latents_std).view(shape).to(latents.device, latents.dtype)
        picture = vae.decode(latents * std + mean, return_dict=False)[0][:, :, 0]
        seen = pipe.image_processor.postprocess(picture, output_type='pil')[0].convert('RGB')
    if hasattr(pipe, 'maybe_free_model_hooks'):
        pipe.maybe_free_model_hooks()
    return seen


def write_prompt(pipe, small, mark_small, instruction):
    """The instruction written out for the model by its own reader, which is shown where the mark is."""
    text = ask_reader(pipe, WRITER, [gp.outlined(small, mark_small)], 'What the person wants done there: ' + instruction)
    text = ' '.join(text.split()).strip('"\u201c\u201d ')
    if len(text) < 12:
        raise ValueError('The reader wrote nothing.')
    return text


def ask_reader(pipe, system, pictures, text):
    """One question to the model's reader of pictures and words; its answer as plain text."""
    import torch
    reader, processor = pipe.text_encoder, pipe.processor
    messages = [
        {'role': 'system', 'content': [{'type': 'text', 'text': system}]},
        {'role': 'user', 'content': [{'type': 'image', 'image': p} for p in pictures] + [{'type': 'text', 'text': text}]},
    ]
    inputs = processor.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_dict=True, return_tensors='pt')
    hook = getattr(reader, '_hf_hook', None)
    if hook is not None and hasattr(hook, 'pre_forward'):   # the reader waits off the card until it is called for
        hook.pre_forward(reader)
    inputs = inputs.to(reader.device)
    with torch.no_grad():
        out = reader.generate(**inputs, max_new_tokens=WRITER_GUARD, do_sample=False)
    return processor.batch_decode(out[:, inputs['input_ids'].shape[1]:], skip_special_tokens=True)[0]


def judge(pipe, before, after, mark_small, instruction):
    """
    The reader looks at the area before (the mark's edge drawn on it) and after,
    as a whole, and says whether the edit was done, fits and is clean.
    Returns { done, fits, clean (True, False, or None when it did not say), why, good }.
    """
    import re
    whole = bool(np.asarray(mark_small).all())
    first = before if whole else gp.outlined(before, mark_small)
    k = min(1.0, 1024 / max(after.size))
    second = after.convert('RGB').resize((max(1, round(after.size[0] * k)), max(1, round(after.size[1] * k))), Image.LANCZOS)
    text = ask_reader(pipe, JUDGE.format(where=JUDGE_WHOLE if whole else JUDGE_MARKED), [first, second], 'What the person asked for: ' + instruction.strip())
    said = {}
    for key in ('done', 'fits', 'clean'):
        m = re.search(key + r'\s*:\s*\**\s*(yes|no)', text, re.I)
        said[key] = None if not m else m.group(1).lower() == 'yes'
    m = re.search(r'why\s*:\s*(.+)', text, re.I)
    said['why'] = ' '.join(m.group(1).split())[:300] if m else ' '.join(text.split())[:300]
    said['good'] = all(said[key] is True for key in ('done', 'fits', 'clean'))
    return said


def out_of_memory(err):
    import torch
    return isinstance(err, getattr(torch, 'OutOfMemoryError', ())) or 'out of memory' in str(err).lower()


def edit(pipe, cut, mark, instruction, output, steps=40, seed=42, tries=1, write=True, origin=(0, 0)):
    """
    Make `tries` patches for the area `cut` (a picture) and its `mark` (white is
    what may change, the same size). Returns what result.json holds, less the
    memory. `origin` is where `cut` sits in the picture the boxes are given in.
    """
    import torch
    cut, mark = cut.convert('RGB'), mark.convert('L')
    os.makedirs(output, exist_ok=True)
    device = pipe._execution_device
    instruction = instruction.strip()
    prompt, written, note = instruction, False, ''
    shrink, done, n = 1.0, [], 1
    width = height = 0
    seen, seen_size = None, None
    while n <= tries:
        width, height = gp.model_size(*cut.size, shrink)
        small = cut.resize((width, height), Image.LANCZOS)
        mark_small = np.asarray(mark.resize((width, height), Image.BILINEAR)) >= 64
        free = gp.free_tiles(mark_small)
        everything = bool(free.all())
        if write and not written and not everything and n == 1 and shrink == 1.0:
            say(stage='prompt')
            try:
                prompt, written = write_prompt(pipe, small, mark_small, instruction), True
            except Problem:
                raise
            except Exception as e:  # the edit goes on with the instruction as it was written
                if out_of_memory(e):
                    raise
                note = (str(e).strip().splitlines() or [type(e).__name__])[-1][:300]
        resolution = (width * height) ** 0.5
        if gp.reads_at(width, height, resolution) != (width, height):
            raise Problem('The size the model reads the picture at could not be matched to the size it works at.')

        hold = Hold(pipe, free)

        def on_step(_pipe, step, _timestep, kwargs, n=n, hold=hold):
            kwargs['latents'] = hold.after(step, kwargs['latents'])
            say(stage='generate', **{'try': n}, of=tries, step=step + 1, steps=steps)
            return kwargs

        started = time.time()
        try:
            call = dict(prompt=prompt, image=small, height=height, width=width, output_resolution=resolution,
                        num_inference_steps=steps, callback_on_step_end=on_step,
                        generator=torch.Generator(device).manual_seed(seed + n - 1))
            with hold:
                answer = pipe(**call).images[0]
            if seen_size != (width, height):
                try:
                    seen, seen_size = seen_by(pipe, hold, width, height), (width, height)
                except Exception as e:  # the patch is then made against what the model was shown: softer, still right
                    if out_of_memory(e):
                        raise
                    seen, seen_size = small, (width, height)
                    note = note or (str(e).strip().splitlines() or [type(e).__name__])[-1][:300]
        except Exception as e:
            if not out_of_memory(e):
                raise
            # A smaller picture of the same area: the photo's own detail comes back when the patch is made.
            shrink *= 0.8
            if shrink < 0.5:
                raise Problem('The graphics card ran out of memory. Set the chat model aside, or mark a smaller area.')
            del e
            if hasattr(pipe, 'maybe_free_model_hooks'):
                pipe.maybe_free_model_hooks()
            gc.collect()
            torch.cuda.empty_cache()
            say(stage='smaller')
            continue
        say(stage='try', **{'try': n}, of=tries)
        patch, box, new_share = gp.make_patch(cut, seen, answer, mark, mark_small)
        if patch is None:
            raise Problem('Nothing is marked to change.')
        name, small_name = f'try-{n}.png', f'try-{n}-small.png'
        patch.save(os.path.join(output, name), compress_level=1)
        look = patch.copy()
        look.thumbnail((768, 768), Image.LANCZOS)
        look.save(os.path.join(output, small_name))
        done.append({'file': name, 'small': small_name,
                     'box': [box[0] + origin[0], box[1] + origin[1], box[2] + origin[0], box[3] + origin[1]],
                     'seed': seed + n - 1, 'seconds': round(time.time() - started, 1),
                     'held_db': round(gp.held_db(seen, answer, free), 1), 'new_share': round(new_share, 3),
                     'model_size': [width, height]})
        say(stage='tried', **{'try': n}, of=tries, file=name)
        n += 1
    return {'prompt': prompt, 'prompt_by': 'engine' if written else 'instruction', 'note': note,
            'model_size': [width, height], 'steps': steps, 'tries': done}


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
        mark_full = Image.open(job['mask']).convert('L')
    except OSError:
        raise Problem('The picture or its mask could not be opened.')
    if mark_full.size != picture.size:
        raise Problem('The mask is not the size of the picture.')
    mark_full = mark_full.point(lambda v: 255 if v >= 128 else 0)
    mark_box = mark_full.getbbox()
    if not mark_box:
        raise Problem('Nothing is marked to change.')
    box = gp.cut_out_box(mark_box, picture.size) if job.get('cut_out', True) else (0, 0) + picture.size
    cut, mark = picture.crop(box), mark_full.crop(box)
    steps = int(job.get('steps') or 40)
    seed = int(job.get('seed') or 42)
    tries = max(1, min(8, int(job.get('tries') or 1)))

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
    torch.cuda.reset_peak_memory_stats()
    result = edit(pipe, cut, mark, job['instruction'], job['output'], steps=steps, seed=seed, tries=tries,
                  write=job.get('write_prompt', True) is not False, origin=box[:2])
    result['peak_gb'] = round(torch.cuda.max_memory_allocated() / 2 ** 30, 1)
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
