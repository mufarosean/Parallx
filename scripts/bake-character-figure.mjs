/**
 * bake-character-figure.mjs
 *
 * Builds Character Studio's figure (ext/character-studio/figure/) from the
 * CC0 MakeHuman data that Anny (NAVER Labs, Apache-2.0) ships, the same way
 * Anny builds its model (anny/models/full_model.py, phenotype.py), without
 * running any of Anny's code:
 *
 * - the base mesh (body, eyes, teeth, tongue), with Anny's two small mesh
 *   edits, its unattached helper vertices removed, quads split in two;
 * - the body sliders. Anny's rest shape is the template plus phenotype blend
 *   shapes whose weights are products of linear interpolation coefficients
 *   (one per feature: gender, age, muscle, weight, height, proportions), so
 *   every reachable body is a weighted mix of the bodies at the corners of
 *   the anchor grid (288 here: 2 genders x 4 ages x 3 x 3 x 2 x 2). The bake
 *   computes those corner bodies and keeps an orthonormal basis of the space
 *   they span (SVD), with each corner's coefficients in that basis: exact up
 *   to round-off. Anny's own compaction does the same (136 for its default);
 *   the panel mixes at most 64 corners at once, live;
 * - the detail sliders (Anny's "default" local changes: every MakeHuman
 *   modifier pair but the genital and nipple ones), sparse;
 * - the MakeHuman default rig (163 bones): each bone's head and tail are the
 *   mean of a few vertices, so they move with every slider; the bake stores
 *   how each basis direction and each detail target moves them;
 * - the skin weights, four bones a vertex.
 *
 * Coordinates: Y up, metres, facing +Z (glTF's frame). MakeHuman's files are
 * Y up in decimetres; Anny turns them Z up for Blender, which --check undoes.
 *
 * Run:   node scripts/bake-character-figure.mjs --anny <anny>/src/anny/data --assets <pack>
 *        (<pack>: the extracted MakeHuman system asset pack, CC0; see figure/NOTICE.md;
 *        ffmpeg on the PATH converts its textures to WebP)
 * Check: add --check <dir> with Anny's cached rig dumped as raw arrays
 *        (template_bone_heads, bone_heads_blendshapes, blendshape_labels):
 *        every bone head Anny computes is compared with ours.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DEFAULT = join(ROOT, 'ext', 'character-studio', 'figure');

// ── Phenotypes (anny/models/model_data.py PHENOTYPE_VARIATIONS) ──────────

/** The features the sliders move, their anchors (values in [0, 1]) and names. */
export const FEATURES = [
  { id: 'gender', variations: ['male', 'female'], anchors: [0, 1] },
  // Anny's anchors run from newborn (-1/3) to old (1); the slider runs 0..1,
  // so newborn never has weight and is left out.
  { id: 'age', variations: ['baby', 'child', 'young', 'old'], anchors: [0, 1 / 3, 2 / 3, 1] },
  { id: 'muscle', variations: ['minmuscle', 'averagemuscle', 'maxmuscle'], anchors: [0, 0.5, 1] },
  { id: 'weight', variations: ['minweight', 'averageweight', 'maxweight'], anchors: [0, 0.5, 1] },
  { id: 'height', variations: ['minheight', 'maxheight'], anchors: [0, 1] },
  { id: 'proportions', variations: ['idealproportions', 'uncommonproportions'], anchors: [0, 1] },
];
const RACES = ['african', 'asian', 'caucasian'];   // fixed at 1/3 each (Anny's default)

/** Every corner of the anchor grid, the last feature varying fastest. */
export function corners() {
  const out = [];
  const walk = (i, acc) => {
    if (i === FEATURES.length) { out.push(acc.slice()); return; }
    for (let k = 0; k < FEATURES[i].variations.length; k++) { acc.push(k); walk(i + 1, acc); acc.pop(); }
  };
  walk(0, []);
  return out;
}

// ── Reading MakeHuman files ───────────────────────────────────────────────

