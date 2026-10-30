"""Enhance, many pictures in one run: the model loads once for all of them.

    python enhance.py --jobs JOBS.json --scale 2 --piece-out 4096 --work-dir DIR

JOBS.json is a list of {"input": ..., "output": ...}. Each picture is cut into
pieces as enhance.py cuts one, into its own folder in the work folder
(p0000, p0001, ...). enlarge_many.py enlarges the pieces of every picture in
one process, with the model kept loaded, taking them from its stdin as they
are cut. A picture is cut while the one before it is enlarged, and at most
two are waiting on disk. Each is joined once its last piece is back, and
written beside its output under ".part" first, then renamed, so a stopped
run never leaves half a picture under the real name.

Progress, one JSON object per line on stdout:
  {"stage": "read"}
  {"stage": "enlarge", "photo": i, "done": k, "total": n}  (the photo the engine is on)
  {"stage": "join", "photo": i}
  {"stage": "photo", "photo": i, "ok": true, "work": DIR}
  {"stage": "photo", "photo": i, "ok": false, "error": "...", "work": DIR}
  {"stage": "done"}
A failure in one picture is reported for that picture and the rest go on.
"work" is that picture's folder of pieces, for Parallx to remove the user's
way. When the engine itself stops, every picture not yet reported fails
with its reason, then the run fails as enhance.py does (exit code 2).
"""

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading

from enhance import HERE, OVERLAP, Problem, engine_options, fail, finish, join, plan, read, say, why_stopped, write

DRIVER = os.path.join(HERE, 'enlarge_many.py')
SEEDVR2 = os.path.join(HERE, 'seedvr2')
PIECE_LINE = 'PARALLX-PIECE '
AHEAD = 2  # pictures cut and waiting for the engine, at most
OOM = re.compile(r'out of memory|OutOfMemory|CUDA error: out', re.I)


def piece_failure(error):
    """The sentence for one piece the engine could not enlarge."""
    if OOM.search(error or ''):
        return why_stopped(1, error)
    first = (error or '').strip().splitlines()
    return 'The enlargement stopped: ' + (first[0] if first else 'a piece failed.')


def load_jobs(path):
    try:
        with open(path, encoding='utf-8') as f:
            jobs = json.load(f)
    except (OSError, ValueError):
        raise Problem('The list of pictures could not be read.')
    if not isinstance(jobs, list) or not all(isinstance(j, dict) and j.get('input') and j.get('output') for j in jobs):
        raise Problem('The list of pictures could not be read.')
    return jobs


class Batch:
    """What is known about each picture, shared by the three threads under one lock."""

    def __init__(self, jobs, scale, piece, work):
        self.jobs, self.scale, self.piece, self.work = jobs, scale, piece, work
        self.lock = threading.Lock()
        self.photos = {}       # i -> {'pieces', 'width', 'height', 'alpha', 'left', 'error', 'dir'}
        self.fed = []          # pictures whose pieces went to the engine, in order
        self.reported = set()  # pictures already reported ok or failed
        self.slots = threading.Semaphore(AHEAD)
        self.stop = threading.Event()
        self.joins = queue.Queue()

    def folder(self, i):
        return os.path.join(self.work, f'p{i:04d}')

    def report(self, i, ok, error=None):
        with self.lock:
            if i in self.reported:
                return
            self.reported.add(i)
            self.photos.pop(i, None)
        extra = {} if ok else {'error': error or 'The enlargement failed.'}
        say(stage='photo', photo=i, ok=ok, work=self.folder(i), **extra)

    def announce(self):
        """Say which picture the engine is on: the first fed one with pieces still out."""
        for i in self.fed:
            p = self.photos.get(i)
            if p and p['left'] > 0:
                total = len(p['pieces'])
                say(stage='enlarge', photo=i, done=total - p['left'], total=total)
                return


