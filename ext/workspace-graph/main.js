// Workspace Graph — Parallx Extension (M56)
// Obsidian-style force-directed graph visualization.
// All data lives under .parallx/extensions/workspace-graph/.
//
// Single-file constraint: Parallx loads extensions via blob URL,
// so all JS lives in this one file.

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

const EXT_ROOT = '.parallx/extensions/workspace-graph';
const SETTINGS_FILE = 'settings.json';

function _resolveUri(baseUri, path) {
  const base = baseUri.endsWith('/') ? baseUri.slice(0, -1) : baseUri;
  const rel = path.startsWith('/') ? path : '/' + path;
  return base + rel;
}

async function _ensureDir(fs, uri) {
  try { if (!(await fs.exists(uri))) await fs.mkdir(uri); } catch { /* ok */ }
}

async function _ensureNestedDirs(fs, baseUri, segments) {
  let current = baseUri;
  for (const seg of segments) {
    current = _resolveUri(current, seg);
    await _ensureDir(fs, current);
  }
  return current;
}

// Keys in GS that we persist (skip computed/non-serializable values)
const _PERSIST_KEYS = [
  'chargeStrength', 'linkDistance', 'linkStrengthMin', 'centerStrength',
  'collideRadius', 'velocityDecay',
  'nodeRadiusMin', 'nodeRadiusMax', 'nodeOpacity',
  'edgeColor', 'edgeWidth', 'edgeHoverWidth',
  'labelZoomStart', 'labelZoomFull',
  'showFiles', 'showCanvasPages', 'showSessions',
];

async function _loadSettings(api) {
  try {
    const fs = api.workspace?.fs;
    const root = api.workspace?.workspaceFolders?.[0]?.uri;
    if (!fs || !root) return;
    const path = _resolveUri(root, `${EXT_ROOT}/${SETTINGS_FILE}`);
    if (!(await fs.exists(path))) return;
    const { content } = await fs.readFile(path);
    const saved = JSON.parse(content);
    for (const k of _PERSIST_KEYS) {
      if (saved[k] !== undefined) GS[k] = saved[k];
    }
    console.log('[WorkspaceGraph] Settings loaded from workspace');
  } catch (err) {
    console.warn('[WorkspaceGraph] Failed to load settings:', err);
  }
}

let _saveTimer = null;
async function _saveSettings(api) {
  // Debounce — slider drag fires many events
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      const fs = api.workspace?.fs;
      const root = api.workspace?.workspaceFolders?.[0]?.uri;
      if (!fs || !root) return;
      await _ensureNestedDirs(fs, root, ['.parallx', 'extensions', 'workspace-graph']);
      const path = _resolveUri(root, `${EXT_ROOT}/${SETTINGS_FILE}`);
      const data = {};
      for (const k of _PERSIST_KEYS) data[k] = GS[k];
      await fs.writeFile(path, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn('[WorkspaceGraph] Failed to save settings:', err);
    }
  }, 500);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: PHYSICS ENGINE
// Architecture derived from obsidian-3d-graph (MIT, HananoshikaYomaru)
// which uses d3-force-3d under 3d-force-graph (vasturiano).
//
// Key insight: centering uses forceX + forceY (per-node pull toward origin),
// NOT forceCenter (uniform center-of-mass translation).
// This is what creates the tight Obsidian-style cluster.
//
// Forces:
//   forceX/forceY  — per-node centering pull toward origin
//   forceManyBody  — O(n²) repulsion, 1/d falloff
//   forceLink      — spring, degree-based strength, distance 100
//   forceCollide   — overlap prevention
// ═══════════════════════════════════════════════════════════════════════════════

// --- Mutable settings object — all values tunable via settings panel ---
const GS = {
  // Physics
  chargeStrength:  -40,    // repulsion strength (negative = repel)
  linkDistance:     50,     // target spring length
  linkStrengthMin: 0.08,   // floor for high-degree folders
  centerStrength:  0.12,   // per-node pull toward origin
  collideRadius:   5,      // overlap prevention padding
  velocityDecay:   0.6,    // damping (0=no damping, 1=frozen)

  // Display
  nodeRadiusMin:   1.5,
  nodeRadiusMax:   5,
  nodeOpacity:     0.65,   // base node opacity
  edgeColor:       'rgba(255,255,255,0.12)',  // neutral white
  edgeWidth:       0.5,
  edgeHoverWidth:  1.2,
  labelZoomStart:  4.0,    // zoom level where labels start fading in
  labelZoomFull:   8.0,    // zoom level where labels are fully visible

  // Visibility
  showFiles:       true,
  showCanvasPages: true,
  showSessions:    true,
};
const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 300); // ≈0.0228 → ~300 ticks
const ALPHA_MIN = 0.001;

let _alpha = 1;

// Pre-computed per-link strengths and biases (recomputed on data change).
let _linkStrengths = [];
let _linkBiases = [];
let _linkDistances = [];

/** Reset the simulation temperature so the graph reanimates. */
function resetSimulation() { _alpha = 1; }

// ── Shared graph model: single source of truth for both views ──
let _editorActive = false; // true when editor pane is open (it drives physics)
const _model = {
  nodes: [],
  edges: [],
  byId: new Map(),
  ready: false,
  _api: null,
  _listeners: [],

  onChange(fn) { this._listeners.push(fn); return { dispose: () => { const i = this._listeners.indexOf(fn); if (i >= 0) this._listeners.splice(i, 1); } }; },
  _notify() { for (const fn of this._listeners) fn(); },

  async refresh() {
    if (!this._api) return;
    const data = await buildGraphData(this._api);
    this.nodes = data.nodes;
    this.edges = data.edges;
    this.byId.clear();
    for (const n of this.nodes) this.byId.set(n.id, n);
    this.ready = true;
    resetSimulation();
    this._notify();
  },

  applyVisibility() {
    for (const n of this.nodes) {
      if (n.domain === 'file') n.visible = GS.showFiles;
      else if (n.domain === 'canvas-page') n.visible = GS.showCanvasPages;
      else if (n.domain === 'session') n.visible = GS.showSessions;
    }
  },

  recomputeSizes() {
    _computeNodeSizes(this.nodes, this.edges);
  },

  recomputeLinks() {
    computeLinkParams(this.nodes, this.edges, this.byId);
  },
};

