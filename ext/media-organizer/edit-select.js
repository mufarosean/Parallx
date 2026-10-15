// edit-select.js — masks chosen by models on this computer (docs/IMAGE_EDITOR_MASKS.md, step 2).
// Four ways, each a part of a mask:
//   Subject (and Background, its inverse)  BiRefNet: the person or main thing, hair and all
//   Object                                 SAM 2.1 small: click a thing, Shift to take away, or drag a box
//   Words (and Sky)                        CLIPSeg says roughly where a word is; SAM draws its edge
//   Distance                               Depth Anything V2 small: how far each part is
// Every model runs through Parallx's model runner (window.parallxElectron 'models:*', electron/modelBridge.cjs):
// fetched once from huggingface.co, kept only if its SHA-256 matches, run on the graphics card when it can.
// Each was chosen by testing candidates on real photos; the files are pinned to the commits tested.
//
// A result is a field: { w, h, a: Float32Array of 0..1 } over the whole photo, its long side 1024. Edges from SAM
// are snapped to the photo's own edges by a guided filter.

import { moEl } from './dom.js';
import { MO_CLIP_WORDS } from './clip-words.js';

const HF = 'https://huggingface.co';
const file = (repo, commit, path, sha256, bytes, kind) => ({ url: `${HF}/${repo}/resolve/${commit}/${path}`, sha256, bytes, kind: kind || 'model' });
const BIREFNET = file('onnx-community/BiRefNet-ONNX', '534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67', 'onnx/model_fp16.onnx', '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09', 489666272);
const SAM_REPO = ['onnx-community/sam2.1-hiera-small-ONNX', 'a7df49d8de14b9d2e4504d1687b0d568f905fd8d'];
const SAM_ENC = file(...SAM_REPO, 'onnx/vision_encoder.onnx', 'aacf1f7137bb6fffcf6bf166abcfabe28f57a76059254f3fb611c4a64a208119', 467440);
const SAM_ENC_DATA = Object.assign(file(...SAM_REPO, 'onnx/vision_encoder.onnx_data', '260fd1f0a34e72a3dc79a739e563b4facc0ba75504818b433a1f808e66637456', 162476288, 'data'), { name: 'vision_encoder.onnx_data' });
const SAM_DEC = file(...SAM_REPO, 'onnx/prompt_encoder_mask_decoder.onnx', '079c59b261f723ff5c6a125e69b0170a957b21c58738c28d2b0394ecd0587d7f', 213114);
const SAM_DEC_DATA = Object.assign(file(...SAM_REPO, 'onnx/prompt_encoder_mask_decoder.onnx_data', 'f9e59a584ab8ced21fa812c211bc01084204db1c9e92a5ef4fb3a49972b4e864', 20958208, 'data'), { name: 'prompt_encoder_mask_decoder.onnx_data' });
const CLIPSEG = file('Xenova/clipseg-rd64-refined', '924dc94f85f58739f353f94258b33bc47eae4862', 'onnx/model.onnx', '25c50e9a236fa16f309aafd54d363adb7cee9cc7ead8d93cf31a2610f8af4b37', 545422359);
const DEPTH = file('onnx-community/depth-anything-v2-small', '4472b7362082ad9968fee890ca0f1e5aca36b93d', 'onnx/model.onnx', 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c', 99060839);
const SAM_FILES = [SAM_ENC, SAM_ENC_DATA, SAM_DEC, SAM_DEC_DATA];

/** What each way needs, and what a set-up card says about it. */
export const MO_SELECT_MODELS = {
  subject: { title: 'Select Subject', model: 'BiRefNet', does: 'Finds the person or the main thing in the photo, loose hair and all. Background is the same, the other way round.', files: [BIREFNET] },
  object: { title: 'Select Object', model: 'SAM 2.1', does: 'Click a thing in the photo to select it; click again to add, Shift-click to take away, or drag a box round it.', files: SAM_FILES },
  words: { title: 'Select By Words', model: 'CLIPSeg with SAM 2.1', does: 'Type what to select (sky, water, trees, hair) and it finds it, or says it is not there.', files: [CLIPSEG, ...SAM_FILES] },
  distance: { title: 'Select By Distance', model: 'Depth Anything V2', does: 'Selects what is farther away, softly, so a background can be made to recede.', files: [DEPTH] },
};
export const moSelectBytes = (way) => MO_SELECT_MODELS[way].files.reduce((n, f) => n + f.bytes, 0);

/** -> 'ready', 'model' (to fetch: { missing bytes }), 'runtime' (the runner is missing) or 'unavailable'. */
export async function moSelectState(bridge, way) {
  if (!bridge) return { state: 'unavailable' };
  try {
    let missing = 0;
    for (const f of MO_SELECT_MODELS[way].files) {
      const s = await bridge.invoke('models:status', f);
      if (!s || !s.ok) return { state: 'unavailable' };
      if (!s.runtime) return { state: 'runtime' };
      if (!s.present) missing += f.bytes;
    }
    return missing ? { state: 'model', missing } : { state: 'ready' };
  } catch { return { state: 'unavailable' }; }
}
/** Fetch what a way still needs, one file after another. onProgress(received of all, total). */
export async function moSelectSetUp(bridge, way, onProgress) {
  const files = MO_SELECT_MODELS[way].files, total = moSelectBytes(way);
  let done = 0;
  for (const f of files) {
    const s = await bridge.invoke('models:status', f);
    if (s && s.ok && s.present) { done += f.bytes; continue; }
    const off = bridge.on ? bridge.on('models:progress', (p) => { if (p && p.sha256 === f.sha256 && !p.done) onProgress(done + p.received, total); }) : null;
    const r = await bridge.invoke('models:download', f);
    if (typeof off === 'function') off(); else if (off && off.dispose) off.dispose();
    if (!r || !r.ok) return r || { ok: false, error: 'No answer.' };
    done += f.bytes; onProgress(done, total);
  }
  return { ok: true };
}
export const moSelectCancel = (bridge, way) => { for (const f of MO_SELECT_MODELS[way].files) void bridge.invoke('models:cancelDownload', f.sha256); };

// ── pixels in and out ──
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
function pixels(img, w, h) {
  const cv = moEl('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}
function tensor(img, w, h) {
  const px = pixels(img, w, h), t = new Float32Array(3 * w * h);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) t[c * w * h + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  return { data: t, dims: [1, 3, h, w] };
}
/** The field's size for a photo: its shape, long side 1024. */
export function moSelectSize(img) { const k = 1024 / Math.max(img.width, img.height); return { w: Math.max(1, Math.round(img.width * k)), h: Math.max(1, Math.round(img.height * k)) }; }
/** Bilinear resample of a w x h field to W x H. */
export function moFieldResize(a, w, h, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(h - 1, ((y + 0.5) * h) / H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, Math.min(w - 1, ((x + 0.5) * w) / W - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const top = a[y0 * w + x0] + (a[y0 * w + x1] - a[y0 * w + x0]) * tx, bot = a[y1 * w + x0] + (a[y1 * w + x1] - a[y1 * w + x0]) * tx;
      out[y * W + x] = top + (bot - top) * ty;
    }
  }
  return out;
}
// A box mean of radius r over a w x h field (summed-area table).
function boxMean(a, w, h, r) {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += a[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; } }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}
/**
 * A guided filter (He, Sun, Tang): the mask `p` follows the edges of the guide `I` (both w x h, 0..1). A coarse
 * mask from a 256-pixel model lands on the photo's own edges.
 */
export function moGuidedFilter(I, p, w, h, r, eps) {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { const cov = mIp[i] - mI[i] * mp[i], v = mII[i] - mI[i] * mI[i]; A[i] = cov / (v + eps); B[i] = mp[i] - A[i] * mI[i]; }
  const mA = boxMean(A, w, h, r), mB = boxMean(B, w, h, r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(1, mA[i] * I[i] + mB[i]));
  return out;
}
const greyOf = (img, w, h) => { const px = pixels(img, w, h), g = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255; return g; };
const sig = (v) => 1 / (1 + Math.exp(-v));

/**
 * The selector for one photo. bridge: { invoke(channel, ...args) } (the model runner). img: the photo in its own
 * pixels (any CanvasImageSource), the same picture masks are drawn over. SAM's view of the photo is kept for clicks.
 */
export function moSelector(bridge, img) {
  const size = moSelectSize(img);
  let embed = null, grey = null, subjectOnce = null, distanceOnce = null; // found once per photo: Background after Subject costs nothing
  const run = async (f, inputs, data) => {
    const r = await bridge.invoke('models:run', f.sha256, inputs, data ? { data: data.map((d) => ({ sha256: d.sha256, name: d.name })) } : undefined);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The model did not answer.');
    return r.outputs;
  };
  const guide = () => (grey = grey || greyOf(img, size.w, size.h));
  async function sam(points, labels, box) {
    if (!embed) embed = await run(SAM_ENC, { pixel_values: tensor(img, 1024, 1024) }, [SAM_ENC_DATA]);
    const o = await run(SAM_DEC, {
      'image_embeddings.0': embed['image_embeddings.0'], 'image_embeddings.1': embed['image_embeddings.1'], 'image_embeddings.2': embed['image_embeddings.2'],
      input_points: { data: new Float32Array(points.flatMap(([u, v]) => [u * 1024, v * 1024])), dims: [1, 1, points.length, 2] },
      input_labels: { data: BigInt64Array.from(labels.map((l) => BigInt(l))), dims: [1, 1, labels.length] },
      input_boxes: { data: new Float32Array(box ? box.map((v) => v * 1024) : []), dims: [1, box ? 1 : 0, 4] },
    }, [SAM_DEC_DATA]);
    return { iou: o.iou_scores.data, masks: o.pred_masks.data, n: o.pred_masks.dims[2], mh: o.pred_masks.dims[3], mw: o.pred_masks.dims[4] };
  }
  // SAM's answer m (logits, mw x mh) on the photo: resampled, sharpened a little, snapped to the photo's edges.
  const fieldOf = (s, m) => {
    const lg = moFieldResize(s.masks.subarray(m * s.mh * s.mw, (m + 1) * s.mh * s.mw), s.mw, s.mh, size.w, size.h);
    const p = lg.map((v) => sig(v * 6));
    return { ...size, a: moGuidedFilter(guide(), p, size.w, size.h, 4, 2e-4) };
  };
  return {
    size,
    /** The person or main thing. */
    subject() { return (subjectOnce = subjectOnce || this.findSubject().catch((e) => { subjectOnce = null; throw e; })); },
    async findSubject() {
      const o = await run(BIREFNET, { input_image: tensor(img, 1024, 1024) });
      let a = Object.values(o)[0].data, lo = Infinity, hi = -Infinity;
      for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (lo < -0.01 || hi > 1.01) a = a.map(sig);
      return { ...size, a: moFieldResize(a, 1024, 1024, size.w, size.h) };
    },
    /** clicks: [[u, v, 1 to add | 0 to take away]]; box: [u0, v0, u1, v1] or null. Null when nothing is asked. */
    async object(clicks, box) {
      if (!clicks.length && !box) return null;
      const s = await sam(clicks.map(([u, v]) => [u, v]), clicks.map((c) => (c[2] ? 1 : 0)), box);
      let best = 0; for (let i = 1; i < s.n; i++) if (s.iou[i] > s.iou[best]) best = i;
      return fieldOf(s, best);
    },
    /** What a word or a few words name in the photo; null when nothing like it is there. */
    async words(text, vocab) {
      const ids = moClipTokens(text, vocab);
      if (!ids) return { unknown: true };
      const o = await run(CLIPSEG, { input_ids: { data: BigInt64Array.from(ids.map(BigInt)), dims: [1, ids.length] }, attention_mask: { data: BigInt64Array.from(ids.map(() => 1n)), dims: [1, ids.length] }, pixel_values: tensor(img, 352, 352) });
      const lg = Object.values(o)[0], hh = lg.dims[lg.dims.length - 2], ww = lg.dims[lg.dims.length - 1], heat = lg.data.map(sig);
      const strong = []; let peak = 0;
      for (let i = 0; i < heat.length; i++) { peak = Math.max(peak, heat[i]); if (heat[i] > 0.5) strong.push(i); }
      if (peak < 0.5 || strong.length < heat.length * 0.01) return null;
      strong.sort((x, y) => heat[y] - heat[x]);
      const pick = [];
      for (const i of strong) { const x = i % ww, y = (i - x) / ww; if (pick.every((p) => Math.hypot(p[0] - x, p[1] - y) > ww / 5)) pick.push([x, y]); if (pick.length === 4) break; }
      const s = await sam(pick.map(([x, y]) => [(x + 0.5) / ww, (y + 0.5) / hh]), pick.map(() => 1), null);
      // of SAM's answers, the one that agrees most with where the words are
      let best = 0, bestScore = -1;
      for (let m = 0; m < s.n; m++) {
        let inter = 0, uni = 0;
        for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) { const a = s.masks[m * s.mh * s.mw + Math.floor((y / hh) * s.mh) * s.mw + Math.floor((x / ww) * s.mw)] > 0 ? 1 : 0, b = heat[y * ww + x] > 0.5 ? 1 : 0; inter += a & b; uni += a | b; }
        const score = inter / (uni || 1); if (score > bestScore) { bestScore = score; best = m; }
      }
      return fieldOf(s, best);
    },
    /** How near each part is: 1 nearest, 0 farthest. */
    distance() { return (distanceOnce = distanceOnce || this.findDistance().catch((e) => { distanceOnce = null; throw e; })); },
    async findDistance() {
      const k = 518 / Math.min(img.width, img.height), dw = Math.max(14, Math.round((img.width * k) / 14) * 14), dh = Math.max(14, Math.round((img.height * k) / 14) * 14);
      const o = await run(DEPTH, { pixel_values: tensor(img, dw, dh) });
      const d = Object.values(o)[0].data; let lo = Infinity, hi = -Infinity;
      for (const v of d) { if (v < lo) lo = v; if (v > hi) hi = v; }
      return { ...size, a: moFieldResize(d.map((v) => (v - lo) / (hi - lo || 1)), dw, dh, size.w, size.h) };
    },
  };
}

/** A field's name, from its content: the first 24 hex digits of the SHA-256 of its size and 8-bit values. Quick, so a result can show before its PNG is written. */
export async function moFieldName(field) {
  const q = new Uint8Array(field.w * field.h + 8), dv = new DataView(q.buffer);
  dv.setUint32(0, field.w); dv.setUint32(4, field.h);
  for (let i = 0; i < field.w * field.h; i++) q[8 + i] = Math.round(field.a[i] * 255);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', q));
  return `${Array.from(hash.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')}.png`;
}
/** A field as a grey PNG's bytes. */
export async function moFieldPng(field) {
  const cv = moEl('canvas'); cv.width = field.w; cv.height = field.h;
  const d = new Uint8ClampedArray(field.w * field.h * 4);
  for (let i = 0; i < field.w * field.h; i++) { const v = Math.round(field.a[i] * 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  cv.getContext('2d').putImageData(new ImageData(d, field.w, field.h), 0, 0);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
/** A mask image's bytes back to a field (its red channel). */
export async function moPngField(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const cv = moEl('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); bmp.close();
  const d = g.getImageData(0, 0, cv.width, cv.height).data, a = new Float32Array(cv.width * cv.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4] / 255;
  return { w: cv.width, h: cv.height, a };
}

/** CLIP's tokens for a few plain words, or null when one is not a word it knows whole. */
export function moClipTokens(text, vocab) {
  const words = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return null;
  const ids = words.map((w) => vocab.get(w));
  return ids.some((x) => x == null) ? null : [49406, ...ids, 49407];
}
let vocabCache = null;
/** The known words as a map, made on first use (clip-words.js is one long string until Select By Words needs it). */
export async function moClipVocab() {
  if (vocabCache) return vocabCache;
  vocabCache = new Map(MO_CLIP_WORDS.split(' ').map((p) => { const i = p.lastIndexOf(':'); return [p.slice(0, i), parseInt(p.slice(i + 1), 36)]; }));
  return vocabCache;
}
