// viewer.js — the 3D view: the figure, its looks, light, and a camera that
// turns by mouse, finger, pen and keys. It draws only when something changed
// (a slider, a turn, a resize): idle, it does nothing.

import * as THREE from './vendor/three.min.js';
import { Figure, smoothNormals, scatter } from './figure.js';

/** Hair colours: a tint over the hair texture's light and dark, or none (the texture's own). */
export const HAIR_COLOURS = [
  { id: 'natural', name: 'As drawn', rgb: null },
  { id: 'black', name: 'Black', rgb: [0.05, 0.045, 0.04] },
  { id: 'dark-brown', name: 'Dark brown', rgb: [0.16, 0.09, 0.05] },
  { id: 'brown', name: 'Brown', rgb: [0.32, 0.19, 0.1] },
  { id: 'auburn', name: 'Auburn', rgb: [0.45, 0.16, 0.07] },
  { id: 'copper', name: 'Copper', rgb: [0.72, 0.32, 0.12] },
  { id: 'blonde', name: 'Blonde', rgb: [0.85, 0.66, 0.4] },
  { id: 'platinum', name: 'Platinum', rgb: [0.92, 0.88, 0.8] },
  { id: 'grey', name: 'Grey', rgb: [0.55, 0.54, 0.52] },
  { id: 'white', name: 'White', rgb: [0.93, 0.93, 0.92] },
];

/** How far light scatters under the skin, per channel (red goes furthest). */
const SKIN_SCATTER = new THREE.Vector3(0.48, 0.2, 0.12);
const DIFFUSE_LINE = 'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );';

/** The physical shader with wrap lighting for skin: light reaches past the shadow line, reddened. */
function skinShader(shader) {
  shader.uniforms.pxScatter = { value: SKIN_SCATTER };
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!chunk.includes(DIFFUSE_LINE)) return;   // a three.js that changed its lighting: plain skin
  const skin = chunk.replace(DIFFUSE_LINE, [
    'float pxNdl = dot( geometryNormal, directLight.direction );',
    'vec3 pxWrap = saturate( ( vec3( pxNdl ) + pxScatter ) / ( 1.0 + pxScatter ) );',
    'vec3 pxScattered = ( pxWrap - vec3( saturate( pxNdl ) ) ) * directLight.color;',
    'reflectedLight.directDiffuse += ( irradiance + pxScattered ) * diffuseBRDF * ( 1.0 - F );',
  ].join('\n'));
  shader.fragmentShader = 'uniform vec3 pxScatter;\n' + shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', skin);
}
export const SKIN_SHADER_HOOK_FOUND = THREE.ShaderChunk.lights_physical_pars_fragment.includes(DIFFUSE_LINE);

/** Hair tint: the texture's light and dark kept, its colour replaced. */
function tintShader(material, tint) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pxTint = tint.colour; shader.uniforms.pxTintOn = tint.on;
    shader.fragmentShader = 'uniform vec3 pxTint;\nuniform float pxTintOn;\n' + shader.fragmentShader.replace('#include <map_fragment>', [
      '#include <map_fragment>',
      'float pxLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );',
      'diffuseColor.rgb = mix( diffuseColor.rgb, pxTint * smoothstep( 0.0, 0.6, pxLum ) * 1.6, pxTintOn );',
    ].join('\n'));
  };
}