/**
 * Compute link strengths and biases from current graph topology.
 * d3-force link strength default: 1 / min(count(source), count(target))
 * bias: count(source) / (count(source) + count(target))
 */
function computeLinkParams(nodes, edges, byId) {
  const count = new Map();
  for (const n of nodes) count.set(n.id, 0);
  for (const e of edges) {
    count.set(e.source, (count.get(e.source) || 0) + 1);
    count.set(e.target, (count.get(e.target) || 0) + 1);
  }

  _linkStrengths = new Array(edges.length);
  _linkBiases = new Array(edges.length);
  _linkDistances = new Array(edges.length);

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const cs = count.get(e.source) || 1;
    const ct = count.get(e.target) || 1;
    _linkStrengths[i] = Math.max(GS.linkStrengthMin, 1 / Math.min(cs, ct));
    _linkBiases[i] = cs / (cs + ct);
    _linkDistances[i] = GS.linkDistance;
  }
}

/**
 * Run one physics tick.
 * Order: alpha → centering(forceX/Y) → charge → link → collide → decay+integrate
 */
function physicsTick(nodes, edges, byId) {
  _alpha += (0 - _alpha) * ALPHA_DECAY;
  if (_alpha < ALPHA_MIN) return;

  // ── forceX + forceY: per-node centering toward origin ──
  // Unlike forceCenter (uniform mass translation), this pulls EACH node
  // individually toward (0,0). Outliers get pulled back proportionally.
  // obsidian-3d-graph: d3.forceX(0).strength(s), d3.forceY(0).strength(s)
  for (const n of nodes) {
    if (!n.visible || n.pinned) continue;
    n.vx += (0 - n.x) * GS.centerStrength * _alpha;
    n.vy += (0 - n.y) * GS.centerStrength * _alpha;
  }

  // ── forceManyBody: O(n²) repulsion, 1/d falloff ──
  // d3 manyBody: strength * alpha / d² applied to velocity
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!a.visible) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (!b.visible) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;

      // jiggle: if coincident, add tiny random displacement
      if (dx === 0) { dx = (Math.random() - 0.5) * 1e-6; d2 += dx * dx; }
      if (dy === 0) { dy = (Math.random() - 0.5) * 1e-6; d2 += dy * dy; }
      if (d2 < 1) d2 = 1; // distanceMin² clamp

      const w = GS.chargeStrength * _alpha / d2;
      // charge is negative → w is negative → a pushed AWAY from b
      if (!a.pinned) { a.vx += dx * w; a.vy += dy * w; }
      if (!b.pinned) { b.vx -= dx * w; b.vy -= dy * w; }
    }
  }

  // ── forceLink: spring force with degree-based strength ──
  // Uses anticipated positions (x + vx), bias by degree
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source || !target || !source.visible || !target.visible) continue;

    let dx = target.x + target.vx - source.x - source.vx;
    let dy = target.y + target.vy - source.y - source.vy;
    if (dx === 0) dx = (Math.random() - 0.5) * 1e-6;
    if (dy === 0) dy = (Math.random() - 0.5) * 1e-6;
    let l = Math.sqrt(dx * dx + dy * dy);

    l = (l - _linkDistances[i]) / l * _alpha * _linkStrengths[i];
    dx *= l;
    dy *= l;

    const b = _linkBiases[i];
    if (!target.pinned) { target.vx -= dx * b; target.vy -= dy * b; }
    if (!source.pinned) { source.vx += dx * (1 - b); source.vy += dy * (1 - b); }
  }

  // ── forceCollide: prevent node overlap ──
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!a.visible) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (!b.visible) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      const minDist = a.radius + b.radius + GS.collideRadius;
      const minDist2 = minDist * minDist;
      if (d2 < minDist2 && d2 > 0) {
        const d = Math.sqrt(d2);
        const overlap = (minDist - d) / d * 0.5;
        dx *= overlap; dy *= overlap;
        if (!a.pinned) { a.x -= dx; a.y -= dy; }
        if (!b.pinned) { b.x += dx; b.y += dy; }
      }
    }
  }

  // ── Velocity decay + position integration ──
  // d3: node.x += node.vx *= velocityDecay
  for (const n of nodes) {
    if (!n.visible) continue;
    if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
    n.x += (n.vx *= GS.velocityDecay);
    n.y += (n.vy *= GS.velocityDecay);
  }
}

/**
 * Arrange nodes in neat cluster circles (cluster snap mode).
 * Used when "Hide Edges" is toggled — pins all nodes and disables physics.
 */
