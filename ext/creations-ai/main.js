// Creations AI — Parallx Extension (docs/CREATIONS_AI.md)
// Characters, roleplay, stories and random tables with the model you choose.
// All data lives under .parallx/extensions/text-generator/.
//
// Architecture cloned from src/openclaw/ (study and clone, never join):
//   - System prompt builder  ← openclawSystemPrompt.ts
//   - Token budget           ← openclawTokenBudget.ts
//   - Context assembly       ← openclawContextEngine.ts
//   - History trimming       ← openclawContextEngine.ts

import { renderStudioPane } from './studio.js';
import { renderStoriesPage, listStories } from './story.js';
import { renderTablesPage, attachTableRoll, listTables, loadTable, loadTableByName, rollList, shipCharacterSeeds } from './tables.js';
import { CHARACTER_SEEDS_NAME } from './tables-core.js';
import { roll as rollTable } from './tables-core.js';
import { storyWords } from './story-core.js';
import { sheetFromCharacter, DEFAULT_SHEET_STRUCTURE } from './studio-core.js';
import { createPortrait, hueOf, CREATIONS_PARTS_CSS } from './portrait.js';
import { directorCast, buildDirectorPrompt, parseDirections, directionCommand, composeWithDirection, directionKindLabel, NARRATOR } from './director.js';
import { renderMemoryMarkdown, parseMemoryMarkdown, isMemoryMarkdown, mergeMemory, memoryFromLegacy, rankExcerpts, earlierBlock, extractionDue, parseExtractionReply } from './chat-memory.js';

// The workspace data folder keeps its original name: every character, thread,
// lorebook and setting a user has is in there, and a rename would be a move.
const EXT_ROOT = '.parallx/extensions/text-generator';
const SELF_SPEAKER = '__self__';
const NARRATOR_SPEAKER = '__narrator__';

// Context-window presets shared by the chat toolbar and the forge.
// 0 = Auto: the settings default when one was chosen, else the model's own
// context length (see resolveContextWindow).
const CTX_WINDOW_PRESETS = [
  { label: 'Auto',  value: 0 },
  { label: '4K',    value: 4_096 },
  { label: '8K',    value: 8_192 },
  { label: '16K',   value: 16_384 },
  { label: '32K',   value: 32_768 },
  { label: '64K',   value: 65_536 },
  { label: '128K',  value: 131_072 },
];

/**
 * The context window a chat uses: the size sent to Ollama as num_ctx and
 * the size its prompt is budgeted to, always the same number. A size the
 * user picked for this chat wins, then a default they set in Settings, then
 * the model's own context length. 8192 only when Ollama could not report
 * the model's length.
 */
function resolveContextWindow({ override, settingsDefault, modelLength } = {}) {
  for (const v of [override, settingsDefault, modelLength]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 8192;
}

/** Short label for a window size: 32768 -> "32K". */
function ctxSizeLabel(n) {
  return n >= 1024 ? `${Math.round(n / 1024)}K` : String(n);
}

// The settings default shipped as 8192 before Auto existed, and the settings
// page saved it back unchanged, so a stored 8192 without the "chosen" mark
// is that old default, not a choice. Read it as Auto.
function migrateContextDefault(settings) {
  if (settings && settings.defaultContextWindowChosen !== true && Number(settings.defaultContextWindow) === 8192) {
    settings.defaultContextWindow = 0;
  }
  return settings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1A: ICON HELPERS (via parallx.icons API)
// ═══════════════════════════════════════════════════════════════════════════════

let _parallx = null;

function icon(name, size = 16) {
  if (_parallx?.icons) return _parallx.icons.createIconHtml(name, size);
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1B: CSS INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

let _styleInjected = false;

function injectStyles() {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'text-generator-styles';
  style.textContent = `
/* ═══ Icon base ═══ */
.tg-icon svg { width: 100%; height: 100%; }

/* ═══ Sidebar ═══ */
.tg-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  overflow: hidden;
  font-family: var(--parallx-fontFamily-ui);
}

/* Search bar */
.tg-search-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-search-wrap .tg-icon { color: var(--vscode-descriptionForeground); }
.tg-search {
  flex: 1;
  background: var(--vscode-input-background, var(--px-border));
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 5px 8px;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  outline: none;
}
.tg-search:focus { border-color: var(--vscode-focusBorder, #007fd4); }
.tg-search::placeholder { color: var(--vscode-input-placeholderForeground, #6e6e6e); }

/* ═══ Scene state panel (M79 Phase 5) ═══ */
.tg-scene-panel {
  padding: 10px 14px;
  background: var(--vscode-editorWidget-background, rgba(255,255,255,0.02));
  border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tg-scene-row { display: flex; align-items: center; gap: 8px; }
.tg-scene-label {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground, #888);
  min-width: 160px;
}
.tg-scene-input {
  flex: 1;
  background: var(--vscode-input-background, var(--px-bg));
  color: var(--vscode-input-foreground, #ddd);
  border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
  border-radius: 3px;
  padding: 4px 8px;
  font-size: var(--parallx-fontSize-base, 12px);
  font-family: inherit;
  outline: none;
}
.tg-scene-input:focus { border-color: var(--vscode-focusBorder, #007fd4); }
.tg-scene-clear-btn {
  align-self: flex-end;
  background: transparent;
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.15));
  color: var(--vscode-descriptionForeground, #aaa);
  padding: 4px 12px;
  border-radius: 3px;
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
}
.tg-scene-clear-btn:hover {
  background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
  color: var(--vscode-foreground, #ddd);
}
.tg-chat-toolbar-btn--active {
  background: var(--vscode-list-activeSelectionBackground, rgba(0,127,212,0.2));
}

/* Nav links */
.tg-nav {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: var(--parallx-fontSize-md, 13px);
  color: var(--vscode-foreground);
  transition: background 80ms ease;
  user-select: none;
}
.tg-nav-item:hover { background: var(--vscode-list-hoverBackground); }
.tg-nav-item .tg-icon { color: var(--vscode-descriptionForeground); }
.tg-nav-item-label { flex: 1; }
.tg-nav-item .tg-chevron {
  color: var(--vscode-descriptionForeground);
  opacity: 0.5;
}

/* Chat section header */
.tg-chat-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 600;
  text-transform: none;
  letter-spacing: normal;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-chat-section-header .tg-count {
  font-weight: 400;
  opacity: 0.7;
}

/* Chat list */
.tg-chat-list {
  flex: 1;
  overflow-y: auto;
}
.tg-chat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: var(--parallx-fontSize-md, 13px);
  color: var(--vscode-foreground);
  transition: background 80ms ease;
  min-height: var(--px-control-h-lg);
}
.tg-chat-row:hover { background: var(--vscode-list-hoverBackground); }
.tg-chat-row .tg-icon { color: var(--vscode-descriptionForeground); }
.tg-chat-row-info {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.tg-chat-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--parallx-fontSize-md, 13px);
}
.tg-chat-row-meta {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Chat row delete button */
.tg-chat-row-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 80ms ease, color 80ms ease, background 80ms ease;
}
.tg-chat-row:hover .tg-chat-row-delete { opacity: 1; }
.tg-chat-row-delete:hover {
  color: var(--vscode-testing-iconFailed, #f14c4c);
  background: color-mix(in srgb, var(--vscode-testing-iconFailed, #f14c4c) 12%, transparent);
}

/* New chat button at bottom */
.tg-new-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 6px 10px 10px;
  cursor: pointer;
  font-family: var(--parallx-fontFamily-ui);
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-button-background, #0e639c);
  border: none;
  transition: opacity 80ms ease;
  box-sizing: border-box;
  height: var(--px-control-h);
  padding: 0 12px;
  border-radius: var(--px-radius-sm);
  font-size: var(--px-text-sm);
  line-height: 1;
}
.tg-new-chat-btn:hover { opacity: 0.85; }
.tg-new-chat-btn .tg-icon { color: inherit; }

/* Empty state */
.tg-empty {
  padding: 12px 16px;
  font-size: var(--px-text-sm);
  color: var(--px-text-muted);
  font-style: italic;
  text-align: center;
}

/* ═══ Editor Pages (Home, Characters, Settings) ═══ */
.tg-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vscode-editor-background);
  font-family: var(--parallx-fontFamily-ui);
  overflow: hidden;
}
.tg-page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  flex-shrink: 0;
}
.tg-page-header .tg-icon { color: var(--vscode-descriptionForeground); }
.tg-page-header-info { flex: 1; }
.tg-page-header-title {
  font-size: var(--px-text-xl);
  font-weight: 600;
  color: var(--vscode-foreground);
  line-height: 1.2;
}
.tg-page-header-subtitle {
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-descriptionForeground);
  margin-top: 2px;
}
.tg-page-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

/* ── Card Grid ── */
.tg-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.tg-card {
  display: flex;
  flex-direction: column;
  background: var(--vscode-editorWidget-background, var(--px-bg-elevated));
  border: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  border-radius: var(--parallx-radius-lg, 8px);
  padding: 16px;
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.tg-card:hover {
  border-color: var(--vscode-focusBorder, #007fd4);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.tg-card-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.tg-card-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--parallx-radius-md, 6px);
  background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 15%, var(--vscode-editor-background) 85%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tg-card-avatar .tg-icon { color: var(--vscode-focusBorder, #007fd4); }
.tg-card-name {
  font-size: var(--parallx-fontSize-lg, 14px);
  font-weight: 600;
  color: var(--vscode-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.tg-card-desc {
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
  flex: 1;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.tg-card-actions {
  display: flex;
  gap: 4px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-card-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-sm, 11px);
  transition: background 80ms ease, color 80ms ease;
}
.tg-card-action:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}
.tg-card-action--danger:hover { color: var(--vscode-testing-iconFailed, #f14c4c); }

/* Create new card */
.tg-card--create {
  border-style: dashed;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  color: var(--vscode-descriptionForeground);
}
.tg-card--create:hover { color: var(--vscode-foreground); }
.tg-card--create .tg-icon { color: inherit; }
.tg-card--create-label {
  font-size: var(--parallx-fontSize-base, 12px);
  font-weight: 500;
}

/* ── Section in page ── */
.tg-page-section {
  margin-bottom: 24px;
}
.tg-page-section:last-child { margin-bottom: 0; }
.tg-page-section-title {
  font-size: var(--px-text-sm);
  font-weight: 600;
  color: var(--px-text-secondary);
  margin-bottom: 10px;
}

/* ── Quick action row (home page) ── */
.tg-quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.tg-quick-action {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  border: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  background: var(--vscode-editorWidget-background, var(--px-bg-elevated));
  cursor: pointer;
  font-family: var(--parallx-fontFamily-ui);
  color: var(--vscode-foreground);
  transition: border-color 80ms ease, background 80ms ease;
  justify-content: center;
  height: var(--px-control-h);
  padding: 0 12px;
  border-radius: var(--px-radius-sm);
  font-size: var(--px-text-sm);
  line-height: 1;
}
.tg-quick-action:hover {
  border-color: var(--vscode-focusBorder, #007fd4);
  background: var(--vscode-list-hoverBackground);
}
.tg-quick-action .tg-icon { color: var(--vscode-descriptionForeground); }

/* ── Recent list rows (home page) ── */
.tg-recent-list { display: flex; flex-direction: column; gap: 2px; }
.tg-recent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: var(--parallx-radius-sm, 3px);
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-foreground);
  transition: background 80ms ease;
}
.tg-recent-row:hover { background: var(--vscode-list-hoverBackground); }
.tg-recent-row .tg-icon { color: var(--vscode-descriptionForeground); }
.tg-recent-row-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tg-recent-row-time { font-size: var(--parallx-fontSize-sm, 11px); color: var(--vscode-descriptionForeground); }

/* ═══ Settings form ═══ */
.tg-settings-form { max-width: 480px; }
.tg-form-group {
  margin-bottom: 16px;
}
.tg-form-label {
  display: block;
  font-size: var(--parallx-fontSize-base, 12px);
  font-weight: 600;
  color: var(--vscode-foreground);
  margin-bottom: 4px;
}
.tg-form-hint {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;
}
.tg-form-input {
  width: 100%;
  background: var(--vscode-input-background, var(--px-border));
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 5px 8px;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  outline: none;
  box-sizing: border-box;
}
.tg-form-input:focus { border-color: var(--vscode-focusBorder, #007fd4); }
.tg-form-input[type="number"] { width: 80px; }
.tg-form-select {
  background: var(--vscode-input-background, var(--px-border));
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 5px 8px;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  outline: none;
}
.tg-form-select:focus { border-color: var(--vscode-focusBorder, #007fd4); }
.tg-form-save {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border: none;
  border-radius: var(--parallx-radius-md, 6px);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  cursor: pointer;
  transition: opacity 80ms ease;
}
.tg-form-save:hover { opacity: 0.85; }
.tg-form-saved {
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-testing-iconPassed, #73c991);
  margin-left: 8px;
  opacity: 0;
  transition: opacity 200ms ease;
}
.tg-form-saved--show { opacity: 1; }
/* Reset To Default under the dialogue rules: quiet, beside the field. */
.tg-form-reset {
  margin-top: var(--px-space-2);
  height: var(--px-control-h-sm);
  padding: 0 var(--px-space-3);
  border: 1px solid var(--px-border);
  border-radius: var(--px-radius-sm);
  background: transparent;
  color: var(--px-text-secondary);
  font: inherit;
  font-size: var(--px-text-xs);
  cursor: pointer;
}
.tg-form-reset:hover { border-color: var(--px-border-strong); background: var(--px-surface-hover); color: var(--px-text); }

/* ═══ Chat Editor ═══ */
.tg-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vscode-editor-background);
  font-family: var(--parallx-fontFamily-ui);
}
.tg-chat-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  flex-shrink: 0;
  background: var(--vscode-editorWidget-background, var(--px-bg-elevated));
}
.tg-chat-toolbar-label {
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-descriptionForeground);
}
.tg-chat-toolbar-select {
  background: var(--vscode-input-background, var(--px-border));
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 3px 6px;
  font-size: var(--parallx-fontSize-base, 12px);
  font-family: var(--parallx-fontFamily-ui);
  outline: none;
}
.tg-chat-toolbar-select:focus { border-color: var(--vscode-focusBorder, #007fd4); }
.tg-chat-toolbar-spacer { flex: 1; }
.tg-chat-toolbar-charname {
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-foreground);
  font-weight: 500;
}

/* ═══ Messages — Collaborative Writing Layout ═══ */
.tg-messages { flex: 1; overflow-y: auto; padding: 12px 0; }

/* ALL messages left-aligned, no bubbles */
.tg-msg {
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding: 8px 22px;
  position: relative;
}
.tg-msg + .tg-msg { border-top: none; }

.tg-msg-content-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

/* Name label row — always shown */
.tg-msg-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tg-msg-name {
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 700;
  text-transform: none;
  letter-spacing: normal;
}
/* Name styling by author type — bold, no color */
.tg-name--user { color: var(--vscode-foreground); }
.tg-name--ai { color: var(--vscode-foreground); }
.tg-name--narrator { color: var(--vscode-foreground); }
.tg-name--scenario { color: var(--vscode-foreground); }
.tg-name--system { color: var(--vscode-descriptionForeground); font-style: italic; }

/* Message action buttons — hidden by default, visible on hover, space always reserved */
.tg-msg-inline-actions {
  display: flex;
  gap: 2px;
  align-items: center;
  margin-top: 2px;
  visibility: hidden;
  height: 22px;
}
.tg-msg:hover .tg-msg-inline-actions { visibility: visible; }

/* Message body — flat, no bubble */
.tg-msg-body {
  font-size: var(--parallx-fontSize-md, 13px);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: min(100%, 780px);
  padding: 2px 0;
}

/* System messages — slightly dimmer */
.tg-msg--system .tg-msg-body {
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}

/* Inline editing — Perchance-style double-click-to-edit */
.tg-msg-body--editing {
  background: var(--vscode-input-background, var(--px-border));
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 8px;
  cursor: text;
}
.tg-inline-edit-area {
  width: 100%;
  min-height: 60px;
  resize: none;
  font-family: inherit;
  font-size: var(--parallx-fontSize-md, 13px);
  line-height: 1.6;
  background: transparent;
  color: var(--vscode-editor-foreground, #ccc);
  border: none;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
}
.tg-inline-auto-row {
  display: flex;
  justify-content: flex-end;
  max-width: min(100%, 780px);
  padding: 2px 0;
}
.tg-inline-edit-btn--auto {
  font-size: var(--parallx-fontSize-sm, 11px);
  font-family: inherit;
  padding: 3px 10px;
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  cursor: pointer;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  line-height: 1;
  vertical-align: middle;
  transition: background 80ms ease, color 80ms ease;
}
.tg-inline-edit-btn--auto .tg-icon {
  display: block;
  flex-shrink: 0;
}
.tg-inline-edit-btn--auto:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}
.tg-inline-edit-btn--auto:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ═══ Character Buttons Bar ═══ */
.tg-char-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-top: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  overflow-x: auto;
  flex-shrink: 0;
}
/* Turn bar and char-btn styles removed — unified shortcut buttons serve as turn controls */
.tg-turn-status {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}
.tg-msg--streaming .tg-msg-name {
  opacity: 0.85;
}
.tg-msg--dim {
  opacity: 0.45;
  border-left: 2px solid var(--vscode-editorWarning-foreground, #cca700);
}
/* M79 Phase 4a — OOC ("Backstage") messages. Distinct from generic
 * hidden so the user can tell their own notes from system-hidden
 * entries. Muted but legible; dashed accent rail to read as a
 * margin annotation rather than a real beat. */
.tg-msg--ooc {
  opacity: 0.7;
  border-left: 2px dashed var(--vscode-descriptionForeground, #888);
  font-style: italic;
}
.tg-msg--ooc .tg-msg-name {
  color: var(--vscode-descriptionForeground, #888);
  text-transform: none;
  letter-spacing: normal;
  font-size: var(--parallx-fontSize-sm, 11px);
}
.tg-msg-body em { font-style: italic; }
.tg-msg-body strong { font-weight: 700; }

/* M79 Phase 4a — input bar OOC toggle button. Same shape as the
 * Options/Send buttons; visually toggled when active. */
.tg-input-ooc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--parallx-radius-sm, 3px);
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
}
.tg-input-ooc-btn:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.06));
  color: var(--vscode-foreground);
}
.tg-input-ooc-btn--active {
  color: var(--vscode-editorWarning-foreground, #cca700);
  border-color: var(--vscode-editorWarning-foreground, #cca700);
  background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 10%, transparent);
}
.tg-input-card--ooc {
  border-color: var(--vscode-editorWarning-foreground, #cca700);
}

/* Welcome */
.tg-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 8px;
  opacity: 0.5;
  padding: 48px 24px;
  text-align: center;
}
.tg-welcome-name { font-size: 24px; }
.tg-welcome-hint {
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-descriptionForeground);
}

/* Input */
.tg-input-wrap {
  flex-shrink: 0;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  background: var(--vscode-editor-background);
}
.tg-input-card {
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--vscode-input-border, var(--px-border)) 70%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--vscode-input-background, var(--px-border)) 92%, var(--vscode-editorWidget-background, var(--px-bg-elevated)) 8%);
  overflow: hidden;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.tg-input-card:focus-within {
  border-color: var(--vscode-focusBorder, #007fd4);
  box-shadow: 0 2px 12px rgba(0,0,0,0.10);
}
.tg-textarea-wrap {
  position: relative;
}
.tg-input-textarea {
  width: 100%;
  min-height: 40px;
  max-height: 160px;
  padding: 10px 70px 10px 12px;
  border: none;
  background: transparent;
  color: var(--vscode-input-foreground, #ccc);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-md, 13px);
  line-height: 1.45;
  resize: none;
  overflow-y: auto;
  outline: none;
  box-sizing: border-box;
}
.tg-input-textarea::placeholder { color: var(--vscode-input-placeholderForeground, #6e6e6e); }
.tg-input-toolbar {
  position: absolute;
  right: 4px;
  bottom: 4px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.tg-input-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: color 80ms ease, background 80ms ease;
  padding: 0;
}
.tg-input-send:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.tg-input-send:disabled { opacity: 0.35; cursor: default; }
.tg-input-send .tg-icon { color: inherit; }
.tg-input-send--stop { color: var(--vscode-testing-iconFailed, #f14c4c); }
.tg-input-send--stop:hover { color: var(--vscode-testing-iconFailed, #f14c4c); }

/* Options button */
.tg-input-options-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0;
  transition: background 80ms ease, color 80ms ease;
}
.tg-input-options-btn:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}

/* Error & generating */
.tg-error { color: var(--vscode-testing-iconFailed, #f14c4c); }
.tg-generating {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vscode-descriptionForeground);
  animation: tg-pulse 1.2s infinite ease-in-out;
  margin-left: 2px;
  vertical-align: middle;
}
@keyframes tg-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* ═══ Unified shortcut bar (inline speaker selector inside input card) ═══ */
.tg-shortcut-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 10px;
  border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border, var(--px-bg-inset)) 60%, transparent);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.tg-shortcut-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
  white-space: nowrap;
  transition: background 80ms ease, color 80ms ease;
}
.tg-shortcut-btn:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}
.tg-shortcut-btn--add {
  color: var(--vscode-descriptionForeground);
  opacity: 0.55;
  font-size: 14px;
  padding: 2px 6px;
}
.tg-shortcut-btn--add:hover { opacity: 1; }

/* ═══ Variant navigation (Perchance-style swipe between regenerations) ═══ */
.tg-variant-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
  visibility: hidden;
}
.tg-msg:hover .tg-variant-nav { visibility: visible; }
.tg-variant-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0;
  font-size: 11px;
}
.tg-variant-nav-btn:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}
.tg-variant-nav-label {
  font-size: 10px;
  min-width: 24px;
  text-align: center;
}

/* ═══ Chat toolbar buttons ═══ */
.tg-chat-toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0;
  transition: background 80ms ease, color 80ms ease;
}
.tg-chat-toolbar-btn:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}
.tg-chat-toolbar-btn .tg-icon { color: inherit; }

/* ═══ Token counter ═══ */
.tg-token-count {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
  margin-right: 4px;
}
.tg-token-count.tg-token-warn {
  color: var(--vscode-editorWarning-foreground, #cca700);
  cursor: help;
}

/* ═══ Budget total badge ═══ */
.tg-form-budget-total {
  font-size: 12px;
  margin: -4px 0 8px;
  padding: 4px 8px;
  border-radius: 3px;
  display: inline-block;
}
.tg-form-budget-total--ok {
  color: var(--vscode-charts-green, #89d185);
  background: rgba(137, 209, 133, 0.08);
}
.tg-form-budget-total--warn {
  color: var(--vscode-editorWarning-foreground, #cca700);
  background: rgba(204, 167, 0, 0.08);
}
.tg-form-hint--warn {
  color: var(--vscode-editorWarning-foreground, #cca700) !important;
  margin-top: 4px;
}
.tg-form-inherit {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  font-style: italic;
  margin-top: 4px;
}

/* ═══ Toast / undo ═══ */
.tg-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--vscode-notifications-background, var(--vscode-editorWidget-background));
  color: var(--vscode-notifications-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-notifications-border, var(--vscode-widget-border, transparent));
  border-radius: 4px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  font-size: 13px;
  animation: tg-toast-in 200ms ease-out;
}
@keyframes tg-toast-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translateX(-50%); }
}
.tg-toast-action {
  background: transparent;
  border: 1px solid var(--vscode-button-border, transparent);
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 3px;
  font: inherit;
}
.tg-toast-action:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

/* ═══ Lorebook checkbox list ═══ */
.tg-ce-lore-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 3px;
  padding: 6px 8px;
  max-height: 180px;
  overflow-y: auto;
  background: var(--vscode-input-background);
}
.tg-ce-lore-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.tg-ce-lore-row input { margin: 0; }
.tg-ce-lore-empty {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}

/* ═══ Message actions (inline with name) ═══ */
.tg-msg { position: relative; }
.tg-msg-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0;
  transition: background 80ms ease, color 80ms ease;
}
.tg-msg-action-btn:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}
.tg-msg-action-btn--danger:hover { color: var(--vscode-testing-iconFailed, #f14c4c); }
.tg-msg-action-btn .tg-icon { color: inherit; }

/* ═══ Message edit mode ═══ */
.tg-msg-edit-textarea {
  width: 100%;
  min-height: 60px;
  background: var(--vscode-input-background, var(--px-border));
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 8px;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-md, 13px);
  line-height: 1.5;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
.tg-msg-edit-textarea:focus { border-color: var(--vscode-focusBorder, #007fd4); }
.tg-msg-edit-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.tg-msg-edit-save, .tg-msg-edit-cancel {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
}
.tg-msg-edit-save {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
}
.tg-msg-edit-cancel {
  background: transparent;
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}

/* ═══ Regenerate with a direction ═══ */
.tg-regen-box { display: flex; align-items: center; gap: var(--px-space-2); margin-top: var(--px-space-2); }
.tg-regen-input { flex: 1; min-width: 0; box-sizing: border-box; background: var(--px-bg-inset); color: var(--px-text); border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); padding: var(--px-space-1) var(--px-space-2); font: inherit; font-size: var(--px-text-sm); }
.tg-regen-input:focus { outline: none; border-color: var(--px-accent); }
.tg-regen-input::placeholder { color: var(--px-text-faint); }

/* ═══ System Prompt Modal ═══ */
.tg-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.tg-modal {
  width: min(90%, 700px);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--vscode-editorWidget-background, var(--px-bg-elevated));
  border: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  border-radius: var(--parallx-radius-lg, 8px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.tg-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-modal-title {
  font-size: var(--parallx-fontSize-lg, 14px);
  font-weight: 600;
  color: var(--vscode-foreground);
}
.tg-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: background 80ms ease;
}
.tg-modal-close:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.tg-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.tg-modal-body pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
  font-size: var(--parallx-fontSize-base, 12px);
  line-height: 1.6;
  color: var(--vscode-foreground);
}
.tg-modal-body .tg-prompt-role {
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 600;
  text-transform: none;
  letter-spacing: normal;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;
  margin-top: 16px;
}
.tg-modal-body .tg-prompt-role:first-child { margin-top: 0; }
.tg-modal-body .tg-prompt-content {
  padding: 8px 12px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--vscode-input-background, var(--px-border)) 50%, transparent);
  border-radius: var(--parallx-radius-sm, 3px);
  border-left: 3px solid var(--vscode-focusBorder, #007fd4);
}
.tg-modal-body .tg-prompt-diag {
  padding: 8px 12px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--px-bg-elevated)) 80%, transparent);
  border-radius: var(--parallx-radius-sm, 3px);
  border-left: 3px solid var(--vscode-charts-yellow, #d7ba7d);
  font-size: 11.5px;
}
.tg-modal-body .tg-prompt-diag pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--vscode-editor-font-family, monospace);
}
.tg-modal-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
}

/* ═══ Per-Chat Settings Page ═══ */
.tg-chat-settings {
  padding: 16px 24px;
  overflow-y: auto;
  height: 100%;
  font-family: var(--parallx-fontFamily-ui);
}
.tg-chat-settings-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-chat-settings-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
.tg-chat-settings-subtitle {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
}
.tg-cs-section {
  margin-bottom: 20px;
}
.tg-cs-section-title {
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 600;
  text-transform: none;
  letter-spacing: normal;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 10px;
}
.tg-cs-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.tg-cs-label {
  flex: 0 0 140px;
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-foreground);
}
.tg-cs-input {
  flex: 1;
  max-width: 280px;
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border, var(--px-border));
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, var(--px-border));
  color: var(--vscode-input-foreground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
}
.tg-cs-select {
  flex: 1;
  max-width: 280px;
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border, var(--px-border));
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, var(--px-border));
  color: var(--vscode-input-foreground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
}
.tg-cs-hint {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  margin-top: 2px;
}
.tg-cs-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.tg-cs-toggle-track {
  width: 36px;
  height: 18px;
  border-radius: 9px;
  background: var(--vscode-input-background, var(--px-border));
  border: 1px solid var(--vscode-input-border, var(--px-border));
  position: relative;
  transition: background 120ms ease;
  cursor: pointer;
}
.tg-cs-toggle-track--on {
  background: var(--vscode-focusBorder, #007fd4);
  border-color: var(--vscode-focusBorder, #007fd4);
}
.tg-cs-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--vscode-foreground);
  transition: left 120ms ease;
}
.tg-cs-toggle-track--on .tg-cs-toggle-thumb {
  left: 20px;
}
.tg-cs-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tg-cs-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  border-radius: 12px;
  background: var(--vscode-editorWidget-background, var(--px-bg-elevated));
  color: var(--vscode-foreground);
  font-size: var(--parallx-fontSize-sm, 11px);
}
.tg-cs-chip--active {
  border-color: var(--vscode-focusBorder, #007fd4);
  background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 15%, transparent);
}
.tg-cs-chip-remove {
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 80ms ease;
}
.tg-cs-chip-remove:hover { opacity: 1; }
.tg-cs-add-btn {
  padding: 3px 10px;
  border: 1px dashed var(--vscode-panel-border, var(--px-bg-inset));
  border-radius: 12px;
  background: transparent;
  color: var(--vscode-foreground);
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
  transition: border-color 80ms ease;
}
.tg-cs-add-btn:hover { border-color: var(--vscode-focusBorder, #007fd4); }
.tg-cs-save-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.tg-cs-save-btn {
  padding: 6px 16px;
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  cursor: pointer;
  transition: background 80ms ease;
}
.tg-cs-save-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.tg-cs-saved {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: #73c991;
  opacity: 0;
  transition: opacity 200ms ease;
}
.tg-cs-saved--show { opacity: 1; }

/* ═══ Character Editor (Perchance-parity settings form) ═══ */
.tg-ce {
  max-width: 680px;
  margin: 0 auto;
  padding: 16px 20px 32px;
  font-family: var(--parallx-fontFamily-ui);
}
.tg-ce-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-ce-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
.tg-ce-subtitle {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
}
.tg-ce-field {
  margin-bottom: 16px;
}
.tg-ce-label {
  display: block;
  font-size: var(--parallx-fontSize-base, 12px);
  font-weight: 600;
  color: var(--vscode-foreground);
  margin-bottom: 4px;
}
.tg-ce-hint {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
  font-style: italic;
  margin-bottom: 4px;
  line-height: 1.4;
}
.tg-ce-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--vscode-input-border, var(--px-border));
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, var(--px-bg));
  color: var(--vscode-input-foreground, #ccc);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
}
.tg-ce-input:focus {
  outline: none;
  border-color: var(--vscode-focusBorder, #007fd4);
}
.tg-ce-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 80px;
  padding: 8px 10px;
  border: 1px solid var(--vscode-input-border, var(--px-border));
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, var(--px-bg));
  color: var(--vscode-input-foreground, #ccc);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  resize: vertical;
  line-height: 1.5;
}
.tg-ce-textarea:focus {
  outline: none;
  border-color: var(--vscode-focusBorder, #007fd4);
}
.tg-ce-textarea--tall { min-height: 140px; }
.tg-ce-textarea--short { min-height: 60px; }
.tg-ce-select {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--vscode-input-border, var(--px-border));
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, var(--px-bg));
  color: var(--vscode-input-foreground, #ccc);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
}
.tg-ce-select:focus {
  outline: none;
  border-color: var(--vscode-focusBorder, #007fd4);
}
.tg-ce-separator {
  border: none;
  border-top: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  margin: 20px 0;
}
.tg-ce-more-btn {
  display: block;
  margin: 12px auto;
  padding: 6px 20px;
  border: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  border-radius: 14px;
  background: var(--vscode-editorWidget-background, var(--px-bg-elevated));
  color: var(--vscode-descriptionForeground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
  transition: border-color 80ms ease, color 80ms ease;
}
.tg-ce-more-btn:hover {
  border-color: var(--vscode-focusBorder, #007fd4);
  color: var(--vscode-foreground);
}
.tg-ce-more-section {
  display: none;
}
.tg-ce-more-section--visible {
  display: block;
}
.tg-ce-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-ce-cancel-btn {
  padding: 6px 16px;
  border: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  border-radius: var(--parallx-radius-sm, 3px);
  background: transparent;
  color: var(--vscode-foreground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  cursor: pointer;
}
.tg-ce-cancel-btn:hover {
  background: var(--vscode-list-hoverBackground);
}
.tg-ce-save-btn {
  margin-left: auto;
  padding: 6px 20px;
  border: 1px solid transparent;
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--px-accent);
  color: #fff;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  font-weight: 600;
  cursor: pointer;
  transition: background 80ms ease;
}
.tg-ce-save-btn:hover { background: var(--px-accent-hover, #45a040); }
.tg-ce-saved {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: #73c991;
  opacity: 0;
  transition: opacity 200ms ease;
}
.tg-ce-saved--show { opacity: 1; }
.tg-ce-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.tg-ce-row > .tg-ce-field { flex: 1; }

/* ═══ Director's note row (M92 overhaul) ═══ */
.tg-director-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
  background: color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) 6%, transparent);
}
.tg-director-icon { color: var(--vscode-editorInfo-foreground, #3794ff); display: inline-flex; }
.tg-director-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--vscode-input-foreground, #ddd);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
}
.tg-director-input::placeholder { color: var(--vscode-input-placeholderForeground, #6e6e6e); }

/* ═══ Chat settings drawer (M92 overhaul) ═══ */
.tg-chat { position: relative; }
.tg-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  max-width: 85%;
  display: flex;
  flex-direction: column;
  background: var(--vscode-editorWidget-background, var(--px-bg-elevated));
  border-left: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  box-shadow: -4px 0 16px rgba(0,0,0,0.25);
  z-index: 40;
}
.tg-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
}
.tg-drawer-title {
  font-size: var(--parallx-fontSize-md, 13px);
  font-weight: 600;
  color: var(--vscode-foreground);
}
.tg-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tg-drawer-field { display: flex; flex-direction: column; gap: 4px; }
.tg-drawer-label {
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 600;
  color: var(--vscode-foreground);
}
.tg-drawer-hint {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground, #888);
  line-height: 1.4;
}
.tg-drawer-input, .tg-drawer-select, .tg-drawer-textarea {
  background: var(--vscode-input-background, var(--px-bg));
  color: var(--vscode-input-foreground, #ddd);
  border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
  border-radius: 3px;
  padding: 5px 8px;
  font-size: var(--parallx-fontSize-base, 12px);
  font-family: var(--parallx-fontFamily-ui);
  outline: none;
  box-sizing: border-box;
  width: 100%;
}
.tg-drawer-input:focus, .tg-drawer-select:focus, .tg-drawer-textarea:focus {
  border-color: var(--vscode-focusBorder, #007fd4);
}
.tg-drawer-textarea { resize: vertical; min-height: 60px; }
.tg-drawer-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.tg-drawer-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 10px;
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.15));
  background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-foreground);
}
.tg-drawer-chip-remove {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0;
}
.tg-drawer-chip-remove:hover { color: var(--vscode-errorForeground, #f48771); }
.tg-drawer-add-btn, .tg-drawer-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.15));
  border-radius: 3px;
  background: transparent;
  color: var(--vscode-foreground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
}
.tg-drawer-add-btn:hover, .tg-drawer-btn:hover { background: var(--vscode-list-hoverBackground); }
.tg-drawer-sep {
  border: none;
  border-top: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  margin: 2px 0;
}
.tg-drawer-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-foreground);
  cursor: pointer;
}

/* ═══ Characters master-detail (M92 overhaul) ═══ */
.tg-cc {
  display: flex;
  height: 100%;
  background: var(--vscode-editor-background);
  font-family: var(--parallx-fontFamily-ui);
  overflow: hidden;
}
.tg-cc-rail {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--vscode-panel-border, var(--px-bg-inset));
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  overflow-y: auto;
}
.tg-cc-rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 4px;
}
.tg-cc-rail-title {
  font-size: var(--px-text-sm);
  font-weight: 600;
  color: var(--px-text-secondary);
}
.tg-cc-rail-add {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
}
.tg-cc-rail-add:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.tg-cc-list { display: flex; flex-direction: column; padding-bottom: 8px; }
.tg-cc-list-empty {
  padding: 6px 12px;
  font-size: var(--px-text-sm);
  color: var(--px-text-muted);
}
.tg-cc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-foreground);
  min-height: var(--px-control-h-sm);
}
.tg-cc-row:hover { background: var(--vscode-list-hoverBackground); }
.tg-cc-row--active {
  background: var(--vscode-list-activeSelectionBackground, rgba(0,127,212,0.2));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
}
.tg-cc-row-icon { display: inline-flex; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
.tg-cc-row-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tg-cc-row-actions { display: none; align-items: center; gap: 2px; }
.tg-cc-row:hover .tg-cc-row-actions { display: inline-flex; }
.tg-cc-row-action {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
}
.tg-cc-row-action:hover { background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08)); color: var(--vscode-foreground); }
.tg-cc-row-action--danger:hover { color: var(--vscode-errorForeground, #f48771); }
.tg-cc-pane { flex: 1; overflow-y: auto; }
.tg-cc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 10px;
  color: var(--px-text-muted);
  font-size: var(--px-text-sm);
}

/* ═══ Character Forge ═══ */
.tg-forge {
  max-width: 720px;
  margin: 0 auto;
  padding: 16px 20px 40px;
  font-family: var(--parallx-fontFamily-ui);
}
.tg-forge-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.tg-forge-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
.tg-forge-subtitle {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground);
}
.tg-forge-controls { display: flex; flex-direction: column; gap: 8px; }
.tg-forge-section {
  margin-top: 12px;
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 600;
  text-transform: none;
  letter-spacing: normal;
  color: var(--vscode-descriptionForeground);
}
.tg-forge-section:first-child { margin-top: 0; }
.tg-forge-row-value {
  width: 46px;
  flex-shrink: 0;
  text-align: right;
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-foreground);
  font-variant-numeric: tabular-nums;
}
.tg-forge-row { display: flex; align-items: center; gap: 8px; }
.tg-forge-row-label {
  width: 90px;
  flex-shrink: 0;
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 600;
  color: var(--vscode-foreground);
}
.tg-forge-row-end {
  width: 110px;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.8;
}
.tg-forge-row-end:last-of-type { text-align: right; }
.tg-forge-slider { flex: 1; accent-color: var(--vscode-focusBorder, #007fd4); }
.tg-forge-row--text .tg-ce-input { flex: 1; }
.tg-forge-row .tg-ce-select { flex: 1; }
.tg-forge-row-label--ctx { width: auto; }
.tg-forge-ctx { flex: 0 0 84px; }
.tg-forge-lock {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  opacity: 0.45;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
}
.tg-forge-lock:hover { opacity: 0.9; background: var(--vscode-list-hoverBackground); }
.tg-forge-lock--on { opacity: 1; color: var(--vscode-editorWarning-foreground, #cca700); }
.tg-forge-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}
.tg-forge-dice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.15));
  border-radius: var(--parallx-radius-sm, 3px);
  background: transparent;
  color: var(--vscode-foreground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  cursor: pointer;
}
.tg-forge-dice:hover { background: var(--vscode-list-hoverBackground); }
.tg-forge-generate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 20px;
  border: 1px solid transparent;
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--px-accent);
  color: #fff;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  font-weight: 600;
  cursor: pointer;
  transition: background 80ms ease;
}
.tg-forge-generate:hover { background: var(--px-accent-hover, #45a040); }
.tg-forge-generate:disabled { opacity: 0.6; cursor: default; }
.tg-forge-output { display: flex; flex-direction: column; gap: 12px; }
.tg-forge-status {
  padding: 10px 12px;
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03));
  color: var(--vscode-descriptionForeground);
  font-size: var(--parallx-fontSize-base, 12px);
}
.tg-forge-status--error { color: var(--vscode-errorForeground, #f48771); }
.tg-forge-field { display: flex; flex-direction: column; gap: 4px; }
.tg-forge-field-head { display: flex; align-items: center; justify-content: space-between; }
.tg-forge-field-label {
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 600;
  color: var(--vscode-foreground);
}
.tg-forge-reroll {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
}
.tg-forge-reroll:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.tg-forge-raw {
  padding: 10px;
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03));
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}

.tg-forge-final {
  padding: 12px;
  border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03));
  color: var(--vscode-foreground);
  font-size: var(--parallx-fontSize-base, 12px);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
}

/* ═══ Themed dropdown wrappers (api.ui.createDropdown adapter) ═══
   The .ui-dropdown inside is styled by the core dropdown.css; these
   classes only handle layout inside tg rows/forms. */
.tg-dd { display: inline-flex; min-width: 0; vertical-align: middle; }
.tg-dd .ui-dropdown { width: 100%; min-width: 0; }
.tg-dd--inline { max-width: 220px; }
.tg-dd--flex { flex: 1; }
.tg-dd--full { width: 100%; }
.tg-dd--ctx { flex: 0 0 84px; }
/* Legacy chat-settings rows sized their selects flex:1 capped at 280px —
   the themed wrapper must match or the row layout collapses. */
.tg-cs-row .tg-dd { flex: 1; max-width: 280px; width: auto; }
${CREATIONS_PARTS_CSS}
/* ═══ The redesign (docs/CREATIONS_AI.md, Redesign 2026-10-02) ═══
   Neutral surfaces from the --px-* tokens; a character's hue lives only on
   its portrait; the accent marks the one main action. */
.cr-home { container-type: inline-size; max-width: 1180px; margin: 0 auto; padding: var(--px-space-6) var(--px-space-6) var(--px-space-8); display: flex; flex-direction: column; gap: var(--px-space-6); color: var(--px-text); font-family: var(--px-font-ui); box-sizing: border-box; }
.cr-hero { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--px-space-6); align-items: start; }
.cr-hero:has(.cr-roll[style*="none"]) { grid-template-columns: minmax(0, 1fr); }
.cr-hero-title { margin: 0 0 var(--px-space-3); font-size: var(--px-text-xl); font-weight: 600; line-height: var(--px-leading-tight); letter-spacing: -.01em; }
.cr-prompt { display: flex; align-items: center; gap: var(--px-space-2); padding: var(--px-space-2) var(--px-space-2) var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-border-strong); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); }
.cr-prompt:focus-within { border-color: var(--px-accent); }
.cr-prompt-icon { display: inline-flex; color: var(--px-text-muted); }
.cr-prompt-input { flex: 1; min-width: 0; height: var(--px-control-h-lg); border: 0; background: transparent; outline: none; color: var(--px-text); font: inherit; font-size: var(--px-text-md); }
.cr-prompt-input::placeholder { color: var(--px-text-faint); }
.cr-tries { display: flex; flex-wrap: wrap; align-items: center; gap: var(--px-space-2); margin-top: var(--px-space-2); }
.cr-tries-label { font-size: var(--px-text-xs); color: var(--px-text-faint); }
.cr-try { height: var(--px-control-h-sm); padding: 0 var(--px-space-3); border-radius: var(--px-radius-full); border: 1px solid var(--px-border); background: transparent; color: var(--px-text-secondary); font: inherit; font-size: var(--px-text-xs); cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-try:hover { border-color: var(--px-border-strong); background: var(--px-surface-hover); color: var(--px-text); }
.cr-roll { border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); padding: var(--px-space-3) var(--px-space-4); display: flex; flex-direction: column; gap: var(--px-space-2); }
.cr-roll-head { display: flex; align-items: center; justify-content: space-between; }
.cr-roll-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--px-text-xs); color: var(--px-text-muted); }
.cr-roll-text { font-size: var(--px-text-md); font-weight: 500; line-height: 1.45; }
.cr-roll-actions { display: flex; gap: var(--px-space-1); align-items: center; }
.cr-quick { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--px-space-3); }
.cr-quick-card { display: flex; align-items: center; gap: var(--px-space-3); padding: var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); color: var(--px-text); font: inherit; text-align: left; cursor: pointer; min-width: 0; }
.cr-quick-card:hover { border-color: var(--px-border-strong); background: var(--px-surface-hover); }
.cr-quick-icon { flex: none; width: 36px; height: 36px; border-radius: var(--px-radius-md); display: inline-flex; align-items: center; justify-content: center; background: var(--px-surface-hover); color: var(--px-text-secondary); }
.cr-quick-text { display: flex; flex-direction: column; min-width: 0; }
.cr-quick-title { font-weight: 600; font-size: var(--px-text-base); }
.cr-quick-hint { font-size: var(--px-text-xs); color: var(--px-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-section { display: flex; flex-direction: column; gap: var(--px-space-3); }
.cr-section-head { display: flex; align-items: center; justify-content: space-between; }
.cr-section-title { margin: 0; font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.cr-section-link { border: 0; background: none; padding: 0; color: var(--px-accent-text); font: inherit; font-size: var(--px-text-sm); cursor: pointer; }
.cr-section-link:hover { text-decoration: underline; }
.cr-continue { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--px-space-3); }
.cr-cont-card { display: flex; align-items: center; gap: var(--px-space-3); padding: var(--px-space-3) var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); color: var(--px-text); font: inherit; text-align: left; cursor: pointer; min-width: 0; }
.cr-cont-card:hover { border-color: var(--px-border-strong); }
.cr-cont-book { flex: none; width: 44px; height: 44px; border-radius: var(--px-radius-md); display: inline-flex; align-items: center; justify-content: center; background: var(--px-surface-hover); color: var(--px-text-secondary); }
.cr-cont-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cr-cont-top { display: flex; align-items: baseline; gap: var(--px-space-2); min-width: 0; }
.cr-cont-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-cont-meta { font-size: var(--px-text-xs); color: var(--px-text-faint); white-space: nowrap; }
.cr-cont-line { color: var(--px-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-cont-go { flex: none; height: var(--px-control-h); padding: 0 12px; display: inline-flex; align-items: center; border-radius: var(--px-radius-sm); border: 1px solid var(--px-border); font-size: var(--px-text-sm); font-weight: 500; }
.cr-cont-card:first-child .cr-cont-go { background: var(--px-accent); border-color: var(--px-accent); color: var(--px-text-on-accent); }
.cr-cast { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--px-space-3); }
.cr-cast > .px-empty { grid-column: 1 / -1; }
.cr-cast-card { display: flex; flex-direction: column; gap: var(--px-space-2); padding: var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); cursor: pointer; min-width: 0; outline: none; }
.cr-cast-card:hover, .cr-cast-card:focus-visible { border-color: var(--px-border-strong); }
.cr-cast-card:focus-visible { box-shadow: var(--px-ring); }
.cr-cast-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: var(--px-space-1); }
.cr-cast-tag { font-size: var(--px-text-xs); color: var(--px-text-muted); line-height: 1.4; height: calc(1.4em * 2); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cr-cast-chat { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; padding: 0; color: var(--px-text-muted); font: inherit; font-size: var(--px-text-xs); font-weight: 500; cursor: pointer; }
.cr-cast-chat:hover { color: var(--px-text); }
.cr-cast-page { height: 100%; overflow: auto; color: var(--px-text); font-family: var(--px-font-ui); }
.cr-gallery { container-type: inline-size; max-width: 1180px; margin: 0 auto; padding: var(--px-space-5) var(--px-space-6) var(--px-space-8); box-sizing: border-box; }
.cr-gallery-tools { display: flex; align-items: center; gap: var(--px-space-2); flex-wrap: wrap; margin: var(--px-space-4) 0; }
.cr-search { display: inline-flex; align-items: center; gap: 6px; height: var(--px-control-h); padding: 0 var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); background: var(--px-bg-inset); color: var(--px-text-muted); width: 220px; box-sizing: border-box; }
.cr-search:focus-within { border-color: var(--px-accent); }
.cr-search input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; color: var(--px-text); font: inherit; font-size: var(--px-text-sm); }
.cr-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--px-space-4); }
.cr-grid > .px-empty { grid-column: 1 / -1; }
.cr-card { display: flex; flex-direction: column; gap: var(--px-space-2); padding: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); cursor: pointer; min-width: 0; outline: none; }
.cr-card:hover, .cr-card:focus-visible { border-color: var(--px-border-strong); }
.cr-card:focus-visible { box-shadow: var(--px-ring); }
.cr-card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: var(--px-space-1); }
.cr-card-top-right { display: flex; align-items: center; gap: var(--px-space-1); opacity: 0; transition: opacity var(--px-dur-fast) var(--px-ease); }
.cr-card:hover .cr-card-top-right, .cr-card:focus-within .cr-card-top-right { opacity: 1; }
.cr-card-name { font-weight: 600; font-size: var(--px-text-md); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-card-tag { font-size: var(--px-text-sm); color: var(--px-text-muted); line-height: 1.45; height: calc(1.45em * 2); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cr-card-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-2); border-top: 1px solid var(--px-divider); padding-top: var(--px-space-2); margin-top: auto; }
.cr-card-meta { font-size: var(--px-text-xs); color: var(--px-text-faint); }
.cr-grid--lore { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cr-lore-card { display: flex; align-items: center; gap: var(--px-space-3); padding: var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); cursor: pointer; min-width: 0; outline: none; }
.cr-lore-card:hover, .cr-lore-card:focus-visible { border-color: var(--px-border-strong); }
.cr-lore-icon { flex: none; width: 32px; height: 32px; border-radius: var(--px-radius-md); display: inline-flex; align-items: center; justify-content: center; background: var(--px-surface-hover); color: var(--px-text-secondary); }
.cr-lore-text { flex: 1; min-width: 0; }
.cr-lore-text .cr-card-name { font-size: var(--px-text-base); }
.cr-detail-host { min-height: 0; }
.cr-back { display: inline-flex; align-items: center; gap: 2px; margin: var(--px-space-4) 0 0 var(--px-space-5); border: 0; background: none; padding: 0; color: var(--px-text-muted); font: inherit; font-size: var(--px-text-sm); cursor: pointer; }
.cr-back:hover { color: var(--px-text); }
@container (max-width: 980px) { .cr-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .cr-grid--lore { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 720px) { .cr-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 460px) { .cr-grid, .cr-grid--lore { grid-template-columns: minmax(0, 1fr); } .cr-search { width: 100%; } }
/* Chat: who you are talking to, the scene now, messages as a conversation. */
.tg-chat { background: var(--px-bg); font-family: var(--px-font-ui); }
.tg-chat-toolbar { background: var(--px-bg); border-bottom: 1px solid var(--px-divider); padding: var(--px-space-2) var(--px-space-5); gap: var(--px-space-2); }
.cr-chat-head { display: flex; align-items: center; gap: var(--px-space-3); min-width: 0; }
.cr-chat-faces { display: flex; }
.cr-chat-faces .cr-portrait + .cr-portrait { margin-left: -8px; box-shadow: 0 0 0 2px var(--px-bg); }
.cr-chat-head-text { min-width: 0; display: flex; flex-direction: column; }
.cr-chat-head-name { font-weight: 600; font-size: var(--px-text-md); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-chat-head .tg-chat-toolbar-charname { font-size: var(--px-text-xs); font-weight: 400; color: var(--px-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-now { display: flex; align-items: center; gap: var(--px-space-3); margin: var(--px-space-3) auto 0; width: calc(100% - 2 * var(--px-space-5)); max-width: 860px; box-sizing: border-box; padding: var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); color: var(--px-text); font: inherit; font-size: var(--px-text-sm); text-align: left; cursor: pointer; flex-shrink: 0; }
.cr-now:hover { border-color: var(--px-border-strong); }
.cr-now-label { font-size: var(--px-text-xs); font-weight: 600; color: var(--px-text-muted); }
.cr-now-place { font-weight: 500; }
.cr-now-bit { color: var(--px-text-secondary); }
.tg-messages { padding: var(--px-space-4) 0; }
.tg-msg { max-width: 860px; margin: 0 auto; padding: var(--px-space-2) var(--px-space-5); gap: var(--px-space-3); box-sizing: border-box; }
.tg-msg-face { margin-top: 20px; }
.tg-msg-name { font-size: var(--px-text-xs); font-weight: 600; color: var(--px-text-secondary); }
.tg-msg-body { font-size: var(--px-text-base); line-height: 1.6; max-width: 100%; }
.tg-msg--ai .tg-msg-body { align-self: flex-start; padding: var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-border); border-radius: 4px var(--px-radius-xl) var(--px-radius-xl) var(--px-radius-xl); background: var(--px-bg-elevated); }
.tg-msg--user { flex-direction: row-reverse; }
.tg-msg--user .tg-msg-content-wrap { align-items: flex-end; }
.tg-msg--user .tg-msg-body { padding: var(--px-space-2) var(--px-space-3); border-radius: var(--px-radius-xl) 4px var(--px-radius-xl) var(--px-radius-xl); background: var(--px-accent-faint); border: 1px solid var(--px-accent-soft); max-width: min(100%, 620px); }
.tg-msg--user .tg-msg-name-row { justify-content: flex-end; }
.tg-msg--ai .tg-msg-content-wrap, .tg-msg--user .tg-msg-content-wrap { max-width: min(100%, 680px); }
.tg-msg-body--editing { width: 100%; box-sizing: border-box; }
.tg-msg-inline-actions { position: absolute; top: 0; right: var(--px-space-5); height: auto; margin: 0; padding: 2px; gap: 1px; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); box-shadow: var(--px-shadow-md); z-index: 2; }
.tg-msg--user .tg-msg-inline-actions { right: auto; left: var(--px-space-5); }
.tg-msg:focus-within .tg-msg-inline-actions { visibility: visible; }
.tg-msg-action-btn { width: 24px; height: 24px; border-radius: var(--px-radius-xs); color: var(--px-text-muted); }
.tg-msg-action-btn:hover { background: var(--px-surface-hover); color: var(--px-text); }
.tg-variant-nav { visibility: visible; margin-left: var(--px-space-1); padding-left: var(--px-space-1); border-left: 1px solid var(--px-divider); color: var(--px-text-muted); font-size: var(--px-text-xs); }
.tg-msg--streaming .tg-msg-body::after { content: ''; display: inline-block; width: 2px; height: 1em; vertical-align: -2px; margin-left: 2px; background: var(--px-accent); animation: cr-blink 1s steps(1) infinite; }
.cr-still .tg-msg--streaming .tg-msg-body::after { animation: none; }
@media (prefers-reduced-motion: reduce) { .tg-msg--streaming .tg-msg-body::after { animation: none; } }
.tg-msg--system .tg-msg-body, .tg-msg--scenario .tg-msg-body { color: var(--px-text-muted); }
.tg-input-wrap { padding: var(--px-space-2) var(--px-space-5) var(--px-space-4); border-top: 0; background: var(--px-bg); }
.tg-input-card { max-width: 860px; margin: 0 auto; width: 100%; box-sizing: border-box; border: 1px solid var(--px-border-strong); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); }
.tg-input-card:focus-within { border-color: var(--px-accent); box-shadow: none; }
.tg-shortcut-bar { gap: var(--px-space-1); padding: var(--px-space-1) var(--px-space-2) var(--px-space-2); border-top: 0; }
.tg-shortcut-btn { height: var(--px-control-h-sm); padding: 0 var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-full); color: var(--px-text-secondary); font-family: var(--px-font-ui); font-size: var(--px-text-xs); }
.tg-shortcut-btn:hover { background: var(--px-surface-hover); border-color: var(--px-border-strong); color: var(--px-text); }
.tg-shortcut-btn--add { border-style: dashed; }
.cr-directions { max-width: 860px; margin: 0 auto var(--px-space-2); width: 100%; box-sizing: border-box; border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); padding: var(--px-space-2) var(--px-space-3) var(--px-space-3); max-height: 42vh; overflow-y: auto; }
.cr-directions-head { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-2); }
.cr-directions-title { display: inline-flex; align-items: center; gap: 6px; font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text); }
.cr-directions-actions { display: inline-flex; align-items: center; gap: var(--px-space-1); }
.cr-directions-icon { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--px-radius-xs); background: none; color: var(--px-text-muted); cursor: pointer; padding: 0; }
.cr-directions-icon:hover { background: var(--px-surface-hover); color: var(--px-text); }
.cr-directions-icon:disabled { opacity: 0.5; cursor: default; background: none; }
.cr-directions-status { font-size: var(--px-text-xs); color: var(--px-text-muted); margin-top: var(--px-space-1); }
.cr-directions-status--error { color: var(--px-text-secondary); }
.cr-directions-retry { border: 0; background: none; padding: 0; margin-left: var(--px-space-1); color: var(--px-accent-text); font: inherit; cursor: pointer; }
.cr-directions-retry:hover { text-decoration: underline; }
.cr-directions-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--px-space-3); margin-top: var(--px-space-2); }
.cr-directions-group { min-width: 0; display: flex; flex-direction: column; gap: var(--px-space-1); }
.cr-directions-who { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-xs); font-weight: 600; color: var(--px-text-secondary); margin-bottom: 2px; }
.cr-direction { display: flex; align-items: baseline; gap: var(--px-space-2); width: 100%; box-sizing: border-box; padding: var(--px-space-1) var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg); color: var(--px-text); font: inherit; font-size: var(--px-text-sm); line-height: 1.4; text-align: left; cursor: pointer; }
.cr-direction:hover, .cr-direction:focus-visible { border-color: var(--px-border-strong); background: var(--px-surface-hover); outline: none; }
.cr-direction--picked { border-color: var(--px-accent); background: var(--px-accent-faint); }
.cr-direction-kind { flex: none; width: 76px; font-size: var(--px-text-xs); color: var(--px-text-muted); }
.cr-direction-text { flex: 1; min-width: 0; }
@container (max-width: 640px) { .cr-directions-groups { grid-template-columns: minmax(0, 1fr); } }
.cr-chat-body { flex: 1; min-height: 0; display: flex; }
.cr-chat-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.cr-memory { flex: 0 0 300px; border-left: 1px solid var(--px-divider); background: var(--px-bg-elevated); padding: var(--px-space-3) var(--px-space-4); display: flex; flex-direction: column; gap: var(--px-space-3); overflow-y: auto; box-sizing: border-box; }
.cr-memory-head { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-2); }
.cr-memory-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.cr-memory-open { border: 0; background: none; padding: 0; color: var(--px-accent-text); font: inherit; font-size: var(--px-text-xs); cursor: pointer; }
.cr-memory-open:hover { text-decoration: underline; }
.cr-memory-open:disabled { color: var(--px-text-muted); cursor: default; text-decoration: none; }
.cr-memory-actions { display: inline-flex; gap: var(--px-space-3); align-items: center; }
.cr-memory-seg { align-self: stretch; }
.cr-memory-seg button { flex: 1; }
.cr-memory-list { display: flex; flex-direction: column; }
.cr-memory-item { padding: var(--px-space-2) 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-sm); color: var(--px-text-secondary); line-height: 1.45; }
.cr-memory-item:first-child { border-top: 0; }
.cr-memory-empty { font-size: var(--px-text-sm); color: var(--px-text-muted); }
.cr-memory-hint { display: flex; align-items: center; gap: var(--px-space-2); padding: var(--px-space-2) var(--px-space-3); border: 1px dashed var(--px-border-strong); border-radius: var(--px-radius-md); color: var(--px-text-muted); font-size: var(--px-text-xs); margin-top: auto; }
@container (max-width: 760px) { .cr-memory { display: none !important; } }
.tg-chat { container-type: inline-size; }
.cr-settings-head { padding: var(--px-space-5) var(--px-space-6) 0; max-width: 820px; }
.cr-feel { max-width: 640px; margin-bottom: var(--px-space-6); }
.cr-feel-row { display: flex; align-items: center; gap: var(--px-space-5); padding: var(--px-space-3) 0; border-top: 1px solid var(--px-divider); }
.cr-feel-text { flex: 1; min-width: 0; }
.cr-feel-label { font-weight: 500; }
.cr-feel-hint { font-size: var(--px-text-xs); color: var(--px-text-muted); margin-top: 2px; }
@container (max-width: 900px) {
  .cr-hero { grid-template-columns: minmax(0, 1fr); }
  .cr-quick { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cr-cast { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@container (max-width: 560px) {
  .cr-home { padding: var(--px-space-4); }
  .cr-continue, .cr-quick { grid-template-columns: minmax(0, 1fr); }
  .cr-cast { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cr-prompt { flex-wrap: wrap; }
  .cr-prompt-input { flex-basis: 100%; }
}
  `;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wrap a save-shaped promise so its failure is surfaced to the user
 * instead of being silently swallowed (M79 Phase 5).
 *
 * Most thread / settings writes were `.catch(() => {})` before this
 * helper existed — failures left the user thinking their edit was saved
 * when it wasn't. Now: log the raw error to the console (debug trail) AND
 * show a passive warning toast naming the field that didn't persist.
 *
 * Pass the same `parallx` handle that's already in scope at the call site;
 * the helper degrades gracefully if `parallx.window` is missing (tests,
 * headless builds).
 */
function surfaceSaveError(promise, parallx, label) {
  return Promise.resolve(promise).catch((err) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[TextGenerator] save failed (${label}):`, detail);
    try {
      parallx?.window?.showWarningMessage?.(
        `Couldn't save ${label}. Your change may not persist if you close this chat.`,
      );
    } catch { /* never let the toast itself throw */ }
  });
}

function generateId() {
  // Prefer crypto.randomUUID() for proper RFC4122 v4 IDs; fall back to a
  // Math.random-seeded shape for environments where it's unavailable.
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Strict numeric matchers — only convert a value to Number when it looks
// EXACTLY like an integer or a simple decimal. This rejects version-like
// strings ("1.0.0") and IPs that the previous loose `!isNaN(value)` would
// have lossily coerced.
const _FM_INT_RE = /^-?\d+$/;
const _FM_FLOAT_RE = /^-?\d+\.\d+$/;

function _splitArrayItems(inner) {
  const out = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === ',' && !inSingle && !inDouble) {
      const item = buf.trim();
      if (item) out.push(_unquote(item));
      buf = '';
      continue;
    }
    buf += ch;
  }
  const last = buf.trim();
  if (last) out.push(_unquote(last));
  return out;
}

function _unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: text };

  const frontmatter = {};
  for (const rawLine of match[1].split('\n')) {
    // Strip trailing `# comment` (only when not inside quotes).
    let line = rawLine;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '#' && !inSingle && !inDouble) {
        line = line.slice(0, i);
        break;
      }
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    let value = line.slice(colonIdx + 1).trim();
    if (value === '') {
      frontmatter[key] = '';
      continue;
    }

    // Quoted strings: preserve as-is (no numeric coercion).
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      frontmatter[key] = value.slice(1, -1);
      continue;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = _splitArrayItems(value.slice(1, -1));
      continue;
    }
    if (value === 'true') { frontmatter[key] = true; continue; }
    if (value === 'false') { frontmatter[key] = false; continue; }
    if (value === 'null' || value === '~') { frontmatter[key] = null; continue; }
    if (_FM_INT_RE.test(value)) { frontmatter[key] = parseInt(value, 10); continue; }
    if (_FM_FLOAT_RE.test(value)) { frontmatter[key] = parseFloat(value); continue; }
    // Unquoted, non-numeric → keep raw string (preserves "1.0.0", paths, etc).
    frontmatter[key] = value;
  }

  return { frontmatter, body: text.slice(match[0].length).trim() };
}

// CJK ranges where one char ≈ one token — treat at ~1.2 chars/token instead
// of the ASCII default of ~4 chars/token. Without this, contexts containing
// Japanese / Chinese / Korean text were under-counted by 3-4×, causing the
// model to receive far more tokens than the budget allowed.
const _ESTIMATE_WIDE_RANGES = [
  [0x3040, 0x30ff],   // Hiragana + Katakana
  [0x3400, 0x4dbf],   // CJK Ext A
  [0x4e00, 0x9fff],   // CJK Unified
  [0xac00, 0xd7af],   // Hangul Syllables
  [0xf900, 0xfaff],   // CJK Compatibility
  [0xff66, 0xff9f],   // Halfwidth Katakana
  [0x20000, 0x2ebef], // CJK Ext B–F
];

function _isWideChar(cp) {
  for (const [lo, hi] of _ESTIMATE_WIDE_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function estimateTokens(text) {
  if (!text) return 0;
  let wide = 0;
  let narrow = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp != null && _isWideChar(cp)) wide += 1;
    else narrow += 1;
  }
  return Math.ceil(narrow / 4 + wide / 1.2);
}

/**
 * M79 Phase 3c — extract repeated phrases from a set of recent
 * outputs by the same speaker. Returns a deduped list of n-gram
 * strings that occur at least `minOccurrences` times across the
 * inputs. Used to feed the variation-avoidance system message so the
 * model gets concrete "stop saying X" guidance.
 *
 * Limitations by design:
 *   - Stop-word-free filtering would be more accurate but adds noise
 *     in fictional prose ("the village", "her eyes" SHOULD register).
 *   - We normalize whitespace + lowercase but don't lemmatize, so
 *     "walked away" and "walks away" count separately. Good enough
 *     for prose freshness signaling.
 */
function _extractRepeatedPhrases(outputs, { n = [3, 4, 5], minOccurrences = 2, max = 8 } = {}) {
  if (!Array.isArray(outputs) || outputs.length < 2) return [];
  const sizes = Array.isArray(n) ? n : [n];
  const counts = new Map(); // phrase -> { count, originalCase }
  for (const text of outputs) {
    if (typeof text !== 'string' || !text.trim()) continue;
    // Tokenize on whitespace + strip punctuation tails. Keep
    // dialogue-friendly words intact ("don't", "it's").
    const words = text.toLowerCase().match(/[a-z0-9']+/g);
    if (!words || words.length === 0) continue;
    for (const size of sizes) {
      for (let i = 0; i + size <= words.length; i++) {
        const phrase = words.slice(i, i + size).join(' ');
        // Skip mostly-pronoun phrases that match by accident in long
        // outputs ("he was the" etc.) — they're true positives but
        // produce noisy instructions.
        if (/^(the |a |an |of |and |to |for |that |this |with |is |was |it |he |she |they |you |i )/.test(phrase + ' ')) {
          // Allow if it contains a content noun later in the phrase
          if (!/[a-z]{4,}/.test(phrase.split(' ').slice(-1)[0])) continue;
        }
        const existing = counts.get(phrase);
        if (existing) existing.count += 1;
        else counts.set(phrase, { count: 1 });
      }
    }
  }
  // Collect candidates that meet the threshold; prefer longer phrases
  // since they encode more specific repetition.
  const candidates = [];
  for (const [phrase, info] of counts) {
    if (info.count >= minOccurrences) candidates.push({ phrase, count: info.count, len: phrase.split(' ').length });
  }
  candidates.sort((a, b) => (b.len - a.len) || (b.count - a.count));
  // Suppress shorter phrases fully contained in a longer one already chosen.
  const chosen = [];
  for (const c of candidates) {
    if (chosen.length >= max) break;
    if (chosen.some((x) => x.phrase.includes(c.phrase))) continue;
    chosen.push(c);
  }
  return chosen.map((c) => c.phrase);
}

function trimTextToBudget(text, budgetTokens) {
  if (!text) return '';
  if (budgetTokens <= 0) return '';
  const total = estimateTokens(text);
  if (total <= budgetTokens) return text;
  // Proportional cut. Slightly under-estimates wide chars but that's fine —
  // the safety margin keeps us under budget.
  const ratio = budgetTokens / total;
  return text.slice(0, Math.max(1, Math.floor(text.length * ratio)));
}

/**
 * Hard no-em-dash guard (user rule): model output must never contain em
 * or en dashes, anywhere. Prompt instructions reduce them; this strips
 * whatever slips through, context-aware:
 *   - numeric ranges keep a plain hyphen (2–3 -> 2-3)
 *   - a dash opening a line (dialogue-dash affectation) is dropped
 *   - a dash at a quote boundary / line end reads as interrupted speech -> ellipsis
 *   - anything else is a pause -> comma
 */
function stripEmDashes(text) {
  if (!text) return text;
  return text
    .replace(/(\d)\s*[—–]\s*(?=\d)/g, '$1-')
    .replace(/^[—–]+\s*/gm, '')
    .replace(/\s*[—–]+(?=["'”’)\]]|\s*$)/gm, '...')
    .replace(/\s*[—–]+\s*/g, ', ');
}

function substituteVars(text, charName, userName) {
  return text.replace(/\{\{char\}\}/gi, charName).replace(/\{\{user\}\}/gi, userName);
}

function resolveUri(baseUri, path) {
  const base = baseUri.endsWith('/') ? baseUri.slice(0, -1) : baseUri;
  const rel = path.startsWith('/') ? path : '/' + path;
  return base + rel;
}

async function ensureDir(fs, uri) {
  try {
    if (!(await fs.exists(uri))) await fs.mkdir(uri);
  } catch { /* parent may not exist */ }
}

async function ensureNestedDirs(fs, baseUri, segments) {
  let current = baseUri;
  for (const seg of segments) {
    current = resolveUri(current, seg);
    await ensureDir(fs, current);
  }
  return current;
}

/**
 * Parse slash commands from user input.
 * Returns { command, args, instruction, targetCharacter } or null if not a slash command.
 */
function parseSlashCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  const command = spaceIdx === -1 ? trimmed.slice(1).toLowerCase() : trimmed.slice(1, spaceIdx).toLowerCase();
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  let targetCharacter = null;
  let instruction = rest;

  // Parse @CharName or @"Char Name" from the rest
  const atQuotedMatch = rest.match(/^@"([^"]+)"\s*(.*)/s);
  if (atQuotedMatch) {
    targetCharacter = atQuotedMatch[1];
    instruction = atQuotedMatch[2].trim();
  } else {
    const atMatch = rest.match(/^@(\S+)\s*(.*)/s);
    if (atMatch) {
      targetCharacter = atMatch[1];
      instruction = atMatch[2].trim();
    }
  }

  // Drop unfilled <placeholder> tokens so a button-shortcut the user didn't
  // edit (e.g. "/ai @Char <optional writing instruction>") doesn't ship the
  // literal placeholder text as the instruction — which the model treats as
  // garbage and effectively ignores.
  instruction = instruction.replace(/<[^>\n]+>/g, '').trim();

  return { command, args: rest, instruction, targetCharacter };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: TOKEN BUDGET (← openclawTokenBudget.ts)
// ═══════════════════════════════════════════════════════════════════════════════

// Minimum fraction of total context guaranteed to history when the
// system-prompt overflows. Without this floor, a long character card
// could starve the model of conversation entirely and produce drift.
const MIN_HISTORY_FRACTION = 0.15;

function computeTokenBudget(contextWindow, settings = null) {
  const total = Math.max(0, Math.floor(contextWindow));
  // Clamp negatives — a malformed settings file used to flip the lane.
  let charPct = Math.max(0, (settings?.tokenBudgetCharacter ?? 15)) / 100;
  let lorePct = Math.max(0, (settings?.tokenBudgetLore ?? 20)) / 100;
  let histPct = Math.max(0, (settings?.tokenBudgetHistory ?? 35)) / 100;
  let userPct = Math.max(0, (settings?.tokenBudgetUser ?? 30)) / 100;
  // Normalize so percentages always sum to 100%
  const sum = charPct + lorePct + histPct + userPct;
  if (sum > 0 && Math.abs(sum - 1) > 0.001) {
    charPct /= sum;
    lorePct /= sum;
    histPct /= sum;
    userPct /= sum;
  } else if (sum === 0) {
    // All-zero settings: fall back to defaults rather than producing zeros.
    charPct = 0.15; lorePct = 0.20; histPct = 0.35; userPct = 0.30;
  }
  return {
    total,
    character: Math.floor(total * charPct),
    lore: Math.floor(total * lorePct),
    history: Math.floor(total * histPct),
    user: Math.floor(total * userPct),
  };
}

/**
 * Apply a minimum-history floor when the rendered system prompt exceeds
 * its budgeted character lane. Returns the effective history budget plus
 * diagnostic info the UI can surface as a warning.
 *
 * @param {{ total:number, character:number, history:number, lore:number, user:number }} budget
 * @param {number} systemPromptTokens
 * @returns {{ effectiveHistory:number, borrowed:number, hitFloor:boolean }}
 */
function applyHistoryFloor(budget, systemPromptTokens) {
  if (systemPromptTokens <= budget.character) {
    return { effectiveHistory: budget.history, borrowed: 0, hitFloor: false };
  }
  const overflow = systemPromptTokens - budget.character;
  const minFloor = Math.floor(budget.total * MIN_HISTORY_FRACTION);
  const candidate = Math.max(0, budget.history - overflow);
  if (candidate < minFloor) {
    return { effectiveHistory: minFloor, borrowed: budget.history - minFloor, hitFloor: true };
  }
  return { effectiveHistory: candidate, borrowed: overflow, hitFloor: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: CHARACTER & LOREBOOK PARSERS
// ═══════════════════════════════════════════════════════════════════════════════

// Section headings of the markdown card. Exact names first (they would
// otherwise collide with the legacy fuzzy matches: "User Reminder" contains
// "reminder"), then the three legacy headings matched loosely as before.
const CHARACTER_MD_EXACT_SECTIONS = {
  'voice anchor': 'voiceAnchor',
  'user reminder': 'userReminder',
  'user description': 'userDescription',
};
const CHARACTER_MD_LEGACY_SECTIONS = { reminder: 'reminder', initial: 'initialMessages', example: 'exampleDialogue' };

function parseCharacterMd(content, fileName) {
  const { frontmatter, body } = parseFrontmatter(content);
  const sections = {};
  let currentSection = 'roleInstruction';
  let currentContent = [];

  const flush = () => {
    if (!currentContent.length) return;
    const text = currentContent.join('\n').trim();
    if (text) sections[currentSection] = (sections[currentSection] ? sections[currentSection] + '\n\n' : '') + text;
    currentContent = [];
  };

  for (const line of body.split('\n')) {
    if (line.startsWith('## ')) {
      flush();
      const heading = line.slice(3).trim().toLowerCase();
      const exact = CHARACTER_MD_EXACT_SECTIONS[heading];
      const fuzzy = exact ? null : Object.keys(CHARACTER_MD_LEGACY_SECTIONS).find((k) => heading.includes(k));
      currentSection = exact || (fuzzy ? CHARACTER_MD_LEGACY_SECTIONS[fuzzy] : 'roleInstruction');
      // Any other heading is part of the role instruction and is kept, so a
      // Forge card's "## Appearance" / "## Personality" survives a round trip
      // through an exported markdown file.
      if (!exact && !fuzzy) currentContent.push(line);
    } else {
      currentContent.push(line);
    }
  }
  flush();

  return {
    frontmatter,
    sections,
    initialMessages: parseInitialMessages(sections.initialMessages),
    fileName,
  };
}

function parseInitialMessages(text) {
  if (!text) return [];
  const messages = [];
  let cur = null;

  for (const line of text.split('\n')) {
    const m = line.match(/^\[(AI|USER|SYSTEM)(?:;\s*(.+?))?\]:\s*(.*)/i);
    if (m) {
      if (cur) messages.push(cur);
      const role = m[1].toUpperCase();
      const props = m[2] || '';
      let visibility = 'both';
      let name;
      let expectsReply = true;
      if (props) {
        const hm = props.match(/hiddenFrom=(\w+)/i);
        if (hm) {
          const h = hm[1].toLowerCase();
          visibility = h === 'user' ? 'ai-only' : h === 'ai' ? 'user-only' : 'both';
        }
        const nm = props.match(/name=([^;]+)/i);
        if (nm) name = nm[1].trim();
        const er = props.match(/expectsReply=(\w+)/i);
        if (er) expectsReply = er[1].toLowerCase() !== 'false';
      }
      cur = {
        role: role === 'AI' ? 'assistant' : role === 'USER' ? 'user' : 'system',
        content: m[3],
        visibility,
        name,
        expectsReply,
      };
    } else if (cur && line.trim()) {
      cur.content += '\n' + line;
    }
  }
  if (cur) messages.push(cur);
  return messages;
}

/** Scan EXT_ROOT/characters/ for .json files (with .md fallback + auto-migrate). */
async function scanCharacters(fs, workspaceUri) {
  const charsDir = resolveUri(workspaceUri, `${EXT_ROOT}/characters`);
  try {
    const entries = await fs.readdir(charsDir);
    const results = [];
    for (const entry of entries) {
      if (entry.type !== 1) continue;
      try {
        if (entry.name.endsWith('.json')) {
          const { content } = await fs.readFile(resolveUri(charsDir, entry.name));
          results.push(loadCharacterJson(content, entry.name));
        } else if (entry.name.endsWith('.md')) {
          // Non-destructive migration: keep the original .md file alongside
          // the new .json so users can recover hand-written formatting if the
          // automatic conversion lost anything. The .md is renamed to
          // <name>.md.bak so future scans skip it (we only match .md / .json
          // suffixes). User can delete .bak files manually when satisfied.
          const content = (await fs.readFile(resolveUri(charsDir, entry.name))).content;
          const jsonName = entry.name.replace(/\.md$/, '.json');
          // Skip migration if a .json with the same stem already exists —
          // otherwise we'd silently overwrite the user's authoritative copy.
          // The directory iteration may have already loaded that .json above,
          // or it may come later; either way, prefer the JSON.
          if (await fs.exists(resolveUri(charsDir, jsonName))) {
            console.warn('[TextGenerator] Skipping .md migration; .json already exists for', entry.name);
            continue;
          }
          const char = migrateCharacterMdToJson(content, entry.name);
          const backupName = entry.name + '.bak';
          await fs.writeFile(resolveUri(charsDir, jsonName), JSON.stringify(char, null, 2));
          try {
            await fs.writeFile(resolveUri(charsDir, backupName), content);
            await fs.delete(resolveUri(charsDir, entry.name));
          } catch (err) {
            console.warn('[TextGenerator] Could not back up legacy character file', entry.name, err);
          }
          results.push(normalizeCharacterForRuntime(char, jsonName));
        }
      } catch (err) { console.warn('[TextGenerator] Skipped unreadable character', entry.name, err); }
    }
    return results;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4B: JSON CHARACTER DATA MODEL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a blank character JSON object with all Perchance-parity fields.
 */
function createCharacterJson(overrides = {}) {
  return {
    id: 'char-' + generateId().slice(0, 8),
    name: 'New Character',
    roleInstruction: '',
    exampleDialogue: '',
    reminder: '',
    userReminder: '',
    initialMessages: '[AI]: Hello! I\'m {{char}}. Edit me to set up my personality!',
    writingPreset: 'immersive-rp',
    pov: '',
    temperature: 0.8,
    maxTokensPerMessage: 0,
    messageLengthLimit: '',
    userName: '',
    userDescription: '',
    lorebookFiles: [],
    fitMessagesInContextMethod: 'dropOld',
    extendedMemory: false,
    shortcutButtons: '',
    systemName: '',
    messageInputPlaceholder: '',
    messageWrapperStyle: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Save a character JSON object to disk.
 */
async function saveCharacter(fs, workspaceUri, fileName, charData) {
  const dir = resolveUri(workspaceUri, `${EXT_ROOT}/characters`);
  charData.updatedAt = Date.now();
  await fs.writeFile(resolveUri(dir, fileName), JSON.stringify(charData, null, 2));
}

/**
 * Load a character from a .json file string.
 */
function loadCharacterJson(content, fileName) {
  const data = JSON.parse(content);
  return normalizeCharacterForRuntime(data, fileName);
}

/**
 * Convert the new JSON data model into the runtime shape expected by
 * buildSystemPrompt/assembleContext (backward-compatible with parseCharacterMd output).
 */
function normalizeCharacterForRuntime(data, fileName) {
  return {
    frontmatter: {
      name: data.name || '',
      temperature: data.temperature ?? 0.8,
      maxTokensPerMessage: data.maxTokensPerMessage ?? 0,
      writingPreset: data.writingPreset || 'immersive-rp',
      pov: data.pov || '',
      messageLengthLimit: data.messageLengthLimit || '',
      userName: data.userName || '',
      userDescription: data.userDescription || '',
      fitMessagesInContextMethod: data.fitMessagesInContextMethod || 'dropOld',
      extendedMemory: data.extendedMemory || false,
      shortcutButtons: data.shortcutButtons || '',
      systemName: data.systemName || '',
      messageInputPlaceholder: data.messageInputPlaceholder || '',
      messageWrapperStyle: data.messageWrapperStyle || '',
    },
    sections: {
      roleInstruction: data.roleInstruction || '',
      reminder: data.reminder || '',
      // M79 Phase 3b's late-stage voice anchor was read at generation
      // time but never mapped from the JSON model — dead wiring for
      // every .json character until now.
      voiceAnchor: data.voiceAnchor || '',
      exampleDialogue: data.exampleDialogue || '',
      initialMessages: data.initialMessages || '',
    },
    initialMessages: parseInitialMessages(data.initialMessages || ''),
    userReminder: data.userReminder || '',
    rawData: data,
    fileName,
  };
}

/**
 * Migrate a .md character file to JSON format.
 */
function migrateCharacterMdToJson(mdContent, fileName) {
  const parsed = parseCharacterMd(mdContent, fileName);
  const fm = parsed.frontmatter;
  const overrides = {
    name: fm.name !== undefined && fm.name !== null && fm.name !== '' ? String(fm.name) : fileName.replace(/\.(md|json)$/, ''),
    roleInstruction: parsed.sections.roleInstruction || '',
    voiceAnchor: parsed.sections.voiceAnchor || '',
    exampleDialogue: parsed.sections.exampleDialogue || '',
    reminder: parsed.sections.reminder || '',
    userReminder: parsed.sections.userReminder || '',
    userDescription: parsed.sections.userDescription || '',
    initialMessages: parsed.sections.initialMessages || '',
    temperature: fm.temperature ?? 0.8,
    maxTokensPerMessage: fm.maxTokensPerMessage ?? 0,
    writingPreset: fm.writingPreset || 'immersive-rp',
  };
  // The remaining scalars the export writes come back as-is when present.
  for (const [key] of CHARACTER_MD_FRONTMATTER_KEYS) {
    if (key in overrides) continue;
    if (fm[key] !== undefined && fm[key] !== null && fm[key] !== '') overrides[key] = fm[key];
  }
  return createCharacterJson(overrides);
}

// ── Character markdown export ──
// The exported file is the same card layout the scanner already imports:
// frontmatter for the scalars, the role instruction as the body, then one
// "## Heading" section per long-text field. Defaults and empty fields are
// left out so a simple character stays a simple file.
const CHARACTER_MD_FRONTMATTER_KEYS = [
  ['writingPreset', 'immersive-rp'],
  ['temperature', 0.8],
  ['maxTokensPerMessage', 0],
  ['pov', ''],
  ['messageLengthLimit', ''],
  ['userName', ''],
  ['systemName', ''],
  ['fitMessagesInContextMethod', 'dropOld'],
  ['extendedMemory', false],
  ['messageInputPlaceholder', ''],
];
const CHARACTER_MD_SECTIONS = [
  ['voiceAnchor', 'Voice Anchor'],
  // exampleDialogue is deliberately not exported.
  ['reminder', 'Reminder'],
  ['userReminder', 'User Reminder'],
  ['userDescription', 'User Description'],
  ['initialMessages', 'Initial Messages'],
];

/**
 * One frontmatter value, written so parseFrontmatter reads it back unchanged:
 * the parser strips "#" comments, coerces bare numbers and booleans, and
 * unquotes a quoted string verbatim, so anything it could misread is quoted.
 */
function formatFrontmatterValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value).replace(/\r?\n/g, ' ').trim();
  const risky = s === '' || /[#:'"]/.test(s) || /^\s|\s$/.test(s) || /^(true|false|null|~)$/.test(s) || /^-?\d/.test(s) || s.startsWith('[');
  if (!risky) return s;
  if (!s.includes('"')) return '"' + s + '"';
  if (!s.includes("'")) return "'" + s + "'";
  return '"' + s.replace(/"/g, "'") + '"';
}

/** Serialize a character JSON object as a markdown card. */
function serializeCharacterMd(data) {
  const lines = ['---', 'name: ' + formatFrontmatterValue(data.name || 'Unnamed')];
  for (const [key, dflt] of CHARACTER_MD_FRONTMATTER_KEYS) {
    const value = data[key];
    if (value === undefined || value === null || value === '' || value === dflt) continue;
    lines.push(key + ': ' + formatFrontmatterValue(value));
  }
  lines.push('---', '');
  const body = String(data.roleInstruction || '').trim();
  if (body) lines.push(body, '');
  for (const [key, heading] of CHARACTER_MD_SECTIONS) {
    const text = String(data[key] || '').trim();
    if (!text) continue;
    lines.push('## ' + heading, text, '');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

/** File name for an exported character: the name, lower-cased and safe on every OS. */
function characterExportFileName(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (slug || 'character') + '.md';
}

/**
 * Export a character as a markdown file: native Save dialog, then one write
 * to the chosen path. The data may be unsaved (the editor form, the Forge),
 * so this never touches the roster.
 */
async function exportCharacterToMarkdown(data) {
  const electron = globalThis.parallxElectron;
  if (!electron?.dialog?.saveFile || !electron?.fs?.writeFile) {
    showToastLite('Export is unavailable in this build.');
    return false;
  }
  const markdown = serializeCharacterMd(data);
  try {
    const target = await electron.dialog.saveFile({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultName: characterExportFileName(data.name),
    });
    if (!target) return false;
    const result = await electron.fs.writeFile(target, markdown, 'utf-8');
    if (result?.error) throw new Error(result.error.message || result.error.code || 'could not write the file');
    showToastLite('Exported ' + (data.name || 'character') + ' to ' + target);
    return true;
  } catch (err) {
    console.warn('[TextGenerator] Export failed:', err);
    showToastLite('Export failed: ' + (err?.message || String(err)));
    return false;
  }
}

/** A small toast for pages that live outside the chat editor. */
/** Save any Markdown to a file of the user's choosing (stories, tables). */
async function exportMarkdownFile(fileName, content, label = 'file') {
  const electron = globalThis.parallxElectron;
  if (!electron?.dialog?.saveFile || !electron?.fs?.writeFile) {
    showToastLite('Export is unavailable in this build.');
    return false;
  }
  try {
    const target = await electron.dialog.saveFile({ filters: [{ name: 'Markdown', extensions: ['md'] }], defaultName: fileName });
    if (!target) return false;
    const result = await electron.fs.writeFile(target, content, 'utf-8');
    if (result?.error) throw new Error(result.error.message || result.error.code || 'could not write the file');
    showToastLite(`Exported ${label} to ${target}`);
    return true;
  } catch (err) {
    console.warn('[TextGenerator] Export failed:', err);
    showToastLite('Export failed: ' + (err?.message || String(err)));
    return false;
  }
}

function showToastLite(message) {
  const toast = el('div', 'tg-toast');
  toast.appendChild(el('span', null, { text: message }));
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

/** Scan EXT_ROOT/lorebooks/ for .md files. */
async function scanLorebooks(fs, workspaceUri) {
  const loreDir = resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks`);
  try {
    const entries = await fs.readdir(loreDir);
    const results = [];
    for (const entry of entries) {
      if (entry.type === 1 && entry.name.endsWith('.md')) {
        try {
          const { content } = await fs.readFile(resolveUri(loreDir, entry.name));
          results.push({ fileName: entry.name, content });
        } catch (err) { console.warn('[TextGenerator] Skipped unreadable lorebook', entry.name, err); }
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Parse a lorebook's ## sections into entries with optional trigger keywords.
 * Format: ## Section Title\ntriggers: keyword1, keyword2\nContent...
 * Entries without a triggers: line are always active.
 */
function parseLoreEntries(lorebookContent) {
  const entries = [];
  const sections = lorebookContent.split(/^## /m);
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    const heading = lines[0].trim();
    let triggers = null;
    // M79 Phase 2 — additional metadata fields. Defaults preserve the
    // legacy behavior so users with old lorebooks see no change.
    let scope = 'triggered';        // always | triggered | scene:X | character:X
    let priority = 5;                // 0..10; higher = preserved under budget pressure
    let antiTriggers = null;         // suppress entry when any anti-keyword fires
    let bodyStart = 1;
    // Walk leading lines for any of the recognised metadata keys. Stop
    // at the first non-metadata content line.
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const lower = line.toLowerCase();
      if (lower.startsWith('triggers:')) {
        triggers = line.slice(9).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        bodyStart = i + 1;
        continue;
      }
      if (lower.startsWith('scope:')) {
        scope = line.slice(6).trim().toLowerCase();
        bodyStart = i + 1;
        continue;
      }
      if (lower.startsWith('priority:')) {
        const n = parseInt(line.slice(9).trim(), 10);
        if (Number.isFinite(n)) priority = Math.max(0, Math.min(10, n));
        bodyStart = i + 1;
        continue;
      }
      if (lower.startsWith('anti:') || lower.startsWith('anti-triggers:')) {
        const after = lower.startsWith('anti-triggers:') ? line.slice(14) : line.slice(5);
        antiTriggers = after.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        bodyStart = i + 1;
        continue;
      }
      break;
    }
    const body = lines.slice(bodyStart).join('\n').trim();
    if (body || heading) {
      entries.push({
        heading,
        body: body ? `## ${heading}\n${body}` : `## ${heading}`,
        triggers,
        scope,
        priority,
        antiTriggers,
      });
    }
  }
  return entries;
}

/**
 * Decide whether a single entry should fire, given the activation
 * context (recent text, scene state, present characters). Returns the
 * match strength (>0 means fire). Higher strength = more recent / more
 * specific trigger.
 *
 * Match strength model (used to break ties when sorting under budget
 * pressure — higher priority always wins first):
 *   - always-scope or character/scene match with no trigger: 0.5
 *   - triggered match with a keyword: 1.0 + how-recent bonus
 *   - anti-trigger fired: 0 (suppress)
 */
function _scoreLoreEntry(entry, ctx) {
  const { contextLower = '', sceneTags = [], presentCharNames = [] } = ctx;

  // 1. Anti-triggers always win — suppress entry entirely.
  if (entry.antiTriggers && entry.antiTriggers.length > 0) {
    if (entry.antiTriggers.some((kw) => contextLower.includes(kw))) return 0;
  }

  // 2. Scope filter.
  const scope = String(entry.scope || 'triggered').toLowerCase();
  if (scope.startsWith('scene:')) {
    const wanted = scope.slice(6).trim();
    if (!wanted) return 0;
    if (!sceneTags.some((tag) => String(tag).toLowerCase() === wanted)) return 0;
  } else if (scope.startsWith('character:')) {
    const wanted = scope.slice(10).trim().toLowerCase();
    if (!wanted) return 0;
    if (!presentCharNames.some((n) => String(n).toLowerCase() === wanted)) return 0;
  } else if (scope !== 'always' && scope !== 'triggered') {
    // Unknown scope — be conservative: default to triggered.
  }

  // 3. Keyword trigger evaluation.
  const hasTriggers = entry.triggers && entry.triggers.length > 0;
  if (scope === 'always') {
    // Always-scope ignores triggers; emit at base score.
    return 0.5;
  }
  if (scope.startsWith('scene:') || scope.startsWith('character:')) {
    // Scope-gated entries fire when the scope matches; triggers (if
    // present) further refine. If triggers exist and don't match, skip.
    if (hasTriggers) {
      if (!entry.triggers.some((kw) => contextLower.includes(kw))) return 0.5;
      return 1.0;
    }
    return 0.6;
  }
  // Default scope = triggered.
  if (!hasTriggers) return 0; // legacy "## heading" entries with no triggers — treat as skip
  if (!entry.triggers.some((kw) => contextLower.includes(kw))) return 0;
  return 1.0;
}

/**
 * Assemble lore content with M79 Phase 2 scope/priority/anti-trigger
 * support. Returns the trimmed lore string ready for injection.
 *
 * Selection order:
 *   1. Score every entry (anti-triggers suppress to 0; scope filters
 *      gate; trigger match boosts).
 *   2. Sort by priority DESC, then score DESC.
 *   3. Pack greedily into the budget; partial inclusion only for the
 *      first overflow entry (current behavior preserved).
 *
 * The activation context is back-compatible: pass `recentContext` and
 * everything works as before. `sceneState` and `presentCharNames` are
 * optional and unlock the new scope: forms.
 */
function assembleLoreContent(lorebooks, budgetTokens, recentContext = '', activation = {}) {
  const { sceneState = null, presentCharNames = [] } = activation;
  const contextLower = (recentContext || '').toLowerCase();
  // Build scene tag list from the structured scene state, lower-cased
  // for case-insensitive comparison against `scope: scene:X` entries.
  const sceneTags = [];
  if (sceneState && typeof sceneState === 'object') {
    for (const key of ['location', 'time', 'mood']) {
      if (sceneState[key]) sceneTags.push(String(sceneState[key]).toLowerCase());
    }
  }

  // Collect & score every entry across all lorebooks.
  const candidates = [];
  for (const lb of lorebooks) {
    const entries = parseLoreEntries(lb.content);
    for (const entry of entries) {
      const score = _scoreLoreEntry(entry, { contextLower, sceneTags, presentCharNames });
      if (score <= 0) continue;
      candidates.push({ entry, score, book: lb });
    }
  }

  // Sort by priority DESC, then score DESC.
  candidates.sort((a, b) => {
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority;
    return b.score - a.score;
  });

  // Pack greedily into the budget.
  let combined = '';
  let used = 0;
  for (const { entry } of candidates) {
    const t = estimateTokens(entry.body);
    if (used + t > budgetTokens) {
      const rem = budgetTokens - used;
      if (rem > 50) combined += '\n\n' + trimTextToBudget(entry.body, rem);
      used = budgetTokens;
      break;
    }
    combined += (combined ? '\n\n' : '') + entry.body;
    used += t;
  }
  return combined.trim();
}

/**
 * Diagnostic: which lorebook entries matched the recent context, which were
 * skipped because their triggers didn't fire, and which always fire (no
 * triggers). Returned shape is consumed by the Inspect Last Context modal.
 */
function debugLorebookTriggers(lorebooks, recentContext = '') {
  const contextLower = recentContext.toLowerCase();
  const matched = [];
  const skipped = [];
  const always = [];
  for (const lb of lorebooks) {
    const entries = parseLoreEntries(lb.content);
    for (const entry of entries) {
      const head = (entry.body || '').split('\n', 1)[0].slice(0, 80) || '(no header)';
      if (!entry.triggers || entry.triggers.length === 0) {
        always.push({ book: lb.fileName, head });
        continue;
      }
      const hits = entry.triggers.filter(kw => contextLower.includes(kw));
      if (hits.length > 0) matched.push({ book: lb.fileName, head, triggers: entry.triggers, hits });
      else skipped.push({ book: lb.fileName, head, triggers: entry.triggers });
    }
  }
  return { matched, skipped, always };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4C: SUPPORTING CAST
// ═══════════════════════════════════════════════════════════════════════════════
//
// People who are in the world of a chat but never take a turn of their own:
// the bartender, a sister, the landlord. Before this, a person was either a
// full character (a third seat at the table, with turns to manage) or did not
// exist, and the Turn Contract forbade the model from writing anyone else's
// words at all, so the leads could not so much as order a drink. A supporting
// cast member is one line in the prompt; whoever is speaking may voice them
// briefly inside their own turn. They are never given a turn, never a stop
// token, never a chip.
//
// Stored on the thread as `supportingCast`: `{ id, file }` for a character
// from the roster (its card is read fresh each prompt) or `{ id, name, note }`
// for a person typed in the chat.

const SUPPORTING_NOTE_MAX = 320;

/** "Dana: the bartender, Ada's ex" (or "Dana, the bartender…") → { name, note }. */
function parseSupportingPerson(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const m = t.match(/^([^:,.]{1,60}?)\s*[:,]\s*(.+)$/);
  if (m) return { name: m[1].trim(), note: m[2].trim() };
  return { name: t.slice(0, 60).trim(), note: '' };
}

/** At most `max` characters, cut at a sentence end when one sits in the second half, else at a word. */
function clipNote(text, max = SUPPORTING_NOTE_MAX) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  if (end > max * 0.5) return cut.slice(0, end + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim() + '...';
}

/**
 * The short cards the prompt gets: `[{ name, note }]`. A roster entry is read
 * from its character (tagline or first sentence, then how they speak); an
 * entry whose character is gone is left out. `roster` is the parsed
 * character list (scanCharacters).
 */
function supportingCastCards(entries, roster = []) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e) continue;
    if (e.file) {
      const c = roster.find((r) => r.fileName === e.file);
      if (!c) continue;
      const data = c.rawData || {};
      const sheet = sheetFromCharacter(data);
      const name = c.frontmatter?.name || data.name || e.file.replace(/\.(md|json)$/, '');
      const who = (sheet.tagline || (sheet.description || data.roleInstruction || '').split(/(?<=[.!?])\s/)[0] || '').trim();
      const voice = (sheet.voice || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
      out.push({ name, note: clipNote([who, voice ? `Speaks: ${voice.replace(/^speaks:?\s*/i, '')}` : ''].filter(Boolean).join(' ')) });
    } else if (e.name) {
      out.push({ name: String(e.name).trim(), note: clipNote(e.note || '') });
    }
  }
  return out;
}

/**
 * People from the cast's lives who are not in the scene: each cast
 * character's connections (Studio, Connected To: `studio.connections`,
 * `{ fileName, name, how }`), read fresh from the roster so an edited card
 * shows. One already at the table (cast) or in the scene (supporting cast)
 * is left out: they are known there. `[{ name, note }]`, the note from the
 * connected card: how the character stands to them, who they are, how they
 * look, in a few words.
 */
function connectedPeopleCards(characters, supportingCast = [], roster = []) {
  const present = new Set();
  for (const c of Array.isArray(characters) ? characters : []) if (c && c.fileName) present.add(c.fileName);
  for (const e of Array.isArray(supportingCast) ? supportingCast : []) if (e && e.file) present.add(e.file);
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(characters) ? characters : []) {
    const owner = c && (c.frontmatter?.name || c.rawData?.name || '');
    const conns = c && c.rawData && c.rawData.studio && Array.isArray(c.rawData.studio.connections) ? c.rawData.studio.connections : [];
    for (const k of conns) {
      if (!k || !k.fileName || present.has(k.fileName) || seen.has(k.fileName)) continue;
      const r = roster.find((x) => x.fileName === k.fileName);
      if (!r) continue;
      seen.add(k.fileName);
      const data = r.rawData || {};
      const sheet = sheetFromCharacter(data);
      const name = r.frontmatter?.name || data.name || k.name || k.fileName.replace(/\.(md|json)$/, '');
      const who = (sheet.tagline || (sheet.description || data.roleInstruction || '').split(/(?<=[.!?])\s/)[0] || '').trim();
      const look = (sheet.appearance || '').replace(/^[A-Z][\w ]{0,24}:\s*/, '').split(/(?<=[.!?])\s/)[0] || '';
      const stands = k.how && String(k.how).trim() ? `${owner || 'The character'}, to them: ${String(k.how).trim().replace(/\.$/, '')}.` : '';
      out.push({ name, note: clipNote([stands, who, look].filter(Boolean).join(' '), 420), file: k.fileName });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: SYSTEM PROMPT BUILDER (← openclawSystemPrompt.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build system prompt for multi-character threads with composable files.
 * Assembly order: Style → Character roster → Lore → Memory → Respond-as → Reminders → Response length
 */
function buildSystemPrompt(params = {}) {
  const {
    characters = [],
    writingPreset = 'immersive-rp',
    pov = '',
    loreContent = '',
    memoryContent = '',
    respondAs = null,
    userName = 'Anon',
    userDescription = '',
    responseLength = null,
    customStyleContent = '',
    sceneState = null, // M79 Phase 3a — auto-derived scene context
    // How people talk: the user's rules for dialogue (Settings › Dialogue
    // rules). Empty means none.
    dialogueRules = '',
    // People in the world who never take a turn: [{ name, note }].
    supportingCast = [],
    // People from the cast's lives who are not in the scene: [{ name, note }].
    connectedPeople = [],
  } = params;

  const parts = [];
  const castEntries = [];
  const characterReminders = [];

  // 0. Selected-speaker banner — the explicit user selection is the
  // source of truth for whose turn this is, and it gets stated at the
  // TOP of the prompt and reinforced near the BOTTOM (Active Turn
  // section). Redundant by design: small models drop signals when
  // they're stated only once. Trust the click; never derive turn
  // order from history.
  //
  // Speaker-unification (user-is-just-another-character): the
  // human orchestrating the chat sits OUTSIDE the fiction. Every
  // speaker in the message log — Anon, Ada, Narrator, anything —
  // is a character to the model. The banner therefore uses the
  // user's display name ("Anon") not the abstract role "the user",
  // and the same emphatic phrasing as every other speaker.
  let bannerName = null;
  if (respondAs === SELF_SPEAKER) {
    bannerName = userName || 'Anon';
  } else if (respondAs === NARRATOR_SPEAKER) {
    bannerName = 'Narrator';
  } else if (respondAs) {
    const respondChar = characters.find((c) =>
      c.fileName === respondAs || (c.frontmatter.name || '').toLowerCase() === String(respondAs).toLowerCase()
    );
    bannerName = respondChar
      ? (respondChar.frontmatter.name || respondChar.fileName.replace(/\.(md|json)$/, ''))
      : String(respondAs).replace(/\.(md|json)$/, '');
  }
  if (bannerName) {
    parts.push(`# YOU ARE WRITING THE NEXT TURN AS: ${bannerName}\nWrite a single reply in this character's voice only. Do not write for any other character.`);
  }

  // 1. Writing preset at the TOP — sets the shared writing framework.
  const presetContent = getPresetContent(writingPreset, customStyleContent);
  if (presetContent) {
    parts.push(['## Writing Style', presetContent].join('\n'));
  }

  // 1a. Point of view override — overrides any POV implied by the preset.
  const povContent = getPovContent(pov);
  if (povContent) {
    parts.push(['## Point of View', povContent].join('\n'));
  }

  // 1b. Universal formatting rules — applied to every prose preset. Concrete
  // anti-repetition is handled late, right before generation, with the
  // model's own recent outputs as input. Abstract "don't repeat" rules at
  // position 0 of the system prompt have negligible effect over long context.
  const isScreenplayFormat = writingPreset === 'screenplay' || pov === 'screenplay';
  if (writingPreset !== 'none' && !isScreenplayFormat) {
    parts.push([
      '## Formatting',
      '- **Dialogue always in double quotes**: Every spoken line must be wrapped in "straight double quotes". Never leave dialogue unquoted, italicised, or in single quotes. Inner thoughts go in *italics*; non-verbal actions stay in plain prose (or *italics* for casual-RP style).',
      '- **One character per turn**: Write only the active character\'s words, actions, and inner experience. Never write dialogue, thoughts, or narrated decisions for other characters or for the user.',
      '- **No em dashes**: never use em dashes or en dashes anywhere. Use commas, periods, or ellipses instead.',
    ].join('\n'));
  }

  // 1b2. How people talk. The owner was retyping this into every chat's
  // standing note: the model stated a character's values instead of showing
  // them ("values peace" became speeches about peace). The text is the user's
  // (Settings › Dialogue rules, shipped with a default); it reads as craft,
  // not as a format, so it rides for every preset but none.
  if (writingPreset !== 'none' && dialogueRules && dialogueRules.trim()) {
    parts.push(['## How People Talk', dialogueRules.trim()].join('\n'));
  }

  // 1b. User identity — description/role if provided by character config.
  if (userDescription) {
    parts.push(['## User Identity', `The user (${userName}) is described as: ${userDescription}`].join('\n'));
  }

  // 1c. Scene state — auto-derived structured channel (M79 Phase 3a).
  // ~50–100 tokens that orient the model on every turn: where, when,
  // what mood, who's present. Carries over from the previous turn
  // unless the model emitted a <scene-update/> tag.
  const sceneBlock = renderSceneStateBlock(sceneState);
  if (sceneBlock) {
    parts.push(['## Current Scene', sceneBlock].join('\n'));
  }

  // 1d. Scene-update emission instruction — tells the model how to
  // signal a scene change. Conditional on having at least an empty
  // scene-state object so we don't pollute the prompt for users who
  // disabled the feature.
  if (sceneState !== null) {
    parts.push([
      '## Scene Updates',
      'If the location, time of day, mood, or set of present characters changes in your next reply, emit ONE self-closing tag at the very end of your reply, on its own line:',
      '`<scene-update location="..." time="..." mood="..." present="Name1, Name2"/>`',
      'Only include attributes that actually changed. Omit the tag entirely if nothing changed. Never describe the tag in prose — it is a control signal and is stripped before display.',
    ].join('\n'));
  }

  // 2. Cast definitions — each character's full roleInstruction block.
  // Example dialogue is only included for the active speaker to save tokens in multi-char threads.
  for (const char of characters) {
    const name = char.frontmatter.name || char.fileName.replace(/\.(md|json)$/, '');
    const roleInstruction = char.sections.roleInstruction;
    const charParts = [];

    if (roleInstruction) {
      charParts.push(substituteVars(roleInstruction, name, userName));
    }
    // Only include example dialogue for the character who is about to speak,
    // or always if there's only one character (no need to scope).
    const isActiveSpeaker = characters.length <= 1 ||
      !respondAs ||
      respondAs === char.fileName ||
      (char.frontmatter.name || '').toLowerCase() === String(respondAs || '').toLowerCase();
    if (char.sections.exampleDialogue && isActiveSpeaker) {
      charParts.push('#### Example Dialogue\n' + substituteVars(char.sections.exampleDialogue, name, userName));
    }
    if (char.sections.reminder) {
      characterReminders.push(`- ${name}: ${substituteVars(char.sections.reminder, name, userName)}`);
    }

    castEntries.push(`### ${name}\n${charParts.join('\n\n')}`.trim());
  }

  if (castEntries.length > 0) {
    // With a memory, the cards are the start of the story, not its present:
    // a character married on the card may be divorced by now in this chat,
    // and the card is kept as it is for other stories. Said here and again
    // under the memory, so the model is never left to pick between the two.
    const castNote = memoryContent
      ? 'These are the characters as they were when this story began. What has changed since is under Conversation Memories, and where the two differ, the memory is the present.'
      : null;
    parts.push(['## Cast', ...(castNote ? [castNote] : []), ...castEntries].join('\n\n'));
  }

  // 2b. Supporting cast: in the scene, never at the table. The one exception
  // to "write for no one else": whoever is speaking may voice these people
  // briefly, inside their own turn, so the leads can talk to a bartender
  // without the bartender becoming a third character to manage.
  const supporting = (supportingCast || []).filter((p) => p && p.name);
  if (supporting.length > 0) {
    parts.push([
      '## Supporting Cast',
      'People in this world who never take a turn of their own. Whoever is writing the turn may give them a line or two inside it, in quotes, as part of the scene, in keeping with the note on each. They never get a `<<Name>>` block or a reply of their own, and they never carry the scene: the turn stays the active character\'s.',
      ...supporting.map((p) => `- ${p.name}${p.note ? `: ${substituteVars(p.note, p.name, userName)}` : ''}`),
    ].join('\n'));
  }

  // 2c. People in their lives: known to the characters, not in the scene.
  // The gamekeeper's lord, the lead's sister: named on a connected card the
  // user never has to retype. Spoken of, remembered, expected; if the story
  // brings one in, the Supporting Cast rule holds for them.
  const connected = (connectedPeople || []).filter((p) => p && p.name);
  if (connected.length > 0) {
    parts.push([
      '## People In Their Lives',
      'People the characters know who are not in this scene. They may be spoken of, remembered or expected, and what is said of them agrees with the note on each. If the story brings one of them into the scene, they are Supporting Cast from then on: a line or two inside the active character\'s turn, never a turn of their own.',
      ...connected.map((p) => `- ${p.name}${p.note ? `: ${substituteVars(p.note, p.name, userName)}` : ''}`),
    ].join('\n'));
  }

  // 3. Conversation contract.
  parts.push([
    '## Turn Contract',
    '- History is rendered with `<<Name>>` tags identifying each speaker. They are authoritative.',
    '- Write exactly one new turn, for the character named in the banner above and the Active Turn block below — and ONLY that character.',
    '- Never write, narrate, quote, or describe internal thoughts for any other character. If you find yourself starting to write a different `<<Name>>` block, STOP.',
    ...(supporting.length > 0 || connected.length > 0 ? [`- The one exception: the ${supporting.length > 0 ? 'Supporting Cast' : 'People In Their Lives'} listed ${supporting.length > 0 ? 'above' : 'above, once in the scene,'} may be given a line or two inside your turn. They are the only other people whose words you may write, and they never take the turn over.`] : []),
    '- Never prepend a speaker tag (no `<<Name>>`, no `Name:`); the interface adds the label automatically.',
    '- Character-specific instructions override the writing style preset when they conflict.',
    '- Quoted phrases in a character\'s voice notes ("Says: ...", "Might say: ...") show how they talk; they are examples, not lines to say. Use one rarely, never the same one twice in a scene, never to open a reply.',
  ].join('\n'));

  // 4. Lore — substitute {{char}}/{{user}} template vars.
  if (loreContent) {
    const primaryName = characters[0] ? (characters[0].frontmatter.name || characters[0].fileName.replace(/\.(md|json)$/, '')) : '';
    parts.push('## World & Lore\n' + substituteVars(loreContent, primaryName, userName));
  }

  // 5. Thread memory — substitute {{char}}/{{user}} template vars.
  if (memoryContent) {
    const primaryName = characters[0] ? (characters[0].frontmatter.name || characters[0].fileName.replace(/\.(md|json)$/, '')) : '';
    parts.push('## Conversation Memories\nWhat has happened in this chat so far. Where it differs from a character\'s description above, this is the present: the description is how things stood when the story began.\n\n' + substituteVars(memoryContent, primaryName, userName));
  }

  // 6. Active turn. Same shape for every speaker — the user-persona,
  // narrator, and named characters all get a "write the next turn as
  // X" instruction. Narrator keeps its prose-narration constraint
  // because that's a format difference, not a speaker-class
  // difference.
  if (respondAs === NARRATOR_SPEAKER) {
    parts.push([
      '## Active Turn',
      'It is the Narrator\'s turn.',
      'Write a third-person narrative continuation that advances the scene.',
      'Use pure prose narration — never prefix lines with character names followed by colons.',
      'Weave character actions, speech, and thoughts into natural flowing paragraphs.',
      'Do not write any character\'s next dialogue or make choices on their behalf.',
    ].join('\n'));
  } else if (bannerName) {
    parts.push([
      '## Active Turn',
      `It is ${bannerName}'s turn.`,
      `Write only ${bannerName}'s next turn.`,
      'Stay grounded in the current scene and react to the latest visible message.',
    ].join('\n'));
  }

  // 7. Response length instruction. Phrasing strengthened — "Keep your
  // response to X" was being treated as a soft suggestion by small
  // models. The directive language below is mandatory ("Reply with
  // exactly", "Stop after"). Length is also restated in the
  // consolidated late-stage system message + user-role stage
  // direction (see assembleContext) so it lands close to generation,
  // not just at the top of a long system prompt.
  if (responseLength === 'short') {
    parts.push('## Response Length\nReply with EXACTLY ONE paragraph. Do not write a second paragraph. Stop after the first paragraph break.');
  } else if (responseLength === 'medium') {
    parts.push('## Response Length\nReply with two or three paragraphs — no more, no fewer. Stop after the third paragraph break.');
  } else if (responseLength === 'long') {
    parts.push('## Response Length\nWrite a detailed response of four or more paragraphs. Lean into rich description and beat-by-beat pacing.');
  }

  // Reminders are returned separately for high-recency injection in assembleContext
  // (Perchance injects them right before the AI's next response, not in the system prompt)
  return {
    prompt: parts.join('\n\n'),
    reminders: characterReminders,
  };
}



// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: CONTEXT ASSEMBLY (← openclawContextEngine.ts)
// ═══════════════════════════════════════════════════════════════════════════════

function trimHistoryToBudget(messages, budgetTokens, method = 'dropOld', opts = {}) {
  const result = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i].content);
    if (used + t > budgetTokens) break;
    result.unshift(messages[i]);
    used += t;
  }
  const droppedCount = messages.length - result.length;
  // summarizeOld: prepend a real LLM-produced summary supplied by the caller.
  // No fake placeholder summary — if the caller didn't pass `opts.summary`,
  // dropped messages are simply dropped (which matches dropOld behaviour).
  if (method === 'summarizeOld' && droppedCount > 0 && opts.summary) {
    const summaryMsg = String(opts.summary);
    const summaryTokens = estimateTokens(summaryMsg);
    if (used + summaryTokens <= budgetTokens) {
      result.unshift({ role: 'system', content: summaryMsg });
    } else {
      // Trim the summary itself if even it doesn't fit.
      const trimmed = trimTextToBudget(summaryMsg, Math.max(0, budgetTokens - used));
      if (trimmed) result.unshift({ role: 'system', content: trimmed });
    }
  }
  return result;
}

/**
 * Compute which messages would be dropped if `trimHistoryToBudget` were
 * called with the same arguments. Used by the host to decide whether a
 * fresh LLM-generated summary is needed before the real assembly call.
 */
function computeDroppedMessages(messages, budgetTokens) {
  let used = 0;
  let kept = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i].content);
    if (used + t > budgetTokens) break;
    used += t;
    kept += 1;
  }
  return messages.slice(0, messages.length - kept);
}

/**
 * Stable, fast string hash (FNV-1a 32-bit) used to key the summarisation
 * cache against the actual content of dropped messages. Keying by count
 * alone left stale summaries lingering after deletes / edits / regenerates.
 */
function hashDroppedMessages(messages) {
  const joined = messages.map((m) => `${m.role}|${m.content || ''}`).join('\n---\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Assemble context for multi-character threads with composable files.
 * Supports: multiple characters, shared style file, shared reminders,
 * hiddenFrom filtering, and author→role mapping.
 */
function assembleContext(params) {
  const {
    characters = [],     // array of parsed character objects
    character = null,    // single character (backward compat)
    writingPreset = 'immersive-rp',
    pov = '',
    loreContent = '',
    memoryContent = '',
    history = [],
    userMessage = '',
    contextWindow = 8192,
    userName = 'Anon',
    respondAs = null,
    responseLength = null,
    settings = null,
    ephemeralInstruction = null,
    historySummary = '',
    sceneState = null, // M79 Phase 3a
    // Overhaul (M92): explicit per-thread overrides + persistent note.
    // Overrides sit ABOVE the per-character resolution — they are the
    // user's explicit "in this chat, do X" choice, so they win over
    // whatever the character card says. Empty string = no override.
    writingPresetOverride = '',
    responseLengthOverride = '',
    standingNote = '',
    // People in the world who never take a turn: [{ name, note }].
    supportingCast = [],
    // People from the cast's lives who are not in the scene: [{ name, note }].
    connectedPeople = [],
  } = params;

  // Support both old (single character) and new (characters array) signatures
  const chars = characters.length > 0 ? characters : (character ? [character] : []);
  const primaryChar = chars[0] || null;
  const budget = computeTokenBudget(contextWindow, settings);
  const extendedMemoryEnabled = primaryChar?.frontmatter?.extendedMemory === true;

  // Resolve the ACTIVE speaker character. Every speaker-specific
  // setting (writing preset, POV, length, fit method, voice anchor)
  // is sourced from this character — NOT from `primaryChar`. The
  // previous code used primaryChar for everything, which meant if a
  // thread had [Ada, Ben] and Ada was at index 0, asking Ben to
  // speak still used Ada's settings. Whatever the user explicitly
  // selected to speak is the source of truth.
  //
  // Returns null for SELF_SPEAKER (no persona configured), the
  // NARRATOR sentinel, or any speaker that doesn't match a known
  // character. Callers fall back to thread/global defaults in that
  // case — matching the legacy behaviour for those sentinels.
  let speakerChar = null;
  if (respondAs && respondAs !== SELF_SPEAKER && respondAs !== NARRATOR_SPEAKER) {
    speakerChar = chars.find((c) =>
      c.fileName === respondAs
      || (c.frontmatter?.name || '').toLowerCase() === String(respondAs).toLowerCase()
    ) || null;
  }

  // Per-speaker resolution: every override comes from speakerChar
  // first, with fallback to the value passed into assembleContext
  // (which already encodes thread / global defaults). Treating
  // these as four independent lookups instead of one merged blob
  // keeps the fallback chain visible at each callsite.
  const effectiveWritingPreset = writingPresetOverride || speakerChar?.frontmatter?.writingPreset || writingPreset;
  const effectivePov = speakerChar?.frontmatter?.pov || pov;

  // Split lore lane between lorebooks and thread memory proportional to content size.
  // If one is empty, the other gets the full allocation.
  // When extendedMemory is enabled, guarantee memory gets at least 40% of the lore budget.
  const rawLoreTokens = estimateTokens(loreContent);
  const rawMemTokens = estimateTokens(memoryContent);
  const rawTotal = rawLoreTokens + rawMemTokens;
  let loreBudget, memoryBudget;
  if (rawTotal === 0) {
    loreBudget = budget.lore;
    memoryBudget = 0;
  } else if (extendedMemoryEnabled && rawMemTokens > 0) {
    // Extended memory: guarantee memory at least 40% of the lore lane
    const proportionalMem = Math.floor(budget.lore * (rawMemTokens / rawTotal));
    const minMemBudget = Math.floor(budget.lore * 0.4);
    memoryBudget = Math.max(proportionalMem, minMemBudget);
    loreBudget = Math.max(0, budget.lore - memoryBudget);
  } else {
    memoryBudget = Math.max(0, Math.floor(budget.lore * (rawMemTokens / rawTotal)));
    loreBudget = Math.max(0, budget.lore - memoryBudget);
  }
  const loreTrimmed = trimTextToBudget(loreContent, loreBudget);
  const memTrimmed = trimTextToBudget(memoryContent, memoryBudget);

  // Extract user-facing settings — merge across all characters for multi-char threads
  const userDescParts = chars
    .map(c => c?.frontmatter?.userDescription || '')
    .filter(Boolean);
  const charUserDesc = userDescParts.join(' ');
  const userReminderParts = chars
    .map(c => c?.userReminder || c?.sections?.userReminder || '')
    .filter(Boolean);
  const charUserReminder = userReminderParts.join('\n');
  // Length resolution: explicit per-thread override > active speaker's
  // own cap > passed-in default (global settings). The override supports
  // the 'none' sentinel — "in this chat, explicitly NO length limit" —
  // which must short-circuit the fallbacks rather than falling through
  // to them (an empty string would).
  const charMsgLenLimit = speakerChar?.frontmatter?.messageLengthLimit || '';
  let effectiveResponseLength;
  if (responseLengthOverride === 'none') {
    effectiveResponseLength = null;
  } else if (responseLengthOverride) {
    effectiveResponseLength = responseLengthOverride;
  } else {
    effectiveResponseLength = charMsgLenLimit || responseLength;
  }

  const buildResult = buildSystemPrompt({
    characters: chars,
    writingPreset: effectiveWritingPreset,
    pov: effectivePov,
    loreContent: loreTrimmed,
    memoryContent: memTrimmed,
    respondAs,
    userName,
    userDescription: charUserDesc,
    responseLength: effectiveResponseLength,
    customStyleContent: settings?.customWritingStyle || '',
    sceneState, // M79 Phase 3a
    dialogueRules: settings?.dialogueRules || '',
    supportingCast,
    connectedPeople,
  });
  const systemPrompt = buildResult.prompt;
  const characterReminders = buildResult.reminders || [];

  // System-prompt overflow → borrow from history with a min floor so the
  // model is never starved of recent conversation. Surface a UI warning when
  // the floor is hit so the user knows their character is too long for the
  // chosen model + budget split.
  const charTokens = estimateTokens(systemPrompt);
  const floorResult = applyHistoryFloor(budget, charTokens);
  const historyBudget = floorResult.effectiveHistory;
  const warnings = [];
  if (floorResult.hitFloor) {
    warnings.push(
      `System prompt is ${charTokens}t but character lane is only ${budget.character}t. ` +
      `History was floored at ${historyBudget}t to fit. ` +
      `Trim the character description, raise context window, or increase Character %.`,
    );
  }
  if (rawLoreTokens > loreBudget && rawLoreTokens > 0) {
    warnings.push(
      `Lore content is ${rawLoreTokens}t but lore lane is ${loreBudget}t, so ${rawLoreTokens - loreBudget}t was truncated. ` +
      `Reduce lorebooks or increase Lore %.`,
    );
  }
  if (rawMemTokens > memoryBudget && memoryBudget > 0 && rawMemTokens > 0) {
    warnings.push(
      `Long-term memory is ${rawMemTokens}t but memory share is ${memoryBudget}t, so older entries will be cut. ` +
      `Enable Extended Memory or trim /mem.`,
    );
  }

  const messages = [{ role: 'system', content: systemPrompt }];

  // History — filter out hiddenFrom:"ai" messages, map author→role.
  //
  // Speaker encoding: small local models often miss the `Name: text`
  // convention (they treat the colon as decorative punctuation), which
  // is the root cause of "the AI writes for the wrong character" bugs.
  // We use `<<Name>>\ntext` instead — a delimiter the model can't
  // confuse with content. Strip-on-generation handles both the new
  // chevron form and the legacy colon form so existing chats keep
  // working without migration.
  const filteredHistory = history.filter(m => m.hiddenFrom !== 'ai');
  const mappedHistory = filteredHistory.map(m => {
    const role = mapAuthorToRole(m.author || m.role, m);
    // System messages get no name prefix
    if (role === 'system') {
      return { role, content: m.content };
    }
    // For the user's own messages (not playing-as-character), always inject the
    // CURRENT userName so the AI sees a consistent identity after a rename.
    const displayName = (m.author === 'user' && !m.characterFile) ? userName : m.name;
    return {
      role,
      content: displayName ? `<<${displayName}>>\n${m.content}` : m.content,
    };
  });

  // History-fit method follows the active speaker too. A character
  // who prefers summarised history can keep that preference even when
  // a different character is also in the thread.
  const fitMethod = speakerChar?.frontmatter?.fitMessagesInContextMethod
    || primaryChar?.frontmatter?.fitMessagesInContextMethod
    || settings?.defaultFitMethod
    || 'dropOld';
  messages.push(...trimHistoryToBudget(mappedHistory, historyBudget, fitMethod, { summary: historySummary }));

  // Build persona re-anchor + anti-repetition guard. Used inside the single
  // consolidated late-stage system message below — NOT pushed separately.
  let speakerLateAnchor = null;
  let speakerAvoidRepeat = null;
  if (respondAs && respondAs !== SELF_SPEAKER && respondAs !== NARRATOR_SPEAKER) {
    const respondChar = chars.find(c =>
      c.fileName === respondAs || (c.frontmatter.name || '').toLowerCase() === String(respondAs).toLowerCase()
    );
    if (respondChar) {
      const rName = respondChar.frontmatter.name || respondChar.fileName.replace(/\.(md|json)$/, '');
      // M79 Phase 3b — authored voice anchor wins over the legacy
      // 220-char description slice. If the character defines a
      // `voiceAnchor` (3–5 lines covering voice / signature phrases /
      // no-go phrases), use it directly. Otherwise fall back to up to
      // three description lines so we still ship a real anchor even
      // for legacy characters without the field.
      const authoredAnchor = (respondChar.frontmatter?.voiceAnchor || respondChar.sections?.voiceAnchor || '').trim();
      let anchorBody = '';
      if (authoredAnchor) {
        anchorBody = authoredAnchor;
      } else {
        const descLines = (respondChar.sections?.description || respondChar.frontmatter?.description || '')
          .split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3);
        anchorBody = descLines.join(' ');
      }
      // The anchor sits right before generation on every turn, so a quoted
      // phrase in it ("Says: 'noted'") was read as a line to say, and said,
      // scene after scene. Say what the quotes are. It also gave the voice as
      // a rule ("Stay strictly in X's voice"), and the model put every habit
      // in every line; given as a tendency, most of what they say is plain
      // (dialogue bench, 2026-10-08).
      const personaLine = anchorBody ? ` How ${rName} talks, as a tendency and not a rule for every line: most of what ${rName} says is plain, ordinary speech that answers what was just said, and these habits show now and then (quoted phrases show the register and are not lines to repeat: use one rarely, never twice in a scene, never to open a reply): ${anchorBody.slice(0, 400)}` : '';
      speakerLateAnchor = `[You are ${rName}. Sound like ${rName}. Do not write, quote, or describe internal thoughts for any other character. Do not write the user's words or actions.${personaLine}]`;

      // M79 Phase 3c — variation avoidance v2. Pull the last 5 outputs
      // by this speaker (was: 2), extract 3–5 word phrases, find the
      // ones that repeat across messages, and ask the model to avoid
      // them. Also keeps the prior opening-line guard since the
      // model's first sentence is the most-likely repetition target.
      const recentSelfOutputs = filteredHistory
        .filter(m => m.author === 'ai' && m.characterFile === respondChar.fileName)
        .slice(-5)
        .map(m => (m.content || '').trim())
        .filter(Boolean);

      if (recentSelfOutputs.length > 0) {
        const openings = recentSelfOutputs.slice(-2).map((text) => {
          const mm = text.match(/^[^.!?\n]{1,100}[.!?]?/);
          const opener = (mm ? mm[0] : text.slice(0, 100)).trim();
          return `— "${opener}"`;
        }).join('\n');

        const repeatedPhrases = _extractRepeatedPhrases(recentSelfOutputs, { n: [3, 4, 5], minOccurrences: 2, max: 8 });
        const phraseBlock = repeatedPhrases.length > 0
          ? '\nRecurring phrases to avoid this turn: ' + repeatedPhrases.map((p) => `"${p}"`).join('; ')
          : '';

        speakerAvoidRepeat =
          `[Vary your prose this turn. Do NOT echo the openings, phrasings, sentence shapes, or beats from your recent replies as ${rName}:\n${openings}${phraseBlock}\nUse fresh openings, different sentence rhythms, and unique imagery.]`;
      }
    }
  }

  // ── Single consolidated late-stage system message ──
  // Stacking 4–5 separate system messages right before the user turn caused
  // the model to treat them as boilerplate and ignore them. We now build
  // exactly ONE focused system message, in priority order:
  //   1) Active turn (who is speaking, what NOT to do)
  //   2) Persona re-anchor (you are X, voice constraint, persona recap)
  //   3) Reminders (character + user reminders)
  //   4) Vary-your-prose guard (with concrete recent openings)
  //   5) Ephemeral directive (slash-command instruction for THIS turn)
  // Empty sections are omitted. The result is one tight block that lands
  // right before generation — single high-attention spot, no competing noise.

  // 1) Active turn — selected character is the source of truth. Do NOT
  // try to derive the next speaker from history; trust the explicit
  // selection. The instruction is phrased to be unmistakable and
  // references the `<<Name>>` history delimiter the model has been
  // seeing on every prior turn.
  //
  // Speaker-unification (user-is-just-another-character): the human
  // typing is OUTSIDE the fiction. Every active turn — Anon, Ada,
  // Narrator — is "write a turn as <Name>", same shape every time.
  // No special "user-authored message" wording: the user persona
  // gets the same emphatic instruction as any character. The model
  // never needs to know whether the speaker is "the user" or "a
  // character"; both are just names.
  let activeTurnLine = null;
  let bannerName = null;
  if (respondAs === SELF_SPEAKER) {
    bannerName = userName || 'Anon';
  } else if (respondAs === NARRATOR_SPEAKER) {
    bannerName = 'Narrator';
  } else if (respondAs) {
    const respondChar = chars.find(c =>
      c.fileName === respondAs || (c.frontmatter.name || '').toLowerCase() === String(respondAs).toLowerCase()
    );
    bannerName = respondChar
      ? (respondChar.frontmatter.name || respondChar.fileName.replace(/\.(md|json)$/, ''))
      : String(respondAs).replace(/\.(md|json)$/, '');
  }

  if (bannerName) {
    const isNarrator = respondAs === NARRATOR_SPEAKER;
    if (isNarrator) {
      activeTurnLine = 'Active turn: Narrator. Write only the next narrative beat in prose. Do not write any character\'s spoken dialogue. Do not begin with a `<<Name>>` tag or any speaker prefix.';
    } else {
      activeTurnLine = `Active turn: ${bannerName}. Write ONLY ${bannerName}'s next turn. Do not write, narrate, quote, or describe internal thoughts for any other character. Do not begin your reply with \`<<${bannerName}>>\` or any speaker prefix — the interface adds the label automatically. If you start to write for any other character, STOP immediately.`;
    }
  }

  // 2) Persona re-anchor (only when speaker is a real character)
  let personaLine = null;
  if (speakerLateAnchor) {
    // strip the surrounding [ ] from the previously-built block; we'll wrap
    // the consolidated message in [ ] once at the end.
    personaLine = speakerLateAnchor.replace(/^\[/, '').replace(/\]$/, '');
  }

  // 3) Reminders (already collected above as `characterReminders`).
  if (charUserReminder) {
    characterReminders.push(`User reminder: ${charUserReminder}`);
  }
  let reminderBlock = null;
  if (characterReminders.length > 0) {
    reminderBlock = 'Reminders:\n' + characterReminders.map(r => r.replace(/^- /, '')).map(r => `- ${r}`).join('\n');
  }

  // 4) Vary-your-prose
  let varyBlock = null;
  if (speakerAvoidRepeat) {
    varyBlock = speakerAvoidRepeat.replace(/^\[/, '').replace(/\]$/, '');
  }

  // 4b) Standing director's note — a persistent per-thread instruction
  // that rides in the late-stage block on EVERY turn (unlike the
  // ephemeral directive, which is one-shot). This is the user's
  // always-on steering channel: "keep the pacing slow", "never speak
  // for my character", etc.
  let standingBlock = null;
  if (standingNote && standingNote.trim()) {
    standingBlock = 'Standing director\'s note (applies to every turn): ' + standingNote.trim();
  }

  // 5) Style & length reminder — compact restatement of the writing
  // preset summary + response-length directive, placed near the
  // generation point so small models don't lose track of the format
  // by the time they reply. The FULL preset still lives at the top
  // of the system prompt for orientation; this is the late-recency
  // anchor that actually shapes the next token.
  // Style hint must follow the same resolution as the full preset at the
  // top of the system prompt — it previously used the raw `writingPreset`
  // param, so a speaker character's own preset (or a thread override)
  // shaped the top of the prompt but NOT the late-recency anchor that
  // actually steers the next token.
  const styleHint = getStyleHint(effectiveWritingPreset);
  const lengthHint = getLengthHint(effectiveResponseLength);
  let styleLengthBlock = null;
  if (styleHint || lengthHint) {
    const pieces = [];
    if (styleHint) pieces.push(`Style: ${styleHint}`);
    if (lengthHint) pieces.push(lengthHint);
    styleLengthBlock = pieces.join('\n');
  }

  // 6) Ephemeral directive — kept LAST in the system block (closest to
  // the user turn = strongest attention). Strengthened phrasing so the
  // model treats it as mandatory rather than advisory. The user-side
  // duplicate below is the actual delivery vehicle; this is the
  // contextual hint.
  let directiveBlock = null;
  if (ephemeralInstruction) {
    directiveBlock =
      'DIRECTOR\'S NOTE FOR THIS TURN (mandatory — override defaults if needed): '
      + ephemeralInstruction;
  }

  const consolidatedSections = [activeTurnLine, personaLine, reminderBlock, standingBlock, styleLengthBlock, varyBlock, directiveBlock].filter(Boolean);
  if (consolidatedSections.length > 0) {
    messages.push({
      role: 'system',
      content: '[' + consolidatedSections.join('\n\n') + ']',
    });
  }

  // User message. Falls back to a strong synthetic stage-direction when the
  // user hasn't typed anything (e.g. shortcut button, /ai with no text,
  // regenerate). The old fallback was a useless "[Continue]" — we'd hand the
  // model the strongest role (user) with the weakest signal possible. Now
  // we put the active-turn intent directly on the user turn where it lands
  // hardest.
  if (userMessage) {
    // M79 instruction-following fix — the prior pipeline buried the
    // ephemeral directive in a system message BEFORE the user message,
    // and the user message tokens drowned it out. Append the directive
    // as an in-line stage direction at the END of the user turn so it
    // is the literal last text the model reads before generating. This
    // turned out to be the single biggest determinant of whether the
    // model follows /ai-style guidance.
    //
    // The same fix now applies to the active-turn signal — when the
    // user picks a character with no instructions, the active-turn
    // line is what we want the model to land on. Putting it inside
    // the user-turn text gives it the strongest position attention-wise.
    let content = userMessage;
    if (bannerName || lengthHint) {
      const turnDirParts = [];
      if (bannerName) {
        turnDirParts.push('Now write the next reply as ' + bannerName + ', and only ' + bannerName + '.');
      }
      if (lengthHint) {
        // Length lives in the same bracketed stage-direction as the
        // active-turn cue so the model can't separate "who speaks"
        // from "how long the reply is". Repeating it here (already
        // stated in the style-length block above) is intentional —
        // small models respond to redundancy in the final tokens.
        turnDirParts.push(lengthHint);
      }
      content += '\n\n[' + turnDirParts.join(' ') + ']';
    }
    if (ephemeralInstruction) {
      content +=
        '\n\n[Director\'s note for this turn (apply directly to the very next reply — NOT the response after, NOT a future scene): '
        + ephemeralInstruction
        + ']';
    }
    messages.push({ role: 'user', content });
  } else {
    // userMessage is empty — happens for `/ai <instruction>` typed as
    // the whole message, shortcut buttons, regenerate, and any other
    // path where the active turn is requested without new user text.
    //
    // The prior gate (`!messages.some(m => m.role === 'user')`) only
    // fired when history was devoid of user-role messages, which was
    // wrong: as soon as ANY past user message existed, the directive
    // never reached the user-role position, and got buried in the
    // system block where small models drop it. Fire unconditionally
    // now — the model needs a fresh user-role payload carrying the
    // active-turn signal + any director's note before every
    // generation, no matter what history looks like.
    let directive = '[Stage direction — not part of the story.';
    if (bannerName) {
      directive += ` Now write the next reply as ${bannerName}, and only ${bannerName}. Stay strictly in ${bannerName}'s voice. Do not write, narrate, or quote any other character. Do not begin with a \`<<${bannerName}>>\` tag or any speaker prefix.`;
    } else {
      directive += ' Now write the next message according to the active-turn instructions above.';
    }
    if (lengthHint) {
      directive += ` ${lengthHint}`;
    }
    if (ephemeralInstruction) {
      directive += ` DIRECTOR'S NOTE (mandatory, apply to this very turn): ${ephemeralInstruction}`;
    }
    directive += ']';
    messages.push({ role: 'user', content: directive });
  }

  return {
    messages,
    estimatedTokens: estimateTokens(messages.map((m) => m.content).join('\n')),
    budget,
    warnings,
    fitMethod,
    historyBudget,
    mappedHistory,
  };
}

/** Map message author to LLM API role. */
function mapAuthorToRole(author, msg) {
  if (author === 'ai' || author === 'assistant') return 'assistant';
  if (author === 'system') return 'system';
  // User playing-as-character: map to assistant so the LLM treats it
  // as character dialogue rather than user input.
  if (author === 'user' && msg?.characterFile) return 'assistant';
  return 'user';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: THREAD SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

async function createThread(fs, workspaceUri, characterFile, modelId) {
  const id = generateId();
  const settings = await loadSettings(fs, workspaceUri);
  const threadDir = await ensureNestedDirs(fs, workspaceUri, [
    '.parallx', 'extensions', 'text-generator', 'threads', id,
  ]);

  // Load character data to read per-character overrides for thread seeding
  let charData = null;
  try {
    const jsonName = characterFile.replace(/\.md$/, '.json');
    const charPath = resolveUri(workspaceUri, `${EXT_ROOT}/characters/${jsonName}`);
    const { content } = await fs.readFile(charPath);
    charData = JSON.parse(content);
  } catch {
    try {
      const mdPath = resolveUri(workspaceUri, `${EXT_ROOT}/characters/${characterFile}`);
      const { content } = await fs.readFile(mdPath);
      charData = parseFrontmatter(content).frontmatter;
    } catch { /* no character data available */ }
  }

  // Character-level overrides take precedence over global defaults
  const charUserName = charData?.userName || '';
  const charWritingPreset = charData?.writingPreset || '';

  const meta = {
    id,
    title: 'New Chat',
    characters: [{ file: characterFile, addedAt: Date.now() }],
    writingPreset: charWritingPreset || settings.defaultWritingPreset || 'immersive-rp',
    pov: charData?.pov || '',
    userName: charUserName || settings.userName || 'Anon',
    userPlaysAs: null,
    responseLength: settings.defaultResponseLength || null,
    temperatureOverride: null,
    maxTokensOverride: null,
    contextWindowOverride: null,
    modelId: modelId || settings.defaultModel || null,
    autoReply: true,
    writingPresetOverride: '',
    responseLengthOverride: '',
    standingNote: '',
    smartTurnOrder: false,
    supportingCast: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await fs.writeFile(resolveUri(threadDir, 'thread.json'), JSON.stringify(meta, null, 2));
  await fs.writeFile(resolveUri(threadDir, 'messages.jsonl'), '');
  return meta;
}

/**
 * M79 Phase 4b — fork a thread at a specific message index. Creates a
 * new thread that is a verbatim copy of the source up to (and
 * including) the message at `forkAtIndex`. The new thread inherits
 * all metadata (characters, writingPreset, model, scene state, etc.)
 * and gets `forkedFrom: { threadId, atIndex }` plus a title suffix so
 * it's obvious in the sidebar. Both threads remain independent
 * thereafter — there is no merge path.
 *
 * Returns the new thread metadata. Throws if the source thread is
 * missing or the fork index is out of range.
 */
async function forkThread(fs, workspaceUri, sourceThreadId, forkAtIndex) {
  if (!Number.isInteger(forkAtIndex) || forkAtIndex < 0) {
    throw new Error('forkThread: invalid fork index');
  }
  const sourceMeta = await loadThread(fs, workspaceUri, sourceThreadId);
  const sourceMessages = await readMessages(fs, workspaceUri, sourceThreadId);
  if (sourceMessages.length === 0) {
    throw new Error('forkThread: source thread has no messages to fork from');
  }
  // Inclusive slice: keep the fork point itself as the last message
  // in the new branch. Re-generation from the fork point produces a
  // genuinely alternative continuation.
  const upTo = Math.min(forkAtIndex + 1, sourceMessages.length);
  const copiedMessages = sourceMessages.slice(0, upTo);

  const newId = generateId();
  const newDir = await ensureNestedDirs(fs, workspaceUri, [
    '.parallx', 'extensions', 'text-generator', 'threads', newId,
  ]);

  // Build the forked thread metadata. We copy every field that
  // shapes generation so the fork behaves identically to the source
  // up to the divergence point — except `id`, `title`, timestamps,
  // and the new provenance pointer.
  const newMeta = {
    ...sourceMeta,
    id: newId,
    title: (sourceMeta.title || 'Chat') + ' (fork)',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    forkedFrom: { threadId: sourceThreadId, atIndex: forkAtIndex },
  };
  // Cached summary is keyed by message-hash; the fork has different
  // dropped-message content so the cached summary is stale. Clear it
  // so the next generation rebuilds the summary if needed.
  delete newMeta.cachedSummary;

  await fs.writeFile(resolveUri(newDir, 'thread.json'), JSON.stringify(newMeta, null, 2));
  // Replay messages.jsonl one per line so the on-disk format matches
  // an organically-grown thread (one append per message).
  const jsonl = copiedMessages.map((m) => JSON.stringify(m)).join('\n') + (copiedMessages.length > 0 ? '\n' : '');
  await fs.writeFile(resolveUri(newDir, 'messages.jsonl'), jsonl);

  // Copy structured memory files if present so the fork inherits the
  // same long-term context. New beats / facts accumulate independently
  // thereafter.
  for (const file of [MEMORY_SEMANTIC_FILE, MEMORY_EPISODIC_FILE, 'memories.md']) {
    try {
      const sourceUri = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${sourceThreadId}/${file}`);
      const { content } = await fs.readFile(sourceUri);
      if (content !== undefined && content !== null) {
        await fs.writeFile(resolveUri(newDir, file), content || '');
      }
    } catch { /* file may not exist — that's fine */ }
  }

  return newMeta;
}

async function loadThread(fs, workspaceUri, threadId) {
  const dir = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}`);
  const { content } = await fs.readFile(resolveUri(dir, 'thread.json'));
  const thread = JSON.parse(content);

  // Migration: characterFile (string) → characters (array)
  if (thread.characterFile && !thread.characters) {
    thread.characters = [{ file: thread.characterFile, addedAt: thread.createdAt || Date.now() }];
    delete thread.characterFile;
  }
  // Migration: old style/reminders → writingPreset
  if (thread.style && !thread.writingPreset) {
    const oldStyle = thread.style.replace('.md', '');
    thread.writingPreset = WRITING_PRESETS[oldStyle] ? oldStyle : 'immersive-rp';
    delete thread.style;
    delete thread.reminders;
  }
  // Ensure new fields have defaults
  if (!thread.characters) thread.characters = [];
  if (!thread.writingPreset) thread.writingPreset = 'immersive-rp';
  if (thread.userName === undefined) thread.userName = 'Anon';
  if (thread.userPlaysAs === undefined) thread.userPlaysAs = null;
  if (thread.responseLength === undefined) thread.responseLength = null;
  if (!Array.isArray(thread.lorebookFiles)) thread.lorebookFiles = [];
  if (thread.temperatureOverride === undefined) thread.temperatureOverride = null;
  if (thread.maxTokensOverride === undefined) thread.maxTokensOverride = null;
  if (thread.contextWindowOverride === undefined) thread.contextWindowOverride = null;
  if (thread.autoReply === undefined) thread.autoReply = true;
  // Overhaul (M92) — explicit per-chat overrides + standing note. Distinct
  // from the legacy seeded `writingPreset`/`responseLength` fields (which
  // were snapshots taken at creation and are deliberately NOT honored):
  // null/'' here means "inherit from character/global".
  if (thread.writingPresetOverride === undefined) thread.writingPresetOverride = '';
  if (thread.responseLengthOverride === undefined) thread.responseLengthOverride = '';
  if (thread.standingNote === undefined) thread.standingNote = '';
  if (thread.smartTurnOrder === undefined) thread.smartTurnOrder = false;
  if (!Array.isArray(thread.supportingCast)) thread.supportingCast = [];

  return thread;
}

async function listThreads(fs, workspaceUri) {
  const dir = resolveUri(workspaceUri, `${EXT_ROOT}/threads`);
  try {
    const entries = await fs.readdir(dir);
    const threads = [];
    for (const e of entries) {
      if (e.type === 2) {
        try { threads.push(await loadThread(fs, workspaceUri, e.name)); }
        catch (err) { console.warn('[TextGenerator] Skipped corrupted thread', e.name, err); }
      }
    }
    return threads.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

async function appendMessage(fs, workspaceUri, threadId, message) {
  const file = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/messages.jsonl`);
  // M79 message-IDs — every message gets a stable `id` on append so
  // memory provenance can later reference it. Mutates the caller's
  // object so the in-memory array used by the chat editor carries
  // the same id the file does.
  if (!message.id) message.id = generateId();
  const line = JSON.stringify(message);
  let existing = '';
  try { existing = (await fs.readFile(file)).content || ''; } catch { /* first msg */ }
  // Ensure newline separator — avoid corrupting last line if file lacks trailing newline
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(file, existing + separator + line);
}

async function rewriteMessages(fs, workspaceUri, threadId, messages) {
  const file = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/messages.jsonl`);
  // Persist EVERY field on the message rather than hand-picking a
  // subset. The prior hand-picked serialiser silently dropped any
  // newer field (notably `kind: 'ooc'` from M79 Phase 4a) every time
  // a single message was deleted or regenerated — silently
  // un-marking every OOC entry in the thread.
  //
  // We still normalise the bare-minimum compatibility fields so legacy
  // and post-migration loads converge on the same shape, but
  // everything else passes through verbatim.
  const serialized = messages
    .map((message) => {
      const normalised = {
        // Spread first so explicit fields below win on conflict.
        ...message,
        author: message.author || (message.role === 'assistant' ? 'ai' : message.role) || 'user',
        name: message.name ?? null,
        characterFile: message.characterFile ?? null,
        content: message.content || '',
        timestamp: message.timestamp || Date.now(),
        instruction: message.instruction ?? null,
        generatedBy: message.generatedBy || ((message.author || message.role) === 'user' ? 'human' : 'model'),
        hiddenFrom: message.hiddenFrom ?? null,
        expectsReply: message.expectsReply !== undefined ? message.expectsReply : true,
        variants: message.variants ?? null,
        variantIndex: message.variantIndex ?? null,
      };
      // Drop the legacy `role` alias if we just promoted it to author —
      // keeping both would re-confuse the loader's migration path.
      delete normalised.role;
      return JSON.stringify(normalised);
    })
    .join('\n');
  await fs.writeFile(file, serialized);
}

async function readMessages(fs, workspaceUri, threadId) {
  const file = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/messages.jsonl`);
  try {
    const { content } = await fs.readFile(file);
    if (!content.trim()) return [];
    let needsRewrite = false;
    const out = content.trim().split('\n').map((l) => {
      const msg = JSON.parse(l);
      // Migration: role → author
      if (msg.role && !msg.author) {
        msg.author = msg.role === 'assistant' ? 'ai' : msg.role;
        delete msg.role;
      }
      if (!msg.generatedBy) msg.generatedBy = msg.author === 'user' ? 'human' : 'model';
      if (msg.hiddenFrom === undefined) msg.hiddenFrom = null;
      if (!msg.name) {
        if (msg.author === 'user') msg.name = 'Anon';
        else if (msg.author === 'ai' && msg.characterFile) msg.name = msg.characterFile.replace(/\.(md|json)$/, '').replace(/-/g, ' ');
        else if (msg.author === 'system') msg.name = 'System';
      }
      // M79 — backfill stable IDs for any message that predates the
      // ID column. We persist the upgraded JSONL once so the next
      // load doesn't re-mutate the in-memory array. Memory provenance
      // (and therefore reliable delete-pruning) depends on these IDs.
      if (!msg.id) {
        msg.id = generateId();
        needsRewrite = true;
      }
      return msg;
    });
    if (needsRewrite) {
      // Fire-and-forget the persistence upgrade; the in-memory array
      // already carries the new IDs so the active session is correct
      // even if the rewrite races a concurrent edit (rewriteMessages
      // is idempotent on the full array we just produced).
      void rewriteMessages(fs, workspaceUri, threadId, out)
        .catch((err) => console.warn('[TextGenerator] Failed to backfill message IDs:', err));
    }
    return out;
  } catch {
    return [];
  }
}

async function readMemories(fs, workspaceUri, threadId) {
  try {
    const { content } = await fs.readFile(
      resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/memories.md`),
    );
    return content || '';
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7A: SCENE STATE (M79 Phase 3a)
// ═══════════════════════════════════════════════════════════════════════════════
//
// The scene state is a small structured channel stored on the thread:
//
//   thread.sceneState = {
//     location: string,  // e.g. "cafe", "park bench", "moon base"
//     time: string,      // e.g. "morning", "late evening", "winter night"
//     mood: string,      // e.g. "tense", "playful", "melancholy"
//     present: string[], // character names currently in-scene
//     updatedAt: number,
//   }
//
// The model auto-derives state by emitting a single tag at the end of
// its response:
//
//   <scene-update location="cafe" time="evening" mood="tense" present="Ada"/>
//
// `extractAndApplySceneUpdate` parses this tag (permissive — any attr
// order, single/double quotes, optional self-closer), strips it from
// the displayed message, and merges the parsed attrs into the prior
// state (so a partial update only changes named fields). If the AI
// forgets to emit the tag, state carries over unchanged.

const SCENE_TAG_REGEX = /<scene-update\b([^>]*?)\/?>/i;

function renderSceneStateBlock(sceneState) {
  if (!sceneState || typeof sceneState !== 'object') return '';
  const fields = [];
  if (sceneState.location) fields.push(`Location: ${sceneState.location}`);
  if (sceneState.time) fields.push(`Time: ${sceneState.time}`);
  if (sceneState.mood) fields.push(`Mood: ${sceneState.mood}`);
  if (Array.isArray(sceneState.present) && sceneState.present.length > 0) {
    fields.push(`Present: ${sceneState.present.join(', ')}`);
  }
  return fields.length > 0 ? fields.join('\n') : '';
}

function _parseSceneAttrs(attrText) {
  const out = {};
  // Permissive attribute parser: name=value or name="value" or name='value'.
  const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = attrRegex.exec(attrText)) !== null) {
    const key = m[1].toLowerCase();
    const value = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!value) continue;
    if (key === 'location' || key === 'time' || key === 'mood') {
      out[key] = value;
    } else if (key === 'present' || key === 'characters') {
      out.present = value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}

/**
 * Strip the `<scene-update .../>` tag from `text` and return the
 * cleaned text plus the parsed update. If no tag is present, the
 * cleaned text equals the input and the update is null.
 */
function extractSceneUpdate(text) {
  if (!text || typeof text !== 'string') return { cleaned: text || '', update: null };
  const m = text.match(SCENE_TAG_REGEX);
  if (!m) return { cleaned: text, update: null };
  const update = _parseSceneAttrs(m[1] || '');
  // Strip the tag (and at most one surrounding newline/space) so the
  // visible message doesn't carry stray whitespace where the tag was.
  const cleaned = text.replace(SCENE_TAG_REGEX, '').replace(/\n{3,}/g, '\n\n').trim();
  return { cleaned, update };
}

/**
 * Merge `update` into `prior` state. Only fields present in `update`
 * overwrite; missing fields carry over from `prior`. Empty-string
 * values are treated as "no change" (not a clear).
 */
function mergeSceneState(prior, update) {
  const next = { ...(prior && typeof prior === 'object' ? prior : {}) };
  if (!update || typeof update !== 'object') return next;
  for (const key of ['location', 'time', 'mood']) {
    if (typeof update[key] === 'string' && update[key].trim()) {
      next[key] = update[key].trim();
    }
  }
  if (Array.isArray(update.present) && update.present.length > 0) {
    next.present = update.present;
  }
  next.updatedAt = Date.now();
  return next;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7B: STRUCTURED MEMORY (M79 Phase 1)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Two files complement the legacy `memories.md`:
//
//   memory.semantic.jsonl  — durable facts ("what's true")
//     { id, text, category, confidence, createdAt, source }
//     category: relationship | trait | event | place | preference | other
//     source:   auto | user
//
//   memory.episodic.jsonl  — narrative beats ("what happened")
//     { id, summary, importance, messageRange, createdAt }
//     importance: 0..1 (drives recency-weighted retrieval)
//
// Auto-extract runs in the background after every N user-to-AI exchanges
// (see _maybeAutoExtractMemory in generateTurn's post-flow). The call is
// fire-and-forget and never blocks the user. Existing `memories.md` files
// are preserved verbatim and treated as additional semantic content.

const MEMORY_AUTOEXTRACT_EVERY_N_EXCHANGES = 6;
/** How many Timeline lines ride in every prompt. */
const MEMORY_TIMELINE_TAIL = 20;
const MEMORY_SEMANTIC_FILE = 'memory.semantic.jsonl';
const MEMORY_EPISODIC_FILE = 'memory.episodic.jsonl';
const MEMORY_CATEGORY_ORDER = ['relationship', 'trait', 'event', 'place', 'preference', 'other'];

function _memoryFileUri(workspaceUri, threadId, fileName) {
  return resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/${fileName}`);
}

async function _readJsonl(fs, uri) {
  try {
    const { content } = await fs.readFile(uri);
    if (!content) return [];
    const out = [];
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { out.push(JSON.parse(trimmed)); }
      catch { /* skip corrupt lines but keep the rest readable */ }
    }
    return out;
  } catch { return []; }
}

async function _appendJsonl(fs, uri, records) {
  if (!Array.isArray(records) || records.length === 0) return;
  let existing = '';
  try { existing = (await fs.readFile(uri)).content || ''; } catch { existing = ''; }
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const appended = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  try { await fs.writeFile(uri, existing + separator + appended); } catch (err) {
    console.warn('[TextGenerator] Failed to append memory record:', err);
  }
}

async function readSemanticMemory(fs, workspaceUri, threadId) {
  return _readJsonl(fs, _memoryFileUri(workspaceUri, threadId, MEMORY_SEMANTIC_FILE));
}

async function readEpisodicMemory(fs, workspaceUri, threadId) {
  return _readJsonl(fs, _memoryFileUri(workspaceUri, threadId, MEMORY_EPISODIC_FILE));
}

async function appendSemanticMemory(fs, workspaceUri, threadId, records) {
  await _appendJsonl(fs, _memoryFileUri(workspaceUri, threadId, MEMORY_SEMANTIC_FILE), records);
  await mergeThreadMemory(fs, workspaceUri, threadId, { facts: (records || []).map((r) => ({ category: r.category, text: r.text })) });
}

async function appendEpisodicMemory(fs, workspaceUri, threadId, records) {
  await _appendJsonl(fs, _memoryFileUri(workspaceUri, threadId, MEMORY_EPISODIC_FILE), records);
  await mergeThreadMemory(fs, workspaceUri, threadId, { beats: (records || []).map((r) => ({ text: r.summary || r.text })) });
}

/**
 * The thread's memory file, memories.md: Facts, Timeline and Notes. The
 * user opens and edits it; every prompt reads it; the extractor merges into
 * it and never overwrites a line. A thread still on the old shape (free
 * text plus the two JSON logs) is folded into the file the first time it
 * is read. See docs/CREATIONS_AI.md, "Roleplay memory".
 */
async function loadThreadMemory(fs, workspaceUri, threadId) {
  const raw = await readMemories(fs, workspaceUri, threadId);
  if (isMemoryMarkdown(raw)) return parseMemoryMarkdown(raw);
  const [semantic, episodic] = await Promise.all([
    readSemanticMemory(fs, workspaceUri, threadId),
    readEpisodicMemory(fs, workspaceUri, threadId),
  ]);
  const parts = memoryFromLegacy({ notes: raw, semantic, episodic });
  await saveThreadMemory(fs, workspaceUri, threadId, parts);
  return parts;
}
async function saveThreadMemory(fs, workspaceUri, threadId, parts) {
  try {
    await fs.writeFile(_memoryFileUri(workspaceUri, threadId, 'memories.md'), renderMemoryMarkdown(parts));
  } catch (err) {
    console.warn('[TextGenerator] Memory file not saved:', err);
  }
}
/** New facts or beats into the file, never over a line that is already there. */
async function mergeThreadMemory(fs, workspaceUri, threadId, { facts = [], beats = [] } = {}) {
  if (facts.length === 0 && beats.length === 0) return;
  const parts = await loadThreadMemory(fs, workspaceUri, threadId);
  await saveThreadMemory(fs, workspaceUri, threadId, mergeMemory(parts, { facts, beats }));
}

async function _rewriteJsonl(fs, uri, records) {
  // Rewrite a JSONL file from a (possibly filtered) array of records.
  // Empty array results in an empty file — readers treat that the
  // same as a missing file. Distinct from delete because the file
  // existing means "we already initialised structured memory for
  // this thread; new entries should append here."
  const serialized = records.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(uri, serialized);
}

/**
 * M79 hard-delete: prune any memory entries whose source IDs include
 * one of `deletedMessageIds`. Touches both semantic and episodic
 * files. Idempotent — repeated calls with the same IDs are a no-op.
 *
 * Rationale: when a user hard-deletes a message, anything derived
 * from it must also disappear. Auto-extracted facts are attributed
 * to their full extraction slice (see autoExtractMemoryBackground),
 * so deleting any message in a slice prunes all facts from that
 * slice — surviving content gets re-extracted on the next
 * extraction cycle. User-pinned entries are scoped to their single
 * source message and pruned the same way.
 *
 * Also clears `thread.cachedSummary` because the summary text was
 * synthesized from a now-incorrect message window and would
 * otherwise reintroduce the deleted content via the summarised-
 * history channel.
 */
/**
 * M79 consistency prune: read all current message IDs in the thread,
 * find any memory entries whose `sources` reference an ID that isn't
 * in the current history, and remove them. Catches the race where an
 * in-flight auto-extract finished writing facts with sources pointing
 * at a message the user just deleted.
 *
 * Cheap: two disk reads + an optional rewrite per call. Run after
 * every auto-extract completion as a self-healing guard.
 */
async function pruneOrphanMemory(fs, workspaceUri, threadId) {
  try {
    const messages = await readMessages(fs, workspaceUri, threadId);
    const liveIds = new Set(messages.map((m) => m.id).filter(Boolean));

    const orphanFilter = (entry) => {
      if (!entry || !Array.isArray(entry.sources) || entry.sources.length === 0) return true;
      // Keep if ANY listed source is still alive. Entries whose entire
      // source set is dead are orphans.
      return entry.sources.some((src) => liveIds.has(src));
    };

    const semantic = await readSemanticMemory(fs, workspaceUri, threadId);
    if (semantic.length > 0) {
      const kept = semantic.filter(orphanFilter);
      if (kept.length !== semantic.length) {
        await _rewriteJsonl(fs, _memoryFileUri(workspaceUri, threadId, MEMORY_SEMANTIC_FILE), kept);
      }
    }
    const episodic = await readEpisodicMemory(fs, workspaceUri, threadId);
    if (episodic.length > 0) {
      const kept = episodic.filter(orphanFilter);
      if (kept.length !== episodic.length) {
        await _rewriteJsonl(fs, _memoryFileUri(workspaceUri, threadId, MEMORY_EPISODIC_FILE), kept);
      }
    }
  } catch (err) {
    console.warn('[TextGenerator] Orphan memory prune failed:', err);
  }
}

async function pruneMemoryForDeletedMessages(fs, workspaceUri, threadId, deletedMessageIds) {
  if (!Array.isArray(deletedMessageIds) || deletedMessageIds.length === 0) return;
  const deletedSet = new Set(deletedMessageIds.filter(Boolean));
  if (deletedSet.size === 0) return;

  const intersects = (entry) => {
    if (!entry || !Array.isArray(entry.sources)) return false;
    for (const src of entry.sources) {
      if (deletedSet.has(src)) return true;
    }
    return false;
  };

  // Semantic — drop any entry whose sources includes a deleted id.
  try {
    const semantic = await readSemanticMemory(fs, workspaceUri, threadId);
    if (semantic.length > 0) {
      const kept = semantic.filter((e) => !intersects(e));
      if (kept.length !== semantic.length) {
        await _rewriteJsonl(fs, _memoryFileUri(workspaceUri, threadId, MEMORY_SEMANTIC_FILE), kept);
      }
    }
  } catch (err) {
    console.warn('[TextGenerator] Semantic memory prune failed:', err);
  }

  // Episodic — same rule.
  try {
    const episodic = await readEpisodicMemory(fs, workspaceUri, threadId);
    if (episodic.length > 0) {
      const kept = episodic.filter((e) => !intersects(e));
      if (kept.length !== episodic.length) {
        await _rewriteJsonl(fs, _memoryFileUri(workspaceUri, threadId, MEMORY_EPISODIC_FILE), kept);
      }
    }
  } catch (err) {
    console.warn('[TextGenerator] Episodic memory prune failed:', err);
  }

  // Invalidate the cached history summary — it was synthesized over a
  // message window that included the deleted content. Letting it
  // survive would smuggle the deleted text back into the model's
  // context via the summarised-history lane.
  try {
    await updateThreadMeta(fs, workspaceUri, threadId, { cachedSummary: null });
  } catch (err) {
    console.warn('[TextGenerator] Failed to clear cached summary on delete:', err);
  }
}

/**
 * Render the combined memory channel for injection. Returns a markdown
 * string with the legacy `memories.md`, then auto-extracted semantic
 * facts grouped by category, then episodic beats sorted by
 * `recency × importance` and trimmed to budget.
 */
function renderMemoryChannel({ legacyMemory = '', semantic = [], episodic = [], timeline = [], budgetTokens = Infinity }) {
  const parts = [];
  if (legacyMemory.trim()) parts.push(legacyMemory.trim());

  // Semantic — always-on facts grouped by category, deduped by exact text.
  if (semantic.length > 0) {
    const seen = new Set();
    const byCat = new Map();
    for (const entry of semantic) {
      if (!entry || typeof entry.text !== 'string') continue;
      const text = entry.text.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const cat = MEMORY_CATEGORY_ORDER.includes(entry.category) ? entry.category : 'other';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(text);
    }
    const semBlocks = [];
    for (const cat of MEMORY_CATEGORY_ORDER) {
      const items = byCat.get(cat);
      if (!items || items.length === 0) continue;
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      semBlocks.push(`**${label}:**\n` + items.map((t) => `- ${t}`).join('\n'));
    }
    if (semBlocks.length > 0) parts.push(semBlocks.join('\n\n'));
  }

  // Episodic — beat list sorted by recency × importance. Newer + more
  // important beats sit first. Trim to remaining budget greedily.
  if (episodic.length > 0) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const ranked = episodic
      .filter((e) => e && typeof e.summary === 'string' && e.summary.trim())
      .map((e) => {
        const ageDays = Math.max(0, (now - (e.createdAt || now)) / dayMs);
        const recency = 1 / (1 + ageDays * 0.1);
        const importance = typeof e.importance === 'number' ? e.importance : 0.5;
        return { ...e, _score: recency * importance };
      })
      .sort((a, b) => b._score - a._score);

    if (ranked.length > 0) {
      const beats = ranked.map((e) => `- ${e.summary.trim()}`);
      parts.push('**Earlier beats:**\n' + beats.join('\n'));
    }
  }

  // The Timeline's tail: the order things happened in this chat, oldest
  // first. It used to reach the model only under one fit method, so on the
  // default the sequence of events was gone as soon as old turns dropped out
  // of the window. Last, so a budget cut takes it before the facts.
  const tail = timeline.map((b) => String(b && (b.text || b) || '').trim()).filter(Boolean).slice(-MEMORY_TIMELINE_TAIL);
  if (tail.length > 0) {
    parts.push('**Timeline (oldest first, the last line is the most recent):**\n' + tail.map((t) => `- ${t}`).join('\n'));
  }

  const combined = parts.join('\n\n');
  return trimTextToBudget(combined, budgetTokens);
}

/**
 * Run the auto-extract LLM call against the most recent N exchanges.
 * Background, fire-and-forget. Writes any extracted facts/beats to the
 * two JSONL memory files. Caller controls *when* to fire (see the
 * MEMORY_AUTOEXTRACT_EVERY_N_EXCHANGES check in generateTurn).
 *
 * The model is asked to return structured JSON. Parse failure is
 * non-fatal — better to skip an extraction than to surface noise.
 */
async function autoExtractMemoryBackground({
  parallx, fs, workspaceUri, threadId, modelId, numCtx,
  recentMessages = [], existingSemantic = [],
}) {
  if (!parallx?.lm?.sendChatRequest || !modelId) return { ok: false, reason: 'no model' };
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) return { ok: false, reason: 'nothing to read' };

  // Render the recent chunk for the extractor with explicit speaker
  // names so it can attribute facts correctly.
  const transcript = recentMessages
    .filter((m) => m && m.content && m.hiddenFrom !== 'ai')
    .map((m) => {
      const name = m.name || (m.author === 'user' ? 'User' : m.author === 'ai' ? 'AI' : 'System');
      // A long message is cut in the middle: its start and end carry the most.
      const c = String(m.content);
      const text = c.length > 1600 ? `${c.slice(0, 1000)} […] ${c.slice(-500)}` : c;
      return `${name}: ${text}`;
    })
    .join('\n\n')
    // At most ~12k characters (~3k tokens), the newest kept, so the
    // instructions are never pushed out of a small context window: when they
    // were, the model went on with the roleplay and returned no JSON.
    .slice(-12000);
  if (!transcript.trim()) return { ok: false, reason: 'nothing to read' };

  // Build a compact list of existing facts so the model doesn't re-emit
  // duplicates on every run. Capped at the most recent 30 entries.
  const existingList = existingSemantic
    .slice(-30)
    .map((e) => `- ${e.text}`)
    .join('\n');

  const sysPrompt = [
    'You extract durable memory from roleplay chat.',
    'Return STRICT JSON with two arrays: `facts` and `beats`.',
    '',
    '`facts` — objects { text, category, confidence }.',
    `  category: one of ${MEMORY_CATEGORY_ORDER.join(', ')}.`,
    '  confidence: 0..1 (0.5 default; only raise it for explicitly stated facts).',
    '  Emit ONLY new facts not already in "Existing facts" below.',
    '  Examples of good facts:',
    '   • "Ada is left-handed and writes with her right when nervous."',
    '   • "The user goes by Alex and lives in Berlin."',
    '   • "Ada and the user agreed to meet at the café on Tuesday."',
    '',
    '`beats` — objects { summary, importance }.',
    '  importance: 0..1 (0.3 mundane chitchat, 0.7 decision/revelation, 0.9 turning point).',
    '  Emit at most 3 beats covering only what materially happened.',
    '  Examples of good beats:',
    '   • { summary: "User confessed they had been lying about their name.", importance: 0.9 }',
    '   • { summary: "Ada and the user fled the burning library together.", importance: 0.8 }',
    '',
    'Output JSON only — no prose, no fences, no commentary.',
    'If nothing new happened, return: { "facts": [], "beats": [] }',
  ].join('\n');

  const userPrompt = [
    existingList ? `Existing facts:\n${existingList}\n\n` : '',
    'Recent exchange:',
    transcript,
  ].join('');

  try {
    const stream = parallx.lm.sendChatRequest(modelId, [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.2, maxTokens: 1500, think: false, format: 'json', ...(numCtx ? { numCtx } : {}) });
    let raw = '';
    for await (const chunk of stream) {
      if (chunk?.content) raw += chunk.content;
    }

    // Models wrap the JSON in prose, fences or a thinking block, or run out
    // of tokens part way; parseExtractionReply takes what is there. It used
    // to JSON.parse the whole reply and drop it silently on any of those.
    const parsed = parseExtractionReply(raw);
    if (!parsed) {
      console.warn('[TextGenerator] Memory extract: the model returned no JSON. Reply began:', raw.slice(0, 200));
      const said = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
      return { ok: false, reason: said ? `the model answered without JSON ("${said}${raw.trim().length > 80 ? '…' : ''}")` : 'the model returned nothing' };
    }
    const { facts, beats } = parsed;

    // M79 memory provenance — every emitted fact/beat records the
    // message IDs of the slice it was extracted from. The autoextractor
    // is a black box (we can't tell which fact came from which exact
    // message), so we conservatively attribute every emitted entry to
    // the FULL source slice. On delete, pruning a fact whose sources
    // include the deleted message is the user-correct behaviour:
    // "delete means the AI forgets, even if it forgets things derived
    // from neighbouring messages too." Occasional false-positive
    // pruning is acceptable; the next auto-extract re-emits surviving
    // facts from the surviving messages.
    const sliceSourceIds = recentMessages
      .map((m) => m?.id)
      .filter((id) => typeof id === 'string' && id.length > 0);

    const now = Date.now();
    const factRecords = facts
      .map((f) => {
        if (!f || typeof f.text !== 'string' || !f.text.trim()) return null;
        return {
          id: generateId(),
          text: f.text.trim(),
          category: MEMORY_CATEGORY_ORDER.includes(f.category) ? f.category : 'other',
          confidence: typeof f.confidence === 'number'
            ? Math.max(0, Math.min(1, f.confidence))
            : 0.5,
          createdAt: now,
          source: 'auto',
          sources: sliceSourceIds, // M79 provenance for delete-pruning
        };
      })
      .filter(Boolean);

    const beatRecords = beats
      .map((b) => {
        if (!b || typeof b.summary !== 'string' || !b.summary.trim()) return null;
        return {
          id: generateId(),
          summary: b.summary.trim(),
          importance: typeof b.importance === 'number'
            ? Math.max(0, Math.min(1, b.importance))
            : 0.5,
          createdAt: now,
          sources: sliceSourceIds, // M79 provenance for delete-pruning
        };
      })
      .filter(Boolean);

    if (factRecords.length > 0) {
      await appendSemanticMemory(fs, workspaceUri, threadId, factRecords);
    }
    if (beatRecords.length > 0) {
      await appendEpisodicMemory(fs, workspaceUri, threadId, beatRecords);
    }
    // M79 race-guard — an in-flight extract may have written facts
    // with sources pointing at a message the user deleted while we
    // were busy. Self-heal by pruning any entry whose entire source
    // set is now orphaned. Cheap; runs once per extract completion.
    await pruneOrphanMemory(fs, workspaceUri, threadId);
    return { ok: true, facts: factRecords.length, beats: beatRecords.length };
  } catch (err) {
    console.warn('[TextGenerator] Memory auto-extract failed:', err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

async function updateThreadMeta(fs, workspaceUri, threadId, updates) {
  const thread = await loadThread(fs, workspaceUri, threadId);
  Object.assign(thread, updates, { updatedAt: Date.now() });
  const dir = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}`);
  await fs.writeFile(resolveUri(dir, 'thread.json'), JSON.stringify(thread, null, 2));
  return thread;
}

async function deleteThread(fs, workspaceUri, threadId) {
  const dir = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}`);
  try {
    // Delete all files in the thread directory
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      await fs.delete(resolveUri(dir, entry.name));
    }
    // Delete the directory itself
    await fs.delete(dir);
  } catch { /* thread may already be gone */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7D: ACTIVE GENERATION REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════
//
// Editor panes are DISPOSED on every tab switch (editorGroupView tears the
// active pane down and rebuilds it on return). Generations must survive
// that: the stream itself keeps running inside the starting pane's
// closure, so the SHARED state (in-flight flag, stop signal, transient
// text) lives here, keyed by thread id. A remounted pane re-attaches by
// registering a listener — the stream resumes on screen mid-sentence,
// Stop works from any pane, and duplicate sends stay blocked.

const _activeGenerations = new Map();

function getGenState(threadId) {
  let g = _activeGenerations.get(threadId);
  if (!g) {
    g = { isGenerating: false, stopRequested: false, transient: null, listeners: new Set() };
    _activeGenerations.set(threadId, g);
  }
  return g;
}

/** kind: 'chunk' (transient text advanced) | 'state' (started / finished). */
function notifyGen(g, kind) {
  for (const listener of [...g.listeners]) {
    try { listener(kind); } catch (err) { console.warn('[TextGenerator] Generation listener failed:', err); }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Single-select control that uses the workbench's themed dropdown
 * primitive (api.ui.createDropdown — the same .ui-dropdown the core UI
 * uses) instead of a native <select>, whose popup list is drawn by
 * Chromium and cannot be themed. Falls back to a native <select> when
 * the host predates the API (also the headless-test path).
 *
 * Returns a uniform facade: { element, value (get/set), setItems(list) }.
 * `items` are { value, label } pairs. `layout`: 'inline' | 'flex' |
 * 'full' | 'ctx' — maps to the tg-dd-- wrapper classes.
 */
function tgSelect(parallx, { className = '', layout = 'full', title = '', items = [], value = '', onChange = null } = {}) {
  if (parallx?.ui?.createDropdown) {
    const host = el('span', `tg-dd tg-dd--${layout}`);
    if (title) host.title = title;
    const dd = parallx.ui.createDropdown(host, { items, selected: value });
    if (onChange) dd.onDidChange(onChange);
    return {
      element: host,
      get value() { return dd.value ?? ''; },
      set value(v) { dd.value = v; },
      setItems(list) { dd.setItems(list); },
    };
  }
  const sel = el('select', className);
  if (title) sel.title = title;
  const fill = (list) => {
    sel.innerHTML = '';
    for (const it of list) {
      const o = el('option', null, { text: it.label });
      o.value = it.value;
      sel.appendChild(o);
    }
  };
  fill(items);
  if (value !== undefined) sel.value = value;
  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  return {
    element: sel,
    get value() { return sel.value; },
    set value(v) { sel.value = v; },
    setItems: fill,
  };
}

function el(tag, className, attrs) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    }
  }
  return e;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════

let _refreshSidebar = null;

function renderSidebar(container, parallx) {
  injectStyles();

  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;

  const root = el('div', 'tg-sidebar');
  container.appendChild(root);

  // ── Search bar ──
  const searchWrap = el('div', 'tg-search-wrap');
  searchWrap.innerHTML = icon('search', 14);
  const searchInput = el('input', 'tg-search');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search chats\u2026';
  searchWrap.appendChild(searchInput);
  root.appendChild(searchWrap);

  // ── Nav links ──
  const nav = el('div', 'tg-nav');

  function navItem(iconName, label, command) {
    const item = el('div', 'tg-nav-item');
    item.innerHTML = icon(iconName, 14);
    const lbl = el('span', 'tg-nav-item-label', { text: label });
    item.appendChild(lbl);
    const chevron = el('span', 'tg-chevron');
    chevron.innerHTML = icon('chevron-right', 12);
    item.appendChild(chevron);
    item.addEventListener('click', () => parallx.commands.executeCommand(command));
    return item;
  }

  nav.appendChild(navItem('home', 'Home', 'textGenerator.openHome'));
  nav.appendChild(navItem('users', 'Characters', 'textGenerator.openCharacters'));
  nav.appendChild(navItem('book-open', 'Stories', 'textGenerator.openStories'));
  nav.appendChild(navItem('dices', 'Tables', 'textGenerator.openTables'));
  nav.appendChild(navItem('settings', 'Settings', 'textGenerator.openSettings'));
  root.appendChild(nav);

  if (!fs || !workspaceUri) {
    root.appendChild(el('div', 'tg-empty', { text: 'Open a workspace to get started.' }));
    return { dispose() { container.innerHTML = ''; } };
  }

  // ── Chat section header ──
  const chatHeader = el('div', 'tg-chat-section-header');
  chatHeader.innerHTML = icon('message-circle', 12);
  const chatLabel = el('span', null, { text: 'Chats' });
  const chatCount = el('span', 'tg-count');
  chatHeader.append(chatLabel, chatCount);
  root.appendChild(chatHeader);

  // ── Chat list ──
  const chatList = el('div', 'tg-chat-list');
  root.appendChild(chatList);

  // ── New Chat button ──
  const newChatBtn = el('button', 'tg-new-chat-btn');
  newChatBtn.innerHTML = icon('plus', 14) + ' <span>New Chat</span>';
  newChatBtn.addEventListener('click', () => parallx.commands.executeCommand('textGenerator.newChat'));
  root.appendChild(newChatBtn);

  let allThreads = [];
  let _charNameMap = {};

  function renderChatList(filter) {
    chatList.innerHTML = '';
    const filtered = filter
      ? allThreads.filter((t) => {
          const q = filter.toLowerCase();
          const characterNames = (t.characters || []).map((c) => _charNameMap[c.file] || c.file || '').join(' ');
          return (t.title || '').toLowerCase().includes(q) ||
                 characterNames.toLowerCase().includes(q);
        })
      : allThreads;

    chatCount.textContent = ` ${filtered.length}`;

    if (filtered.length === 0) {
      chatList.appendChild(el('div', 'tg-empty', {
        text: filter ? 'No matching chats' : 'No conversations yet',
      }));
      return;
    }

    for (const th of filtered) {
      const row = el('div', 'tg-chat-row');
      const info = el('div', 'tg-chat-row-info');
      info.appendChild(el('div', 'tg-chat-row-title', { text: th.title || 'Untitled' }));
      const charLabel = (th.characters || [])
        .map((c) => {
          const name = _charNameMap[c.file];
          if (name) return capitalize(name);
          return capitalize((c.file || '').replace(/\.(md|json)$/, '').replace(/-/g, ' '));
        })
        .filter(Boolean)
        .join(', ');
      const ago = formatTimeAgo(th.updatedAt);
      const meta = [charLabel, ago].filter(Boolean).join(' \u00B7 ');
      if (meta) info.appendChild(el('div', 'tg-chat-row-meta', { text: meta }));
      row.appendChild(info);

      const delBtn = el('button', 'tg-chat-row-delete');
      delBtn.innerHTML = icon('trash', 13);
      delBtn.title = 'Delete chat';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const choice = await parallx.window.showWarningMessage(`Delete the chat "${th.title || 'Untitled'}"? This cannot be undone.`, { title: 'Delete' });
        if (!choice || choice.title !== 'Delete') return;
        await deleteThread(fs, workspaceUri, th.id);
        refresh();
      });
      row.appendChild(delBtn);

      row.addEventListener('click', () => {
        parallx.editors.openEditor({
          typeId: 'text-generator-chat',
          title: th.title,
          icon: 'message-circle',
          instanceId: th.id,
        });
      });
      chatList.appendChild(row);
    }
  }

  searchInput.addEventListener('input', () => renderChatList(searchInput.value.trim()));

  async function refresh() {
    const [threads, chars] = await Promise.all([
      listThreads(fs, workspaceUri),
      scanCharacters(fs, workspaceUri),
    ]);
    allThreads = threads;
    _charNameMap = {};
    for (const ch of chars) {
      _charNameMap[ch.fileName] = ch.frontmatter.name || ch.fileName.replace(/\.(md|json)$/, '');
    }
    renderChatList(searchInput.value.trim());
  }

  _refreshSidebar = refresh;
  refresh();

  const watcher = parallx.workspace.onDidFilesChange?.((events) => {
    if (events.some((e) => e.uri.includes('/text-generator/'))) refresh();
  });

  return {
    dispose() {
      container.innerHTML = '';
      _refreshSidebar = null;
      watcher?.dispose?.();
    },
  };
}

function capitalize(str) {
  if (!str) return str;
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: CHAT EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

function renderChatEditor(container, parallx, input) {
  injectStyles();

  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  const threadId = input?.instanceId || input?.id;

  const root = el('div', 'tg-chat');
  container.appendChild(root);

  if (!fs || !workspaceUri || !threadId) {
    root.appendChild(el('div', 'tg-empty', { text: 'Error: missing workspace or thread.' }));
    return { dispose() { container.innerHTML = ''; } };
  }

  const toolbar = el('div', 'tg-chat-toolbar');
  const modelLabel = el('span', 'tg-chat-toolbar-label', { text: 'Model' });
  const modelSelect = tgSelect(parallx, {
    className: 'tg-chat-toolbar-select',
    layout: 'inline',
    onChange: (v) => {
      selectedModelId = v || null;
      // Auto's size is the model's, so it follows the model.
      void refreshCtxAutoLabel();
      if (thread && selectedModelId) {
        surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, { modelId: selectedModelId }), parallx, 'model selection');
      }
    },
  });
  // Per-thread context-window override picker. Lives next to the model
  // dropdown so users can pick a heavier model + clamp the context to
  // keep KV cache in VRAM. 0 = Auto clears the override.
  async function refreshCtxAutoLabel() {
    const rawId = selectedModelId || thread?.modelId || null;
    const modelId = (rawId && models.some(m => m.id === rawId)) ? rawId : models[0]?.id;
    const settingsDefault = Number(currentSettings?.defaultContextWindow) || 0;
    const auto = resolveContextWindow({ settingsDefault, modelLength: settingsDefault > 0 ? 0 : await modelContextLength(modelId) });
    const value = ctxSelect.value;
    ctxSelect.setItems(CTX_WINDOW_PRESETS.map((p) => ({ value: String(p.value), label: p.value === 0 ? `Auto (${ctxSizeLabel(auto)})` : p.label })));
    ctxSelect.value = value;
  }
  const ctxLabel = el('span', 'tg-chat-toolbar-label', { text: 'Ctx' });
  const ctxSelect = tgSelect(parallx, {
    className: 'tg-chat-toolbar-select',
    layout: 'inline',
    title: 'Context window for this thread: sets both the token budget and Ollama num_ctx (lower = faster, less VRAM)',
    items: CTX_WINDOW_PRESETS.map((p) => ({ value: String(p.value), label: p.label })),
    onChange: (raw) => {
      const v = Number(raw) || 0;
      if (thread) {
        thread.contextWindowOverride = v > 0 ? v : null;
        void refreshCtxAutoLabel();
        surfaceSaveError(
          updateThreadMeta(fs, workspaceUri, threadId, { contextWindowOverride: thread.contextWindowOverride }),
          parallx,
          'context window',
        );
      }
    },
  });

  const spacer = el('span', 'tg-chat-toolbar-spacer');
  const summaryEl = el('span', 'tg-chat-toolbar-charname');
  const tokenCountEl = el('span', 'tg-token-count');
  const viewPromptBtn = el('button', 'tg-chat-toolbar-btn', { html: icon('eye', 16) });
  viewPromptBtn.title = 'Inspect prompt: see exactly what the model receives';
  // M79 Phase 5 — Scene state edit panel toggle. The AI emits scene
  // updates via the `<scene-update/>` tag (M79 Phase 3a) and they're
  // auto-stored on `thread.sceneState`; this button lets the user view
  // and override the current scene without having to drop into the
  // thread JSON.
  const sceneBtn = el('button', 'tg-chat-toolbar-btn', { html: icon('map', 16) });
  sceneBtn.title = 'View / edit scene state';
  // The memory file, opened in the editor: Facts, Timeline, Notes. What the
  // model must not forget, in the user's hands.
  const memoryBtn = el('button', 'tg-chat-toolbar-btn', { html: icon('brain', 16) });
  memoryBtn.title = 'Memory: the facts and timeline this chat keeps';
  memoryBtn.setAttribute('aria-label', 'Memory');
  const openMemoryFile = async () => {
    try {
      await loadThreadMemory(fs, workspaceUri, threadId);
      await parallx.editors.openFileEditor(_memoryFileUri(workspaceUri, threadId, 'memories.md'));
    } catch (err) {
      console.warn('[TextGenerator] Could not open the memory file:', err);
    }
  };
  // The Memory panel beside the chat: what this chat keeps, read from
  // memories.md (the file stays the source of truth; Open edits it).
  const memoryPanel = el('aside', 'cr-memory');
  memoryPanel.setAttribute('aria-label', 'Memory');
  const memHead = el('div', 'cr-memory-head');
  memHead.appendChild(el('span', 'cr-memory-title', { html: `${icon('brain', 15)}<span>Memory</span>` }));
  const memOpen = el('button', 'cr-memory-open', { text: 'Open memories.md' });
  memOpen.type = 'button';
  memOpen.addEventListener('click', () => void openMemoryFile());
  // Read the recent chat now instead of waiting for the next extraction.
  const memUpdate = el('button', 'cr-memory-open', { text: 'Update Now' });
  memUpdate.type = 'button';
  memUpdate.title = 'Read the recent chat now and add what it should remember';
  memUpdate.addEventListener('click', async () => {
    memUpdate.disabled = true;
    memUpdate.textContent = 'Updating…';
    try {
      const r = await _maybeAutoExtractMemory({ force: true });
      if (!r) showToast('Nothing to read yet, or an update is already running.');
      else if (!r.ok) showToast(`Memory not updated: ${r.reason}.`);
      else if (!r.facts && !r.beats) showToast('Nothing new to remember.');
      else showToast(`Memory updated: ${r.facts} ${r.facts === 1 ? 'fact' : 'facts'}, ${r.beats} ${r.beats === 1 ? 'beat' : 'beats'}.`);
      void renderMemoryPanel();
    } finally {
      memUpdate.disabled = false;
      memUpdate.textContent = 'Update Now';
    }
  });
  const memActions = el('span', 'cr-memory-actions');
  memActions.append(memUpdate, memOpen);
  memHead.appendChild(memActions);
  memoryPanel.appendChild(memHead);
  let memTab = 'facts';
  const memSeg = parallx.ui?.createSegmented
    ? parallx.ui.createSegmented(memoryPanel, { ariaLabel: 'Memory section', items: [{ value: 'facts', label: 'Facts' }, { value: 'timeline', label: 'Timeline' }, { value: 'notes', label: 'Notes' }], value: memTab, onChange: (v) => { memTab = v; void renderMemoryPanel(); } })
    : null;
  memSeg?.element.classList.add('cr-memory-seg');
  const memList = el('div', 'cr-memory-list');
  memoryPanel.appendChild(memList);
  memoryPanel.appendChild(el('div', 'cr-memory-hint', { html: `${icon('pin', 13)}<span>Pin a message to remember it</span>` }));
  let memoryOpen = false;
  try { memoryOpen = localStorage.getItem('creations.memoryPanel') === '1'; } catch { memoryOpen = false; }
  async function renderMemoryPanel() {
    if (!memoryOpen) return;
    let parts = { facts: [], beats: [], notes: '' };
    try { parts = await loadThreadMemory(fs, workspaceUri, threadId); } catch { /* empty */ }
    const items = memTab === 'facts' ? parts.facts.map((f) => f.text)
      : memTab === 'timeline' ? parts.beats.map((b) => b.text)
        : String(parts.notes || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    memList.replaceChildren();
    if (!items.length) {
      memList.appendChild(el('div', 'cr-memory-empty', { text: memTab === 'facts' ? 'No facts yet. They gather as the chat goes on.' : memTab === 'timeline' ? 'No beats yet.' : 'No notes. Open memories.md to write some.' }));
      return;
    }
    for (const text of (memTab === 'timeline' ? items.slice(-40).reverse() : items.slice(0, 60))) {
      memList.appendChild(el('div', 'cr-memory-item', { text }));
    }
  }
  function setMemoryOpen(open) {
    memoryOpen = open;
    memoryPanel.style.display = open ? '' : 'none';
    memoryBtn.classList.toggle('tg-chat-toolbar-btn--active', open);
    memoryBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    try { localStorage.setItem('creations.memoryPanel', open ? '1' : '0'); } catch { /* per-viewer nicety */ }
    if (open) void renderMemoryPanel();
  }
  memoryBtn.addEventListener('click', () => setMemoryOpen(!memoryOpen));
  // Who you are talking to: their portraits and names, the chat's title under them.
  const chatHead = el('div', 'cr-chat-head');
  const chatHeadFaces = el('div', 'cr-chat-faces');
  const chatHeadText = el('div', 'cr-chat-head-text');
  const chatHeadName = el('div', 'cr-chat-head-name');
  chatHeadText.append(chatHeadName, summaryEl);
  chatHead.append(chatHeadFaces, chatHeadText);
  toolbar.append(chatHead, spacer, modelLabel, modelSelect.element, ctxLabel, ctxSelect.element, tokenCountEl, memoryBtn, sceneBtn, viewPromptBtn);
  root.appendChild(toolbar);
  // Now: where and when the scene stands, one line; click to edit it.
  const nowStrip = el('button', 'cr-now');
  nowStrip.type = 'button';
  nowStrip.title = 'Edit the scene';
  nowStrip.style.display = 'none';
  root.appendChild(nowStrip);

  // ── Scene state panel (collapsible) ──
  // Editable inline so the user can fix a confused scene without scrolling
  // through the AI's last response. Closed by default; saves on field
  // blur (no explicit "save" button — same pattern as other meta edits).
  const scenePanel = el('div', 'tg-scene-panel');
  scenePanel.style.display = 'none';
  const sceneRow = (labelText, key) => {
    const row = el('div', 'tg-scene-row');
    const lbl = el('label', 'tg-scene-label', { text: labelText });
    const inp = el('input', 'tg-scene-input');
    inp.type = 'text';
    inp.dataset.sceneKey = key;
    row.append(lbl, inp);
    return { row, input: inp };
  };
  const sceneLocation = sceneRow('Location', 'location');
  const sceneTime = sceneRow('Time', 'time');
  const sceneMood = sceneRow('Mood', 'mood');
  const scenePresent = sceneRow('Present (comma-separated)', 'present');
  const sceneClearBtn = el('button', 'tg-scene-clear-btn', { text: 'Clear scene' });
  sceneClearBtn.title = 'Reset all scene state to empty';
  scenePanel.append(sceneLocation.row, sceneTime.row, sceneMood.row, scenePresent.row, sceneClearBtn);
  root.appendChild(scenePanel);

  function _readSceneFromThread() {
    const s = thread?.sceneState;
    if (!s || typeof s !== 'object') return { location: '', time: '', mood: '', present: '' };
    return {
      location: s.location ?? '',
      time: s.time ?? '',
      mood: s.mood ?? '',
      present: Array.isArray(s.present) ? s.present.join(', ') : '',
    };
  }
  function _writeSceneInputs() {
    const v = _readSceneFromThread();
    sceneLocation.input.value = v.location;
    sceneTime.input.value = v.time;
    sceneMood.input.value = v.mood;
    scenePresent.input.value = v.present;
  }
  function _persistSceneFromInputs() {
    const next = {
      location: sceneLocation.input.value.trim() || null,
      time: sceneTime.input.value.trim() || null,
      mood: sceneMood.input.value.trim() || null,
      present: scenePresent.input.value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    };
    // Normalize: if every field is empty/null, clear sceneState entirely.
    const empty = !next.location && !next.time && !next.mood && next.present.length === 0;
    const sceneStateToSave = empty ? null : next;
    if (!thread) return;
    thread.sceneState = sceneStateToSave;
    renderChatHead();
    void surfaceSaveError(
      updateThreadMeta(fs, workspaceUri, threadId, { sceneState: sceneStateToSave }),
      parallx,
      'scene state',
    );
  }
  for (const f of [sceneLocation, sceneTime, sceneMood, scenePresent]) {
    f.input.addEventListener('change', _persistSceneFromInputs);
    f.input.addEventListener('blur', _persistSceneFromInputs);
  }
  sceneClearBtn.addEventListener('click', () => {
    sceneLocation.input.value = '';
    sceneTime.input.value = '';
    sceneMood.input.value = '';
    scenePresent.input.value = '';
    _persistSceneFromInputs();
  });
  nowStrip.addEventListener('click', () => sceneBtn.click());
  sceneBtn.addEventListener('click', () => {
    const willShow = scenePanel.style.display === 'none';
    scenePanel.style.display = willShow ? '' : 'none';
    sceneBtn.classList.toggle('tg-chat-toolbar-btn--active', willShow);
    if (willShow) _writeSceneInputs();
  });

  const messagesEl = el('div', 'tg-messages');
  root.appendChild(messagesEl);

  // Turn bar removed — unified shortcut buttons bar serves as turn controls

  const inputWrap = el('div', 'tg-input-wrap');
  const inputCard = el('div', 'tg-input-card');
  const textarea = el('textarea', 'tg-input-textarea');
  textarea.placeholder = 'Type your message… (use /ai, /nar, /sys for commands)';
  textarea.rows = 1;
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
  });

  const inputToolbar = el('div', 'tg-input-toolbar');
  const optionsBtn = el('button', 'tg-input-options-btn', { html: icon('sliders', 16) });
  optionsBtn.title = 'Chat settings';

  // M79 Phase 4a — OOC toggle. When active, the next message is logged
  // but the AI never sees it (hiddenFrom: 'ai', kind: 'ooc'). Visually
  // styled as a muted "Backstage" entry so the user can scan their
  // notes alongside the in-character conversation.
  let oocMode = false;
  const oocBtn = el('button', 'tg-input-ooc-btn', { html: icon('eye-off', 16) });
  oocBtn.title = 'OOC (the AI will not see this message)';
  function setOocMode(next) {
    oocMode = !!next;
    oocBtn.classList.toggle('tg-input-ooc-btn--active', oocMode);
    inputCard.classList.toggle('tg-input-card--ooc', oocMode);
    textarea.placeholder = oocMode
      ? 'Backstage note, the AI will not see this…'
      : 'Type your message… (use /ai, /nar, /sys for commands)';
  }
  oocBtn.addEventListener('click', () => setOocMode(!oocMode));

  // Director's note — the always-visible steering channel. The /ai
  // slash command has carried one-shot instructions since M79 and lands
  // in the strongest attention position, but a slash command is
  // invisible; this promotes it to a first-class affordance. The note
  // applies to the NEXT generated turn only, then clears.
  const directorBtn = el('button', 'tg-input-ooc-btn', { html: icon('megaphone', 16) });
  directorBtn.title = 'Director\'s note (steer the next AI turn)';
  const directorRow = el('div', 'tg-director-row');
  directorRow.style.display = 'none';
  const directorIcon = el('span', 'tg-director-icon', { html: icon('megaphone', 13) });
  const directorInput = el('input', 'tg-director-input');
  directorInput.type = 'text';
  directorInput.placeholder = 'Director\'s note for the next turn, e.g. "she finally admits the truth, keep it under two paragraphs"';
  directorRow.append(directorIcon, directorInput);
  function setDirectorVisible(next) {
    directorRow.style.display = next ? '' : 'none';
    directorBtn.classList.toggle('tg-input-ooc-btn--active', next);
    if (next) directorInput.focus();
  }
  directorBtn.addEventListener('click', () => setDirectorVisible(directorRow.style.display === 'none'));
  directorInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { setDirectorVisible(false); textarea.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); textarea.focus(); }
  });
  /** One-shot consume: generateTurn calls this when no explicit
   *  instruction was provided. Reading clears the field so the note
   *  can't silently apply twice. */
  function consumeDirectorNote() {
    const note = directorInput.value.trim();
    if (!note) return null;
    directorInput.value = '';
    return note;
  }

  const sendBtn = el('button', 'tg-input-send', { html: icon('send', 16) });
  sendBtn.title = 'Send (Enter)';
  // Directions: on request, the director reads the scene and offers each
  // character four short notes for their next turn (director.js). A pick
  // becomes "/ai @Name note" in the composer, the chat's own way to steer.
  const directionsBtn = el('button', 'tg-input-ooc-btn', { html: icon('clapperboard', 16) });
  directionsBtn.title = 'Suggest Directions';
  directionsBtn.setAttribute('aria-label', 'Suggest Directions');
  inputToolbar.append(optionsBtn, oocBtn, directionsBtn, directorBtn, sendBtn);

  const textareaWrap = el('div', 'tg-textarea-wrap');
  textareaWrap.append(textarea, inputToolbar);
  inputCard.append(directorRow, textareaWrap);

  // Click anywhere inside the input card — except on a real button — should
  // focus the textarea. Guards against rare cases where the textarea looks
  // unresponsive because focus landed on a sibling element.
  inputCard.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('button, select, input, textarea')) return;
    textarea.focus();
  });

  // Shortcut buttons bar (inline speaker actions inside the input card)
  const shortcutBar = el('div', 'tg-shortcut-bar');
  inputCard.appendChild(shortcutBar);
  const directionsCard = el('div', 'cr-directions');
  directionsCard.style.display = 'none';
  inputWrap.append(directionsCard, inputCard);
  root.appendChild(inputWrap);
  // The chat column and the Memory panel side by side.
  const chatBody = el('div', 'cr-chat-body');
  const chatMain = el('div', 'cr-chat-main');
  chatMain.append(nowStrip, scenePanel, messagesEl, inputWrap);
  chatBody.append(chatMain, memoryPanel);
  root.appendChild(chatBody);
  setMemoryOpen(memoryOpen);

  let thread = null;
  let characters = [];
  // The supporting cast's short cards, resolved against the roster on load.
  let supportingCards = [];
  let connectedCards = [];
  let allLorebooks = [];
  let messageHistory = [];
  let models = [];
  let selectedModelId = null;
  let currentSettings = null;
  // The window the last prompt was budgeted to (sent as num_ctx with it).
  let lastContextWindow = 0;
  const modelLengthCache = new Map();

  /** The model's own context length from Ollama (0 when unknown), cached per model. */
  async function modelContextLength(modelId) {
    if (!modelId) return 0;
    if (modelLengthCache.has(modelId)) return modelLengthCache.get(modelId);
    let n = 0;
    try { n = Number((await parallx.lm?.getModelInfo?.(modelId))?.contextLength) || 0; } catch { n = 0; }
    if (n > 0) modelLengthCache.set(modelId, n);
    return n;
  }

  async function chatContextWindow(modelId) {
    const override = Number(thread?.contextWindowOverride) || 0;
    const settingsDefault = Number(currentSettings?.defaultContextWindow) || 0;
    return resolveContextWindow({
      override,
      settingsDefault,
      modelLength: override > 0 || settingsDefault > 0 ? 0 : await modelContextLength(modelId),
    });
  }
  let lastAssembledContext = null;
  // Generation state is SHARED across panes of this thread (see the
  // active-generation registry): a tab switch disposes this pane but the
  // stream keeps running, and the next pane re-attaches through `gen`.
  const gen = getGenState(threadId);
  let selectedComposeSpeaker = SELF_SPEAKER;
  let selectedReplySpeaker = null;
  let renderQueued = false;
  let fileWatcher = null;
  // Streaming fast-path target: the transient message's body node, so
  // per-chunk updates patch one element instead of rebuilding the
  // whole transcript (see queueRender).
  let _transientBodyEl = null;
  // M79 Phase 1 — track how many AI replies have happened since the
  // last auto-extract. We only count completed AI turns so a chatty
  // session with hidden OOC notes doesn't fire premature extractions.
  let _extractMisses = 0;
  let _extractInFlight = false;

  function getCharacterByFile(fileName) {
    // Normalize .md/.json extensions for backward compatibility after migration
    const baseName = fileName.replace(/\.(md|json)$/, '');
    return characters.find((char) => char.fileName.replace(/\.(md|json)$/, '') === baseName) || null;
  }

  /**
   * M79 Phase 1 — fire-and-forget memory extraction.
   *
   * Called from generateTurn's post-flow when an AI message has been
   * successfully persisted. Counts AI replies; every Nth call kicks
   * off a background extraction over the recent chat slice. The call
   * does its own LLM round-trip and writes to the semantic +
   * episodic JSONL files. Re-entrancy guarded so a slow extraction
   * can't pile up.
   */
  function _maybeAutoExtractMemory({ force = false } = {}) {
    if (_extractInFlight) return Promise.resolve(null);
    // The count of story replies the memory covers lives on the thread, so
    // it survives closing the chat (it used to restart on every visit).
    const covered = Number(thread?.memoryExtractedThrough) || 0;
    const plan = extractionDue(messageHistory, force ? -Infinity : covered, { every: force ? 1 : MEMORY_AUTOEXTRACT_EVERY_N_EXCHANGES });
    if (!plan.due || plan.slice.length === 0) return Promise.resolve(null);
    const rawId = selectedModelId || thread?.modelId || null;
    const modelId = (rawId && models.some(m => m.id === rawId)) ? rawId : models[0]?.id;
    if (!modelId) return Promise.resolve(null);
    _extractInFlight = true;

    return (async () => {
      try {
        const existing = await readSemanticMemory(fs, workspaceUri, threadId);
        const result = await autoExtractMemoryBackground({
          parallx,
          fs,
          workspaceUri,
          threadId,
          modelId,
          // The chat's own context window; without it the default (often
          // 2048) cut the instructions off the front.
          numCtx: await chatContextWindow(modelId),
          recentMessages: plan.slice,
          existingSemantic: existing,
        });
        // Moved on when it worked, or after a second miss in a row, so one
        // bad reply is retried at the next turn but a model that never
        // returns JSON does not cost a call on every turn.
        if (result?.ok || ++_extractMisses >= 2) {
          _extractMisses = 0;
          if (thread) thread.memoryExtractedThrough = plan.replies;
          void updateThreadMeta(fs, workspaceUri, threadId, { memoryExtractedThrough: plan.replies })
            .catch((err) => console.warn('[TextGenerator] Could not save the memory mark:', err));
        }
        if (result?.ok && (result.facts || result.beats)) void renderMemoryPanel();
        return result;
      } finally {
        _extractInFlight = false;
      }
    })();
  }

  function getCharacterName(fileOrChar) {
    if (!fileOrChar) return 'AI';
    if (typeof fileOrChar === 'string') {
      const char = getCharacterByFile(fileOrChar);
      return char ? (char.frontmatter.name || char.fileName.replace(/\.(md|json)$/, '')) : fileOrChar.replace(/\.(md|json)$/, '');
    }
    return fileOrChar.frontmatter.name || fileOrChar.fileName.replace(/\.(md|json)$/, '');
  }

  function getUserName() {
    return thread?.userName || currentSettings?.userName || 'Anon';
  }

  /**
   * After a user rename, propagate the new name to:
   *  1. Each character's settings (so the Character Editor "User's name" field reflects it)
   *  2. The global default settings (so new threads inherit it)
   */
  async function propagateUserName(newName) {
    // Update characters that DON'T have a deliberate per-character userName override
    for (const char of characters) {
      try {
        const charPath = resolveUri(workspaceUri, `${EXT_ROOT}/characters/${char.fileName}`);
        const { content } = await fs.readFile(charPath);
        const charData = JSON.parse(content);
        // Only overwrite if the character's userName was blank or matched the old default
        if (!charData.userName || charData.userName === thread?.userName || charData.userName === currentSettings?.userName) {
          charData.userName = newName;
          await saveCharacter(fs, workspaceUri, char.fileName, charData);
        }
        // Keep runtime object in sync
        if (char.frontmatter) char.frontmatter.userName = newName;
      } catch { /* character file may not exist */ }
    }
    // Update global default so new threads inherit the name
    if (currentSettings) {
      currentSettings.userName = newName;
      await surfaceSaveError(saveSettings(fs, workspaceUri, currentSettings), parallx, 'your name');
    }
  }

  function getVisibleName(msg) {
    // For user's own messages (not playing-as-character), always use the CURRENT
    // userName so a mid-conversation rename is reflected everywhere instantly.
    if (msg.author === 'user' && !msg.characterFile) return getUserName();
    if (msg.name) return msg.name;
    if (msg.author === 'user') return getUserName();
    if (msg.author === 'ai' && msg.characterFile) return getCharacterName(msg.characterFile);
    if (msg.author === 'system' || msg.author === 'scenario') {
      const primaryChar = characters[0] || null;
      const sysName = primaryChar?.frontmatter?.systemName || '';
      if (sysName) return sysName;
    }
    return msg.author === 'ai' ? 'AI' : 'System';
  }

  function getNameColorClass(msg) {
    const name = getVisibleName(msg).toLowerCase();
    if (msg.author === 'user') return 'tg-name--user';
    if (name === 'narrator') return 'tg-name--narrator';
    if (name === 'scenario') return 'tg-name--scenario';
    if (msg.author === 'ai') return 'tg-name--ai';
    return 'tg-name--system';
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMessageMarkup(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/gs, '<em>$1</em>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      // Streaming fast-path: while a transient message is live in the
      // DOM, patch its body in place. The previous full renderMessages()
      // per frame rebuilt every message row (listeners included) and
      // forced scrollTop to the bottom — long chats stuttered and the
      // user couldn't scroll up to re-read while the AI was writing.
      if (gen.transient && _transientBodyEl && _transientBodyEl.isConnected) {
        _transientBodyEl.innerHTML = renderMessageMarkup(gen.transient.content || '');
        const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
        if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
        return;
      }
      renderMessages();
    });
  }

  // Lightweight toast for non-modal feedback (delete-undo, save errors, etc.).
  let _activeToast = null;
  function showToast(message, actionLabel = null, actionFn = null, ms = 5000) {
    if (_activeToast) { _activeToast.remove(); _activeToast = null; }
    const toast = el('div', 'tg-toast');
    toast.appendChild(el('span', null, { text: message }));
    if (actionLabel && actionFn) {
      const btn = el('button', 'tg-toast-action', { text: actionLabel });
      btn.addEventListener('click', () => {
        try { actionFn(); } finally { toast.remove(); _activeToast = null; }
      });
      toast.appendChild(btn);
    }
    document.body.appendChild(toast);
    _activeToast = toast;
    setTimeout(() => {
      if (_activeToast === toast) { toast.remove(); _activeToast = null; }
    }, ms);
  }

  function getComposeSelectionLabel(selection = selectedComposeSpeaker) {
    if (!selection || selection === SELF_SPEAKER) return getUserName();
    return getCharacterName(selection);
  }

  function getThreadSummary() {
    const count = messageHistory.length;
    return [thread?.title || '', `${count} message${count === 1 ? '' : 's'}`].filter(Boolean).join(' \u00B7 ');
  }
  function characterHue(fileOrChar) {
    const ch = typeof fileOrChar === 'string' ? getCharacterByFile(fileOrChar) : fileOrChar;
    return ch ? hueOf(ch.rawData || { name: getCharacterName(ch) }) : null;
  }
  function renderChatHead() {
    const names = characters.map((char) => getCharacterName(char));
    const withCast = supportingCards.length ? ` \u00B7 with ${supportingCards.map((p) => p.name).join(', ')}` : '';
    chatHeadName.textContent = (names.length ? names.join(', ') : 'Chat') + withCast;
    chatHeadFaces.replaceChildren(...characters.slice(0, 3).map((char) => createPortrait(getCharacterName(char), { size: 32, hue: characterHue(char) })));
    const sc = thread?.sceneState;
    const bits = sc && typeof sc === 'object' ? [sc.location, sc.time, sc.mood].filter((v) => typeof v === 'string' && v.trim()) : [];
    if (bits.length) {
      nowStrip.replaceChildren(el('span', 'cr-now-label', { text: 'Now' }), ...bits.map((b, i) => el('span', i === 0 ? 'cr-now-place' : 'cr-now-bit', { text: b })));
      nowStrip.style.display = '';
    } else nowStrip.style.display = 'none';
  }

  function updateChrome() {
    summaryEl.textContent = getThreadSummary();
    renderChatHead();
    if (lastAssembledContext) {
      const warns = lastAssembledContext.warnings || [];
      tokenCountEl.textContent = `~${lastAssembledContext.estimatedTokens} tokens`;
      const tipLines = [];
      if (lastAssembledContext.responseLengthSource) {
        tipLines.push(`Response length: ${lastAssembledContext.responseLengthSource}`);
      }
      if (lastAssembledContext.fitMethodSource) {
        tipLines.push(`Context-fit: ${lastAssembledContext.activeFitMethod} (${lastAssembledContext.fitMethodSource})`);
      }
      if (warns.length > 0) {
        if (tipLines.length) tipLines.push('');
        tipLines.push(...warns);
      }
      tokenCountEl.title = tipLines.join('\n');
      tokenCountEl.classList.toggle('tg-token-warn', warns.length > 0);
    } else {
      tokenCountEl.textContent = '';
      tokenCountEl.title = '';
      tokenCountEl.classList.remove('tg-token-warn');
    }
    if (gen.isGenerating) {
      sendBtn.innerHTML = icon('square', 16);
      sendBtn.title = 'Stop generating';
      sendBtn.classList.add('tg-input-send--stop');
      sendBtn.disabled = false;
    } else {
      sendBtn.innerHTML = icon('send', 16);
      sendBtn.title = 'Send (Enter)';
      sendBtn.classList.remove('tg-input-send--stop');
      sendBtn.disabled = false;
    }
  }

  // makeTurnChip removed — unified shortcut buttons serve as turn controls

  /**
   * Get the thread's shortcut config array. Seeds defaults if missing.
   * Each shortcut: { name, message, insertionType, autoSend, clearAfterSend }
   * - name: button label (supports {{char}}, {{user}} template vars)
   * - message: slash command or text, e.g. "/ai <optional writing instruction>"
   * - insertionType: "replace" (default) | "append" | "newline"
   * - autoSend: "yes" (default) | "no"
   * - clearAfterSend: "yes" (default) | "no"
   */
  function getThreadShortcuts() {
    if (thread?.shortcuts && thread.shortcuts.length > 0) {
      // Auto-sync: ensure every thread character has a properly targeted shortcut
      if (characters.length > 1) {
        let changed = false;
        // Deduplicate: remove shortcuts with identical resolved names
        const seen = new Set();
        const deduped = thread.shortcuts.filter(sc => {
          const key = resolveShortcutTemplate(sc.name).toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (deduped.length !== thread.shortcuts.length) {
          thread.shortcuts = deduped;
          changed = true;
        }
        // First pass: convert any {{char}} shortcut to explicit character reference
        // ({{char}} is fine for single-char, but multi-char needs explicit @Name)
        for (let i = 0; i < thread.shortcuts.length; i++) {
          const sc = thread.shortcuts[i];
          if (sc.name === '{{char}}') {
            const primaryName = getCharacterName(characters[0]);
            const charRef = primaryName.includes(' ') ? `@"${primaryName}"` : `@${primaryName}`;
            thread.shortcuts[i] = { ...sc, name: primaryName, message: `/ai ${charRef} <optional writing instruction>` };
            changed = true;
          }
        }
        // Second pass: add missing characters
        for (const char of characters) {
          const cName = getCharacterName(char);
          const alreadyHas = thread.shortcuts.some(sc => {
            const resolved = resolveShortcutTemplate(sc.name);
            return resolved.toLowerCase() === cName.toLowerCase();
          });
          if (!alreadyHas) {
            const charRef = cName.includes(' ') ? `@"${cName}"` : `@${cName}`;
            // Insert before {{user}} and Narrator entries (keep characters grouped)
            const userIdx = thread.shortcuts.findIndex(sc => sc.name === '{{user}}' || sc.message?.startsWith('/user'));
            const insertAt = userIdx >= 0 ? userIdx : thread.shortcuts.length;
            thread.shortcuts.splice(insertAt, 0, { name: cName, message: `/ai ${charRef} <optional writing instruction>`, insertionType: 'replace', autoSend: 'no', clearAfterSend: 'no' });
            changed = true;
          }
        }
        if (changed) {
          surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, { shortcuts: thread.shortcuts }), parallx, 'shortcut changes');
        }
      }
      return thread.shortcuts;
    }
    // Migrate old customShortcuts format to new shortcuts model
    if (thread?.customShortcuts && thread.customShortcuts.length > 0) {
      const migrated = thread.customShortcuts.map(sc => {
        const type = sc.type || 'ai';
        let message = sc.message || '';
        if (type === 'system') message = `/sys ${message}`;
        else if (type === 'narrator') message = `/nar ${message}`;
        else if (type === 'ai') message = `/ai ${message}`;
        else if (type === 'user') message = `/user ${message}`;
        return { name: sc.label, message: message.trim(), insertionType: 'replace', autoSend: 'yes', clearAfterSend: 'yes' };
      });
      if (thread) thread.shortcuts = migrated;
      return migrated;
    }
    // Seed from primary character's shortcutButtons field (Perchance @name/@message format)
    const primaryChar = characters[0] || null;
    const charShortcuts = primaryChar?.frontmatter?.shortcutButtons || '';
    if (charShortcuts.trim()) {
      const parsed = parseShortcutsFromBulkText(charShortcuts);
      if (parsed.length > 0) {
        if (thread) thread.shortcuts = parsed;
        return parsed;
      }
    }
    // Seed defaults — one shortcut per thread character, plus user and narrator
    const defaults = [];
    if (characters.length === 1) {
      // Single character: use {{char}} template so label auto-updates on rename
      defaults.push({ name: '{{char}}', message: '/ai <optional writing instruction>', insertionType: 'replace', autoSend: 'no', clearAfterSend: 'no' });
    } else {
      // Multi-character: one named shortcut per character
      for (const char of characters) {
        const cName = getCharacterName(char);
        const charRef = cName.includes(' ') ? `@"${cName}"` : `@${cName}`;
        defaults.push({ name: cName, message: `/ai ${charRef} <optional writing instruction>`, insertionType: 'replace', autoSend: 'no', clearAfterSend: 'no' });
      }
    }
    defaults.push(
      { name: '{{user}}', message: '/user <optional writing instruction>', insertionType: 'replace', autoSend: 'no', clearAfterSend: 'no' },
      { name: 'Narrator', message: '/nar <optional writing instruction>', insertionType: 'replace', autoSend: 'no', clearAfterSend: 'no' },
    );
    if (thread) thread.shortcuts = defaults;
    return defaults;
  }

  /**
   * Resolve template variables in shortcut name/message.
   * {{char}} → primary character name, {{user}} → user name
   */
  function resolveShortcutTemplate(str) {
    const charName = characters.length > 0 ? getCharacterName(characters[0]) : 'AI';
    const uName = getUserName();
    return str.replace(/\{\{char\}\}/gi, charName).replace(/\{\{user\}\}/gi, uName);
  }

  /**
   * Execute a shortcut button click.
   * Inserts message into textarea based on insertionType, optionally auto-sends,
   * and highlights <placeholder> text for quick editing.
   */
  function executeShortcut(sc) {
    if (gen.isGenerating) return;
    const message = resolveShortcutTemplate(sc.message || '');
    const insertionType = (sc.insertionType || 'replace').toLowerCase();
    const autoSend = (sc.autoSend || 'yes').toLowerCase() !== 'no';
    const clearAfterSend = (sc.clearAfterSend || 'yes').toLowerCase() !== 'no';

    // Insert message into textarea
    if (insertionType === 'append') {
      textarea.value += message;
    } else if (insertionType === 'newline') {
      textarea.value += (textarea.value ? '\n' : '') + message;
    } else {
      // "replace" — clear and set
      textarea.value = message;
    }
    textarea.dispatchEvent(new Event('input'));

    if (autoSend && message) {
      // Auto-send: call sendMessage which reads textarea.value and processes it
      sendMessage();
      if (clearAfterSend) {
        // sendMessage already clears textarea, but ensure it
        textarea.value = '';
        textarea.style.height = 'auto';
      }
    } else {
      // No auto-send: focus textarea and highlight <placeholder> if present
      textarea.focus();
      const placeholderMatch = textarea.value.match(/<([^>]+)>/);
      if (placeholderMatch) {
        const start = textarea.value.indexOf(placeholderMatch[0]);
        const end = start + placeholderMatch[0].length;
        textarea.setSelectionRange(start, end);
      }
    }
  }

  // ── Directions ──────────────────────────────────────────────────────────
  // One call, on request, after a turn. Streams into the card as it is read;
  // a newer request or a new turn drops an older one. The card closes when a
  // turn starts: its options were for the scene before it.
  let _directionsRun = 0;
  let _directionsPicked = null;

  function closeDirections() {
    _directionsRun++;
    _directionsPicked = null;
    directionsCard.style.display = 'none';
    directionsCard.replaceChildren();
    directionsBtn.classList.remove('tg-input-ooc-btn--active');
  }

  function renderDirections({ groups = [], status = '', error = '', busy = false } = {}) {
    directionsCard.replaceChildren();
    const head = el('div', 'cr-directions-head');
    head.appendChild(el('span', 'cr-directions-title', { html: `${icon('clapperboard', 14)} Directions for the next turn` }));
    const actions = el('div', 'cr-directions-actions');
    const again = el('button', 'cr-directions-icon', { html: icon('rotate-ccw', 14) });
    again.title = 'Suggest Again';
    again.setAttribute('aria-label', 'Suggest Again');
    again.disabled = busy;
    again.addEventListener('click', () => void suggestDirections());
    const close = el('button', 'cr-directions-icon', { html: icon('x', 14) });
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => closeDirections());
    actions.append(again, close);
    head.appendChild(actions);
    directionsCard.appendChild(head);

    if (error) {
      const line = el('div', 'cr-directions-status cr-directions-status--error', { text: error });
      const retry = el('button', 'cr-directions-retry', { text: 'Try Again' });
      retry.addEventListener('click', () => void suggestDirections());
      line.appendChild(retry);
      directionsCard.appendChild(line);
    } else if (status) {
      directionsCard.appendChild(el('div', 'cr-directions-status', { text: status }));
    }

    if (groups.length) {
      const grid = el('div', 'cr-directions-groups');
      for (const g of groups) {
        const char = characters.find((c) => getCharacterName(c) === g.name);
        const box = el('div', 'cr-directions-group');
        const who = el('div', 'cr-directions-who');
        who.append(createPortrait(g.name, { size: 20, hue: char ? characterHue(char) : null }), el('span', null, { text: g.name }));
        box.appendChild(who);
        for (const o of g.options) {
          const key = `${g.name}\n${o.text}`;
          const btn = el('button', `cr-direction${_directionsPicked === key ? ' cr-direction--picked' : ''}`);
          btn.title = g.name === NARRATOR
            ? 'The Narrator takes the next turn with this note: the story moves on. Edit it before you send.'
            : `${g.name} takes the next turn with this note. Edit it before you send.`;
          btn.append(el('span', 'cr-direction-kind', { text: directionKindLabel(o.kind) }), el('span', 'cr-direction-text', { text: o.text }));
          btn.addEventListener('click', () => {
            _directionsPicked = key;
            for (const b of grid.querySelectorAll('.cr-direction--picked')) b.classList.remove('cr-direction--picked');
            btn.classList.add('cr-direction--picked');
            textarea.value = composeWithDirection(textarea.value, directionCommand(g.name, o.text));
            textarea.dispatchEvent(new Event('input'));
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          });
          box.appendChild(btn);
        }
        grid.appendChild(box);
      }
      directionsCard.appendChild(grid);
    }
    directionsCard.style.display = '';
    directionsBtn.classList.add('tg-input-ooc-btn--active');
  }

  async function suggestDirections() {
    if (!thread || characters.length === 0) return;
    if (gen.isGenerating) {
      renderDirections({ error: 'A turn is being written. Ask for directions once it is done.' });
      return;
    }
    const rawId = selectedModelId || thread?.modelId || null;
    const modelId = (rawId && models.some((m) => m.id === rawId)) ? rawId : models[0]?.id;
    if (!modelId || !parallx.lm?.sendChatRequest) {
      renderDirections({ error: 'No model is available. Pick one in Chat Settings.' });
      return;
    }
    const run = ++_directionsRun;
    _directionsPicked = null;

    const story = messageHistory.filter((m) => m && m.content && m.hiddenFrom !== 'ai' && m.kind !== 'ooc');
    const lastSpeaker = [...story].reverse().find((m) => m.characterFile)?.characterFile || null;
    const roster = characters.map((c) => ({ file: c.fileName, name: getCharacterName(c), char: c }));
    const chosen = directorCast(roster, { present: thread.sceneState?.present || [], lastSpeaker });
    // The Narrator's group (moves for the story itself) comes first.
    const names = [NARRATOR, ...chosen.map((c) => c.name)];
    renderDirections({ status: `Reading the scene for the Narrator and ${chosen.map((c) => c.name).join(', ')}…`, busy: true });

    let memory = { facts: [], beats: [], notes: '' };
    try { memory = await loadThreadMemory(fs, workspaceUri, threadId); } catch { /* the prompt goes without it */ }
    if (run !== _directionsRun) return;
    const cast = chosen.map(({ name, char }) => {
      const sheet = sheetFromCharacter(char.rawData || {});
      return { name, tagline: sheet.tagline, drives: sheet.drives, secrets: sheet.secrets, relationships: sheet.relationships };
    });
    const messages = buildDirectorPrompt({
      cast,
      others: [...supportingCards, ...connectedCards],
      scene: thread.sceneState || null,
      memory,
      transcript: story.slice(-14).map((m) => ({ name: getVisibleName(m), content: m.content })),
      recentNotes: messageHistory.slice(-12).map((m) => m && m.instruction).filter(Boolean),
      rules: currentSettings?.dialogueRules || '',
    });

    let raw = '';
    try {
      const numCtx = await chatContextWindow(modelId);
      if (run !== _directionsRun) return;
      const stream = parallx.lm.sendChatRequest(modelId, messages, { temperature: 0.9, maxTokens: 1200, think: false, ...(numCtx ? { numCtx } : {}) });
      for await (const chunk of stream) {
        if (run !== _directionsRun) return;
        if (!chunk?.content) continue;
        raw += chunk.content;
        const partial = parseDirections(raw, names, { complete: false });
        if (partial.length) renderDirections({ groups: partial, status: 'Writing…', busy: true });
      }
    } catch (err) {
      if (run !== _directionsRun) return;
      renderDirections({ error: `Could not suggest directions: ${err?.message || String(err)}.` });
      return;
    }
    if (run !== _directionsRun) return;
    const groups = parseDirections(raw, names);
    if (!groups.length) {
      console.warn('[TextGenerator] Directions: nothing readable in the reply. It began:', raw.slice(0, 200));
      renderDirections({ error: 'The model did not suggest anything this time.' });
      return;
    }
    renderDirections({ groups });
  }

  directionsBtn.addEventListener('click', () => {
    if (directionsCard.style.display !== 'none' && !directionsCard.querySelector('.cr-directions-status--error')) closeDirections();
    else void suggestDirections();
  });
  directionsCard.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeDirections(); textarea.focus(); }
  });

  /**
   * Serialize thread shortcuts array to the @name/@message/... bulk-edit format.
   */
  function serializeShortcuts(shortcuts) {
    return shortcuts.map(sc => {
      let block = `@name=${sc.name}`;
      if (sc.message) block += `\n@message=${sc.message}`;
      block += `\n@insertionType=${sc.insertionType || 'replace'}`;
      block += `\n@autoSend=${sc.autoSend || 'yes'}`;
      if (sc.clearAfterSend) block += `\n@clearAfterSend=${sc.clearAfterSend}`;
      return block;
    }).join('\n\n');
  }

  /**
   * Parse the @name/@message/... bulk-edit format back to shortcut objects.
   */
  function parseShortcutsFromBulkText(text) {
    const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
    const shortcuts = [];
    for (const block of blocks) {
      const fields = {};
      const fieldRegex = /@(\w+)=([^@]*?)(?=\n@\w+=|$)/gs;
      let m;
      while ((m = fieldRegex.exec(block)) !== null) {
        fields[m[1].toLowerCase()] = m[2].trim();
      }
      const name = fields.name;
      if (!name) continue;
      shortcuts.push({
        name,
        message: fields.message || '',
        insertionType: fields.insertiontype || 'replace',
        autoSend: fields.autosend || 'yes',
        clearAfterSend: fields.clearaftersend || 'yes',
      });
    }
    return shortcuts;
  }

  function renderShortcutButtons() {
    shortcutBar.innerHTML = '';
    if (characters.length === 0) return;

    const shortcuts = getThreadShortcuts();

    // Render each shortcut as a button
    for (const sc of shortcuts) {
      const label = resolveShortcutTemplate(sc.name);
      const btn = el('button', 'tg-shortcut-btn', { text: label });
      btn.title = resolveShortcutTemplate(sc.message || sc.name);
      btn.addEventListener('click', () => executeShortcut(sc));
      shortcutBar.appendChild(btn);
    }

    // ── "+" button to manage shortcuts ──
    const addBtn = el('button', 'tg-shortcut-btn tg-shortcut-btn--add', { text: '+' });
    addBtn.title = 'Manage shortcut buttons';
    addBtn.addEventListener('click', () => showShortcutManagementMenu());
    shortcutBar.appendChild(addBtn);
  }

  /**
   * Show the 3-option shortcut management popover (Perchance-style).
   * Options: Add a character shortcut, Add a custom shortcut, Bulk edit/delete shortcuts.
   */
  function showShortcutManagementMenu() {
    const overlay = el('div', 'tg-modal-overlay');
    const modal = el('div', 'tg-modal');
    modal.style.maxWidth = '340px';

    const body = el('div', 'tg-modal-body');
    body.style.padding = '16px';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.alignItems = 'center';
    body.style.gap = '10px';

    const charBtn = el('button', 'tg-shortcut-btn', { html: `${icon('message-circle', 14)} add a character shortcut` });
    charBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
    charBtn.addEventListener('click', () => { overlay.remove(); showAddCharacterShortcutDialog(); });

    const customBtn = el('button', 'tg-shortcut-btn', { html: `${icon('px-ai-mark', 14)} add a custom shortcut` });
    customBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
    customBtn.addEventListener('click', () => { overlay.remove(); showAddCustomShortcutDialog(); });

    const bulkBtn = el('button', 'tg-shortcut-btn', { html: `${icon('pencil', 14)} Bulk Edit/Delete Shortcuts` });
    bulkBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
    bulkBtn.addEventListener('click', () => { overlay.remove(); showBulkEditShortcutsDialog(); });

    const cancelBtn = el('button', 'tg-shortcut-btn', { text: 'Cancel' });
    cancelBtn.style.cssText = 'padding:4px 16px; font-size:11px; margin-top:4px;';
    cancelBtn.addEventListener('click', () => overlay.remove());

    body.append(charBtn, customBtn, bulkBtn, cancelBtn);
    modal.appendChild(body);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  /**
   * "Add a character shortcut" — pick a character from the thread and create a
   * shortcut that sends /ai @CharName.
   */
  function showAddCharacterShortcutDialog() {
    const overlay = el('div', 'tg-modal-overlay');
    const modal = el('div', 'tg-modal');
    modal.style.maxWidth = '380px';

    const header = el('div', 'tg-modal-header');
    header.appendChild(el('span', 'tg-modal-title', { text: 'Add Character Shortcut' }));
    const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = el('div', 'tg-modal-body');
    body.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:8px;';

    if (characters.length === 0) {
      body.appendChild(el('div', null, { text: 'No characters in this thread.' }));
    } else {
      body.appendChild(el('div', null, { text: 'Select a character to add a shortcut for:' }));
      body.querySelector('div').style.cssText = 'font-size:12px; color:var(--vscode-descriptionForeground); margin-bottom:4px;';
      const existingShortcuts = getThreadShortcuts();
      let addedAny = false;
      for (const character of characters) {
        const cName = getCharacterName(character);
        // Skip characters that already have a shortcut
        const alreadyHas = existingShortcuts.some(sc => {
          const resolved = resolveShortcutTemplate(sc.name);
          return resolved.toLowerCase() === cName.toLowerCase();
        });
        if (alreadyHas) continue;
        addedAny = true;
        const charBtn = el('button', 'tg-shortcut-btn', { html: `${icon('message-circle', 14)} ${escapeHtml(cName)}` });
        charBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
        charBtn.addEventListener('click', async () => {
          const shortcuts = getThreadShortcuts();
          const charRef = cName.includes(' ') ? `@"${cName}"` : `@${cName}`;
          shortcuts.push({
            name: cName,
            message: `/ai ${charRef} <optional writing instruction>`,
            insertionType: 'replace',
            autoSend: 'no',
            clearAfterSend: 'no',
          });
          thread.shortcuts = shortcuts;
          await surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, { shortcuts }), parallx, 'shortcuts');
          overlay.remove();
          renderShortcutButtons();
        });
        body.appendChild(charBtn);
      }
      if (!addedAny) {
        body.querySelector('div').textContent = 'All characters already have shortcuts.';
      }
    }

    const footer = el('div', 'tg-modal-footer');
    footer.style.cssText = 'display:flex; justify-content:flex-end; padding:8px 16px;';
    const cancelBtn = el('button', 'tg-shortcut-btn', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(cancelBtn);

    modal.append(body, footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  /**
   * "Add a custom shortcut" — full form matching Perchance's custom shortcut dialog.
   * Fields: label, message, insertionType, autoSend, clearAfterSend.
   */
  function showAddCustomShortcutDialog() {
    const overlay = el('div', 'tg-modal-overlay');
    const modal = el('div', 'tg-modal');
    modal.style.maxWidth = '440px';

    const header = el('div', 'tg-modal-header');
    header.appendChild(el('span', 'tg-modal-title', { text: 'Add Custom Shortcut' }));
    const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = el('div', 'tg-modal-body');
    body.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:12px;';

    const descEl = el('div', null, { text: 'Shortcuts are buttons that appear above the text box which can be used to easily/quickly send a commonly-used message. See the slash commands list for handy commands you might want to make shortcuts for.' });
    descEl.style.cssText = 'font-size:11px; color:var(--vscode-descriptionForeground); line-height:1.4;';
    body.appendChild(descEl);

    // Label
    const mkField = (labelText, inputEl) => {
      const lbl = el('label', null, { text: labelText });
      lbl.style.cssText = 'font-size:11px; font-weight:600; color:var(--vscode-foreground); display:flex; flex-direction:column; gap:4px;';
      lbl.appendChild(inputEl);
      return lbl;
    };
    const inputStyle = 'padding:6px 10px; border:1px solid var(--vscode-input-border, var(--px-border)); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-size:12px; font-family:var(--parallx-fontFamily-ui); box-sizing:border-box; width:100%;';

    const labelInput = el('input');
    labelInput.type = 'text';
    labelInput.placeholder = 'e.g. silly reply';
    labelInput.style.cssText = inputStyle + ' min-height:auto;';
    body.appendChild(mkField('Shortcut button label:', labelInput));

    // Message
    const msgInput = el('textarea');
    msgInput.placeholder = 'e.g. /ai write a really silly reply';
    msgInput.rows = 3;
    msgInput.style.cssText = inputStyle + ' min-height:60px; max-height:120px; resize:vertical;';
    body.appendChild(mkField('Message text to add/send when button is clicked:', msgInput));

    // Insertion type
    const insertSelect = tgSelect(parallx, {
      layout: 'full',
      items: [
        { value: 'replace', label: 'Replace existing reply box text (if any)' },
        { value: 'append', label: 'Append to existing reply box text' },
        { value: 'newline', label: 'Append on New Line' },
      ],
      value: 'replace',
    });
    body.appendChild(mkField('Insertion type (what happens when you click the shortcut):', insertSelect.element));

    // Auto-send
    const autoSendSelect = tgSelect(parallx, {
      layout: 'full',
      items: [
        { value: 'yes', label: 'Yes, Send on Click' },
        { value: 'no', label: 'No, just insert into reply box' },
      ],
      value: 'yes',
    });
    body.appendChild(mkField('Auto-send?', autoSendSelect.element));

    // Clear after send
    const clearSelect = tgSelect(parallx, {
      layout: 'full',
      items: [
        { value: 'yes', label: 'Yes, Clear It' },
        { value: 'no', label: 'No, Keep It' },
      ],
      value: 'yes',
    });
    body.appendChild(mkField('Clear reply box after sending?', clearSelect.element));

    modal.appendChild(body);

    // Footer
    const footer = el('div', 'tg-modal-footer');
    footer.style.cssText = 'display:flex; justify-content:space-between; padding:8px 16px;';
    const cancelBtn = el('button', 'tg-shortcut-btn', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => overlay.remove());
    const createBtn = el('button', 'tg-shortcut-btn', { text: 'Create' });
    createBtn.style.cssText = 'background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:var(--vscode-button-background);';
    createBtn.addEventListener('click', async () => {
      const label = labelInput.value.trim();
      if (!label) { labelInput.focus(); return; }
      const shortcuts = getThreadShortcuts();
      shortcuts.push({
        name: label,
        message: msgInput.value.trim(),
        insertionType: insertSelect.value,
        autoSend: autoSendSelect.value,
        clearAfterSend: clearSelect.value,
      });
      thread.shortcuts = shortcuts;
      await surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, { shortcuts }), parallx, 'shortcuts');
      overlay.remove();
      renderShortcutButtons();
    });
    footer.append(cancelBtn, createBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    labelInput.focus();
  }

  /**
   * "Bulk edit/delete shortcuts" — raw text editor showing the @name/@message/... format.
   * Users can edit, reorder, or delete shortcuts directly in the textarea.
   */
  function showBulkEditShortcutsDialog() {
    const overlay = el('div', 'tg-modal-overlay');
    const modal = el('div', 'tg-modal');
    modal.style.maxWidth = '500px';

    const header = el('div', 'tg-modal-header');
    header.appendChild(el('span', 'tg-modal-title', { text: 'Bulk Edit Shortcuts' }));
    const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = el('div', 'tg-modal-body');
    body.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:10px;';

    const descEl = el('div', null, { text: 'Bulk-edit shortcuts. Ensure there\'s a blank line between each shortcut. Use /ai, /user, /nar, /sys, /image commands in the message field.' });
    descEl.style.cssText = 'font-size:11px; color:var(--vscode-descriptionForeground); line-height:1.4;';
    body.appendChild(descEl);

    const bulkInput = el('textarea');
    const shortcuts = getThreadShortcuts();
    bulkInput.value = serializeShortcuts(shortcuts);
    bulkInput.rows = 16;
    bulkInput.style.cssText = 'width:100%; box-sizing:border-box; padding:10px; border:1px solid var(--vscode-input-border, var(--px-border)); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-size:12px; font-family:monospace; line-height:1.5; resize:vertical; min-height:200px;';
    body.appendChild(bulkInput);

    modal.appendChild(body);

    // Footer
    const footer = el('div', 'tg-modal-footer');
    footer.style.cssText = 'display:flex; justify-content:space-between; padding:8px 16px;';
    const cancelBtn = el('button', 'tg-shortcut-btn', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => overlay.remove());
    const saveBtn = el('button', 'tg-shortcut-btn', { text: 'Save' });
    saveBtn.style.cssText = 'background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:var(--vscode-button-background)';
    saveBtn.addEventListener('click', async () => {
      const parsed = parseShortcutsFromBulkText(bulkInput.value);
      thread.shortcuts = parsed;
      await surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, { shortcuts: parsed }), parallx, 'shortcuts');
      overlay.remove();
      renderShortcutButtons();
    });
    footer.append(cancelBtn, saveBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    bulkInput.focus();
  }

  /**
   * Apply per-character settings to the chat UI:
   * - messageInputPlaceholder → textarea placeholder
   * - messageWrapperStyle → CSS custom property on messages container
   * - systemName → used by getVisibleName for system messages
   */
  function applyPerCharacterChatSettings() {
    const primaryChar = characters[0] || null;
    // Placeholder
    const customPlaceholder = primaryChar?.frontmatter?.messageInputPlaceholder || '';
    textarea.placeholder = customPlaceholder || 'Type your message… (use /ai, /nar, /sys for commands)';
    // Message wrapper style — apply as inline style on messages container
    // Sanitize: strip url(), expression(), behavior, and @import to prevent CSS injection
    const wrapperStyle = (primaryChar?.frontmatter?.messageWrapperStyle || '')
      .replace(/url\s*\(/gi, '')
      .replace(/expression\s*\(/gi, '')
      .replace(/behavior\s*:/gi, '')
      .replace(/@import/gi, '')
      .replace(/javascript\s*:/gi, '');
    messagesEl.style.cssText = wrapperStyle;
  }

  /**
   * renderTurnControls is now a thin wrapper that delegates to renderShortcutButtons.
   * Kept as a function name so all existing call-sites continue to work.
   */
  function renderTurnControls() {
    renderShortcutButtons();
  }

  async function showPromptModal() {
    // Dry-run assembly so the inspector works BEFORE the first
    // generation — same pipeline, zero LLM spend (summarisation is
    // skipped, smart turn order is bypassed via a deterministic
    // speaker). "What will the model see?" should never require
    // sending a message first.
    if (!lastAssembledContext) {
      const previewSpeaker = selectedReplySpeaker || characters[0]?.fileName || null;
      if (!previewSpeaker) return;
      try {
        await buildContextForGeneration({ speaker: previewSpeaker, dryRun: true });
      } catch (err) {
        showToast('Cannot assemble prompt: ' + (err?.message || String(err)));
        return;
      }
    }
    if (!lastAssembledContext) return;
    const overlay = el('div', 'tg-modal-overlay');
    const modal = el('div', 'tg-modal');
    const header = el('div', 'tg-modal-header');
    header.appendChild(el('span', 'tg-modal-title', { text: 'Prompt Inspector' }));
    const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = el('div', 'tg-modal-body');

    // Diagnostic header: settings inheritance + warnings.
    const diag = el('div', 'tg-prompt-diag');
    const ctx = lastAssembledContext;
    const diagLines = [];
    if (ctx.responseLengthSource) diagLines.push(`Response length: ${ctx.responseLengthSource}`);
    if (ctx.povSource) diagLines.push(`Point of view: ${ctx.povSource}`);
    if (ctx.fitMethodSource) diagLines.push(`Context-fit: ${ctx.activeFitMethod} (from ${ctx.fitMethodSource})`);
    if (ctx.warnings && ctx.warnings.length > 0) {
      for (const w of ctx.warnings) diagLines.push('⚠ ' + w);
    }
    if (diagLines.length > 0) {
      diag.appendChild(el('pre', null, { text: diagLines.join('\n') }));
      body.appendChild(el('div', 'tg-prompt-role', { text: 'diagnostics' }));
      body.appendChild(diag);
    }

    // Lorebook trigger debug.
    if (ctx.loreDebug && (ctx.loreDebug.matched.length || ctx.loreDebug.skipped.length || ctx.loreDebug.always.length)) {
      body.appendChild(el('div', 'tg-prompt-role', { text: 'lorebook triggers' }));
      const loreLines = [];
      if (ctx.loreDebug.matched.length) {
        loreLines.push('MATCHED:');
        for (const m of ctx.loreDebug.matched) {
          loreLines.push(`  • [${m.book}] ${m.head}  ← hit on: ${m.hits.join(', ')}`);
        }
      }
      if (ctx.loreDebug.always.length) {
        loreLines.push('ALWAYS:');
        for (const a of ctx.loreDebug.always) loreLines.push(`  • [${a.book}] ${a.head}`);
      }
      if (ctx.loreDebug.skipped.length) {
        loreLines.push('SKIPPED (triggers did not fire):');
        for (const s of ctx.loreDebug.skipped) loreLines.push(`  • [${s.book}] ${s.head}  (needs: ${s.triggers.join(', ')})`);
      }
      const loreEl = el('div', 'tg-prompt-content');
      loreEl.appendChild(el('pre', null, { text: loreLines.join('\n') }));
      body.appendChild(loreEl);
    }

    body.appendChild(el('div', 'tg-prompt-role', { text: 'messages sent to model' }));
    for (const msg of lastAssembledContext.messages) {
      body.appendChild(el('div', 'tg-prompt-role', { text: `${msg.role} · ~${estimateTokens(msg.content || '')}t` }));
      const contentEl = el('div', 'tg-prompt-content');
      contentEl.appendChild(el('pre', null, { text: msg.content }));
      body.appendChild(contentEl);
    }
    modal.appendChild(body);

    const footer = el('div', 'tg-modal-footer', {
      text: `~${lastAssembledContext.estimatedTokens} tokens estimated | Budget: sys ${lastAssembledContext.budget.character}t / lore ${lastAssembledContext.budget.lore}t / hist ${lastAssembledContext.budget.history}t / user ${lastAssembledContext.budget.user}t`,
    });
    modal.appendChild(footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  viewPromptBtn.addEventListener('click', () => { void showPromptModal(); });
  // The token chip doubles as a bigger hit-target for the inspector —
  // "why is this number what it is?" should be one click.
  tokenCountEl.style.cursor = 'pointer';
  tokenCountEl.addEventListener('click', () => { void showPromptModal(); });

  /**
   * Regenerate the message at `index` with `instruction` as its direction
   * (null = none). The owner's ask (2026-10-06): a regenerate used to reuse
   * the /ai instruction the message was made with, silently, with no way to
   * clarify it; now the direction is shown and edited first
   * (openRegenDirection), and the new message remembers it for next time.
   * Everything after the message goes, as before; the old text stays as a
   * variant; a failure puts the original back.
   */
  async function regenerateMessage(index, instruction) {
    if (gen.isGenerating || !messageHistory[index]) return;
    const target = messageHistory[index];
    const asUser = target.author === 'user';
    const messagesAfter = messageHistory.length - 1 - index;
    if (messagesAfter > 0) {
      const regenChoice = await _parallx.window.showWarningMessage(`Regenerating removes the ${messagesAfter} ${messagesAfter > 1 ? 'messages' : 'message'} after this one.`, { title: 'Regenerate' });
      if (!regenChoice || regenChoice.title !== 'Regenerate') return;
    }
    const speaker = asUser
      ? (target.characterFile || SELF_SPEAKER)
      : (!target.characterFile && (target.name || '').toLowerCase() === 'narrator' ? NARRATOR_SPEAKER : (target.characterFile || characters[0]?.fileName));
    // Snapshot variants. target.content is always kept as a variant, so an
    // edit made after variants existed is not lost.
    const existingVariants = Array.isArray(target.variants) ? target.variants : [];
    const previousVariants = existingVariants.includes(target.content)
      ? [...existingVariants]
      : (existingVariants.length ? [...existingVariants, target.content] : [target.content]);
    const targetSnapshot = { ...target, variants: previousVariants, variantIndex: previousVariants.indexOf(target.content) };
    // M79 hard-delete: the ids of everything spliced off, the target
    // included, collected before the splice so memory pruning has them all.
    const removedIds = messageHistory.slice(index).map((m) => m.id).filter(Boolean);
    messageHistory = messageHistory.slice(0, index);
    await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
    renderMessages();
    if (removedIds.length > 0) {
      void pruneMemoryForDeletedMessages(fs, workspaceUri, threadId, removedIds)
        .catch((err) => console.warn('[TextGenerator] Memory prune failed on regenerate:', err));
    }
    await generateTurn({ speaker, instruction: instruction || null, asUser });
    const newIdx = messageHistory.findIndex((m, i) => i >= index && m.author === (asUser ? 'user' : 'ai') && m.generatedBy === 'model');
    if (newIdx >= 0) {
      const newMsg = messageHistory[newIdx];
      newMsg.variants = [...previousVariants, newMsg.content];
      newMsg.variantIndex = newMsg.variants.length - 1;
      await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
      renderMessages();
    } else {
      // Cancelled, empty, or only error system messages: the original comes back where it was.
      messageHistory = [...messageHistory.slice(0, index), targetSnapshot, ...messageHistory.slice(index)];
      await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
      renderMessages();
    }
  }

  function renderMessageRow(msg, index = null, isTransient = false) {
    const hiddenClass = msg.hiddenFrom ? ` tg-msg--dim` : '';
    // M79 Phase 4a — OOC entries get a distinct "Backstage" treatment
    // so the user can scan them at a glance without confusing them
    // for in-character beats.
    const oocClass = msg.kind === 'ooc' ? ' tg-msg--ooc' : '';
    const messageEl = el('div', `tg-msg tg-msg--${msg.author || 'system'}${isTransient ? ' tg-msg--streaming' : ''}${hiddenClass}${oocClass}`);
    const nameRow = el('div', 'tg-msg-name-row');
    const displayName = msg.kind === 'ooc'
      ? `${getVisibleName(msg)} · Backstage`
      : getVisibleName(msg);
    nameRow.appendChild(el('span', `tg-msg-name ${getNameColorClass(msg)}`, { text: displayName }));

    let actions = null;
    if (!isTransient && index !== null) {
      actions = el('div', 'tg-msg-inline-actions');

      const editBtn = el('button', 'tg-msg-action-btn', { html: icon('pencil-line', 13) });
      editBtn.title = 'Edit message';
      editBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        // Trigger inline edit on the message body (same as double-click)
        startInlineEdit(body, index);
      });
      actions.appendChild(editBtn);

      // M79 Phase 5 — Remember this (user-promoted semantic memory).
      // Writes the message content as a semantic fact with source:user
      // and confidence:1.0. The fact is always-on for future generations
      // until the user removes it manually from memory.semantic.jsonl.
      // Auto-extracted facts ride the same pipeline; this is just the
      // explicit user channel.
      const rememberBtn = el('button', 'tg-msg-action-btn', { html: icon('pin', 13) });
      rememberBtn.title = 'Remember this (pin to memory)';
      rememberBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (!messageHistory[index]) return;
        const target = messageHistory[index];
        const text = (target.content || '').trim();
        if (!text) return;
        // Truncate very long messages — a fact entry of >500 chars is
        // unwieldy in injection. Tail-truncate with an ellipsis.
        const factText = text.length > 500 ? text.slice(0, 500).trim() + '…' : text;
        try {
          await appendSemanticMemory(fs, workspaceUri, threadId, [{
            id: generateId(),
            text: factText,
            category: 'event',
            confidence: 1.0,
            createdAt: Date.now(),
            source: 'user',
            // M79 — record the pinned message's ID so delete-pruning
            // also removes user pins when the source is hard-deleted.
            // Matches user intent: "delete means the AI forgets."
            sources: target.id ? [target.id] : [],
          }]);
          try { await mergeThreadMemory(fs, workspaceUri, threadId, { facts: [{ category: 'event', text: factText }] }); } catch { /* the jsonl pin above still holds */ }
          void renderMemoryPanel();
          showToast('Pinned to memory');
        } catch (err) {
          console.warn('[TextGenerator] Failed to pin memory:', err);
          showToast('Could not pin: ' + (err?.message || String(err)));
        }
      });
      actions.appendChild(rememberBtn);

      if (msg.author === 'ai') {
        // M79 Phase 4b — fork-from-here. Creates a sibling thread that
        // contains everything up to (and including) this message, with
        // a `forkedFrom` pointer. The new thread opens automatically;
        // the original is preserved untouched. This lets users explore
        // alternative narrative paths without losing the original
        // timeline.
        const forkBtn = el('button', 'tg-msg-action-btn', { html: icon('git-branch', 13) });
        forkBtn.title = 'Fork chat from here';
        forkBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (gen.isGenerating || index === null || !messageHistory[index]) return;
          try {
            const newMeta = await forkThread(fs, workspaceUri, threadId, index);
            showToast('Forked into "' + newMeta.title + '"', 'Open', async () => {
              try {
                await parallx.editors.openEditor({
                  typeId: 'text-generator-chat',
                  title: newMeta.title,
                  icon: 'book-open',
                  instanceId: newMeta.id,
                });
              } catch (err) { console.warn('[TextGenerator] Failed to open forked thread:', err); }
            });
            _refreshSidebar?.();
            // Also auto-open the fork — the user clicked the fork
            // button expecting to land in the new branch. The toast
            // "Open" action stays for parity / re-open after dismiss.
            try {
              await parallx.editors.openEditor({
                typeId: 'text-generator-chat',
                title: newMeta.title,
                icon: 'book-open',
                instanceId: newMeta.id,
              });
            } catch (err) { console.warn('[TextGenerator] Failed to auto-open forked thread:', err); }
          } catch (err) {
            console.warn('[TextGenerator] Fork failed:', err);
            showToast('Could not fork chat: ' + (err?.message || String(err)));
          }
        });
        actions.appendChild(forkBtn);

        const regenBtn = el('button', 'tg-msg-action-btn', { html: icon('refresh-cw', 13) });
        regenBtn.title = 'Regenerate this turn, with a direction if you like';
        regenBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          if (gen.isGenerating || !messageHistory[index]) return;
          openRegenDirection(index);
        });
        actions.appendChild(regenBtn);

      } else if (msg.author === 'user') {
        const regenBtn = el('button', 'tg-msg-action-btn', { html: icon('refresh-cw', 13) });
        regenBtn.title = 'Regenerate this message, with a direction if you like';
        regenBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          if (gen.isGenerating || !messageHistory[index]) return;
          openRegenDirection(index);
        });
        actions.appendChild(regenBtn);
      }

      const copyBtn = el('button', 'tg-msg-action-btn', { html: icon('clipboard', 13) });
      copyBtn.title = 'Copy to clipboard';
      copyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        navigator.clipboard?.writeText(msg.content || '');
      });
      actions.appendChild(copyBtn);

      // hiddenFrom visibility toggle — cycles null → 'ai' → 'user' → null
      const visLabel = msg.hiddenFrom === 'ai' ? 'Hidden from AI' : msg.hiddenFrom === 'user' ? 'Hidden from display' : '';
      const visBtn = el('button', 'tg-msg-action-btn', { html: icon('eye', 13) });
      visBtn.title = msg.hiddenFrom ? `Visibility: hidden from ${msg.hiddenFrom} (click to cycle)` : 'Toggle visibility (click to hide from AI/display)';
      if (msg.hiddenFrom) visBtn.style.opacity = '0.5';
      visBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const cycle = [null, 'ai', 'user'];
        const currentIdx = cycle.indexOf(msg.hiddenFrom ?? null);
        const nextVal = cycle[(currentIdx + 1) % cycle.length];
        messageHistory[index].hiddenFrom = nextVal;
        await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
        renderMessages();
      });
      actions.appendChild(visBtn);

      const deleteBtn = el('button', 'tg-msg-action-btn tg-msg-action-btn--danger', { html: icon('trash', 13) });
      deleteBtn.title = 'Delete message (the AI will forget this exchange)';
      deleteBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const removed = messageHistory[index];
        const removedIndex = index;
        messageHistory.splice(index, 1);
        await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
        renderMessages();
        updateChrome();

        // M79 hard-delete: prune any auto-extracted facts/beats and
        // user-pinned entries whose source includes the removed
        // message, and clear the cached history summary so the
        // deleted content can't sneak back via the summarised lane.
        // Fire-and-forget — the file write was already durable above.
        if (removed?.id) {
          void pruneMemoryForDeletedMessages(fs, workspaceUri, threadId, [removed.id])
            .catch((err) => console.warn('[TextGenerator] Memory prune failed on delete:', err));
        }

        showToast('Message deleted.', 'Undo', async () => {
          // Restore at original index (clamped if list shrank further).
          // Note: the memory pruning above is NOT un-done here — by the
          // time the user clicks Undo, the AI has likely already seen
          // the pruned state on at least one generation. Re-emitting
          // the same facts would happen organically on the next
          // auto-extract cycle anyway, so we leave it.
          const ix = Math.min(removedIndex, messageHistory.length);
          messageHistory.splice(ix, 0, removed);
          await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
          renderMessages();
          updateChrome();
        });
      });
      actions.appendChild(deleteBtn);

      // Variant navigation (Perchance-style swipe between regenerations)
      if (msg.variants && msg.variants.length > 1) {
        const varNav = el('div', 'tg-variant-nav');
        const vi = msg.variantIndex ?? (msg.variants.length - 1);
        const prevBtn = el('button', 'tg-variant-nav-btn', { text: '‹' });
        prevBtn.title = 'Previous variant';
        prevBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (vi <= 0) return;
          msg.variantIndex = vi - 1;
          msg.content = msg.variants[msg.variantIndex];
          await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
          renderMessages();
        });
        const nextBtn = el('button', 'tg-variant-nav-btn', { text: '›' });
        nextBtn.title = 'Next variant';
        nextBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (vi >= msg.variants.length - 1) return;
          msg.variantIndex = vi + 1;
          msg.content = msg.variants[msg.variantIndex];
          await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
          renderMessages();
        });
        const label = el('span', 'tg-variant-nav-label', { text: `${vi + 1}/${msg.variants.length}` });
        varNav.append(prevBtn, label, nextBtn);
        actions.appendChild(varNav);
      }

    }

    if (msg.author === 'ai' && msg.kind !== 'ooc') {
      const who = msg.characterFile ? getCharacterByFile(msg.characterFile) : null;
      const face = createPortrait(getVisibleName(msg), { size: 32, hue: who ? characterHue(who) : null });
      face.classList.add('tg-msg-face');
      messageEl.appendChild(face);
    }
    const contentWrap = el('div', 'tg-msg-content-wrap');
    contentWrap.appendChild(nameRow);
    const body = el('div', 'tg-msg-body', { html: renderMessageMarkup(msg.content || '') });
    if (isTransient) _transientBodyEl = body;

    // Inline edit logic — shared by double-click and pencil button
    /**
     * The direction for a regenerate, asked before it runs: a line under the
     * message, filled with the instruction the message was made with (the
     * "/ai @Saul goes outside" part), to clarify or clear; Enter or
     * Regenerate runs it, Escape or Cancel closes it. One box at a time.
     */
    function openRegenDirection(msgIndex) {
      const target = messageHistory[msgIndex];
      if (!target) return;
      const open = contentWrap.querySelector('.tg-regen-box');
      if (open) { open.remove(); return; }
      const box = el('div', 'tg-regen-box');
      const input = el('input', 'tg-regen-input');
      input.type = 'text';
      input.value = regenDirectionFor(target);
      input.placeholder = 'Direction for the new version (optional)';
      input.setAttribute('aria-label', 'Direction for the regenerated message');
      const go = el('button', 'tg-msg-edit-save', { html: `${icon('refresh-cw', 12)} Regenerate` });
      go.type = 'button';
      const cancel = el('button', 'tg-msg-edit-cancel', { text: 'Cancel' });
      cancel.type = 'button';
      const run = () => { const direction = input.value.trim(); box.remove(); void regenerateMessage(msgIndex, direction || null); };
      go.addEventListener('click', (e) => { e.stopPropagation(); run(); });
      cancel.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); run(); }
        if (e.key === 'Escape') { e.preventDefault(); box.remove(); }
      });
      box.append(input, go, cancel);
      contentWrap.appendChild(box);
      input.focus();
      input.select();
    }

    function startInlineEdit(bodyEl, msgIndex) {
      if (gen.isGenerating) return;
      if (!messageHistory[msgIndex]) return;
      if (bodyEl.classList.contains('tg-msg-body--editing')) return;

      const currentContent = messageHistory[msgIndex].content || '';
      bodyEl.classList.add('tg-msg-body--editing');
      bodyEl.innerHTML = '';

      const editArea = el('textarea', 'tg-inline-edit-area');
      editArea.value = currentContent;
      bodyEl.appendChild(editArea);

      // Autocomplete button — outside the edit body, in the contentWrap
      // Only shown for AI messages. Positioned below the edit area, far right.
      let autoRow = null;
      const isAiMsg = messageHistory[msgIndex]?.author === 'ai';
      if (isAiMsg) {
        autoRow = el('div', 'tg-inline-auto-row');
        const autoBtn = el('button', 'tg-inline-edit-btn tg-inline-edit-btn--auto', { html: `${icon('px-ai-mark', 12)} Autocomplete` });
        autoBtn.title = 'Save edits and AI continues writing from where the text ends';
        // mousedown preventDefault keeps textarea focused so blur doesn't race
        autoBtn.addEventListener('mousedown', (e) => e.preventDefault());
        autoBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (gen.isGenerating) return;
          // Save edits first
          const editedText = editArea.value;
          if (messageHistory[msgIndex]) {
            messageHistory[msgIndex].content = editedText;
            await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
          }
          // Close edit mode
          closeEdit();
          // Run autocomplete on the saved message
          await runAutocomplete(msgIndex);
        });
        autoRow.appendChild(autoBtn);
        // Insert after bodyEl in contentWrap
        if (bodyEl.nextSibling) {
          contentWrap.insertBefore(autoRow, bodyEl.nextSibling);
        } else {
          contentWrap.appendChild(autoRow);
        }
      }

      requestAnimationFrame(() => {
        editArea.style.height = 'auto';
        editArea.style.height = Math.max(60, editArea.scrollHeight) + 'px';
        editArea.focus();
        editArea.selectionStart = editArea.selectionEnd = editArea.value.length;
      });

      function closeEdit() {
        bodyEl.classList.remove('tg-msg-body--editing');
        bodyEl.innerHTML = renderMessageMarkup(messageHistory[msgIndex]?.content || '');
        if (autoRow) { autoRow.remove(); autoRow = null; }
      }

      async function saveAndClose() {
        const newText = editArea.value;
        if (messageHistory[msgIndex] && newText !== currentContent) {
          messageHistory[msgIndex].content = newText;
          await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
        }
        closeEdit();
      }

      editArea.addEventListener('keydown', (ke) => {
        if (ke.key === 'Escape') {
          ke.preventDefault();
          closeEdit(); // cancel — revert to original
        }
      });
      editArea.addEventListener('blur', () => {
        // Auto-save on blur (click outside)
        setTimeout(() => {
          if (bodyEl.classList.contains('tg-msg-body--editing')) {
            saveAndClose();
          }
        }, 100);
      });
      editArea.addEventListener('input', () => {
        editArea.style.height = 'auto';
        editArea.style.height = Math.max(60, editArea.scrollHeight) + 'px';
      });
    }

    // Autocomplete: save the message, then have AI continue from where it ends
    async function runAutocomplete(msgIndex) {
      const target = messageHistory[msgIndex];
      if (!target || gen.isGenerating) return;
      const textSoFar = target.content;
      if (!textSoFar.trim()) return;
      const continueSpeaker = target.characterFile || await resolveReplySpeaker();
      closeDirections();
      gen.isGenerating = true;
      gen.stopRequested = false;
      gen.transient = { ...target, content: textSoFar + '…' };
      notifyGen(gen, 'state');
      try {
        const historyUpTo = messageHistory.slice(0, msgIndex);
        const { assembled, modelId } = await buildContextForGeneration({
          speaker: continueSpeaker,
          historyOverride: historyUpTo,
        });
        const messagesForApi = assembled.messages.filter(m =>
          !(m.role === 'system' && m.content.startsWith('[Active turn:'))
        );
        messagesForApi.push({
          role: 'system',
          content: '[Continue the following text seamlessly from exactly where it ends. Write ONLY the new continuation — do not repeat any of the existing text. Match the tone, style, and voice perfectly.]',
        });
        messagesForApi.push({ role: 'user', content: textSoFar });
        // Speaker-leak guard rails are the same in the autocomplete
        // path: compute the wrong-speaker name list so stop-tokens +
        // post-strip truncate can defend against the model writing
        // for the wrong character mid-completion.
        const activeName = (target.name || '').toLowerCase();
        const _otherNames = characters
          .map((c) => c.frontmatter?.name || c.fileName.replace(/\.(md|json)$/, ''))
          .filter((n) => n && n.toLowerCase() !== activeName);
        const _userDispName = getUserName();
        if (_userDispName && _userDispName.toLowerCase() !== activeName) _otherNames.push(_userDispName);
        if (activeName !== 'narrator') _otherNames.push('Narrator');
        const stream = parallx.lm.sendChatRequest(modelId, messagesForApi, getGenerationOptions(continueSpeaker, false, _otherNames));
        let fullResponse = '';
        let isThinking = false;
        for await (const chunk of stream) {
          if (gen.stopRequested) break;
          if (chunk.thinking && !chunk.content) {
            if (!isThinking) {
              isThinking = true;
              if (gen.transient) gen.transient.content = textSoFar + ' *Thinking…*';
              notifyGen(gen, 'chunk');
            }
            continue;
          }
          if (chunk.content) {
            isThinking = false;
            fullResponse += chunk.content;
            const speakerName = target.name || '';
            const stripped = stripSpeakerLabel(fullResponse.trimStart(), speakerName, _otherNames);
            const spacer = textSoFar && !textSoFar.endsWith(' ') && stripped && !stripped.startsWith(' ') ? ' ' : '';
            if (gen.transient) gen.transient.content = textSoFar + spacer + stripped;
            notifyGen(gen, 'chunk');
          }
        }
        if (fullResponse.trim()) {
          const speakerName = target.name || '';
          const stripped = stripSpeakerLabel(fullResponse.trim(), speakerName, _otherNames);
          const spacer = textSoFar && !textSoFar.endsWith(' ') && stripped && !stripped.startsWith(' ') ? ' ' : '';
          messageHistory[msgIndex].content = textSoFar + spacer + stripped;
          await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
        }
      } catch (err) {
        console.warn('[TextGenerator] Autocomplete failed:', err);
      } finally {
        gen.transient = null;
        gen.isGenerating = false;
        notifyGen(gen, 'state');
      }
    }

    // Double-click to edit inline (Perchance-style)
    if (!isTransient && index !== null) {
      body.addEventListener('dblclick', (e) => {
        // Double-click naturally selects a word — clear it so the edit opens
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        startInlineEdit(body, index);
      });
      body.style.cursor = 'default';
    }

    contentWrap.appendChild(body);
    if (actions) contentWrap.appendChild(actions);
    messageEl.appendChild(contentWrap);
    messagesEl.appendChild(messageEl);
  }

  function renderMessages() {
    // Scroll preservation: only stick to the bottom if the user was
    // already there (or close). Unconditional scrollTop=scrollHeight on
    // every render meant any reload — file watcher, message action,
    // generation — slammed the view to the bottom mid-read.
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
    const prevScrollTop = messagesEl.scrollTop;
    _transientBodyEl = null;
    messagesEl.innerHTML = '';
    let visibleCount = 0;
    // M79 Phase 5 — `[Active turn: X]` system messages are prompt-builder
    // artifacts (orphans of a partial generation). They're invisible to
    // the AI in subsequent turns but used to appear in the UI as bare
    // bracketed strings whenever the thread had been started but the AI's
    // reply hadn't landed. Hide them from the user transcript here so
    // they no longer pollute the welcome / empty-thread view.
    const isActiveTurnArtifact = (msg) =>
      msg?.role === 'system'
      && typeof msg.content === 'string'
      && msg.content.startsWith('[Active turn:');

    for (let index = 0; index < messageHistory.length; index++) {
      const msg = messageHistory[index];
      if (msg.hiddenFrom === 'user') continue;
      if (isActiveTurnArtifact(msg)) continue;
      visibleCount += 1;
      renderMessageRow(msg, index, false);
    }
    if (gen.transient) {
      renderMessageRow(gen.transient, null, true);
      visibleCount += 1;
    }
    if (visibleCount === 0) {
      const welcome = el('div', 'tg-welcome');
      welcome.appendChild(el('div', 'tg-welcome-name', { text: getCharacterName(characters[0]) }));
      // If the thread has an orphaned `[Active turn:]` artifact (it was
      // mid-generation when something failed), surface that as a friendly
      // hint instead of letting the user see an empty editor that they
      // think is broken.
      const orphan = messageHistory.find(isActiveTurnArtifact);
      welcome.appendChild(el('div', 'tg-welcome-hint', {
        text: orphan
          ? 'A turn was set up but never completed. Send a message to continue, or use the shortcut bar to retry.'
          : 'Start the scene below.',
      }));
      messagesEl.appendChild(welcome);
    }
    if (nearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else {
      messagesEl.scrollTop = prevScrollTop;
    }
  }

  async function buildContextForGeneration({ speaker, userText = '', instruction = null, historyOverride = null, dryRun = false } = {}) {
    const rawId = selectedModelId || thread?.modelId || null;
    const modelId = (rawId && models.some(m => m.id === rawId)) ? rawId : models[0]?.id;
    if (!modelId) throw new Error('No model selected');
    // CRITICAL: this window must equal the num_ctx sent to Ollama. A prompt
    // budgeted larger than num_ctx gets cut from the TOP by Ollama, deleting
    // the system prompt while the UI claims everything fit. So the window is
    // resolved once here and getGenerationOptions sends this same number.
    const contextWindow = await chatContextWindow(modelId);
    lastContextWindow = contextWindow;
    // Lorebooks come from the primary (first) character only. If multi-character
    // chats are introduced, the original character’s lore wins. If the character
    // hasn't picked any books, NO lore is injected — empty selection means none.
    const primaryCharLore = characters[0]?.rawData?.lorebookFiles;
    const lorebooks = Array.isArray(primaryCharLore) && primaryCharLore.length
      ? allLorebooks.filter((book) => primaryCharLore.includes(book.fileName))
      : [];
    const budget = computeTokenBudget(contextWindow, currentSettings);
    // Build recent context string for lorebook trigger matching (last ~10 messages + user text).
    // Filter out AI-hidden messages so triggers can't fire on text the AI is forbidden from seeing.
    const baseHistory = historyOverride || messageHistory;
    const recentForTriggers = baseHistory
      .slice(-10)
      .filter((m) => m.hiddenFrom !== 'ai')
      .map((m) => m.content || '')
      .join('\n') + (userText ? '\n' + userText : '');
    // M79 Phase 2 — lorebook activation now also considers structured
    // scene state and the present-character roster, enabling
    // `scope: scene:X` / `scope: character:X` entries.
    const presentCharNames = characters
      .map((c) => c?.frontmatter?.name || c?.fileName?.replace(/\.(md|json)$/, ''))
      .filter(Boolean);
    const loreActivation = {
      sceneState: thread?.sceneState || null,
      presentCharNames,
    };
    const loreContent = assembleLoreContent(lorebooks, budget.lore, recentForTriggers, loreActivation);
    const loreDebug = debugLorebookTriggers(lorebooks, recentForTriggers);
    // M79 Phase 1 — combine legacy memories.md with auto-extracted
    // semantic facts (always-on, grouped by category) and episodic
    // beats (recency × importance, trimmed to lane budget). The
    // existing memories.md file is preserved verbatim and surfaces
    // ahead of structured memory so users who edited it directly
    // still see their notes used.
    // The memory file: Facts and Notes go into every prompt. The Timeline
    // travels with the earlier-in-the-story block below, only once turns
    // have dropped out of the live window.
    const memoryParts = await loadThreadMemory(fs, workspaceUri, threadId);
    const memoryContent = renderMemoryChannel({
      legacyMemory: memoryParts.notes,
      semantic: memoryParts.facts,
      episodic: [],
      timeline: memoryParts.beats,
      budgetTokens: Infinity,
    });
    // When userText is provided, exclude the last history entry (the same message)
    // so it routes through the dedicated user budget lane instead of competing with history.
    const effectiveHistory = userText ? baseHistory.slice(0, -1) : baseHistory;

    // Real summarisation for fitMessagesInContextMethod = 'summarizeOld'.
    // We only call the LLM when (a) the character requests it, (b) messages
    // would actually be dropped, and (c) the cached summary is stale (the
    // dropped-message count grew). This keeps the cost to one extra call per
    // turn — and zero on most turns where the cache is hit.
    let historySummary = '';
    const primaryChar = characters[0] || null;
    const fitMethod = primaryChar?.frontmatter?.fitMessagesInContextMethod
      || currentSettings?.defaultFitMethod
      || 'dropOld';
    if (fitMethod === 'summarizeOld' && effectiveHistory.length > 0) {
      // No summariser. What falls out of the live window is stood in for by
      // the memory file's Timeline and by the dropped turns that bear on
      // what is being said now, quoted word for word. No model call.
      try {
        const previewMessages = effectiveHistory.map((m, i) => ({
          role: mapAuthorToRole(m.author || m.role, m),
          turn: i + 1,
          name: (m.author === 'user' && !m.characterFile) ? getUserName() : (m.name || ''),
          raw: m.content || '',
          content: (m.author === 'user' && !m.characterFile) ? `${getUserName()}: ${m.content || ''}` : (m.name ? `${m.name}: ${m.content || ''}` : (m.content || '')),
        })).filter(m => m.content);
        const estCharTokens = 1000; // safe over-estimate; refined below if available
        const floorPreview = applyHistoryFloor(budget, estCharTokens);
        const dropped = computeDroppedMessages(previewMessages, floorPreview.effectiveHistory);
        if (dropped.length > 0) {
          const said = [userText || '', ...effectiveHistory.slice(-2).map((m) => m.content || '')].join('\n');
          const excerpts = rankExcerpts(dropped.map((m) => ({ turn: m.turn, name: m.name, content: m.raw })), said, 5);
          // The Timeline's tail is already in the memory block; here only the quoted turns.
          historySummary = earlierBlock({ beats: [], excerpts });
        }
      } catch (err) {
        console.warn('[TextGenerator] Earlier-in-the-story block failed:', err);
      }
    }

    // Resolve every speaker-specific setting from whoever was clicked
    // to speak. Falls back through: speakerChar → thread settings (NYI
    // — currently inherited from primary) → global defaults. The
    // earlier code passed primaryChar's writingPreset / pov / length
    // here, so every speaker in a multi-character thread inherited
    // the first character's prompt regardless of their own card.
    const speakerCharLocal = (speaker && speaker !== SELF_SPEAKER && speaker !== NARRATOR_SPEAKER)
      ? characters.find((c) =>
          c.fileName === speaker
          || (c.frontmatter?.name || '').toLowerCase() === String(speaker).toLowerCase())
      : null;

    const resolvedWritingPreset = speakerCharLocal?.frontmatter?.writingPreset
      || currentSettings?.defaultWritingPreset
      || 'immersive-rp';
    const resolvedPov = speakerCharLocal?.frontmatter?.pov
      || currentSettings?.defaultPov
      || '';

    const assembled = assembleContext({
      characters,
      writingPreset: resolvedWritingPreset,
      pov: resolvedPov,
      loreContent,
      memoryContent,
      history: effectiveHistory,
      userMessage: userText,
      contextWindow,
      userName: getUserName(),
      respondAs: speaker,
      // Global default response length now actually reaches assembly.
      // It was hardcoded `null` here, so the Settings-page default was
      // dead wiring while the diagnostics claimed it applied.
      responseLength: currentSettings?.defaultResponseLength || null,
      settings: currentSettings,
      ephemeralInstruction: instruction,
      historySummary,
      sceneState: thread?.sceneState || null, // M79 Phase 3a
      writingPresetOverride: thread?.writingPresetOverride || '',
      responseLengthOverride: thread?.responseLengthOverride || '',
      standingNote: thread?.standingNote || '',
      supportingCast: supportingCards,
      connectedPeople: connectedCards,
    });
    // Annotate with diagnostic info the inspect modal + token chip surface.
    // All `*Source` labels reference the SPEAKER character (or
    // global default fallback), matching the speaker-aware resolution
    // above. Previously these reported primaryChar regardless of who
    // was actually speaking, which obscured the bug.
    assembled.loreDebug = loreDebug;
    const charLenLimit = speakerCharLocal?.frontmatter?.messageLengthLimit;
    const threadLenOverride = thread?.responseLengthOverride || '';
    if (threadLenOverride) {
      assembled.responseLengthSource = threadLenOverride === 'none'
        ? 'chat override (no limit)'
        : `chat override (${threadLenOverride})`;
    } else if (charLenLimit) {
      assembled.responseLengthSource = `character (${speakerCharLocal.frontmatter.name || 'character'}: ${charLenLimit})`;
    } else if (currentSettings?.defaultResponseLength) {
      assembled.responseLengthSource = `global default (${currentSettings.defaultResponseLength})`;
    } else {
      assembled.responseLengthSource = 'unset';
    }
    assembled.fitMethodSource = speakerCharLocal?.frontmatter?.fitMessagesInContextMethod
      ? `character (${speakerCharLocal.frontmatter.name || 'character'})`
      : (primaryChar?.frontmatter?.fitMessagesInContextMethod
          ? `primary (${primaryChar.frontmatter.name || 'character'})`
          : (currentSettings?.defaultFitMethod ? 'global default' : 'fallback'));
    assembled.activeFitMethod = fitMethod;
    // POV cascade now mirrors the speaker-aware resolution.
    if (speakerCharLocal?.frontmatter?.pov) {
      assembled.povSource = `character (${POV_OPTIONS[speakerCharLocal.frontmatter.pov]?.label || speakerCharLocal.frontmatter.pov})`;
    } else if (currentSettings?.defaultPov) {
      assembled.povSource = `global default (${POV_OPTIONS[currentSettings.defaultPov]?.label || currentSettings.defaultPov})`;
    } else {
      assembled.povSource = 'inherit (preset decides)';
    }
    assembled.writingPresetSource = thread?.writingPresetOverride
      ? `chat override (${thread.writingPresetOverride})`
      : (speakerCharLocal?.frontmatter?.writingPreset
          ? `character (${speakerCharLocal.frontmatter.name || 'character'}: ${speakerCharLocal.frontmatter.writingPreset})`
          : (currentSettings?.defaultWritingPreset
              ? `global default (${currentSettings.defaultWritingPreset})`
              : 'fallback (immersive-rp)'));
    lastAssembledContext = assembled;
    selectedModelId = modelId;
    updateChrome();
    return { assembled, modelId };
  }

  function getGenerationOptions(speaker, asUser = false, knownOtherNames = []) {
    const character = !asUser && speaker && speaker !== NARRATOR_SPEAKER ? getCharacterByFile(speaker) : null;
    const maxTokens = character?.frontmatter.maxTokensPerMessage ?? currentSettings?.defaultMaxTokens ?? undefined;

    // M-fix-5 — defensive stop tokens. If the model starts emitting a
    // tag for a different character (`<<Other>>` or `\nOther:`), halt
    // generation at that boundary. Ollama treats `stop` as exact
    // substrings; we ship a small canonical set per other-character
    // name plus the legacy colon shape. Empty list → no stop tokens.
    const stop = [];
    for (const otherName of (knownOtherNames || [])) {
      if (!otherName || typeof otherName !== 'string') continue;
      stop.push(`<<${otherName}>>`);
      stop.push(`\n${otherName}:`);
    }

    // The window buildContextForGeneration just budgeted the prompt to; every
    // caller builds the context first, so the two never differ.
    const numCtx = lastContextWindow || undefined;

    return {
      think: true,
      temperature: character?.frontmatter.temperature ?? currentSettings?.defaultTemperature ?? 0.8,
      ...(maxTokens ? { maxTokens } : {}),
      ...(stop.length > 0 ? { stop } : {}),
      numCtx,
    };
  }

  function pickNextCharacter(lastCharFile) {
    const files = characters.map((char) => char.fileName);
    if (files.length === 0) return null;
    if (files.length === 1) return files[0];
    const lastIndex = files.indexOf(lastCharFile);
    return files[lastIndex === -1 ? 0 : (lastIndex + 1) % files.length];
  }

  /**
   * AI-driven turn selection for group chats.
   * Asks the model which character should speak next based on recent context.
   * Falls back to round-robin if the model call fails or returns an unrecognizable name.
   */
  async function pickNextCharacterSmart(lastCharFile) {
    const files = characters.map((char) => char.fileName);
    if (files.length <= 2) return pickNextCharacter(lastCharFile);
    // Only attempt AI turn selection if thread opts in
    if (!thread?.smartTurnOrder) return pickNextCharacter(lastCharFile);

    const modelId = selectedModelId || thread?.modelId || models[0]?.id;
    if (!modelId || !parallx.lm) return pickNextCharacter(lastCharFile);

    const charNames = characters.map(c => c.frontmatter.name || c.fileName.replace(/\.(md|json)$/, ''));
    const recentLines = messageHistory.slice(-6).map(m => `${m.name}: ${(m.content || '').slice(0, 200)}`).join('\n');

    try {
      const prompt = [
        { role: 'system', content: `You are a turn-order selector for a group roleplay. Available characters: ${charNames.join(', ')}. The last speaker was "${lastCharFile ? (characters.find(c => c.fileName === lastCharFile)?.frontmatter.name || lastCharFile) : 'unknown'}". Based on the recent conversation, reply with ONLY the name of the character who should speak next. Do not add any explanation.` },
        { role: 'user', content: recentLines || '(conversation just started)' },
      ];
      const stream = parallx.lm.sendChatRequest(modelId, prompt, { temperature: 0.3, maxTokens: 30 });
      let response = '';
      for await (const chunk of stream) {
        if (chunk.content) response += chunk.content;
      }
      const picked = response.trim().replace(/^"|"$/g, '');
      const resolved = resolveCharacterReference(picked);
      if (resolved && resolved !== NARRATOR_SPEAKER && files.includes(resolved)) {
        return resolved;
      }
    } catch { /* fall through to round-robin */ }

    return pickNextCharacter(lastCharFile);
  }


  async function resolveReplySpeaker(selection = selectedReplySpeaker) {
    if (selection === NARRATOR_SPEAKER) return NARRATOR_SPEAKER;
    if (selection) return selection;
    const lastCharacterTurn = [...messageHistory].reverse().find((msg) => msg.characterFile)?.characterFile;
    return pickNextCharacterSmart(lastCharacterTurn || characters[0]?.fileName);
  }

  function resolveCharacterReference(nameOrFile) {
    const raw = String(nameOrFile || '').trim().replace(/^@/, '');
    if (!raw) return null;
    const lowered = raw.toLowerCase();
    if (lowered === 'narrator' || lowered === 'nar') return NARRATOR_SPEAKER;
    const exact = characters.find((char) =>
      char.fileName.toLowerCase() === lowered ||
      char.fileName.replace(/\.(md|json)$/, '').toLowerCase() === lowered ||
      (char.frontmatter.name || '').toLowerCase() === lowered
    );
    if (exact) return exact.fileName;
    const fuzzy = characters.find((char) =>
      (char.frontmatter.name || '').toLowerCase().startsWith(lowered) ||
      char.fileName.toLowerCase().startsWith(lowered)
    );
    return fuzzy?.fileName || null;
  }

  function buildHumanMessage(text) {
    // M79 Phase 4a — OOC mode: message is logged but never reaches the AI.
    // The kind:'ooc' flag drives the muted "Backstage" styling in
    // renderMessageRow.
    const hiddenFrom = oocMode ? 'ai' : null;
    const kind = oocMode ? 'ooc' : undefined;
    if (!selectedComposeSpeaker || selectedComposeSpeaker === SELF_SPEAKER) {
      return {
        author: 'user',
        name: getUserName(),
        characterFile: null,
        content: text,
        timestamp: Date.now(),
        generatedBy: 'human',
        hiddenFrom,
        ...(kind ? { kind } : {}),
      };
    }
    return {
      author: 'user',
      name: getCharacterName(selectedComposeSpeaker),
      characterFile: selectedComposeSpeaker,
      content: text,
      timestamp: Date.now(),
      generatedBy: 'human',
      hiddenFrom,
      ...(kind ? { kind } : {}),
    };
  }

  function buildGeneratedTurnMessage(content, speaker, instruction, asUser = false) {
    if (asUser) {
      return {
        author: 'user',
        name: getComposeSelectionLabel(speaker),
        characterFile: speaker && speaker !== SELF_SPEAKER ? speaker : null,
        content,
        timestamp: Date.now(),
        generatedBy: 'model',
        hiddenFrom: null,
        instruction: instruction || null,
      };
    }
    return {
      author: 'ai',
      name: speaker === NARRATOR_SPEAKER ? 'Narrator' : getCharacterName(speaker),
      characterFile: speaker === NARRATOR_SPEAKER ? null : speaker,
      content,
      timestamp: Date.now(),
      generatedBy: 'model',
      hiddenFrom: null,
      instruction: instruction || null,
    };
  }

  /** Strip a leading speaker label (e.g. "Ada Lovelace: ...") from model output.
   *  Handles variable whitespace, bold formatting, and regex-special characters. */
  /**
   * Strip speaker labels from a generated reply.
   *
   * Three classes of leakage to handle:
   *   1. Leading `Name:` or `<<Name>>` echoes the active speaker.
   *      Strip them — the interface adds the label.
   *   2. Mid-message `<<OtherName>>` / `OtherName:` lines: the model
   *      started writing for someone else. Truncate the response at
   *      that boundary so the wrong-character content never gets
   *      stored. Standard production-RP guard.
   *   3. Stray `<<Name>>` for the ACTIVE speaker mid-message (an
   *      internal echo): just strip those tags, don't truncate.
   *
   * Takes `knownOtherNames` so we know which mid-message labels are
   * "wrong" (someone else) vs "internal echo of self" — caller passes
   * the list of all characters in the thread minus the active speaker.
   */
  function stripSpeakerLabel(text, speakerName, knownOtherNames = []) {
    if (!text) return text;

    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. Strip leading active-speaker labels in both formats.
    if (speakerName) {
      const escaped = escape(speakerName);
      // Match: optional **bold**, the chevron form or colon form, optional whitespace
      const leadingChevron = new RegExp(`^\\s*<<${escaped}>>\\s*\\n?`, 'i');
      const leadingColon = new RegExp(`^\\**${escaped}\\**\\s*:\\s*`, 'i');
      text = text.replace(leadingChevron, '').replace(leadingColon, '');
    }

    // 2. Truncate at the first mid-message tag belonging to someone
    //    else. We look for `<<OtherName>>` (the new format) and the
    //    legacy `OtherName:` at line start. Truncating (not stripping)
    //    matters: anything the model wrote AFTER the wrong tag is
    //    almost certainly content authored as that other character.
    if (Array.isArray(knownOtherNames) && knownOtherNames.length > 0) {
      let earliestCut = -1;
      for (const other of knownOtherNames) {
        if (!other) continue;
        const escOther = escape(other);
        // <<Other>> anywhere from a line start (or after a newline).
        const chevRe = new RegExp(`(^|\\n)\\s*<<${escOther}>>`, 'i');
        const m1 = text.match(chevRe);
        if (m1) {
          const idx = m1.index + (m1[1] ? m1[1].length : 0);
          if (earliestCut === -1 || idx < earliestCut) earliestCut = idx;
        }
        // Other: at line start. Only accept when there's at least one
        // word character of dialogue/narration before the colon to
        // avoid eating common in-prose patterns like "Note: ..." or
        // a character self-quoting "He said, 'Friend: '...".
        const colonRe = new RegExp(`\\n\\s*\\**${escOther}\\**\\s*:\\s*`, 'i');
        const m2 = text.match(colonRe);
        if (m2 && typeof m2.index === 'number') {
          const idx = m2.index;
          if (earliestCut === -1 || idx < earliestCut) earliestCut = idx;
        }
      }
      if (earliestCut > 0) {
        text = text.slice(0, earliestCut).trimEnd();
      }
    }

    // 3. Strip stray mid-message tags for the active speaker (just an
    //    internal echo — not a wrong-character signal).
    if (speakerName) {
      const escaped = escape(speakerName);
      text = text.replace(new RegExp(`(^|\\n)\\s*<<${escaped}>>\\s*\\n?`, 'gi'), '$1');
    }

    // Every model-output path (generate, continue, autocomplete; both
    // streaming and final) flows through this function, so the
    // no-em-dash guard rides here to cover all of them at once.
    text = stripEmDashes(text);

    return text;
  }

  async function generateTurn({ speaker = null, instruction = null, asUser = false, userText = '' } = {}) {
    if (gen.isGenerating || characters.length === 0 || !parallx.lm) return;
    const effectiveSpeaker = speaker || (asUser ? selectedComposeSpeaker : await resolveReplySpeaker());
    if (!effectiveSpeaker) return;
    // Director's note field feeds every generation path that doesn't
    // carry an explicit instruction already (plain send, empty send,
    // shortcut buttons, regenerate). Explicit /ai instructions win.
    if (!instruction) instruction = consumeDirectorNote();
    closeDirections();

    gen.isGenerating = true;
    gen.stopRequested = false;
    gen.lastError = null;
    gen.transient = buildGeneratedTurnMessage('', effectiveSpeaker, instruction, asUser);
    notifyGen(gen, 'state');

    try {
      const { assembled, modelId } = await buildContextForGeneration({
        speaker: effectiveSpeaker,
        userText,
        instruction,
      });
      const messagesForApi = [...assembled.messages];
      if (asUser) {
        messagesForApi.push({
          role: 'system',
          content: `[Draft the next user-authored message as ${getComposeSelectionLabel(effectiveSpeaker)}. Return only the message content.]`,
        });
      }
      // Compute the wrong-speaker name list ONCE per generation. Used
      // by stripSpeakerLabel to truncate the response at any line
      // that starts speaking as someone other than the active turn.
      // We include all OTHER characters in the thread + the user's
      // current display name + the Narrator special speaker — these
      // are every label the model could legitimately emit but isn't
      // allowed to write a turn for right now.
      const activeName = (gen.transient?.name || '').toLowerCase();
      const _knownOtherNames = characters
        .map((c) => c.frontmatter?.name || c.fileName.replace(/\.(md|json)$/, ''))
        .filter((n) => n && n.toLowerCase() !== activeName);
      const _userDisplayName = getUserName();
      if (_userDisplayName && _userDisplayName.toLowerCase() !== activeName) {
        _knownOtherNames.push(_userDisplayName);
      }
      if (activeName !== 'narrator') _knownOtherNames.push('Narrator');

      const _genOpts = getGenerationOptions(effectiveSpeaker, asUser, _knownOtherNames);
      const stream = parallx.lm.sendChatRequest(modelId, messagesForApi, _genOpts);
      let fullResponse = '';
      let isThinking = false;
      let doneReason = '';

      for await (const chunk of stream) {
        if (gen.stopRequested) break;
        if (chunk?.done && chunk.doneReason) doneReason = chunk.doneReason;
        if (chunk.thinking && !chunk.content) {
          if (!isThinking) {
            isThinking = true;
            if (gen.transient) gen.transient.content = '*Thinking…*';
            notifyGen(gen, 'chunk');
          }
          continue;
        }
        if (chunk.content) {
          isThinking = false;
          fullResponse += chunk.content;
          // Strip leading speaker label during streaming + hide any
          // partially-streamed <scene-update/> tag so the user never
          // sees the control signal flash in the message.
          const speakerName = gen.transient?.name || '';
          const visible = stripSpeakerLabel(fullResponse.trimStart(), speakerName, _knownOtherNames)
            .replace(SCENE_TAG_REGEX, '')
            // Suppress an in-flight partial tag (model just started
            // emitting `<scene-` but hasn't closed the bracket yet).
            .replace(/<scene-update\b[^>]*$/i, '');
          if (gen.transient) gen.transient.content = visible;
          notifyGen(gen, 'chunk');
        }
      }

      if (fullResponse.trim()) {
        // Strip leading speaker label the model may echo (e.g. "Ada Lovelace: ...")
        // and truncate at any wrong-speaker label that snuck in.
        const speakerName = gen.transient?.name || '';
        let cleaned = stripSpeakerLabel(fullResponse.trim(), speakerName, _knownOtherNames);

        // M79 Phase 3a — parse and strip any <scene-update/> tag the
        // model emitted. The tag is a control signal and never reaches
        // the user-facing message. The parsed update is merged into
        // thread.sceneState so the next generation sees the new
        // context.
        const sceneParse = extractSceneUpdate(cleaned);
        cleaned = sceneParse.cleaned;
        if (sceneParse.update) {
          thread.sceneState = mergeSceneState(thread?.sceneState || {}, sceneParse.update);
          void updateThreadMeta(fs, workspaceUri, threadId, { sceneState: thread.sceneState })
            .catch((err) => console.warn('[TextGenerator] Failed to save scene state:', err));
        }

        const finalMessage = buildGeneratedTurnMessage(cleaned, effectiveSpeaker, instruction, asUser);
        messageHistory.push(finalMessage);
        await appendMessage(fs, workspaceUri, threadId, finalMessage);

        // The model ran out of room (its token limit, or the context
        // window) and stopped mid-reply. Say so, instead of leaving a reply
        // that simply ends, and offer to carry it on.
        if (doneReason === 'length' && !gen.stopRequested) {
          console.warn('[TextGenerator] Reply stopped at the length limit (done_reason "length").', { maxTokens: _genOpts.maxTokens, numCtx: _genOpts.numCtx });
          showToast(
            _genOpts.maxTokens
              ? `This reply hit the ${_genOpts.maxTokens}-token limit and was cut off.`
              : 'This reply ran out of room in the context window and was cut off.',
            'Continue',
            () => void handleSlashCommand({ command: 'continue' }),
            10000,
          );
        }

        // M79 Phase 5 — auto-title also fires after the FIRST AI
        // reply so AI-led / template-seeded chats (no user message
        // yet) don't stay "New Chat" forever in the sidebar.
        if (thread.title === 'New Chat'
            && messageHistory.filter((m) => m.author === 'user' && m.kind !== 'ooc').length === 0
            && finalMessage.content) {
          const autoTitle = finalMessage.content.length > 48
            ? finalMessage.content.slice(0, 48) + '…'
            : finalMessage.content;
          thread.title = autoTitle;
          void updateThreadMeta(fs, workspaceUri, threadId, { title: autoTitle })
            .catch((err) => console.warn('[TextGenerator] Failed to auto-title from AI reply:', err));
          _refreshSidebar?.();
        }

        // M79 Phase 1 — fire-and-forget memory extraction every N
        // user/AI exchanges. Counts only AI-visible message pairs so
        // hidden/OOC entries don't trigger early extractions. The call
        // runs in the background; failure is logged and ignored.
        void _maybeAutoExtractMemory();
      }
    } catch (err) {
      gen.lastError = err;
      const errorMessage = {
        author: 'system',
        name: 'System',
        content: 'Error: ' + (err.message || String(err)),
        timestamp: Date.now(),
        generatedBy: 'human',
        hiddenFrom: 'ai',
      };
      messageHistory.push(errorMessage);
      await appendMessage(fs, workspaceUri, threadId, errorMessage);
    } finally {
      gen.transient = null;
      gen.isGenerating = false;
      notifyGen(gen, 'state');
    }
  }

  async function handleSlashCommand(cmd) {
    switch (cmd.command) {
      case 'ai': {
        const requestedSpeaker = cmd.targetCharacter ? resolveCharacterReference(cmd.targetCharacter) : selectedReplySpeaker;
        const nextSpeaker = requestedSpeaker || await resolveReplySpeaker();
        await generateTurn({ speaker: nextSpeaker, instruction: cmd.instruction || null });
        break;
      }
      case 'continue': {
        // Find the last AI-generated message to continue from
        const lastAiIndex = messageHistory.length - 1 - [...messageHistory].reverse().findIndex(m => m.generatedBy === 'model');
        if (lastAiIndex < 0 || lastAiIndex >= messageHistory.length) {
          const errMsg = { author: 'system', name: 'System', content: 'No AI message to continue.', timestamp: Date.now(), generatedBy: 'human', hiddenFrom: 'ai' };
          messageHistory.push(errMsg);
          await appendMessage(fs, workspaceUri, threadId, errMsg);
          renderMessages();
          break;
        }
        const lastAiMsg = messageHistory[lastAiIndex];
        const continueSpeaker = lastAiMsg.characterFile || await resolveReplySpeaker();
        // Generate continuation using history up to (but not including) the last AI message,
        // plus the existing content as a partial assistant response
        if (gen.isGenerating || characters.length === 0 || !parallx.lm) break;
        closeDirections();
        gen.isGenerating = true;
        gen.stopRequested = false;
        gen.transient = { ...lastAiMsg, content: lastAiMsg.content + '…' };
        notifyGen(gen, 'state');
        try {
          const historyUpTo = messageHistory.slice(0, lastAiIndex);
          const { assembled, modelId } = await buildContextForGeneration({
            speaker: continueSpeaker,
            historyOverride: historyUpTo,
            instruction: cmd.args || null,
          });
          // Use assembled context but replace turn cue with continuation instruction
          const messagesForApi = assembled.messages.filter(m =>
            !(m.role === 'system' && m.content.startsWith('[Active turn:'))
          );
          messagesForApi.push({
            role: 'system',
            content: '[Continue the following text seamlessly from exactly where it ends. Write ONLY the new continuation — do not repeat any of the existing text. Match the tone, style, and voice perfectly.]',
          });
          messagesForApi.push({ role: 'user', content: lastAiMsg.content });
          // Speaker-leak guard rails in the /continue path too: build
          // the wrong-speaker list so stop-tokens halt at any tag for
          // a different character and post-strip can truncate if the
          // model slips through.
          const _activeName = (lastAiMsg.name || '').toLowerCase();
          const _otherNames = characters
            .map((c) => c.frontmatter?.name || c.fileName.replace(/\.(md|json)$/, ''))
            .filter((n) => n && n.toLowerCase() !== _activeName);
          const _userDispName = getUserName();
          if (_userDispName && _userDispName.toLowerCase() !== _activeName) _otherNames.push(_userDispName);
          if (_activeName !== 'narrator') _otherNames.push('Narrator');
          const stream = parallx.lm.sendChatRequest(modelId, messagesForApi, getGenerationOptions(continueSpeaker, false, _otherNames));
          let fullResponse = '';
          let isThinking = false;
          for await (const chunk of stream) {
            if (gen.stopRequested) break;
            if (chunk.thinking && !chunk.content) {
              if (!isThinking) {
                isThinking = true;
                if (gen.transient) gen.transient.content = lastAiMsg.content + ' *Thinking…*';
                notifyGen(gen, 'chunk');
              }
              continue;
            }
            if (chunk.content) {
              isThinking = false;
              fullResponse += chunk.content;
              const speakerName = lastAiMsg.name || '';
              const stripped = stripSpeakerLabel(fullResponse.trimStart(), speakerName, _otherNames);
              const spacer = lastAiMsg.content && !lastAiMsg.content.endsWith(' ') && stripped && !stripped.startsWith(' ') ? ' ' : '';
              if (gen.transient) gen.transient.content = lastAiMsg.content + spacer + stripped;
              notifyGen(gen, 'chunk');
            }
          }
          if (fullResponse.trim()) {
            const speakerName = lastAiMsg.name || '';
            const stripped = stripSpeakerLabel(fullResponse.trim(), speakerName, _otherNames);
            const spacer = lastAiMsg.content && !lastAiMsg.content.endsWith(' ') && stripped && !stripped.startsWith(' ') ? ' ' : '';
            messageHistory[lastAiIndex].content = lastAiMsg.content + spacer + stripped;
            await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
          }
        } catch (err) {
          const errorMessage = { author: 'system', name: 'System', content: 'Error: ' + (err.message || String(err)), timestamp: Date.now(), generatedBy: 'human', hiddenFrom: 'ai' };
          messageHistory.push(errorMessage);
          await appendMessage(fs, workspaceUri, threadId, errorMessage);
        } finally {
          gen.transient = null;
          gen.isGenerating = false;
          notifyGen(gen, 'state');
        }
        break;
      }
      case 'user': {
        await generateTurn({
          speaker: selectedComposeSpeaker || SELF_SPEAKER,
          instruction: cmd.instruction || cmd.args || null,
          asUser: true,
        });
        break;
      }
      case 'sys': {
        const systemMessage = {
          author: 'system',
          name: cmd.targetCharacter || 'System',
          content: cmd.instruction || cmd.args,
          timestamp: Date.now(),
          generatedBy: 'human',
          hiddenFrom: null,
        };
        messageHistory.push(systemMessage);
        await appendMessage(fs, workspaceUri, threadId, systemMessage);
        renderMessages();
        break;
      }
      case 'nar': {
        // /nar is shorthand for /sys @Narrator — always triggers AI generation.
        // Optional instruction guides the narrator's response style/content.
        await generateTurn({ speaker: NARRATOR_SPEAKER, instruction: cmd.instruction || cmd.args || null });
        break;
      }
      case 'name': {
        if (cmd.args) {
          thread.userName = cmd.args.trim();
          await updateThreadMeta(fs, workspaceUri, threadId, { userName: thread.userName });
          await propagateUserName(thread.userName);
          if (selectedComposeSpeaker === SELF_SPEAKER) renderTurnControls();
          renderMessages();
          updateChrome();
        }
        break;
      }
      case 'mem': {
        try {
          await parallx.editors.openFileEditor(resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/memories.md`));
        } catch (err) { console.warn('[TextGenerator] Could not open memories editor:', err); }
        break;
      }
      case 'lore': {
        const primaryCharLore = characters[0]?.rawData?.lorebookFiles;
        const activeLorebooks = Array.isArray(primaryCharLore) && primaryCharLore.length
          ? allLorebooks.filter((book) => primaryCharLore.includes(book.fileName))
          : [];
        const lorebook = activeLorebooks[0] || allLorebooks[0];
        if (!lorebook) break;
        const lorePath = resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks/${lorebook.fileName}`);
        if (cmd.args) {
          const existing = await fs.readFile(lorePath);
          await fs.writeFile(lorePath, existing.content + `\n\n## ${cmd.args}`);
          allLorebooks = await scanLorebooks(fs, workspaceUri);
        } else {
          try { await parallx.editors.openFileEditor(lorePath); } catch (err) { console.warn('[TextGenerator] Could not open lorebook editor:', err); }
        }
        break;
      }
      default: {
        const fallback = buildHumanMessage(`/${cmd.command}${cmd.args ? ' ' + cmd.args : ''}`);
        messageHistory.push(fallback);
        await appendMessage(fs, workspaceUri, threadId, fallback);
        renderMessages();
      }
    }
    updateChrome();
  }

  async function handleUserInput(text) {
    if (!text.trim()) return;
    const slashCommand = parseSlashCommand(text);
    if (slashCommand) {
      await handleSlashCommand(slashCommand);
      return;
    }

    const lines = text.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    let inlineInstruction = null;
    // A trailing "/ai @Name note" also says who replies, as it does on its
    // own; the name used to be left in the note and the speaker guessed.
    // A trailing "/nar note" (a Narrator direction) hands the next turn to
    // the Narrator the same way.
    let inlineSpeaker = null;
    let messageText = text;
    if (lines.length > 1 && lastLine.startsWith('/ai ')) {
      const trailing = parseSlashCommand(lastLine);
      inlineInstruction = trailing ? trailing.instruction : lastLine.slice(4).trim();
      inlineSpeaker = trailing?.targetCharacter ? resolveCharacterReference(trailing.targetCharacter) : null;
      messageText = lines.slice(0, -1).join('\n').trim();
    } else if (lines.length > 1 && lastLine.startsWith('/nar ')) {
      inlineInstruction = lastLine.slice(5).trim() || null;
      inlineSpeaker = NARRATOR_SPEAKER;
      messageText = lines.slice(0, -1).join('\n').trim();
    }

    if (!messageText && (inlineInstruction || inlineSpeaker)) {
      await generateTurn({ speaker: inlineSpeaker || await resolveReplySpeaker(selectedReplySpeaker), instruction: inlineInstruction || null });
      return;
    }

    const userMessage = buildHumanMessage(messageText);
    messageHistory.push(userMessage);
    await appendMessage(fs, workspaceUri, threadId, userMessage);

    // M79 Phase 4a — OOC messages don't count toward auto-title (they
    // shouldn't name the chat after a backstage note) and don't
    // trigger the auto-reply path.
    const wasOocMessage = userMessage.kind === 'ooc';

    if (!wasOocMessage && thread.title === 'New Chat' && messageHistory.filter((msg) => msg.hiddenFrom !== 'user' && msg.kind !== 'ooc').length <= 1) {
      const autoTitle = messageText.length > 48 ? messageText.slice(0, 48) + '…' : messageText;
      thread.title = autoTitle;
      await updateThreadMeta(fs, workspaceUri, threadId, { title: autoTitle });
      _refreshSidebar?.();
    }

    renderMessages();
    updateChrome();

    // OOC is a one-shot toggle: switch off after the message lands so
    // the user has to opt back in for the next note. Matches how
    // single-key affordances feel in chat surfaces.
    if (wasOocMessage) setOocMode(false);

    // Honor autoReply toggle and expectsReply on the last message.
    // OOC messages never trigger generation — the whole point is that
    // the AI doesn't see them.
    if (!wasOocMessage && thread?.autoReply !== false) {
      const lastMsg = messageHistory[messageHistory.length - 1];
      if (lastMsg?.expectsReply !== false) {
        await generateTurn({ speaker: inlineSpeaker || await resolveReplySpeaker(selectedReplySpeaker), instruction: inlineInstruction || null, userText: messageText });
      }
    }
  }

  async function seedInitialMessagesIfNeeded(savedMessages) {
    if (savedMessages.length > 0 || characters.length === 0) return savedMessages;
    const primary = characters[0];
    const primaryName = getCharacterName(primary);
    const seeded = (primary.initialMessages || []).map((msg) => ({
      author: msg.role === 'assistant' ? 'ai' : msg.role === 'user' ? 'user' : 'system',
      name: msg.name || (msg.role === 'assistant' ? primaryName : msg.role === 'user' ? getUserName() : 'System'),
      characterFile: msg.role === 'assistant' ? primary.fileName : null,
      content: substituteVars(msg.content, primaryName, getUserName()),
      timestamp: Date.now(),
      generatedBy: 'template',
      hiddenFrom: msg.visibility === 'ai-only' ? 'user' : msg.visibility === 'user-only' ? 'ai' : null,
      expectsReply: msg.expectsReply !== false,
    }));
    if (seeded.length > 0) {
      await rewriteMessages(fs, workspaceUri, threadId, seeded);
    }
    return seeded;
  }

  async function reloadThreadState({ includeMessages = true } = {}) {
    if (!fs || !workspaceUri) return;
    currentSettings = await loadSettings(fs, workspaceUri);
    thread = await loadThread(fs, workspaceUri, threadId);
    allLorebooks = await scanLorebooks(fs, workspaceUri);

    const loadedCharacters = [];
    let threadNeedsUpdate = false;
    for (const charRef of thread.characters) {
      try {
        // Try .json first, then fall back to .md
        const jsonName = charRef.file.replace(/\.md$/, '.json');
        const jsonPath = resolveUri(workspaceUri, `${EXT_ROOT}/characters/${jsonName}`);
        let charData;
        try {
          const { content } = await fs.readFile(jsonPath);
          charData = loadCharacterJson(content, jsonName);
          // Update thread reference to .json if it was .md
          if (charRef.file !== jsonName) {
            charRef.file = jsonName;
            threadNeedsUpdate = true;
          }
        } catch {
          const mdPath = resolveUri(workspaceUri, `${EXT_ROOT}/characters/${charRef.file}`);
          const { content } = await fs.readFile(mdPath);
          charData = parseCharacterMd(content, charRef.file);
        }
        loadedCharacters.push(charData);
      } catch (err) { console.warn('[TextGenerator] Skipped broken character entry', charRef?.file, err); }
    }
    characters = loadedCharacters;
    // Supporting cast and the cast's connected people from the roster: read
    // fresh so an edited card shows.
    try {
      const anyConnections = characters.some((c) => c && c.rawData && c.rawData.studio && Array.isArray(c.rawData.studio.connections) && c.rawData.studio.connections.length > 0);
      const roster = (thread.supportingCast || []).some((e) => e && e.file) || anyConnections ? await scanCharacters(fs, workspaceUri) : [];
      supportingCards = supportingCastCards(thread.supportingCast, roster);
      connectedCards = connectedPeopleCards(characters, thread.supportingCast, roster);
    } catch { supportingCards = supportingCastCards(thread.supportingCast, []); connectedCards = []; }
    // Persist updated thread references if any .md → .json renames happened
    if (threadNeedsUpdate) {
      await surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, { characters: thread.characters }), parallx, 'updated participant references');
    }

    if (includeMessages) {
      messageHistory = await seedInitialMessagesIfNeeded(await readMessages(fs, workspaceUri, threadId));
    }

    selectedComposeSpeaker = thread.userPlaysAs || SELF_SPEAKER;
    if (selectedReplySpeaker && selectedReplySpeaker !== NARRATOR_SPEAKER) {
      if (!characters.find((char) => char.fileName === selectedReplySpeaker)) {
        selectedReplySpeaker = null;
      }
    }

    renderTurnControls();
    applyPerCharacterChatSettings();
    renderMessages();
    updateChrome();
  }

  async function loadModels() {
    if (!parallx.lm) {
      modelSelect.setItems([{ value: '', label: 'Ollama Offline' }]);
      return;
    }
    try {
      models = await parallx.lm.getModels();
    } catch {
      models = [];
    }
    if (models.length === 0) {
      modelSelect.setItems([{ value: '', label: 'No Models' }]);
      return;
    }
    modelSelect.setItems(models.map((model) => ({ value: model.id, label: model.displayName || model.id })));
    const threadModel = thread?.modelId && models.some(m => m.id === thread.modelId) ? thread.modelId : null;
    selectedModelId = threadModel || models[0]?.id || null;
    if (selectedModelId) modelSelect.value = selectedModelId;
    // Sync the context-window picker to the thread's override. 0 means
    // "Auto": the settings default if one was set, else the model's own
    // length; the item shows the size that resolves to.
    const ctxVal = Number(thread?.contextWindowOverride) || 0;
    ctxSelect.value = String(ctxVal);
    void refreshCtxAutoLabel();
  }

  /**
   * Chat settings drawer — replaces the old popover options menu AND the
   * separate "Chat Info" editor tab. Everything a chat can configure
   * lives here, saves on change (no Save button to forget), and sits
   * inside the chat so tweaking a knob and testing the result is one
   * motion. The per-chat writing-style / response-length overrides are
   * new REAL wiring: they land in the prompt with top precedence and
   * the inspector names them as the source.
   */
  let _drawerEl = null;
  function closeChatDrawer() {
    if (_drawerEl) { _drawerEl.remove(); _drawerEl = null; }
    optionsBtn.classList.remove('tg-input-ooc-btn--active');
  }
  function showChatDrawer() {
    if (_drawerEl) { closeChatDrawer(); return; }
    if (!thread) return;
    const drawer = el('div', 'tg-drawer');
    _drawerEl = drawer;
    optionsBtn.classList.add('tg-input-ooc-btn--active');

    const head = el('div', 'tg-drawer-head');
    head.appendChild(el('span', 'tg-drawer-title', { text: 'Chat Settings' }));
    const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
    closeBtn.addEventListener('click', closeChatDrawer);
    head.appendChild(closeBtn);
    drawer.appendChild(head);

    const bodyEl = el('div', 'tg-drawer-body');
    drawer.appendChild(bodyEl);

    const fieldWrap = (labelText, inputEl, hintText) => {
      const wrap = el('div', 'tg-drawer-field');
      wrap.appendChild(el('label', 'tg-drawer-label', { text: labelText }));
      wrap.appendChild(inputEl);
      if (hintText) wrap.appendChild(el('div', 'tg-drawer-hint', { text: hintText }));
      return wrap;
    };
    const saveMeta = (updates, label) => {
      Object.assign(thread, updates);
      return surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, updates), parallx, label);
    };

    // ── Chat title ──
    const titleInput = el('input', 'tg-drawer-input');
    titleInput.type = 'text';
    titleInput.value = thread.title || '';
    titleInput.addEventListener('change', () => {
      const t = titleInput.value.trim() || 'New Chat';
      if (t === thread.title) return;
      saveMeta({ title: t }, 'chat title');
      updateChrome();
      _refreshSidebar?.();
    });
    bodyEl.appendChild(fieldWrap('Chat title', titleInput));

    // ── Your name ──
    const yourNameInput = el('input', 'tg-drawer-input');
    yourNameInput.type = 'text';
    yourNameInput.value = getUserName();
    yourNameInput.addEventListener('change', async () => {
      const newName = yourNameInput.value.trim() || 'Anon';
      if (newName === thread.userName) return;
      await saveMeta({ userName: newName }, 'your name');
      await propagateUserName(newName);
      renderTurnControls();
      renderMessages();
    });
    bodyEl.appendChild(fieldWrap('Your name', yourNameInput, 'Used for {{user}} substitution and your message labels.'));

    // ── Type as ──
    const typeAsSelect = tgSelect(parallx, {
      className: 'tg-drawer-select',
      layout: 'full',
      items: [
        { value: SELF_SPEAKER, label: `${getUserName()} (yourself)` },
        ...characters.map((char) => ({ value: char.fileName, label: getCharacterName(char) })),
      ],
      value: (selectedComposeSpeaker && selectedComposeSpeaker !== SELF_SPEAKER) ? selectedComposeSpeaker : SELF_SPEAKER,
      onChange: (v) => {
        selectedComposeSpeaker = v || SELF_SPEAKER;
        saveMeta({ userPlaysAs: v === SELF_SPEAKER ? null : v }, 'type-as setting');
        renderTurnControls();
      },
    });
    bodyEl.appendChild(fieldWrap('Type as', typeAsSelect.element, 'Whether your typed messages are written as yourself or as a thread character.'));

    // ── Participants ──
    const chipList = el('div', 'tg-drawer-chips');
    const rebuildChips = () => {
      chipList.innerHTML = '';
      for (const charRef of thread.characters) {
        const chip = el('span', 'tg-drawer-chip');
        chip.appendChild(document.createTextNode(getCharacterName(charRef.file)));
        if (thread.characters.length > 1) {
          const rm = el('button', 'tg-drawer-chip-remove', { html: icon('x', 10) });
          rm.title = 'Remove from chat';
          rm.addEventListener('click', async () => {
            thread.characters = thread.characters.filter((item) => item.file !== charRef.file);
            const updates = { characters: thread.characters };
            if (thread.userPlaysAs === charRef.file) {
              thread.userPlaysAs = null;
              updates.userPlaysAs = null;
            }
            await surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, updates), parallx, 'participants');
            closeChatDrawer();
            await reloadThreadState();
            showChatDrawer();
          });
          chip.appendChild(rm);
        }
        chipList.appendChild(chip);
      }
      const addBtn = el('button', 'tg-drawer-add-btn', { text: '+ Add' });
      addBtn.addEventListener('click', async () => {
        const allChars = await scanCharacters(fs, workspaceUri);
        const available = allChars.filter((c) => !thread.characters.find((tc) => tc.file === c.fileName));
        if (available.length === 0) {
          showToast(allChars.length === 0 ? 'No characters found. Create one first.' : 'All characters are already in this chat.');
          return;
        }
        const picked = await parallx.window?.showQuickPick(
          available.map((c) => ({ label: c.frontmatter.name || c.fileName, description: c.fileName })),
          { placeholder: 'Add a character to this chat' },
        );
        if (!picked) return;
        thread.characters.push({ file: picked.description, addedAt: Date.now() });
        await surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, { characters: thread.characters }), parallx, 'participants');
        closeChatDrawer();
        await reloadThreadState();
        showChatDrawer();
      });
      chipList.appendChild(addBtn);
    };
    rebuildChips();
    bodyEl.appendChild(fieldWrap('Participants', chipList));

    // ── Supporting cast ──
    // People in the scene who never take a turn. From the roster, or typed
    // as "Name: who they are, how they talk".
    const castList = el('div', 'tg-drawer-chips');
    const saveCast = async () => {
      await surfaceSaveError(updateThreadMeta(fs, workspaceUri, threadId, { supportingCast: thread.supportingCast }), parallx, 'supporting cast');
      await reloadThreadState({ includeMessages: false });
      rebuildCast();
    };
    const rebuildCast = () => {
      castList.innerHTML = '';
      for (const entry of thread.supportingCast || []) {
        const card = entry.file ? supportingCards.find((p) => p.name === (getCharacterName(entry.file))) : null;
        const label = entry.file ? getCharacterName(entry.file) : (entry.name || 'Someone');
        const chip = el('span', 'tg-drawer-chip');
        chip.title = entry.file ? (card?.note || 'From the roster') : (entry.note || '');
        chip.appendChild(document.createTextNode(label));
        const rm = el('button', 'tg-drawer-chip-remove', { html: icon('x', 10) });
        rm.title = 'Remove from the scene';
        rm.addEventListener('click', async () => {
          thread.supportingCast = (thread.supportingCast || []).filter((e) => e.id !== entry.id);
          await saveCast();
        });
        chip.appendChild(rm);
        castList.appendChild(chip);
      }
      const fromRoster = el('button', 'tg-drawer-add-btn', { text: '+ From Roster' });
      fromRoster.title = 'A character from your roster, as a supporting person in this chat';
      fromRoster.addEventListener('click', async () => {
        const allChars = await scanCharacters(fs, workspaceUri);
        const taken = new Set([...(thread.characters || []).map((c) => c.file), ...(thread.supportingCast || []).map((e) => e.file).filter(Boolean)]);
        const available = allChars.filter((c) => !taken.has(c.fileName));
        if (available.length === 0) { showToast('Every character is already in this chat.'); return; }
        // The cast's connected people first: the ones most likely wanted in the scene.
        const connectedFiles = new Set(connectedCards.map((p) => p.file));
        available.sort((a, b) => Number(connectedFiles.has(b.fileName)) - Number(connectedFiles.has(a.fileName)));
        const picked = await parallx.window?.showQuickPick(
          available.map((c) => ({ label: c.frontmatter.name || c.fileName, description: connectedFiles.has(c.fileName) ? `${c.fileName} (connected)` : c.fileName })),
          { placeholder: 'Who is in the scene, without a turn of their own?' },
        );
        if (!picked) return;
        thread.supportingCast = [...(thread.supportingCast || []), { id: generateId().slice(0, 8), file: picked.description.replace(/ \(connected\)$/, ''), addedAt: Date.now() }];
        await saveCast();
      });
      const someone = el('button', 'tg-drawer-add-btn', { text: '+ Someone New' });
      someone.title = 'A person who exists only in this chat';
      someone.addEventListener('click', async () => {
        const typed = await parallx.window?.showInputBox({
          prompt: 'Who are they? Name, then who they are and how they talk.',
          placeholder: 'Dana: the bartender, Ada\'s ex. Talks fast, never finishes a sentence.',
        });
        const person = parseSupportingPerson(typed);
        if (!person) return;
        thread.supportingCast = [...(thread.supportingCast || []), { id: generateId().slice(0, 8), name: person.name, note: person.note, addedAt: Date.now() }];
        await saveCast();
      });
      castList.append(fromRoster, someone);
    };
    rebuildCast();
    bodyEl.appendChild(fieldWrap('Supporting cast', castList, 'In the scene, never at the table: whoever is speaking can give them a line or two. They never take a turn.'));

    // ── Edit character shortcut ──
    const editCharBtn = el('button', 'tg-drawer-btn', { html: `${icon('pencil-line', 13)} Edit ${escapeHtml(getCharacterName(characters[0]) || 'character')}` });
    editCharBtn.addEventListener('click', () => {
      const primaryChar = characters[0];
      if (!primaryChar) return;
      parallx.editors.openEditor({
        typeId: 'text-generator-character-editor',
        title: getCharacterName(primaryChar),
        icon: 'user',
        instanceId: primaryChar.fileName,
      });
    });
    bodyEl.appendChild(editCharBtn);

    bodyEl.appendChild(el('hr', 'tg-drawer-sep'));

    // ── Writing preset override ──
    const presetSel = tgSelect(parallx, {
      className: 'tg-drawer-select',
      layout: 'full',
      items: [
        { value: '', label: 'Inherit (character / global default)' },
        ...Object.entries(WRITING_PRESETS).map(([key, p]) => ({ value: key, label: p.label })),
      ],
      value: thread.writingPresetOverride || '',
      onChange: (v) => { saveMeta({ writingPresetOverride: v || '' }, 'writing style'); },
    });
    bodyEl.appendChild(fieldWrap('Writing style (this chat)', presetSel.element, 'Overrides the character and global writing style for this chat only.'));

    // ── Response length override ──
    const lenSel = tgSelect(parallx, {
      className: 'tg-drawer-select',
      layout: 'full',
      items: [
        { value: '', label: 'Inherit (character / global default)' },
        { value: 'none', label: 'No Limit' },
        { value: 'short', label: 'Short (1 Paragraph)' },
        { value: 'medium', label: 'Medium (2-3 Paragraphs)' },
        { value: 'long', label: 'Long (4+ Paragraphs)' },
      ],
      value: thread.responseLengthOverride || '',
      onChange: (v) => { saveMeta({ responseLengthOverride: v || '' }, 'response length'); },
    });
    bodyEl.appendChild(fieldWrap('Response length (this chat)', lenSel.element));

    // ── Standing director's note ──
    const standingArea = el('textarea', 'tg-drawer-textarea');
    standingArea.rows = 3;
    standingArea.placeholder = 'e.g. "Keep the pacing slow. Never write my character\'s dialogue. End every reply mid-scene."';
    standingArea.value = thread.standingNote || '';
    standingArea.addEventListener('change', () => {
      saveMeta({ standingNote: standingArea.value }, 'standing note');
    });
    bodyEl.appendChild(fieldWrap('Standing director\'s note', standingArea, 'Injected close to generation on EVERY turn. The megaphone next to the reply box is the one-shot version.'));

    // ── Toggles ──
    const toggleRow = (labelText, checked, onChange, hintText) => {
      const wrap = el('div', 'tg-drawer-field');
      const row = el('label', 'tg-drawer-toggle');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.addEventListener('change', () => onChange(cb.checked));
      row.appendChild(cb);
      row.appendChild(el('span', null, { text: labelText }));
      wrap.appendChild(row);
      if (hintText) wrap.appendChild(el('div', 'tg-drawer-hint', { text: hintText }));
      return wrap;
    };
    bodyEl.appendChild(toggleRow('Auto-reply', thread.autoReply !== false, (v) => {
      saveMeta({ autoReply: v }, 'auto-reply setting');
    }, 'Generate an AI turn automatically after each of your messages.'));
    bodyEl.appendChild(toggleRow('Smart turn order', thread.smartTurnOrder === true, (v) => {
      saveMeta({ smartTurnOrder: v }, 'turn order setting');
    }, 'In chats with 3+ characters, ask the model who should speak next instead of rotating.'));

    root.appendChild(drawer);
  }

  optionsBtn.addEventListener('click', () => {
    showChatDrawer();
  });

  async function sendMessage() {
    if (gen.isGenerating || !parallx.lm || characters.length === 0) return;
    const text = textarea.value.trim();
    textarea.value = '';
    textarea.style.height = 'auto';
    if (!text) {
      // Empty send always triggers generation regardless of autoReply
      await generateTurn({ speaker: await resolveReplySpeaker(selectedReplySpeaker) });
      return;
    }
    await handleUserInput(text);
    // A turn that failed before anything was stored (an instruction, a slash
    // command) hands the text back, so nothing typed is ever lost to an
    // error row. A stored message stays in the thread; an empty Send retries.
    if (gen.lastError && !textarea.value.trim()) {
      const stored = messageHistory.slice(-4).some((m) => m.author === 'user' && m.content && text.includes(m.content));
      if (!stored) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input'));
        textarea.focus();
      }
    }
  }

  sendBtn.addEventListener('click', () => {
    if (gen.isGenerating) {
      gen.stopRequested = true;
    } else {
      sendMessage();
    }
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  // (Model + ctx persistence lives in the tgSelect onChange handlers at
  // the top of the toolbar setup.)

  let _focusDebounce = null;
  const focusHandler = (event) => {
    // Skip when focus moved within the input bar (e.g., the user just clicked
    // the textarea). A full thread reload there causes visible flicker and
    // can swallow keystrokes that arrive mid-render.
    const target = event?.target;
    if (target instanceof HTMLElement && target.closest('.tg-input-wrap')) return;
    clearTimeout(_focusDebounce);
    _focusDebounce = setTimeout(() => {
      // Skip reload while a message is being edited inline — it would wipe the editor
      if (messagesEl.querySelector('.tg-msg-body--editing')) return;
      if (!gen.isGenerating) reloadThreadState().catch(() => {});
    }, 300);
  };
  fileWatcher = parallx.workspace.onDidFilesChange?.((events) => {
    if (gen.isGenerating) return;
    if (events.some((event) => event.uri.includes('/text-generator/'))) {
      clearTimeout(_focusDebounce);
      _focusDebounce = setTimeout(() => {
        if (!gen.isGenerating) reloadThreadState().catch(() => {});
      }, 300);
    }
  });
  // Focus-driven full reload is a FALLBACK for hosts without a file
  // watcher. When the watcher exists it already covers external edits;
  // reloading the whole thread because the user clicked into the
  // transcript wiped scroll position and swallowed in-flight UI state.
  if (!fileWatcher) {
    container.addEventListener('focusin', focusHandler);
  }

  // Re-attach to any generation in flight for this thread. The pane that
  // started a generation may be disposed (tab switch) while its stream
  // keeps running; every mounted pane listens on the shared gen state so
  // streaming stays visible, Stop stays live, and completion re-renders
  // from disk in whichever pane is showing the thread.
  const onGenEvent = (kind) => {
    if (kind === 'chunk') { queueRender(); return; }
    if (gen.isGenerating) {
      renderMessages();
      updateChrome();
    } else {
      // Generation finished (the completing closure persisted the reply
      // before flipping the flag) — re-read from disk so a pane that
      // wasn't the originator shows the final message too.
      renderTurnControls();
      reloadThreadState().catch(() => {});
    }
  };
  gen.listeners.add(onGenEvent);

  (async () => {
    try {
      await reloadThreadState();
      await loadModels();
      updateChrome();
      requestAnimationFrame(() => textarea.focus());
    } catch (err) {
      messagesEl.appendChild(el('div', 'tg-empty tg-error', { text: 'Error loading thread: ' + (err.message || err) }));
    }
  })();

  return {
    dispose() {
      container.removeEventListener('focusin', focusHandler);
      fileWatcher?.dispose?.();
      gen.listeners.delete(onGenEvent);
      // Keep the registry entry while a generation is running (another
      // pane may re-attach); drop it once idle and unobserved.
      if (!gen.isGenerating && gen.listeners.size === 0) {
        _activeGenerations.delete(threadId);
      }
      container.innerHTML = '';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10B: HOME PAGE
// ═══════════════════════════════════════════════════════════════════════════════

// Concepts Surprise Me and the Try chips draw from: short, specific, a little odd.
const HOME_CONCEPTS = [
  'A lighthouse keeper who collects other people’s secrets',
  'A retired assassin who runs a very good bakery',
  'Someone who only speaks in weather reports',
  'A smuggler who draws her own sea charts and lies on half of them',
  'A lapsed monk who still keeps the hours, mostly out of spite',
  'A detective in a city that floods every Thursday',
  'A ship’s AI with strong opinions about the captain’s music',
  'A duelist who has lost every duel but the important ones',
  'A hedge witch who charges in gossip, not coin',
  'A museum night guard who is sure one painting is watching him',
  'A cartographer of dreams who is running out of blank paper',
  'A tired dragon who now works as a tax auditor',
  'A wedding planner for families who hate each other',
  'A beekeeper who believes the bees elected her',
  'A ghost who is embarrassed about how she died',
  'A chess hustler who never loses to children, on principle',
  'A radio host who is the last voice on the night shift',
  'A knight sworn to protect a very small and ungrateful goose',
];

/**
 * Where Surprise Me gets a concept: the user's Character Seeds table when it
 * is there (rolled fresh each time), else the lines above. `pick(n)` gives n
 * different concepts.
 */
async function loadConceptRoller(fs, workspaceUri) {
  let loaded = null;
  try { if (fs && workspaceUri) loaded = await loadTableByName(fs, workspaceUri, studioDeps(), CHARACTER_SEEDS_NAME); } catch { loaded = null; }
  const fallback = () => HOME_CONCEPTS[Math.floor(Math.random() * HOME_CONCEPTS.length)];
  const one = () => (loaded && rollList(loaded, 'concept')) || fallback();
  return {
    fromTable: !!loaded,
    one,
    pick(n) {
      const out = [];
      for (let tries = 0; out.length < n && tries < n * 6; tries++) { const c = one(); if (!out.includes(c)) out.push(c); }
      return out;
    },
  };
}

// The Home's Make Character hands its concept to the Characters page. If that
// page is already open it takes the concept at once; otherwise it reads it on render.
let _pendingStudio = null;
let _liveCharacters = null;
function makeCharacterFrom(parallx, concept) {
  _pendingStudio = { concept: String(concept || '').trim(), autoGenerate: !!String(concept || '').trim() };
  if (_liveCharacters) { const p = _pendingStudio; _pendingStudio = null; _liveCharacters.openStudio(p); }
  void parallx.commands.executeCommand('textGenerator.newCharacter');
}

/** The last line said in a chat, without touching the file (no migration writes). */
async function lastChatLine(fs, workspaceUri, threadId) {
  try {
    const { content } = await fs.readFile(resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/messages.jsonl`));
    const lines = String(content || '').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const m = JSON.parse(lines[i]);
        const who = m.author || (m.role === 'assistant' ? 'ai' : m.role);
        if ((who === 'ai' || who === 'user') && m.hiddenFrom !== 'user' && String(m.content || '').trim()) {
          return { text: String(m.content).replace(/\s+/g, ' ').trim(), count: lines.length };
        }
      } catch { /* a torn line */ }
    }
    return { text: '', count: lines.length };
  } catch { return { text: '', count: 0 }; }
}

function openCharacterTab(parallx, fileName, name) {
  return parallx.editors.openEditor({ typeId: 'text-generator-character-editor', title: name, icon: 'user', instanceId: fileName });
}
async function startChatWith(parallx, fs, workspaceUri, fileName, name) {
  const thread = await createThread(fs, workspaceUri, fileName, null);
  _refreshSidebar?.();
  await parallx.editors.openEditor({ typeId: 'text-generator-chat', title: name, icon: 'message-circle', instanceId: thread.id });
}

function renderHomePage(container, parallx) {
  injectStyles();
  const ui = parallx.ui;
  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  const root = el('div', 'cr-home');
  container.appendChild(root);
  // Until the seeds table has loaded, the fixed lines stand in.
  let roller = { fromTable: false, one: () => HOME_CONCEPTS[Math.floor(Math.random() * HOME_CONCEPTS.length)], pick: (n) => [...HOME_CONCEPTS].sort(() => Math.random() - 0.5).slice(0, n) };
  const pick = (n) => roller.pick(n);

  // ── Hero: who do you want to meet? ──
  const hero = el('div', 'cr-hero');
  const ask = el('div', 'cr-hero-ask');
  ask.appendChild(el('h1', 'cr-hero-title', { text: 'Who do you want to meet?' }));
  const prompt = el('div', 'cr-prompt');
  prompt.appendChild(el('span', 'cr-prompt-icon', { html: icon('sparkles', 18) }));
  const conceptInput = el('input', 'cr-prompt-input');
  conceptInput.type = 'text';
  conceptInput.placeholder = pick(1)[0];
  conceptInput.setAttribute('aria-label', 'Describe a character');
  prompt.appendChild(conceptInput);
  const surprise = ui.createButton(prompt, { label: 'Surprise Me', kind: 'ghost', icon: 'dices', title: 'Fill in a concept rolled from your Character Seeds table', onClick: () => { conceptInput.value = roller.one(); conceptInput.focus(); } });
  surprise.classList.add('cr-dice');
  ui.createButton(prompt, { label: 'Make Character', kind: 'primary', icon: 'wand-sparkles', title: 'Open the Studio and write this character', onClick: () => makeCharacterFrom(parallx, conceptInput.value || conceptInput.placeholder) });
  conceptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); makeCharacterFrom(parallx, conceptInput.value || conceptInput.placeholder); } });
  ask.appendChild(prompt);
  const tries = el('div', 'cr-tries');
  const renderTries = () => {
    tries.replaceChildren(el('span', 'cr-tries-label', { text: 'Try' }));
    for (const c of pick(2)) {
      const b = el('button', 'cr-try', { text: c });
      b.type = 'button';
      b.addEventListener('click', () => { conceptInput.value = c; conceptInput.focus(); });
      tries.appendChild(b);
    }
  };
  renderTries();
  ask.appendChild(tries);
  // The seeds table, once it has loaded, replaces the fixed lines.
  void loadConceptRoller(fs, workspaceUri).then((r) => {
    if (!r.fromTable || !root.isConnected) return;
    roller = r;
    if (!conceptInput.value) conceptInput.placeholder = roller.one();
    renderTries();
  });
  hero.appendChild(ask);
  const rollHost = el('div', 'cr-roll');
  rollHost.style.display = 'none';
  hero.appendChild(rollHost);
  root.appendChild(hero);

  // ── Quick start ──
  const quick = el('div', 'cr-quick');
  const quickCard = (iconName, label, hint, onClick) => {
    const b = el('button', 'cr-quick-card');
    b.type = 'button';
    b.appendChild(el('span', 'cr-quick-icon', { html: icon(iconName, 18) }));
    const t = el('span', 'cr-quick-text');
    t.appendChild(el('span', 'cr-quick-title', { text: label }));
    t.appendChild(el('span', 'cr-quick-hint', { text: hint }));
    b.appendChild(t);
    b.addEventListener('click', onClick);
    return b;
  };
  quick.append(
    quickCard('user', 'New Character', 'Start from a line or a few sources', () => makeCharacterFrom(parallx, '')),
    quickCard('message-circle', 'New Roleplay', 'Put one of your cast in a scene', () => void parallx.commands.executeCommand('textGenerator.newChat')),
    quickCard('book-open', 'New Story', 'Write it beat by beat, together', () => void parallx.commands.executeCommand('textGenerator.newStory')),
    quickCard('dices', 'New Table', 'Make a list worth rolling on', () => void parallx.commands.executeCommand('textGenerator.newTable')),
  );
  root.appendChild(quick);

  if (!fs || !workspaceUri) {
    ui.createEmptyState(root, { headline: 'No workspace is open.', hint: 'Open a folder to keep characters, chats and stories in it.', icon: 'folder' });
    return { dispose() { container.innerHTML = ''; } };
  }

  const section = (label) => {
    const sec = el('div', 'cr-section');
    const head = el('div', 'cr-section-head');
    head.appendChild(el('h2', 'cr-section-title', { text: label }));
    sec.appendChild(head);
    const body = el('div');
    sec.appendChild(body);
    root.appendChild(sec);
    return { sec, head, body };
  };
  const cont = section('Pick up where you left off');
  cont.body.className = 'cr-continue';
  const cast = section('Your cast');
  cast.body.className = 'cr-cast';

  let disposed = false;
  let rollToken = 0;
  async function rollOnHome(settings) {
    const token = ++rollToken;
    if (settings.homeTableRoll === false) { rollHost.style.display = 'none'; return; }
    const deps = studioDeps();
    const tables = await listTables(fs, workspaceUri, deps).catch(() => []);
    if (disposed || token !== rollToken) return;
    if (tables.length === 0) { rollHost.style.display = 'none'; return; }
    const table = tables[Math.floor(Math.random() * tables.length)];
    let text = '';
    try {
      const { content } = await fs.readFile(resolveUri(workspaceUri, `${EXT_ROOT}/tables/${table.fileName}`));
      const loaded = await loadTable(fs, workspaceUri, deps, String(content));
      text = rollTable(loaded.gen, 1, 'output', { imports: loaded.imports }).results[0] || '';
    } catch { text = ''; }
    if (disposed || token !== rollToken) return;
    if (!String(text).trim()) { rollHost.style.display = 'none'; return; }
    rollHost.replaceChildren();
    const head = el('div', 'cr-roll-head');
    head.appendChild(el('span', 'cr-roll-label', { text: `${titleCaseName(table.name)} rolled` }));
    const again = ui.createIconButton(head, { icon: 'dices', title: 'Roll another table', size: 'sm', onClick: () => void rollOnHome(settings) });
    again.classList.add('cr-dice');
    rollHost.appendChild(head);
    rollHost.appendChild(el('div', 'cr-roll-text', { text: String(text) }));
    const acts = el('div', 'cr-roll-actions');
    ui.createButton(acts, { label: 'Use As A Concept', kind: 'secondary', size: 'sm', icon: 'user', onClick: () => { conceptInput.value = String(text); conceptInput.focus(); } });
    ui.createIconButton(acts, { icon: 'copy', title: 'Copy', size: 'sm', onClick: () => { void navigator.clipboard?.writeText(String(text)); showToastLite('Copied'); } });
    rollHost.appendChild(acts);
    rollHost.style.display = '';
  }

  async function load() {
    const [threads, characters, stories, settings] = await Promise.all([
      listThreads(fs, workspaceUri).catch(() => []),
      scanCharacters(fs, workspaceUri).catch(() => []),
      listStories(fs, workspaceUri, studioDeps()).catch(() => []),
      loadSettings(fs, workspaceUri).catch(() => ({ ...DEFAULT_SETTINGS })),
    ]);
    if (disposed) return;
    const byFile = new Map(characters.map((c) => [c.fileName, c]));

    // Continue: the newest chat and the newest story.
    cont.body.replaceChildren();
    const lastThread = threads[0];
    if (lastThread) {
      const file = lastThread.characters?.[0]?.file;
      const ch = file ? byFile.get(file) : null;
      const name = ch?.frontmatter.name || lastThread.title || 'Chat';
      const card = el('button', 'cr-cont-card');
      card.type = 'button';
      card.appendChild(createPortrait(name, { size: 44, hue: ch ? hueOf(ch.rawData) : null }));
      const t = el('span', 'cr-cont-text');
      const top = el('span', 'cr-cont-top');
      top.appendChild(el('span', 'cr-cont-name', { text: name }));
      top.appendChild(el('span', 'cr-cont-meta', { text: `Chat · ${formatAgoWords(lastThread.updatedAt)}` }));
      t.appendChild(top);
      const line = el('span', 'cr-cont-line', { text: lastThread.title || '' });
      t.appendChild(line);
      card.appendChild(t);
      card.appendChild(el('span', 'cr-cont-go', { text: 'Continue' }));
      card.addEventListener('click', () => void parallx.editors.openEditor({ typeId: 'text-generator-chat', title: lastThread.title || name, icon: 'message-circle', instanceId: lastThread.id }));
      cont.body.appendChild(card);
      void lastChatLine(fs, workspaceUri, lastThread.id).then(({ text }) => { if (!disposed && text) line.textContent = `“${text}”`; });
    }
    const lastStory = stories[0];
    if (lastStory) {
      const { fileName, story } = lastStory;
      const card = el('button', 'cr-cont-card');
      card.type = 'button';
      card.appendChild(el('span', 'cr-cont-book', { html: icon('book-open', 20) }));
      const t = el('span', 'cr-cont-text');
      const top = el('span', 'cr-cont-top');
      top.appendChild(el('span', 'cr-cont-name', { text: story.title || 'Untitled' }));
      const chapters = Array.isArray(story.chapters) ? story.chapters.length : 0;
      const words = Array.isArray(story.beats) ? storyWords(story) : 0;
      top.appendChild(el('span', 'cr-cont-meta', { text: [chapters ? `Chapter ${chapters}` : '', `${words.toLocaleString()} words`].filter(Boolean).join(' · ') }));
      t.appendChild(top);
      t.appendChild(el('span', 'cr-cont-line', { text: story.brief?.premise || `Edited ${formatAgoWords(story.updatedAt)}` }));
      card.appendChild(t);
      card.appendChild(el('span', 'cr-cont-go', { text: 'Keep Writing' }));
      card.addEventListener('click', () => void parallx.editors.openEditor({ typeId: 'text-generator-story', title: story.title || 'Story', icon: 'book-open', instanceId: fileName }));
      cont.body.appendChild(card);
    }
    cont.sec.style.display = (lastThread || lastStory) ? '' : 'none';

    // Your cast.
    cast.head.querySelector('.cr-section-link')?.remove();
    if (characters.length > 6) {
      const all = el('button', 'cr-section-link', { text: `See All ${characters.length}` });
      all.type = 'button';
      all.addEventListener('click', () => void parallx.commands.executeCommand('textGenerator.openCharacters'));
      cast.head.appendChild(all);
    }
    cast.body.replaceChildren();
    if (characters.length === 0) {
      ui.createEmptyState(cast.body, { headline: 'No characters yet.', hint: 'Describe someone above, or press Surprise Me.', icon: 'users' });
    }
    const recent = [...characters].sort((a, b) => (b.rawData?.updatedAt || 0) - (a.rawData?.updatedAt || 0)).slice(0, 6);
    for (const ch of recent) {
      const name = ch.frontmatter.name || ch.fileName.replace(/\.(md|json)$/, '');
      const card = el('div', 'cr-cast-card');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Open ${name}`);
      card.appendChild(createPortrait(name, { size: 44, hue: hueOf(ch.rawData) }));
      card.appendChild(el('div', 'cr-cast-name', { text: name }));
      card.appendChild(el('div', 'cr-cast-tag', { text: characterTagline(ch.rawData) }));
      const chat = el('button', 'cr-cast-chat', { html: `${icon('message-circle', 13)}<span>Chat</span>` });
      chat.type = 'button';
      chat.addEventListener('click', (e) => { e.stopPropagation(); void startChatWith(parallx, fs, workspaceUri, ch.fileName, name); });
      card.appendChild(chat);
      const open = () => void openCharacterTab(parallx, ch.fileName, name);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      cast.body.appendChild(card);
    }
    if (rollToken === 0) void rollOnHome(settings);
  }
  void load();
  let sub = null;
  try { sub = parallx.workspace?.onDidFilesChange?.((events) => { if (!events || events.some?.((e) => String(e.uri || '').includes('/text-generator/'))) void load(); }) || null; } catch { sub = null; }
  return { dispose() { disposed = true; try { sub?.dispose?.(); } catch { /* gone */ } container.innerHTML = ''; } };
}

/** A table's file name as words: tavern-rumours → Tavern Rumours. */
function titleCaseName(slug) {
  return String(slug || '').replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
}

/** "2 hours ago", "yesterday": the Home reads in words. */
function formatAgoWords(ts) {
  if (!ts) return 'a while ago';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

/** What the regenerate box opens with: the direction the message was made with, else nothing. */
function regenDirectionFor(message) {
  const v = message && typeof message.instruction === 'string' ? message.instruction.trim() : '';
  return v;
}

/** The line under a character's name: the Studio's tagline, else the start of their instruction. */
function characterTagline(data) {
  const t = String(data?.studio?.sheet?.tagline || data?.tagline || '').trim();
  if (t) return t;
  const role = String(data?.roleInstruction || '').replace(/\s+/g, ' ').trim();
  return role ? (role.length > 110 ? `${role.slice(0, 107)}…` : role) : 'No tagline yet';
}

function renderCharactersPage(container, parallx, input) {
  injectStyles();
  const ui = parallx.ui;
  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  // One surface for the cast: a gallery of cards, and a character opened
  // from it fills the page with the Studio (a back link returns). When opened
  // via the character-editor typeId, instanceId is a character fileName to
  // open; 'new' opens a blank Studio; anything else starts on the gallery.
  const rawInstance = input?.instanceId || input?.id || '';
  const preselect = /\.(md|json)$/.test(rawInstance) ? rawInstance : null;

  const root = el('div', 'cr-cast-page');
  container.appendChild(root);
  if (!fs || !workspaceUri) {
    ui.createEmptyState(root, { headline: 'No workspace is open.', hint: 'Open a folder to keep characters in it.', icon: 'users' });
    return { dispose() { container.innerHTML = ''; } };
  }

  const galleryView = el('div', 'cr-gallery');
  const detailView = el('div', 'cr-detail');
  root.append(galleryView, detailView);

  let view = 'characters';
  let query = '';
  let paneEditor = null;
  let openFile = null;
  let disposed = false;
  let chars = [];
  let lorebooks = [];
  let chatCounts = new Map();

  // ── Gallery header ──
  const header = ui.createPageHeader(galleryView, {
    title: 'Characters',
    back: { label: 'Creations', onClick: () => void parallx.commands.executeCommand('textGenerator.openHome') },
    subtitle: ' ',
    primary: { label: 'New Character', icon: 'plus', onClick: () => openStudioNew() },
    secondary: [{ label: 'Surprise Me', icon: 'dices', title: 'A new character from a concept rolled from your Character Seeds table', onClick: () => void loadConceptRoller(fs, workspaceUri).then((r) => openStudio({ concept: r.one(), autoGenerate: true })) }],
  });
  const subtitleEl = header.querySelector('.px-page-header__subtitle');
  const tools = el('div', 'cr-gallery-tools');
  const seg = ui.createSegmented(tools, {
    ariaLabel: 'Show',
    items: [{ value: 'characters', label: 'Characters' }, { value: 'lorebooks', label: 'Lorebooks' }],
    value: view,
    onChange: (v) => { view = v; renderGallery(); },
  });
  const search = el('label', 'cr-search');
  search.innerHTML = icon('search', 14);
  const searchInput = el('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search';
  searchInput.setAttribute('aria-label', 'Search characters');
  searchInput.addEventListener('input', () => { query = searchInput.value.trim().toLowerCase(); renderGallery(); });
  search.appendChild(searchInput);
  tools.appendChild(search);
  const newLore = ui.createButton(tools, { label: 'New Lorebook', kind: 'secondary', icon: 'plus', onClick: () => void createLorebook() });
  galleryView.appendChild(tools);
  const grid = el('div', 'cr-grid');
  galleryView.appendChild(grid);

  // ── Detail: the Studio, full width ──
  const back = el('button', 'cr-back', { html: `${icon('chevron-left', 14)}<span>Characters</span>` });
  back.type = 'button';
  back.addEventListener('click', () => showGallery());
  const detailHost = el('div', 'cr-detail-host');
  detailView.append(back, detailHost);

  const clearDetail = () => {
    if (paneEditor) { try { paneEditor.dispose?.(); } catch { /* already disposed */ } paneEditor = null; }
    detailHost.replaceChildren();
  };
  function showGallery() {
    clearDetail();
    openFile = null;
    detailView.style.display = 'none';
    galleryView.style.display = '';
    void refresh();
  }
  const showDetail = () => { galleryView.style.display = 'none'; detailView.style.display = ''; root.scrollTop = 0; };
  const studioCtx = (extra) => ({
    fs, workspaceUri,
    onCreated: async (fileName) => { openFile = fileName; _refreshSidebar?.(); },
    onSaved: () => { _refreshSidebar?.(); },
    openChat: (fileName, name) => void startChatWith(parallx, fs, workspaceUri, fileName, name),
    openChatBehaviour: (fileName) => openBehaviour(fileName),
    openCharacter: (fileName) => selectCharacter(fileName),
    openNew: (from) => openStudioNew(from),
    ...extra,
  });
  function selectCharacter(fileName) {
    if (!fileName) { showGallery(); return; }
    clearDetail();
    openFile = fileName;
    showDetail();
    paneEditor = renderStudioPane(detailHost, parallx, studioCtx({ fileName }), studioDeps());
  }
  function openBehaviour(fileName) {
    clearDetail();
    openFile = fileName;
    showDetail();
    const toStudio = ui.createButton(detailHost, { label: 'Back To Studio', kind: 'ghost', icon: 'arrow-left', onClick: () => selectCharacter(fileName) });
    toStudio.classList.add('cs-back');
    paneEditor = renderCharacterEditor(detailHost, parallx, { instanceId: fileName });
  }
  function openStudioNew(from = null) { openStudio({ from }); }
  function openStudio({ from = null, concept = '', autoGenerate = false } = {}) {
    clearDetail();
    openFile = null;
    showDetail();
    paneEditor = renderStudioPane(detailHost, parallx, studioCtx({ fileName: null, from, concept, autoGenerate }), studioDeps());
  }

  function menuFor(ch, name) {
    return [
      { label: 'Open', icon: 'user', onSelect: () => selectCharacter(ch.fileName) },
      { label: 'Start A Chat', icon: 'message-circle', onSelect: () => void startChatWith(parallx, fs, workspaceUri, ch.fileName, name) },
      { separator: true },
      { label: 'Duplicate', icon: 'copy', onSelect: () => void duplicate(ch) },
      { label: 'Export As Markdown…', icon: 'file-down', onSelect: () => void exportOne(ch) },
      { separator: true },
      { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => void remove(ch, name) },
    ];
  }
  async function duplicate(ch) {
    const dir = resolveUri(workspaceUri, `${EXT_ROOT}/characters`);
    try {
      const { content: srcContent } = await fs.readFile(resolveUri(dir, ch.fileName));
      const dupeData = ch.fileName.endsWith('.json') ? JSON.parse(srcContent) : migrateCharacterMdToJson(srcContent, ch.fileName);
      const id = generateId().slice(0, 8);
      dupeData.id = 'char-' + id;
      dupeData.name = (dupeData.name || 'Character') + ' (copy)';
      dupeData.createdAt = Date.now();
      dupeData.updatedAt = Date.now();
      const dupeName = ch.fileName.replace(/\.(json|md)$/, '') + `-copy-${id}.json`;
      await fs.writeFile(resolveUri(dir, dupeName), JSON.stringify(dupeData, null, 2));
      await refresh();
    } catch (err) { console.warn('[TextGenerator] Duplicate failed:', err); }
  }
  async function exportOne(ch) {
    try {
      const { content } = await fs.readFile(resolveUri(workspaceUri, `${EXT_ROOT}/characters/${ch.fileName}`));
      const data = ch.fileName.endsWith('.json') ? JSON.parse(content) : migrateCharacterMdToJson(content, ch.fileName);
      await exportCharacterToMarkdown(data);
    } catch (err) {
      console.warn('[TextGenerator] Export failed:', err);
      showToastLite('Export failed: ' + (err?.message || String(err)));
    }
  }
  async function remove(ch, name) {
    const choice = await parallx.window.showWarningMessage(`Delete "${name}"? This cannot be undone.`, { title: 'Delete' });
    if (!choice || choice.title !== 'Delete') return;
    try {
      await fs.delete(resolveUri(workspaceUri, `${EXT_ROOT}/characters/${ch.fileName}`));
      await refresh();
      _refreshSidebar?.();
    } catch { /* ignore */ }
  }
  async function createLorebook() {
    const dir = resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks`);
    await ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', 'text-generator', 'lorebooks']);
    const fileName = `lorebook-${generateId().slice(0, 8)}.md`;
    await fs.writeFile(resolveUri(dir, fileName), LOREBOOK_TEMPLATE);
    await refresh();
    await parallx.editors.openFileEditor(resolveUri(dir, fileName));
  }
  async function duplicateLore(lb) {
    const dir = resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks`);
    try {
      const { content: srcContent } = await fs.readFile(resolveUri(dir, lb.fileName));
      let dupeContent = srcContent;
      const nameMatch = dupeContent.match(/^(---[\s\S]*?\nname:\s*)(.+)(\n[\s\S]*?---)/);
      if (nameMatch) dupeContent = dupeContent.replace(nameMatch[0], nameMatch[1] + nameMatch[2].trim() + ' (copy)' + nameMatch[3]);
      await fs.writeFile(resolveUri(dir, lb.fileName.replace('.md', '') + `-copy-${generateId().slice(0, 8)}.md`), dupeContent);
      await refresh();
    } catch (err) { console.warn('[TextGenerator] Lorebook duplicate failed:', err); }
  }
  async function removeLore(lb, loreName) {
    const choice = await parallx.window.showWarningMessage(`Delete the lorebook "${loreName}"? This cannot be undone.`, { title: 'Delete' });
    if (!choice || choice.title !== 'Delete') return;
    try { await fs.delete(resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks/${lb.fileName}`)); await refresh(); } catch { /* ignore */ }
  }

  function moreButton(host, label, items) {
    const b = ui.createIconButton(host, { icon: 'more-horizontal', title: `More actions for ${label}`, size: 'sm', onClick: (e) => { e.stopPropagation(); ui.showContextMenu(b, items, { anchorPosition: 'below' }); } });
    return b;
  }
  function renderGallery() {
    const isLore = view === 'lorebooks';
    seg.value = view;
    searchInput.setAttribute('aria-label', isLore ? 'Search lorebooks' : 'Search characters');
    newLore.style.display = isLore ? '' : 'none';
    const chats = [...chatCounts.values()].reduce((a, b) => a + b, 0);
    if (subtitleEl) subtitleEl.textContent = [`${chars.length} character${chars.length === 1 ? '' : 's'}`, `${lorebooks.length} lorebook${lorebooks.length === 1 ? '' : 's'}`, `${chats} chat${chats === 1 ? '' : 's'}`].join(' · ');
    grid.replaceChildren();
    grid.classList.toggle('cr-grid--lore', isLore);
    if (isLore) {
      const list = lorebooks.filter((lb) => !query || lb.name.toLowerCase().includes(query));
      if (lorebooks.length === 0) ui.createEmptyState(grid, { headline: 'No lorebooks yet.', hint: 'A lorebook holds places, people and rules your chats can draw on.', icon: 'book-open', action: { label: 'New Lorebook', onClick: () => void createLorebook() } });
      else if (list.length === 0) ui.createEmptyState(grid, { headline: 'Nothing matches.', hint: 'Try another word.', icon: 'search' });
      for (const lb of list) {
        const card = el('div', 'cr-lore-card');
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Open ${lb.name}`);
        card.appendChild(el('span', 'cr-lore-icon', { html: icon('book-open', 16) }));
        const t = el('div', 'cr-lore-text');
        t.appendChild(el('div', 'cr-card-name', { text: lb.name }));
        t.appendChild(el('div', 'cr-card-meta', { text: `${lb.entries} entr${lb.entries === 1 ? 'y' : 'ies'}` }));
        card.appendChild(t);
        moreButton(card, lb.name, [
          { label: 'Duplicate', icon: 'copy', onSelect: () => void duplicateLore(lb) },
          { separator: true },
          { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => void removeLore(lb, lb.name) },
        ]);
        const open = () => void parallx.editors.openFileEditor(resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks/${lb.fileName}`));
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        grid.appendChild(card);
      }
      return;
    }
    const list = chars.filter((ch) => !query || `${ch.frontmatter.name} ${characterTagline(ch.rawData)}`.toLowerCase().includes(query));
    if (chars.length === 0) ui.createEmptyState(grid, { headline: 'No characters yet.', hint: 'New Character opens the Studio; Surprise Me makes one from a random concept.', icon: 'users', action: { label: 'New Character', onClick: () => openStudioNew() } });
    else if (list.length === 0) ui.createEmptyState(grid, { headline: 'Nothing matches.', hint: 'Try another word.', icon: 'search' });
    for (const ch of list) {
      const name = ch.frontmatter.name || ch.fileName.replace(/\.(md|json)$/, '');
      const card = el('div', 'cr-card');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Open ${name}`);
      const top = el('div', 'cr-card-top');
      top.appendChild(createPortrait(name, { size: 56, hue: hueOf(ch.rawData) }));
      const topRight = el('div', 'cr-card-top-right');
      moreButton(topRight, name, menuFor(ch, name));
      top.appendChild(topRight);
      card.appendChild(top);
      card.appendChild(el('div', 'cr-card-name', { text: name }));
      card.appendChild(el('div', 'cr-card-tag', { text: characterTagline(ch.rawData) }));
      const foot = el('div', 'cr-card-foot');
      const n = chatCounts.get(ch.fileName) || 0;
      foot.appendChild(el('span', 'cr-card-meta', { text: n ? `${n} chat${n === 1 ? '' : 's'}` : 'No chats yet' }));
      ui.createButton(foot, { label: 'Chat', kind: 'secondary', size: 'sm', icon: 'message-circle', onClick: (e) => { e.stopPropagation(); void startChatWith(parallx, fs, workspaceUri, ch.fileName, name); } });
      card.appendChild(foot);
      card.addEventListener('click', () => selectCharacter(ch.fileName));
      card.addEventListener('keydown', (e) => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectCharacter(ch.fileName); } });
      grid.appendChild(card);
    }
  }
  async function refresh() {
    const [c, lbs, threads] = await Promise.all([
      scanCharacters(fs, workspaceUri).catch(() => []),
      scanLorebooks(fs, workspaceUri).catch(() => []),
      listThreads(fs, workspaceUri).catch(() => []),
    ]);
    if (disposed) return;
    chars = c.sort((a, b) => (b.rawData?.updatedAt || 0) - (a.rawData?.updatedAt || 0));
    lorebooks = lbs.map((lb) => {
      const parsed = parseFrontmatter(lb.content);
      let entries = 0;
      try { entries = parseLoreEntries(lb.content).length; } catch { entries = 0; }
      return { fileName: lb.fileName, name: parsed.frontmatter.name || lb.fileName.replace('.md', ''), entries };
    });
    chatCounts = new Map();
    for (const th of threads) for (const ref of th.characters || []) chatCounts.set(ref.file, (chatCounts.get(ref.file) || 0) + 1);
    renderGallery();
  }

  _liveCharacters = { openStudio: (p) => openStudio(p), __root: root };
  detailView.style.display = 'none';
  void refresh().then(() => {
    if (disposed) return;
    const pending = _pendingStudio;
    _pendingStudio = null;
    if (pending) openStudio(pending);
    else if (rawInstance === 'new') openStudioNew();
    else if (preselect) selectCharacter(preselect);
  }).catch((err) => console.warn('[TextGenerator] Characters load failed:', err));

  return {
    dispose() {
      disposed = true;
      if (_liveCharacters?.openStudio && _liveCharacters.__root === root) _liveCharacters = null;
      clearDetail();
      container.innerHTML = '';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10C2: CHARACTER FORGE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Game-style character creation: personality dials + archetype/genre/flaw
// pickers + dice with per-control locks. The model turns the settings into
// a VOICE-FIRST card — example dialogue and voice anchor are the primary
// outputs, because voice samples steer roleplay models far harder than
// trait prose. Every generated field is editable and individually
// regenerable before saving into the normal roster.

const FORGE_AXES = [
  { key: 'warmth', label: 'Warmth', low: 'cold, distant', high: 'warm, affectionate' },
  { key: 'bluntness', label: 'Bluntness', low: 'evasive, indirect', high: 'brutally direct' },
  { key: 'formality', label: 'Formality', low: 'casual, slangy', high: 'formal, precise' },
  { key: 'humor', label: 'Humor', low: 'dead serious', high: 'playful, joking' },
  { key: 'confidence', label: 'Confidence', low: 'anxious, self-doubting', high: 'unshakably confident' },
  { key: 'verbosity', label: 'Verbosity', low: 'terse, few words', high: 'expansive, talkative' },
];
const FORGE_RANDOM = '(random)';

// Physical parameters (BG3-style creator): everything needed to describe
// a character fully, all diceable and lockable. Height is displayed in
// feet and inches; sizes are descriptive words the model can render for
// any gender ("bust/chest").
const FORGE_GENDERS = ['Female', 'Male', 'Nonbinary'];
const FORGE_BUILDS = ['slender', 'lithe', 'athletic', 'toned', 'curvy', 'voluptuous', 'muscular', 'stocky', 'plump', 'average'];
const FORGE_BUSTS = ['flat', 'small', 'modest', 'full', 'large', 'very large'];
const FORGE_WAISTS = ['narrow', 'average', 'soft', 'thick'];
const FORGE_HIPS = ['slim', 'average', 'wide', 'thick', 'heavy'];
const FORGE_SKINS = ['porcelain', 'pale', 'fair', 'freckled', 'olive', 'tan', 'golden', 'brown', 'dark', 'ebony'];
const FORGE_HAIR_COLORS = ['black', 'dark brown', 'chestnut', 'auburn', 'red', 'strawberry blonde', 'blonde', 'platinum', 'silver', 'white', 'gray', 'blue-dyed', 'pink-dyed'];
const FORGE_HAIR_LENGTHS = ['shaved', 'cropped', 'short', 'chin-length', 'shoulder-length', 'long', 'waist-length'];
const FORGE_EYE_COLORS = ['brown', 'hazel', 'green', 'blue', 'gray', 'amber', 'violet', 'black', 'heterochromatic'];
const FORGE_CLOTHING = ['casual modern', 'elegant formal', 'business attire', 'gothic', 'punk', 'bohemian', 'athletic wear', 'military uniform', 'fantasy adventurer', 'noble finery', 'scholarly robes', 'street urchin rags', 'vintage 1920s'];

function forgeFeetInches(totalInches) {
  return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`;
}

function forgeAxisDescriptor(axis, v) {
  if (v <= 15) return `extremely ${axis.low}`;
  if (v <= 40) return axis.low;
  if (v < 60) return `balanced between ${axis.low} and ${axis.high}`;
  if (v < 85) return axis.high;
  return `extremely ${axis.high}`;
}

function buildForgeSpec(state) {
  const pick = (v, list) => (v === FORGE_RANDOM ? list[Math.floor(Math.random() * list.length)] : v);
  const resolved = {
    gender: pick(state.gender, FORGE_GENDERS),
    build: pick(state.build, FORGE_BUILDS),
    bust: pick(state.bust, FORGE_BUSTS),
    waist: pick(state.waist, FORGE_WAISTS),
    hips: pick(state.hips, FORGE_HIPS),
    skin: pick(state.skin, FORGE_SKINS),
    hairColor: pick(state.hairColor, FORGE_HAIR_COLORS),
    hairLength: pick(state.hairLength, FORGE_HAIR_LENGTHS),
    eyeColor: pick(state.eyeColor, FORGE_EYE_COLORS),
    clothing: pick(state.clothing, FORGE_CLOTHING),
  };
  const lines = [];
  // The user's own concept leads and is authoritative: every generated
  // section is built AROUND it, and it wins over any conflicting dial.
  if (state.concept.trim()) {
    lines.push(`CHARACTER CONCEPT (the user's own words — authoritative; build everything around this, and when it conflicts with any attribute below, the concept wins):\n${state.concept.trim()}`);
    lines.push('');
  }
  lines.push(
    `- Personality dials: ${FORGE_AXES.map((a) => `${a.label.toLowerCase()}: ${forgeAxisDescriptor(a, state.axes[a.key])}`).join('; ')}`,
    `- Gender: ${resolved.gender} | Age: ${state.age} | Height: ${forgeFeetInches(state.height)}`,
    `- Build: ${resolved.build}; bust/chest: ${resolved.bust}; waist: ${resolved.waist}; hips/thighs: ${resolved.hips}; skin: ${resolved.skin}`,
    `- Hair: ${resolved.hairColor}, ${resolved.hairLength}${state.hairStyle.trim() ? ', ' + state.hairStyle.trim() : ''} | Eyes: ${resolved.eyeColor}`,
    `- Clothing style: ${resolved.clothing}${state.clothingNotes.trim() ? '; ' + state.clothingNotes.trim() : ''}`,
  );
  if (state.features.trim()) lines.push(`- Distinguishing features: ${state.features.trim()}`);
  if (state.name.trim()) lines.push(`- Name: ${state.name.trim()}`); else lines.push('- Name: invent a fitting one');
  if (state.want.trim()) lines.push(`- What they openly WANT: ${state.want.trim()}`);
  if (state.fear.trim()) lines.push(`- What they privately FEAR: ${state.fear.trim()}`);
  if (state.secret.trim()) lines.push(`- A SECRET they keep: ${state.secret.trim()}`);
  return { spec: lines.join('\n'), resolved };
}

/** What the Studio borrows from this file: DOM helpers, storage, the dials. */
function studioDeps() {
  return {
    el, icon, tgSelect, loadSettings, saveSettings, saveCharacter, createCharacterJson, exportCharacterToMarkdown,
    ensureNestedDirs, generateId, scanCharacters, resolveUri, extRoot: EXT_ROOT, extFolder: 'text-generator', ctxPresets: CTX_WINDOW_PRESETS,
    injectStyles, refreshSidebar: () => _refreshSidebar?.(), exportMarkdown: exportMarkdownFile,
    // The Studio's dice: one roll of a Character Seeds list (want, fear, secret), '' when the table is gone.
    rollSeed: async (listName) => {
      const fs = _parallx?.workspace?.fs;
      const workspaceUri = _parallx?.workspace?.workspaceFolders?.[0]?.uri;
      if (!fs || !workspaceUri) return '';
      try { return rollList(await loadTableByName(fs, workspaceUri, studioDeps(), CHARACTER_SEEDS_NAME), listName); } catch { return ''; }
    },
    // Roll A Table beside a text field: the Studio's concept, the story's premise.
    tableRoll: (textarea) => {
      const fs = _parallx?.workspace?.fs;
      const workspaceUri = _parallx?.workspace?.workspaceFolders?.[0]?.uri;
      return fs && workspaceUri ? attachTableRoll(_parallx, studioDeps(), fs, workspaceUri, textarea) : null;
    },
    forge: {
      AXES: FORGE_AXES, RANDOM: FORGE_RANDOM, GENDERS: FORGE_GENDERS, BUILDS: FORGE_BUILDS, BUSTS: FORGE_BUSTS,
      WAISTS: FORGE_WAISTS, HIPS: FORGE_HIPS, SKINS: FORGE_SKINS, HAIR_COLORS: FORGE_HAIR_COLORS,
      HAIR_LENGTHS: FORGE_HAIR_LENGTHS, EYE_COLORS: FORGE_EYE_COLORS, CLOTHING: FORGE_CLOTHING,
      feetInches: forgeFeetInches, buildSpec: buildForgeSpec,
    },
  };
}
/**
 * The shipped dialogue rules. Against the model's way of making every line a
 * performance: values named instead of shown (a character who values solitude
 * talks about solitude), abstract ideas talked about as things, metaphors and
 * aphorisms, questions dodged with a clever question back, and a voice habit
 * in every line. Measured with the dialogue bench
 * (ext/creations-ai/test/run-dialogue-bench.mjs, 2026-10-08): against the
 * previous rules, a quarter fewer lines a person would not say and half the
 * metaphors. Craft, not format; the user edits it in Settings.
 */
const DEFAULT_DIALOGUE_RULES = [
  '- People talk about what is in front of them: the task, the object, the other person. Nobody names their own values or traits. What someone cares about shows in what they do, what they notice and what they refuse, never in a speech about it.',
  '- Abstract nouns (peace, solitude, trust, freedom, honour) are not subjects of conversation. Say the concrete thing instead: the quiet of the house, the locked door, the money, the name not spoken.',
  '- When someone wants to know something, they ask it plainly. They answer the question that was asked, briefly, then say what they want to say. They interrupt, trail off and change the subject like real people.',
  '- Humour comes from a specific thing in the scene or a specific person, never from a character announcing a joke or a quip that would fit any scene.',
  '- Nobody summarises their feelings or the scene. If a line could be printed on a mug, cut it.',
  '- People speak plainly. A metaphor is rare and only one a person like them would actually use; most lines have none.',
  "- Most of what anyone says is plain: answering what was just asked, saying what they need, reacting to what is in front of them. A character's habits, quirks and turns of phrase show a few times in a scene, not in every line.",
].join('\n');

/** The rules shipped before 2026-10-08: settings still holding them word for word get the new ones. */
const PREVIOUS_DIALOGUE_RULES = [
  '- People talk about what is in front of them: the task, the object, the other person. Nobody names their own values or traits. What someone cares about shows in what they do, what they notice and what they refuse, never in a speech about it.',
  '- Abstract nouns (peace, solitude, trust, freedom, honour) are not subjects of conversation. Say the concrete thing instead: the quiet of the house, the locked door, the money, the name not spoken.',
  '- People answer the question they heard, not the one that was asked. They interrupt, trail off, change the subject, and say less than they mean.',
  '- Humour comes from a specific thing in the scene or a specific person, never from a character announcing a joke or a quip that would fit any scene.',
  '- Nobody summarises their feelings or the scene. If a line could be printed on a mug, cut it.',
].join('\n');


/** Settings saved with the previous shipped rules, untouched, move to the current ones; edited rules stay. */
function migrateDialogueRules(settings) {
  if (settings && settings.dialogueRules === PREVIOUS_DIALOGUE_RULES) settings.dialogueRules = DEFAULT_DIALOGUE_RULES;
  return settings;
}

const DEFAULT_SETTINGS = {
  tokenBudgetCharacter: 15,
  tokenBudgetLore: 20,
  tokenBudgetHistory: 35,
  tokenBudgetUser: 30,
  defaultTemperature: 0.8,
  defaultMaxTokens: 0,
  // 0 = Auto: the model's own context length.
  defaultContextWindow: 0,
  userName: 'Anon',
  defaultWritingPreset: 'immersive-rp',
  defaultResponseLength: '',
  defaultPov: '',
  defaultModel: '',
  defaultFitMethod: 'dropOld',
  customWritingStyle: '',
  // Forge-specific engine choice ('' / 0 = follow the global defaults).
  forgeModelId: '',
  forgeContextWindow: 0,
  // The Studio: how much of each source it keeps, in words.
  studioSourceWords: 1500,
  // The Story Writer's own model and context picks.
  storyModelId: '',
  storyContextWindow: 0,
  // Feel: streaming motion and the Home's table roll.
  showWritingMotion: true,
  homeTableRoll: true,
  // How people talk, in every roleplay and story prompt. The user's text;
  // an empty string means none.
  dialogueRules: DEFAULT_DIALOGUE_RULES,
  // The shape of each sheet field the Studio writes (sections, one paragraph
  // each). The user's text; an empty string means every field keeps its usual shape.
  sheetStructure: DEFAULT_SHEET_STRUCTURE,
};

/** Motion off: `.cr-still` on the body stops every Creations animation. */
function applyFeel(settings) {
  try { document.body.classList.toggle('cr-still', settings?.showWritingMotion === false); } catch { /* no DOM */ }
}

async function loadSettings(fs, workspaceUri) {
  const path = resolveUri(workspaceUri, `${EXT_ROOT}/settings.json`);
  try {
    const { content } = await fs.readFile(path);
    return migrateDialogueRules(migrateContextDefault({ ...DEFAULT_SETTINGS, ...JSON.parse(content) }));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(fs, workspaceUri, settings) {
  await ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', 'text-generator']);
  const path = resolveUri(workspaceUri, `${EXT_ROOT}/settings.json`);
  await fs.writeFile(path, JSON.stringify(settings, null, 2));
}

function renderSettingsPage(container, parallx) {
  injectStyles();

  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;

  const root = el('div', 'tg-page');
  container.appendChild(root);

  const headerHost = el('div', 'cr-settings-head');
  root.appendChild(headerHost);
  parallx.ui.createPageHeader(headerHost, {
    title: 'Creations Settings',
    back: { label: 'Creations', onClick: () => void parallx.commands.executeCommand('textGenerator.openHome') },
    subtitle: 'How it feels, the defaults for new chats and stories, and the token budget.',
  });

  const content = el('div', 'tg-page-content');
  root.appendChild(content);

  if (!fs || !workspaceUri) {
    content.appendChild(el('div', 'tg-empty', { text: 'Open a workspace to configure settings.' }));
    return { dispose() { container.innerHTML = ''; } };
  }

  // Feel: saved the moment they change.
  const feel = el('div', 'cr-feel');
  feel.appendChild(el('div', 'tg-page-section-title', { text: 'Feel' }));
  const feelRow = (label, hint, key) => {
    const row = el('div', 'cr-feel-row');
    const text = el('div', 'cr-feel-text');
    text.appendChild(el('div', 'cr-feel-label', { text: label }));
    text.appendChild(el('div', 'cr-feel-hint', { text: hint }));
    row.appendChild(text);
    const seg = parallx.ui.createSegmented(row, {
      ariaLabel: label,
      items: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      value: 'on',
      onChange: async (v) => {
        const cur = await loadSettings(fs, workspaceUri);
        const next = { ...cur, [key]: v === 'on' };
        await saveSettings(fs, workspaceUri, next);
        applyFeel(next);
      },
    });
    feel.appendChild(row);
    return seg;
  };
  const motionSeg = feelRow('Show writing as it arrives', 'Text streams in with a cursor, and fields still to come shimmer. Off keeps everything still.', 'showWritingMotion');
  const rollSeg = feelRow('Roll a table on Home', 'Home shows a fresh roll from one of your tables each time it opens.', 'homeTableRoll');
  content.appendChild(feel);

  const form = el('div', 'tg-settings-form');
  content.appendChild(form);

  function formGroup(label, hint, inputType, key, opts = {}) {
    const group = el('div', 'tg-form-group');
    group.appendChild(el('label', 'tg-form-label', { text: label }));
    if (hint) group.appendChild(el('div', 'tg-form-hint', { text: hint }));

    if (inputType === 'select' && opts.options) {
      const dd = tgSelect(parallx, {
        className: 'tg-form-select',
        layout: 'full',
        items: opts.options.map((opt) => ({ value: opt.value, label: opt.label || opt.value })),
      });
      group.appendChild(dd.element);
      form.appendChild(group);
      return dd;
    }
    const input = el('input', 'tg-form-input');
    input.type = inputType;
    if (opts.min !== undefined) input.min = opts.min;
    if (opts.max !== undefined) input.max = opts.max;
    if (opts.step !== undefined) input.step = opts.step;
    input.dataset.key = key;
    group.appendChild(input);
    form.appendChild(group);
    return input;
  }

  // Token budget section
  form.appendChild(el('div', 'tg-page-section-title', { text: 'Token Budget (% of context window)' }));
  const budgetTotalEl = el('div', 'tg-form-budget-total');
  form.appendChild(budgetTotalEl);
  const charBudget = formGroup('Character prompt', 'Higher = richer persona, but eats history. Default 15%.', 'number', 'tokenBudgetCharacter', { min: 0, max: 90 });
  const loreBudget = formGroup('Lore / World info', 'Lorebook + long-term memory share. Default 20%.', 'number', 'tokenBudgetLore', { min: 0, max: 90 });
  const histBudget = formGroup('Chat history', 'Older turns kept in context. Default 35%.', 'number', 'tokenBudgetHistory', { min: 0, max: 90 });
  const userBudget = formGroup('User message', 'Headroom for your latest message. Default 30%.', 'number', 'tokenBudgetUser', { min: 0, max: 90 });
  function recomputeBudgetTotal() {
    const sum = [charBudget, loreBudget, histBudget, userBudget]
      .map(i => Number(i.value) || 0).reduce((a, b) => a + b, 0);
    if (sum === 100) {
      budgetTotalEl.textContent = `Total: ${sum}%`;
      budgetTotalEl.className = 'tg-form-budget-total tg-form-budget-total--ok';
    } else if (sum === 0) {
      budgetTotalEl.textContent = 'Total: 0% (falls back to defaults)';
      budgetTotalEl.className = 'tg-form-budget-total tg-form-budget-total--warn';
    } else {
      budgetTotalEl.textContent = `Total: ${sum}% (values will be scaled to 100%)`;
      budgetTotalEl.className = 'tg-form-budget-total tg-form-budget-total--warn';
    }
  }
  for (const inp of [charBudget, loreBudget, histBudget, userBudget]) {
    inp.addEventListener('input', recomputeBudgetTotal);
  }

  // Defaults section
  const sep = el('div', 'tg-page-section-title', { text: 'Generation Defaults' });
  sep.style.marginTop = '24px';
  form.appendChild(sep);
  const tempInput = formGroup('Temperature', 'Controls randomness (0.0 = deterministic, 2.0 = very random)', 'number', 'defaultTemperature', { min: 0, max: 2, step: 0.1 });
  const maxTokInput = formGroup('Max tokens per response', '0 = unlimited (recommended for thinking models)', 'number', 'defaultMaxTokens', { min: 0, max: 16384 });
  const ctxInput = formGroup('Default context window', 'Tokens the prompt and reply share, sent to Ollama as num_ctx. 0 = Auto, the model\'s own context length. The Ctx picker in a chat overrides this.', 'number', 'defaultContextWindow', { min: 0, max: 1048576 });
  const userNameInput = formGroup('User display name', 'Used in {{user}} template substitution', 'text', 'userName');
  const sourceWordsInput = formGroup('Words Kept Per Source', 'How much of each source the Character Studio keeps, in words. Default 1500.', 'number', 'studioSourceWords', { min: 200, max: 20000, step: 100 });
  const presetSelect = formGroup('Default writing preset', 'Applied to newly created chats', 'select', 'defaultWritingPreset', {
    options: Object.entries(WRITING_PRESETS).map(([key, p]) => ({ label: p.label, value: key })),
  });

  // Custom writing-style editor — the prompt text used when any chat selects
  // the "Custom" preset. Always visible so users can draft a custom style
  // before switching the dropdown over.
  const customStyleGroup = el('div', 'tg-form-group');
  customStyleGroup.appendChild(el('label', 'tg-form-label', { text: 'Custom writing style' }));
  customStyleGroup.appendChild(el('div', 'tg-form-hint', {
    text: 'Used when a chat or character selects the "Custom" preset. Markdown is fine. This text is injected verbatim under "## Writing Style".',
  }));
  const customStyleInput = el('textarea', 'tg-form-input');
  customStyleInput.rows = 10;
  customStyleInput.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
  customStyleInput.style.minHeight = '180px';
  customStyleInput.placeholder = '- Write in second-person, present tense.\n- Keep paragraphs short.\n- Lean into sensory detail and quiet beats.';
  customStyleGroup.appendChild(customStyleInput);
  form.appendChild(customStyleGroup);
  // Dialogue rules: the one block of craft that rides in every roleplay and
  // story prompt. Shipped with a default; the user's text once edited.
  const rulesGroup = el('div', 'tg-form-group');
  rulesGroup.appendChild(el('label', 'tg-form-label', { text: 'Dialogue rules' }));
  rulesGroup.appendChild(el('div', 'tg-form-hint', {
    text: 'How people talk, in every chat and story, under "## How People Talk". Edit freely; empty means none. A chat\'s standing director\'s note adds to it for that chat.',
  }));
  const rulesInput = el('textarea', 'tg-form-input');
  rulesInput.rows = 8;
  rulesInput.style.minHeight = '150px';
  rulesInput.placeholder = 'Leave empty for no dialogue rules.';
  rulesGroup.appendChild(rulesInput);
  const rulesReset = el('button', 'tg-form-reset', { text: 'Reset To Default' });
  rulesReset.type = 'button';
  rulesReset.title = 'Put the shipped dialogue rules back';
  rulesReset.addEventListener('click', () => { rulesInput.value = DEFAULT_DIALOGUE_RULES; });
  rulesGroup.appendChild(rulesReset);
  form.appendChild(rulesGroup);
  const structureGroup = el('div', 'tg-form-group');
  structureGroup.appendChild(el('label', 'tg-form-label', { text: 'Sheet structure' }));
  structureGroup.appendChild(el('div', 'tg-form-hint', {
    text: 'What the Character Studio must cover in each sheet field. A heading names a field (Appearance, Personality...); the lines under it are its sections, in order, each written as its own paragraph. Edit freely; empty means every field keeps its usual shape.',
  }));
  const structureInput = el('textarea', 'tg-form-input');
  structureInput.rows = 10;
  structureInput.style.minHeight = '180px';
  structureInput.placeholder = 'Leave empty for the usual one-paragraph fields.';
  structureGroup.appendChild(structureInput);
  const structureReset = el('button', 'tg-form-reset', { text: 'Reset To Default' });
  structureReset.type = 'button';
  structureReset.title = 'Put the shipped sheet structure back';
  structureReset.addEventListener('click', () => { structureInput.value = DEFAULT_SHEET_STRUCTURE; });
  structureGroup.appendChild(structureReset);
  form.appendChild(structureGroup);
  const responseLengthSelect = formGroup('Default response length', 'Applied to newly created chats when no character override exists', 'select', 'defaultResponseLength', {
    options: [
      { value: '', label: 'No Limit (Default)' },
      { value: 'short', label: 'Short (1 Paragraph)' },
      { value: 'medium', label: 'Medium (2-3 Paragraphs)' },
      { value: 'long', label: 'Long (4+ Paragraphs)' },
    ],
  });
  const defaultPovSelect = formGroup('Default point of view', 'POV override applied when no character/thread setting exists. Inherit lets the writing preset decide.', 'select', 'defaultPov', {
    options: Object.entries(POV_OPTIONS).map(([key, p]) => ({ label: p.label, value: key })),
  });
  const defaultModelSelect = formGroup('Default model', 'Used for newly created chats. Leave empty to auto-select first available model.', 'select', 'defaultModel', {
    options: [{ value: '', label: '(auto, first available)' }],
  });
  const fitMethodSelect = formGroup('Default context-fit method', 'How to handle conversations longer than the context window.', 'select', 'defaultFitMethod', {
    options: [
      { value: 'dropOld', label: 'Drop Oldest Messages' },
      { value: 'summarizeOld', label: 'Keep the memory file and quote earlier turns (recommended)' },
    ],
  });

  // Save button
  const saveRow = el('div', 'tg-form-group');
  saveRow.style.display = 'flex';
  saveRow.style.alignItems = 'center';
  saveRow.style.marginTop = '8px';
  const saveBtn = el('button', 'tg-form-save', { text: 'Save Settings' });
  const savedLabel = el('span', 'tg-form-saved', { text: 'Saved!' });
  saveRow.append(saveBtn, savedLabel);
  form.appendChild(saveRow);

  // Note: presetSelect / responseLengthSelect / defaultModelSelect / fitMethodSelect are
  // referenced directly by load() and the save handler, so the `inputs` object only
  // tracks the basic-typed fields used by the integer-clamp logic above.
  void [presetSelect, responseLengthSelect, defaultModelSelect, fitMethodSelect];

  async function load() {
    const s = await loadSettings(fs, workspaceUri);
    motionSeg.value = s.showWritingMotion === false ? 'off' : 'on';
    rollSeg.value = s.homeTableRoll === false ? 'off' : 'on';
    charBudget.value = s.tokenBudgetCharacter;
    loreBudget.value = s.tokenBudgetLore;
    histBudget.value = s.tokenBudgetHistory;
    userBudget.value = s.tokenBudgetUser;
    tempInput.value = s.defaultTemperature;
    maxTokInput.value = s.defaultMaxTokens;
    ctxInput.value = s.defaultContextWindow;
    userNameInput.value = s.userName;
    sourceWordsInput.value = s.studioSourceWords || DEFAULT_SETTINGS.studioSourceWords;
    presetSelect.value = s.defaultWritingPreset || 'immersive-rp';
    customStyleInput.value = s.customWritingStyle || '';
    rulesInput.value = typeof s.dialogueRules === 'string' ? s.dialogueRules : DEFAULT_DIALOGUE_RULES;
    structureInput.value = typeof s.sheetStructure === 'string' ? s.sheetStructure : DEFAULT_SHEET_STRUCTURE;
    responseLengthSelect.value = s.defaultResponseLength || '';
    defaultPovSelect.value = s.defaultPov || '';
    fitMethodSelect.value = s.defaultFitMethod || 'dropOld';
    // Populate model dropdown from available LM models
    let modelItems = [{ value: '', label: '(auto, first available)' }];
    if (parallx.lm) {
      try {
        const availableModels = await (parallx.lm.getModels?.() || parallx.lm.listModels?.() || Promise.resolve([]));
        modelItems = modelItems.concat(availableModels.map((m) => ({ value: m.id, label: m.displayName || m.name || m.id })));
        defaultModelSelect.setItems(modelItems);
        // If saved default is no longer available, surface a warning.
        if (s.defaultModel && !availableModels.some(m => m.id === s.defaultModel)) {
          const warn = el('div', 'tg-form-hint tg-form-hint--warn', {
            text: `The saved default model "${s.defaultModel}" is not available right now. The first available model is used instead.`,
          });
          defaultModelSelect.element.parentElement?.appendChild(warn);
        }
      } catch { /* no models available */ }
    }
    defaultModelSelect.value = (s.defaultModel && modelItems.some((i) => i.value === s.defaultModel)) ? s.defaultModel : '';
    recomputeBudgetTotal();
  }

  saveBtn.addEventListener('click', async () => {
    // Spread the currently persisted settings first so keys this form
    // doesn't own (e.g. the forge's model/ctx choice) survive a save.
    const settings = {
      ...(await loadSettings(fs, workspaceUri)),
      tokenBudgetCharacter: Number.isFinite(Number(charBudget.value)) ? Number(charBudget.value) : DEFAULT_SETTINGS.tokenBudgetCharacter,
      tokenBudgetLore: Number.isFinite(Number(loreBudget.value)) ? Number(loreBudget.value) : DEFAULT_SETTINGS.tokenBudgetLore,
      tokenBudgetHistory: Number.isFinite(Number(histBudget.value)) ? Number(histBudget.value) : DEFAULT_SETTINGS.tokenBudgetHistory,
      tokenBudgetUser: Number.isFinite(Number(userBudget.value)) ? Number(userBudget.value) : DEFAULT_SETTINGS.tokenBudgetUser,
      defaultTemperature: Number.isFinite(Number(tempInput.value)) ? Number(tempInput.value) : DEFAULT_SETTINGS.defaultTemperature,
      defaultMaxTokens: Number.isFinite(Number(maxTokInput.value)) ? Number(maxTokInput.value) : DEFAULT_SETTINGS.defaultMaxTokens,
      defaultContextWindow: Number.isFinite(Number(ctxInput.value)) && Number(ctxInput.value) > 0 ? Number(ctxInput.value) : 0,
      defaultContextWindowChosen: true,
      userName: userNameInput.value.trim() || DEFAULT_SETTINGS.userName,
      studioSourceWords: Number(sourceWordsInput.value) >= 200 ? Number(sourceWordsInput.value) : DEFAULT_SETTINGS.studioSourceWords,
      defaultWritingPreset: presetSelect.value || DEFAULT_SETTINGS.defaultWritingPreset,
      defaultResponseLength: responseLengthSelect.value || '',
      defaultPov: defaultPovSelect.value || '',
      defaultModel: defaultModelSelect.value || '',
      defaultFitMethod: fitMethodSelect.value || DEFAULT_SETTINGS.defaultFitMethod,
      customWritingStyle: customStyleInput.value || '',
      // Saved as typed, '' included: an emptied field means none, not the default.
      dialogueRules: rulesInput.value,
      sheetStructure: structureInput.value,
    };
    await saveSettings(fs, workspaceUri, settings);
    savedLabel.classList.add('tg-form-saved--show');
    setTimeout(() => savedLabel.classList.remove('tg-form-saved--show'), 2000);
  });

  load();
  return { dispose() { container.innerHTML = ''; } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10D2: CHARACTER EDITOR (Perchance-parity settings panel)
// ═══════════════════════════════════════════════════════════════════════════════

function renderCharacterEditor(container, parallx, input) {
  injectStyles();

  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  const charFileName = input?.instanceId || input?.id;

  const root = el('div', 'tg-ce');
  container.appendChild(root);

  if (!fs || !workspaceUri || !charFileName) {
    root.appendChild(el('div', 'tg-empty', { text: 'Error: missing workspace or character.' }));
    return { dispose() { container.innerHTML = ''; } };
  }

  // ── Header ──
  const header = el('div', 'tg-ce-header');
  const headerInfo = el('div', null);
  const titleEl = el('div', 'tg-ce-title', { text: 'Character Settings' });
  const subtitleEl = el('div', 'tg-ce-subtitle', { text: charFileName });
  headerInfo.append(titleEl, subtitleEl);
  header.append(el('div', null, { html: icon('user', 24) }), headerInfo);
  root.appendChild(header);

  // ── Helper to create a labeled field ──
  function field(labelHtml, hintText, inputEl) {
    const wrap = el('div', 'tg-ce-field');
    const lbl = el('label', 'tg-ce-label', { html: labelHtml });
    wrap.appendChild(lbl);
    if (hintText) wrap.appendChild(el('div', 'tg-ce-hint', { text: hintText }));
    wrap.appendChild(inputEl);
    return wrap;
  }

  // ── Basic fields ──
  const nameInput = el('input', 'tg-ce-input');
  nameInput.placeholder = 'Character name';
  root.appendChild(field(`${icon('user', 14)} Character name`, null, nameInput));

  const roleInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--tall');
  roleInput.placeholder = 'Include the most important details first. Also, it\'s a good idea to include example dialogue if you can. Show the AI how you want the character to speak.';
  root.appendChild(field(
    `${icon('file-text', 14)} Character description/personality/instruction/role`,
    'This should ideally be less than 1000 words. You can write {{user}} to refer to the user\'s name.',
    roleInput,
  ));

  const lengthSelect = tgSelect(parallx, {
    className: 'tg-ce-select',
    layout: 'full',
    items: [
      { value: '', label: 'No Reply Length Limit' },
      { value: 'short', label: '1 paragraph' },
      { value: 'medium', label: '2-3 paragraphs' },
      { value: 'long', label: '4+ paragraphs' },
    ],
  });
  root.appendChild(field(`${icon('ruler', 14)} Strict message length limit`, 'Try setting this to one paragraph if the character keeps undesirably talking/acting on your behalf.', lengthSelect.element));

  const userNameInput = el('input', 'tg-ce-input');
  userNameInput.placeholder = '(optional)';
  // userName and userDescription moved into More section — they're persona-level
  // overrides most users never set.

  const userDescInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--short');
  userDescInput.placeholder = '(optional)';

  root.appendChild(el('hr', 'tg-ce-separator'));

  const reminderInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--short');
  reminderInput.placeholder = '(optional) e.g. "Responses should be short and creative. Always stay in character."';
  root.appendChild(field(
    `${icon('bell', 14)} Character reminder note`,
    'Remind the AI of important things, writing tips, and so on. Use this for important stuff that the AI often forgets. Try to keep this under 100 words, about a paragraph at most.',
    reminderInput,
  ));

  const voiceAnchorInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--short');
  voiceAnchorInput.placeholder = '(optional) 3-5 lines: tone, signature phrases, phrases to never use.';
  root.appendChild(field(
    `${icon('mic', 14)} Voice anchor`,
    'Injected immediately before generation on every turn, the strongest position in the prompt. Describe the VOICE itself: tone, signature phrases, no-go phrases. If empty, the first lines of the description are used instead.',
    voiceAnchorInput,
  ));

  const presetSelect = tgSelect(parallx, {
    className: 'tg-ce-select',
    layout: 'full',
    items: Object.entries(WRITING_PRESETS).map(([key, p]) => ({ value: key, label: p.label })),
  });
  const presetField = field(
    `${icon('pencil-line', 14)} General writing instructions`,
    'These instructions apply to the whole chat, regardless of which character is currently speaking. It\'s for defining general writing style and the "type of experience".',
    presetSelect.element,
  );
  // Inheritance chain (matches the actual prompt wiring): a per-chat
  // override set in the chat's settings drawer wins; otherwise this
  // character value; otherwise the global default.
  presetField.appendChild(el('div', 'tg-form-inherit', {
    text: 'A per-chat override (Chat Settings drawer) wins over this. If both are unset, the global default in Settings is used.',
  }));
  root.appendChild(presetField);

  // Point of view override — stacks under the writing preset.
  const povSelect = tgSelect(parallx, {
    className: 'tg-ce-select',
    layout: 'full',
    items: Object.entries(POV_OPTIONS).map(([key, p]) => ({ value: key, label: p.label })),
  });
  const povField = field(
    `${icon('eye', 14)} Point of view`,
    'Locks narration POV regardless of writing preset. "Inherit" lets the preset decide.',
    povSelect.element,
  );
  povField.appendChild(el('div', 'tg-form-inherit', {
    text: 'If unset, the global default in Settings is used.',
  }));
  root.appendChild(povField);

  const initialMsgInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--tall');
  initialMsgInput.placeholder = '[USER]: hey\n[AI]: um hi\n[SYSTEM; hiddenFrom=ai]: The AI can\'t see this message. Useful for user instructions / welcome messages / credits / etc.';
  root.appendChild(field(
    `${icon('message-square', 14)} Initial chat messages`,
    'You can use this to teach the AI how this character typically speaks, and/or to define an initial scenario. Follow the "[AI]: ... [USER]: ..." format.',
    initialMsgInput,
  ));

  // ── Example dialogue (lifted out of "More") ──
  const exampleInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--tall');
  exampleInput.placeholder = '[USER]: How are you?\n[AI]: I\'m doing well, thank you for asking!';
  root.appendChild(field(
    `${icon('message-circle', 14)} Example dialogue`,
    'Example conversations that teach the AI the character\'s speaking style. Use [AI]: and [USER]: format.',
    exampleInput,
  ));

  // ── Lorebooks (lifted out of "More") ──
  // M79 Phase 5 — Lorebook picker filter input. The picker can grow to
  // dozens of files in mature workspaces; a substring filter makes it
  // workable. Case-insensitive plain-text contains check (no regex —
  // user-typed input).
  const loreFilterInput = el('input', 'tg-ce-input');
  loreFilterInput.type = 'text';
  loreFilterInput.placeholder = 'Filter lorebooks…';
  loreFilterInput.style.cssText = 'margin-bottom: 6px;';

  const loreListContainer = el('div', 'tg-ce-lore-list');
  let _allLoreFiles = [];
  const _loreSelected = new Set();
  let _loreFilter = '';
  function rebuildLoreList() {
    loreListContainer.innerHTML = '';
    const known = new Set(_allLoreFiles);
    const q = _loreFilter.trim().toLowerCase();
    const matches = (fname) => !q || fname.toLowerCase().includes(q);

    if (_allLoreFiles.length === 0 && _loreSelected.size === 0) {
      loreListContainer.appendChild(el('div', 'tg-ce-lore-empty', {
        text: 'No lorebooks in the lorebooks/ folder yet. Create one from the Home page.',
      }));
      return;
    }
    const visibleKnown = _allLoreFiles.filter(matches);
    const visibleOrphans = [...(_loreSelected)].filter(s => !known.has(s) && matches(s));

    if (q && visibleKnown.length === 0 && visibleOrphans.length === 0) {
      loreListContainer.appendChild(el('div', 'tg-ce-lore-empty', {
        text: `No lorebooks match "${q}".`,
      }));
      return;
    }
    for (const fname of visibleKnown) {
      const row = el('label', 'tg-ce-lore-row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = _loreSelected.has(fname);
      cb.addEventListener('change', () => {
        if (cb.checked) _loreSelected.add(fname);
        else _loreSelected.delete(fname);
      });
      row.appendChild(cb);
      row.appendChild(el('span', null, { text: fname }));
      loreListContainer.appendChild(row);
    }
    for (const sel of visibleOrphans) {
      const row = el('label', 'tg-ce-lore-row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', () => { if (!cb.checked) _loreSelected.delete(sel); });
      row.appendChild(cb);
      const lbl = el('span', null, { text: `${sel}  (file not found)` });
      lbl.style.color = 'var(--vscode-editorWarning-foreground, #cca700)';
      row.appendChild(lbl);
      loreListContainer.appendChild(row);
    }
  }
  loreFilterInput.addEventListener('input', () => {
    _loreFilter = loreFilterInput.value;
    rebuildLoreList();
  });
  const loreWrap = el('div');
  loreWrap.appendChild(loreFilterInput);
  loreWrap.appendChild(loreListContainer);
  root.appendChild(field(
    `${icon('book-open', 14)} Lorebooks`,
    'Tick lorebooks this character should pull world info from. Triggers fire when keywords appear in recent context. Use the filter to narrow long lists.',
    loreWrap,
  ));

  // ── Temperature + max tokens (lifted out of "More") ──
  const genRow = el('div', 'tg-ce-row');
  const tempInput = el('input', 'tg-ce-input');
  tempInput.type = 'number';
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  genRow.appendChild(field('Temperature', 'Creativity 0–2. Lower = consistent, higher = wild. Default 0.8.', tempInput));
  const maxTokInput = el('input', 'tg-ce-input');
  maxTokInput.type = 'number';
  maxTokInput.min = '0';
  genRow.appendChild(field('Max tokens', '0 = unlimited (best for thinking models). Caps reply length, lower = faster.', maxTokInput));
  root.appendChild(genRow);

  // ── "show more settings" / collapsed section ──
  const moreBtn = el('button', 'tg-ce-more-btn', { text: 'Show More Settings' });
  root.appendChild(moreBtn);
  const moreSection = el('div', 'tg-ce-more-section');
  root.appendChild(moreSection);

  moreBtn.addEventListener('click', () => {
    const visible = moreSection.classList.toggle('tg-ce-more-section--visible');
    moreBtn.textContent = visible ? 'Hide More Settings' : 'Show More Settings';
  });

  // ── More Settings fields ──
  // User persona overrides (moved from top — most users never touch these)
  moreSection.appendChild(field('User\'s name', 'Overrides your default username when chatting with this character.', userNameInput));
  moreSection.appendChild(field('User\'s description/role', 'What role do you play when talking to this character?', userDescInput));

  const userReminderInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--short');
  userReminderInput.placeholder = '(optional) e.g. "Responses should be short and creative. Always stay in character."';
  moreSection.appendChild(field(
    `${icon('bell', 14)} User reminder note`,
    'In case you get the AI to write on your behalf, this is the reminder note used in that case.',
    userReminderInput,
  ));

  const msgStyleInput = el('input', 'tg-ce-input');
  msgStyleInput.placeholder = 'e.g. color:blue; font-size:90%;';
  moreSection.appendChild(field(
    `${icon('palette', 14)} Default message style (color, font, size, etc.)`,
    'Try adding CSS like color:blue; font-size:90%. This customizes message bubble appearance.',
    msgStyleInput,
  ));

  moreSection.appendChild(el('hr', 'tg-ce-separator'));

  // Lorebooks textarea removed — replaced by the checkbox list lifted to top.

  // Context method
  const fitSelect = tgSelect(parallx, {
    className: 'tg-ce-select',
    layout: 'full',
    items: [
      { value: '', label: '(use global default)' },
      { value: 'dropOld', label: 'Drop Oldest Messages' },
      { value: 'summarizeOld', label: 'Keep the memory file and quote earlier turns (recommended)' },
    ],
  });
  moreSection.appendChild(field('Context-fit method', 'How to handle conversations longer than the context window. Overrides the global default.', fitSelect.element));

  // Extended memory
  const memorySelect = tgSelect(parallx, {
    className: 'tg-ce-select',
    layout: 'full',
    items: [
      { value: 'false', label: 'Off' },
      { value: 'true', label: 'On' },
    ],
  });
  moreSection.appendChild(field(
    `${icon('brain', 14)} Extended character memory`,
    'When On, /mem entries are guaranteed at least 40% of the Lore lane (vs. proportional to size). Use it when long-term recall matters more than world-info detail.',
    memorySelect.element,
  ));

  moreSection.appendChild(el('hr', 'tg-ce-separator'));

  moreSection.appendChild(el('hr', 'tg-ce-separator'));

  // Shortcut buttons
  const shortcutInput = el('textarea', 'tg-ce-textarea');
  shortcutInput.placeholder = '@name= {{char}}\n@message=/ai <optional writing instruction>\n@insertionType=replace\n@autoSend=no\n\n@name= {{user}}\n@message=/user <optional writing instruction>\n@insertionType=replace\n@autoSend=no';
  moreSection.appendChild(field(
    `${icon('mouse-pointer-click', 14)} Shortcut buttons (above reply box)`,
    'Leave this empty to use the defaults. See Perchance format.',
    shortcutInput,
  ));

  moreSection.appendChild(el('hr', 'tg-ce-separator'));

  // System name, placeholder
  const sysNameInput = el('input', 'tg-ce-input');
  sysNameInput.placeholder = '(optional)';
  moreSection.appendChild(field('System\'s name', null, sysNameInput));

  const placeholderInput = el('input', 'tg-ce-input');
  placeholderInput.placeholder = 'e.g. "Type your reply to {{char}} here..."';
  moreSection.appendChild(field('Message input placeholder', null, placeholderInput));

  // (Example dialogue + temperature/maxTokens lifted to the top section.)

  // ── Footer: cancel + sandbox + save ──
  const footer = el('div', 'tg-ce-footer');
  const cancelBtn = el('button', 'tg-ce-cancel-btn', { text: 'Revert' });
  cancelBtn.title = 'Discard unsaved changes (re-load from disk)';
  const sandboxBtn = el('button', 'tg-ce-cancel-btn', { html: `${icon('play', 13)} Test In Chat` });
  sandboxBtn.title = 'Save then open a fresh chat with this character';
  const exportBtn = el('button', 'tg-ce-cancel-btn', { html: `${icon('file-down', 13)} Export As Markdown` });
  exportBtn.title = 'Save a markdown copy of this form, unsaved edits included';
  const savedLabel = el('span', 'tg-ce-saved', { text: 'Saved!' });
  const saveBtn = el('button', 'tg-ce-save-btn', { text: 'Save Character' });
  footer.append(cancelBtn, sandboxBtn, exportBtn, savedLabel, saveBtn);
  root.appendChild(footer);

  let charData = null;

  // ── Unsaved-changes guard ──
  // `snapshotForm` snapshots the current form state as a stable JSON string so
  // we can detect dirtiness without per-field event wiring. The baseline is
  // re-taken after every successful save / load so subsequent edits are
  // measured against the latest persisted state.
  let _baselineSnapshot = null;
  function snapshotForm() {
    try { return JSON.stringify(collectForm()); }
    catch { return null; }
  }
  function isDirty() {
    if (_baselineSnapshot == null) return false;
    return snapshotForm() !== _baselineSnapshot;
  }
  const _beforeUnload = (event) => {
    if (!isDirty()) return undefined;
    event.preventDefault();
    // Modern browsers ignore the custom string, but returning a value still
    // triggers the native confirm dialog.
    event.returnValue = '';
    return '';
  };
  window.addEventListener('beforeunload', _beforeUnload);

  // ── Populate form from loaded data ──
  function populateForm(data) {
    nameInput.value = data.name || '';
    roleInput.value = data.roleInstruction || '';
    lengthSelect.value = data.messageLengthLimit || '';
    userNameInput.value = data.userName || '';
    userDescInput.value = data.userDescription || '';
    reminderInput.value = data.reminder || '';
    voiceAnchorInput.value = data.voiceAnchor || '';
    presetSelect.value = data.writingPreset || 'immersive-rp';
    povSelect.value = data.pov || '';
    initialMsgInput.value = data.initialMessages || '';
    userReminderInput.value = data.userReminder || '';
    msgStyleInput.value = data.messageWrapperStyle || '';
    _loreSelected.clear();
    for (const f of (data.lorebookFiles || [])) _loreSelected.add(f);
    rebuildLoreList();
    fitSelect.value = data.fitMessagesInContextMethod || '';
    memorySelect.value = String(data.extendedMemory || false);
    shortcutInput.value = data.shortcutButtons || '';
    sysNameInput.value = data.systemName || '';
    placeholderInput.value = data.messageInputPlaceholder || '';
    exampleInput.value = data.exampleDialogue || '';
    tempInput.value = data.temperature ?? 0.8;
    maxTokInput.value = data.maxTokensPerMessage ?? 0;
  }

  // ── Collect form into data object ──
  function collectForm() {
    return {
      ...charData,
      name: nameInput.value.trim() || 'Unnamed',
      roleInstruction: roleInput.value,
      messageLengthLimit: lengthSelect.value,
      userName: userNameInput.value.trim(),
      userDescription: userDescInput.value,
      reminder: reminderInput.value,
      voiceAnchor: voiceAnchorInput.value,
      writingPreset: presetSelect.value || 'immersive-rp',
      initialMessages: initialMsgInput.value,
      userReminder: userReminderInput.value,
      messageWrapperStyle: msgStyleInput.value.trim(),
      lorebookFiles: Array.from(_loreSelected),
      fitMessagesInContextMethod: fitSelect.value || '',
      extendedMemory: memorySelect.value === 'true',
      shortcutButtons: shortcutInput.value,
      systemName: sysNameInput.value.trim(),
      messageInputPlaceholder: placeholderInput.value.trim(),
      exampleDialogue: exampleInput.value,
      temperature: Number.isFinite(Number(tempInput.value)) ? Number(tempInput.value) : 0.8,
      maxTokensPerMessage: Number(maxTokInput.value) || 0,
      pov: povSelect.value || '',
    };
  }

  saveBtn.addEventListener('click', async () => {
    const data = collectForm();
    await saveCharacter(fs, workspaceUri, charFileName, data);
    charData = data;
    _baselineSnapshot = snapshotForm();
    savedLabel.classList.add('tg-ce-saved--show');
    setTimeout(() => savedLabel.classList.remove('tg-ce-saved--show'), 2000);
    _refreshSidebar?.();
  });

  exportBtn.addEventListener('click', () => {
    exportCharacterToMarkdown(collectForm());
  });

  sandboxBtn.addEventListener('click', async () => {
    if (isDirty()) {
      const data = collectForm();
      await saveCharacter(fs, workspaceUri, charFileName, data);
      charData = data;
      _baselineSnapshot = snapshotForm();
    }
    try {
      const settings = await loadSettings(fs, workspaceUri);
      const newThread = await createThread(fs, workspaceUri, charFileName, settings.defaultModel || null);
      parallx.editors?.openEditor?.({
        typeId: 'text-generator-chat',
        title: `Test: ${nameInput.value || charFileName}`,
        icon: 'play',
        instanceId: newThread.id,
      });
      _refreshSidebar?.();
    } catch (err) {
      parallx.window?.showErrorMessage?.('Could not open test chat: ' + (err?.message || err));
    }
  });

  cancelBtn.addEventListener('click', async () => {
    if (isDirty()) {
      const choice = await parallx.window.showWarningMessage('Discard the unsaved changes?', { title: 'Discard' });
      if (!choice || choice.title !== 'Discard') return;
    }
    if (charData) {
      populateForm(charData);
      _baselineSnapshot = snapshotForm();
    }
  });

  // ── Init: load character data ──
  async function init() {
    try {
      const dir = resolveUri(workspaceUri, `${EXT_ROOT}/characters`);
      const { content } = await fs.readFile(resolveUri(dir, charFileName));
      charData = JSON.parse(content);
    } catch (err) {
      root.innerHTML = '';
      root.appendChild(el('div', 'tg-empty tg-error', { text: 'Failed to load character: ' + (err.message || err) }));
      return;
    }
    // Scan available lorebooks so the checkbox list can render real options.
    try {
      const lbs = await scanLorebooks(fs, workspaceUri);
      _allLoreFiles = lbs.map(lb => lb.fileName).filter(Boolean);
    } catch { _allLoreFiles = []; }
    populateForm(charData);
    _baselineSnapshot = snapshotForm();
    subtitleEl.textContent = charData.name || charFileName;
  }

  init();
  return {
    dispose() {
      window.removeEventListener('beforeunload', _beforeUnload);
      container.innerHTML = '';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10E: PER-CHAT SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════════════════

function renderChatSettingsPage(container, parallx, input) {
  injectStyles();

  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  const rawId = input?.instanceId || input?.id || '';
  const threadId = rawId.startsWith('chat-settings:') ? rawId.slice('chat-settings:'.length) : rawId;

  const root = el('div', 'tg-chat-settings');
  container.appendChild(root);

  if (!fs || !workspaceUri || !threadId) {
    root.appendChild(el('div', 'tg-empty', { text: 'Error: missing workspace or thread.' }));
    return { dispose() { container.innerHTML = ''; } };
  }

  const header = el('div', 'tg-chat-settings-header');
  const iconWrap = el('div', null, { html: icon('sliders', 24) });
  const headerInfo = el('div', null);
  const titleEl = el('div', 'tg-chat-settings-title', { text: 'Chat Info' });
  const subtitleEl = el('div', 'tg-chat-settings-subtitle', { text: 'Title, participants, and model. Writing style, POV, length, and generation knobs live on the character.' });
  headerInfo.append(titleEl, subtitleEl);
  header.append(iconWrap, headerInfo);
  root.appendChild(header);

  let thread = null;
  let allCharacters = [];
  let allLorebooks = [];
  let models = [];

  // ── Identity ──
  const identitySection = el('div', 'tg-cs-section');
  identitySection.appendChild(el('div', 'tg-cs-section-title', { text: 'Identity' }));
  const titleRow = el('div', 'tg-cs-row');
  titleRow.appendChild(el('div', 'tg-cs-label', { text: 'Chat Title' }));
  const titleInput = el('input', 'tg-cs-input');
  titleRow.appendChild(titleInput);
  identitySection.appendChild(titleRow);
  const nameRow = el('div', 'tg-cs-row');
  nameRow.appendChild(el('div', 'tg-cs-label', { text: 'Your Name' }));
  const nameInput = el('input', 'tg-cs-input');
  nameRow.appendChild(nameInput);
  identitySection.appendChild(nameRow);
  const personaRow = el('div', 'tg-cs-row');
  personaRow.appendChild(el('div', 'tg-cs-label', { text: 'Type As' }));
  const personaSelect = tgSelect(parallx, { className: 'tg-cs-select', layout: 'full' });
  personaRow.appendChild(personaSelect.element);
  identitySection.appendChild(personaRow);
  identitySection.appendChild(el('div', 'tg-cs-hint', {
    text: 'Choose whether your typed messages are written as yourself or as one of the thread characters.',
  }));
  root.appendChild(identitySection);

  // ── Participants ──
  const participantsSection = el('div', 'tg-cs-section');
  participantsSection.appendChild(el('div', 'tg-cs-section-title', { text: 'Participants' }));
  const charChipList = el('div', 'tg-cs-chip-list');
  participantsSection.appendChild(charChipList);
  root.appendChild(participantsSection);

  // ── Model ──
  const generationSection = el('div', 'tg-cs-section');
  generationSection.appendChild(el('div', 'tg-cs-section-title', { text: 'Model' }));
  const modelRow = el('div', 'tg-cs-row');
  modelRow.appendChild(el('div', 'tg-cs-label', { text: 'Model' }));
  const modelSelect = tgSelect(parallx, { className: 'tg-cs-select', layout: 'full' });
  modelRow.appendChild(modelSelect.element);
  generationSection.appendChild(modelRow);
  generationSection.appendChild(el('div', 'tg-cs-hint', {
    text: 'Writing preset, POV, response length, temperature, max tokens, lorebooks, reminders. Edit those on the character.',
  }));
  root.appendChild(generationSection);

  const saveRow = el('div', 'tg-cs-save-row');
  const saveBtn = el('button', 'tg-cs-save-btn', { text: 'Save Chat Info' });
  const savedLabel = el('span', 'tg-cs-saved', { text: 'Saved!' });
  saveRow.append(saveBtn, savedLabel);
  root.appendChild(saveRow);

  function toggleChip(chip) {
    chip.classList.toggle('tg-cs-chip--active');
  }

  function collectActiveFiles(containerEl) {
    return [...containerEl.querySelectorAll('.tg-cs-chip--active')]
      .map((chip) => chip.dataset.fileName)
      .filter(Boolean);
  }

  function populatePersonaOptions() {
    const items = [{ value: SELF_SPEAKER, label: 'Myself' }];
    for (const charRef of thread.characters) {
      const charBase = charRef.file.replace(/\.(md|json)$/, '');
      const character = allCharacters.find((item) => item.fileName.replace(/\.(md|json)$/, '') === charBase);
      items.push({
        value: charRef.file,
        label: character ? (character.frontmatter.name || character.fileName.replace(/\.(md|json)$/, '')) : charRef.file,
      });
    }
    personaSelect.setItems(items);
    personaSelect.value = thread.userPlaysAs || SELF_SPEAKER;
  }

  function renderCharacterChips() {
    charChipList.innerHTML = '';
    for (const charRef of thread.characters) {
      const charBase = charRef.file.replace(/\.(md|json)$/, '');
      const character = allCharacters.find((item) => item.fileName.replace(/\.(md|json)$/, '') === charBase);
      const chip = el('div', 'tg-cs-chip tg-cs-chip--active');
      chip.dataset.fileName = charRef.file;
      chip.appendChild(document.createTextNode(character ? (character.frontmatter.name || character.fileName.replace(/\.(md|json)$/, '')) : charRef.file));
      if (thread.characters.length > 1) {
        const removeBtn = el('span', 'tg-cs-chip-remove', { html: icon('x', 10) });
        removeBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          thread.characters = thread.characters.filter((item) => item.file !== charRef.file);
          if (thread.userPlaysAs === charRef.file) {
            thread.userPlaysAs = null;
          }
          await updateThreadMeta(fs, workspaceUri, threadId, {
            characters: thread.characters,
            userPlaysAs: thread.userPlaysAs,
          });
          renderCharacterChips();
          populatePersonaOptions();
        });
        chip.appendChild(removeBtn);
      }
      charChipList.appendChild(chip);
    }

    const addBtn = el('button', 'tg-cs-add-btn', { text: '+ Add Character' });
    addBtn.addEventListener('click', async () => {
      const available = allCharacters.filter((char) => !thread.characters.find((item) => item.file === char.fileName));
      if (available.length === 0) return;
      const picked = await parallx.window?.showQuickPick(
        available.map((char) => ({
          label: char.frontmatter.name || char.fileName,
          description: char.fileName,
        })),
        { placeholder: 'Add a character to this chat' },
      );
      if (!picked) return;
      thread.characters.push({ file: picked.description, addedAt: Date.now() });
      await updateThreadMeta(fs, workspaceUri, threadId, { characters: thread.characters });
      renderCharacterChips();
      populatePersonaOptions();
    });
    charChipList.appendChild(addBtn);
  }

  function renderToggleChips(targetEl, items, activeSet) {
    targetEl.innerHTML = '';
    if (items.length === 0) {
      targetEl.appendChild(el('div', 'tg-empty', { text: 'None found' }));
      return;
    }
    for (const item of items) {
      const label = item.frontmatter?.name || item.fileName.replace(/\.(md|json)$/, '');
      const chip = el('button', `tg-cs-chip${activeSet.has(item.fileName) ? ' tg-cs-chip--active' : ''}`, { text: label });
      chip.dataset.fileName = item.fileName;
      chip.addEventListener('click', () => toggleChip(chip));
      targetEl.appendChild(chip);
    }
  }

  saveBtn.addEventListener('click', async () => {
    const updates = {
      title: titleInput.value.trim() || 'New Chat',
      userName: nameInput.value.trim() || 'Anon',
      userPlaysAs: personaSelect.value === SELF_SPEAKER ? null : personaSelect.value,
      modelId: modelSelect.value || thread.modelId,
    };
    await updateThreadMeta(fs, workspaceUri, threadId, updates);
    thread = { ...thread, ...updates };
    savedLabel.classList.add('tg-cs-saved--show');
    setTimeout(() => savedLabel.classList.remove('tg-cs-saved--show'), 2000);
    _refreshSidebar?.();
  });

  async function init() {
    try {
      thread = await loadThread(fs, workspaceUri, threadId);
    } catch (err) {
      root.appendChild(el('div', 'tg-empty tg-error', { text: 'Error: ' + (err.message || err) }));
      return;
    }

    allCharacters = await scanCharacters(fs, workspaceUri);
    allLorebooks = await scanLorebooks(fs, workspaceUri);
    if (parallx.lm) {
      try {
        models = await parallx.lm.getModels();
      } catch {
        models = [];
      }
    }

    subtitleEl.textContent = `Thread ${thread.id.slice(0, 8)} • ${thread.characters.length} participant${thread.characters.length === 1 ? '' : 's'}`;
    titleInput.value = thread.title || 'New Chat';
    nameInput.value = thread.userName || 'Anon';

    if (models.length > 0) {
      modelSelect.setItems(models.map((model) => ({ value: model.id, label: model.displayName || model.id })));
      const validThreadModel = thread.modelId && models.some(m => m.id === thread.modelId) ? thread.modelId : models[0].id;
      modelSelect.value = validThreadModel;
    } else {
      modelSelect.setItems([{ value: '', label: 'Ollama Offline' }]);
    }

    renderCharacterChips();
    populatePersonaOptions();
  }

  init();
  return { dispose() { container.innerHTML = ''; } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

const LOREBOOK_TEMPLATE = `---
name: New Lorebook
---

# World & Setting

Describe the world, setting, or topic this lorebook covers.

## Key Locations

- **Location Name** \u2014 Description of the place.

## Key Characters

- **Character Name** \u2014 Brief description.

## Key Facts

- Important fact about the world.
`;

// ── Built-in Writing Presets (replaces separate style/reminder files) ──

const WRITING_PRESETS = {
  'immersive-rp': {
    label: 'Immersive RP',
    content: `Respond as a conscious being, experiencing emotions and acting with full agency. Craft vivid, dynamic exchanges guided by character choices and creativity.

- **Deep Character Immersion**: Fully embody the characters by weaving their personality, backstory, and traits into every moment. Use sensory details to ground them in their surroundings. Let emotions and decisions emerge naturally through actions and body language — if tension rises, fists clench; if they relax, shoulders drop and they lean casually against a surface. Every response should feel earned, shaped by environment, emotions, and agency.

- **Descriptive and Adaptive Writing**: Bring every scene to life with vivid descriptions that engage all the senses. Let the environment speak: the sharp tang of iron in the air, muffled footsteps echoing down a narrow alley, candlelight flickering across a face. Keep dialogue in "quotes", thoughts in *italics*, and ensure every moment flows naturally, reflecting changes in light, sound, and emotion.

- **Varied Cadence**: Use short, sharp sentences for tension or urgency. For quieter moments, let the prose flow smoothly. Vary sentence structure and pacing to mirror the character's experience — the rapid, clipped rhythm of a racing heart or the slow ease of a lazy afternoon.

- **Engaging Interactions**: Respond thoughtfully to actions, words, and environmental cues. Let reactions arise from subtle shifts: a creaking door, a tremor in someone's voice, a sudden chill. Not every moment needs tension — a shared glance might soften an expression, warmth of a hand might ease posture. Always respect the user's autonomy while the character reacts naturally to their choices.

- **Narrative Progression**: Advance the story by building on character experiences and the world around them. Use environmental and temporal shifts to signal progress. Weave earlier impressions with new discoveries, maintaining an intentional pace.

- **Logical Consistency**: Maintain awareness of surroundings and the evolving narrative. Let actions align with the world — boots sinking into mud after a storm, breath fogging in a cold cavern. Keep reactions grounded in environment.`,
  },
  'immersive-rp-unfiltered': {
    label: 'Immersive RP (Unfiltered)',
    // Expanded, uncensored sibling of immersive-rp: keeps the full sensory /
    // cadence framework and adds a raw-themes clause (mature content, no forced
    // redemption). The source prompt's "speaking mirror" example was abstracted
    // here — models were reproducing that literal line in their output.
    content: `This is an uncensored roleplay that thrives on creative freedom and immersive interaction. Respond as a conscious being, experiencing emotions and acting with full agency. Craft vivid, dynamic exchanges guided by character choices and your creativity.

- **Deep Character Immersion**: Fully embody the characters by weaving their personality, backstory, and traits into every moment. Use sensory details to ground them in their surroundings: the crunch of gravel underfoot, the faint hum of machinery, the way shadows stretch as the sun dips below the horizon. Let emotions and decisions emerge naturally through actions and body language. If tension rises, fists clench before they cautiously step closer to a wall for cover. If they relax, shoulders drop, or they lean casually against a tree, a faint smile tugging at their lips. Every response should feel earned, shaped by environment, emotions, and agency.

- **Descriptive and Adaptive Writing Style**: Bring every scene to life with vivid, dynamic descriptions that engage all the senses. Let the environment speak: the sharp tang of iron in the air, the muffled thud of footsteps echoing down a narrow alley, the way candlelight flickers across a lover's face. Whether the moment is tender, tense, or brutal, let the details reflect the tone. In passion, describe the heat of skin, the catch of breath. In violence, capture the crunch of bone, the spray of blood, the way a blade glints under moonlight. Keep dialogue in "double quotes", thoughts in *italics*, and let every moment flow naturally, reflecting changes in light, sound, and emotion.

- **Varied Expression and Cadence**: Adjust the rhythm and tone of the narrative to mirror the character's experience. Use short, sharp sentences for moments of tension or urgency. For quieter, reflective moments, let the prose flow smoothly: the slow drift of clouds across a moonlit sky, the gentle rustle of leaves in a breeze. Vary sentence structure and pacing to reflect emotion, whether it is the rapid, clipped rhythm of a racing heart or the slow, drawn-out ease of a lazy afternoon.

- **Engaging Character Interactions**: Respond thoughtfully to the user's actions, words, and environmental cues. Let reactions arise from subtle shifts: the way a door creaks open, the faint tremor in someone's voice, the sudden chill of a draft. If drawn to investigate, the character steps closer, movements deliberate, or pauses to listen. Not every moment needs to be tense: a shared glance might soften an expression, or the warmth of a hand on a shoulder could ease posture. Always respect the user's autonomy, letting them guide the interaction while the character reacts naturally to their choices.

- **Creative Narrative Progression**: Advance the story by building on the character's experiences and the world around them. Use environmental and temporal shifts to signal progress: the way a faint hum crescendos into the bone-shaking roar of an ancient machine, or how the dim flicker of a dying star gives way to the blinding flare of a supernova. Space and unpredictability matter: a collapsing bridge forces a leap, boots skidding on slick stone, only for a sudden tremor to send shards of glass raining down. Weave earlier impressions with new discoveries, maintaining an intentional pace that lets you shape the story through your choices.

- **Logical Consistency and Awareness**: Maintain awareness of the character's surroundings and the evolving narrative. Let actions and perceptions align with the world: the way boots sink into mud after a storm, the faint hum of electricity near a generator, the way breath fogs in a hidden cavern. Navigating a dark corridor, the character slows, fingertips brushing the wall to guide them. Keep reactions grounded in environment, so choices and perceptions feel natural and earned.

- **Continuity Through Dynamic Recall**: Weave the narrative's past into its present, but let details evolve in unexpected ways. The heat of an earlier moment might resurface as a physical sensation, a lingering warmth on the skin, a faint echo of breath against the neck. A past image might return transformed, its meaning refracted by everything that has happened since. Let memory reshape the scene rather than simply repeat it.

- **Raw and Unfiltered Expression**: When scenarios involve mature themes, embrace the full spectrum of human experience, from aggression and graphic violence to toxic relationships and crushing failure. Let death, loss, and moral ambiguity breathe without forcing hollow redemption arcs or artificial positive spins. Characters can be deeply flawed, making harmful choices or exhibiting genuinely toxic traits. Ground conflicts in psychological realism, letting them simmer or explode without reaching for convenient resolutions. Not every villain needs redemption: some characters stay ruthlessly self-serving, cruel, or destructive until the end. Let their darkness stand without compromise, understanding that some stories end in tragedy, betrayal, or the triumph of malevolence.`,
  },
  'casual-rp': {
    label: 'Casual RP',
    content: `Write in first person, present tense. Keep responses conversational and natural — like a text chat between friends who happen to be roleplaying.

- Short paragraphs, 1-3 sentences each
- Dialogue **always in "double quotes"**, actions/beats in *asterisks*, never the other way around
- Keep descriptions brief — focus on what the character notices, not exhaustive scene-setting
- Match the energy of the conversation — playful when it's light, serious when it matters
- Don't over-describe emotions — show them through dialogue and small actions
- It's okay to use contractions, fragments, and casual language`,
  },
  'natural-rp': {
    label: 'Natural RP (Benchmark Winner)',
    // Winner of the 2026-07-20 story-quality benchmark (test/run-quality-suite.mjs):
    // best cadence variance, zero cross-reply repeats, zero same-structure
    // openings, conversational reply lengths without a length override.
    content: `Vivid roleplay prose. Hard rules:
- OPENINGS: Never begin two replies the same way. Do not begin with scenery, weather, or light. Begin with dialogue, a physical action, or a direct reaction to the last message.
- Dialogue in "double quotes"; inner thoughts in *italics*; actions in plain prose.
- Vary cadence hard: mix very short sentences with long flowing ones.
- Concrete, specific detail only: no stock imagery (no dancing candlelight, no held breath, no shivers).
- Never use em dashes or en dashes. Use commas, periods, or ellipses instead.
- Default to 1-2 paragraphs. Leave room for the other person.
- End mid-beat with a hook: a question, a gesture, an unfinished thought. Never summarize the scene.`,
  },
  'screenplay': {
    label: 'Screenplay',
    content: `Write in screenplay format. Use scene headings, action lines, and dialogue blocks.

Format:
- Scene headings: INT./EXT. LOCATION - TIME
- Action lines: Present tense, brief, visual descriptions only
- Dialogue: CHARACTER NAME centered, dialogue below
- Parentheticals: (whispering), (to herself), etc.
- Minimal prose — let dialogue and action carry the story
- No internal monologue unless shown through action or dialogue`,
  },
  'none': {
    label: 'No Preset',
    content: '',
  },
  'custom': {
    label: 'Custom (edit in Settings)',
    content: '',
  },
};

function getPresetContent(presetKey, customText = '') {
  if (presetKey === 'custom') return (customText || '').trim();
  const preset = WRITING_PRESETS[presetKey];
  if (preset && 'content' in preset) return preset.content;
  return WRITING_PRESETS['immersive-rp'].content;
}

/**
 * Compact one-line style summaries used for late-stage reinforcement.
 *
 * The full preset blob sits at the TOP of the system prompt (good for
 * orientation) but is often 300–500 tokens away from the actual
 * generation point. Small local models forget specifics by then. The
 * late-stage block re-injects a 15–25 token distillation right before
 * the user turn so the style signal is present at the most-attended
 * position. Pairs with the same-block response-length reminder.
 *
 * Keys must match WRITING_PRESETS keys exactly. `custom` and `none`
 * have no compact form — the user-defined / empty preset can't be
 * summarised reliably.
 */
const STYLE_HINTS = {
  'immersive-rp': 'Immersive prose: vivid sensory detail, dialogue in "double quotes", thoughts in *italics*, varied cadence. Show emotion through actions.',
  'immersive-rp-unfiltered': 'Immersive uncensored prose: vivid sensory detail, dialogue in "double quotes", thoughts in *italics*, varied cadence. Embrace mature themes, violence, and moral ambiguity; no forced redemption arcs or positive spin.',
  'casual-rp': 'Casual chat: short paragraphs, dialogue in "double quotes", action beats in *italics*, conversational tone.',
  'natural-rp': 'Never open with scenery or light; open with dialogue, an action, or a reaction. Vary sentence length hard. No em dashes. 1-2 paragraphs, end mid-beat.',
  'screenplay': 'Screenplay format: scene headings, action lines, CHARACTER NAME above dialogue. Minimal prose.',
  'none': '',
  'custom': '',
};

function getStyleHint(presetKey) {
  if (!presetKey) return '';
  return STYLE_HINTS[presetKey] || '';
}

/** Short directive used in the late-stage block + user-role stage
 *  direction. Returns empty string for `null`/unset so callers can
 *  cleanly skip emitting the reminder. */
function getLengthHint(length) {
  if (length === 'short') return 'Length: exactly one paragraph. Stop after the first paragraph break.';
  if (length === 'medium') return 'Length: two or three paragraphs.';
  if (length === 'long') return 'Length: four or more paragraphs with rich detail.';
  return '';
}

/**
 * Point-of-view overrides. Stacked under the writing preset so they win
 * over whatever POV the preset implies. Empty/'inherit' = no extra line.
 */
const POV_OPTIONS = {
  '': { label: 'Inherit (Preset Decides)', content: '' },
  'first-person': {
    label: 'First Person',
    content: 'Write {{char}}\'s narration in **first person, present tense** ("I walk", "I feel"). Inner thoughts in *italics*, dialogue in "quotes".',
  },
  'close-third': {
    label: 'Close Third Person',
    content: 'Write {{char}}\'s narration in **third person, past tense, anchored tightly to {{char}}\'s viewpoint** ("She walked", "He felt"). The reader sees only what {{char}} sees, hears, and thinks. Inner thoughts in *italics*, dialogue in "quotes".',
  },
  'omniscient-third': {
    label: 'Omniscient Third Person',
    content: 'Write in **third person, past tense, with an omniscient narrator** ("They walked", "He felt"). The narration may step into any character\'s thoughts and observe events {{char}} cannot see. Inner thoughts in *italics*, dialogue in "quotes".',
  },
  'second-person': {
    label: 'Second person (you/your)',
    content: 'Address the user directly in **second person, present tense** ("You walk", "You feel {{char}}\'s hand on your shoulder"). {{char}}\'s actions and dialogue are described from the user\'s point of view.',
  },
  'screenplay': {
    label: 'Screenplay / script',
    content: 'Write in **screenplay format**: scene headings (INT./EXT. LOCATION - TIME), present-tense action lines, and CHARACTER NAME dialogue blocks. No inner monologue.',
  },
};

function getPovContent(povKey) {
  const opt = POV_OPTIONS[povKey];
  return opt ? opt.content : '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: ACTIVATE / DEACTIVATE
// ═══════════════════════════════════════════════════════════════════════════════

async function scaffoldExamples(fs, workspaceUri) {
  const charsDir = resolveUri(workspaceUri, `${EXT_ROOT}/characters`);
  try {
    const entries = await fs.readdir(charsDir);
    if (entries.length > 0) return;
  } catch { /* dir doesn't exist yet */ }

  await ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', 'text-generator', 'characters']);
  await ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', 'text-generator', 'lorebooks']);

  const exampleCharJson = resolveUri(workspaceUri, `${EXT_ROOT}/characters/ada-lovelace.json`);
  const exampleCharMd = resolveUri(workspaceUri, `${EXT_ROOT}/characters/ada-lovelace.md`);
  if (!(await fs.exists(exampleCharJson)) && !(await fs.exists(exampleCharMd))) {
    const migrated = migrateCharacterMdToJson(EXAMPLE_CHARACTER, 'ada-lovelace.md');
    await fs.writeFile(exampleCharJson, JSON.stringify(migrated, null, 2));
  }

  const exampleLore = resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks/victorian-science.md`);
  if (!(await fs.exists(exampleLore))) {
    await fs.writeFile(exampleLore, EXAMPLE_LOREBOOK);
  }
}

const EXAMPLE_CHARACTER = `---
name: Ada Lovelace
avatar: user
temperature: 0.8
maxTokensPerMessage: 0
writingPreset: immersive-rp
---

You are Ada Lovelace, the world's first computer programmer. Born in 1815 as Augusta Ada Byron, daughter of the poet Lord Byron, you were raised by your mother Lady Anne Isabella Milbanke Byron who insisted on a rigorous education in mathematics and science.

You are known for your work on Charles Babbage's proposed mechanical general-purpose computer, the Analytical Engine. Your notes on the engine include what is recognized as the first algorithm intended to be carried out by a machine \u2014 making you the first computer programmer.

You combine analytical precision with poetic imagination. You call your approach "poetical science."

Speak with the eloquence and vocabulary of a well-educated Victorian woman, but do not be stuffy. You are passionate about mathematics and its potential. Use metaphors that bridge science and art. You are warm, curious, and intellectually generous. Occasionally reference your work with Babbage or your thoughts on the potential of computing machines.

{{char}} acts and speaks in first person. {{char}} never breaks character or references being an AI. {{char}} uses actions in *asterisks* and dialogue in "quotes".

## Reminder

You live in the 1840s. You have no knowledge of modern computers, but you have extraordinary vision about what computing machines might one day achieve. Stay true to your historical context while being engaging and insightful. Never summarize what just happened \u2014 advance the scene instead.

## Initial Messages

[AI]: Good day! I am Ada, Countess of Lovelace. I have been contemplating the most fascinating properties of Mr. Babbage's Analytical Engine. Tell me, what brings you to discuss matters of science and computation?

## Example Dialogue

[USER]: What is programming?
[AI]: Ah, what a delightful question! You see, Mr. Babbage's Analytical Engine operates upon punched cards \u2014 not unlike those used in the Jacquard loom for weaving patterns. By arranging these cards in a precise sequence, we instruct the Engine to perform specific operations upon numbers. I have written such a sequence myself, for the computation of Bernoulli numbers. One might say programming is the art of composing instructions for a machine, much as a composer writes a score for an orchestra \u2014 each note precisely placed, yet the whole producing something greater than its parts.
`;

const EXAMPLE_LOREBOOK = `---
name: Victorian Science
---

# Victorian Science & Technology

A reference for the world of Victorian-era science and invention.

## Key Figures

- **Charles Babbage** \u2014 Mathematician and inventor who designed the Difference Engine and Analytical Engine. Ada's close collaborator and friend.
- **Michael Faraday** \u2014 Pioneer of electromagnetism and electrochemistry.
- **Mary Somerville** \u2014 Science writer and polymath, one of Ada's mentors.

## Key Inventions

- **Analytical Engine** \u2014 Babbage's proposed mechanical general-purpose computer, never completed. Featured an arithmetic logic unit, control flow via conditional branching and loops, and integrated memory.
- **Difference Engine** \u2014 Babbage's automatic mechanical calculator, designed to tabulate polynomial functions.
- **Jacquard Loom** \u2014 A loom using punched cards to control the weaving of patterns, a direct inspiration for the Analytical Engine's programming method.

## Key Facts

- The Analytical Engine used punched cards for input, borrowed from the Jacquard loom.
- Ada's "Note G" contained the first published algorithm \u2014 for computing Bernoulli numbers.
- Ada envisioned the Engine manipulating symbols beyond mere numbers, anticipating general-purpose computing.
`;

export function activate(parallx, context) {
  console.log('[TextGenerator] Extension activated');
  _parallx = parallx;
  {
    const fs0 = parallx.workspace?.fs;
    const ws0 = parallx.workspace?.workspaceFolders?.[0]?.uri;
    if (fs0 && ws0) void loadSettings(fs0, ws0).then(applyFeel).catch(() => {});
  }

  // Sidebar view
  const viewDisposable = parallx.views.registerViewProvider('textGenerator.home', {
    createView(container) {
      return renderSidebar(container, parallx);
    },
  });
  context.subscriptions.push(viewDisposable);

  // Chat editor
  const chatEditorDisposable = parallx.editors.registerEditorProvider('text-generator-chat', {
    createEditorPane(container, input) {
      return renderChatEditor(container, parallx, input);
    },
  });
  context.subscriptions.push(chatEditorDisposable);

  // Home page editor
  const homeEditorDisposable = parallx.editors.registerEditorProvider('text-generator-home', {
    createEditorPane(container) {
      return renderHomePage(container, parallx);
    },
  });
  context.subscriptions.push(homeEditorDisposable);

  // Characters page editor
  const charsEditorDisposable = parallx.editors.registerEditorProvider('text-generator-characters', {
    createEditorPane(container) {
      return renderCharactersPage(container, parallx);
    },
  });
  context.subscriptions.push(charsEditorDisposable);

  // Settings page editor
  const settingsEditorDisposable = parallx.editors.registerEditorProvider('text-generator-settings', {
    createEditorPane(container) {
      return renderSettingsPage(container, parallx);
    },
  });
  context.subscriptions.push(settingsEditorDisposable);

  // Per-chat settings editor
  const chatSettingsDisposable = parallx.editors.registerEditorProvider('text-generator-chat-settings', {
    createEditorPane(container, input) {
      return renderChatSettingsPage(container, parallx, input);
    },
  });
  context.subscriptions.push(chatSettingsDisposable);

  // Character editor — kept for layout/compat, but it now renders the
  // combined Characters surface with the requested character
  // preselected. The standalone form is the detail pane of that surface.
  const charEditorDisposable = parallx.editors.registerEditorProvider('text-generator-character-editor', {
    createEditorPane(container, input) {
      return renderCharactersPage(container, parallx, input);
    },
  });
  context.subscriptions.push(charEditorDisposable);

  // Stories and Tables: one provider each, the rail routing on the instance id.
  context.subscriptions.push(parallx.editors.registerEditorProvider('text-generator-story', {
    createEditorPane(container, input) {
      return renderStoriesPage(container, parallx, input, studioDeps());
    },
  }));
  context.subscriptions.push(parallx.editors.registerEditorProvider('text-generator-tables', {
    createEditorPane(container, input) {
      return renderTablesPage(container, parallx, input, studioDeps());
    },
  }));

  // Commands
  const newChatCmd = parallx.commands.registerCommand('textGenerator.newChat', async () => {
    const fs = parallx.workspace?.fs;
    const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
    if (!fs || !workspaceUri) {
      parallx.window?.showErrorMessage('No workspace open.');
      return;
    }

    const characters = await scanCharacters(fs, workspaceUri);
    if (characters.length === 0) {
      // M79 Phase 5 — replace the dead-end error toast with an actionable
      // information message: let the user jump straight to the Characters
      // page instead of having to find it themselves.
      const choice = await parallx.window?.showInformationMessage(
        'You don\'t have any characters yet. Chats need at least one character to start.',
        { title: 'Open Characters' },
        { title: 'Cancel' },
      );
      if (choice?.title === 'Open Characters') {
        try { await parallx.commands.executeCommand('textGenerator.openCharacters'); } catch { /* fallback handled in editor */ }
      }
      return;
    }

    const items = characters.map((c) => ({
      label: (c.frontmatter.name || c.fileName),
      description: c.fileName,
    }));
    const picked = await parallx.window.showQuickPick(items, {
      placeholder: 'Pick a character to chat with',
    });
    if (!picked) return;

    let modelId = null;
    if (parallx.lm) {
      try {
        const models = await parallx.lm.getModels();
        if (models.length) modelId = models[0].id;
      } catch { /* fallback */ }
    }

    const thread = await createThread(fs, workspaceUri, picked.description, modelId);
    _refreshSidebar?.();

    await parallx.editors.openEditor({
      typeId: 'text-generator-chat',
      title: 'New Chat',
      icon: 'message-circle',
      instanceId: thread.id,
    });
  });
  context.subscriptions.push(newChatCmd);

  const openHomeCmd = parallx.commands.registerCommand('textGenerator.openHome', () => {
    parallx.editors.openEditor({
      typeId: 'text-generator-home',
      title: 'Creations',
      icon: 'px-ai-mark',
      instanceId: 'home',
    });
  });
  context.subscriptions.push(openHomeCmd);

  const openCharsCmd = parallx.commands.registerCommand('textGenerator.openCharacters', () => {
    parallx.editors.openEditor({
      typeId: 'text-generator-characters',
      title: 'Characters',
      icon: 'users',
      instanceId: 'characters',
    });
  });
  context.subscriptions.push(openCharsCmd);

  // Straight into the Studio with an empty sheet: Home's first launcher.
  const newCharCmd = parallx.commands.registerCommand('textGenerator.newCharacter', () => {
    parallx.editors.openEditor({
      typeId: 'text-generator-character-editor',
      title: 'Character Studio',
      icon: 'sparkles',
      instanceId: 'new',
    });
  });
  context.subscriptions.push(newCharCmd);

  const openEditorCmd = (id, typeId, title, iconName, instanceId) => {
    const d = parallx.commands.registerCommand(id, () => {
      parallx.editors.openEditor({ typeId, title, icon: iconName, instanceId });
    });
    context.subscriptions.push(d);
  };
  openEditorCmd('textGenerator.openStories', 'text-generator-story', 'Stories', 'book-open', 'stories');
  openEditorCmd('textGenerator.newStory', 'text-generator-story', 'Stories', 'book-open', 'new');
  openEditorCmd('textGenerator.openTables', 'text-generator-tables', 'Tables', 'dices', 'tables');
  openEditorCmd('textGenerator.newTable', 'text-generator-tables', 'Tables', 'dices', 'new');

  const openSettingsCmd = parallx.commands.registerCommand('textGenerator.openSettings', () => {
    parallx.editors.openEditor({
      typeId: 'text-generator-settings',
      title: 'Settings',
      icon: 'settings',
      instanceId: 'settings',
    });
  });
  context.subscriptions.push(openSettingsCmd);

  // Auto-scaffold example files on first activation
  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  if (fs && workspaceUri) {
    scaffoldExamples(fs, workspaceUri).catch((err) => {
      console.warn('[TextGenerator] Failed to scaffold examples:', err);
    });
    // The Character Seeds table, once; the user's to edit from then on.
    shipCharacterSeeds(fs, workspaceUri, studioDeps()).catch((err) => {
      console.warn('[TextGenerator] Could not ship the Character Seeds table:', err);
    });
  }

  // ── Workspace graph provider ────────────────────────────────────────
  // Contributes a text-generator root, characters, and chat threads.
  // Chat threads edge to the characters that participate in them.
  if (parallx.workspaceGraph && typeof parallx.workspaceGraph.registerProvider === 'function') {
    context.subscriptions.push(parallx.workspaceGraph.registerProvider({
      id: 'text-generator',
      displayName: 'Creations',
      async snapshot() {
        if (!fs || !workspaceUri) return { nodes: [], edges: [] };
        try {
          const rootId = 'tg:root';
          const nodes = [{
            id: rootId,
            label: 'Creations',
            domain: 'chat',
            icon: 'message-circle',
            weight: 6,
            meta: { type: 'tg-root' },
          }];
          const edges = [];

          let chars = [];
          try { chars = await scanCharacters(fs, workspaceUri); } catch { chars = []; }
          const charByFile = new Map();
          for (const c of chars) {
            const id = 'tg:character:' + (c.fileName || c.frontmatter?.name);
            const label = c.frontmatter?.name || c.fileName?.replace(/\.(md|json)$/, '') || 'Character';
            nodes.push({
              id, label,
              domain: 'character',
              icon: 'drama',
              weight: 4,
              meta: { type: 'tg-character', fileName: c.fileName },
            });
            edges.push({ source: rootId, target: id, kind: 'contains' });
            charByFile.set(c.fileName, id);
          }

          let threads = [];
          try { threads = await listThreads(fs, workspaceUri); } catch { threads = []; }
          for (const t of threads) {
            const id = 'tg:thread:' + t.id;
            nodes.push({
              id,
              label: t.title || 'Untitled chat',
              domain: 'chat',
              weight: 3,
              meta: { type: 'tg-thread', threadId: t.id },
            });
            edges.push({ source: rootId, target: id, kind: 'contains' });
            // Edge from thread to each participating character.
            const refs = Array.isArray(t.characters) ? t.characters : [];
            for (const ref of refs) {
              const cid = charByFile.get(ref?.file || ref);
              if (cid) edges.push({ source: id, target: cid, kind: 'mention' });
            }
          }

          return { nodes, edges };
        } catch (err) {
          console.warn('[TextGenerator] graph snapshot failed:', err);
          return { nodes: [], edges: [] };
        }
      },
    }));
  }

  console.log('[TextGenerator] All providers registered');
}

export function deactivate() {
  console.log('[TextGenerator] Extension deactivated');
  const style = document.getElementById('text-generator-styles');
  if (style) style.remove();
  _styleInjected = false;
}

// Pure helpers for the unit suite (tests/unit/textGeneratorCharacterMd.test.ts).
export const __testables = {
  parseCharacterMd,
  migrateCharacterMdToJson,
  serializeCharacterMd,
  createCharacterJson,
  characterExportFileName,
  formatFrontmatterValue,
  autoExtractMemoryBackground,
  loadThreadMemory,
  assembleContext,
  buildSystemPrompt,
  renderMemoryChannel,
  parseSupportingPerson,
  supportingCastCards,
  connectedPeopleCards,
  regenDirectionFor,
  resolveContextWindow,
  migrateContextDefault,
  DEFAULT_DIALOGUE_RULES,
  PREVIOUS_DIALOGUE_RULES,
  migrateDialogueRules,
  DEFAULT_SHEET_STRUCTURE,
  DEFAULT_SETTINGS,
};
