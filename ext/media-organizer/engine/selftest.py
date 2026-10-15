"""Enhance's self-test: the last step of setting up its runtime.

Checks the graphics card is usable from PyTorch, then enlarges a small made-up
picture the whole way (pieces, model, join), so a setup is called ready only
when Enhance has really worked on this machine.
"""

import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    import torch
    if not torch.cuda.is_available():
        print('ENHANCE-ERROR: PyTorch cannot use the graphics card (CUDA is not available).', file=sys.stderr)
        sys.exit(2)
    work = tempfile.mkdtemp(prefix='enhance-selftest-')
    src = os.path.join(work, 'in.png')
    out = os.path.join(work, 'out.png')
    import cv2
    y, x = np.mgrid[0:256, 0:256]
    img = np.dstack([(x % 64) * 4, (y % 32) * 8, ((x + y) % 128) * 2]).astype(np.uint8)
    ok, enc = cv2.imencode('.png', img)
    enc.tofile(src)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'enhance.py'), '--input', src, '--output', out, '--scale', '2', '--piece-out', '2048'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else 'The test enlargement failed.', file=sys.stderr)
        sys.exit(2)
    got = cv2.imdecode(np.fromfile(out, dtype=np.uint8), cv2.IMREAD_COLOR)
    if got is None or got.shape[:2] != (512, 512):
        print('ENHANCE-ERROR: The test enlargement came out the wrong size.', file=sys.stderr)
        sys.exit(2)
    print('{"selftest":"ok","gpu":"%s"}' % torch.cuda.get_device_name(0).replace('"', ''))


if __name__ == '__main__':
    main()
