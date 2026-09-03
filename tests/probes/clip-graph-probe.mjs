// clip-graph-probe.mjs — run the clip editor's ffmpeg graphs for real.
//
// The media organizer's pure clip math lives between @mo-pure markers in
// ext/media-organizer/main.js. This probe extracts that region verbatim,
// builds every kind of graph the editor can produce, and runs each through
// the installed ffmpeg on synthetic footage. A graph that parses in a unit
// test but fails in ffmpeg is exactly the class of bug this exists to catch
// ("pastel does nothing" was a valid chain doing the wrong thing).
//
//   node tests/probes/clip-graph-probe.mjs [outDir]
//
// Checks: every look preset parses AND changes the picture in the intended
// direction (soft looks lift the floor), multi-segment assembly with a keyed
// camera crop and an end card yields the expected duration, blur/pixelate
// regions (static + keyed) run, captions draw with a real font, the audio
// finish chain runs, dead-air detection finds the gaps we planted, and smart
// zoom keys drive a zoompan chain that renders.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-clip-probe'));

function loadPure() {
  const src = fsSync.readFileSync(path.join(ROOT, 'ext', 'media-organizer', 'main.js'), 'utf8');
  const a = src.indexOf('// @mo-pure-begin');
  const b = src.indexOf('// @mo-pure-end');
  if (a < 0 || b < 0) throw new Error('pure markers missing');
  const region = src.slice(a, b);
  const names = ['MO_CLIP_FILTERS', 'moClipFilterVf', 'moCropKeysAt', 'moCropKeyExpr', 'moZoomKeyExpr', 'moZoomPadDims', 'moCropVfSegment',
    'moSimplifyTrackKeys', 'moFfEscapeText', 'moFfEscapePath', 'MO_CAPTION_STYLES', 'moCaptionVf', 'moCaptionsVf', 'moBlurRegionsGraph',
    'moAudioFxAf', 'moParseDetectLog', 'moDeadAirSegments', 'moSmartZoomKeys', 'moBoxTrackToKeys', 'moStageOutputDims', 'moEndCardInputs', 'moSegmentsGraph'];
  return new Function(region + `\nreturn { ${names.join(', ')} };`)();
}

