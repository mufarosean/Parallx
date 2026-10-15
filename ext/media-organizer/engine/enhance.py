"""Enhance: enlarge a picture with SeedVR2 7B sharp, in overlapping pieces.

    python enhance.py --input IN --output OUT.png --scale 2 [--piece-out 4096]

Runs in the runtime Parallx installs (docs/ENHANCE.md); the model files are in
the folder named by PARALLX_RUNTIME_FILES. A whole camera photo does not fit
in a graphics card's memory, so the picture is cut into overlapping pieces,
each piece is enlarged (the model stays loaded across them), and the pieces
are joined with feathered edges. --piece-out is the size of an enlarged
piece: 4096 needs about 20 GB of free graphics memory, 2048 about 12 GB.

Progress: one JSON object per line on stdout. A failure: one plain sentence
on stderr after "ENHANCE-ERROR: ", and exit code 2.
"""

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, 'seedvr2', 'inference_cli.py')
DIT = 'seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors'
VAE = 'ema_vae_fp16.safetensors'
OVERLAP = 0.094  # of a piece's side: 192 px on a 2048 px piece; joins were invisible at 100% with it


def say(**kw):
    print(json.dumps(kw), flush=True)


def fail(message):
    print('ENHANCE-ERROR: ' + message, file=sys.stderr, flush=True)
    sys.exit(2)


def read(path):
    """The picture as 8-bit BGR, and its alpha (or None). Paths with any characters work."""
    try:
        data = np.fromfile(path, dtype=np.uint8)
    except OSError:
        fail('The picture could not be read.')
    img = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if img is None:
        fail('The picture is in a format Enhance cannot read.')
    if img.dtype == np.uint16:
        img = (img / 257).round().astype(np.uint8)
    elif img.dtype != np.uint8:
        img = np.clip(img, 0, 255).astype(np.uint8)
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    alpha = None
    if img.shape[2] == 4:
        alpha = img[:, :, 3].copy()
        img = img[:, :, :3].copy()
    return img, alpha


def write(path, img):
    ok, encoded = cv2.imencode('.png', img)
    if not ok:
        fail('The enlarged picture could not be encoded.')
    encoded.tofile(path)


def spans(length, piece, overlap):
    """Starts and ends of the pieces along one side; every piece is `piece` long (or the whole side)."""
    if length <= piece:
        return [(0, length)]
    n = math.ceil((length - overlap) / (piece - overlap))
    step = (length - piece) / (n - 1)
    return [(round(i * step), round(i * step) + piece) for i in range(n)]


def ramp(n, rise, fall, band):
    """Weights along one side of a piece. `rise` and `fall` are how far the neighbours before and
    after reach into it. Each pixel takes its detail from one piece: the hand-over is a `band` wide
    feather in the middle of each overlap. (Feathering across a whole overlap averages two pieces'
    detail there, which softens it.)"""
    w = np.ones(n, np.float32)
    if rise:
        b = min(band, rise)
        s = (rise - b) // 2
        w[:s] = 0
        w[s:s + b] = np.linspace(0, 1, b + 2, dtype=np.float32)[1:-1]
    if fall:
        b = min(band, fall)
        s = (fall - b) // 2
        if s:
            w[n - s:] = 0
        w[n - s - b:n - s] = np.linspace(1, 0, b + 2, dtype=np.float32)[1:-1]
    return w


def plan(width, height, piece):
    overlap = max(32, round(piece * OVERLAP))
    xs, ys = spans(width, piece, overlap), spans(height, piece, overlap)
    pieces = []
    for r, (y0, y1) in enumerate(ys):
        for c, (x0, x1) in enumerate(xs):
            pieces.append({
                'name': f'piece-{r:03d}-{c:03d}.png', 'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1,
                # How far the neighbours reach into this piece, on each side.
                'left': xs[c - 1][1] - x0 if c > 0 else 0,
                'right': x1 - xs[c + 1][0] if c + 1 < len(xs) else 0,
                'top': ys[r - 1][1] - y0 if r > 0 else 0,
                'bottom': y1 - ys[r + 1][0] if r + 1 < len(ys) else 0,
            })
    return pieces