function snapToClusters(nodes, cx, cy) {
  const groups = {};
  for (const n of nodes) {
    if (!n.visible) continue;
    if (!groups[n.domain]) groups[n.domain] = [];
    groups[n.domain].push(n);
  }

  const dirNames = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);

  const clusterMeta = [];
  for (const dir of dirNames) {
    const ns = groups[dir];
    const padding = 22;
    const maxR = Math.max(...ns.map(n => n.radius));
    const circumNeeded = ns.length * (maxR * 2 + padding);
    const ringR = ns.length === 1 ? 0 : ns.length === 2 ? 35 : Math.max(45, circumNeeded / (2 * Math.PI));
    const outerR = ringR + maxR + 20;
    clusterMeta.push({ dir, nodes: ns, ringR, outerR });
  }

  // Lay out in rows
  const GAP = 50;
  const maxRowWidth = Math.max(1200, clusterMeta.reduce((s, c) => s + c.outerR * 2, 0) * 0.55);
  const rows = [];
  let curRow = [], curRowWidth = 0;
  for (const cm of clusterMeta) {
    const w = cm.outerR * 2;
    if (curRow.length > 0 && curRowWidth + GAP + w > maxRowWidth) {
      rows.push(curRow);
      curRow = [cm]; curRowWidth = w;
    } else {
      if (curRow.length > 0) curRowWidth += GAP;
      curRow.push(cm); curRowWidth += w;
    }
  }
  if (curRow.length) rows.push(curRow);

  let totalHeight = 0;
  for (const row of rows) {
    totalHeight += Math.max(...row.map(c => c.outerR * 2));
  }
  totalHeight += (rows.length - 1) * GAP;

  let curY = cy - totalHeight / 2;
  for (const row of rows) {
    const rowH = Math.max(...row.map(c => c.outerR * 2));
    const rowW = row.reduce((s, c) => s + c.outerR * 2, 0) + (row.length - 1) * GAP;
    let curX = cx - rowW / 2;
    for (const cm of row) {
      cm.cx = curX + cm.outerR;
      cm.cy = curY + rowH / 2;
      curX += cm.outerR * 2 + GAP;
    }
    curY += rowH + GAP;
  }

  for (const cm of clusterMeta) {
    const ns = cm.nodes;
    ns.sort((a, b) => a.label.localeCompare(b.label));
    if (ns.length === 1) {
      ns[0].x = cm.cx; ns[0].y = cm.cy; ns[0].vx = 0; ns[0].vy = 0; ns[0].pinned = true;
    } else {
      for (let i = 0; i < ns.length; i++) {
        const a = (i / ns.length) * Math.PI * 2 - Math.PI / 2;
        ns[i].x = cm.cx + Math.cos(a) * cm.ringR;
        ns[i].y = cm.cy + Math.sin(a) * cm.ringR;
        ns[i].vx = 0; ns[i].vy = 0; ns[i].pinned = true;
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: DATA SERVICE
// Collects graph nodes and edges from workspace data sources.
// Obsidian-style color palette with connection-count-based node sizing.
// ═══════════════════════════════════════════════════════════════════════════════

// Obsidian color palette: nodes are desaturated green-gray, connected = brighter green.
const DOMAIN_COLORS = {
  'file': '#6bd385',
  'canvas-page': '#b4a7d6',
  'session': '#e9973f',
};

const EXT_COLORS = {
  '.ts': '#6baad3',
  '.js': '#a8c97a',
  '.css': '#7b9cd3',
  '.html': '#d38b6b',
  '.json': '#9b8fd3',
  '.md': '#b4a7d6',
  '.sql': '#c98aaa',
  '.mjs': '#a8c97a',
  '.cjs': '#a8c97a',
};

const DEFAULT_COLOR = '#6bd385';
// Node radius constants now in GS.nodeRadiusMin / GS.nodeRadiusMax

// d3 phyllotaxis: golden-angle spiral for initial positions.
// Source: simulation.js — initialRadius=10, initialAngle=PI*(3-sqrt(5))
const _PHYLLOTAXIS_RADIUS = 10;
const _PHYLLOTAXIS_ANGLE = Math.PI * (3 - Math.sqrt(5));
let _nodeIndex = 0;

function _makeNode(id, label, domain, color, radius, meta) {
  // d3 phyllotaxis initial position (instead of random scatter)
  const i = _nodeIndex++;
  const r = _PHYLLOTAXIS_RADIUS * Math.sqrt(0.5 + i);
  const angle = i * _PHYLLOTAXIS_ANGLE;
  return {
    id, label, domain, color, radius, meta: meta || {},
    x: r * Math.cos(angle),
    y: r * Math.sin(angle),
    vx: 0, vy: 0,
    pinned: false, visible: true,
  };
}

/**
 * Adjust node radius based on connection count.
 * Obsidian: "The more connections, the bigger the node."
 */
function _computeNodeSizes(nodes, edges) {
  const deg = new Map();
  for (const n of nodes) deg.set(n.id, 0);
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) || 0) + 1);
    deg.set(e.target, (deg.get(e.target) || 0) + 1);
  }
  for (const n of nodes) {
    const d = deg.get(n.id) || 0;
    // Obsidian: tiny dots, hubs slightly larger. log scale.
    n.radius = d === 0 ? GS.nodeRadiusMin : Math.min(GS.nodeRadiusMax, GS.nodeRadiusMin + Math.log2(1 + d) * 1.2);
  }
}

async function buildGraphData(api) {
  const nodes = [];
  const edges = [];
  _nodeIndex = 0; // reset phyllotaxis counter

  await Promise.all([
    _collectFiles(api, nodes, edges),
    _collectCanvasPages(api, nodes, edges),
    _collectSessions(api, nodes, edges),
  ]);

  _computeNodeSizes(nodes, edges);

  // Pre-compute d3-force link parameters (strengths, biases, distances)
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, n);
  computeLinkParams(nodes, edges, byId);

  return { nodes, edges };
}

async function _collectFiles(api, nodes, edges) {
  const folders = api.workspace.workspaceFolders;
  if (!folders || folders.length === 0 || !api.workspace.fs) return;

  const rootUri = folders[0].uri;
  const MAX_DEPTH = 3;
  const queue = [{ uri: rootUri, parentId: null, depth: 0 }];

  while (queue.length > 0) {
    const { uri, parentId, depth } = queue.shift();
    if (depth > MAX_DEPTH) continue;

    let entries;
    try { entries = await api.workspace.fs.readdir(uri); } catch { continue; }

    for (const entry of entries) {
      const childUri = uri.endsWith('/') ? uri + entry.name : uri + '/' + entry.name;
      const nodeId = 'file:' + childUri;

      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;

      if (entry.type === 2) {
        nodes.push(_makeNode(nodeId, entry.name, 'file', '#8e8e8e', 4, { type: 'directory', uri: childUri }));
        if (parentId) edges.push({ source: parentId, target: nodeId });
        queue.push({ uri: childUri, parentId: nodeId, depth: depth + 1 });
      } else {
        const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop() : '';
        const color = EXT_COLORS[ext] || DOMAIN_COLORS.file;
        nodes.push(_makeNode(nodeId, entry.name, 'file', color, 3, { type: 'file', uri: childUri, ext }));
        if (parentId) edges.push({ source: parentId, target: nodeId });
      }
    }
  }
}

async function _collectCanvasPages(api, nodes, edges) {
  if (!api.workspace.getCanvasPageTree) return;
  let tree;
  try { tree = await api.workspace.getCanvasPageTree(); } catch { return; }
  _walkPageTree(tree, null, nodes, edges);
}

function _walkPageTree(pages, parentNodeId, nodes, edges) {
  for (const page of pages) {
    const nodeId = 'page:' + page.id;
    const label = (page.icon ? page.icon + ' ' : '') + (page.title || 'Untitled');
    nodes.push(_makeNode(
      nodeId, label, 'canvas-page', DOMAIN_COLORS['canvas-page'],
      4 + (page.children && page.children.length > 0 ? 2 : 0),
      { type: 'canvas-page', pageId: page.id, title: page.title, icon: page.icon, isFavorited: page.isFavorited },
    ));
    if (parentNodeId) edges.push({ source: parentNodeId, target: nodeId });
    if (page.children && page.children.length > 0) _walkPageTree(page.children, nodeId, nodes, edges);
  }
}

