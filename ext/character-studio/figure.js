// figure.js — the figure: shape from sliders, no DOM and no three.js.
//
// The data is figure/figure.bin + figure.json, made by
// scripts/bake-character-figure.mjs from Anny's MakeHuman data. A body is
//   template + sum_j c_j * basis_j          (c from the body sliders)
//            + sum_k detail_k               (the detail sliders, sparse)
// where c mixes the coefficients of the grid corners the body sliders sit
// between (at most 2^6 of them). Bones move the same way. Proxies (eyes,
// brows, lashes, hair, teeth, tongue) hang from three body vertices each.

/** The body sliders, in the order the figure's corners use. */
export const BODY_SLIDERS = ['gender', 'age', 'muscle', 'weight', 'height', 'proportions'];

/** Linear interpolation coefficients of `value` over `anchors`, clamped (Anny's). */
export function interpolationCoefficients(value, anchors) {
  const n = anchors.length; const w = new Array(n).fill(0);
  const v = Math.min(anchors[n - 1], Math.max(anchors[0], Number.isFinite(value) ? value : 0.5));
  let i = 1;
  while (i < n - 1 && v > anchors[i]) i++;
  const a = (v - anchors[i - 1]) / (anchors[i] - anchors[i - 1]);
  w[i - 1] = 1 - a; w[i] = a;
  return w;
}

/** The corners with weight for `body` ({ gender, age, ... } in [0, 1]): [{ index, weight }]. */
export function cornerWeights(features, body) {
  const per = features.map((f) => interpolationCoefficients(body[f.id], f.anchors));
  const sizes = features.map((f) => f.variations.length);
  let list = [{ index: 0, weight: 1 }];
  per.forEach((coeffs, i) => {
    const next = [];
    for (const c of list) for (let k = 0; k < coeffs.length; k++) if (coeffs[k] > 0) next.push({ index: c.index * sizes[i] + k, weight: c.weight * coeffs[k] });
    list = next;
  });
  return list;
}

/** A section of the binary as its typed array. */
function view(buffer, s) {
  const Type = { Float32Array, Uint32Array, Int16Array, Uint16Array, Float64Array }[s.type];
  if (!Type) throw new Error(`Unknown section type ${s.type}`);
  return new Type(buffer, s.offset, s.length);
}

export class Figure {
  /** @param meta figure.json  @param buffer figure.bin (ArrayBuffer) */
  constructor(meta, buffer) {
    if (meta.format !== 1) throw new Error('This figure was made for another version of Character Studio.');
    this.meta = meta;
    const S = (name) => view(buffer, meta.sections[name]);
    this.V = meta.vertexCount;
    this.boneCount = meta.bones.length;
    this.template = S('template');
    this.templateBones = S('templateBones');
    this.gpuSource = S('gpuSource');
    this.uv = S('uv');
    this.indices = S('indices');
    this.rank = meta.rank;
    this.cornerCoeffs = S('cornerCoeffs');
    // The basis, back to float (rank x 3V)
    const q = S('basis'); const scale = S('basisScale'); const DV = this.V * 3;
    this.basis = new Float32Array(q.length);
    for (let j = 0; j < this.rank; j++) { const s = scale[j]; const o = j * DV; for (let k = 0; k < DV; k++) this.basis[o + k] = q[o + k] * s; }
    this.basisBones = S('basisBones');
    this.skinIndex = S('skinIndex');
    this.skinWeight = S('skinWeight');
    // Detail sliders: by label, the positive and negative targets
    const target = (t) => ({ idx: S(`${t.key}i`), off: S(`${t.key}o`), scale: t.scale, bones: S(`${t.key}b`) });
    this.details = meta.details.map((d) => ({ ...d, pos: target(d.positive), neg: target(d.negativeTarget) }));
    this.detailByLabel = new Map(this.details.map((d) => [d.label, d]));
    // Proxies
    this.items = meta.items.map((it) => ({ ...it, refs: S(`${it.key}r`), weights: S(`${it.key}w`), offsets: S(`${it.key}o`), source: S(`${it.key}s`), uv: S(`${it.key}u`), indices: S(`${it.key}i`) }));
    this.itemById = new Map(this.items.map((it) => [it.id, it]));
    // Triangles over the body's own vertices (for smooth normals across UV seams)
    this.sourceTriangles = Uint32Array.from(this.indices, (g) => this.gpuSource[g]);
  }

  /** The basis coefficients for the body sliders. */
  coefficients(body) {
    const c = new Float32Array(this.rank);
    for (const { index, weight } of cornerWeights(this.meta.features, body)) {
      const o = index * this.rank;
      for (let j = 0; j < this.rank; j++) c[j] += weight * this.cornerCoeffs[o + j];
    }
    return c;
  }

