"""Enhance a short video or a GIF: every frame enlarged with SeedVR2 7B sharp.

    python enhance_video.py --input IN --output OUT.mp4 --scale 2 --work-dir DIR
                            --ffmpeg FFMPEG --ffprobe FFPROBE [--start S --seconds N]

Runs in the runtime Parallx installs for Enhance (docs/ENHANCE.md); the model
files are in the folder named by PARALLX_RUNTIME_FILES. SeedVR2 is a video
model: it reads frames in groups, so detail holds still from frame to frame
where a picture-at-a-time enlargement would shimmer.

How a clip goes through:

  1. ffmpeg (the machine's own, named by the caller) makes a plain copy of the
     part asked for: a steady frame rate, no sound, no loss. The engine then
     reads one kind of file whatever the original was (a phone clip with an
     uneven frame rate, a WebM, a GIF).
  2. SeedVR2 enlarges it in chunks and writes each frame as a PNG in the work
     folder. A run that is stopped keeps its frames; the next run on the same
     clip with the same settings carries on from the last whole chunk.
  3. ffmpeg joins the frames into the result, with the original's sound. A
     GIF comes back a GIF.

Progress: one JSON object per line on stdout. A failure: one plain sentence
on stderr after "ENHANCE-ERROR: ", and exit code 2. The work folder holds
copies of the user's video; the caller owns it and removes it.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, 'seedvr2', 'inference_cli.py')
DIT = 'seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors'
VAE = 'ema_vae_fp16.safetensors'

# Measured on an RTX 5090 (docs/ENHANCE.md): groups of 5 with nothing shared showed a jump in fine detail at every
# group's edge (1.6 times the change inside a group); groups of 9 sharing 1 frame showed none, at the same speed.
GROUP = 9            # frames the model enlarges together (its 4n+1 rule)
CONTEXT = 1          # frames a group shares with the next, and a chunk reads again from the one before
CHUNK = 80           # frames per chunk (ten groups): what a stopped run can lose at most. Chunks meet with a
                     # small jump in fine detail (measured: 1.6 times the usual change), so they are few.
MAX_OUT_SIDE = 2560  # the longest side of a result; a larger one is refused in words
TILES_ABOVE = 1_300_000  # pixels in a result's frame above which it goes through in tiles (measured: 1280 x 720 fits whole, 2560 x 1440 does not)
MAX_FRAMES = 3600    # two minutes at 30 frames a second
SOUND_KEPT = ('aac', 'mp3', 'ac3', 'eac3', 'alac', 'opus')  # sound an MP4 can carry as it is


def say(**kw):
    print(json.dumps(kw), flush=True)


class Problem(Exception):
    """A failure the user is told about, in one plain sentence."""


def run(cmd, what):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        last = (r.stderr or r.stdout or '').strip().splitlines()[-1:] or ['']
        raise Problem(f'{what} ({last[0][:160]})')
    return r.stdout


def probe(ffprobe, path):
    """What the clip is: its size as it is shown, its frame rate, its length, its sound."""
    try:
        info = json.loads(run([ffprobe, '-v', 'error', '-show_entries',
                               'stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration,nb_frames:stream_side_data=rotation:stream_tags=rotate:format=duration,format_name',
                               '-of', 'json', path], 'The video could not be read.'))
    except ValueError:
        raise Problem('The video could not be read.')
    video = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), None)
    if not video or not video.get('width'):
        raise Problem('This file has no picture to enhance.')
    sound = next((s for s in info.get('streams', []) if s.get('codec_type') == 'audio'), None)

    def rate(text):
        try:
            n, d = (text or '0/1').split('/')
            return float(n) / float(d) if float(d) else 0.0
        except ValueError:
            return 0.0
    text = video.get('avg_frame_rate') if rate(video.get('avg_frame_rate')) else video.get('r_frame_rate')
    fps = rate(text) or 30.0
    if not 1.0 <= fps <= 60.0 or not rate(text):
        fps = min(60.0, max(1.0, fps))
        text = f'{fps:.6f}'
    turn = 0
    for side in video.get('side_data_list') or []:
        turn = int(float(side.get('rotation', 0) or 0))
    turn = turn or int(float((video.get('tags') or {}).get('rotate', 0) or 0))
    width, height = int(video['width']), int(video['height'])
    if abs(turn) % 180 == 90:
        width, height = height, width
    try:
        seconds = float(video.get('duration') or info.get('format', {}).get('duration') or 0)
    except ValueError:
        seconds = 0.0
    return {'width': width, 'height': height, 'fps': fps, 'rate': text, 'seconds': seconds,
            'sound': sound.get('codec_name') if sound else None,
            'gif': 'gif' in (info.get('format', {}).get('format_name') or '')}


def plan(info, scale, start, seconds):
    """The part asked for and the size of the result, or a Problem saying why not."""
    length = info['seconds'] or 0.0
    start = max(0.0, min(start or 0.0, max(0.0, length - 0.05)))
    span = (length - start) if not seconds else min(seconds, length - start if length else seconds)
    if span <= 0:
        raise Problem('The video has no length that could be read.')
    frames = max(1, int(round(span * info['fps'])))
    if frames > MAX_FRAMES:
        raise Problem(f'This is {span:.0f} seconds of video; Enhance takes up to {MAX_FRAMES / info["fps"]:.0f} seconds at this frame rate. Trim it first.')
    # Even sides: a video's sides are even numbers.
    w, h = info['width'] // 2 * 2, info['height'] // 2 * 2
    if max(w, h) * scale > MAX_OUT_SIDE:
        raise Problem(f'The result would be {w * scale} x {h * scale}; Enhance makes videos up to {MAX_OUT_SIDE} pixels on the long side.')
    return {'start': start, 'seconds': span, 'frames': frames, 'in': [w, h], 'out': [w * scale, h * scale]}


def settings_key(path, scale, p):
    st = os.stat(path)
    text = json.dumps([os.path.abspath(path), st.st_size, int(st.st_mtime), scale, round(p['start'], 3), p['frames'], GROUP, CHUNK, CONTEXT, DIT])
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:24]


def frames_done(folder):
    """How many frames are there from the first without a gap."""
    have = set()
    for name in os.listdir(folder) if os.path.isdir(folder) else []:
        m = re.fullmatch(r'f_(\d{6})\.png', name)
        if m:
            have.add(int(m.group(1)))
    n = 0
    while n in have:
        n += 1
    return n


def enlarge(files, clip, short_out, skip, into, on_line, tiled):
    """SeedVR2 on `clip` from frame `skip` on; its PNG frames land under `into`."""
    cmd = [sys.executable, CLI, clip, '--output', into, '--output_format', 'png', '--dit_model', DIT, '--model_dir', files,
           '--resolution', str(short_out), '--batch_size', str(GROUP), '--uniform_batch_size', '--chunk_size', str(CHUNK),
           '--temporal_overlap', str(CONTEXT), '--seed', '42', '--color_correction', 'lab', '--cache_dit', '--cache_vae']
    if tiled:
        # A large frame is turned to and from the model's own form in tiles, or that step alone fills a 32 GB card.
        cmd += ['--vae_encode_tiled', '--vae_decode_tiled']
    if skip:
        cmd += ['--skip_first_frames', str(skip)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=os.path.dirname(CLI),
                            text=True, encoding='utf-8', errors='replace')
    tail = []
    for line in proc.stdout:
        tail = (tail + [line.rstrip()])[-40:]
        on_line(line)
    return proc.wait(), '\n'.join(tail)


def why_stopped(code, said):
    if re.search(r'out of memory|OutOfMemoryError|CUDA error: out of memory', said, re.I):
        return 'The graphics card ran out of memory. Close what else is using it (a loaded chat model, a game) and try again.'
    return f'The engine stopped before it finished (code {code}).'


def collect(made, frames, first, drop, below=None):
    """Move what a run has written so far (its own numbering, from 0) into the frames folder: its frame `drop`
    becomes frame `first`, and the ones before it (read again only to join the chunks) are left out. With `below`,
    only its frames numbered under that: the ones of chunks that are finished, not one being written now."""
    n = 0
    for folder, _, names in os.walk(made):
        for name in names:
            m = re.search(r'(\d+)\.png$', name)
            if not m:
                continue
            i = int(m.group(1))
            if below is not None and i >= below:
                continue
            if i < drop:
                os.remove(os.path.join(folder, name))
            else:
                os.replace(os.path.join(folder, name), os.path.join(frames, f'f_{first + i - drop:06d}.png'))
                n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--scale', type=int, choices=(2, 4), default=2)
    ap.add_argument('--work-dir', required=True)
    ap.add_argument('--ffmpeg', required=True)
    ap.add_argument('--ffprobe', required=True)
    ap.add_argument('--start', type=float, default=0.0)
    ap.add_argument('--seconds', type=float, default=0.0)
    # Only say what the run would be (sizes, frames), as JSON, and stop: for the dialog.
    ap.add_argument('--plan-only', action='store_true')
    a = ap.parse_args()
    try:
        work(a)
    except Problem as p:
        print('ENHANCE-ERROR: ' + str(p), file=sys.stderr, flush=True)
        sys.exit(2)


def work(a):
    # The engine runs from its own folder: every path is made whole first.
    a.input, a.output, a.work_dir = os.path.abspath(a.input), os.path.abspath(a.output), os.path.abspath(a.work_dir)
    files = os.environ.get('PARALLX_RUNTIME_FILES', '')
    if not a.plan_only:
        for name in (DIT, VAE):
            if not os.path.isfile(os.path.join(files, name)):
                raise Problem('The Enhance engine is missing a model file. Set it up again from the Enhance tool.')
    if not os.path.isfile(a.input):
        raise Problem('The video is not on the disk any more.')
    say(stage='read')
    info = probe(a.ffprobe, a.input)
    p = plan(info, a.scale, a.start, a.seconds)
    say(stage='plan', frames=p['frames'], fps=round(info['fps'], 3), seconds=round(p['seconds'], 2), width=p['out'][0], height=p['out'][1], gif=info['gif'])
    if a.plan_only:
        return

    # The work folder is this clip's, at these settings; anything else in it is from another run.
    os.makedirs(a.work_dir, exist_ok=True)
    key = settings_key(a.input, a.scale, p)
    state_path = os.path.join(a.work_dir, 'state.json')
    frames = os.path.join(a.work_dir, 'frames')
    clip = os.path.join(a.work_dir, 'in.mp4')
    try:
        with open(state_path, encoding='utf-8') as f:
            same = json.load(f).get('key') == key
    except (OSError, ValueError):
        same = False
    if not same:
        for name in os.listdir(a.work_dir):
            path = os.path.join(a.work_dir, name)
            shutil.rmtree(path, ignore_errors=True) if os.path.isdir(path) else os.remove(path)
    os.makedirs(frames, exist_ok=True)
    with open(state_path, 'w', encoding='utf-8') as f:
        json.dump({'key': key, 'frames': p['frames']}, f)

    # 1. A plain copy of the part asked for: steady frame rate, even sides, no sound, no loss.
    if not (same and os.path.isfile(clip)):
        say(stage='prepare')
        part = clip + '.part.mp4'
        cut = (['-ss', f'{p["start"]:.3f}'] if p['start'] else []) + ['-t', f'{p["seconds"]:.3f}']
        run([a.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *cut, '-i', a.input, '-an', '-sn', '-frames:v', str(p['frames']),
             '-vf', f'fps={info["rate"]},scale={p["in"][0]}:{p["in"][1]}:flags=lanczos,setsar=1',
             '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', part], 'The video could not be prepared.')
        os.replace(part, clip)

    # 2. The frames. What a stopped run finished is kept, to the last whole chunk.
    done = frames_done(frames) if same else 0
    done = min(p['frames'], done // CHUNK * CHUNK)
    for name in os.listdir(frames):
        m = re.fullmatch(r'f_(\d{6})\.png', name)
        if not m or int(m.group(1)) >= done:
            os.remove(os.path.join(frames, name))
    total = p['frames']
    say(stage='enlarge', done=done, total=total, kept=done)
    if done < total:
        skip = max(0, done - CONTEXT)
        made = os.path.join(a.work_dir, 'made')
        shutil.rmtree(made, ignore_errors=True)
        os.makedirs(made)
        left = total - skip
        chunks = max(1, -(-left // CHUNK))
        seen = {'chunk': 1, 'phase': 0}

        def on_line(line):
            m = re.search(r'Chunk (\d+)/(\d+)', line)
            if m:
                seen['chunk'], seen['phase'] = int(m.group(1)), 0
                # The chunk before this one is written out whole: it is kept from here on, whatever happens next.
                collect(made, frames, done, done - skip, below=(seen['chunk'] - 1) * CHUNK)
            elif 'Phase 1' in line:
                seen['phase'] = 0
            elif 'Phase 2' in line:
                seen['phase'] = 1
            elif 'Phase 3' in line:
                seen['phase'] = 2
            else:
                return
            # Within a chunk: reading it in is quick, enlarging is about half, turning it back to pictures the rest.
            within = (0.05, 0.2, 0.65)[seen['phase']]
            at = skip + min(left, (seen['chunk'] - 1 + within) * CHUNK)
            say(stage='enlarge', done=int(max(done, min(total, at))), total=total, kept=done)

        short_out = min(p['out'])
        code, said = enlarge(files, clip, short_out, skip, made, on_line, p['out'][0] * p['out'][1] > TILES_ABOVE)
        if code == 0:
            collect(made, frames, done, done - skip)
        else:
            # What the engine last said, for whoever looks into a failure. It names no file of the user's but this folder's.
            with open(os.path.join(a.work_dir, 'engine-last.log'), 'w', encoding='utf-8') as f:
                f.write(said)
        shutil.rmtree(made, ignore_errors=True)
        if code == 0 and os.path.exists(os.path.join(a.work_dir, 'engine-last.log')):
            os.remove(os.path.join(a.work_dir, 'engine-last.log'))
        have = frames_done(frames)
        if code != 0 or have < total:
            if code == 0:
                raise Problem(f'The engine made {have} of {total} frames and stopped.')
            raise Problem(why_stopped(code, said))
    say(stage='enlarge', done=total, total=total, kept=done)

    # 3. The result: the frames joined, with the original's sound.
    say(stage='join')
    out = a.output
    # Written in the work folder and moved when whole: a run stopped here leaves nothing beside the original.
    part = os.path.join(a.work_dir, 'result' + os.path.splitext(out)[1])
    source = ['-framerate', info['rate'], '-start_number', '0', '-i', os.path.join(frames, 'f_%06d.png')]
    if out.lower().endswith('.gif'):
        run([a.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *source, '-frames:v', str(total),
             '-filter_complex', '[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
             '-loop', '0', part], 'The GIF could not be written.')
    else:
        cut = (['-ss', f'{p["start"]:.3f}'] if p['start'] else []) + ['-t', f'{p["seconds"]:.3f}']
        sound = ['-c:a', 'copy'] if info['sound'] in SOUND_KEPT else ['-c:a', 'aac', '-b:a', '192k']
        run([a.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *source, *cut, '-i', a.input, '-map', '0:v:0', '-map', '1:a:0?',
             '-frames:v', str(total), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', *sound,
             '-movflags', '+faststart', part], 'The video could not be written.')
    try:
        os.replace(part, out)
    except OSError:
        # Another disk: copied there under a name of its own first, so the result appears whole.
        beside = os.path.join(os.path.dirname(out), '.' + os.path.basename(out) + '.part')
        shutil.copyfile(part, beside)
        os.replace(beside, out)
        os.remove(part)
    say(stage='done', width=p['out'][0], height=p['out'][1], frames=total)


if __name__ == '__main__':
    main()