async function _collectSessions(api, nodes, edges) {
  const folders = api.workspace.workspaceFolders;
  if (!folders || folders.length === 0 || !api.workspace.fs) return;

  const rootUri = folders[0].uri;
  const sessionsUri = rootUri.endsWith('/') ? rootUri + '.parallx/sessions' : rootUri + '/.parallx/sessions';

  let exists;
  try { exists = await api.workspace.fs.exists(sessionsUri); } catch { return; }
  if (!exists) return;

  let entries;
  try { entries = await api.workspace.fs.readdir(sessionsUri); } catch { return; }

  for (const entry of entries) {
    if (entry.type !== 1 || !entry.name.endsWith('.json')) continue;
    const nodeId = 'session:' + entry.name;
    const label = entry.name.replace('.json', '');
    nodes.push(_makeNode(nodeId, label, 'session', DOMAIN_COLORS.session, 3, { type: 'session', fileName: entry.name }));
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: RENDERER
// Obsidian-style: straight lines, filled circles, text fade threshold.
// No cluster halos, no curved edges, no arrowheads.
// ═══════════════════════════════════════════════════════════════════════════════

function _rgba(hex, a) {
  const c = hex.replace('#', '');
  return `rgba(${parseInt(c.slice(0, 2), 16)},${parseInt(c.slice(2, 4), 16)},${parseInt(c.slice(4, 6), 16)},${a})`;
}

function _getConnected(edges, nodeId) {
  const s = new Set();
  for (const e of edges) {
    if (e.source === nodeId) s.add(e.target);
    if (e.target === nodeId) s.add(e.source);
  }
  return s;
}

function hitTest(nodes, sx, sy, view) {
  const wx = (sx - view.x) / view.s;
  const wy = (sy - view.y) / view.s;
  let best = null, bd = Infinity;
  for (const n of nodes) {
    if (!n.visible) continue;
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d < n.radius + 8 / Math.max(0.3, view.s) && d < bd) {
      best = n; bd = d;
    }
  }
  return best;
}

function fitAll(nodes, width, height) {
  if (width < 10 || height < 10) return { s: 1, x: width / 2, y: height / 2 };
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of nodes) {
    if (!n.visible) continue;
    x0 = Math.min(x0, n.x - 40); y0 = Math.min(y0, n.y - 40);
    x1 = Math.max(x1, n.x + 40); y1 = Math.max(y1, n.y + 40);
  }
  if (!isFinite(x0)) { x0 = -100; y0 = -100; x1 = 100; y1 = 100; }
  const s = Math.max(0.05, Math.min((width - 80) / (x1 - x0), (height - 80) / (y1 - y0), 1.5));
  return { s, x: width / 2 - (x0 + x1) / 2 * s, y: height / 2 - (y0 + y1) / 2 * s };
}

