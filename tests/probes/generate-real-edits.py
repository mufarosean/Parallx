"""Generate on real photos, on the graphics card: the edits already tried in the app, made again, old beside new.

    python tests/probes/generate-real-edits.py WORKSPACE [--last 6] [--tries 1] [--out FOLDER]

WORKSPACE is the Parallx workspace the edits were made in (any folder above
them will do). Every time Generate ran in the app it left a folder there
(…/edits/<photo>/generate-…) holding the piece of the photo it sent, the
mark, the instruction and the patches that came back. This takes the most
recent of them, runs the engine as it is now on the same piece, mark and
words, from the same seed, and writes one sheet a case: the photo with the
mark outlined, what was made then, what is made now, whole and at the
photo's own pixels at the mark's edge. Cases made by an older engine have
their old result to show; a case with none still gets its new one.

It needs what the app needs: the engine set up (Generate tab), and about
21 GB of the card free, so set the chat model aside first (in the app, or
`ollama stop <model>`). It loads the model once for all cases; a try takes
about a minute. Run it with any Python: it finds the engine's own
(data/runtimes/qwen-image-generate, or --runtime) and carries on in that.

Written to FOLDER (data/generate-test/evidence by default, which git does
not track): case-N.png, the patches, results.json and index.html.
"""

import argparse
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(ROOT, 'ext', 'media-organizer', 'engine')


def runtime_python(runtime):
    for rel in (('env', 'Scripts', 'python.exe'), ('env', 'bin', 'python')):
        p = os.path.join(runtime, *rel)
        if os.path.isfile(p):
            return p
    return None


def find_cases(root, last):
    """Job folders under `root` that still have their piece and mark, newest first."""
    found = []
    jobs = []
    for folder, dirs, files in os.walk(root):   # the jobs are under .parallx, which a ** search passes over
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
        if os.path.basename(folder).startswith('generate-') and 'job.json' in files:
            jobs.append(os.path.join(folder, 'job.json'))
            dirs[:] = []
    for job_path in jobs:
        folder = os.path.dirname(job_path)
        try:
            with open(job_path, encoding='utf-8') as f:
                job = json.load(f)
        except (OSError, ValueError):
            continue
        piece, mark = os.path.join(folder, 'in.png'), os.path.join(folder, 'mask.png')
        if not (os.path.isfile(piece) and os.path.isfile(mark) and isinstance(job.get('instruction'), str)):
            continue
        found.append({'folder': folder, 'job': job, 'piece': piece, 'mark': mark, 'when': os.path.getmtime(job_path)})
    seen, cases = set(), []
    for c in sorted(found, key=lambda c: -c['when']):
        if c['folder'] not in seen:
            seen.add(c['folder'])
            cases.append(c)
    return cases[:last]


def old_result(case, piece):
    """The first try the app got then, laid on the piece the way the app laid it; None when there is none."""
    from PIL import Image
    try:
        with open(os.path.join(case['folder'], 'out', 'result.json'), encoding='utf-8') as f:
            result = json.load(f)
        first = result['tries'][0]
        box = first.get('box') or result['box']
        patch = Image.open(os.path.join(case['folder'], 'out', first['file'])).convert('RGBA')
    except (OSError, ValueError, KeyError, IndexError):
        return None, None
    w, h = box[2] - box[0], box[3] - box[1]
    if patch.size != (w, h):
        patch = patch.resize((w, h), Image.BICUBIC)
    out = piece.copy()
    out.paste(patch.convert('RGB'), (box[0], box[1]), patch.getchannel('A'))
    return out, {'engine': 'new' if 'prompt' in result else 'old', 'drift_db': first.get('drift_db'), 'held_db': first.get('held_db'), 'seconds': first.get('seconds'), 'prompt': result.get('prompt')}