/** base.obj: positions (decimetres), UVs, and faces per group. */
function readObj(file) {
  const v = []; const vt = []; const groups = new Map();
  let group = 'noname';
  const groupOf = (name) => { if (!groups.has(name)) groups.set(name, []); return groups.get(name); };
  let seenVertex = false;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    if (p[0] === 'o') { if (seenVertex) break; continue; }
    if (p[0] === 'v') { v.push(+p[1], +p[2], +p[3]); seenVertex = true; }
    else if (p[0] === 'vt') vt.push(+p[1], +p[2]);
    else if (p[0] === 'g') group = p[1];
    else if (p[0] === 'f') {
      const face = p.slice(1).map((s) => { const [a, b] = s.split('/'); return [Number(a) - 1, Number(b) - 1]; });
      groupOf(group).push(face);
    }
  }
  return { positions: Float64Array.from(v), uvs: Float64Array.from(vt), groups };
}

/** A MakeHuman target: sparse offsets (decimetres), as { idx, off }. */
function readTarget(file) {
  const text = file.endsWith('.gz') ? gunzipSync(readFileSync(file)).toString('utf8') : readFileSync(file, 'utf8');
  const idx = []; const off = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    idx.push(Number(p[0])); off.push(+p[1], +p[2], +p[3]);
  }
  return { idx: Uint32Array.from(idx), off: Float64Array.from(off) };
}

/** Add `w` times a sparse target into a dense array of 3V values. */
function addTarget(dense, t, w) {
  if (!w) return;
  for (let i = 0; i < t.idx.length; i++) {
    const j = t.idx[i] * 3;
    dense[j] += w * t.off[i * 3]; dense[j + 1] += w * t.off[i * 3 + 1]; dense[j + 2] += w * t.off[i * 3 + 2];
  }
}

// ── The bake ──────────────────────────────────────────────────────────────

const SCALE = 0.1;   // decimetres to metres
// The body is drawn from base.obj; eyes, teeth, tongue, brows, lashes and
// hair are MakeHuman proxies (below) fitted to it.
const KEEP_GROUPS = [{ group: 'body', part: 'skin' }];
const PARTS = ['skin'];

// ── Proxies (MakeHuman .mhclo): eyes, brows, lashes, hair, teeth, tongue ──
//
// Each proxy vertex is a weighted mix of three body vertices plus an offset
// scaled by how far apart two reference vertices are on each axis (MakeHuman
// proxy.py getCoords), so it follows every slider.

/** The proxies and materials Character Studio ships (MakeHuman system assets, CC0). */
const ASSET_KINDS = [
  { kind: 'eyes', dir: 'eyes', only: ['high-poly'] },
  { kind: 'eyebrows', dir: 'eyebrows' },
  { kind: 'eyelashes', dir: 'eyelashes' },
  { kind: 'hair', dir: 'hair' },
  { kind: 'teeth', dir: 'teeth', only: ['teeth_base'] },
  { kind: 'tongue', dir: 'tongue' },
];

function readKeyValues(file) {
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const i = line.search(/\s/);
    if (i < 0) continue;
    const key = line.slice(0, i); const value = line.slice(i + 1).trim();
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/** A .mhclo: header fields and, per proxy vertex, three references, weights and an offset (decimetres). */
function readMhclo(file) {
  const head = {}; const refs = []; const weights = []; const offsets = [];
  // Number lines belong to the last section opened ("verts" or "delete_verts"); a
  // keyword line between them (some files put "material" there) does not close it.
  let section = null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    if (p[0] === 'verts') { section = 'verts'; continue; }
    if (p[0] === 'delete_verts') { section = 'delete'; continue; }
    if (/^-?\d/.test(p[0])) {
      if (section !== 'verts') continue;
      if (p.length === 1) { const v = Number(p[0]); refs.push(v, v, v); weights.push(1, 0, 0); offsets.push(0, 0, 0); }
      else { refs.push(+p[0], +p[1], +p[2]); weights.push(+p[3], +p[4], +p[5]); offsets.push(+p[6] || 0, +p[7] || 0, +p[8] || 0); }
      continue;
    }
    if (p[0] === 'x_scale' || p[0] === 'y_scale' || p[0] === 'z_scale') head[p[0]] = [Number(p[1]), Number(p[2]), Number(p[3])];
    else if (!(p[0] in head)) head[p[0]] = p.slice(1).join(' ');
  }
  return { head, refs, weights, offsets };
}

