#!/usr/bin/env node
/**
 * build-icon-registry.mjs
 *
 * Reads real Lucide SVG files from node_modules/lucide-static/icons/
 * and generates src/ui/iconRegistry.generated.ts with every icon Parallx needs.
 *
 * Run: node scripts/build-icon-registry.mjs
 * Output: src/ui/iconRegistry.generated.ts
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const LUCIDE_DIR = 'node_modules/lucide-static/icons';
const OUTPUT = 'src/ui/iconRegistry.generated.ts';

function lucide(filename) {
  const raw = readFileSync(join(LUCIDE_DIR, filename), 'utf8');
  const innerMatch = raw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!innerMatch) throw new Error(`Could not parse ${filename}`);
  const inner = innerMatch[1]
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .replace(/\s*\/>/g, '/>')
    .trim();
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

function L(name) { return lucide(`${name}.svg`); }

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETE ICON MAP: app-key → Lucide source file
// Every icon Parallx uses, mapped to its semantically correct Lucide icon.
// ─────────────────────────────────────────────────────────────────────────────

const icons = {
  // ── Navigation ──
  'chevron-right':     L('chevron-right'),
  'chevron-left':      L('chevron-left'),
  'chevron-down':      L('chevron-down'),
  'chevron-up':        L('chevron-up'),
  'arrow-up':          L('arrow-up'),
  'arrow-down':        L('arrow-down'),
  'arrow-left':        L('arrow-left'),
  'arrow-right':       L('arrow-right'),
  'chevrons-up-down':  L('chevrons-up-down'),
  'chevrons-down-up':  L('chevrons-down-up'),
  'move-vertical':     L('move-vertical'),
  'expand':            L('expand'),
  'external-link':     L('external-link'),

  // ── Actions ──
  'plus':              L('plus'),
  'x':                 L('x'),
  'check':             L('check'),
  'search':            L('search'),
  'trash':             L('trash-2'),
  'pencil':            L('pencil'),
  'copy':              L('copy'),
  'download':          L('download'),
  'upload':            L('upload'),
  'refresh':           L('refresh-cw'),
  'rotate':            L('rotate-cw'),
  'rotate-ccw':        L('rotate-ccw'),
  'rotate-cw':         L('rotate-cw'),
  'undo':              L('undo-2'),
  'redo':              L('redo-2'),
  'send':              L('send'),
  'replace':           L('replace'),
  'filter':            L('filter'),
  'filter-x':          L('filter-x'),
  'share':             L('share'),
  'printer':           L('printer'),
  'zoom-in':           L('zoom-in'),
  'zoom-out':          L('zoom-out'),
  'duplicate':         L('copy'),      // same as copy
  'restore':           L('rotate-ccw'),
  'export':            L('download'),

  // ── Documents / Files ──
  'file':              L('file'),
  'file-text':         L('file-text'),
  'file-code':         L('file-code'),
  'file-json':         L('file-json'),
  'file-type':         L('file-type'),
  'file-spreadsheet':  L('file-spreadsheet'),
  'file-image':        L('file-image'),
  'file-plus':         L('file-plus'),
  'file-minus':        L('file-minus'),
  'file-attachment':   L('paperclip'),
  'folder':            L('folder'),
  'folder-open':       L('folder-open'),
  'folder-tree':       L('folder-tree'),
  'page':              L('file-text'),
  'page-filled':       L('notebook'),
  'new-page':          L('file-plus'),

  // ── Content Types ──
  'note':              L('sticky-note'),
  'bookmark':          L('bookmark'),
  'book-marked':       L('book-marked'),
  'checklist':         L('square-check'),
  'calendar':          L('calendar'),
  'flag':              L('flag'),
  'heart':             L('heart'),
  'target':            L('target'),
  'star':              L('star'),
  'lightbulb':         L('lightbulb'),
  'globe':             L('globe'),
  'home':              L('home'),
  'inbox':             L('inbox'),
  'tag':               L('tag'),
  'code':              L('code'),
  'rocket':            L('rocket'),
  'book':              L('book-open'),
  'book-open':         L('book-open'),
  'compass':           L('compass'),
  'puzzle':            L('puzzle'),
  'terminal':          L('terminal'),
  'database':          L('database'),
  'grid':              L('grid-3x3'),
  'layers':            L('layers'),
  'users':             L('users'),
  'user':              L('user'),
  'pin':               L('pin'),
  'archive':           L('archive'),
  'music':             L('music'),
  'coffee':            L('coffee'),
  'diamond':           L('diamond'),
  'key':               L('key'),
  'image':             L('image'),
  'link':              L('link'),
  'link-2':            L('link-2'),
  'smile':             L('smile'),
  'video':             L('video'),
  'audio':             L('headphones'),
  'math':              L('sigma'),
  'math-block':        L('sigma'),
  'bolt':              L('zap'),
  'color':             L('palette'),
  'highlight':         L('highlighter'),

  // ── Text Formatting ──
  'format-bold':       L('bold'),
  'format-italic':     L('italic'),
  'format-underline':  L('underline'),
  'format-strikethrough': L('strikethrough'),
  'align-left':        L('align-left'),
  'align-center':      L('align-center'),
  'align-right':       L('align-right'),
  'bullet-list':       L('list'),
  'numbered-list':     L('list-ordered'),
  'quote':             L('quote'),
  'divider':           L('minus'),
  'columns':           L('columns-3'),
  'toc':               L('table-of-contents'),
  'text-size':         L('a-large-small'),
  'type':              L('type'),
  'pilcrow':           L('pilcrow'),

  // ── Database Views ──
  'view-table':        L('table-2'),
  'view-board':        L('kanban'),
  'view-list':         L('layout-list'),
  'view-gallery':      L('layout-grid'),
  'view-calendar':     L('calendar'),
  'view-timeline':     L('gantt-chart'),
  'database-link':     L('link-2'),

  // ── Database Toolbar ──
  'db-filter':         L('filter'),
  'db-sort':           L('arrow-up-down'),
  'db-group':          L('group'),
  'db-settings':       L('settings'),
  'db-collapse':       L('chevrons-down-up'),
  'db-expand':         L('chevrons-up-down'),
  'automations':       L('workflow'),

  // ── Layout / Panels ──
  'sidebar-left':      L('panel-left'),
  'sidebar-right':     L('panel-right'),
  'panel-bottom':      L('panel-bottom'),
  'panel-top':         L('panel-top'),
  'fullscreen':        L('maximize-2'),
  'exit-fullscreen':   L('minimize-2'),
  'expand-width':      L('expand'),
  'columns-2':         L('columns-2'),

  // ── UI Chrome ──
  'menu':              L('menu'),
  'ellipsis':          L('ellipsis'),
  'more-horizontal':   L('more-horizontal'),
  'more-vertical':     L('more-vertical'),
  'grip-vertical':     L('grip-vertical'),
  'info':              L('info'),
  'settings':          L('settings'),
  'gear':              L('settings'),
  'lock':              L('lock'),
  'shield':            L('shield-check'),
  'circle':            L('circle'),
  'circle-dot':        L('circle-dot'),
  'circle-check':      L('circle-check'),
  'circle-x':          L('circle-x'),
  'circle-alert':      L('circle-alert'),
  'ban':               L('ban'),
  'hash':              L('hash'),
  'open':              L('external-link'),
  'open-full-page':    L('maximize-2'),
  'edit':              L('pencil'),

  // ── Status / Indicators ──
  'check-circle':      L('circle-check'),
  'x-circle':          L('circle-x'),
  'alert-triangle':    L('alert-triangle'),
  'warning':           L('alert-triangle'),

  // ── Communication ──
  'message':           L('message-square'),
  'message-circle':    L('message-circle'),
  'bell':              L('bell'),
  'comment':           L('message-circle'),
  'at-sign':           L('at-sign'),

  // ── AI / Magic ──
  'sparkle':           L('sparkles'),
  'sparkles':          L('sparkles'),
  'wand':              L('wand-2'),
  'brain':             L('brain'),
  'bot':               L('bot'),

  // ── Theme ──
  'moon':              L('moon'),
  'sun':               L('sun'),

  // ── Visibility ──
  'eye':               L('eye'),
  'eye-off':           L('eye-off'),
  'clock':             L('clock'),

  // ── Tools ──
  'wrench':            L('wrench'),
  'palette':           L('palette'),
  'keyboard':          L('keyboard'),
  'bar-chart':         L('bar-chart-2'),
  'paintbrush':        L('paintbrush'),
  'package':           L('package'),
  'plug':              L('plug'),
  'cable':             L('cable'),
  'square-terminal':   L('square-terminal'),

  // ── History / Time ──
  'history':           L('history'),

  // ── Misc ──
  'scan-line':         L('scan-line'),
  'flip-horizontal':   L('flip-horizontal-2'),
  'separator':         L('separator-horizontal'),
  'scroll-text':       L('scroll-text'),
  'notebook-pen':      L('notebook-pen'),
  'star-filled':       L('star'),       // same shape, fill handled by CSS
  'square':            L('square'),

  // ── Chat-specific aliases ──
  'chat-bubble':       L('message-square'),
  'agent':             L('bot'),
  'stop':              L('square'),
  'attach':            L('paperclip'),
  'tools':             L('wrench'),
  'person':            L('user'),
  'selection':         L('text-cursor-input'),
  'close':             L('x'),
  'section-expanded':  L('chevron-down'),

  // ── Avatar Icons ──
  'avatar-brain':      L('brain'),
  'avatar-briefcase':  L('briefcase'),
  'avatar-pen':        L('pen-tool'),
  'avatar-coins':      L('coins'),
  'avatar-microscope': L('microscope'),
  'avatar-chart':      L('chart-no-axes-column'),
  'avatar-target':     L('crosshair'),
  'avatar-robot':      L('bot'),
  'avatar-fox':        L('cat'),        // closest animal icon in Lucide
  'avatar-wave':       L('waves'),
  'avatar-lightning':  L('zap'),
  'avatar-puzzle':     L('puzzle'),

  // ── PDF Toolbar ──
  'fit-width':         L('scan-line'),
  'fit-page':          L('expand'),
  'spread':            L('book-copy'),
  'list-tree':         L('list'),

  // ── Search / Find ──
  'toggle-replace':    L('replace'),

  // ── Editor ──
  'split-editor':      L('columns-2'),
  'markdown-preview':  L('book-open'),
};

// ─── Generate the TypeScript file ───────────────────────────────────────────

const entries = Object.entries(icons).map(([key, svg]) => {
  return `  '${key}': '${svg.replace(/'/g, "\\'")}',`;
});

const output = `// AUTO-GENERATED — DO NOT EDIT MANUALLY
// Generated from Lucide v1.7.0 by scripts/build-icon-registry.mjs
// Re-run: node scripts/build-icon-registry.mjs
//
// Every icon in this file is a real Lucide icon from https://lucide.dev
// Spec: 24×24 viewBox, stroke-width 2, round linecap/linejoin, currentColor

export const LUCIDE_ICONS: Record<string, string> = {
${entries.join('\n')}
};

// Total icons: ${Object.keys(icons).length}
`;

writeFileSync(OUTPUT, output, 'utf8');
console.log(`Generated ${OUTPUT} with ${Object.keys(icons).length} icons`);

// Verify no duplicates in values (same Lucide source mapped to multiple keys is fine)
const keySet = new Set(Object.keys(icons));
console.log(`Unique keys: ${keySet.size}`);

