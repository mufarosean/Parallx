#!/usr/bin/env node
/**
 * Live Chat Graph Server — graph-v3
 *
 * Scans src/built-in/chat/ for .ts files, parses imports/exports via regex,
 * watches for changes via fs.watch, and pushes graph updates to the browser
 * over Server-Sent Events. Zero npm dependencies — Node built-ins only.
 *
 * Usage:  node tools/graph-v3/graph-server.mjs [--port 4900]
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ── CLI args ── */
const args = process.argv.slice(2);
let PORT = 4900;
const pi = args.indexOf('--port');
if (pi !== -1 && args[pi + 1]) PORT = Number(args[pi + 1]);

/* ── Paths ── */
const ROOT = path.resolve(__dirname, '../..');            // d:\AI\Parallx
const CHAT_DIR = path.join(ROOT, 'src/built-in/chat');
const HTML_FILE = path.join(__dirname, 'index.html');

/* ══════════════════════════════════════════════════════
   SCANNER — reads .ts files, extracts imports & exports
   ══════════════════════════════════════════════════════ */

/** Recursively find all .ts files under a directory. */
function walkTs(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** Parse one .ts file and return graph metadata. */
function parseFile(absPath) {
  const rel = path.relative(CHAT_DIR, absPath).replace(/\\/g, '/');
  const name = path.basename(rel);
  const dir = rel.includes('/') ? rel.split('/')[0] : 'root';
  const src = fs.readFileSync(absPath, 'utf-8');
  const lineCount = src.split('\n').length;

  // ── Imports ──
  const localImports = [];   // relative imports resolved to chat IDs
  const externalImports = []; // package / non-chat imports
  const importRe = /from\s+['"](.*?)['"]/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      // Resolve relative to this file's directory, strip .js/.ts extension
      const stripped = spec.replace(/\.(js|ts)$/, '');
      const resolved = path
        .resolve(path.dirname(absPath), stripped)
        .replace(/\\/g, '/');
      // Normalise to a chat-relative path without extension
      const chatRel = path.relative(CHAT_DIR, resolved).replace(/\\/g, '/');
      // Only include imports that resolve inside the chat directory
      if (!chatRel.startsWith('..')) {
        localImports.push(chatRel);
      } else {
        // External relative import (services, platform, etc.)
        // Categorise by top-level folder
        const parts = chatRel.replace(/^(\.\.\/)+/, '').split('/');
        const category = parts.length > 1 ? parts[0] + '/' + parts[1] : parts[0];
        externalImports.push(category.replace(/\.ts$/, ''));
      }
    } else {
      externalImports.push(spec);
    }
  }

  // ── Exports ──
  const exports_ = [];
  const exportRe = /export\s+(?:default\s+)?(?:abstract\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g;
  while ((m = exportRe.exec(src)) !== null) exports_.push(m[1]);
  // export { X, Y }
  const reExportRe = /export\s*\{([^}]+)\}/g;
  while ((m = reExportRe.exec(src)) !== null) {
    for (const token of m[1].split(',')) {
      const nm = token.trim().split(/\s+as\s+/).pop().trim();
      if (nm) exports_.push(nm);
    }
  }

  // ── Description from first JSDoc or first // comment ──
  let desc = '';
  const jsdocRe = /\/\*\*\s*([\s\S]*?)\*\//;
  const jm = jsdocRe.exec(src);
  if (jm) {
    desc = jm[1].replace(/^\s*\*\s?/gm, '').trim().split('\n')[0].trim();
  }
  if (!desc) {
    const lineRe = /^\/\/\s*(.+)/m;
    const lm = lineRe.exec(src);
    if (lm) desc = lm[1].trim();
  }
  if (!desc) desc = name;

  return {
    id: rel.replace(/\.ts$/, ''),   // e.g. "participants/defaultParticipant"
    path: rel,                       // e.g. "participants/defaultParticipant.ts"
    dir,
    desc,
    lineCount,
    exports: [...new Set(exports_)],
    localImports: [...new Set(localImports)],  // chat-relative paths without ext
    externalImports: [...new Set(externalImports)],
  };
}

