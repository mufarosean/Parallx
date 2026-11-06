// anime.js — the anime character: VRoid sample characters (models/) loaded with
// three-vrm, mixed (body and outfit from one, face from another, hair from a
// third), shaped by sliders and recoloured. No DOM here besides the canvases
// textures are recoloured on.
//
// Mixing: the body character is the rig. A face or hair taken from another
// character keeps its own mesh and bind pose; its bones are matched to the
// rig's by name, and the bones only it has (hair strands) are moved under the
// rig's matching parent, so it follows the rig and its own hair physics runs.
//
// Shape: proportions are bone scales (outfit and hair follow them by
// construction); body shape (bust, waist, hips, limbs) and face shape (eyes,
// jaw, chin, mouth) are smooth deformations of the rest-pose meshes. The body
// deformations move skin and outfit together, so nothing pokes through.

import * as THREE from './vendor/three.min.js';

// ── The character's data ───────────────────────────────────────────────────

/** Proportion and shape sliders: id, tab, name, range and default (1 = as made). */
export const SHAPE_SLIDERS = [
  { id: 'height', group: 'proportions', name: 'Height', min: 0.85, max: 1.15, value: 1 },
  { id: 'head', group: 'proportions', name: 'Head size', min: 0.85, max: 1.2, value: 1 },
  { id: 'legs', group: 'proportions', name: 'Leg length', min: 0.85, max: 1.2, value: 1 },
  { id: 'arms', group: 'proportions', name: 'Arm length', min: 0.85, max: 1.15, value: 1 },
  { id: 'shoulders', group: 'proportions', name: 'Shoulder width', min: 0.85, max: 1.2, value: 1 },
  { id: 'neck', group: 'proportions', name: 'Neck length', min: 0.8, max: 1.3, value: 1 },
  { id: 'bust', group: 'build', name: 'Bust', min: 0.7, max: 1.5, value: 1 },
  { id: 'waist', group: 'build', name: 'Waist', min: 0.8, max: 1.25, value: 1 },
  { id: 'hips', group: 'build', name: 'Hips', min: 0.85, max: 1.25, value: 1 },
  { id: 'thighs', group: 'build', name: 'Thighs', min: 0.8, max: 1.3, value: 1 },
  { id: 'calves', group: 'build', name: 'Calves', min: 0.8, max: 1.3, value: 1 },
  { id: 'upperArms', group: 'build', name: 'Upper arms', min: 0.8, max: 1.3, value: 1 },
  { id: 'eyeSize', group: 'face', name: 'Eye size', min: 0.8, max: 1.3, value: 1 },
  { id: 'eyeSpacing', group: 'face', name: 'Eye spacing', min: -1, max: 1, value: 0 },
  { id: 'eyeHeight', group: 'face', name: 'Eye height', min: -1, max: 1, value: 0 },
  { id: 'faceWidth', group: 'face', name: 'Face width', min: 0.88, max: 1.12, value: 1 },
  { id: 'jaw', group: 'face', name: 'Jaw', min: 0.85, max: 1.15, value: 1 },
  { id: 'chin', group: 'face', name: 'Chin length', min: -1, max: 1, value: 0 },
  { id: 'mouth', group: 'face', name: 'Mouth width', min: 0.8, max: 1.25, value: 1 },
];

