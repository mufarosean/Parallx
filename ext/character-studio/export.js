// export.js — the character as a .glb file (glTF binary): the body and
// everything fitted to it as skinned meshes on the MakeHuman skeleton, in the
// shape and look shown, so another program can pose it.

import * as THREE from './vendor/three.min.js';
import { HAIR_COLOURS } from './viewer.js';

/** The figure's bones as a three.js hierarchy, each at its head. */
function buildSkeleton(figure, bonePoints) {
  const bones = figure.meta.bones.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
  figure.meta.bones.forEach((b, i) => {
    const h = [bonePoints[i * 6], bonePoints[i * 6 + 1], bonePoints[i * 6 + 2]];
    if (b.parent >= 0) {
      const p = figure.meta.bones[b.parent] && b.parent;
      bones[p].add(bones[i]);
      bones[i].position.set(h[0] - bonePoints[p * 6], h[1] - bonePoints[p * 6 + 1], h[2] - bonePoints[p * 6 + 2]);
    } else bones[i].position.set(h[0], h[1], h[2]);
  });
  return bones;
}

/** Four bones a GPU vertex, from four a body vertex. */
function scatterSkin(index, weight, source) {
  const si = new Uint16Array(source.length * 4); const sw = new Float32Array(source.length * 4);
  for (let g = 0; g < source.length; g++) { const v = source[g] * 4; for (let k = 0; k < 4; k++) { si[g * 4 + k] = index[v + k]; sw[g * 4 + k] = weight[v + k]; } }
  return { si, sw };
}

/** The hair colour painted into a copy of the texture (the view tints in its shader). */
function tintedTexture(texture, rgb) {
  const img = texture.image;
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height); const d = data.data;
  const toLin = (x) => (x / 255) ** 2.2; const toS = (x) => Math.round(255 * Math.min(1, Math.max(0, x)) ** (1 / 2.2));
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.2126 * toLin(d[i]) + 0.7152 * toLin(d[i + 1]) + 0.0722 * toLin(d[i + 2]);
    const t = Math.min(1, lum / 0.6); const s = t * t * (3 - 2 * t) * 1.6;
    d[i] = toS(rgb[0] * s); d[i + 1] = toS(rgb[1] * s); d[i + 2] = toS(rgb[2] * s);
  }
  ctx.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.flipY = false; out.colorSpace = THREE.SRGBColorSpace;
  return out;
}

/** The export scene: one skinned mesh per visible part, sharing one skeleton. */
export function buildExportScene(viewer) {
  const figure = viewer.figure; const { bones: bonePoints } = viewer.computed;
  const scene = new THREE.Scene();
  const group = new THREE.Group(); group.name = 'Character';
  scene.add(group);
  const bones = buildSkeleton(figure, bonePoints);
  const roots = bones.filter((b) => !b.parent);
  for (const r of roots) group.add(r);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const tint = HAIR_COLOURS.find((c) => c.id === viewer.look.hairColour);

  const add = (name, geometry, material, skin) => {
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin.si, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skin.sw, 4));
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = name;
    group.add(mesh);
    mesh.bind(skeleton);
  };

  // Body
  const bg = new THREE.BufferGeometry();
  for (const a of ['position', 'normal', 'uv']) bg.setAttribute(a, viewer.bodyGeometry.attributes[a].clone());
  bg.setIndex(viewer.bodyGeometry.index.clone());
  const skinMat = new THREE.MeshPhysicalMaterial({ name: 'Skin', map: viewer.skin.map, roughness: viewer.skin.roughness, sheen: viewer.skin.sheen, sheenRoughness: viewer.skin.sheenRoughness, sheenColor: viewer.skin.sheenColor, ior: viewer.skin.ior });
  add('Body', bg, skinMat, scatterSkin(figure.skinIndex, figure.skinWeight, figure.gpuSource));

  // Fitted parts
  for (const [id, mesh] of viewer.meshes) {
    if (!mesh.visible) continue;
    const item = figure.itemById.get(id);
    const g = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'uv']) if (mesh.geometry.attributes[a]) g.setAttribute(a, mesh.geometry.attributes[a].clone());
    g.setIndex(mesh.geometry.index.clone());
    const src = mesh.material;
    const tinted = tint && tint.rgb && (item.kind === 'hair' || item.kind === 'eyebrows');
    const map = tinted && src.map ? tintedTexture(src.map, tint.rgb) : src.map;
    const mat = new THREE.MeshStandardMaterial({ name: item.name, map, roughness: src.roughness, side: src.side, transparent: src.transparent, alphaTest: src.alphaTest });
    const ps = figure.proxySkin(item);
    add(item.name, g, mat, scatterSkin(ps.index, ps.weight, item.source));
  }
  return scene;
}

/** Bytes as base64, without building one huge string by hand. */
function toBase64(buffer) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([buffer], { type: 'application/octet-stream' }));
  });
}

/** Ask where to save, then write the .glb there. */
export async function exportGlb(api, viewer, name) {
  const electron = globalThis.parallxElectron;
  if (!electron || !electron.dialog || !electron.dialog.saveFile || !electron.fs || !electron.fs.writeFile) throw new Error('Exporting needs the desktop app.');
  const safe = String(name || 'Character').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Character';
  const target = await electron.dialog.saveFile({ title: 'Export Character', defaultName: `${safe}.glb`, filters: [{ name: 'glTF binary', extensions: ['glb'] }] });
  if (!target) return;
  const scene = buildExportScene(viewer);
  const glb = await new THREE.GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  const result = await electron.fs.writeFile(target, await toBase64(glb), 'base64');
  if (result && result.error) throw new Error(result.error.message || String(result.error));
  api.window.showInformationMessage(`Exported ${safe} to ${target}.`);
}