  /**
   * The body's vertices (3V, metres, Y up) and bone heads and tails (6 per
   * bone) for `shape` = { body: { gender, ... }, details: { label: -1..1 } }.
   */
  compute(shape, out = {}) {
    const DV = this.V * 3; const DB = this.boneCount * 6;
    const positions = out.positions && out.positions.length === DV ? out.positions : new Float32Array(DV);
    const bones = out.bones && out.bones.length === DB ? out.bones : new Float32Array(DB);
    positions.set(this.template); bones.set(this.templateBones);
    const c = this.coefficients(shape.body || {});
    for (let j = 0; j < this.rank; j++) {
      const cj = c[j]; if (!cj) continue;
      const o = j * DV;
      for (let k = 0; k < DV; k++) positions[k] += cj * this.basis[o + k];
      const ob = j * DB;
      for (let k = 0; k < DB; k++) bones[k] += cj * this.basisBones[ob + k];
    }
    for (const [label, value] of Object.entries(shape.details || {})) {
      const d = this.detailByLabel.get(label);
      if (!d || !value) continue;
      const t = value > 0 ? d.pos : d.neg; const w = Math.abs(Math.max(-1, Math.min(1, value)));
      const s = t.scale * w;
      for (let i = 0; i < t.idx.length; i++) {
        const v = t.idx[i] * 3;
        positions[v] += s * t.off[i * 3]; positions[v + 1] += s * t.off[i * 3 + 1]; positions[v + 2] += s * t.off[i * 3 + 2];
      }
      for (let i = 0; i < t.bones.length; i += 7) {
        const b = t.bones[i] * 6;
        for (let a = 0; a < 6; a++) bones[b + a] += w * t.bones[i + 1 + a];
      }
    }
    return { positions, bones };
  }

  /** A proxy's vertices (3 per vertex) on a body computed by compute(). */
  proxyPositions(item, positions, out) {
    const n = item.vertexCount;
    const p = out && out.length === n * 3 ? out : new Float32Array(n * 3);
    // Per axis: how far apart its two reference vertices are now, over how far they were (decimetres)
    const scale = item.scale.map(([a, b, den], axis) => Math.abs(positions[a * 3 + axis] - positions[b * 3 + axis]) / den);
    const { refs, weights, offsets } = item;
    for (let i = 0; i < n; i++) {
      const r0 = refs[i * 3] * 3; const r1 = refs[i * 3 + 1] * 3; const r2 = refs[i * 3 + 2] * 3;
      const w0 = weights[i * 3]; const w1 = weights[i * 3 + 1]; const w2 = weights[i * 3 + 2];
      for (let a = 0; a < 3; a++) p[i * 3 + a] = w0 * positions[r0 + a] + w1 * positions[r1 + a] + w2 * positions[r2 + a] + offsets[i * 3 + a] * scale[a];
    }
    return p;
  }

  /** Skin weights for a proxy, from the vertices it hangs on: four bones a vertex. */
  proxySkin(item) {
    const n = item.vertexCount;
    const index = new Uint16Array(n * 4); const weight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const acc = new Map();
      for (let r = 0; r < 3; r++) {
        const w = item.weights[i * 3 + r]; if (!w) continue;
        const v = item.refs[i * 3 + r];
        for (let k = 0; k < 4; k++) { const bw = this.skinWeight[v * 4 + k]; if (bw) acc.set(this.skinIndex[v * 4 + k], (acc.get(this.skinIndex[v * 4 + k]) || 0) + w * bw); }
      }
      const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = top.reduce((s, [, w]) => s + w, 0) || 1;
      top.forEach(([b, w], k) => { index[i * 4 + k] = b; weight[i * 4 + k] = w / total; });
      if (!top.length) weight[i * 4] = 1;
    }
    return { index, weight };
  }

  /** The body's height in metres (lowest to highest vertex). */
  static heightOf(positions) {
    let lo = Infinity; let hi = -Infinity;
    for (let i = 1; i < positions.length; i += 3) { if (positions[i] < lo) lo = positions[i]; if (positions[i] > hi) hi = positions[i]; }
    return { lo, hi, height: hi - lo };
  }
}

/** Smooth normals over the body's own vertices, scattered to GPU vertices. */
export function smoothNormals(positions, triangles, gpuSource, out) {
  const V = positions.length / 3;
  const acc = new Float32Array(V * 3);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3; const b = triangles[t + 1] * 3; const c = triangles[t + 2] * 3;
    const e1x = positions[b] - positions[a]; const e1y = positions[b + 1] - positions[a + 1]; const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a]; const e2y = positions[c + 1] - positions[a + 1]; const e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y; const ny = e1z * e2x - e1x * e2z; const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { acc[v] += nx; acc[v + 1] += ny; acc[v + 2] += nz; }
  }
  const n = out && out.length === gpuSource.length * 3 ? out : new Float32Array(gpuSource.length * 3);
  for (let g = 0; g < gpuSource.length; g++) {
    const v = gpuSource[g] * 3;
    const l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]) || 1;
    n[g * 3] = acc[v] / l; n[g * 3 + 1] = acc[v + 1] / l; n[g * 3 + 2] = acc[v + 2] / l;
  }
  return n;
}

/** Scatter per-vertex values (3 each) to GPU vertices. */
export function scatter(values, gpuSource, out) {
  const o = out && out.length === gpuSource.length * 3 ? out : new Float32Array(gpuSource.length * 3);
  for (let g = 0; g < gpuSource.length; g++) { const v = gpuSource[g] * 3; o[g * 3] = values[v]; o[g * 3 + 1] = values[v + 1]; o[g * 3 + 2] = values[v + 2]; }
  return o;
}

/** Load the figure the extension ships. */
export async function loadFigure(api) {
  const [metaBuf, bin] = await Promise.all([api.env.readAsset('figure/figure.json'), api.env.readAsset('figure/figure.bin')]);
  return new Figure(JSON.parse(new TextDecoder().decode(metaBuf)), bin);
}