function ff(args, { timeoutMs = 120_000, capture = 'stderr' } = {}) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-y', ...args], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.on('exit', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
  });
}
function ffprobe(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type', '-of', 'json', file], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('exit', () => { try { resolve(JSON.parse(out)); } catch { resolve(null); } });
    p.on('error', () => resolve(null));
  });
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function yavg(file, vf, t = 1) {
  // mean luma of one frame after `vf`, via signalstats
  const r = await ff(['-ss', String(t), '-i', file, '-vf', `${vf ? vf + ',' : ''}signalstats,metadata=print:key=lavfi.signalstats.YAVG`, '-frames:v', '1', '-f', 'null', '-']);
  const m = /YAVG=([\d.]+)/.exec(r.err);
  return m ? parseFloat(m[1]) : NaN;
}
async function ymin(file, vf, t = 1) {
  const r = await ff(['-ss', String(t), '-i', file, '-vf', `${vf ? vf + ',' : ''}signalstats,metadata=print:key=lavfi.signalstats.YMIN`, '-frames:v', '1', '-f', 'null', '-']);
  const m = /YMIN=([\d.]+)/.exec(r.err);
  return m ? parseFloat(m[1]) : NaN;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const P = loadPure();
  const font = ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arial.ttf'].find((f) => fsSync.existsSync(f)) || '';

  // ── Synthetic footage: 8 s test pattern with a moving element + tone that
  //    goes silent 3–5 s (planted dead air; the picture also freezes there).
  const src = path.join(OUT, 'src.mp4');
  const mk = await ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8',
    '-filter_complex',
    // freeze the picture 3–5 s (hold one frame) and silence the tone there
    "[0:v]split=3[v1][v2][v3];[v2]trim=start=3:end=3.04,setpts=PTS-STARTPTS,loop=loop=59:size=1:start=0,setpts=N/30/TB[hold];"
    + "[v1]trim=end=3,setpts=PTS-STARTPTS[pre];[v3]trim=start=5,setpts=PTS-STARTPTS[post];"
    + "[pre][hold][post]concat=n=3:v=1:a=0[vout];"
    + "[1:a]volume=enable='between(t,3,5)':volume=0[aout]",
    '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src,
  ]);
  check('synthetic source renders', mk.code === 0, mk.code === 0 ? '' : mk.err.slice(-300));
  if (mk.code !== 0) return finish();

  // ── 1. Looks: every preset parses; soft looks lift the floor.
  const baseMin = await ymin(src, '');
  const baseAvg = await yavg(src, '');
  for (const f of P.MO_CLIP_FILTERS) {
    if (!f.vf) continue;
    const r = await ff(['-ss', '1', '-i', src, '-vf', f.vf, '-frames:v', '1', '-f', 'null', '-']);
    check(`look "${f.label}" parses`, r.code === 0, r.code === 0 ? '' : r.err.slice(-200));
  }
  for (const id of ['pastel', 'fade']) {
    const vf = P.moClipFilterVf(id);
    const mn = await ymin(src, vf);
    check(`look "${id}" lifts the black floor`, mn > baseMin + 4, `YMIN ${baseMin} → ${mn}`);
  }
  {
    // Vintage lifts the floor too, but its vignette darkens the corners, so
    // measure the floor BEFORE the vignette and the picture change after it.
    const vf = P.moClipFilterVf('vintage');
    const mn = await ymin(src, vf.replace(/,vignette$/, ''));
    check('look "vintage" lifts the black floor (pre-vignette)', mn > baseMin + 4, `YMIN ${baseMin} → ${mn}`);
    const av = await yavg(src, vf);
    check('vintage visibly changes the picture', Math.abs(av - baseAvg) > 1.5, `YAVG ${baseAvg} → ${av}`);
  }
  {
    const vf = P.moClipFilterVf('pastel');
    const av = await yavg(src, vf);
    check('pastel visibly changes the picture', Math.abs(av - baseAvg) > 1.5, `YAVG ${baseAvg} → ${av}`);
  }

  // ── 2. Assembly: three segments, keyed camera crop, end card, audio.
  {
    const g = P.moSegmentsGraph({
      segments: [{ in: 0.5, out: 2.0 }, { in: 5.5, out: 6.5 }, { in: 7.0, out: 7.8 }],
      fps: 30, srcW: 640, srcH: 360, scalePct: 100, filter: 'cinematic', withAudio: true,
      crop: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 },
      cropKeys: [{ t: 0.5, x: 0.1, y: 0.1, w: 0.6 }, { t: 2.0, x: 0.3, y: 0.2, w: 0.6 }],
      endCard: { enabled: true, title: 'Siewert: Excess Losses', subtitle: 'Made in Parallx', seconds: 2, bg: '#101418' },
      fontFile: font,
    });
    const out = path.join(OUT, 'assembled.mp4');
    const r = await ff(['-i', src, ...g.extraInputs, '-filter_complex', g.filterComplex, '-map', g.mapV, ...(g.mapA ? ['-map', g.mapA] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out]);
    check('assembly graph renders', r.code === 0, r.code === 0 ? '' : r.err.slice(-400));
    const meta = r.code === 0 ? await ffprobe(out) : null;
    const dur = meta ? parseFloat(meta.format?.duration) : NaN;
    check('assembled duration = segments + end card', Math.abs(dur - g.durationSec) < 0.15, `${dur?.toFixed?.(2)} vs ${g.durationSec.toFixed(2)}`);
    const vs = meta?.streams?.find((s) => s.codec_type === 'video');
    check('assembled size = stage dims', vs && vs.width === g.dims.w && vs.height === g.dims.h, `${vs?.width}x${vs?.height} vs ${g.dims.w}x${g.dims.h}`);
  }

  // ── 2b. Assembly with ZOOM keys (zoompan path) and no audio.
  {
    const g = P.moSegmentsGraph({
      segments: [{ in: 1, out: 3 }], fps: 30, srcW: 640, srcH: 360, scalePct: 100, filter: 'none', withAudio: false,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      cropKeys: [{ t: 1, x: 0, y: 0, w: 1 }, { t: 2, x: 0.2, y: 0.2, w: 0.5 }, { t: 3, x: 0, y: 0, w: 1 }],
    });
    const out = path.join(OUT, 'zoom.mp4');
    const r = await ff(['-i', src, ...g.extraInputs, '-filter_complex', g.filterComplex, '-map', g.mapV, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', out]);
    check('zoom (zoompan) assembly renders', r.code === 0, r.code === 0 ? '' : r.err.slice(-400));
  }

  // ── 3. Blur regions: one static blur, one keyed pixelate, time-limited.
  {
    const g = P.moSegmentsGraph({
      segments: [{ in: 0, out: 2 }], fps: 30, srcW: 640, srcH: 360, scalePct: 100, filter: 'none', withAudio: false,
      blurRegions: [
        { x: 0.1, y: 0.1, w: 0.3, h: 0.3, mode: 'blur', strength: 6 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.25, mode: 'pixelate', strength: 5, t0: 0.5, t1: 1.5,
          keys: [{ t: 0, x: 0.5, y: 0.5 }, { t: 2, x: 0.7, y: 0.6 }] },
      ],
    });
    const out = path.join(OUT, 'blur.mp4');
    const r = await ff(['-i', src, '-filter_complex', g.filterComplex, '-map', g.mapV, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', out]);
    check('blur + keyed pixelate regions render', r.code === 0, r.code === 0 ? '' : r.err.slice(-400));
    // Shapes: an oval blur and a rounded pixelate, feathered, over the same source.
    const gs = P.moSegmentsGraph({
      segments: [{ in: 0, out: 1 }], fps: 30, srcW: 640, srcH: 360, scalePct: 100, filter: 'none', withAudio: false,
      blurRegions: [
        { x: 0.1, y: 0.1, w: 0.3, h: 0.4, mode: 'blur', strength: 8, shape: 'ellipse' },
        { x: 0.55, y: 0.5, w: 0.3, h: 0.3, mode: 'pixelate', strength: 5, shape: 'rounded', feather: 0.2 },
      ],
    });
    const outS = path.join(OUT, 'blur-shapes.mp4');
    const rs = await ff(['-i', src, '-filter_complex', gs.filterComplex, '-map', gs.mapV, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', outS]);
    check('oval + rounded (feathered) regions render', rs.code === 0, rs.code === 0 ? '' : rs.err.slice(-400));
    check('shaped graph carries an alpha mask', /format=yuva420p,geq=.*:a='255\*clip/.test(gs.filterComplex), gs.filterComplex.slice(0, 200));
  }

  // ── 4. Captions on the output timeline (all three styles), with a real font.
  {
    const vfs = P.moCaptionsVf([
      { text: "Title: 'Quotes' & 100% colons:", style: 'title', t0: 0, t1: 1 },
      { text: 'Lower third label', style: 'lower', t0: 0.5, t1: 1.5, color: '#ffd166' },
      { text: 'A caption line', style: 'caption', t0: 1, t1: 2 },
    ], font);
    const out = path.join(OUT, 'captions.mp4');
    const r = await ff(['-ss', '0', '-t', '2', '-i', src, '-vf', ['fps=30', ...vfs].join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out]);
    check('captions render (three styles, escaped text, font file)', r.code === 0, r.code === 0 ? '' : r.err.slice(-400));
  }

  // ── 5. Audio finish chain.
  {
    const af = P.moAudioFxAf({ fadeIn: 0.5, fadeOut: 0.5, denoise: true, normalize: true }, 3);
    const out = path.join(OUT, 'audio.mp4');
    const r = await ff(['-ss', '0', '-t', '3', '-i', src, '-vf', 'fps=30', '-af', af, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out]);
    check('audio finish chain renders', r.code === 0, r.code === 0 ? af : r.err.slice(-300));
  }

  // ── 6. Dead air: find the planted 3–5 s gap.
  {
    const r = await ff(['-ss', '0', '-t', '8', '-i', src, '-af', 'silencedetect=n=-40dB:d=0.5', '-vf', 'freezedetect=n=0.002:d=0.5,metadata=print', '-f', 'null', '-']);
    const det = P.moParseDetectLog(r.err, 0);
    const { keep, cuts } = P.moDeadAirSegments(det, 0, 8, { mode: 'both' });
    const cut = cuts[0];
    check('dead air detected (silence ∩ freeze)', !!cut && Math.abs(cut.s - 3) < 0.4 && Math.abs(cut.e - 5) < 0.4, JSON.stringify({ cuts, silences: det.silences, freezes: det.freezes }));
    check('dead air yields two keep segments', keep.length === 2 && keep[0].in === 0 && Math.abs(keep[1].out - 8) < 0.01, JSON.stringify(keep));
  }

  // ── 7. Smart zoom: synthetic cursor dwells → keys → zoompan render.
  {
    const track = [];
    for (let t = 0; t <= 6; t += 1 / 30) {
      const p = t < 2 ? { x: 0.2 + Math.sin(t * 40) * 0.005, y: 0.3 } // dwell A (tiny jitter)
        : t < 2.6 ? { x: 0.2 + (t - 2) * 0.8, y: 0.3 + (t - 2) * 0.5 }   // travel
        : t < 4.5 ? { x: 0.7 + Math.cos(t * 30) * 0.004, y: 0.6 }      // dwell B
        : { x: 0.7 - (t - 4.5) * 0.3, y: 0.6 };                          // wander
      track.push({ t, x: p.x, y: p.y });
    }
    const keys = P.moSmartZoomKeys(track, { aspect: 1 });
    check('smart zoom produces keys', keys.length >= 4 && keys.some((k) => k.w < 1), `${keys.length} keys`);
    const seg = P.moCropVfSegment({ x: 0, y: 0, w: 1, h: 1 }, keys, 0, { fps: 30, srcW: 640, srcH: 360 });
    const out = path.join(OUT, 'smartzoom.mp4');
    const r = await ff(['-ss', '0', '-t', '6', '-i', src, '-vf', `fps=30,${seg}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-an', out]);
    check('smart zoom keys render through zoompan', r.code === 0, r.code === 0 ? '' : r.err.slice(-300));
  }

  // ── 8. Follow-the-box: a moving frame becomes crop keys that render.
  {
    const box = [];
    for (let t = 0; t <= 4; t += 0.05) box.push({ t, x: 0.1 + t * 0.05, y: 0.1 + Math.sin(t) * 0.05, w: 0.5, h: 0.5 });
    const fb = P.moBoxTrackToKeys(box);
    check('box track → keys', fb && fb.cropKeys.length >= 2 && fb.cropKeys.length <= 80, `${fb?.cropKeys?.length} keys`);
    const seg = P.moCropVfSegment(fb.cropNorm, fb.cropKeys, 0, { fps: 30, srcW: 640, srcH: 360 });
    const r = await ff(['-ss', '0', '-t', '4', '-i', src, '-vf', `fps=30,${seg}`, '-f', 'null', '-']);
    check('follow-the-box keys render', r.code === 0, r.code === 0 ? '' : r.err.slice(-300));
    const still = P.moBoxTrackToKeys([{ t: 0, x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, { t: 3, x: 0.2, y: 0.2, w: 0.5, h: 0.5 }]);
    check('a box that never moved is a static crop', still && still.cropKeys.length === 0);
  }

  return finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Output: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('[clip-probe] crashed:', e); process.exit(2); });