def sheet(piece, mark, old, new, lines):
    """One case as a picture: the piece with the mark outlined, then and now; and the mark's edge at the photo's own pixels."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    try:
        font = ImageFont.load_default(size=20)
    except TypeError:
        font = ImageFont.load_default()
    W = 760
    m = np.asarray(mark.convert('L')) >= 128
    outlined = np.asarray(piece).copy()
    line = max(3, round(max(piece.size) / 300)) * 2 + 1
    grown = np.asarray(Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(min(line, 31)))) > 0
    outlined[grown & ~m] = (255, 0, 255)
    columns = [('The photo, the mark outlined', Image.fromarray(outlined)), ('Then', old), ('Now', new)]

    def cell(label, im, crop=None):
        t = Image.new('RGB', (W, 30 + (H if crop is None else CH)), (24, 24, 24))
        ImageDraw.Draw(t).text((6, 4), label, fill=(235, 235, 235), font=font)
        if im is None:
            ImageDraw.Draw(t).text((6, 60), 'No result was kept from then.', fill=(150, 150, 150), font=font)
            return t
        part = im if crop is None else im.crop(crop)
        if crop is None:
            part = part.copy()
            part.thumbnail((W, H), Image.LANCZOS)
        t.paste(part, ((W - part.size[0]) // 2, 30))
        return t

    H = min(560, round(W * piece.size[1] / piece.size[0]))
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    cw, CH = min(W, piece.size[0]), min(480, piece.size[1])

    def at(cx, cy):
        left, top = max(0, min(piece.size[0] - cw, cx - cw // 2)), max(0, min(piece.size[1] - CH, cy - CH // 2))
        return (left, top, left + cw, top + CH)

    whole_mark = x0 == 0 and y0 == 0 and x1 == piece.size[0] - 1 and y1 == piece.size[1] - 1
    places = [('the middle, at 100%', at(piece.size[0] // 2, piece.size[1] // 2))] if whole_mark else \
        [('the mark\'s left edge, at 100%', at(x0, (y0 + y1) // 2)), ('the mark\'s lower edge, at 100%', at((x0 + x1) // 2, y1))]
    rows = [[cell(label, im) for label, im in columns]]
    for where, crop in places:
        rows.append([cell(f'{label}: {where}' if i == 0 else label, im, crop) for i, (label, im) in enumerate([('The photo', piece), ('Then', old), ('Now', new)])])
    text_h = 26 * len(lines) + 16
    out = Image.new('RGB', (3 * W + 40, text_h + sum(r[0].size[1] + 12 for r in rows) + 10), (24, 24, 24))
    d = ImageDraw.Draw(out)
    for i, ln in enumerate(lines):
        d.text((10, 8 + 26 * i), ln[:230], fill=(235, 235, 235), font=font)
    y = text_h
    for r in rows:
        for i, t in enumerate(r):
            out.paste(t, (10 + i * (W + 10), y))
        y += r[0].size[1] + 12
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('workspace')
    ap.add_argument('--last', type=int, default=6)
    ap.add_argument('--tries', type=int, default=1)
    ap.add_argument('--out', default=os.path.join(ROOT, 'data', 'generate-test', 'evidence'))
    ap.add_argument('--runtime', default=os.path.join(ROOT, 'data', 'runtimes', 'qwen-image-generate'))
    args = ap.parse_args()

    cases = find_cases(os.path.abspath(args.workspace), args.last)
    if not cases:
        sys.exit(f'No Generate jobs were found under {args.workspace}. Give the workspace the edits were made in.')
    python = runtime_python(args.runtime)
    if not python:
        sys.exit(f'The Generate engine is not set up at {args.runtime}. Set it up from the Generate tab, or give --runtime.')
    if os.path.normcase(os.path.realpath(sys.executable)) != os.path.normcase(os.path.realpath(python)) and not os.environ.get('GENERATE_REAL_EDITS_IN_RUNTIME'):
        env = dict(os.environ, GENERATE_REAL_EDITS_IN_RUNTIME='1', PARALLX_RUNTIME_FILES=os.path.join(args.runtime, 'files'), PYTHONUTF8='1')
        sys.exit(subprocess.call([python, os.path.abspath(__file__)] + sys.argv[1:], env=env))
    os.environ.setdefault('PARALLX_RUNTIME_FILES', os.path.join(args.runtime, 'files'))

    sys.path.insert(0, ENGINE)
    import generate
    from PIL import Image
    import torch
    if not torch.cuda.is_available():
        sys.exit('PyTorch cannot use the graphics card here.')
    free = torch.cuda.mem_get_info()[0] / 2 ** 30
    if free < generate.NEEDS_FREE_GB:
        sys.exit(f'Generate needs about {generate.NEEDS_FREE_GB} GB of free graphics memory; {free:.0f} GB is free. Set the chat model aside and run this again.')
    print(f'{len(cases)} case(s). Loading the model…', flush=True)
    from diffusers import QwenImage21Pipeline
    started = time.time()
    pipe = QwenImage21Pipeline.from_pretrained(generate.model_folder(), torch_dtype=torch.bfloat16)
    pipe.enable_model_cpu_offload()
    print(f'Loaded in {time.time() - started:.0f} s.', flush=True)
    generate.say = lambda **kw: print(f"  try {kw.get('try')}: step {kw.get('step')} of {kw.get('steps')}", flush=True) if kw.get('stage') == 'generate' and kw.get('step') in (1, kw.get('steps')) else None

    os.makedirs(args.out, exist_ok=True)
    report = []
    for k, case in enumerate(cases, start=1):
        job = case['job']
        piece, mark = Image.open(case['piece']).convert('RGB'), Image.open(case['mark']).convert('L')
        if mark.size != piece.size:
            print(f'case {k}: the mark is not the size of the piece; skipped')
            continue
        print(f'case {k}: {job["instruction"][:90]!r}, {piece.size[0]} x {piece.size[1]}', flush=True)
        then, then_info = old_result(case, piece)
        folder = os.path.join(args.out, f'case-{k}')
        torch.cuda.reset_peak_memory_stats()
        try:
            result = generate.edit(pipe, piece, mark.point(lambda v: 255 if v >= 128 else 0), job['instruction'], folder,
                                   steps=int(job.get('steps') or 40), seed=int(job.get('seed') or 42), tries=max(1, args.tries))
        except Exception as e:  # one case that fails is reported and the rest go on
            print(f'  failed: {e}')
            report.append({'case': k, 'folder': case['folder'], 'instruction': job['instruction'], 'error': str(e)})
            continue
        peak = round(torch.cuda.max_memory_allocated() / 2 ** 30, 1)
        first = result['tries'][0]
        patch = Image.open(os.path.join(folder, first['file']))
        now = piece.copy()
        now.paste(patch.convert('RGB'), (first['box'][0], first['box'][1]), patch.getchannel('A'))
        now.save(os.path.join(folder, 'now.png'), compress_level=1)
        lines = [f'Case {k}. His words: {job["instruction"]}',
                 f'Now, written out for the model: {result["prompt"]}' if result['prompt_by'] == 'engine' else f'Now: the words went as written ({result["note"] or "the whole picture"})',
                 f'Now: {first["model_size"][0]} x {first["model_size"][1]}, {first["seconds"]} s a try, held part {first["held_db"]} dB from the photo, {round(first["new_share"] * 100)}% of the mark new, peak {peak} GB.',
                 'Then: ' + (', '.join(x for x in (
                     f'raw answer {then_info["drift_db"]} dB from the photo outside the mark' if then_info.get('drift_db') is not None else '',
                     f'held part {then_info["held_db"]} dB' if then_info.get('held_db') is not None else '',
                     f'{then_info["seconds"]} s a try' if then_info.get('seconds') is not None else '') if x) or 'nothing recorded') + '.' if then_info else 'Then: no result kept.']
        sheet(piece, mark, then, now, lines).save(os.path.join(args.out, f'case-{k}.png'))
        report.append({'case': k, 'folder': case['folder'], 'instruction': job['instruction'], 'then': then_info, 'now': result, 'peak_gb': peak})
        print(f'  -> {os.path.join(args.out, f"case-{k}.png")}', flush=True)
    with open(os.path.join(args.out, 'results.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=1)
    with open(os.path.join(args.out, 'index.html'), 'w', encoding='utf-8') as f:
        f.write('<!doctype html><meta charset="utf-8"><title>Generate: then and now</title><body style="background:#181818;color:#eee;font-family:sans-serif">'
                + ''.join(f'<p><img src="case-{r["case"]}.png" style="max-width:100%"></p>' for r in report if 'error' not in r)
                + ''.join(f'<p>Case {r["case"]} failed: {r["error"]}</p>' for r in report if 'error' in r) + '</body>')
    print(f'Done: {os.path.join(args.out, "index.html")}')


if __name__ == '__main__':
    main()
