"""Generate's self-test: the last step of setting up its runtime.

Checks the graphics card is usable from PyTorch, then makes one small edit
the whole way (model files laid out, model loaded, the instruction written
out, the picture held outside the mark, a patch written), so a set-up is
called ready only when Generate has really worked on this machine.
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
        with open(os.path.join(work, 'out', 'result.json'), encoding='utf-8') as f:
            result = json.load(f)
        made = result['tries'][0]
        patch = Image.open(os.path.join(work, 'out', made['file']))
        Image.open(os.path.join(work, 'out', made['small'])).load()
    except (OSError, ValueError, KeyError, IndexError):
        print('GENERATE-ERROR: The test edit wrote no patch.', file=sys.stderr)
        sys.exit(2)
    box = made.get('box') or [0, 0, 0, 0]
    # The patch is the marked square and its edge, at the picture's own pixels, and nothing like the whole picture.
    covers = box[0] <= 192 and box[1] <= 192 and box[2] >= 320 and box[3] >= 320
    if patch.mode != 'RGBA' or patch.size != (box[2] - box[0], box[3] - box[1]) or not covers or patch.size[0] > 320 or patch.size[1] > 320:
        print('GENERATE-ERROR: The test patch came out the wrong shape.', file=sys.stderr)
        sys.exit(2)
    print(json.dumps({'selftest': 'ok', 'gpu': torch.cuda.get_device_name(0), 'peak_gb': result.get('peak_gb', 0),
                      'held_db': made.get('held_db'), 'prompt_by': result.get('prompt_by'), 'prompt': result.get('prompt'), 'note': result.get('note')}))


if __name__ == '__main__':
    main()
