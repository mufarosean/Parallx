"""Enlarge many pieces with the model loaded once (enhance_batch.py runs this).

    python enlarge_many.py <inference_cli.py's options, without an input>

SeedVR2's command line loads the model each time it starts, and takes one
--resolution for a whole folder, while the pieces of different pictures
differ in size. So this runs SeedVR2's own per-file step, process_single_file,
in one process, with the runner cache that command line keeps for a folder:
the model loads at the first piece and stays loaded to the last.

stdin: one JSON object per line, {"photo", "input", "output", "resolution"},
until it closes. After each piece, one line on stdout:
    PARALLX-PIECE {"photo": i, "ok": true}
    PARALLX-PIECE {"photo": i, "ok": false, "error": "..."}
Once a piece of a picture fails, that picture's other pieces are skipped
(reported as failed), and the other pictures go on.
"""

import gc
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEEDVR2 = os.path.join(HERE, 'seedvr2')
CLI = os.path.join(SEEDVR2, 'inference_cli.py')


def report(photo, ok, error=None):
    r = {'photo': photo, 'ok': ok}
    if not ok:
        r['error'] = error or 'A piece failed.'
    print('PARALLX-PIECE ' + json.dumps(r), flush=True)


def main():
    # inference_cli reads its options from sys.argv; each piece names its own input.
    sys.argv = [CLI, SEEDVR2, *sys.argv[1:]]
    if SEEDVR2 not in sys.path:
        sys.path.insert(0, SEEDVR2)
    import inference_cli as cli

    args = cli.parse_arguments()
    cli.debug.enabled = args.debug
    if not cli.download_weight(dit_model=args.dit_model, vae_model=cli.DEFAULT_VAE, model_dir=args.model_dir, debug=cli.debug):
        print('ERROR: the model files could not be found.', flush=True)
        sys.exit(1)
    cache = {}  # what inference_cli keeps across a folder's files: the loaded model
    failed = set()
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        job = json.loads(line)
        photo = job['photo']
        if photo in failed:
            report(photo, False, 'skipped')
            continue
        try:
            args.resolution = int(job['resolution'])
            cli.process_single_file(job['input'], args, ['0'], job['output'], format_auto_detected=False, runner_cache=cache)
            if not os.path.isfile(job['output']):
                raise RuntimeError('A piece of the picture was not enlarged.')
            report(photo, True)
        except Exception as e:  # one piece; the pictures after it go on
            failed.add(photo)
            print(f'ERROR: {e}', flush=True)
            report(photo, False, str(e))
            gc.collect()
            try:
                cli.torch.cuda.empty_cache()
            except Exception:
                pass


if __name__ == '__main__':
    main()