def join(pieces, outdir, scale, width, height, band):
    acc = np.zeros((height * scale, width * scale, 3), np.float32)
    wsum = np.zeros((height * scale, width * scale, 1), np.float32)
    for p in pieces:
        x0, y0, x1, y1 = (p[k] * scale for k in ('x0', 'y0', 'x1', 'y1'))
        path = os.path.join(outdir, p['name'])
        if not os.path.exists(path):
            fail('A piece of the picture was not enlarged.')
        t = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if t is None:
            fail('A piece of the picture could not be read back.')
        if t.shape[1] != x1 - x0 or t.shape[0] != y1 - y0:
            t = cv2.resize(t, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LANCZOS4)
        w = (ramp(y1 - y0, p['top'] * scale, p['bottom'] * scale, band)[:, None] * ramp(x1 - x0, p['left'] * scale, p['right'] * scale, band)[None, :])[..., None]
        acc[y0:y1, x0:x1] += t.astype(np.float32) * w
        wsum[y0:y1, x0:x1] += w
    return np.clip(acc / np.maximum(wsum, 1e-6) + 0.5, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--scale', type=int, choices=(2, 4), default=2)
    ap.add_argument('--piece-out', type=int, choices=(2048, 4096), default=4096)
    a = ap.parse_args()

    files = os.environ.get('PARALLX_RUNTIME_FILES', '')
    for name in (DIT, VAE):
        if not os.path.isfile(os.path.join(files, name)):
            fail('The Enhance engine is missing a model file. Set it up again from the Enhance tool.')

    say(stage='read')
    img, alpha = read(a.input)
    height, width = img.shape[:2]
    piece = max(256, a.piece_out // a.scale)
    pieces = plan(width, height, piece)
    say(stage='plan', pieces=len(pieces), width=width * a.scale, height=height * a.scale)

    work = tempfile.mkdtemp(prefix='enhance-')
    try:
        indir, outdir = os.path.join(work, 'in'), os.path.join(work, 'out')
        os.makedirs(indir)
        os.makedirs(outdir)
        for p in pieces:
            write(os.path.join(indir, p['name']), img[p['y0']:p['y1'], p['x0']:p['x1']])
        short = min(pieces[0]['x1'] - pieces[0]['x0'], pieces[0]['y1'] - pieces[0]['y0'])
        cmd = [sys.executable, CLI, indir, '--output', outdir, '--output_format', 'png',
               '--dit_model', DIT, '--model_dir', files, '--resolution', str(short * a.scale),
               '--batch_size', '1', '--seed', '42', '--color_correction', 'lab',
               '--cache_dit', '--cache_vae', '--dit_offload_device', 'cpu', '--vae_offload_device', 'cpu',
               '--vae_encode_tiled', '--vae_decode_tiled']
        say(stage='enlarge', done=0, total=len(pieces))
        tail = []
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=os.path.dirname(CLI),
                                text=True, encoding='utf-8', errors='replace')
        for line in proc.stdout:
            tail = (tail + [line.rstrip()])[-40:]
            m = re.search(r'Processing file (\d+)/(\d+)', line)
            if m:
                say(stage='enlarge', done=int(m.group(1)) - 1, total=int(m.group(2)))
        code = proc.wait()
        said = '\n'.join(tail)
        if code != 0 or len([n for n in os.listdir(outdir) if n.endswith('.png')]) < len(pieces):
            if re.search(r'out of memory|OutOfMemory|CUDA error: out', said, re.I):
                fail('The graphics card ran out of memory. Close programs that use it (a loaded Ollama model, a game) and try again.')
            last = [l for l in tail if 'ERROR' in l or 'Error' in l]
            fail('The enlargement stopped: ' + (re.sub(r'^\[[^\]]*\]\s*\S*\s*', '', last[-1]) if last else f'code {code}.'))
        say(stage='enlarge', done=len(pieces), total=len(pieces))

        say(stage='join')
        out = join(pieces, outdir, a.scale, width, height, max(32, round(piece * OVERLAP)) * a.scale)
        if alpha is not None:
            up = cv2.resize(alpha, (out.shape[1], out.shape[0]), interpolation=cv2.INTER_LANCZOS4)
            out = np.dstack([out, up])
        write(a.output, out)
        say(stage='done', width=int(out.shape[1]), height=int(out.shape[0]))
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