/** Collect every proxy and its material from the extracted asset pack. */
function readAssetPack(dir) {
  const items = [];
  for (const { kind, dir: sub, only } of ASSET_KINDS) {
    const root = join(dir, sub);
    for (const name of readdirSync(root).sort()) {
      if (only && !only.includes(name)) continue;
      const mhclo = join(root, name, `${name}.mhclo`);
      if (!existsSync(mhclo)) continue;
      const clo = readMhclo(mhclo);
      const mesh = readObj(join(root, name, clo.head.obj_file));
      const matFile = clo.head.material ? resolve(join(root, name), clo.head.material) : null;
      const mat = matFile && existsSync(matFile) ? readKeyValues(matFile) : {};
      const texture = mat.diffuseTexture ? resolve(dirname(matFile), mat.diffuseTexture) : null;
      items.push({ kind, id: `${kind}/${name}`, name, clo, mesh, texture, transparent: /true/i.test(mat.transparent || ''), doubleSided: /false/i.test(mat.backfaceCull || '') });
    }
  }
  // Iris colours (one eye mesh, several textures) and skins (textures on the body's UVs)
  const irises = []; const eyeMats = join(dir, 'eyes', 'materials');
  for (const f of readdirSync(eyeMats).filter((f) => f.endsWith('.mhmat')).sort()) {
    const m = readKeyValues(join(eyeMats, f));
    if (m.diffuseTexture) irises.push({ id: `iris/${f.replace('.mhmat', '')}`, name: f.replace('.mhmat', ''), texture: join(eyeMats, m.diffuseTexture) });
  }
  const skins = []; const skinRoot = join(dir, 'skins');
  for (const name of readdirSync(skinRoot).sort()) {
    if (name.includes('special_suit') || name.startsWith('toon')) continue;
    const matFile = join(skinRoot, name, `${name}.mhmat`);
    if (!existsSync(matFile)) continue;
    const m = readKeyValues(matFile);
    if (m.diffuseTexture) skins.push({ id: `skin/${name}`, name, texture: join(skinRoot, name, m.diffuseTexture) });
  }
  return { items, irises, skins };
}

/** Convert a texture to WebP (ffmpeg on the PATH), keeping alpha when it has one. */
function toWebp(src, dest, { alpha = false, quality = 90 } = {}) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-c:v', 'libwebp', '-quality', String(quality), '-pix_fmt', alpha ? 'yuva420p' : 'yuv420p', dest]);
}

/** Anny's nudity edits (full_model.py get_edited_mesh_faces), on the body's faces. */
function editBodyFaces(faces) {
  const drop = new Set();
  for (let i = 1778; i <= 1793; i++) drop.add(i);
  for (let i = 8450; i <= 8465; i++) drop.add(i);
  const kept = []; const uvOf = new Map();
  for (const f of faces) {
    if (f.some(([vi]) => drop.has(vi))) { for (const [vi, ti] of f) if (!uvOf.has(vi)) uvOf.set(vi, ti); }
    else kept.push(f);
  }
  const caps = [
    [8437, 8438, 8439, 8440], [8436, 8437, 8440, 8441], [8435, 8436, 8441, 8442], [8434, 8435, 8442, 8443],
    [8449, 8434, 8443, 8444], [8448, 8449, 8444, 8445], [8447, 8448, 8445, 8446],
    [1762, 1771, 1770, 1763], [1763, 1770, 1769, 1764], [1764, 1769, 1768, 1765], [1765, 1768, 1767, 1766],
    [1762, 1777, 1772, 1771], [1777, 1776, 1773, 1772], [1776, 1775, 1774, 1773],
  ];
  for (const c of caps) {
    if (c.some((vi) => !uvOf.has(vi))) throw new Error(`A cap vertex has no texture coordinate: ${c}`);
    kept.push(c.map((vi) => [vi, uvOf.get(vi)]));
  }
  return kept;
}

/** Linear interpolation coefficients of `value` over `anchors` (clamped), as Anny's. */
export function interpolation(value, anchors) {
  const n = anchors.length; const w = new Array(n).fill(0);
  const v = Math.min(anchors[n - 1], Math.max(anchors[0], value));
  let i = 1;
  while (i < n - 1 && v > anchors[i]) i++;
  const a = (v - anchors[i - 1]) / (anchors[i] - anchors[i - 1]);
  w[i - 1] = 1 - a; w[i] = a;
  return w;
}