/** Colour choices as data (0..1 each); `null` keeps the character's own. */
export const PALETTES = {
  skin: [
    { id: 'own', name: 'As drawn', rgb: null }, { id: 'porcelain', name: 'Porcelain', rgb: [1, 0.9, 0.86] },
    { id: 'fair', name: 'Fair', rgb: [0.98, 0.84, 0.76] }, { id: 'warm', name: 'Warm', rgb: [0.93, 0.76, 0.62] },
    { id: 'olive', name: 'Olive', rgb: [0.82, 0.66, 0.5] }, { id: 'tan', name: 'Tan', rgb: [0.72, 0.53, 0.38] },
    { id: 'brown', name: 'Brown', rgb: [0.55, 0.38, 0.27] }, { id: 'deep', name: 'Deep', rgb: [0.38, 0.25, 0.18] },
  ],
  hair: [
    { id: 'own', name: 'As drawn', rgb: null }, { id: 'black', name: 'Black', rgb: [0.12, 0.11, 0.13] },
    { id: 'brown', name: 'Brown', rgb: [0.42, 0.27, 0.17] }, { id: 'chestnut', name: 'Chestnut', rgb: [0.6, 0.32, 0.18] },
    { id: 'blonde', name: 'Blonde', rgb: [0.98, 0.84, 0.55] }, { id: 'platinum', name: 'Platinum', rgb: [0.96, 0.95, 0.9] },
    { id: 'red', name: 'Red', rgb: [0.85, 0.25, 0.18] }, { id: 'pink', name: 'Pink', rgb: [0.98, 0.6, 0.75] },
    { id: 'lilac', name: 'Lilac', rgb: [0.72, 0.6, 0.95] }, { id: 'blue', name: 'Blue', rgb: [0.35, 0.55, 0.95] },
    { id: 'teal', name: 'Teal', rgb: [0.25, 0.75, 0.72] }, { id: 'silver', name: 'Silver', rgb: [0.78, 0.8, 0.85] },
  ],
  eyes: [
    { id: 'own', name: 'As drawn', rgb: null }, { id: 'brown', name: 'Brown', rgb: [0.55, 0.32, 0.18] },
    { id: 'amber', name: 'Amber', rgb: [0.95, 0.65, 0.2] }, { id: 'green', name: 'Green', rgb: [0.3, 0.7, 0.4] },
    { id: 'blue', name: 'Blue', rgb: [0.3, 0.55, 0.95] }, { id: 'violet', name: 'Violet', rgb: [0.6, 0.4, 0.9] },
    { id: 'red', name: 'Red', rgb: [0.9, 0.2, 0.25] }, { id: 'grey', name: 'Grey', rgb: [0.6, 0.65, 0.7] },
  ],
  outfit: [
    { id: 'own', name: 'As drawn', rgb: null }, { id: 'white', name: 'White', rgb: [0.96, 0.96, 0.96] },
    { id: 'black', name: 'Black', rgb: [0.16, 0.16, 0.18] }, { id: 'navy', name: 'Navy', rgb: [0.2, 0.26, 0.5] },
    { id: 'red', name: 'Red', rgb: [0.8, 0.2, 0.22] }, { id: 'pink', name: 'Pink', rgb: [0.98, 0.65, 0.75] },
    { id: 'green', name: 'Green', rgb: [0.3, 0.6, 0.4] }, { id: 'yellow', name: 'Yellow', rgb: [0.98, 0.85, 0.4] },
    { id: 'lilac', name: 'Lilac', rgb: [0.75, 0.65, 0.95] }, { id: 'brown', name: 'Brown', rgb: [0.5, 0.35, 0.25] },
  ],
};

export const EXPRESSIONS = [
  { id: 'neutral', name: 'Calm' }, { id: 'happy', name: 'Happy' }, { id: 'relaxed', name: 'Relaxed' },
  { id: 'surprised', name: 'Surprised' }, { id: 'sad', name: 'Sad' }, { id: 'angry', name: 'Angry' },
];

/** A new character: one sample character whole, every slider at rest. */
export function defaultCharacter(catalogue, modelId) {
  const id = modelId || catalogue.models[0].id;
  const shape = {}; for (const s of SHAPE_SLIDERS) shape[s.id] = s.value;
  return { version: 2, style: 'anime', parts: { body: id, face: id, hair: id }, shape, colours: { skin: 'own', hair: 'own', eyes: 'own', top: 'own', bottom: 'own' }, expression: 'neutral' };
}

/** A stored character made whole (anything missing or unknown back to its default). */
export function normaliseCharacter(data, catalogue) {
  const ids = new Set(catalogue.models.map((m) => m.id));
  const d = defaultCharacter(catalogue);
  const src = data && typeof data === 'object' && data.style === 'anime' ? data : {};
  const pick = (v, dflt) => (ids.has(v) ? v : dflt);
  const body = pick(src.parts && src.parts.body, d.parts.body);
  const parts = { body, face: pick(src.parts && src.parts.face, body), hair: pick(src.parts && src.parts.hair, body) };
  const shape = {};
  for (const s of SHAPE_SLIDERS) { const v = src.shape && src.shape[s.id]; shape[s.id] = Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : s.value; }
  const colours = {};
  for (const [k, pal] of [['skin', 'skin'], ['hair', 'hair'], ['eyes', 'eyes'], ['top', 'outfit'], ['bottom', 'outfit']]) {
    const v = src.colours && src.colours[k]; colours[k] = PALETTES[pal].some((c) => c.id === v) ? v : 'own';
  }
  const expression = EXPRESSIONS.some((e) => e.id === src.expression) ? src.expression : 'neutral';
  return { version: 2, style: 'anime', parts, shape, colours, expression };
}

