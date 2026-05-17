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

// M76 edge-kind taxonomy. Phase 1 only writes 'similar-to'; Phases 2/4/5
// add the others. Defining them up-front keeps the rendering and settings
// code shape-stable as kinds come online.
const EDGE_KINDS = [
  'similar-to', 'references', 'co-occurrence',
  'same-folder', 'same-author', 'same-date',
  'extends', 'refutes', 'member-of',
];

const EDGE_KIND_LABEL = {
  'similar-to':    'Similarity',
  'references':    'References',
  'co-occurrence': 'Co-occurrence',
  'same-folder':   'Same folder',
  'same-author':   'Same author',
  'same-date':     'Same date',
  'extends':       'Extends',
  'refutes':       'Refutes',
  'member-of':     'Concept membership',
};

// Per-kind visual treatment. All values keyed by edge.kind. Phase 1 only
// uses 'similar-to'; the others are placeholders ready for Phases 2/4/5.
const EDGE_KIND_RGB = {
  'similar-to':    '126,196,244',
  'references':    '167,230,168',
  'co-occurrence': '240,198,116',
  'same-folder':   '180,180,180',
  'same-author':   '180,180,180',
  'same-date':     '180,180,180',
  'extends':       '200,130,230',
  'refutes':       '230,130,130',
  'member-of':     '255,192,100',
};

const EDGE_KIND_DASH = {
  'similar-to':    [4, 4],
  'references':    [],
  'co-occurrence': [2, 3],
  'same-folder':   [1, 6],
  'same-author':   [1, 6],
  'same-date':     [1, 6],
  'extends':       [],
  'refutes':       [6, 3],
  'member-of':     [],
};

// True if the edge kind is a "concept edge" — anything from the semantic
// graph service, as opposed to structural workspace edges (file tree,
// canvas page hierarchy). Used in places that need to distinguish concept
// edges from structural ones for force-strength and rendering decisions.
function isConceptEdge(kind) {
  return typeof kind === 'string' && EDGE_KINDS.indexOf(kind) >= 0;
}

// Keys in GS that we persist (skip computed/non-serializable values)
const _PERSIST_KEYS = [
  'chargeStrength', 'linkDistance', 'linkStrengthMin', 'centerStrength',
  'collideRadius', 'velocityDecay',
  'nodeRadiusMin', 'nodeRadiusMax', 'nodeOpacity',
  'edgeColor', 'edgeWidth', 'edgeHoverWidth',
  'labelZoomStart', 'labelZoomFull',
  'showFiles', 'showCanvasPages', 'showSessions', 'edgeKindVisibility',
];