/** Symmetric eigendecomposition (cyclic Jacobi). Returns { values, vectors } (vectors as columns, row-major n x n). */
function jacobiEigen(A, n) {
  const a = Float64Array.from(A); const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p * n + p]; const aqq = a[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1); const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]; const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]; const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p]; const vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = a[i * n + i];
  return { values, vectors: V };
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const data = arg('--anny');
  if (!data || !existsSync(join(data, 'mpfb2'))) throw new Error('Pass --anny <anny>/src/anny/data.');
  const out = arg('--out') || OUT_DEFAULT;
  const mpfb = join(data, 'mpfb2');
  const T = (...p) => join(mpfb, 'targets', ...p);

  // Mesh
  const obj = readObj(join(mpfb, '3dobjs', 'base.obj'));
  const VF = obj.positions.length / 3;   // every vertex of base.obj
  const template = Float64Array.from(obj.positions, (x) => x * SCALE);
  console.log(`base.obj: ${VF} vertices, ${obj.uvs.length / 2} UVs`);

  // Corner bodies (offsets from the template, metres, every vertex)
  const ages = FEATURES[1].variations;
  const targetCache = new Map();
  const target = (file) => { if (!targetCache.has(file)) targetCache.set(file, existsSync(file) ? readTarget(file) : null); return targetCache.get(file); };
  const cornerList = corners();
  const cornerBodies = cornerList.map((c) => {
    const [g, a, m, w, h, p] = c.map((k, i) => FEATURES[i].variations[k]);
    const d = new Float64Array(VF * 3);
    addTarget(d, target(T('macrodetails', `universal-${g}-${a}-${m}-${w}.target.gz`)), 1);
    for (const r of RACES) addTarget(d, target(T('macrodetails', `${r}-${g}-${a}.target.gz`)), 1 / 3);
    addTarget(d, target(T('macrodetails', 'height', `${g}-${a}-${m}-${w}-${h}.target.gz`)), 1);
    if (a !== 'baby') addTarget(d, target(T('macrodetails', 'proportions', `${g}-${a}-${m}-${w}-${p}.target.gz`)), 1);
    if (g === 'female') {
      const bf = T('breast', `female-${a}-${m}-${w}-averagecup-averagefirmness.target.gz`);
      if (target(bf)) addTarget(d, target(bf), 1);
    }
    for (let i = 0; i < d.length; i++) d[i] *= SCALE;
    return d;
  });
  const missing = [...targetCache].filter(([f, t]) => !t && !f.includes('breast'));
  if (missing.length) throw new Error(`Missing targets: ${missing.map(([f]) => f).join(', ')}`);
  console.log(`corners: ${cornerList.length}, targets read: ${targetCache.size}`);

  // Rig: bones in Anny's order (depth first from the root, the file's order)
  const rigJson = JSON.parse(readFileSync(join(mpfb, 'rigs', 'standard', 'rig.default.json'), 'utf8'));
  const rig = rigJson.bones || rigJson;
  const weightsJson = JSON.parse(readFileSync(join(mpfb, 'rigs', 'standard', 'weights.default.json'), 'utf8'));
  const names = Object.keys(rig);
  const rootName = names.find((n) => !rig[n].parent);
  const bones = [];
  const visit = (name, parent) => {
    const id = bones.length; bones.push({ name, parent });
    for (const n of names) if (!bones.some((b) => b.name === n) && rig[n].parent === name) visit(n, id);
  };
  visit(rootName, -1);
  if (bones.length !== names.length) throw new Error('The rig is not one tree.');
  // Vertex sets per group (for CUBE regressors: the unique vertices of the group's faces)
  const groupVertices = new Map();
  for (const [name, faces] of obj.groups) { const s = new Set(); for (const f of faces) for (const [vi] of f) s.add(vi); groupVertices.set(name, [...s]); }
  const regressor = (spec) => {
    if (spec.strategy === 'VERTEX') return [spec.vertex_index];
    if (spec.strategy === 'CUBE') return groupVertices.get(spec.cube_name);
    if (spec.strategy === 'MEAN') return spec.vertex_indices;
    throw new Error(`Unknown joint strategy ${spec.strategy}`);
  };
  for (const b of bones) { b.head = regressor(rig[b.name].head); b.tail = regressor(rig[b.name].tail); b.roll = rig[b.name].roll || 0; }
  const meanOf = (arr, ids) => { const r = [0, 0, 0]; for (const i of ids) { r[0] += arr[i * 3]; r[1] += arr[i * 3 + 1]; r[2] += arr[i * 3 + 2]; } return r.map((x) => x / ids.length); };
  /** Bone heads and tails (6 per bone) of a dense offset or position array. */
  const bonePoints = (arr) => { const r = new Float64Array(bones.length * 6); bones.forEach((b, i) => { r.set(meanOf(arr, b.head), i * 6); r.set(meanOf(arr, b.tail), i * 6 + 3); }); return r; };

  // Faces: the kept groups, the body edited, then remove unattached vertices
  const partFaces = new Map(PARTS.map((p) => [p, []]));
  for (const { group, part } of KEEP_GROUPS) {
    let faces = obj.groups.get(group) || [];
    if (group === 'body') faces = editBodyFaces(faces);
    partFaces.get(part).push(...faces);
  }
  const used = new Uint8Array(VF);
  for (const faces of partFaces.values()) for (const f of faces) for (const [vi] of f) used[vi] = 1;
  // Proxies keep the body vertices they hang from (some are helper vertices nobody draws)
  const assetsDir = arg('--assets');
  if (!assetsDir || !existsSync(join(assetsDir, 'hair'))) throw new Error('Pass --assets <the extracted MakeHuman system asset pack>.');
  const pack = readAssetPack(assetsDir);
  for (const it of pack.items) {
    for (const v of it.clo.refs) used[v] = 1;
    for (const k of ['x_scale', 'y_scale', 'z_scale']) { used[it.clo.head[k][0]] = 1; used[it.clo.head[k][1]] = 1; }
  }
  const keep = []; const newIndex = new Int32Array(VF).fill(-1);
  for (let i = 0; i < VF; i++) if (used[i]) { newIndex[i] = keep.length; keep.push(i); }
  const V = keep.length;

  // GPU vertices: one per (vertex, uv) pair; triangles in part order
  const gpuKey = new Map(); const gpuSource = []; const gpuUv = []; const indices = []; const partRanges = {};
  for (const part of PARTS) {
    const start = indices.length;
    for (const f of partFaces.get(part)) {
      const ids = f.map(([vi, ti]) => {
        const key = vi * 1e6 + ti;
        let g = gpuKey.get(key);
        if (g === undefined) { g = gpuSource.length; gpuKey.set(key, g); gpuSource.push(newIndex[vi]); gpuUv.push(obj.uvs[ti * 2], obj.uvs[ti * 2 + 1]); }
        return g;
      });
      for (let k = 1; k + 1 < ids.length; k++) indices.push(ids[0], ids[k], ids[k + 1]);
    }
    partRanges[part] = { start, count: indices.length - start };
  }
  console.log(`kept ${V} vertices, ${gpuSource.length} GPU vertices, ${indices.length / 3} triangles`);

  // Basis of the corner bodies: [kept vertices' offsets | bone points], SVD via the Gram matrix
  const C = cornerList.length; const DV = V * 3; const DB = bones.length * 6; const D = DV + DB;
  const rows = cornerBodies.map((d) => {
    const r = new Float64Array(D);
    for (let i = 0; i < V; i++) { const s = keep[i] * 3; r[i * 3] = d[s]; r[i * 3 + 1] = d[s + 1]; r[i * 3 + 2] = d[s + 2]; }
    r.set(bonePoints(d), DV);
    return r;
  });
  const G = new Float64Array(C * C);
  for (let i = 0; i < C; i++) for (let j = i; j < C; j++) {
    let s = 0; const a = rows[i]; const b = rows[j];
    for (let k = 0; k < D; k++) s += a[k] * b[k];
    G[i * C + j] = s; G[j * C + i] = s;
  }
  const { values, vectors } = jacobiEigen(G, C);
  const order = [...values.keys()].sort((x, y) => values[y] - values[x]);
  const sigmaMax = Math.sqrt(Math.max(0, values[order[0]]));
  const rank = order.filter((k) => Math.sqrt(Math.max(0, values[k])) > sigmaMax * 1e-7).length;
  console.log(`corner bodies span rank ${rank} (largest singular value ${sigmaMax.toFixed(3)})`);
  // basis_j = (1 / sigma_j) * sum_i U[i][j] * rows[i]; coefficient of corner i on basis j = U[i][j] * sigma_j
  const basis = []; const coeffs = new Float32Array(C * rank);
  for (let jj = 0; jj < rank; jj++) {
    const j = order[jj]; const sigma = Math.sqrt(values[j]);
    const b = new Float64Array(D);
    for (let i = 0; i < C; i++) { const u = vectors[i * C + j]; if (!u) continue; const r = rows[i]; for (let k = 0; k < D; k++) b[k] += u * r[k]; }
    for (let k = 0; k < D; k++) b[k] /= sigma;
    basis.push(b);
    for (let i = 0; i < C; i++) coeffs[i * rank + jj] = vectors[i * C + j] * sigma;
  }
  // Reconstruction check on every corner (float64)
  let worst = 0;
  for (let i = 0; i < C; i++) {
    const r = rows[i];
    for (let k = 0; k < D; k += 7) { let s = 0; for (let jj = 0; jj < rank; jj++) s += coeffs[i * rank + jj] * basis[jj][k]; worst = Math.max(worst, Math.abs(s - r[k])); }
  }
  console.log(`worst corner reconstruction error: ${(worst * 1000).toFixed(4)} mm`);

  // Detail targets (Anny's default local changes)
  const targetsMeta = JSON.parse(readFileSync(T('target.json'), 'utf8'));
  const details = [];
  for (const [key, meta] of Object.entries(targetsMeta)) {
    if (key === 'genitals') continue;
    for (const category of meta.categories) {
      if (!category.opposites) continue;
      for (const side of ['left', 'right', 'unsided']) {
        const neg = category.opposites[`negative-${side}`]; const pos = category.opposites[`positive-${side}`];
        if (!neg || !pos || pos.toLowerCase().includes('nipple')) continue;
        details.push({ group: key, label: pos, negative: neg, side, category: category.label, pos: readTarget(T(key, `${pos}.target.gz`)), neg: readTarget(T(key, `${neg}.target.gz`)) });
      }
    }
  }
  console.log(`detail sliders: ${details.length}`);

  // Skin weights: four bones a vertex, the strongest, renormalised
  const perVertex = Array.from({ length: VF }, () => []);
  bones.forEach((b, bi) => { for (const [vi, w] of (weightsJson.weights[b.name] || [])) perVertex[vi].push([bi, w]); });

  // ── Write ──
  const chunks = []; let offset = 0; const sections = {};
  const put = (name, typed) => {
    const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(bytes); sections[name] = { offset, length: typed.length, type: typed.constructor.name }; offset += bytes.byteLength;
  };
  const tmpl = new Float32Array(DV); for (let i = 0; i < V; i++) for (let a = 0; a < 3; a++) tmpl[i * 3 + a] = template[keep[i] * 3 + a];
  put('template', tmpl);
  put('templateBones', Float32Array.from(bonePoints(template)));
  put('gpuSource', Uint32Array.from(gpuSource));
  put('uv', Float32Array.from(gpuUv));
  put('indices', Uint32Array.from(indices));
  // Basis: vertex part as int16 per direction (with its scale), bone part as float32
  const basisScale = new Float32Array(rank); const basisQ = new Int16Array(rank * DV); const basisBones = new Float32Array(rank * DB);
  basis.forEach((b, j) => {
    let m = 0; for (let k = 0; k < DV; k++) m = Math.max(m, Math.abs(b[k]));
    const s = m / 32767 || 1; basisScale[j] = s;
    for (let k = 0; k < DV; k++) basisQ[j * DV + k] = Math.round(b[k] / s);
    for (let k = 0; k < DB; k++) basisBones[j * DB + k] = b[DV + k];
  });
  put('basisScale', basisScale); put('basis', basisQ); put('basisBones', basisBones); put('cornerCoeffs', coeffs);
  // Details: per target, kept vertex indices + int16 offsets (metres, scaled), and the bones it moves
  const detailMeta = details.map((d) => {
    const pack = (t) => {
      const idx = []; const off = [];
      const dense = new Float64Array(VF * 3); addTarget(dense, t, SCALE);
      for (let i = 0; i < t.idx.length; i++) { const ni = newIndex[t.idx[i]]; if (ni < 0) continue; idx.push(ni); off.push(t.off[i * 3] * SCALE, t.off[i * 3 + 1] * SCALE, t.off[i * 3 + 2] * SCALE); }
      let m = 0; for (const x of off) m = Math.max(m, Math.abs(x));
      const s = m / 32767 || 1;
      const bp = bonePoints(dense); const moved = [];
      for (let bi = 0; bi < bones.length; bi++) { const six = bp.subarray(bi * 6, bi * 6 + 6); if (six.some((x) => Math.abs(x) > 1e-9)) moved.push(bi, ...six); }
      const base = { idx: `d${chunks.length}` };
      put(`${base.idx}i`, Uint32Array.from(idx)); put(`${base.idx}o`, Int16Array.from(off, (x) => Math.round(x / s))); put(`${base.idx}b`, Float32Array.from(moved));
      return { key: base.idx, scale: s, count: idx.length };
    };
    return { group: d.group, category: d.category, side: d.side, label: d.label, negative: d.negative, positive: pack(d.pos), negativeTarget: pack(d.neg) };
  });
  const skinIdx = new Uint16Array(V * 4); const skinW = new Float32Array(V * 4);
  for (let i = 0; i < V; i++) {
    const list = perVertex[keep[i]].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = list.reduce((s, [, w]) => s + w, 0) || 1;
    list.forEach(([bi, w], k) => { skinIdx[i * 4 + k] = bi; skinW[i * 4 + k] = w / total; });
    if (!list.length) skinW[i * 4] = 1;   // unweighted: follows the root
  }
  put('skinIndex', skinIdx); put('skinWeight', skinW);

  // Proxies: references into the kept vertices, weights, offsets; their own UVs and triangles
  mkdirSync(join(out, 'textures'), { recursive: true });
  const texName = (id) => id.replace(/[^a-z0-9]+/gi, '-') + '.webp';
  const items = pack.items.map((it, n) => {
    const { refs, weights, offsets, head } = it.clo;
    const count = refs.length / 3;
    if (count !== it.mesh.positions.length / 3) throw new Error(`${it.id}: ${count} fitted vertices for ${it.mesh.positions.length / 3} in its mesh.`);
    const key = `p${n}`;
    put(`${key}r`, Uint32Array.from(refs, (v) => newIndex[v]));
    put(`${key}w`, Float32Array.from(weights));
    put(`${key}o`, Float32Array.from(offsets));
    const keyMap = new Map(); const src = []; const uv = []; const idx = [];
    for (const faces of it.mesh.groups.values()) for (const f of faces) {
      const ids = f.map(([vi, ti]) => {
        const k = vi * 1e6 + (ti >= 0 ? ti : 0);
        let g = keyMap.get(k);
        if (g === undefined) { g = src.length; keyMap.set(k, g); src.push(vi); uv.push(ti >= 0 ? it.mesh.uvs[ti * 2] : 0, ti >= 0 ? it.mesh.uvs[ti * 2 + 1] : 0); }
        return g;
      });
      for (let k = 1; k + 1 < ids.length; k++) idx.push(ids[0], ids[k], ids[k + 1]);
    }
    put(`${key}s`, Uint32Array.from(src)); put(`${key}u`, Float32Array.from(uv)); put(`${key}i`, Uint32Array.from(idx));
    let texture = null;
    if (it.texture && existsSync(it.texture)) { texture = `textures/${texName(it.id)}`; toWebp(it.texture, join(out, texture), { alpha: it.transparent, quality: 92 }); }
    const scale = ['x_scale', 'y_scale', 'z_scale'].map((k) => [newIndex[head[k][0]], newIndex[head[k][1]], head[k][2]]);
    return { kind: it.kind, id: it.id, name: it.name, key, vertexCount: count, scale, texture, transparent: it.transparent, doubleSided: it.doubleSided };
  });
  const irises = pack.irises.map((t) => { const f = `textures/${texName(t.id)}`; toWebp(t.texture, join(out, f), { quality: 92 }); return { id: t.id, name: t.name, texture: f }; });
  const skins = pack.skins.map((t) => { const f = `textures/${texName(t.id)}`; toWebp(t.texture, join(out, f), { quality: 90 }); return { id: t.id, name: t.name, texture: f }; });
  console.log(`proxies: ${items.length}, irises: ${irises.length}, skins: ${skins.length}`);

  const meta = {
    format: 1,
    source: 'MakeHuman CC0 assets as shipped by Anny (NAVER Labs, Apache-2.0); converted by scripts/bake-character-figure.mjs',
    vertexCount: V, gpuVertexCount: gpuSource.length, triangleCount: indices.length / 3,
    parts: partRanges,
    features: FEATURES, rank, cornerCount: C,
    bones: bones.map((b) => ({ name: b.name, parent: b.parent, roll: b.roll })),
    details: detailMeta,
    items, irises, skins,
    sections,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'figure.bin'), Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));
  writeFileSync(join(out, 'figure.json'), JSON.stringify(meta) + '\n');
  console.log(`wrote ${(offset / 1024 ** 2).toFixed(1)} MB to ${out}`);

  const check = arg('--check');
  const targetFile = {
    universal: (n) => T('macrodetails', `universal-${n}.target.gz`),
    race: (n) => T('macrodetails', `${n}.target.gz`),
    height: (n) => T('macrodetails', 'height', `${n}.target.gz`),
    proportions: (n) => T('macrodetails', 'proportions', `${n}.target.gz`),
    breast: (n) => T('breast', `${n}.target.gz`),
  };
  if (check) checkAgainstAnny(check, { template, bones, bonePoints, details, VF, targetFile });
}