// ── Loading ───────────────────────────────────────────────────────────────

/** Parse a .vrm into a VRM (a fresh one each time: mixing changes it). */
export function parseVrm(bytes) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.GLTFLoader();
    // Textures through an image element: the app's security policy lets pictures load
    // from blob: addresses but not fetch() them, which the default bitmap loader does
    loader.register((parser) => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'parallx_texture_loader' }; });
    loader.register((parser) => new THREE.VRMLoaderPlugin(parser));
    loader.parse(bytes.slice(0), '', (gltf) => {
      const vrm = gltf.userData.vrm;
      if (!vrm) { reject(new Error('Not a VRM character.')); return; }
      THREE.VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse((o) => { o.frustumCulled = false; });
      resolve(vrm);
    }, reject);
  });
}

const skinnedMeshes = (root) => { const out = []; root.traverse((o) => { if (o.isSkinnedMesh) out.push(o); }); return out; };
const matName = (m) => String((m.material && (Array.isArray(m.material) ? m.material[0] : m.material).name) || '');
/** Which part of a VRoid character a mesh is: 'face' (head and eyes), 'hair' or 'body' (skin and outfit). */
export function partOf(mesh) {
  const n = matName(mesh);
  if (/_HAIR\b|Hair/i.test(n) && !/Face|Eye/i.test(n)) return 'hair';
  if (/FACE|EYE|Face_00_SKIN|Face_SKIN/i.test(n)) return 'face';
  return 'body';
}

/** Graft the `part` meshes of `donor` onto the rig `rig`: bones matched by name, the donor's own bones moved under the rig. */
function graft(rig, donor, part) {
  const rigBones = new Map(); rig.scene.traverse((o) => { if (o.isBone && !rigBones.has(o.name)) rigBones.set(o.name, o); });
  const moved = [];
  for (const mesh of skinnedMeshes(donor.scene).filter((m) => partOf(m) === part)) {
    const bones = mesh.skeleton.bones.map((b) => {
      const own = rigBones.get(b.name);
      if (own) return own;
      // A bone the rig lacks: move its topmost missing ancestor under the rig's matching parent
      let top = b;
      while (top.parent && top.parent.isBone && !rigBones.has(top.parent.name)) top = top.parent;
      const parent = top.parent && rigBones.get(top.parent.name);
      if (parent && top.parent !== parent) { parent.add(top); moved.push(top); }
      return b;
    });
    const skeleton = new THREE.Skeleton(bones, mesh.skeleton.boneInverses);
    rig.scene.add(mesh);
    mesh.bind(skeleton, mesh.bindMatrix);
  }
  // The donor's hair physics: its colliders move to the rig's matching bones
  const springs = donor.springBoneManager;
  if (springs) {
    for (const collider of springs.colliders || []) {
      const p = collider.parent; const own = p && rigBones.get(p.name);
      if (own && own !== p) own.add(collider);
    }
    springs.setInitState && springs.setInitState();
  }
  return moved;
}

// ── Shape ─────────────────────────────────────────────────────────────────

const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/**
 * One mesh per vertex buffer: a VRoid model's parts (face skin, eyes, mouth;
 * skin and each garment) share one buffer of vertices, so shaping each part
 * would shape the shared vertices again. The models' own normals are kept
 * (anime shading depends on them; recomputing per part would also clear the
 * other parts' normals in the shared buffer).
 */
function onePerBuffer(meshes) {
  const seen = new Set(); const out = [];
  for (const m of meshes) { const a = m.geometry.attributes.position; const key = a.isInterleavedBufferAttribute ? a.data : a.array; if (!seen.has(key)) { seen.add(key); out.push(m); } }
  return out;
}

