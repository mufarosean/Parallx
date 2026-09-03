/**
 * The clip editor's pure math, extracted verbatim from the extension (the
 * @mo-pure region): escaping, captions, blur graphs, audio finish, dead-air
 * parsing and segmentation, smart-zoom keys, follow-the-box keys, stage dims
 * and the assembly graph's shape. The ffmpeg probe (tests/probes/
 * clip-graph-probe.mjs) runs the same region against the real encoder.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPure(): Record<string, any> {
  const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  const a = src.indexOf('// @mo-pure-begin');
  const b = src.indexOf('// @mo-pure-end');
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const names = ['MO_CLIP_FILTERS', 'moClipFilterVf', 'moCropKeysAt', 'moCropVfSegment', 'moSimplifyTrackKeys', 'moFfEscapeText', 'moFfEscapePath',
    'moCaptionVf', 'moCaptionsVf', 'moBlurRegionsGraph', 'moAudioFxAf', 'moParseDetectLog', 'moDeadAirSegments', 'moSmartZoomKeys',
    'moBoxTrackToKeys', 'moStageOutputDims', 'moEndCardInputs', 'moSegmentsGraph'];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(src.slice(a, b) + `\nreturn { ${names.join(', ')} };`)();
}
const P = loadPure();

describe('looks', () => {
  it('soft looks lift the OUTPUT floor, never crush the input', () => {
    for (const id of ['pastel', 'fade', 'vintage']) {
      const vf = P.moClipFilterVf(id) as string;
      expect(vf).toContain('romin=');
      expect(vf).not.toMatch(/\brimin=/);
    }
  });
});

describe('drawtext escaping', () => {
  it('neutralizes the characters drawtext and the filtergraph parse', () => {
    expect(P.moFfEscapeText("it's 100%: done\\")).toBe('it\u2019s 100%%\\: done\\\\');
    expect(P.moFfEscapePath('C:\\Windows\\Fonts\\arial.ttf')).toBe('C\\:/Windows/Fonts/arial.ttf');
  });
  it('a caption is a drawtext segment with a time window and a font', () => {
    const vf = P.moCaptionVf({ text: 'Hello', style: 'lower', t0: 1, t1: 2.5 }, 'C:/f.ttf');
    expect(vf.startsWith('drawtext=')).toBe(true);
    expect(vf).toContain("fontfile='C\\:/f.ttf'");
    expect(vf).toContain("enable='between(t,1.000,2.500)'");
    expect(vf).toContain('boxcolor=black@0.6');
    expect(P.moCaptionsVf([{ text: '   ' }], '')).toEqual([]);
  });
});

describe('blur regions graph', () => {
  it('chains split/crop/blur/overlay per region and honours keys and time windows', () => {
    const g = P.moBlurRegionsGraph([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2, mode: 'blur', strength: 4 },
      { x: 0.5, y: 0.5, w: 0.2, h: 0.2, mode: 'pixelate', strength: 5, t0: 1.5, t1: 3, keys: [{ t: 1, x: 0.5, y: 0.5 }, { t: 3, x: 0.6, y: 0.6 }] },
    ], 'in', 'out', 1);
    expect(g).toContain('[in]split[ins0a][ins0b]');
    expect(g).toContain('boxblur=luma_radius=8');
    expect(g).toContain('pixelize=');
    expect(g).toContain("enable='between(t,0.500,2.000)'"); // rebased to the 1 s in-point
    expect(g).toContain('isnan(t)');                          // keyed x/y expression
    expect(g.endsWith('[out]')).toBe(true);
    expect(P.moBlurRegionsGraph([], 'a', 'b', 0)).toBe('');
  });
});

describe('audio finish', () => {
  it('builds fades within the clip, denoise, and loudness', () => {
    expect(P.moAudioFxAf({ fadeIn: 0.5, fadeOut: 1, denoise: true, normalize: true }, 4))
      .toBe('afftdn=nf=-25,afade=t=in:st=0:d=0.500,afade=t=out:st=3.000:d=1.000,loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(P.moAudioFxAf({ fadeIn: 5 }, 2)).toBe('afade=t=in:st=0:d=1.000'); // capped at half the clip
    expect(P.moAudioFxAf(null, 4)).toBe('');
  });
});

describe('dead air', () => {
  const log = [
    '[silencedetect @ 0x1] silence_start: 2.9',
    '[silencedetect @ 0x1] silence_end: 5.1 | silence_duration: 2.2',
    '[Parsed_metadata_1 @ 0x2] lavfi.freezedetect.freeze_start=3.0',
    '[Parsed_metadata_1 @ 0x2] lavfi.freezedetect.freeze_end=5.0',
    '[silencedetect @ 0x1] silence_start: 7.5',
  ].join('\n');
  it('parses silence and freeze ranges, offset by the pass start, with open tails', () => {
    const d = P.moParseDetectLog(log, 10);
    expect(d.silences).toEqual([{ s: 12.9, e: 15.1 }]);
    expect(d.freezes).toEqual([{ s: 13, e: 15 }]);
    expect(d.openSilence).toBe(17.5);
  });
  it('keeps what is not both silent and frozen, padded, and drops slivers', () => {
    const d = P.moParseDetectLog(log, 0);
    const { keep, cuts } = P.moDeadAirSegments(d, 0, 8, { mode: 'both' });
    expect(cuts).toEqual([{ s: 3.15, e: 4.85 }]);
    expect(keep).toEqual([{ in: 0, out: 3.15 }, { in: 4.85, out: 8 }]);
    const sil = P.moDeadAirSegments(d, 0, 8, { mode: 'silence' });
    // silence 2.9–5.1 padded to 3.05–4.95; the open silence at 7.5 leaves a
    // 0.35 s padded tail, under minCut, so it is not a cut.
    expect(sil.cuts.length).toBe(1);
    expect(sil.cuts[0].s).toBeCloseTo(3.05, 6);
    expect(sil.cuts[0].e).toBeCloseTo(4.95, 6);
    expect(sil.keep.length).toBe(2);
  });
});

describe('smart zoom keys', () => {
  it('zooms to dwells, returns to full frame, pans between close dwells', () => {
    const track: { t: number; x: number; y: number }[] = [];
    for (let t = 0; t <= 6; t += 1 / 30) {
      // travel for the first second, then dwell A, travel, dwell B, wander
      const p = t < 1 ? { x: t * 0.2, y: t * 0.3 } : t < 2.5 ? { x: 0.2, y: 0.3 } : t < 3.1 ? { x: 0.2 + (t - 2.5), y: 0.3 } : t < 5 ? { x: 0.7, y: 0.6 } : { x: 0.7 - (t - 5) * 0.3, y: 0.6 };
      track.push({ t, ...p });
    }
    const keys = P.moSmartZoomKeys(track, { aspect: 1 });
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(keys[0]).toMatchObject({ t: 0, w: 1 });
    expect(keys.some((k: any) => k.w < 1 && Math.abs(k.x - (0.2 - 0.275)) < 0.3)).toBe(true);
    expect(keys[keys.length - 1].w).toBe(1); // ends on the full frame
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t);
    expect(P.moSmartZoomKeys([{ t: 0, x: 0.5, y: 0.5 }], {})).toEqual([]);
  });
});

describe('follow-the-box keys', () => {
  it('a moving frame becomes a base plus keys; a still frame a static crop', () => {
    const box = [];
    for (let t = 0; t <= 4; t += 0.1) box.push({ t, x: 0.1 + t * 0.05, y: 0.1, w: 0.5, h: 0.5 });
    const fb = P.moBoxTrackToKeys(box);
    expect(fb.cropBase).toEqual({ w: 0.5, h: 0.5 });
    expect(fb.cropKeys.length).toBeGreaterThanOrEqual(2);
    expect(fb.cropKeys.length).toBeLessThanOrEqual(80);
    const still = P.moBoxTrackToKeys([{ t: 0, x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, { t: 1, x: 0.2, y: 0.2, w: 0.5, h: 0.5 }]);
    expect(still.cropKeys).toEqual([]);
    expect(P.moBoxTrackToKeys([])).toBeNull();
  });
});

describe('assembly', () => {
  it('stage dims follow crop and scale with even sizes', () => {
    expect(P.moStageOutputDims({ srcW: 640, srcH: 360, scalePct: 100 })).toEqual({ w: 640, h: 360 });
    expect(P.moStageOutputDims({ srcW: 640, srcH: 360, scalePct: 50, crop: { w: 0.5, h: 0.5 } })).toEqual({ w: 160, h: 90 });
  });
  it('builds trim/concat with audio, blur, crop keys and an end card', () => {
    const g = P.moSegmentsGraph({
      segments: [{ in: 1, out: 2 }, { in: 3, out: 4.5 }], fps: 30, srcW: 640, srcH: 360, scalePct: 100, filter: 'cinematic', withAudio: true,
      crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, cropKeys: [{ t: 1, x: 0, y: 0 }, { t: 2, x: 0.3, y: 0.3 }],
      blurRegions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, mode: 'blur', strength: 3 }],
      endCard: { enabled: true, title: 'Done', seconds: 2 },
    });
    expect(g.filterComplex).toContain('trim=start=1.000:end=2.000');
    expect(g.filterComplex).toContain('atrim=start=3.000:end=4.500');
    expect(g.filterComplex).toContain('concat=n=3:v=1:a=1[vout][aout]');
    expect(g.filterComplex).toContain('[1:v]drawtext=');
    expect(g.filterComplex).toContain('scale=320:180');
    expect(g.extraInputs[3]).toContain('color=c=black:s=320x180');
    expect(g.durationSec).toBeCloseTo(4.5, 5);
    expect(g.mapA).toBe('[aout]');
    expect(() => P.moSegmentsGraph({ segments: [] })).toThrow();
  });
});