/** Compare bone heads with Anny's own (its cached rig, Z up): template and every phenotype or detail blend shape. */
function checkAgainstAnny(dir, ctx) {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const f64 = (name) => { const b = readFileSync(join(dir, `${name}.bin`)); return new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8); };
  const heads = f64('template_bone_heads'); const shapes = f64('bone_heads_blendshapes');
  const labels = index.blendshape_labels; const boneLabels = index.bone_labels; const NB = boneLabels.length;
  const toZUp = ([x, y, z]) => [x, -z, y];
  const ours = ctx.bones.map((b) => b.name);
  const map = boneLabels.map((n) => ours.indexOf(n));
  if (map.some((i) => i < 0)) throw new Error('A bone of Anny\'s rig is missing from ours.');
  let worst = 0;
  // Anny's own rig places its root bone by a convention of its own (not from vertices); every other bone is compared.
  const cmp = (oursPts, theirs, base) => {
    for (let b = 0; b < NB; b++) {
      if (boneLabels[b] === 'root') continue;
      const p = toZUp([...oursPts.subarray(map[b] * 6, map[b] * 6 + 3)]);
      for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(p[a] - theirs[base + b * 3 + a]));
    }
  };
  cmp(ctx.bonePoints(ctx.template), heads, 0);
  const dense = (fn) => { const d = new Float64Array(ctx.VF * 3); fn(d); return d; };
  let compared = 0;
  labels.forEach((label, k) => {
    const [block, name] = label.split(':');
    let d = null;
    if (block === 'local_change') {
      const det = ctx.details.find((x) => x.label === name || x.negative === name);
      if (det) d = dense((arr) => addTarget(arr, det.label === name ? det.pos : det.neg, SCALE));
    } else if (!name.includes('newborn') && ctx.targetFile[block]) {
      const file = ctx.targetFile[block](name);
      if (existsSync(file)) d = dense((arr) => addTarget(arr, readTarget(file), SCALE));
    }
    if (d) { cmp(ctx.bonePoints(d), shapes, k * NB * 3); compared++; }
  });
  console.log(`checked against Anny: ${NB - 1} bones, the template and ${compared} blend shapes; worst bone head difference ${(worst * 1000).toFixed(5)} mm`);
  if (worst > 1e-5) { console.error('The figure does not match Anny.'); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