/** Rest positions of a geometry, kept the first time it is shaped. */
function rest(mesh) {
  const g = mesh.geometry;
  if (!g.userData.rest) g.userData.rest = g.attributes.position.array.slice();
  return g.userData.rest;
}

/** Bone positions in a skinned mesh's own geometry space (its bind pose). */
function bindPositions(mesh) {
  const inv = mesh.bindMatrixInverse; const out = new Map(); const m = new THREE.Matrix4();
  mesh.skeleton.bones.forEach((b, i) => { const p = new THREE.Vector3().setFromMatrixPosition(m.copy(mesh.skeleton.boneInverses[i]).invert()).applyMatrix4(inv); out.set(i, p); });
  return out;
}

/** Face landmarks from the face meshes themselves: eye centres, mouth, chin, eye level. */
function faceLandmarks(faceMeshes) {
  const acc = (filter) => { const pts = []; for (const m of faceMeshes) if (filter.test(matName(m))) { const p = rest(m); for (let i = 0; i < p.length; i += 3) pts.push([p[i], p[i + 1], p[i + 2]]); } return pts; };
  const mean = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
  const iris = acc(/EyeIris/i); const mouth = acc(/FaceMouth/i); const face = acc(/Face_00_SKIN|_Face_.*SKIN|Face_SKIN/i);
  if (!iris.length || !face.length) return null;
  const left = mean(iris.filter((p) => p[0] > 0)); const right = mean(iris.filter((p) => p[0] < 0));
  const m = mouth.length ? mean(mouth) : [0, (left[1] + Math.min(...face.map((p) => p[1]))) / 2, left[2]];
  const chinY = Math.min(...face.filter((p) => Math.abs(p[0]) < 0.02).map((p) => p[1]).concat([Math.min(...face.map((p) => p[1]))]));
  const eyeR = Math.abs(left[0] - right[0]) * 0.42;
  return { left, right, mouth: m, chinY, eyeY: (left[1] + right[1]) / 2, eyeR, top: Math.max(...face.map((p) => p[1])) };
}