function drawGraph(ctx, cvs, nodes, edges, byId, view, selected, hovered, showEdges) {
  const dpr = Math.max(1, devicePixelRatio || 1);
  const w = cvs.clientWidth;
  const h = cvs.clientHeight;
  if (w < 2 || h < 2) return;
  cvs.width = Math.floor(w * dpr);
  cvs.height = Math.floor(h * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.s, view.s);

  // Obsidian: no sticky selection. Hover highlights node + neighbors.
  const hovConn = hovered ? _getConnected(edges, hovered.id) : new Set();
  const hasHov = !!hovered;
  const hasSel = false;
  const conn = new Set();

  // ── Edges: straight lines, Obsidian-style ──
  if (showEdges) {
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b || !a.visible || !b.visible) continue;

      const isSelEdge = false;
      const isHovEdge = hasHov && (e.source === hovered.id || e.target === hovered.id);
      const dim = (hasSel || hasHov) && !isSelEdge && !isHovEdge;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);

      if (isSelEdge) {
        ctx.strokeStyle = _rgba(selected.color, 0.55);
        ctx.lineWidth = 1.5;
      } else if (isHovEdge) {
        ctx.strokeStyle = _rgba(hovered.color, 0.4);
        ctx.lineWidth = GS.edgeHoverWidth;
      } else {
        ctx.strokeStyle = dim ? 'rgba(255,255,255,0.04)' : GS.edgeColor;
        ctx.lineWidth = GS.edgeWidth;
      }
      ctx.stroke();
    }
  }

  // ── Nodes: filled circles, no borders (Obsidian style) ──
  for (const n of nodes) {
    if (!n.visible) continue;
    const isHov = hovered && n.id === hovered.id;
    const isConn = hasHov && hovConn.has(n.id);
    const dim = hasHov && !isHov && !isConn;
    const r = n.radius * (isHov ? 1.15 : 1);

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

    if (isHov) {
      ctx.fillStyle = '#ffffff';
    } else if (isConn) {
      ctx.fillStyle = _rgba(n.color, 0.9);
    } else {
      ctx.fillStyle = _rgba(n.color, dim ? 0.06 : GS.nodeOpacity);
    }
    ctx.fill();

    // Pin indicator
    if (n.pinned && !dim) {
      ctx.beginPath();
      ctx.arc(n.x + r * 0.7, n.y - r * 0.7, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.fill();
    }
  }

  // ── Labels: hover + zoom-proximity (Obsidian behavior) ──
  // Obsidian shows labels on hover AND when zoomed in close.
  // Label opacity fades in based on zoom level.
  const zoomLabelAlpha = view.s < GS.labelZoomStart ? 0
    : view.s > GS.labelZoomFull ? 0.85
    : 0.85 * (view.s - GS.labelZoomStart) / (GS.labelZoomFull - GS.labelZoomStart);

  for (const n of nodes) {
    if (!n.visible) continue;
    const isHov = hovered && n.id === hovered.id;
    const isConn = (hasHov && hovConn.has(n.id));

    // Show label if: hovered node only (not neighbors), or zoomed in close enough
    let alpha = 0;
    if (isHov) alpha = 0.92;
    else alpha = zoomLabelAlpha;

    if (alpha < 0.02) continue;

    // Font size in world coords — divide by zoom so it stays ~11 screen-px
    const fs = Math.min(5, 11 / view.s);
    ctx.font = `400 ${fs}px -apple-system,"Segoe UI",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = `rgba(220,221,222,${alpha})`;
    ctx.fillText(n.label, n.x, n.y + n.radius + 3);
  }

  ctx.restore();
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: GRAPH EDITOR PANE
// Full editor with inspector, search, legend, controls, interaction.
// ═══════════════════════════════════════════════════════════════════════════════

function _el(tag, style) {
  const el = document.createElement(tag);
  if (style) el.style.cssText = style;
  return el;
}

function _btn(text) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = 'background:var(--vscode-button-secondaryBackground,#1a1a2e);color:var(--vscode-button-secondaryForeground,#aaa);border:1px solid var(--vscode-panel-border,#2a2a4a);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:var(--parallx-fontFamily-ui,-apple-system,"Segoe UI",sans-serif);';
  btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-button-secondaryHoverBackground,#222244)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--vscode-button-secondaryBackground,#1a1a2e)'; });
  return btn;
}

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createGraphEditor(container, api) {
  // Use shared model — same data as sidebar
  const m = _model;
  m._api = api;
  let selected = null;
  let hovered = null;
  let physicsOn = true;
  let showEdges = true;
  let animFrameId = null;
  let disposed = false;
  let view = { x: 0, y: 0, s: 1 };

  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.height = '100%';
  container.style.background = 'var(--vscode-editor-background,#1e1e1e)';
  container.style.color = 'var(--vscode-editor-foreground,#ccc)';
  container.style.fontFamily = 'var(--parallx-fontFamily-ui)';
  container.style.overflow = 'hidden';

  // ── Toolbar ──
  const toolbar = _el('div', 'display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--vscode-sideBar-background,#252525);border-bottom:1px solid var(--vscode-panel-border,#333);flex-shrink:0;');

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search nodes\u2026';
  searchInput.style.cssText = 'background:var(--vscode-input-background,#2a2a2a);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;padding:4px 8px;font-size:12px;width:200px;outline:none;font-family:var(--parallx-fontFamily-ui);';

  const physBtn = _btn('Pause Physics');
  const edgesBtn = _btn('Hide Edges');
  const fitBtn = _btn('Fit All');
  const refreshBtn = _btn('Refresh');
  const settingsBtn = _btn('\u2699 Settings');
  const nodeCount = _el('span', 'margin-left:auto;font-size:11px;color:var(--vscode-descriptionForeground,#666);');

  toolbar.append(searchInput, physBtn, edgesBtn, fitBtn, refreshBtn, settingsBtn, nodeCount);
  container.appendChild(toolbar);

  // ── Main area ──
  const main = _el('div', 'display:flex;flex:1;overflow:hidden;position:relative;');

  const cvs = document.createElement('canvas');
  cvs.style.cssText = 'flex:1;min-width:0;cursor:grab;';
  const ctx = cvs.getContext('2d');

  // Inspector panel
  const inspector = _el('div', 'width:0;overflow:hidden;background:var(--vscode-sideBar-background,#252525);border-left:1px solid var(--vscode-panel-border,#333);transition:width 200ms;flex-shrink:0;');
  const inspInner = _el('div', 'width:280px;padding:12px;font-size:12px;overflow-y:auto;height:100%;box-sizing:border-box;');
  inspector.appendChild(inspInner);

  // Settings panel — absolute-positioned over canvas for guaranteed visibility
  const settingsPanel = _el('div', 'position:absolute;top:0;right:0;width:0;height:100%;overflow:hidden;background:var(--vscode-sideBar-background,#252525);border-left:1px solid var(--vscode-panel-border,#333);transition:width 200ms;z-index:10;');
  const settingsInner = _el('div', 'width:260px;padding:12px;font-size:11px;overflow-y:auto;height:100%;box-sizing:border-box;');
  settingsPanel.appendChild(settingsInner);
  let settingsOpen = false;

  function _buildSettingsPanel() {
    const S = 'style="width:100%;margin:2px 0 8px;accent-color:var(--vscode-focusBorder,#007fd4);"';
    const L = 'style="display:flex;justify-content:space-between;color:var(--vscode-editor-foreground,#ccc);margin-top:6px;"';
    const H = 'style="color:var(--vscode-editor-foreground,#ddd);font-size:12px;font-weight:600;margin:12px 0 6px;border-bottom:1px solid var(--vscode-panel-border,#333);padding-bottom:4px;"';

    settingsInner.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="color:var(--vscode-editor-foreground,#fff);font-size:13px">Graph Settings</strong>
        <button id="__gs_close" style="background:none;border:none;color:var(--vscode-descriptionForeground,#666);cursor:pointer;font-size:16px">&times;</button>
      </div>

      <div ${H}>Forces</div>
      <div ${L}><span>Center Force</span><span id="__gs_v_center">${GS.centerStrength}</span></div>
      <input type="range" id="__gs_center" min="0.01" max="0.5" step="0.01" value="${GS.centerStrength}" ${S}>

      <div ${L}><span>Repel Force</span><span id="__gs_v_charge">${Math.abs(GS.chargeStrength)}</span></div>
      <input type="range" id="__gs_charge" min="5" max="200" step="1" value="${Math.abs(GS.chargeStrength)}" ${S}>

      <div ${L}><span>Link Distance</span><span id="__gs_v_linkdist">${GS.linkDistance}</span></div>
      <input type="range" id="__gs_linkdist" min="10" max="200" step="1" value="${GS.linkDistance}" ${S}>

      <div ${L}><span>Link Strength Min</span><span id="__gs_v_linkstr">${GS.linkStrengthMin}</span></div>
      <input type="range" id="__gs_linkstr" min="0.01" max="0.5" step="0.01" value="${GS.linkStrengthMin}" ${S}>

      <div ${L}><span>Collide Radius</span><span id="__gs_v_collide">${GS.collideRadius}</span></div>
      <input type="range" id="__gs_collide" min="0" max="20" step="1" value="${GS.collideRadius}" ${S}>

      <div ${L}><span>Damping</span><span id="__gs_v_decay">${GS.velocityDecay}</span></div>
      <input type="range" id="__gs_decay" min="0.1" max="0.95" step="0.05" value="${GS.velocityDecay}" ${S}>

      <div ${H}>Display</div>
      <div ${L}><span>Node Size Min</span><span id="__gs_v_nmin">${GS.nodeRadiusMin}</span></div>
      <input type="range" id="__gs_nmin" min="0.5" max="5" step="0.5" value="${GS.nodeRadiusMin}" ${S}>

      <div ${L}><span>Node Size Max</span><span id="__gs_v_nmax">${GS.nodeRadiusMax}</span></div>
      <input type="range" id="__gs_nmax" min="2" max="20" step="0.5" value="${GS.nodeRadiusMax}" ${S}>

      <div ${L}><span>Node Opacity</span><span id="__gs_v_nopa">${GS.nodeOpacity}</span></div>
      <input type="range" id="__gs_nopa" min="0.1" max="1" step="0.05" value="${GS.nodeOpacity}" ${S}>

      <div ${L}><span>Edge Width</span><span id="__gs_v_ew">${GS.edgeWidth}</span></div>
      <input type="range" id="__gs_ew" min="0.1" max="3" step="0.1" value="${GS.edgeWidth}" ${S}>

      <div ${L}><span>Label Zoom Start</span><span id="__gs_v_lzs">${GS.labelZoomStart}</span></div>
      <input type="range" id="__gs_lzs" min="1" max="15" step="0.5" value="${GS.labelZoomStart}" ${S}>

      <div ${L}><span>Label Zoom Full</span><span id="__gs_v_lzf">${GS.labelZoomFull}</span></div>
      <input type="range" id="__gs_lzf" min="2" max="20" step="0.5" value="${GS.labelZoomFull}" ${S}>

      <div ${H}>Show</div>
      <label style="display:flex;align-items:center;gap:6px;color:var(--vscode-editor-foreground,#ccc);margin:4px 0;cursor:pointer;">
        <input type="checkbox" id="__gs_files" ${GS.showFiles ? 'checked' : ''}> Files
      </label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--vscode-editor-foreground,#ccc);margin:4px 0;cursor:pointer;">
        <input type="checkbox" id="__gs_pages" ${GS.showCanvasPages ? 'checked' : ''}> Canvas Pages
      </label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--vscode-editor-foreground,#ccc);margin:4px 0;cursor:pointer;">
        <input type="checkbox" id="__gs_sessions" ${GS.showSessions ? 'checked' : ''}> Sessions
      </label>
    `;

    // Wire close button
    settingsInner.querySelector('#__gs_close').addEventListener('click', _toggleSettings);

    // Wire sliders
    const _wire = (id, key, transform, afterFn, restartSim) => {
      const el = settingsInner.querySelector('#__gs_' + id);
      const val = settingsInner.querySelector('#__gs_v_' + id);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        GS[key] = transform ? transform(v) : v;
        if (val) val.textContent = el.value;
        if (afterFn) afterFn();
        if (restartSim) resetSimulation();
        _saveSettings(api);
      });
    };

    _wire('center', 'centerStrength', null, null, true);
    _wire('charge', 'chargeStrength', v => -v, null, true);
    _wire('linkdist', 'linkDistance', null, () => m.recomputeLinks(), true);
    _wire('linkstr', 'linkStrengthMin', null, () => m.recomputeLinks(), true);
    _wire('collide', 'collideRadius', null, null, true);
    _wire('decay', 'velocityDecay', null, null, true);
    _wire('nmin', 'nodeRadiusMin', null, () => m.recomputeSizes(), false);
    _wire('nmax', 'nodeRadiusMax', null, () => m.recomputeSizes(), false);
    _wire('nopa', 'nodeOpacity', null, null, false);
    _wire('ew', 'edgeWidth', null, null, false);
    _wire('lzs', 'labelZoomStart', null, null, false);
    _wire('lzf', 'labelZoomFull', null, null, false);

    // Wire checkboxes (filter visibility)
    const _wireCheck = (id, key) => {
      const el = settingsInner.querySelector('#__gs_' + id);
      if (!el) return;
      el.addEventListener('change', () => {
        GS[key] = el.checked;
        m.applyVisibility();
        _saveSettings(api);
      });
    };
    _wireCheck('files', 'showFiles');
    _wireCheck('pages', 'showCanvasPages');
    _wireCheck('sessions', 'showSessions');
  }

  function _toggleSettings() {
    settingsOpen = !settingsOpen;
    if (settingsOpen) {
      _buildSettingsPanel();
      settingsPanel.style.width = '260px';
    } else {
      settingsPanel.style.width = '0';
    }
  }

  main.append(cvs, inspector);
  main.appendChild(settingsPanel);
  container.appendChild(main);

  // Wire the settings button
  settingsBtn.addEventListener('click', _toggleSettings);

  // Legend overlay
  const legend = _el('div', 'position:absolute;bottom:8px;left:8px;background:rgba(30,30,30,.85);border:1px solid var(--vscode-panel-border,#333);border-radius:6px;padding:8px 12px;font-size:11px;pointer-events:none;');
  legend.innerHTML = Object.entries(DOMAIN_COLORS).map(([k, c]) =>
    `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c}"></span>${_esc(k)}</div>`
  ).join('');
  main.appendChild(legend);

  // ── Event Handlers ──
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    for (const n of m.nodes) {
      n.visible = !q || n.label.toLowerCase().includes(q) || n.domain.toLowerCase().includes(q);
    }
    _redraw();
  });

  physBtn.addEventListener('click', () => {
    physicsOn = !physicsOn;
    physBtn.textContent = physicsOn ? 'Pause Physics' : 'Resume Physics';
    if (physicsOn) resetSimulation();
  });

  edgesBtn.addEventListener('click', () => {
    showEdges = !showEdges;
    edgesBtn.textContent = showEdges ? 'Hide Edges' : 'Show Edges';
    if (!showEdges) {
      const ccx = cvs.clientWidth / 2, ccy = cvs.clientHeight / 2;
      snapToClusters(m.nodes, (ccx - view.x) / view.s, (ccy - view.y) / view.s);
      physicsOn = false;
      physBtn.textContent = 'Resume Physics';
      _fitAndDraw();
    } else {
      for (const n of m.nodes) { n.pinned = false; n.vx = 0; n.vy = 0; }
      physicsOn = true;
      physBtn.textContent = 'Pause Physics';
      resetSimulation();
    }
  });

  fitBtn.addEventListener('click', _fitAndDraw);
  refreshBtn.addEventListener('click', _refresh);

  // Canvas interaction
  let dragNode = null;
  let panning = false;
  let panStart = null;

  cvs.addEventListener('pointerdown', (ev) => {
    const rect = cvs.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const node = hitTest(m.nodes, sx, sy, view);

    if (node) {
      if (ev.shiftKey) { node.pinned = !node.pinned; _redraw(); return; }
      dragNode = node;
      dragNode.pinned = true;
      resetSimulation();
      cvs.setPointerCapture(ev.pointerId);
      cvs.style.cursor = 'grabbing';
    } else {
      panning = true;
      panStart = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
      cvs.setPointerCapture(ev.pointerId);
      cvs.style.cursor = 'grabbing';
    }
  });

  cvs.addEventListener('pointermove', (ev) => {
    const rect = cvs.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;

    if (dragNode) {
      dragNode.x = (sx - view.x) / view.s;
      dragNode.y = (sy - view.y) / view.s;
      dragNode.vx = 0; dragNode.vy = 0;
      resetSimulation();
    } else if (panning && panStart) {
      view.x = panStart.vx + (ev.clientX - panStart.x);
      view.y = panStart.vy + (ev.clientY - panStart.y);
    } else {
      const node = hitTest(m.nodes, sx, sy, view);
      if (node !== hovered) {
        hovered = node;
        cvs.style.cursor = node ? 'pointer' : 'grab';
      }
    }
  });

  cvs.addEventListener('pointerup', (ev) => {
    if (dragNode) {
      // Just release the drag — don't open inspector on click.
      // Obsidian: clicking a node just highlights it briefly (hover does that).
      dragNode = null;
    }
    panning = false; panStart = null;
    cvs.style.cursor = 'grab';
  });

  cvs.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = cvs.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.1 : 0.9;
    const ns = view.s * factor;
    view.x = mx - (mx - view.x) * (ns / view.s);
    view.y = my - (my - view.y) * (ns / view.s);
    view.s = ns;
  }, { passive: false });

  // ── Inspector ──
  function _openInspector(node) {
    selected = node;
    inspector.style.width = '280px';
    _renderInspector(node);
    _redraw();
  }

  function _closeInspector() {
    selected = null;
    inspector.style.width = '0';
    _redraw();
  }

  function _renderInspector(node) {
    const deps = m.edges.filter(e => e.source === node.id).map(e => m.byId.get(e.target)).filter(Boolean);
    const usedBy = m.edges.filter(e => e.target === node.id).map(e => m.byId.get(e.source)).filter(Boolean);

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="color:var(--vscode-editor-foreground,#fff);font-size:13px">${_esc(node.label)}</strong>
        <button style="background:none;border:none;color:var(--vscode-descriptionForeground,#666);cursor:pointer;font-size:16px" id="__wg_closeInsp">&times;</button>
      </div>
      <div style="color:var(--vscode-descriptionForeground,#666);font-size:11px;margin-bottom:8px">${_esc(node.domain)} &middot; ${_esc(node.meta.type || '')}</div>
    `;

    if (node.meta.uri) {
      html += `<div style="color:#555;font-size:10px;word-break:break-all;margin-bottom:8px">${_esc(node.meta.uri)}</div>`;
    }

    html += `<div style="margin-top:8px"><strong style="color:var(--vscode-descriptionForeground,#888);font-size:11px">Connects To (${deps.length})</strong>`;
    html += deps.length
      ? deps.map(d => `<div class="__wg_inspLink" data-id="${d.id}" style="padding:3px 0;cursor:pointer;color:#9ab;font-size:11px">&bull; ${_esc(d.label)}</div>`).join('')
      : '<div style="color:#555;font-size:11px">None</div>';
    html += '</div>';

    html += `<div style="margin-top:8px"><strong style="color:var(--vscode-descriptionForeground,#888);font-size:11px">Connected From (${usedBy.length})</strong>`;
    html += usedBy.length
      ? usedBy.map(d => `<div class="__wg_inspLink" data-id="${d.id}" style="padding:3px 0;cursor:pointer;color:#9ab;font-size:11px">&bull; ${_esc(d.label)}</div>`).join('')
      : '<div style="color:#555;font-size:11px">None</div>';
    html += '</div>';

    inspInner.innerHTML = html;

    const closeBtn = inspInner.querySelector('#__wg_closeInsp');
    if (closeBtn) closeBtn.addEventListener('click', _closeInspector);

    for (const link of inspInner.querySelectorAll('.__wg_inspLink')) {
      link.addEventListener('click', () => {
        const target = m.byId.get(link.dataset.id);
        if (target) {
          view.x = cvs.clientWidth / 2 - target.x * view.s;
          view.y = cvs.clientHeight / 2 - target.y * view.s;
          _openInspector(target);
        }
      });
    }
  }

  // ── Animation Loop ──
  function _loop() {
    if (disposed) return;
    if (physicsOn) {
      physicsTick(m.nodes, m.edges, m.byId);
    }
    drawGraph(ctx, cvs, m.nodes, m.edges, m.byId, view, selected, hovered, showEdges);
    animFrameId = requestAnimationFrame(_loop);
  }

  function _redraw() {
    if (!physicsOn) drawGraph(ctx, cvs, m.nodes, m.edges, m.byId, view, selected, hovered, showEdges);
  }

  function _fitAndDraw() {
    const v = fitAll(m.nodes, cvs.clientWidth, cvs.clientHeight);
    view.x = v.x; view.y = v.y; view.s = v.s;
    _redraw();
  }

  // ── Data Loading ──
  async function _refresh() {
    await m.refresh();
    selected = null; hovered = null;
    inspector.style.width = '0';
    nodeCount.textContent = `${m.nodes.length} nodes \xb7 ${m.edges.length} edges`;

    const q = searchInput.value.toLowerCase().trim();
    if (q) {
      for (const n of m.nodes) {
        n.visible = n.label.toLowerCase().includes(q) || n.domain.toLowerCase().includes(q);
      }
    }

    setTimeout(() => _fitAndDraw(), 500);
  }

  // ── Init ──
  _editorActive = true;
  _refresh();
  animFrameId = requestAnimationFrame(_loop);

  let changePageSub;
  if (api.workspace.onDidChangeCanvasPages) {
    changePageSub = api.workspace.onDidChangeCanvasPages(() => _refresh());
  }

  return {
    dispose() {
      disposed = true;
      _editorActive = false;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (changePageSub) changePageSub.dispose();
      container.innerHTML = '';
    },
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: SIDEBAR MINI-GRAPH
// Compact view for the explorer sidebar panel.
// ═══════════════════════════════════════════════════════════════════════════════

function _miniBtn(text) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = 'background:none;border:none;color:var(--vscode-descriptionForeground,#666);cursor:pointer;font-size:14px;padding:2px 4px;font-family:var(--parallx-fontFamily-ui);';
  btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--vscode-editor-foreground,#aaa)'; });
  btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--vscode-descriptionForeground,#666)'; });
  return btn;
}

function createGraphSidebar(container, api) {
  // Use shared model — same data as editor
  const m = _model;
  m._api = api;
  let hovered = null;
  let animFrameId = null;
  let disposed = false;
  let view = { x: 0, y: 0, s: 1 };

  container.innerHTML = '';
  // Set individual style properties — do NOT use cssText which wipes
  // the pixel dimensions injected by the contributed-view layout() call.
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.height = '100%';
  container.style.background = 'var(--vscode-editor-background,#1e1e1e)';
  container.style.overflow = 'hidden';
  container.style.position = 'relative';

  // Canvas (full area)
  const cvs = document.createElement('canvas');
  cvs.style.cssText = 'flex:1;width:100%;min-height:0;cursor:grab;';
  const ctx = cvs.getContext('2d');
  container.appendChild(cvs);

  // Overlay buttons (top-right, over canvas)
  const btnBar = _el('div', 'position:absolute;top:4px;right:6px;display:flex;gap:4px;z-index:2;');
  const refreshBtn = _miniBtn('\u27f3');
  refreshBtn.title = 'Refresh';
  refreshBtn.addEventListener('click', () => m.refresh());
  const expandBtn = _miniBtn('\u2922');
  expandBtn.title = 'Open full graph';
  expandBtn.addEventListener('click', () => {
    api.editors.openEditor({ typeId: 'workspace-graph', title: 'Workspace Graph', icon: 'codicon-graph', instanceId: 'main' });
  });
  btnBar.append(refreshBtn, expandBtn);
  container.appendChild(btnBar);

  // Interaction
  let panning = false;
  let panStart = null;

  cvs.addEventListener('pointerdown', (ev) => {
    panning = true;
    panStart = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    cvs.setPointerCapture(ev.pointerId);
  });

  cvs.addEventListener('pointermove', (ev) => {
    if (panning && panStart) {
      view.x = panStart.vx + (ev.clientX - panStart.x);
      view.y = panStart.vy + (ev.clientY - panStart.y);
    } else {
      const rect = cvs.getBoundingClientRect();
      const node = hitTest(m.nodes, ev.clientX - rect.left, ev.clientY - rect.top, view);
      if (node !== hovered) {
        hovered = node;
        cvs.style.cursor = node ? 'pointer' : 'grab';
      }
    }
  });

  cvs.addEventListener('pointerup', () => {
    panning = false; panStart = null;
    cvs.style.cursor = 'grab';
  });

  cvs.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = cvs.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.1 : 0.9;
    const ns = view.s * factor;
    view.x = mx - (mx - view.x) * (ns / view.s);
    view.y = my - (my - view.y) * (ns / view.s);
    view.s = ns;
  }, { passive: false });

  // Animation — uses shared model data, doesn't run its own physics
  // (editor's loop runs physics, sidebar just renders the same node positions)
  function _loop() {
    if (disposed) return;
    // Only run physics if editor isn't running (sidebar opened alone)
    if (!_editorActive) physicsTick(m.nodes, m.edges, m.byId);
    drawGraph(ctx, cvs, m.nodes, m.edges, m.byId, view, null, hovered, true);
    animFrameId = requestAnimationFrame(_loop);
  }

  function _onModelChange() {
    setTimeout(() => {
      const v = fitAll(m.nodes, cvs.clientWidth, cvs.clientHeight);
      view.x = v.x; view.y = v.y; view.s = v.s;
    }, 400);
  }

  const modelSub = m.onChange(_onModelChange);

  // Init — defer to next frame so the container has layout dimensions
  requestAnimationFrame(async () => {
    if (!m.ready) await m.refresh();
    _onModelChange();
    animFrameId = requestAnimationFrame(_loop);
  });

  let changePageSub;
  if (api.workspace.onDidChangeCanvasPages) {
    changePageSub = api.workspace.onDidChangeCanvasPages(() => m.refresh());
  }

  return {
    dispose() {
      disposed = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (changePageSub) changePageSub.dispose();
      modelSub.dispose();
      container.innerHTML = '';
    },
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: EXTENSION ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

export async function activate(api, context) {
  console.log('[WorkspaceGraph] Extension activated');

  // Load persisted settings before views render
  await _loadSettings(api);

  // Sidebar view
  const viewDisposable = api.views.registerViewProvider('view.workspaceGraph', {
    createView(container) {
      return createGraphSidebar(container, api);
    },
  });
  context.subscriptions.push(viewDisposable);

  // Full editor pane
  const editorDisposable = api.editors.registerEditorProvider('workspace-graph', {
    createEditorPane(container, _input) {
      return createGraphEditor(container, api);
    },
  });
  context.subscriptions.push(editorDisposable);

  // Commands
  const openCmd = api.commands.registerCommand('workspaceGraph.open', () => {
    api.editors.openEditor({ typeId: 'workspace-graph', title: 'Workspace Graph', icon: 'codicon-graph', instanceId: 'main' });
  });
  context.subscriptions.push(openCmd);

  const refreshCmd = api.commands.registerCommand('workspaceGraph.refresh', () => {
    // Refresh is handled within the editor/sidebar instances.
    // This command just re-opens the editor if not already open.
    api.editors.openEditor({ typeId: 'workspace-graph', title: 'Workspace Graph', icon: 'codicon-graph', instanceId: 'main' });
  });
  context.subscriptions.push(refreshCmd);
}
