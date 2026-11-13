// moEnhanceVideo.test.ts — Enhance for a video or a GIF (ext/media-organizer/
// enhance-video.js and the video calls in enhance-engine.js): how the result
// is named, how a stopped run's work folder is found again, what a run costs
// in words, what the script's progress lines mean, and the arguments a run
// is started with.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error — JS module with no types
import { moEnhanceVideoCost, moEnhanceVideoOutputName, moEnhanceVideoTimeWords, moEnhanceVideoWorkName, MO_ENHANCE_VIDEO_CSS } from '../../ext/media-organizer/enhance-video.js';
// @ts-expect-error — JS module with no types
import { moEnhanceVideoArgs, moEnhanceVideoProgress } from '../../ext/media-organizer/enhance-engine.js';

const extDir = join(resolve(__dirname, '..', '..'), 'ext', 'media-organizer');

describe('the result\'s name', () => {
  it('is an MP4 beside the original, whatever the original was', () => {
    expect(moEnhanceVideoOutputName('holiday.mov', 2)).toBe('holiday-2x.mp4');
    expect(moEnhanceVideoOutputName('clip.final.webm', 2)).toBe('clip.final-2x.mp4');
    expect(moEnhanceVideoOutputName('noextension', 2)).toBe('noextension-2x.mp4');
  });
  it('stays a GIF for a GIF', () => {
    expect(moEnhanceVideoOutputName('wave.GIF', 2)).toBe('wave-2x.gif');
  });
  it('counts up when the name is taken', () => {
    expect(moEnhanceVideoOutputName('holiday.mp4', 2, 3)).toBe('holiday-2x (3).mp4');
  });
});

describe('a stopped run\'s work folder', () => {
  it('is the same for the same unchanged clip, so the run is found again', () => {
    expect(moEnhanceVideoWorkName('D:\\clips\\a.mp4', 1000, 1731400000000)).toBe(moEnhanceVideoWorkName('D:\\clips\\a.mp4', 1000, 1731400000000));
  });
  it('differs when the clip changed, for another clip, and for the preview', () => {
    const base = moEnhanceVideoWorkName('D:\\clips\\a.mp4', 1000, 1731400000000);
    expect(moEnhanceVideoWorkName('D:\\clips\\a.mp4', 1001, 1731400000000)).not.toBe(base);
    expect(moEnhanceVideoWorkName('D:\\clips\\a.mp4', 1000, 1731400009000)).not.toBe(base);
    expect(moEnhanceVideoWorkName('D:\\clips\\b.mp4', 1000, 1731400000000)).not.toBe(base);
    expect(moEnhanceVideoWorkName('D:\\clips\\a.mp4', 1000, 1731400000000, 'preview')).not.toBe(base);
  });
  it('is a hidden folder Enhance\'s start-up sweep of photo work folders leaves alone', () => {
    const name = moEnhanceVideoWorkName('D:\\clips\\a.mp4', 1000, 1731400000000);
    expect(name).toMatch(/^\.enhance-video-[a-z0-9]+$/);
    expect(moEnhanceVideoWorkName('D:\\clips\\a.mp4', 1000, 1731400000000, 'preview')).toMatch(/^\.enhance-video-preview-[a-z0-9]+$/);
    expect(/^\.enhance-[a-z0-9]+$/.test(name)).toBe(false);
  });
});

describe('what a run costs', () => {
  it('grows with the frames and with the size of the result', () => {
    const small = moEnhanceVideoCost(120, 1280, 720), large = moEnhanceVideoCost(120, 2560, 1440), long = moEnhanceVideoCost(480, 1280, 720);
    expect(large.seconds).toBeGreaterThan(small.seconds * 3);
    expect(long.seconds).toBeGreaterThan(small.seconds * 3);
    expect(large.needsMiB).toBeGreaterThan(small.needsMiB);
    expect(large.needsMiB).toBeLessThan(32000);
  });
  it('is said in round words', () => {
    expect(moEnhanceVideoTimeWords(42)).toBe('about 40 seconds');
    expect(moEnhanceVideoTimeWords(4)).toBe('about 10 seconds');
    expect(moEnhanceVideoTimeWords(260)).toBe('about 4 minutes');
    expect(moEnhanceVideoTimeWords(4300)).toBe('about 1 hour 10 minutes');
    expect(moEnhanceVideoTimeWords(7200)).toBe('about 2 hours');
  });
});

describe('progress from the script', () => {
  it('names the frame being enlarged', () => {
    expect(moEnhanceVideoProgress({ stage: 'enlarge', done: 60, total: 240, kept: 0 })).toMatchObject({ label: 'Enlarging: frame 60 of 240', done: 60, total: 240 });
  });
  it('says the model is loading before the first frame, and that a kept run is carried on', () => {
    expect(moEnhanceVideoProgress({ stage: 'enlarge', done: 0, total: 240, kept: 0 }).label).toBe('Loading the model');
    expect(moEnhanceVideoProgress({ stage: 'enlarge', done: 80, total: 240, kept: 80 }).label).toBe('Carrying on from frame 80 of 240');
  });
  it('only ever moves forward through a run', () => {
    const steps = [{ stage: 'read' }, { stage: 'plan' }, { stage: 'prepare' }, { stage: 'enlarge', done: 0, total: 100 }, { stage: 'enlarge', done: 50, total: 100 }, { stage: 'enlarge', done: 100, total: 100 }, { stage: 'join' }, { stage: 'done' }]
      .map((d) => moEnhanceVideoProgress(d).fraction);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(steps[steps.length - 1]).toBe(1);
  });
  it('takes a line it does not know as work going on', () => {
    expect(moEnhanceVideoProgress(null)).toEqual({ label: 'Working', fraction: 0 });
    expect(moEnhanceVideoProgress({ stage: 'new' })).toEqual({ label: 'Working', fraction: 0 });
  });
});

describe('a run\'s arguments', () => {
  const job = { input: 'D:\\clips\\a.mp4', output: 'D:\\clips\\a-2x.mp4', scale: 2, workDir: 'D:\\ws\\.enhance-video-x', ffmpeg: 'C:\\tools\\ffmpeg.exe', ffprobe: 'C:\\tools\\ffprobe.exe' };
  it('name the clip, the result, the work folder and the machine\'s ffmpeg', () => {
    expect(moEnhanceVideoArgs(job, false)).toEqual(['--input', job.input, '--output', job.output, '--scale', '2', '--work-dir', job.workDir, '--ffmpeg', job.ffmpeg, '--ffprobe', job.ffprobe]);
  });
  it('carry the preview\'s part of the clip, and ask only for the plan when that is all that is wanted', () => {
    expect(moEnhanceVideoArgs({ ...job, start: 8.5, seconds: 3 }, true).slice(-5)).toEqual(['--start', '8.5', '--seconds', '3', '--plan-only']);
  });
  it('are every argument the script declares as required', () => {
    const script = readFileSync(join(extDir, 'engine', 'enhance_video.py'), 'utf8');
    const required = [...script.matchAll(/add_argument\('(--[a-z-]+)', required=True\)/g)].map((m) => m[1]);
    expect(required.length).toBeGreaterThan(3);
    for (const name of required) expect(moEnhanceVideoArgs(job, false)).toContain(name);
  });
});

describe('the dialog\'s styles', () => {
  it('sit above the app\'s other popups and use the app\'s tokens', () => {
    expect(MO_ENHANCE_VIDEO_CSS).toMatch(/\.mo-ev-overlay \{[^}]*z-index: 10005/);
    expect(MO_ENHANCE_VIDEO_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