/** Deform the face meshes: eyes, face width, jaw, chin, mouth. */
function shapeFace(faceMeshes, s) {
  const L = faceLandmarks(faceMeshes);
  if (!L) return;
  const eyeYs = L.eyeY; const span = Math.max(0.01, eyeYs - L.chinY);
  for (const mesh of onePerBuffer(faceMeshes)) {
    const r = rest(mesh); const p = mesh.geometry.attributes.position.array;
    for (let i = 0; i < r.length; i += 3) {
      let x = r[i]; let y = r[i + 1]; const z = r[i + 2];
      // Eyes: scale about each eye's centre, move apart, raise or lower
      for (const c of [L.left, L.right]) {
        const d = Math.hypot(x - c[0], (y - c[1]) * 1.1);
        const w = 1 - smooth((d - L.eyeR) / L.eyeR);
        if (w <= 0) continue;
        const k = 1 + (s.eyeSize - 1) * w;
        x = c[0] + (x - c[0]) * k; y = c[1] + (y - c[1]) * k;
        x += Math.sign(c[0]) * s.eyeSpacing * L.eyeR * 0.25 * w;
        y += s.eyeHeight * L.eyeR * 0.25 * w;
      }
      // Below the eyes: face width, then the jaw towards the chin
      const t = smooth((eyeYs - y) / span);
      x *= 1 + (s.faceWidth - 1) * t * (1 - t * 0.4);
      x *= 1 + (s.jaw - 1) * smooth((eyeYs - y) / span - 0.35) ;
      // Mouth width about the mouth
      const dm = Math.hypot((x - L.mouth[0]) * 0.7, (y - L.mouth[1]) * 1.6);
      const wm = 1 - smooth((dm - L.eyeR * 0.9) / (L.eyeR * 0.9));
      if (wm > 0) x = L.mouth[0] + (x - L.mouth[0]) * (1 + (s.mouth - 1) * wm);
      // Chin: the lowest part of the face moves down or up
      y += s.chin * span * 0.12 * smooth((L.mouth[1] - y) / Math.max(0.005, L.mouth[1] - L.chinY));
      p[i] = x; p[i + 1] = y; p[i + 2] = z;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
  }
}

/** Deform the body (skin and outfit alike) by bone: limbs thicker, waist and hips wider, bust fuller. */
function shapeBody(bodyMeshes, s) {
  for (const mesh of onePerBuffer(bodyMeshes)) {
    const r = rest(mesh); const p = mesh.geometry.attributes.position.array;
    const si = mesh.geometry.attributes.skinIndex; const sw = mesh.geometry.attributes.skinWeight;
    if (!si || !sw) continue;
    const pos = bindPositions(mesh); const bones = mesh.skeleton.bones;
    const childOf = new Map(bones.map((b, i) => { const c = b.children.find((x) => x.isBone && bones.includes(x)); return [i, c ? bones.indexOf(c) : -1]; }));
    // What each bone does: thicken around its own axis (limbs), widen around the body's middle (waist, hips) or swell from its head (bust)
    const rule = bones.map((b) => {
      const n = b.name;
      if (/Bust/i.test(n)) return { kind: 'swell', f: s.bust };
      if (/UpperLeg/i.test(n)) return { kind: 'limb', f: s.thighs };
      if (/LowerLeg/i.test(n)) return { kind: 'limb', f: s.calves };
      if (/UpperArm/i.test(n)) return { kind: 'limb', f: s.upperArms };
      if (/_C_Spine$|J_Bip_C_Spine\b/i.test(n)) return { kind: 'girth', f: s.waist };
      if (/_C_Hips$/i.test(n)) return { kind: 'girth', f: s.hips };
      return null;
    });
    if (rule.every((x) => !x || x.f === 1)) { p.set(r); mesh.geometry.attributes.position.needsUpdate = true; continue; }
    const a = new THREE.Vector3(); const bvec = new THREE.Vector3(); const v = new THREE.Vector3(); const q = new THREE.Vector3();
    for (let i = 0; i < r.length / 3; i++) {
      v.set(r[i * 3], r[i * 3 + 1], r[i * 3 + 2]);
      const out = v.clone();
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k); if (!w) continue;
        const bi = si.getComponent(i, k); const ru = rule[bi]; if (!ru || ru.f === 1) continue;
        a.copy(pos.get(bi));
        if (ru.kind === 'swell') { out.addScaledVector(q.copy(v).sub(a), (ru.f - 1) * w); continue; }
        if (ru.kind === 'girth') { q.set(a.x, v.y, a.z); out.x += (v.x - q.x) * (ru.f - 1) * w; out.z += (v.z - q.z) * (ru.f - 1) * w; continue; }
        const ci = childOf.get(bi); if (ci < 0) continue;
        bvec.copy(pos.get(ci)).sub(a); const len2 = bvec.lengthSq(); if (!len2) continue;
        const t = Math.min(1, Math.max(0, q.copy(v).sub(a).dot(bvec) / len2));
        q.copy(a).addScaledVector(bvec, t);
        out.addScaledVector(q.subVectors(v, q), (ru.f - 1) * w);
      }
      p[i * 3] = out.x; p[i * 3 + 1] = out.y; p[i * 3 + 2] = out.z;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
  }
}

/** Proportions by bone scale; the feet are then put back on the floor. */
function shapeBones(rig, s) {
  const raw = (name) => rig.humanoid.getRawBoneNode(name);
  const keep = rig.scene.userData.restScales || (rig.scene.userData.restScales = new Map());
  const set = (bone, x, y, z) => {
    if (!bone) return;
    if (!keep.has(bone)) keep.set(bone, { s: bone.scale.clone(), p: bone.position.clone() });
    const r = keep.get(bone).s; bone.scale.set(r.x * x, r.y * y, r.z * z);
  };
  const shift = (bone, fx) => { if (!bone) return; if (!keep.has(bone)) keep.set(bone, { s: bone.scale.clone(), p: bone.position.clone() }); const r = keep.get(bone).p; bone.position.set(r.x * fx, r.y, r.z); };
  set(raw('head'), s.head, s.head / s.neck, s.head);
  set(raw('neck'), 1, s.neck, 1);
  for (const side of ['left', 'right']) {
    const sh = s.shoulders;
    shift(raw(`${side}UpperArm`), sh);
    set(raw(`${side}UpperArm`), s.arms, 1, 1);
    set(raw(`${side}Hand`), 1 / s.arms, 1, 1);
    set(raw(`${side}UpperLeg`), 1, s.legs, 1);
    set(raw(`${side}Foot`), 1, 1 / s.legs, 1);
  }
  rig.scene.scale.setScalar(s.height);
  rig.scene.position.y = 0;
  rig.scene.updateMatrixWorld(true);
  // Feet on the floor
  let lo = Infinity; const w = new THREE.Vector3();
  for (const n of ['leftFoot', 'rightFoot', 'leftToes', 'rightToes']) { const b = raw(n); if (b) { b.getWorldPosition(w); lo = Math.min(lo, w.y); } }
  if (Number.isFinite(lo)) { rig.scene.position.y = -lo + 0.035 * s.height; rig.scene.updateMatrixWorld(true); }
}