def feed(batch, stdin):
    """Cut each picture into its folder and hand its pieces to the engine, two pictures ahead at most."""
    try:
        for i, job in enumerate(batch.jobs):
            while not batch.slots.acquire(timeout=0.5):
                if batch.stop.is_set():
                    return
            if batch.stop.is_set():
                return
            folder = batch.folder(i)
            try:
                img, alpha = read(job['input'])
                height, width = img.shape[:2]
                pieces = plan(width, height, batch.piece)
                indir, outdir = os.path.join(folder, 'in'), os.path.join(folder, 'out')
                os.makedirs(indir, exist_ok=True)
                os.makedirs(outdir, exist_ok=True)
                for p in pieces:
                    write(os.path.join(indir, p['name']), img[p['y0']:p['y1'], p['x0']:p['x1']])
                del img
            except Problem as p:
                batch.report(i, False, str(p))
                batch.slots.release()
                continue
            except OSError:
                batch.report(i, False, 'The pieces of the picture could not be written.')
                batch.slots.release()
                continue
            except Exception:  # a damaged file OpenCV gives up on, or too little memory
                batch.report(i, False, 'The picture could not be read.')
                batch.slots.release()
                continue
            short = min(pieces[0]['x1'] - pieces[0]['x0'], pieces[0]['y1'] - pieces[0]['y0'])
            with batch.lock:
                batch.photos[i] = {'pieces': pieces, 'width': width, 'height': height, 'alpha': alpha,
                                   'left': len(pieces), 'error': None, 'dir': outdir}
                batch.fed.append(i)
                batch.announce()
            lines = [json.dumps({'photo': i, 'resolution': short * batch.scale,
                                 'input': os.path.join(indir, p['name']), 'output': os.path.join(outdir, p['name'])})
                     for p in pieces]
            stdin.write('\n'.join(lines) + '\n')
            stdin.flush()
    except (BrokenPipeError, OSError, ValueError):
        batch.stop.set()  # the engine is gone; the main thread reports what is left
    finally:
        try:
            stdin.close()
        except OSError:
            pass


def joiner(batch):
    """Join each picture whose pieces are all back, write it, and free its place for the next one."""
    while True:
        i = batch.joins.get()
        if i is None:
            return
        with batch.lock:
            p = batch.photos.get(i)
        try:
            if not p:
                continue
            say(stage='join', photo=i)
            band = max(32, round(batch.piece * OVERLAP)) * batch.scale
            out = finish(join(p['pieces'], p['dir'], batch.scale, p['width'], p['height'], band), p['alpha'])
            output = batch.jobs[i]['output']
            part = output + '.part'
            write(part, out)
            del out
            os.replace(part, output)
            batch.report(i, True)
        except Problem as e:
            batch.report(i, False, str(e))
        except OSError:
            batch.report(i, False, 'The enlarged picture could not be written.')
        except MemoryError:
            batch.report(i, False, 'There was not enough memory to join the picture.')
        except Exception:
            batch.report(i, False, 'The pieces could not be joined.')
        finally:
            batch.slots.release()


def piece_back(batch, line):
    """One `PARALLX-PIECE {...}` line from the engine: count it against its picture."""
    try:
        r = json.loads(line[len(PIECE_LINE):])
        i = int(r['photo'])
    except (ValueError, KeyError, TypeError):
        return
    complete = None
    with batch.lock:
        p = batch.photos.get(i)
        if not p:
            return
        p['left'] -= 1
        if not r.get('ok') and not p['error']:
            p['error'] = piece_failure(r.get('error'))
        if p['left'] <= 0:
            complete = p
        batch.announce()
    if complete is None:
        return
    if complete['error']:
        batch.report(i, False, complete['error'])
        batch.slots.release()
    else:
        batch.joins.put(i)


def run(a, files):
    # enhance.py runs as __main__, so its Problem is not this module's: a failure here ends the run here.
    try:
        jobs = load_jobs(a.jobs)
    except Problem as p:
        fail(str(p))
    own = not a.work_dir
    work = tempfile.mkdtemp(prefix='enhance-') if own else a.work_dir
    batch = Batch(jobs, a.scale, max(256, a.piece_out // a.scale), work)
    say(stage='read')
    # The resolution here is a stand-in: every piece carries its own (pictures differ in size).
    cmd = [sys.executable, DRIVER, *engine_options(files, batch.piece * a.scale)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=SEEDVR2,
                            text=True, encoding='utf-8', errors='replace')
    feeder = threading.Thread(target=feed, args=(batch, proc.stdin), daemon=True)
    joining = threading.Thread(target=joiner, args=(batch,), daemon=True)
    feeder.start()
    joining.start()
    tail = []
    for line in proc.stdout:
        if line.startswith(PIECE_LINE):
            piece_back(batch, line.strip())
        else:
            tail = (tail + [line.rstrip()])[-40:]
    code = proc.wait()
    batch.stop.set()
    batch.joins.put(None)
    joining.join()
    feeder.join(timeout=5)
    if own:
        shutil.rmtree(work, ignore_errors=True)
    left = [i for i in range(len(jobs)) if i not in batch.reported]
    if left:
        reason = why_stopped(code, '\n'.join(tail))
        for i in left:
            batch.report(i, False, reason)
        fail(reason)
    say(stage='done')