/** A tiling normal map of fine skin texture (pores and creases), drawn once. */
function poreNormalMap(size = 512) {
  const h = new Float32Array(size * size);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Pores: small soft dimples
  for (let n = 0; n < 2600; n++) {
    const cx = rnd() * size; const cy = rnd() * size; const r = 0.8 + rnd() * 1.6; const d = 0.4 + rnd() * 0.6;
    for (let y = Math.floor(cy - r * 2); y <= cy + r * 2; y++) for (let x = Math.floor(cx - r * 2); x <= cx + r * 2; x++) {
      const dd = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
      if (dd < 4) h[((y + size) % size) * size + ((x + size) % size)] -= d * Math.exp(-dd);
    }
  }
  // Fine creases: faint random lines
  for (let n = 0; n < 220; n++) {
    let x = rnd() * size; let y = rnd() * size; const a = rnd() * Math.PI; const len = 10 + rnd() * 30;
    for (let s = 0; s < len; s++) { h[((Math.floor(y) % size + size) % size) * size + ((Math.floor(x) % size + size) % size)] -= 0.35; x += Math.cos(a); y += Math.sin(a); }
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.8; const dy = (at(x, y + 1) - at(x, y - 1)) * 0.8;
    const l = Math.hypot(dx, dy, 1); const i = (y * size + x) * 4;
    data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255); data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(28, 28);
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class Viewer {
  /**
   * @param api the extension API  @param host the element the view fills
   * @param figure a loaded Figure
   */
  constructor(api, host, figure) {
    this.api = api; this.figure = figure; this.host = host;
    this.disposed = false; this.pending = 0; this.textures = new Map(); this.meshes = new Map();
    this.look = {}; this.shape = null; this.computed = null;
    this.hairTint = { colour: { value: new THREE.Vector3(0.3, 0.2, 0.1) }, on: { value: 0 } };

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    this.canvas = r.domElement;
    this.canvas.className = 'cs-canvas';
    host.appendChild(this.canvas);

    const scene = this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    this.envTexture = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.envTexture; scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.95, 0.88), 2.6);
    key.position.set(1.4, 2.6, 2.4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.2, near: 0.5, far: 8 });
    const rim = new THREE.DirectionalLight(new THREE.Color().setRGB(0.82, 0.9, 1), 1.5); rim.position.set(-1.8, 2.2, -2.2);
    const fill = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.97, 0.94), 0.45); fill.position.set(-2.4, 1.2, 1.6);
    scene.add(key, key.target, rim, fill);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true;
    scene.add(this.ground);

    // The body
    const g = this.bodyGeometry = new THREE.BufferGeometry();
    const n = figure.gpuSource.length;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(figure.uv, 2));
    g.setIndex(new THREE.BufferAttribute(figure.indices, 1));
    this.skin = new THREE.MeshPhysicalMaterial({
      roughness: 0.5, ior: 1.4, specularIntensity: 0.6,
      sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color().setRGB(1, 0.86, 0.8),
      normalMap: poreNormalMap(), normalScale: new THREE.Vector2(0.16, 0.16),
    });
    this.skin.onBeforeCompile = skinShader;
    this.body = new THREE.Mesh(g, this.skin);
    this.body.castShadow = true; this.body.receiveShadow = true;
    scene.add(this.body);

    // Camera: a turn around a point, a tilt and a distance
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    this.orbit = { yaw: 0.35, pitch: 0.08, distance: 4.2, target: new THREE.Vector3(0, 0.9, 0) };
    this.framing = 'body';

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  // ── Shape and look ──────────────────────────────────────────────────

  /** Reshape the body and everything fitted to it. */
  setShape(shape) {
    this.shape = shape;
    const fig = this.figure;
    this.computed = fig.compute(shape, this.computed || {});
    const g = this.bodyGeometry;
    scatter(this.computed.positions, fig.gpuSource, g.attributes.position.array);
    smoothNormals(this.computed.positions, fig.sourceTriangles, fig.gpuSource, g.attributes.normal.array);
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    g.computeBoundingSphere(); g.computeBoundingBox();
    for (const [id, mesh] of this.meshes) if (mesh.visible) this.fitItem(id, mesh);
    this.reframe(false);
    this.requestRender();
  }

  fitItem(id, mesh) {
    const item = this.figure.itemById.get(id);
    const local = this.figure.proxyPositions(item, this.computed.positions, mesh.userData.local);
    mesh.userData.local = local;
    const pos = mesh.geometry.attributes.position.array;
    const src = item.source;
    for (let g = 0; g < src.length; g++) { const v = src[g] * 3; pos[g * 3] = local[v]; pos[g * 3 + 1] = local[v + 1]; pos[g * 3 + 2] = local[v + 2]; }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }

  /** A texture the extension ships, loaded once. */
  async texture(path, colour = true) {
    if (!path) return null;
    if (!this.textures.has(path)) {
      this.textures.set(path, (async () => {
        const bytes = await this.api.env.readAsset(`figure/${path}`);
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { imageOrientation: 'flipY' });
        const t = new THREE.Texture(bitmap);
        t.flipY = false; t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        t.needsUpdate = true;
        return t;
      })());
    }
    return this.textures.get(path);
  }

  /** The proxy mesh for an item, made the first time it is shown. */
  async itemMesh(id) {
    if (this.meshes.has(id)) return this.meshes.get(id);
    const item = this.figure.itemById.get(id);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(item.source.length * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(item.uv, 2));
    g.setIndex(new THREE.BufferAttribute(item.indices, 1));
    const map = await this.texture(item.texture);
    let material;
    if (item.kind === 'eyes') {
      material = new THREE.MeshPhysicalMaterial({ map, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04, ior: 1.38 });
    } else if (item.kind === 'hair') {
      material = new THREE.MeshStandardMaterial({ map, roughness: 0.5, side: THREE.DoubleSide, alphaTest: 0.35, alphaToCoverage: true });
      tintShader(material, this.hairTint);
    } else if (item.kind === 'eyebrows' || item.kind === 'eyelashes') {
      material = new THREE.MeshStandardMaterial({ map, roughness: 0.7, side: THREE.DoubleSide, transparent: true, depthWrite: false, alphaTest: 0.04 });
      if (item.kind === 'eyebrows') tintShader(material, this.hairTint);
    } else {
      material = new THREE.MeshStandardMaterial({ map, roughness: item.kind === 'teeth' ? 0.3 : 0.45 });
    }
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = item.kind === 'hair'; mesh.receiveShadow = true;
    mesh.renderOrder = item.kind === 'eyelashes' || item.kind === 'eyebrows' ? 2 : 1;
    mesh.userData.kind = item.kind;
    this.meshes.set(id, mesh);
    this.scene.add(mesh);
    if (this.computed) this.fitItem(id, mesh);
    return mesh;
  }

  /**
   * The look: { skin, iris, hair, hairColour, eyebrows, eyelashes } (ids from
   * the figure's lists; hair, eyebrows and eyelashes may be 'none').
   */
  async setLook(look) {
    this.look = { ...look };
    const fig = this.figure;
    const skin = fig.meta.skins.find((s) => s.id === look.skin) || fig.meta.skins[0];
    this.skin.map = await this.texture(skin.texture); this.skin.needsUpdate = true;
    const wanted = new Set(['eyes/high-poly', 'teeth/teeth_base', 'tongue/tongue01']);
    for (const kind of ['hair', 'eyebrows', 'eyelashes']) if (look[kind] && look[kind] !== 'none' && fig.itemById.has(look[kind])) wanted.add(look[kind]);
    for (const id of wanted) { const m = await this.itemMesh(id); if (!m.visible) { m.visible = true; this.fitItem(id, m); } }
    for (const [id, m] of this.meshes) if (!wanted.has(id)) m.visible = false;
    const eyes = this.meshes.get('eyes/high-poly');
    const iris = fig.meta.irises.find((i) => i.id === look.iris) || fig.meta.irises[0];
    eyes.material.map = await this.texture(iris.texture); eyes.material.needsUpdate = true;
    const colour = HAIR_COLOURS.find((c) => c.id === look.hairColour) || HAIR_COLOURS[0];
    this.hairTint.on.value = colour.rgb ? 1 : 0;
    if (colour.rgb) this.hairTint.colour.value.set(...colour.rgb);
    this.requestRender();
  }

  // ── Camera ──────────────────────────────────────────────────────────

  /** Frame the whole body or the face; `snap` also resets the turn. */
  frame(which, snap = true) {
    this.framing = which;
    if (snap) { this.orbit.yaw = which === 'face' ? 0.25 : 0.35; this.orbit.pitch = which === 'face' ? 0.02 : 0.08; }
    this.reframe(true);
  }

  reframe(force) {
    if (!this.computed) return;
    const { lo, hi, height } = Figure.heightOf(this.computed.positions);
    if (this.framing === 'face') {
      const head = this.headCentre();
      this.orbit.target.set(head.x, head.y, head.z);
      if (force) this.orbit.distance = Math.max(0.45, height * 0.36);
    } else {
      this.orbit.target.set(0, lo + height * 0.52, 0);
      if (force) this.orbit.distance = Math.max(1.2, height * 2.35);
    }
    this.requestRender();
  }

  /** Between the eyes, a little back: what the face framing looks at. */
  headCentre() {
    const eyes = this.meshes.get('eyes/high-poly');
    if (eyes && eyes.geometry.boundingSphere) { const c = eyes.geometry.boundingSphere.center; return { x: c.x, y: c.y - 0.03, z: c.z - 0.03 }; }
    const { hi } = Figure.heightOf(this.computed.positions);
    return { x: 0, y: hi - 0.12, z: 0 };
  }

  turn(dYaw, dPitch) {
    this.orbit.yaw += dYaw;
    this.orbit.pitch = Math.max(-0.6, Math.min(1.1, this.orbit.pitch + dPitch));
    this.requestRender();
  }

  zoom(factor) {
    this.orbit.distance = Math.max(0.3, Math.min(9, this.orbit.distance * factor));
    this.requestRender();
  }

  placeCamera() {
    const { yaw, pitch, distance, target } = this.orbit;
    this.camera.position.set(target.x + distance * Math.sin(yaw) * Math.cos(pitch), target.y + distance * Math.sin(pitch), target.z + distance * Math.cos(yaw) * Math.cos(pitch));
    this.camera.lookAt(target);
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  resize() {
    const w = Math.max(1, this.host.clientWidth); const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this.pending || this.disposed) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.draw(); });
  }

  draw() {
    if (this.disposed) return;
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * A square picture of the face (a PNG data URL) for the character list.
   * Drawn and copied, then the view drawn back, in one go: nothing flickers.
   */
  async thumbnail(size = 160) {
    const saved = { ...this.orbit, target: this.orbit.target.clone() }; const framing = this.framing;
    this.frame('face');
    this.draw();
    const src = this.canvas; const s = Math.min(src.width, src.height);
    const c = new OffscreenCanvas(size, size);
    c.getContext('2d').drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    Object.assign(this.orbit, saved); this.framing = framing;
    this.draw();
    const blob = await c.convertToBlob({ type: 'image/png' });
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  }

  dispose() {
    this.disposed = true;
    if (this.pending) cancelAnimationFrame(this.pending);
    this.resizeObserver.disconnect();
    for (const m of this.meshes.values()) { m.geometry.dispose(); m.material.dispose(); }
    this.bodyGeometry.dispose(); this.skin.normalMap.dispose(); this.skin.dispose();
    this.ground.geometry.dispose(); this.ground.material.dispose();
    this.envTexture.dispose();
    for (const p of this.textures.values()) p.then((t) => t && t.dispose(), () => {});
    this.renderer.dispose();
    this.canvas.remove();
  }
}