// ── Colour ────────────────────────────────────────────────────────────────

/** A recoloured copy of a texture: `fn(r, g, b)` (0..255) returns the new colour. Cached per texture and colour. */
const recolourCache = new Map();
function recolour(texture, key, fn) {
  if (!texture || !texture.image) return texture;
  const id = `${texture.uuid}:${key}`;
  if (recolourCache.has(id)) return recolourCache.get(id);
  const img = texture.image; const w = img.width; const h = img.height;
  const c = new OffscreenCanvas(w, h); const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h); const d = data.data;
  for (let i = 0; i < d.length; i += 4) { const o = fn(d[i], d[i + 1], d[i + 2]); d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = texture.flipY; t.colorSpace = texture.colorSpace; t.wrapS = texture.wrapS; t.wrapT = texture.wrapT;
  t.magFilter = texture.magFilter; t.minFilter = texture.minFilter; t.anisotropy = texture.anisotropy;
  recolourCache.set(id, t);
  return t;
}
const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/**
 * Keep the light and shade, take the new colour (hair, eyes, cloth). Shade is
 * measured against the texture's own average, so navy hair turned pink is as
 * bright a pink as blonde hair turned pink.
 */
const tint = (rgb, avgL) => (r, g, b) => { const k = Math.min(1.5, (lum(r, g, b) / Math.max(0.05, avgL)) * 0.92); return rgb.map((c) => Math.min(255, Math.round(c * k * 255))); };
/** Move the skin's average towards the new tone, keeping every blush and shadow. */
const tone = (rgb, avg) => (r, g, b) => [r, g, b].map((v, i) => Math.min(255, Math.round(v * (rgb[i] * 255) / Math.max(1, avg[i]))));

function averageColour(texture) {
  const img = texture.image; const c = new OffscreenCanvas(32, 32); const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 32, 32); const d = ctx.getImageData(0, 0, 32, 32).data;
  // The skin's own colour: the brightest half of the pixels (shadows and lines aside)
  const px = []; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
  px.sort((a, b) => lum(...b) - lum(...a));
  const top = px.slice(0, Math.max(1, px.length >> 1));
  return [0, 1, 2].map((k) => top.reduce((s, p) => s + p[k], 0) / top.length);
}

/** Which colour a material takes: 'skin', 'hair', 'eyes', 'top', 'bottom' or none. */
function colourSlot(name) {
  if (/EyeIris/i.test(name)) return 'eyes';
  if (/_SKIN\b|Body_00_SKIN|Face_00_SKIN/i.test(name)) return 'skin';
  if (/_HAIR\b|Hair/i.test(name) && !/Face|Eye/i.test(name)) return 'hair';
  if (/Tops|Onepiece|Outer/i.test(name)) return 'top';
  if (/Bottoms|Shoes|Accessory/i.test(name)) return 'bottom';
  return null;
}

/** Apply the colours to every material (each keeps its own textures to recolour from). */
function applyColours(root, colours) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const slot = colourSlot(m.name || ''); if (!slot) continue;
      const own = m.userData.ownMaps || (m.userData.ownMaps = { map: m.map, shade: m.shadeMultiplyTexture });
      const pal = PALETTES[slot === 'top' || slot === 'bottom' ? 'outfit' : slot];
      const choice = pal.find((c) => c.id === colours[slot]);
      if (!choice || !choice.rgb) { m.map = own.map; if ('shadeMultiplyTexture' in m) m.shadeMultiplyTexture = own.shade; m.needsUpdate = true; continue; }
      let fn;
      if (slot === 'skin') { if (!own.avg && own.map) own.avg = averageColour(own.map); fn = tone(choice.rgb, own.avg || [230, 200, 190]); }
      else { if (own.avgL === undefined && own.map) { const a = averageColour(own.map); own.avgL = lum(a[0], a[1], a[2]); } fn = tint(choice.rgb, own.avgL || 0.5); }
      m.map = recolour(own.map, `${slot}:${choice.id}`, fn);
      if ('shadeMultiplyTexture' in m && own.shade) m.shadeMultiplyTexture = recolour(own.shade, `${slot}:${choice.id}`, fn);
      m.needsUpdate = true;
    }
  });
}