/** Build complete graph JSON. */
function buildGraph() {
  const files = walkTs(CHAT_DIR);
  const nodes = files.map(f => parseFile(f));

  // Build lookup: path-without-ext → id
  const idByPathNoExt = new Map();
  for (const n of nodes) {
    idByPathNoExt.set(n.id, n.id);
    // Also map without index  (folder/index → folder)
    if (n.id.endsWith('/index')) idByPathNoExt.set(n.id.replace(/\/index$/, ''), n.id);
  }

  // Resolve edges
  const edges = [];
  for (const n of nodes) {
    for (const imp of n.localImports) {
      const targetId = idByPathNoExt.get(imp);
      if (targetId) {
        edges.push({ source: n.id, target: targetId });
      }
    }
  }

  // Compute sizes based on usage + line count
  const usedByCount = new Map();
  for (const e of edges) usedByCount.set(e.target, (usedByCount.get(e.target) || 0) + 1);

  for (const n of nodes) {
    const ub = usedByCount.get(n.id) || 0;
    const dep = n.localImports.length;
    const isEntry = n.id === 'chatTool';
    const isLarge = n.lineCount > 800;

    if (isEntry) n.radius = 28;
    else if (isLarge && ub >= 3) n.radius = 24;
    else if (ub >= 7) n.radius = 22;
    else if (ub >= 4 || isLarge) n.radius = 18;
    else if (ub >= 2 || dep >= 4) n.radius = 14;
    else if (dep >= 2) n.radius = 11;
    else if (dep >= 1 || ub >= 1) n.radius = 9;
    else n.radius = 7;
  }

  return {
    timestamp: Date.now(),
    nodes: nodes.map(n => ({
      id: n.id,
      path: n.path,
      dir: n.dir,
      desc: n.desc,
      lineCount: n.lineCount,
      exports: n.exports,
      imports: n.localImports.filter(i => idByPathNoExt.has(i)).map(i => idByPathNoExt.get(i)),
      external: n.externalImports,
      radius: n.radius,
    })),
    edges,
  };
}

/* ══════════════════════════════════════════════════════
   SSE — Server-Sent Events push to browser clients
   ══════════════════════════════════════════════════════ */
const sseClients = new Set();

function broadcast(graph) {
  const data = JSON.stringify(graph);
  for (const res of sseClients) {
    res.write(`data: ${data}\n\n`);
  }
}

/* ══════════════════════════════════════════════════════
   FILE WATCHER — fs.watch recursive (Windows+macOS)
   ══════════════════════════════════════════════════════ */
let debounceTimer = null;

function onFileChange(eventType, filename) {
  if (!filename) return;
  const ext = path.extname(filename);
  if (ext !== '.ts') return;

  // Debounce rapid saves
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    console.log(`  \x1b[33m⟳\x1b[0m  ${filename} changed — rescanning...`);
    try {
      const graph = buildGraph();
      broadcast(graph);
      console.log(`  \x1b[32m✓\x1b[0m  pushed ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    } catch (err) {
      console.error('  ✗  scan error:', err.message);
    }
  }, 150);
}

/* ══════════════════════════════════════════════════════
   HTTP SERVER — serves index.html + SSE endpoint
   ══════════════════════════════════════════════════════ */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // SSE endpoint
  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.flushHeaders();
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));

    // Send current state immediately
    const graph = buildGraph();
    res.write(`data: ${JSON.stringify(graph)}\n\n`);
    return;
  }

  // JSON snapshot (for manual/curl access)
  if (url.pathname === '/graph.json') {
    const graph = buildGraph();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(graph, null, 2));
    return;
  }

  // Static files — only serve from this directory
  let filePath = url.pathname === '/' ? HTML_FILE : path.join(__dirname, url.pathname);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

/* ── Start ── */
const initialGraph = buildGraph();
console.log(`\n  \x1b[1m\x1b[36mChat Graph Server\x1b[0m`);
console.log(`  Scanning:  ${CHAT_DIR}`);
console.log(`  Found:     ${initialGraph.nodes.length} files, ${initialGraph.edges.length} edges`);
console.log(`  Watching:  fs.watch (recursive)\n`);

fs.watch(CHAT_DIR, { recursive: true }, onFileChange);
server.listen(PORT, () => {
  console.log(`  \x1b[36m➜\x1b[0m  http://localhost:${PORT}\n`);
});
