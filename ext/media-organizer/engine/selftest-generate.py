"""Generate's self-test: the last step of setting up its runtime.

Checks the graphics card is usable from PyTorch, then makes one small edit
the whole way (model files laid out, model loaded, a patch written), so a
set-up is called ready only when Generate has really worked on this machine.
"""

import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    import torch
    if not torch.cuda.is_available():
        print('GENERATE-ERROR: PyTorch cannot use the graphics card (CUDA is not available).', file=sys.stderr)
        sys.exit(2)
    work = tempfile.mkdtemp(prefix='generate-selftest-')
    y, x = np.mgrid[0:512, 0:512]
    Image.fromarray(np.dstack([(x // 2) % 256, (y // 2) % 256, ((x + y) // 4) % 256]).astype(np.uint8)).save(os.path.join(work, 'in.png'))
    mask = Image.new('L', (512, 512), 0)
    mask.paste(255, (192, 192, 320, 320))
    mask.save(os.path.join(work, 'mask.png'))
    job = os.path.join(work, 'job.json')
    with open(job, 'w', encoding='utf-8') as f:
        json.dump({'input': os.path.join(work, 'in.png'), 'mask': os.path.join(work, 'mask.png'),
                   'instruction': 'Paint a small red circle in the middle.', 'output': os.path.join(work, 'out'), 'steps': 4}, f)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'generate.py'), '--job', job],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        said = (r.stderr or r.stdout).strip()
        print(said.splitlines()[-1] if said else 'GENERATE-ERROR: The test edit failed.', file=sys.stderr)
        sys.exit(2)
    try:
        patch = Image.open(os.path.join(work, 'out', 'try-1.png'))
        with open(os.path.join(work, 'out', 'result.json'), encoding='utf-8') as f:
            result = json.load(f)
    except (OSError, ValueError):
        print('GENERATE-ERROR: The test edit wrote no patch.', file=sys.stderr)
        sys.exit(2)
    box = result.get('box') or [0, 0, 0, 0]
    if patch.mode != 'RGBA' or patch.size != (box[2] - box[0], box[3] - box[1]):
        print('GENERATE-ERROR: The test patch came out the wrong shape.', file=sys.stderr)
        sys.exit(2)
    print('{"selftest":"ok","gpu":"%s","peak_gb":%s}' % (torch.cuda.get_device_name(0).replace('"', ''), result.get('peak_gb', 0)))


if __name__ == '__main__':
    main()