// ── The character on stage ────────────────────────────────────────────────

/**
 * One mixed character: the rig and the donors whose face or hair it wears,
 * shaped and coloured. `vrms` maps model id to a freshly parsed VRM.
 */
export class Character {
  constructor(parts, vrms) {
    this.parts = parts;
    this.rig = vrms[parts.body];
    this.donors = [];
    for (const part of ['face', 'hair']) {
      const from = parts[part];
      if (from === parts.body) continue;
      // Hide the rig's own part, wear the donor's
      for (const m of skinnedMeshes(this.rig.scene)) if (partOf(m) === part) m.visible = false;
      const donor = vrms[from];
      graft(this.rig, donor, part);
      this.donors.push({ part, vrm: donor });
    }
    this.faceOwner = (this.donors.find((d) => d.part === 'face') || { vrm: this.rig }).vrm;
    this.root = this.rig.scene;
    this.relax();
  }

  /** The visible meshes of a part. */
  meshes(part) { return skinnedMeshes(this.root).filter((m) => m.visible && partOf(m) === part); }

  /** Arms down by the sides, a natural stance (the models are made in a T pose). */
  relax() {
    const h = this.rig.humanoid; const n = (b) => h.getNormalizedBoneNode(b);
    const set = (b, x, y, z) => { const o = n(b); if (o) o.rotation.set(x, y, z); };
    set('leftUpperArm', 0, 0, 1.2); set('rightUpperArm', 0, 0, -1.2);
    set('leftLowerArm', 0, 0.15, 0); set('rightLowerArm', 0, -0.15, 0);
    set('leftHand', 0, 0, 0.08); set('rightHand', 0, 0, -0.08);
    this.rig.update(0);
  }

  setShape(shape) {
    shapeBones(this.rig, shape);
    shapeFace(this.meshes('face'), shape);
    shapeBody(this.meshes('body'), shape);
  }

  setColours(colours) { applyColours(this.root, colours); }

  setExpression(id) {
    const em = this.faceOwner.expressionManager; if (!em) return;
    // VRoid keeps Surprised as a custom expression named with a capital letter
    const nameOf = (e) => [e, e[0].toUpperCase() + e.slice(1)].find((n) => em.getExpression(n)) || null;
    for (const e of EXPRESSIONS) { if (e.id === 'neutral') continue; const n = nameOf(e.id); if (n) em.setValue(n, e.id === id ? 1 : 0); }
    this.expression = id;
  }

  /** Look at a point (the camera), with the eyes. */
  lookAt(target) { if (this.rig.lookAt) this.rig.lookAt.target = target; }

  /** One step of life: breathing, blinking, hair physics, expressions. */
  update(dt, time) {
    const h = this.rig.humanoid; const chest = h.getNormalizedBoneNode('chest') || h.getNormalizedBoneNode('spine');
    if (chest) chest.rotation.x = Math.sin(time * 1.6) * 0.015;
    const em = this.faceOwner.expressionManager;
    if (em) {
      const phase = time % 4.2;
      const closing = this.expression === 'happy' || this.expression === 'relaxed' ? 0 : phase < 0.08 ? phase / 0.08 : phase < 0.16 ? (0.16 - phase) / 0.08 : 0;
      em.setValue('blink', closing);
    }
    this.rig.update(dt);
    for (const d of this.donors) {
      if (d.vrm.springBoneManager) d.vrm.springBoneManager.update(dt);
      if (d.part === 'face' && d.vrm.expressionManager) d.vrm.expressionManager.update();
    }
  }

  dispose() {
    THREE.VRMUtils.deepDispose(this.root);
    for (const d of this.donors) THREE.VRMUtils.deepDispose(d.vrm.scene);
  }
}