async function _loadSettings(api) {
  try {
    const fs = api.requestCapability ? api.requestCapability('fs', { scope: 'workspace-files', modes: ['read', 'write'] }) : null;
    const root = api.workspace?.workspaceFolders?.[0]?.uri;
    if (!fs || !root) return;
    const path = _resolveUri(root, `${EXT_ROOT}/${SETTINGS_FILE}`);
    if (!(await fs.exists(path))) return;
    const { content } = await fs.readFile(path);
    const saved = JSON.parse(content);
    for (const k of _PERSIST_KEYS) {
      if (saved[k] !== undefined) GS[k] = saved[k];
    }
    // M76 migration: a workspace saved before M76 has `showConceptualLinks`
    // but no `edgeKindVisibility`. Map the old boolean onto the new
    // per-kind map so the user's preference is preserved.
    if (saved.showConceptualLinks !== undefined && saved.edgeKindVisibility === undefined) {
      GS.edgeKindVisibility = { ...GS.edgeKindVisibility, 'similar-to': !!saved.showConceptualLinks };
    }
    // Defensive: ensure every kind has an entry (in case a saved file is
    // older than the current EDGE_KINDS list).
    for (const k of EDGE_KINDS) {
      if (GS.edgeKindVisibility[k] === undefined) GS.edgeKindVisibility[k] = false;
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
      const fs = api.requestCapability ? api.requestCapability('fs', { scope: 'workspace-files', modes: ['read', 'write'] }) : null;
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
  // M76: per-edge-kind visibility. Default: all off. Legacy
  // `showConceptualLinks: true` settings migrate to `similar-to: true` in
  // `_loadSettings`. Phase 1 only renders 'similar-to' since the other kinds
  // have no producers yet, but the UI surfaces just the one checkbox.
  edgeKindVisibility: {
    'similar-to':    false,
    'references':    false,
    'co-occurrence': false,
    'same-folder':   false,
    'same-author':   false,
    'same-date':     false,
    'extends':       false,
    'refutes':       false,
    'member-of':     false,
  },
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
    // Carry over positions of nodes that still exist, and mark
    // newly-introduced nodes for a brief "pulse" glow.
    const prev = this.byId;
    const now = performance.now();
    for (const n of data.nodes) {
      const old = prev.get(n.id);
      if (old) {
        n.x = old.x; n.y = old.y; n.vx = old.vx; n.vy = old.vy;
        n.pinned = old.pinned; n.visible = old.visible;
      } else {
        n._pulseStart = now;  // pulse for ~1.5s after first appearance
      }
    }
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
    const baseStrength = Math.max(GS.linkStrengthMin, 1 / Math.min(cs, ct));
    if (isConceptEdge(e.kind)) {
      const weight = Number.isFinite(e.weight) ? e.weight : Number.isFinite(e.score) ? e.score : 1;
      _linkStrengths[i] = Math.max(0.01, baseStrength * 0.25 * Math.max(0.2, Math.min(1, weight)));
      _linkDistances[i] = GS.linkDistance * 1.4;
    } else {
      _linkStrengths[i] = baseStrength;
      _linkDistances[i] = GS.linkDistance;
    }
    _linkBiases[i] = cs / (cs + ct);
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
const IDEA_CLUSTER_COLORS = [
  '#6baad3',
  '#c98aaa',
  '#d3b66b',
  '#7bc4a4',
  '#d38b6b',
  '#8fb3ff',
  '#b4a7d6',
  '#a8c97a',
];
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

function _applySemanticClusterColors(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const adjacency = new Map();

  for (const e of edges) {
    if (!isConceptEdge(e.kind)) continue;
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
    adjacency.get(e.source).add(e.target);
    adjacency.get(e.target).add(e.source);
  }

  if (!adjacency.size) return;

  const visited = new Set();
  const clusters = [];
  for (const id of adjacency.keys()) {
    if (visited.has(id)) continue;
    const stack = [id];
    const cluster = [];
    visited.add(id);
    while (stack.length) {
      const current = stack.pop();
      cluster.push(current);
      for (const next of adjacency.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    if (cluster.length >= 3) clusters.push(cluster);
  }

  clusters.sort((a, b) => b.length - a.length);
  clusters.forEach((cluster, index) => {
    const color = IDEA_CLUSTER_COLORS[index % IDEA_CLUSTER_COLORS.length];
    for (const id of cluster) {
      const node = byId.get(id);
      if (!node) continue;
      node.color = color;
      node.meta.ideaCluster = { rank: index + 1, size: cluster.length, color };
    }
  });
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
  // Run providers after core collectors so the dedup `seen` set in
  // _collectProviders captures all file/page/session nodes first.
  await _collectProviders(api, nodes, edges);

  // Drop edges that reference unknown nodes (provider may reference a
  // file/page node id that wasn't included, e.g. a session referencing
  // a deleted page).
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (_isIgnoredWorkspaceInternalPath(n.id) || _isIgnoredWorkspaceInternalPath(n.meta?.uri)) {
      nodes.splice(i, 1);
    }
  }

  const ids = new Set(nodes.map(n => n.id));
  for (let i = edges.length - 1; i >= 0; i--) {
    if (!ids.has(edges[i].source) || !ids.has(edges[i].target)) edges.splice(i, 1);
  }

  _applySemanticClusterColors(nodes, edges);
  _computeNodeSizes(nodes, edges);

  // Pre-compute d3-force link parameters (strengths, biases, distances)
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, n);
  computeLinkParams(nodes, edges, byId);

  return { nodes, edges };
}

async function _collectFiles(api, nodes, edges) {
  const folders = api.workspace.workspaceFolders;
  if (!folders || folders.length === 0 || !api.requestCapability) return;
  const wfs = api.requestCapability('fs', { scope: 'workspace-files', modes: ['read'] });

  const rootUri = folders[0].uri;
  const MAX_DEPTH = 3;
  const queue = [{ uri: rootUri, parentId: null, depth: 0 }];

  while (queue.length > 0) {
    const { uri, parentId, depth } = queue.shift();
    if (depth > MAX_DEPTH) continue;

    let entries;
    try { entries = await wfs.readdir(uri); } catch { continue; }

    for (const entry of entries) {
      const childUri = uri.endsWith('/') ? uri + entry.name : uri + '/' + entry.name;
      const nodeId = 'file:' + childUri;

      if (_isIgnoredWorkspaceInternalPath(childUri)) continue;
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
  if (!folders || folders.length === 0 || !api.requestCapability) return;
  const wfs = api.requestCapability('fs', { scope: 'workspace-files', modes: ['read'] });

  const rootUri = folders[0].uri;
  const sessionsUri = rootUri.endsWith('/') ? rootUri + '.parallx/sessions' : rootUri + '/.parallx/sessions';

  let exists;
  try { exists = await wfs.exists(sessionsUri); } catch { return; }
  if (!exists) return;

  let entries;
  try { entries = await wfs.readdir(sessionsUri); } catch { return; }

  for (const entry of entries) {
    if (entry.type !== 1 || !entry.name.endsWith('.json')) continue;
    const nodeId = 'session:' + entry.name;
    const label = entry.name.replace('.json', '');
    nodes.push(_makeNode(nodeId, label, 'session', DOMAIN_COLORS.session, 3, { type: 'session', fileName: entry.name }));
  }
}

// ── Contributor providers (parallx.workspaceGraph.registerProvider) ──
// Each extension can contribute its own nodes/edges. Provider results are
// merged on every refresh. Duplicate ids (e.g. two providers contributing
// the same file:... node) are deduped: first registration wins.
const IGNORED_PROVIDER_IDS = new Set([
  'budget',
  'text-generator',
  'media-organizer',
]);

const IGNORED_WORKSPACE_INTERNAL_DIRS = [
  '/.parallx/extensions/budget',
  '/.parallx/extensions/text-generator',
  '/.parallx/extensions/media-organizer',
];

const PROVIDER_DOMAIN_COLORS = {
  budget:    '#f0c674',
  media:     '#7ec4f4',
  character: '#e29bd6',
  chat:      '#d4925a',
};

function _domainColor(domain) {
  if (DOMAIN_COLORS[domain]) return DOMAIN_COLORS[domain];
  if (PROVIDER_DOMAIN_COLORS[domain]) return PROVIDER_DOMAIN_COLORS[domain];
  // Deterministic fallback color from domain string.
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) | 0;
  const hue = ((h >>> 0) % 360);
  return `hsl(${hue}, 55%, 65%)`;
}

function _normalizeGraphPath(value) {
  let path = String(value || '');
  if (path.startsWith('file:')) path = path.slice(5);
  try { path = decodeURIComponent(path); } catch { /* keep original */ }
  path = path.replace(/\\/g, '/').toLowerCase();
  return '/' + path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function _isIgnoredWorkspaceInternalPath(value) {
  const path = _normalizeGraphPath(value);
  for (const dir of IGNORED_WORKSPACE_INTERNAL_DIRS) {
    const index = path.indexOf(dir);
    if (index < 0) continue;
    const next = path[index + dir.length];
    if (next === undefined || next === '/') return true;
  }
  return false;
}

async function _collectProviders(api, nodes, edges) {
  if (!api.workspaceGraph || typeof api.workspaceGraph.getAll !== 'function') return;
  const list = api.workspaceGraph.getAll();
  if (!list || list.length === 0) return;
  const seen = new Set(nodes.map(n => n.id));
  for (const provider of list) {
    if (IGNORED_PROVIDER_IDS.has(provider?.id)) continue;

    let snap;
    try {
      snap = await provider.snapshot();
    } catch (err) {
      console.warn(`[WorkspaceGraph] Provider "${provider.id}" snapshot failed:`, err);
      continue;
    }
    if (!snap) continue;
    if (Array.isArray(snap.nodes)) {
      for (const pn of snap.nodes) {
        if (!pn || !pn.id || seen.has(pn.id)) continue;
        seen.add(pn.id);
        const label = (pn.icon ? pn.icon + ' ' : '') + (pn.label || pn.id);
        const color = pn.color || _domainColor(pn.domain || provider.id);
        const radius = pn.weight ? Math.max(2, Math.min(8, pn.weight)) : 3;
        const node = _makeNode(pn.id, label, pn.domain || provider.id, color, radius, {
          ...(pn.meta || {}),
          providerId: provider.id,
        });
        nodes.push(node);
      }
    }
    if (Array.isArray(snap.edges)) {
      for (const pe of snap.edges) {
        if (!pe || !pe.source || !pe.target) continue;
        edges.push({ source: pe.source, target: pe.target, kind: pe.kind, score: pe.score, weight: pe.weight });
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
const SEMANTIC_GRAPH_SERVICE_ID = { id: 'ISemanticGraphService' };
const REFRESH_ORCHESTRATOR_SERVICE_ID = { id: 'IMindMapRefreshOrchestrator' };

function _getRefreshOrchestrator(api) {
  try {
    if (!api.services || typeof api.services.has !== 'function' || typeof api.services.get !== 'function') return null;
    if (!api.services.has(REFRESH_ORCHESTRATOR_SERVICE_ID)) return null;
    return api.services.get(REFRESH_ORCHESTRATOR_SERVICE_ID);
  } catch { return null; }
}

// M76 Phase 3 — relative-time formatter for the "Last refreshed" line.
// Buckets: just now, X min ago, X hr ago, X day ago, then absolute date.
function _formatRelativeTime(isoTs) {
  if (!isoTs) return 'never';
  const then = new Date(isoTs).getTime();
  if (Number.isNaN(then)) return 'never';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString();
}

function _formatEstimatedSeconds(secs) {
  if (typeof secs !== 'number' || secs <= 0) return null;
  if (secs < 60) return `~${Math.ceil(secs)} sec`;
  const mins = Math.ceil(secs / 60);
  return `~${mins} min`;
}

function _getSemanticGraphService(api) {
  try {
    if (!api.services || typeof api.services.has !== 'function' || typeof api.services.get !== 'function') return null;
    if (!api.services.has(SEMANTIC_GRAPH_SERVICE_ID)) return null;
    return api.services.get(SEMANTIC_GRAPH_SERVICE_ID);
  } catch {
    return null;
  }
}

function _fileLabelFromNodeId(nodeId) {
  const uri = nodeId.startsWith('file:') ? nodeId.slice(5) : nodeId;
  const clean = uri.split('?')[0].replace(/\\/g, '/');
  const parts = clean.split('/').filter(Boolean);
  const label = parts[parts.length - 1] || uri;
  try { return decodeURIComponent(label); } catch { return label; }
}

function _makeSemanticEndpointNode(nodeId) {
  if (!nodeId.startsWith('file:')) return null;
  if (_isIgnoredWorkspaceInternalPath(nodeId)) return null;
  const uri = nodeId.slice(5);
  const label = _fileLabelFromNodeId(nodeId);
  const ext = label.includes('.') ? '.' + label.split('.').pop() : '';
  const color = EXT_COLORS[ext] || DOMAIN_COLORS.file;
  return {
    id: nodeId,
    label,
    domain: 'file',
    color,
    weight: 3,
    meta: { type: 'file', uri, ext, semanticPlaceholder: true },
  };
}

function _anyConceptKindVisible() {
  for (const k of EDGE_KINDS) {
    if (GS.edgeKindVisibility[k]) return true;
  }
  return false;
}

function _visibleEdgeKinds() {
  return EDGE_KINDS.filter((k) => GS.edgeKindVisibility[k]);
}

function _registerSemanticGraphProvider(api, context) {
  const service = _getSemanticGraphService(api);
  if (!service || !api.workspaceGraph || typeof api.workspaceGraph.registerProvider !== 'function') {
    return;
  }
  if (_anyConceptKindVisible() && typeof service.ensureCacheStarted === 'function') {
    service.ensureCacheStarted();
  }

  const provider = {
    id: 'parallx.semantic-links',
    displayName: 'Conceptual Links',
    async snapshot() {
      const visible = _visibleEdgeKinds();
      if (visible.length === 0 || !service.getCachedEdges) {
        return { nodes: [], edges: [] };
      }
      if (typeof service.ensureCacheStarted === 'function') {
        service.ensureCacheStarted();
      }
      const cached = await service.getCachedEdges({ maxEdges: 500, minScore: 0.72, kinds: visible });
      const nodes = [];
      const seenNodes = new Set();
      const edges = [];
      for (const edge of cached) {
        if (
          _isIgnoredWorkspaceInternalPath(edge.sourceNodeId) ||
          _isIgnoredWorkspaceInternalPath(edge.targetNodeId)
        ) {
          continue;
        }
        for (const nodeId of [edge.sourceNodeId, edge.targetNodeId]) {
          if (seenNodes.has(nodeId)) continue;
          const node = _makeSemanticEndpointNode(nodeId);
          if (node) {
            seenNodes.add(nodeId);
            nodes.push(node);
          }
        }
        edges.push({
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          kind: edge.kind,
          direction: edge.direction,
          score: edge.score,
          weight: edge.score,
        });
      }
      return { nodes, edges };
    },
  };

  context.subscriptions.push(api.workspaceGraph.registerProvider(provider));
  if (typeof service.onDidChangeEdges === 'function' && typeof api.workspaceGraph.notifyChange === 'function') {
    context.subscriptions.push(service.onDidChangeEdges(() => api.workspaceGraph.notifyChange()));
  }
}

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

  // Hover is transient; selection stays until another node or a clear action.
  const selConn = selected ? _getConnected(edges, selected.id) : new Set();
  const hovConn = hovered ? _getConnected(edges, hovered.id) : new Set();
  const hasHov = !!hovered;
  const hasSel = !!selected;

  // ── Edges: straight lines, Obsidian-style ──
  if (showEdges) {
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b || !a.visible || !b.visible) continue;

      const isSelEdge = hasSel && (e.source === selected.id || e.target === selected.id);
      const isHovEdge = hasHov && (e.source === hovered.id || e.target === hovered.id);
      const dim = (hasSel || hasHov) && !isSelEdge && !isHovEdge;
      const concept = isConceptEdge(e.kind);
      const rgb = concept ? (EDGE_KIND_RGB[e.kind] || '126,196,244') : null;
      const dash = concept ? (EDGE_KIND_DASH[e.kind] || []) : [];

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.setLineDash(dash);

      if (isHovEdge) {
        ctx.strokeStyle = concept ? `rgba(${rgb},0.48)` : _rgba(hovered.color, 0.4);
        ctx.lineWidth = concept ? Math.max(GS.edgeHoverWidth, 1.0) : GS.edgeHoverWidth;
      } else if (isSelEdge) {
        ctx.strokeStyle = concept ? `rgba(${rgb},0.38)` : _rgba(selected.color, 0.5);
        ctx.lineWidth = concept ? Math.max(GS.edgeHoverWidth, 0.9) : 1.35;
      } else {
        ctx.strokeStyle = concept
          ? (dim ? `rgba(${rgb},0.04)` : `rgba(${rgb},0.22)`)
          : (dim ? 'rgba(255,255,255,0.04)' : GS.edgeColor);
        ctx.lineWidth = concept ? Math.max(0.25, GS.edgeWidth * 0.8) : GS.edgeWidth;
      }
      ctx.stroke();
      if (dash.length > 0) ctx.setLineDash([]);

      // Arrowhead for directed concept edges (M76). Phase 1 has no producers
      // for directed edges yet, but the rendering is in place so Phase 4
      // (lineage) and Phase 5 (member-of) plug in without further work.
      if (concept && e.direction === 'forward') {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          const angle = Math.atan2(dy, dx);
          // Place the arrowhead a few pixels before the target node so it
          // doesn't overlap the node circle. Size scales with line width.
          const head = Math.max(4, ctx.lineWidth * 4);
          const tipX = b.x - Math.cos(angle) * (b.radius || 3);
          const tipY = b.y - Math.sin(angle) * (b.radius || 3);
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(
            tipX - head * Math.cos(angle - Math.PI / 6),
            tipY - head * Math.sin(angle - Math.PI / 6),
          );
          ctx.lineTo(
            tipX - head * Math.cos(angle + Math.PI / 6),
            tipY - head * Math.sin(angle + Math.PI / 6),
          );
          ctx.closePath();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
      }
    }
  }

  // ── Nodes: filled circles, no borders (Obsidian style) ──
  const nowMs = performance.now();
  for (const n of nodes) {
    if (!n.visible) continue;
    const isSel = selected && n.id === selected.id;
    const isSelConn = hasSel && selConn.has(n.id);
    const isHov = hovered && n.id === hovered.id;
    const isHovConn = hasHov && hovConn.has(n.id);
    const dim = (hasSel || hasHov) && !isSel && !isSelConn && !isHov && !isHovConn;
    const r = n.radius * ((isHov || isSel) ? 1.18 : 1);

    // Pulse glow for nodes that just appeared (provider contributions,
    // new files, etc.). Decays linearly over 1500 ms.
    let pulse = 0;
    if (n._pulseStart) {
      const age = nowMs - n._pulseStart;
      if (age >= 0 && age < 1500) {
        pulse = 1 - age / 1500;
      } else {
        n._pulseStart = 0;
      }
    }

    if (pulse > 0) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4 + pulse * 8, 0, Math.PI * 2);
      ctx.fillStyle = _rgba(n.color, 0.25 * pulse);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

    if (isHov || isSel) {
      ctx.fillStyle = '#ffffff';
    } else if (isHovConn) {
      ctx.fillStyle = _rgba(n.color, 0.9);
    } else if (isSelConn) {
      ctx.fillStyle = _rgba(n.color, 0.82);
    } else {
      ctx.fillStyle = _rgba(n.color, dim ? 0.06 : GS.nodeOpacity);
    }
    ctx.fill();

    if (isSel) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 2.2, 0, Math.PI * 2);
      ctx.strokeStyle = _rgba(n.color, 0.85);
      ctx.lineWidth = Math.max(0.7, 1.2 / view.s);
      ctx.stroke();
    }

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
    const isSel = selected && n.id === selected.id;
    const isSelConn = hasSel && selConn.has(n.id);
    const isHov = hovered && n.id === hovered.id;

    // Show label if: hovered/selected node, selected neighbors, or zoomed in.
    let alpha = 0;
    if (isHov || isSel) alpha = 0.92;
    else if (isSelConn) alpha = Math.max(0.52, zoomLabelAlpha);
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

function _formatConnectionMeta(edge) {
  if (isConceptEdge(edge.kind)) {
    const label = EDGE_KIND_LABEL[edge.kind] || edge.kind;
    const score = Number.isFinite(edge.score) ? edge.score : Number.isFinite(edge.weight) ? edge.weight : null;
    return score === null ? label : `${label} ${Math.round(score * 100)}%`;
  }
  return edge.kind ? String(edge.kind) : 'Structural';
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

    // M76 Phase 3 — synchronous status snapshot so the section renders
    // immediately. preview() + getRefreshHistory() are async and populate
    // the dynamic spans after first paint via _updateRefreshSectionAsync.
    const _orch = _getRefreshOrchestrator(api);
    const _orchStatus = _orch ? _orch.getStatus() : null;
    const _isRefreshing = !!(_orchStatus && _orchStatus.isRefreshing);
    const _refreshLabel = _orchStatus && _orchStatus.label ? _esc(_orchStatus.label) : '';
    const _refreshProgress = _orchStatus && _orchStatus.progress
      ? `(${_orchStatus.progress.current} of ${_orchStatus.progress.total})`
      : '';

    settingsInner.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="color:var(--vscode-editor-foreground,#fff);font-size:13px">Graph Settings</strong>
        <button id="__gs_close" style="background:none;border:none;color:var(--vscode-descriptionForeground,#666);cursor:pointer;font-size:16px">&times;</button>
      </div>

      ${_orch ? `
      <div ${H}>Mind map refresh</div>
      <div id="__gs_refresh_status" style="color:var(--vscode-descriptionForeground,#999);margin:4px 0;">
        Loading…
      </div>
      <div id="__gs_refresh_progress" style="color:var(--vscode-editor-foreground,#ccc);margin:4px 0;font-size:11px;${_isRefreshing ? '' : 'display:none;'}">
        ${_refreshLabel} ${_refreshProgress}
      </div>
      <button id="__gs_refresh_action" style="width:100%;padding:6px 8px;margin:4px 0 6px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:2px;cursor:pointer;font-size:11px;">
        ${_isRefreshing ? 'Cancel refresh' : 'Refresh mind map'}
      </button>
      <div style="margin:6px 0">
        <button id="__gs_refresh_history_toggle" style="background:none;border:none;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;font-size:11px;padding:0;">
          History ▸
        </button>
      </div>
      <div id="__gs_refresh_history" style="display:none;margin:4px 0 12px;font-size:11px;color:var(--vscode-descriptionForeground,#999);"></div>
      ` : ''}

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

      <div ${H}>Concept edges</div>
      <label style="display:flex;align-items:center;gap:6px;color:var(--vscode-editor-foreground,#ccc);margin:4px 0;cursor:pointer;">
        <input type="checkbox" id="__gs_kind_similar" ${GS.edgeKindVisibility['similar-to'] ? 'checked' : ''}> ${EDGE_KIND_LABEL['similar-to']}
      </label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--vscode-editor-foreground,#ccc);margin:4px 0;cursor:pointer;">
        <input type="checkbox" id="__gs_kind_references" ${GS.edgeKindVisibility['references'] ? 'checked' : ''}> ${EDGE_KIND_LABEL['references']}
      </label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--vscode-editor-foreground,#ccc);margin:4px 0;cursor:pointer;">
        <input type="checkbox" id="__gs_kind_samefolder" ${GS.edgeKindVisibility['same-folder'] ? 'checked' : ''}> ${EDGE_KIND_LABEL['same-folder']}
      </label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--vscode-editor-foreground,#ccc);margin:4px 0;cursor:pointer;">
        <input type="checkbox" id="__gs_kind_cooccurrence" ${GS.edgeKindVisibility['co-occurrence'] ? 'checked' : ''}> ${EDGE_KIND_LABEL['co-occurrence']}
      </label>
      <!-- Phase 4 lineage and Phase 5 concept membership will add their
           checkboxes here as those producers come online. The visibility
           map already contains entries for every kind so each future
           phase only has to render its checkbox. -->
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
    const _wireCheck = (id, key, afterFn) => {
      const el = settingsInner.querySelector('#__gs_' + id);
      if (!el) return;
      el.addEventListener('change', () => {
        GS[key] = el.checked;
        if (afterFn) afterFn();
        else m.applyVisibility();
        _saveSettings(api);
      });
    };
    _wireCheck('files', 'showFiles');
    _wireCheck('pages', 'showCanvasPages');
    _wireCheck('sessions', 'showSessions');

    // M76 — per-edge-kind checkboxes. Each binds GS.edgeKindVisibility[kind].
    // Phase 1 only renders the Similarity checkbox; this helper is shared
    // with future phases.
    const _wireKindCheck = (id, kind) => {
      const el = settingsInner.querySelector('#__gs_kind_' + id);
      if (!el) return;
      el.addEventListener('change', () => {
        GS.edgeKindVisibility = { ...GS.edgeKindVisibility, [kind]: el.checked };
        if (el.checked) {
          const service = _getSemanticGraphService(api);
          if (service && typeof service.ensureCacheStarted === 'function') service.ensureCacheStarted();
        }
        _saveSettings(api);
        m.refresh().catch(err => console.warn('[WorkspaceGraph] concept-edge toggle refresh failed:', err));
      });
    };
    _wireKindCheck('similar', 'similar-to');
    _wireKindCheck('references', 'references');
    _wireKindCheck('samefolder', 'same-folder');
    _wireKindCheck('cooccurrence', 'co-occurrence');

    // M76 Phase 3 — wire the refresh section. Status line + history are
    // populated async; button + history toggle attach handlers now.
    if (_orch) {
      _updateRefreshSectionAsync(_orch);

      const actionBtn = settingsInner.querySelector('#__gs_refresh_action');
      if (actionBtn) {
        actionBtn.addEventListener('click', async () => {
          const cur = _orch.getStatus();
          if (cur.isRefreshing) {
            _orch.cancelRefresh();
            return;
          }
          // No passes registered yet (Phase 3 ships infrastructure only).
          // Phase 4/5 will register lineage + concept clustering.
          const registered = _orch.getRegisteredPasses();
          if (registered.length === 0) {
            actionBtn.disabled = true;
            actionBtn.textContent = 'No refresh passes registered';
            setTimeout(() => {
              actionBtn.disabled = false;
              actionBtn.textContent = 'Refresh mind map';
            }, 2000);
            return;
          }
          try {
            await _orch.startRefresh();
          } catch (err) {
            console.warn('[WorkspaceGraph] startRefresh failed:', err && err.message);
          }
        });
      }

      const historyToggle = settingsInner.querySelector('#__gs_refresh_history_toggle');
      const historyEl = settingsInner.querySelector('#__gs_refresh_history');
      if (historyToggle && historyEl) {
        historyToggle.addEventListener('click', async () => {
          const isHidden = historyEl.style.display === 'none';
          if (!isHidden) {
            historyEl.style.display = 'none';
            historyToggle.textContent = 'History ▸';
            return;
          }
          historyEl.style.display = 'block';
          historyToggle.textContent = 'History ▾';
          historyEl.innerHTML = 'Loading…';
          try {
            const rows = await _orch.getRefreshHistory(10);
            if (rows.length === 0) {
              historyEl.innerHTML = '<em>No refreshes yet.</em>';
              return;
            }
            historyEl.innerHTML = rows.map((r) => {
              const dot = r.status === 'completed' ? '✓'
                       : r.status === 'cancelled' ? '⊘'
                       : r.status === 'error' ? '✕'
                       : '…';
              const when = _formatRelativeTime(r.startedAt);
              const sources = r.sourcesProcessed > 0 ? ` · ${r.sourcesProcessed} source${r.sourcesProcessed === 1 ? '' : 's'}` : '';
              const err = r.errorMessage ? ` <span style="color:#e08080">(${_esc(r.errorMessage)})</span>` : '';
              return `<div style="padding:2px 0;border-bottom:1px solid var(--vscode-panel-border,#2a2a2a)">${dot} ${_esc(r.status)} · ${when}${sources}${err}</div>`;
            }).join('');
          } catch (err) {
            historyEl.innerHTML = `<em>Failed to load history: ${_esc(String(err && err.message || err))}</em>`;
          }
        });
      }
    }
  }

  // M76 Phase 3 — populate the dynamic parts of the refresh section
  // (idle status line uses preview() data). Called after _buildSettingsPanel
  // and again when orchestrator events fire.
  async function _updateRefreshSectionAsync(orch) {
    const statusEl = settingsInner.querySelector('#__gs_refresh_status');
    if (!statusEl) return;
    const status = orch.getStatus();
    try {
      if (status.isRefreshing) {
        statusEl.textContent = 'Refreshing…';
        return;
      }
      const preview = await orch.preview();
      const history = await orch.getRefreshHistory(1);
      const lastLine = history.length > 0
        ? `Last refresh: ${_formatRelativeTime(history[0].startedAt)} (${_esc(history[0].status)})`
        : 'No prior refresh';
      let workLine;
      if (preview.sourcesChanged === 0) {
        workLine = orch.getRegisteredPasses().length === 0
          ? 'No refresh passes registered'
          : 'Up to date';
      } else {
        const est = _formatEstimatedSeconds(preview.estimatedSeconds);
        workLine = `${preview.sourcesChanged} source${preview.sourcesChanged === 1 ? '' : 's'} changed${est ? ` · ${est}` : ''}`;
      }
      statusEl.innerHTML = `<div>${_esc(workLine)}</div><div style="opacity:0.7;font-size:10px;margin-top:2px">${_esc(lastLine)}</div>`;
    } catch (err) {
      statusEl.textContent = `Refresh status unavailable: ${(err && err.message) || err}`;
    }
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
  let dragStart = null;
  let didDragNode = false;
  let panning = false;
  let panStart = null;
  let didPan = false;

  cvs.addEventListener('pointerdown', (ev) => {
    const rect = cvs.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const node = hitTest(m.nodes, sx, sy, view);

    if (node) {
      if (ev.shiftKey) { node.pinned = !node.pinned; _redraw(); return; }
      dragNode = node;
      dragStart = { x: ev.clientX, y: ev.clientY };
      didDragNode = false;
      resetSimulation();
      cvs.setPointerCapture(ev.pointerId);
      cvs.style.cursor = 'grabbing';
    } else {
      panning = true;
      panStart = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
      didPan = false;
      cvs.setPointerCapture(ev.pointerId);
      cvs.style.cursor = 'grabbing';
    }
  });

  cvs.addEventListener('pointermove', (ev) => {
    const rect = cvs.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;

    if (dragNode) {
      const moved = dragStart ? Math.hypot(ev.clientX - dragStart.x, ev.clientY - dragStart.y) : 0;
      if (didDragNode || moved > 3) {
        didDragNode = true;
        dragNode.pinned = true;
        dragNode.x = (sx - view.x) / view.s;
        dragNode.y = (sy - view.y) / view.s;
        dragNode.vx = 0; dragNode.vy = 0;
        resetSimulation();
      }
    } else if (panning && panStart) {
      didPan = didPan || Math.hypot(ev.clientX - panStart.x, ev.clientY - panStart.y) > 3;
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
      const clickedNode = dragNode;
      const wasDrag = didDragNode;
      dragNode = null;
      dragStart = null;
      didDragNode = false;
      if (!wasDrag) {
        hovered = clickedNode;
        _openInspector(clickedNode);
      }
    } else if (panning && !didPan) {
      _closeInspector();
      hovered = null;
      _redraw();
    }
    panning = false; panStart = null; didPan = false;
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
    _model._lastSelectedId = node.id;
    inspector.style.width = '280px';
    _renderInspector(node);
    _redraw();
  }

  function _closeInspector() {
    selected = null;
    _model._lastSelectedId = null;
    inspector.style.width = '0';
    _redraw();
  }

  function _renderInspector(node) {
    const connections = m.edges
      .filter(e => e.source === node.id || e.target === node.id)
      .map(e => {
        const otherId = e.source === node.id ? e.target : e.source;
        return { edge: e, node: m.byId.get(otherId) };
      })
      .filter(item => item.node)
      .sort((a, b) => {
        const aConcept = isConceptEdge(a.edge.kind);
        const bConcept = isConceptEdge(b.edge.kind);
        if (aConcept && !bConcept) return -1;
        if (!aConcept && bConcept) return 1;
        const aScore = Number.isFinite(a.edge.score) ? a.edge.score : 0;
        const bScore = Number.isFinite(b.edge.score) ? b.edge.score : 0;
        return bScore - aScore || a.node.label.localeCompare(b.node.label);
      });

    const semanticConns = connections.filter(c => isConceptEdge(c.edge.kind));
    const isContentNode = node.domain === 'canvas-page' || node.domain === 'file';

    const openBtnStyle = 'background:none;border:none;color:var(--vscode-descriptionForeground,#555);cursor:pointer;font-size:13px;padding:0 2px;flex-shrink:0;line-height:1;';
    let html = `
      <div style="display:flex;align-items:center;gap:2px;margin-bottom:8px">
        <strong style="color:var(--vscode-editor-foreground,#fff);font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(node.label)}</strong>
        ${isContentNode ? `<button id="__wg_openNode" title="Open" style="${openBtnStyle}">↗</button>` : ''}
        <button style="background:none;border:none;color:var(--vscode-descriptionForeground,#666);cursor:pointer;font-size:16px;flex-shrink:0;" id="__wg_closeInsp">&times;</button>
      </div>
      <div style="color:var(--vscode-descriptionForeground,#666);font-size:11px;margin-bottom:8px">${_esc(node.domain)} &middot; ${_esc(node.meta.type || '')}</div>
    `;

    if (node.meta.uri) {
      html += `<div style="color:#555;font-size:10px;word-break:break-all;margin-bottom:8px">${_esc(node.meta.uri)}</div>`;
    }

    if (node.meta.ideaCluster) {
      html += `<div style="display:flex;align-items:center;gap:6px;color:var(--vscode-descriptionForeground,#888);font-size:11px;margin-bottom:8px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${_esc(node.meta.ideaCluster.color)}"></span>
        Idea cluster ${_esc(node.meta.ideaCluster.rank)} · ${_esc(node.meta.ideaCluster.size)} nodes
      </div>`;
    }

    // AI inspector section — enabled for any node with semantic connections,
    // even if it has no indexed content itself (concept/structural nodes).
    const askBtnStyle = 'background:var(--vscode-button-secondaryBackground,#1a1a2e);color:var(--vscode-button-secondaryForeground,#aaa);border:1px solid var(--vscode-panel-border,#2a2a4a);border-radius:4px;padding:3px 9px;font-size:11px;cursor:pointer;font-family:var(--parallx-fontFamily-ui);';
    if (semanticConns.length > 0) {
      html += `<div id="__wg_ai" style="margin:0 0 10px;"><button id="__wg_askAi" style="${askBtnStyle}">✦ Ask AI</button></div>`;
    } else {
      html += `<div id="__wg_ai" style="margin:0 0 10px;"><span style="color:#555;font-size:11px" title="No semantic connections to analyze">✦ Ask AI</span></div>`;
    }

    html += `<div style="margin-top:8px"><strong style="color:var(--vscode-descriptionForeground,#888);font-size:11px">Connections (${connections.length})</strong>`;
    const rowOpenBtnStyle = 'background:none;border:none;color:var(--vscode-descriptionForeground,#555);cursor:pointer;font-size:11px;padding:0 2px;flex-shrink:0;line-height:1;';
    html += connections.length
      ? connections.map(({ edge, node: other }) => {
          const canOpen = other.domain === 'canvas-page' || other.domain === 'file';
          return `<div class="__wg_inspLink" data-id="${other.id}" style="padding:5px 0;cursor:pointer;color:#9ab;font-size:11px;border-bottom:1px solid rgba(127,127,127,.12)">
            <div style="display:flex;align-items:center;gap:2px">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(other.label)}</span>
              ${canOpen ? `<button class="__wg_openLink" data-node-id="${other.id}" title="Open" style="${rowOpenBtnStyle}">↗</button>` : ''}
            </div>
            <div style="color:var(--vscode-descriptionForeground,#777);font-size:10px">${_esc(_formatConnectionMeta(edge))}</div>
          </div>`;
        }).join('')
      : '<div style="color:#555;font-size:11px">None</div>';
    html += '</div>';

    inspInner.innerHTML = html;

    const closeBtn = inspInner.querySelector('#__wg_closeInsp');
    if (closeBtn) closeBtn.addEventListener('click', _closeInspector);

    const openNodeBtn = inspInner.querySelector('#__wg_openNode');
    if (openNodeBtn) openNodeBtn.addEventListener('click', (e) => { e.stopPropagation(); _openNodeExternally(node); });

    const askBtn = inspInner.querySelector('#__wg_askAi');
    if (askBtn) askBtn.addEventListener('click', () => _askAi(node, semanticConns));

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

    for (const openBtn of inspInner.querySelectorAll('.__wg_openLink')) {
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = m.byId.get(openBtn.dataset.nodeId);
        if (target) _openNodeExternally(target);
      });
    }
  }

  function _openNodeExternally(node) {
    if (node.domain === 'file' && node.meta.uri) {
      api.editors.openFileEditor(node.meta.uri).catch(err => console.warn('[WorkspaceGraph] openFileEditor failed:', err));
    } else if (node.domain === 'canvas-page') {
      const instanceId = node.meta.pageId || node.id.slice('page:'.length);
      api.editors.openEditor({ typeId: 'canvas', title: node.meta.title || node.label, icon: node.meta.icon, instanceId })
        .catch(err => console.warn('[WorkspaceGraph] openEditor failed:', err));
    }
  }

  function _addToChat(node, parsed, semanticConns) {
    // Build a self-describing block so the chat AI has full framing context —
    // it won't know this came from the workspace graph inspector otherwise.
    const domainLabel = node.domain === 'canvas-page' ? 'Canvas page' : node.domain === 'file' ? 'File' : node.domain;
    let text =
      `The following is an AI-generated analysis from the Parallx Workspace Graph inspector.\n` +
      `It was produced by examining the indexed content of a node and its semantic neighbors.\n\n` +
      `Node: "${node.label}" (${domainLabel})\n\n` +
      `Summary:\n${parsed.summary}`;

    if (Array.isArray(parsed.connections) && semanticConns.length > 0) {
      text += '\n\nSemantic connections (conceptually related nodes in the workspace):';
      semanticConns.forEach((conn, i) => {
        const explanation = parsed.connections[i];
        if (explanation) {
          const connDomain = conn.node.domain === 'canvas-page' ? 'canvas page' : conn.node.domain === 'file' ? 'file' : conn.node.domain;
          text += `\n- "${conn.node.label}" (${connDomain}): ${explanation}`;
        }
      });
    }

    text += '\n\nYou can ask follow-up questions about this node, explore any of its connections, or request deeper analysis of the concepts described above.';

    document.dispatchEvent(new CustomEvent('parallx-selection-action', {
      bubbles: true,
      detail: {
        actionId: 'add-to-chat',
        selectedText: text,
        surface: 'workspace-graph',
        source: {
          fileName: `Workspace Graph — ${node.label}`,
          filePath: node.meta.uri || node.id,
        },
      },
    }));
  }

  async function _askAi(node, semanticConns) {
    const requestNodeId = node.id;
    const aiDiv = inspInner.querySelector('#__wg_ai');
    if (!aiDiv) return;

    const service = _getSemanticGraphService(api);
    if (!service || typeof service.getNodeChunks !== 'function') {
      aiDiv.innerHTML = '<span style="color:#666;font-size:11px">AI summary not available.</span>';
      return;
    }

    // Loading state
    aiDiv.innerHTML = '<span style="color:#777;font-size:11px">✦ Thinking…</span>';

    // Fetch chunks for node and all semantic neighbors in parallel
    let nodeChunks, neighborChunkSets;
    try {
      [nodeChunks, ...neighborChunkSets] = await Promise.all([
        service.getNodeChunks(node.id),
        ...semanticConns.map(c => service.getNodeChunks(c.node.id)),
      ]);
    } catch (err) {
      console.warn('[WorkspaceGraph] getNodeChunks failed:', err);
      if (selected?.id === requestNodeId) {
        aiDiv.innerHTML = '<span style="color:#a55;font-size:11px">Failed to read content.</span>';
      }
      return;
    }

    if (selected?.id !== requestNodeId) return;

    // Build prompt — two modes depending on whether the node has its own content.
    const hasOwnContent = nodeChunks && nodeChunks.length > 0;
    let userMsg;

    if (hasOwnContent) {
      // ── Standard mode: node has indexed content ──────────────────────────────
      const nodeText = nodeChunks.map(c => c.text).join('\n\n');
      userMsg = `## Source to Analyze\nTitle: ${node.label}\n\n${nodeText}`;

      if (semanticConns.length > 0) {
        userMsg += '\n\n## Related Sources\n';
        semanticConns.forEach((c, i) => {
          const chunks = neighborChunkSets[i] || [];
          const text = chunks.map(ch => ch.text).join('\n\n') || '(no indexed content)';
          userMsg += `\n### [${i + 1}] ${c.node.label}\n${text}`;
        });
        userMsg += `

## Your Task

**Step 1 — Summary**
Write 3–4 sentences describing what the main source is about. Name the specific concepts, arguments, formulas, or information it contains. Explain what makes it significant and how it fits into the broader subject area.

**Step 2 — Connections**
For each related source above, write 1–2 sentences describing the precise intellectual relationship to the main source. Focus on how the knowledge in one source depends on, extends, applies, or contrasts with the knowledge in the other. Name the specific concepts, definitions, or ideas that form the bridge.

Weak example (too vague — do not write like this): "Both sources discuss mortality."
Strong example (specific and precise): "The force of mortality defined in the main source is the continuous foundation that the related source applies directly in its net single premium derivations — grasping the integral form here is a prerequisite for following the formulas there."

The connections array must have exactly ${semanticConns.length} entries, one per related source in the order listed above ([1], [2], ...).

Respond using this exact JSON with no other text before or after it:
{"summary":"...","connections":["explanation for [1]","explanation for [2]"]}`;
      } else {
        userMsg += `

## Your Task

Write 3–4 sentences describing what this source is about. Name the specific concepts, arguments, formulas, or information it contains. Explain what makes it significant and how it fits into the broader subject area.

Respond using this exact JSON with no other text before or after it:
{"summary":"...","connections":[]}`;
      }
    } else {
      // ── Concept-node mode: no indexed content — infer from neighbors ─────────
      // The node itself has no text, but its semantic connections do. Ask the AI
      // to infer what concept or theme the node label represents based purely on
      // the content of its connected sources.
      userMsg = `## Concept Node\nLabel: "${node.label}"\n\nThis node has no direct content of its own. It is a connecting concept in a knowledge graph, semantically linked to the following sources.\n\n## Connected Sources\n`;
      semanticConns.forEach((c, i) => {
        const chunks = neighborChunkSets[i] || [];
        const text = chunks.map(ch => ch.text).join('\n\n') || '(no indexed content)';
        userMsg += `\n### [${i + 1}] ${c.node.label}\n${text}`;
      });
      userMsg += `

## Your Task

This node is labeled "${node.label}" and acts as a shared concept or theme connecting the sources above.

**Step 1 — Concept summary**
Write 3–4 sentences explaining what concept, idea, or theme this node label represents, inferred entirely from the connected sources. Be specific: name the exact theories, formulas, principles, or arguments that appear across the connected sources and explain why they cohere under the label "${node.label}".

**Step 2 — Connections**
For each connected source above, write 1–2 sentences explaining how that source instantiates, applies, or contributes to the central concept. Name specific ideas, formulas, or arguments from that source.

The connections array must have exactly ${semanticConns.length} entries, one per connected source in the order listed above ([1], [2], ...).

Respond using this exact JSON with no other text before or after it:
{"summary":"...","connections":["explanation for [1]","explanation for [2]"]}`;
    }

    const messages = [
      {
        role: 'system',
        content: 'You are a knowledge assistant helping a user build a mind map of their study material and personal notes. Your job is to surface precise meaning: explain what a source is truly about and identify the exact intellectual relationships between connected sources — dependencies, applications, extensions, contrasts, or shared foundations. Be specific and technical. Name concepts, formulas, and ideas explicitly. Avoid vague statements like "both discuss X." Do not invent information not present in the provided content.',
      },
      { role: 'user', content: userMsg },
    ];

    // Resolve model — prefer active chat session, fall back to first available
    let stream;
    try {
      const provider = await api.commands.executeCommand('chat.getInlineAIProvider').catch(() => null);
      if (provider?.sendChatRequest) {
        stream = provider.sendChatRequest(messages);
      } else {
        const models = await api.lm.getModels();
        if (!models || !models.length) {
          if (selected?.id === requestNodeId) {
            aiDiv.innerHTML = '<span style="color:#a55;font-size:11px">No language model available. Open a chat session or configure a model in AI Settings.</span>';
          }
          return;
        }
        stream = api.lm.sendChatRequest(models[0].id, messages);
      }
    } catch (err) {
      console.warn('[WorkspaceGraph] AI model error:', err);
      if (selected?.id === requestNodeId) {
        aiDiv.innerHTML = '<span style="color:#a55;font-size:11px">AI request failed.</span>';
      }
      return;
    }

    // Show thinking indicator while stream runs — do NOT render raw JSON tokens
    let _thinkDots = 0;
    const _thinkTimer = setInterval(() => {
      _thinkDots = (_thinkDots + 1) % 4;
      if (selected?.id === requestNodeId) {
        aiDiv.innerHTML = `<span style="color:#777;font-size:11px">✦ Thinking${'.'.repeat(_thinkDots)}</span>`;
      }
    }, 400);

    // Stream and accumulate (silently)
    let fullText = '';
    try {
      for await (const chunk of stream) {
        if (selected?.id !== requestNodeId) { clearInterval(_thinkTimer); return; }
        fullText += chunk.content || '';
      }
    } catch (err) {
      console.warn('[WorkspaceGraph] AI stream error:', err);
    } finally {
      clearInterval(_thinkTimer);
    }

    if (selected?.id !== requestNodeId) return;

    // Parse structured JSON response — greedy match to tolerate preamble/postamble
    let parsed = null;
    try {
      const match = fullText.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch { /* fall through to raw render */ }

    const askBtnStyle = 'background:none;border:none;color:var(--vscode-descriptionForeground,#555);cursor:pointer;font-size:11px;padding:4px 0 0;font-family:var(--parallx-fontFamily-ui);';
    const actionRowHtml = `<div style="display:flex;gap:12px;margin-top:4px"><button id="__wg_reaskAi" style="${askBtnStyle}">↺ Re-ask AI</button><button id="__wg_addToChat" style="${askBtnStyle}">→ Add to Chat</button></div>`;
    if (parsed?.summary) {
      aiDiv.innerHTML = `<div style="color:var(--vscode-editor-foreground,#ddd);font-size:12px;line-height:1.6;margin-bottom:6px">${_esc(parsed.summary)}</div>${actionRowHtml}`;
      // Attach connection explanations by index — the model returns an ordered
      // array matching semanticConns order, so we never rely on it reproducing
      // node IDs (which fail with long URL-encoded paths).
      if (Array.isArray(parsed.connections)) {
        semanticConns.forEach((conn, i) => {
          const explanation = parsed.connections[i];
          if (!explanation || typeof explanation !== 'string') return;
          const linkEl = Array.from(inspInner.querySelectorAll('.__wg_inspLink'))
            .find(el => el.dataset.id === conn.node.id);
          if (!linkEl) return;
          const expDiv = document.createElement('div');
          expDiv.style.cssText = 'color:#8899aa;font-size:10px;margin-top:3px;font-style:italic;line-height:1.4;';
          expDiv.textContent = explanation;
          linkEl.appendChild(expDiv);
        });
      }
    } else {
      // Fallback: raw model text so the user always sees something
      aiDiv.innerHTML = `<div style="color:#aaa;font-size:11px;line-height:1.5;white-space:pre-wrap">${_esc(fullText || 'No response.')}</div>${actionRowHtml}`;
    }

    const reaskBtn = aiDiv.querySelector('#__wg_reaskAi');
    if (reaskBtn) reaskBtn.addEventListener('click', () => _askAi(node, semanticConns));

    const addToChatBtn = aiDiv.querySelector('#__wg_addToChat');
    if (addToChatBtn && parsed?.summary) addToChatBtn.addEventListener('click', () => _addToChat(node, parsed, semanticConns));
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
    // Preserve whichever node was selected — across both same-instance refreshes
    // (e.g. canvas page change event) and cross-instance recreations where
    // _model._lastSelectedId survives because _model is module-level.
    const prevSelectedId = selected?.id ?? _model._lastSelectedId ?? null;
    await m.refresh();

    hovered = null;
    nodeCount.textContent = `${m.nodes.length} nodes \xb7 ${m.edges.length} edges`;

    const q = searchInput.value.toLowerCase().trim();
    if (q) {
      for (const n of m.nodes) {
        n.visible = n.label.toLowerCase().includes(q) || n.domain.toLowerCase().includes(q);
      }
    }

    // Restore inspector if the previously selected node still exists in the
    // refreshed graph, otherwise close it.
    if (prevSelectedId && m.byId.has(prevSelectedId)) {
      selected = m.byId.get(prevSelectedId);
      inspector.style.width = '280px';
      _renderInspector(selected);
    } else {
      selected = null;
      inspector.style.width = '0';
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

  // M76 Phase 3 — subscribe to mind-map refresh status events so the
  // settings panel stays in sync with refresh progress. Only meaningful
  // while the panel is open; if closed, the rebuild is a cheap no-op.
  let refreshStatusSub;
  let refreshCompleteSub;
  const refreshOrch = _getRefreshOrchestrator(api);
  if (refreshOrch) {
    refreshStatusSub = refreshOrch.onDidChangeStatus(() => {
      if (settingsOpen) _buildSettingsPanel();
    });
    refreshCompleteSub = refreshOrch.onDidComplete(() => {
      if (settingsOpen) _buildSettingsPanel();
    });
  }

  return {
    dispose() {
      disposed = true;
      _editorActive = false;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (changePageSub) changePageSub.dispose();
      if (refreshStatusSub) refreshStatusSub.dispose();
      if (refreshCompleteSub) refreshCompleteSub.dispose();
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

  // Interaction — same model as the full editor: click a node to drag it,
  // click empty space to pan. Shift+click pins/unpins a node.
  let dragNode = null;
  let panning = false;
  let panStart = null;

  cvs.addEventListener('pointerdown', (ev) => {
    const rect = cvs.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const node = hitTest(m.nodes, sx, sy, view);

    if (node) {
      if (ev.shiftKey) { node.pinned = !node.pinned; return; }
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

  cvs.addEventListener('pointerup', () => {
    if (dragNode) { dragNode = null; }
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
  _registerSemanticGraphProvider(api, context);

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

  const rebuildConceptualCmd = api.commands.registerCommand('workspaceGraph.rebuildConceptualLinks', async () => {
    const service = _getSemanticGraphService(api);
    if (!service || typeof service.rebuildChangedSources !== 'function') return;
    if (typeof service.ensureCacheStarted === 'function') service.ensureCacheStarted();
    await service.rebuildChangedSources();
    if (api.workspaceGraph && typeof api.workspaceGraph.notifyChange === 'function') {
      api.workspaceGraph.notifyChange();
    }
  });
  context.subscriptions.push(rebuildConceptualCmd);

  // ── Live event subscriptions ──
  // Drive `_model.refresh()` whenever something we care about changes.
  // Debounced to coalesce bursts (e.g. editor open + tab change at once).
  // The model is shared, so both the sidebar and the editor pick up the
  // new data on the next animation frame.
  let _refreshTimer = null;
  const _scheduleRefresh = (delay = 400) => {
    if (_refreshTimer) return;
    _refreshTimer = setTimeout(() => {
      _refreshTimer = null;
      if (_model._api) _model.refresh().catch(err => console.warn('[WorkspaceGraph] refresh failed:', err));
    }, delay);
  };

  // Provider contributions (extensions register/unregister/notifyChange).
  if (api.workspaceGraph && typeof api.workspaceGraph.onDidChange === 'function') {
    context.subscriptions.push(api.workspaceGraph.onDidChange(() => _scheduleRefresh(200)));
  }
  // Editor lifecycle — opening/closing a tab often correlates with new
  // file or session activity.
  if (api.editors && typeof api.editors.onDidChangeOpenEditors === 'function') {
    context.subscriptions.push(api.editors.onDidChangeOpenEditors(() => _scheduleRefresh(800)));
  }
  // Workspace folder changes.
  if (api.workspace && typeof api.workspace.onDidChangeWorkspaceFolders === 'function') {
    context.subscriptions.push(api.workspace.onDidChangeWorkspaceFolders(() => _scheduleRefresh(200)));
  }
  // Link contract changes (new extension links → new cross-domain edges
  // when providers consume them).
  if (api.links && typeof api.links.onDidChangeContracts === 'function') {
    context.subscriptions.push(api.links.onDidChangeContracts(() => _scheduleRefresh(800)));
  }
  // Periodic re-scan for file/session changes that don't fire events.
  // Cheap — _collectFiles walks 3 levels deep with hidden-dir filtering.
  const _periodicTimer = setInterval(() => _scheduleRefresh(0), 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(_periodicTimer) });

  // M66 link contract — `parallx://workspace-graph/node/<nodeId>` opens the
  // graph editor focused on the given node. Iter A opens the graph; per-node
  // focus is best-effort (the editor's load logic accepts a `?focus=` hint).
  if (api.links && typeof api.links.register === 'function') {
    context.subscriptions.push(api.links.register({
      segment: 'workspace-graph',
      displayName: 'Workspace Graph',
      kinds: {
        node: {
          uriTemplate: 'parallx://workspace-graph/node/<nodeId>',
          description: 'Open the workspace graph focused on the given node id (e.g. `file:...`, `page:...`).',
          examples: ['parallx://workspace-graph/node/page%3A01HZX...'],
          async open(parsed) {
            const id = parsed.pathSegments[1];
            if (!id) return false;
            try {
              await api.editors.openEditor({
                typeId: 'workspace-graph',
                title: 'Workspace Graph',
                icon: 'codicon-graph',
                instanceId: 'main',
              });
              return true;
            } catch { return false; }
          },
          async resolveMetadata(parsed) {
            const id = parsed.pathSegments[1];
            return id ? { title: id, icon: '🕸️' } : null;
          },
        },
      },
    }));
  }
}
