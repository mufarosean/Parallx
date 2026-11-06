// viewer.js — the stage: the character, toon light, a camera that turns by
// mouse, finger, pen and keys, and a little life (breathing, blinking, hair
// that swings) while the view is on screen. Off screen, nothing runs.

import * as THREE from './vendor/three.min.js';
import { Character, parseVrm } from './anime.js';

export class Viewer {
  /** @param api the extension API  @param host the element the view fills  @param catalogue models/models.json */
  constructor(api, host, catalogue) {
    this.api = api; this.host = host; this.catalogue = catalogue;
    this.bytes = new Map();   // model id -> Promise<ArrayBuffer>
    this.character = null; this.data = null; this.disposed = false; this.loop = 0; this.visible = true;
    this.clock = new THREE.Clock();

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    this.canvas = r.domElement; this.canvas.className = 'cs-canvas';
    this.canvas.csViewer = this;   // for the hidden probe (tests/probes/character-studio-probe.mjs)
    host.appendChild(this.canvas);

    const scene = this.scene = new THREE.Scene();
    // The toon shader is made for one light at full strength (three-vrm's own examples)
    const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.98, 0.96), 2.3);
    sun.position.set(1.6, 2.6, 1.6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -1, right: 1, top: 2, bottom: -0.2, near: 0.5, far: 6 });
    sun.target.position.set(0, 0.8, 0);
    scene.add(sun, sun.target);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1.2, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true;
    scene.add(this.ground);

    this.camera = new THREE.PerspectiveCamera(24, 1, 0.05, 30);
    this.orbit = { yaw: 0.3, pitch: 0.05, distance: 4.4, target: new THREE.Vector3(0, 0.82, 0) };
    this.framing = 'body';
    this.eyesTarget = new THREE.Object3D(); scene.add(this.eyesTarget);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    // Life runs only while the view can be seen
    this.seen = new IntersectionObserver((entries) => { this.visible = entries.some((e) => e.isIntersecting); this.kick(); });
    this.seen.observe(this.canvas);
    this.onVisibility = () => this.kick();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  /** A model's file, read once. */
  modelBytes(id) {
    if (!this.bytes.has(id)) {
      const m = this.catalogue.models.find((x) => x.id === id);
      if (!m) return Promise.reject(new Error(`No character "${id}".`));
      this.bytes.set(id, this.api.env.readAsset(m.file));
    }
    return this.bytes.get(id);
  }

  /** Show `data` (a normalised character): rebuilds only when the parts changed. */
  async show(data) {
    const partsKey = JSON.stringify(data.parts);
    if (!this.character || this.partsKey !== partsKey) {
      const ids = [...new Set(Object.values(data.parts))];
      const vrms = {};
      await Promise.all(ids.map(async (id) => { vrms[id] = await parseVrm(await this.modelBytes(id)); }));
      if (this.disposed) return;
      const next = new Character(data.parts, vrms);
      next.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
      if (this.character) { this.scene.remove(this.character.root); this.character.dispose(); }
      this.character = next; this.partsKey = partsKey;
      this.scene.add(next.root);
      if (!this.noLook) next.lookAt(this.eyesTarget);
    }
    this.data = data;
    this.character.setShape(data.shape);
    this.character.setColours(data.colours);
    this.character.setExpression(data.expression);
    this.character.update(0, this.clock.elapsedTime);
    this.reframe(false);
    this.kick();
  }

  /** Only the sliders moved: reshape without rebuilding. */
  reshape(shape) { if (!this.character) return; this.data.shape = shape; this.character.setShape(shape); this.reframe(false); this.kick(); }

  // ── Camera ──

  frame(which, snap = true) {
    this.framing = which;
    if (snap) { this.orbit.yaw = which === 'face' ? 0.2 : 0.3; this.orbit.pitch = which === 'face' ? 0.02 : 0.05; }
    this.reframe(true);
  }

  /** Where the head is now (for the face framing). */
  headPoint() {
    const head = this.character && this.character.rig.humanoid.getRawBoneNode('head');
    const p = new THREE.Vector3(0, 1.35, 0);
    if (head) { head.getWorldPosition(p); p.y += 0.07 * (this.data ? this.data.shape.head : 1); }
    return p;
  }

  reframe(force) {
    const h = this.headPoint();
    const height = Math.max(0.8, h.y + 0.12);
    if (this.framing === 'face') { this.orbit.target.copy(h); if (force) this.orbit.distance = 0.9; }
    else { this.orbit.target.set(0, height * 0.5, 0); if (force) this.orbit.distance = height * 2.75; }
    this.kick();
  }

  turn(dYaw, dPitch) { this.orbit.yaw += dYaw; this.orbit.pitch = Math.max(-0.5, Math.min(1, this.orbit.pitch + dPitch)); this.kick(); }
  zoom(f) { this.orbit.distance = Math.max(0.35, Math.min(8, this.orbit.distance * f)); this.kick(); }

  placeCamera() {
    const { yaw, pitch, distance, target } = this.orbit;
    this.camera.position.set(target.x + distance * Math.sin(yaw) * Math.cos(pitch), target.y + distance * Math.sin(pitch), target.z + distance * Math.cos(yaw) * Math.cos(pitch));
    this.camera.lookAt(target);
    // The eyes follow the camera
    this.eyesTarget.position.copy(this.camera.position);
  }

  // ── Drawing ──

  resize() {
    const w = Math.max(1, this.host.clientWidth); const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.kick();
  }

  /** Run the loop while seen; it stops itself when not. */
  kick() {
    if (this.loop || this.disposed) return;
    this.clock.getDelta();
    this.loop = requestAnimationFrame(() => this.tick());
  }

  tick() {
    this.loop = 0;
    if (this.disposed) return;
    this.draw(Math.min(0.05, this.clock.getDelta()));
    if (this.visible && document.visibilityState === 'visible') this.loop = requestAnimationFrame(() => this.tick());
  }

  draw(dt = 0) {
    this.placeCamera();
    if (this.character) this.character.update(dt, this.clock.elapsedTime);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * A square picture (PNG data URL) of the face or the whole body, from a
   * fixed angle. Drawn, copied and the view drawn back in one go.
   */
  async picture({ size = 160, framing = 'face', yaw = 0.2 } = {}) {
    const saved = { ...this.orbit, target: this.orbit.target.clone() }; const keep = this.framing;
    this.frame(framing); this.orbit.yaw = yaw;
    this.draw(0);
    const src = this.canvas; const s = Math.min(src.width, src.height);
    const c = new OffscreenCanvas(size, size);
    c.getContext('2d').drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    Object.assign(this.orbit, saved); this.framing = keep;
    this.draw(0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  }

  /** A large picture of the whole view as it is, for saving. */
  async snapshot() {
    this.draw(0);
    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  dispose() {
    this.disposed = true;
    if (this.loop) cancelAnimationFrame(this.loop);
    this.resizeObserver.disconnect(); this.seen.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.character) this.character.dispose();
    this.ground.geometry.dispose(); this.ground.material.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
