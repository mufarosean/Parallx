// Text Generator — Parallx Extension
// Character chat using local Ollama models.
// All data lives under .parallx/extensions/text-generator/.
//
// Architecture cloned from src/openclaw/ (study and clone, never join):
//   - System prompt builder  ← openclawSystemPrompt.ts
//   - Token budget           ← openclawTokenBudget.ts
//   - Context assembly       ← openclawContextEngine.ts
//   - History trimming       ← openclawContextEngine.ts

const EXT_ROOT = '.parallx/extensions/text-generator';
const SELF_SPEAKER = '__self__';
const NARRATOR_SPEAKER = '__narrator__';

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
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
}
.tg-search-wrap .tg-icon { color: var(--vscode-descriptionForeground); }
.tg-search {
  flex: 1;
  background: var(--vscode-input-background, #3c3c3c);
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

/* Nav links */
.tg-nav {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  min-height: 32px;
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
  padding: 8px 12px;
  margin: 6px 10px 10px;
  cursor: pointer;
  font-size: var(--parallx-fontSize-md, 13px);
  font-family: var(--parallx-fontFamily-ui);
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-button-background, #0e639c);
  border: none;
  border-radius: var(--parallx-radius-md, 6px);
  transition: opacity 80ms ease;
}
.tg-new-chat-btn:hover { opacity: 0.85; }
.tg-new-chat-btn .tg-icon { color: inherit; }

/* Empty state */
.tg-empty {
  padding: 12px 16px;
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-descriptionForeground);
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
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
  flex-shrink: 0;
}
.tg-page-header .tg-icon { color: var(--vscode-descriptionForeground); }
.tg-page-header-info { flex: 1; }
.tg-page-header-title {
  font-size: 22px;
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
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  font-size: var(--parallx-fontSize-base, 12px);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
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
  padding: 8px 14px;
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: var(--parallx-radius-md, 6px);
  background: var(--vscode-editorWidget-background, #252526);
  cursor: pointer;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-foreground);
  transition: border-color 80ms ease, background 80ms ease;
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
  background: var(--vscode-input-background, #3c3c3c);
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
  background: var(--vscode-input-background, #3c3c3c);
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
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
  flex-shrink: 0;
  background: var(--vscode-editorWidget-background, #252526);
}
.tg-chat-toolbar-label {
  font-size: var(--parallx-fontSize-base, 12px);
  color: var(--vscode-descriptionForeground);
}
.tg-chat-toolbar-select {
  background: var(--vscode-input-background, #3c3c3c);
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
  text-transform: uppercase;
  letter-spacing: 0.3px;
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
  background: var(--vscode-input-background, #3c3c3c);
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
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
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
.tg-msg-body em { font-style: italic; }
.tg-msg-body strong { font-weight: 700; }

/* ═══ Options Menu ═══ */
.tg-options-menu {
  position: absolute;
  bottom: 60px;
  right: 16px;
  min-width: 200px;
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: var(--parallx-radius-md, 6px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  z-index: 50;
  padding: 4px 0;
}
.tg-options-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  cursor: pointer;
  text-align: left;
  transition: background 80ms ease;
}
.tg-options-item:hover { background: var(--vscode-list-hoverBackground); }

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
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
  background: var(--vscode-editor-background);
}
.tg-input-card {
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--vscode-input-border, #3c3c3c) 70%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--vscode-input-background, #3c3c3c) 92%, var(--vscode-editorWidget-background, #252526) 8%);
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
  border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border, #2a2a2a) 60%, transparent);
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
  background: var(--vscode-input-background, #3c3c3c);
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
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
}

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
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: var(--parallx-radius-lg, 8px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.tg-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;
  margin-top: 16px;
}
.tg-modal-body .tg-prompt-role:first-child { margin-top: 0; }
.tg-modal-body .tg-prompt-content {
  padding: 8px 12px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--vscode-input-background, #3c3c3c) 50%, transparent);
  border-radius: var(--parallx-radius-sm, 3px);
  border-left: 3px solid var(--vscode-focusBorder, #007fd4);
}
.tg-modal-body .tg-prompt-diag {
  padding: 8px 12px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--vscode-editorWidget-background, #252526) 80%, transparent);
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
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  text-transform: uppercase;
  letter-spacing: 0.5px;
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
  border: 1px solid var(--vscode-input-border, #3c3c3c);
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
}
.tg-cs-select {
  flex: 1;
  max-width: 280px;
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border, #3c3c3c);
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, #3c3c3c);
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
  background: var(--vscode-input-background, #3c3c3c);
  border: 1px solid var(--vscode-input-border, #3c3c3c);
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
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: 12px;
  background: var(--vscode-editorWidget-background, #252526);
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
  border: 1px dashed var(--vscode-panel-border, #2a2a2a);
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
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  border: 1px solid var(--vscode-input-border, #3c3c3c);
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, #1e1e1e);
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
  border: 1px solid var(--vscode-input-border, #3c3c3c);
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, #1e1e1e);
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
  border: 1px solid var(--vscode-input-border, #3c3c3c);
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-input-background, #1e1e1e);
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
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
  margin: 20px 0;
}
.tg-ce-more-btn {
  display: block;
  margin: 12px auto;
  padding: 6px 20px;
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: 14px;
  background: var(--vscode-editorWidget-background, #252526);
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
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
}
.tg-ce-cancel-btn {
  padding: 6px 16px;
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
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
  border: 1px solid #388a34;
  border-radius: var(--parallx-radius-sm, 3px);
  background: #388a34;
  color: #fff;
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-base, 12px);
  font-weight: 600;
  cursor: pointer;
  transition: background 80ms ease;
}
.tg-ce-save-btn:hover { background: #45a040; }
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
  `;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

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

function parseCharacterMd(content, fileName) {
  const { frontmatter, body } = parseFrontmatter(content);
  const sections = {};
  let currentSection = 'roleInstruction';
  let currentContent = [];

  // Only 3 special sections are recognised; everything else is roleInstruction.
  const SPECIAL = { reminder: 'reminder', initial: 'initialMessages', example: 'exampleDialogue' };

  for (const line of body.split('\n')) {
    if (line.startsWith('## ')) {
      if (currentContent.length) {
        sections[currentSection] = (sections[currentSection] ? sections[currentSection] + '\n\n' : '') + currentContent.join('\n').trim();
      }
      const heading = line.slice(3).trim().toLowerCase();
      const matched = Object.keys(SPECIAL).find((k) => heading.includes(k));
      currentSection = matched ? SPECIAL[matched] : 'roleInstruction';
      currentContent = [];
    } else if (line.startsWith('# ') && !line.startsWith('## ')) {
      // Top-level heading — keep in roleInstruction body
      currentContent.push(line);
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length) {
    sections[currentSection] = (sections[currentSection] ? sections[currentSection] + '\n\n' : '') + currentContent.join('\n').trim();
  }

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
  return createCharacterJson({
    name: parsed.frontmatter.name || fileName.replace(/\.(md|json)$/, ''),
    roleInstruction: parsed.sections.roleInstruction || '',
    exampleDialogue: parsed.sections.exampleDialogue || '',
    reminder: parsed.sections.reminder || '',
    initialMessages: parsed.sections.initialMessages || '',
    temperature: parsed.frontmatter.temperature ?? 0.8,
    maxTokensPerMessage: parsed.frontmatter.maxTokensPerMessage ?? 0,
    writingPreset: parsed.frontmatter.writingPreset || 'immersive-rp',
  });
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
    let bodyStart = 1;
    // Check if the first non-empty body line defines triggers
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.toLowerCase().startsWith('triggers:')) {
        triggers = line.slice(9).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        bodyStart = i + 1;
      }
      break;
    }
    const body = lines.slice(bodyStart).join('\n').trim();
    if (body || heading) {
      entries.push({ heading, body: body ? `## ${heading}\n${body}` : `## ${heading}`, triggers });
    }
  }
  return entries;
}

/**
 * Assemble lore content from lorebooks, applying keyword-based activation.
 * Entries with `triggers:` keywords are only included if a keyword matches
 * the recent message context. Entries without triggers are always included.
 */
function assembleLoreContent(lorebooks, budgetTokens, recentContext = '') {
  const contextLower = recentContext.toLowerCase();
  let combined = '';
  let used = 0;
  for (const lb of lorebooks) {
    const entries = parseLoreEntries(lb.content);
    for (const entry of entries) {
      // Skip triggered entries whose keywords don't appear in recent context
      if (entry.triggers && entry.triggers.length > 0) {
        if (!contextLower || !entry.triggers.some(kw => contextLower.includes(kw))) continue;
      }
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
    if (used >= budgetTokens) break;
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
  } = params;

  const parts = [];
  const castEntries = [];
  const characterReminders = [];

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
    ].join('\n'));
  }

  // 1b. User identity — description/role if provided by character config.
  if (userDescription) {
    parts.push(['## User Identity', `The user (${userName}) is described as: ${userDescription}`].join('\n'));
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
    parts.push(['## Cast', ...castEntries].join('\n\n'));
  }

  // 3. Conversation contract.
  parts.push([
    '## Turn Contract',
    '- Speaker labels in history are authoritative.',
    '- Write exactly one new turn.',
    '- Never write the user\'s next turn or any unseen follow-up turns.',
    '- Never prepend a speaker label; the interface already displays it.',
    '- Character-specific instructions override the writing style preset when they conflict.',
  ].join('\n'));

  // 4. Lore — substitute {{char}}/{{user}} template vars.
  if (loreContent) {
    const primaryName = characters[0] ? (characters[0].frontmatter.name || characters[0].fileName.replace(/\.(md|json)$/, '')) : '';
    parts.push('## World & Lore\n' + substituteVars(loreContent, primaryName, userName));
  }

  // 5. Thread memory — substitute {{char}}/{{user}} template vars.
  if (memoryContent) {
    const primaryName = characters[0] ? (characters[0].frontmatter.name || characters[0].fileName.replace(/\.(md|json)$/, '')) : '';
    parts.push('## Conversation Memories\n' + substituteVars(memoryContent, primaryName, userName));
  }

  // 6. Active turn.
  if (respondAs === SELF_SPEAKER) {
    parts.push([
      '## Active Turn',
      'It is the user\'s turn.',
      'Draft only the next user-authored message.',
      'Do not write a second follow-up turn after it.',
    ].join('\n'));
  } else if (respondAs === NARRATOR_SPEAKER) {
    parts.push([
      '## Active Turn',
      'It is the Narrator\'s turn.',
      'Write a third-person narrative continuation that advances the scene.',
      'Use pure prose narration — never prefix lines with character names followed by colons.',
      'Weave character actions, speech, and thoughts into natural flowing paragraphs.',
      'Do not write the user\'s next dialogue or make choices on the user\'s behalf.',
    ].join('\n'));
  } else {
    const fallbackChar = characters[0] || null;
    const respondChar = characters.find((c) =>
      c.fileName === respondAs || (c.frontmatter.name || '').toLowerCase() === String(respondAs || '').toLowerCase()
    ) || fallbackChar;
    const respondName = respondChar
      ? (respondChar.frontmatter.name || respondChar.fileName.replace(/\.(md|json)$/, ''))
      : 'the selected character';
    parts.push([
      '## Active Turn',
      `It is ${respondName}'s turn.`,
      `Write only ${respondName}'s next turn.`,
      'Stay grounded in the current scene and react to the latest visible message.',
    ].join('\n'));
  }

  // 7. Response length instruction.
  if (responseLength === 'short') {
    parts.push('## Response Length\nKeep your response to one paragraph.');
  } else if (responseLength === 'medium') {
    parts.push('## Response Length\nKeep your response to two or three paragraphs.');
  } else if (responseLength === 'long') {
    parts.push('## Response Length\nWrite a detailed response of four or more paragraphs.');
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
    const summaryMsg = `[Earlier conversation summary: ${opts.summary}]`;
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
  } = params;

  // Support both old (single character) and new (characters array) signatures
  const chars = characters.length > 0 ? characters : (character ? [character] : []);
  const primaryChar = chars[0] || null;
  const budget = computeTokenBudget(contextWindow, settings);
  const extendedMemoryEnabled = primaryChar?.frontmatter?.extendedMemory === true;

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
  const charMsgLenLimit = primaryChar?.frontmatter?.messageLengthLimit || '';
  // Character messageLengthLimit overrides thread responseLength when set
  const effectiveResponseLength = charMsgLenLimit || responseLength;

  const buildResult = buildSystemPrompt({
    characters: chars,
    writingPreset,
    pov,
    loreContent: loreTrimmed,
    memoryContent: memTrimmed,
    respondAs,
    userName,
    userDescription: charUserDesc,
    responseLength: effectiveResponseLength,
    customStyleContent: settings?.customWritingStyle || '',
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
      `Lore content is ${rawLoreTokens}t but lore lane is ${loreBudget}t — ${rawLoreTokens - loreBudget}t was truncated. ` +
      `Reduce lorebooks or increase Lore %.`,
    );
  }
  if (rawMemTokens > memoryBudget && memoryBudget > 0 && rawMemTokens > 0) {
    warnings.push(
      `Long-term memory is ${rawMemTokens}t but memory share is ${memoryBudget}t — older entries will be cut. ` +
      `Enable Extended Memory or trim /mem.`,
    );
  }

  const messages = [{ role: 'system', content: systemPrompt }];

  // History — filter out hiddenFrom:"ai" messages, map author→role
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
      content: displayName ? `${displayName}: ${m.content}` : m.content,
    };
  });

  const fitMethod = primaryChar?.frontmatter?.fitMessagesInContextMethod
    || settings?.defaultFitMethod
    || 'dropOld';
  messages.push(...trimHistoryToBudget(mappedHistory, historyBudget, fitMethod, { summary: historySummary }));

  // Character reminders — injected right before AI response for maximum recency
  // (matches Perchance behavior: reminder as hidden system msg near end of context)
  // Also inject userReminder (Perchance: separate user-perspective reminder)
  if (charUserReminder) {
    characterReminders.push(`- User reminder: ${charUserReminder}`);
  }
  if (characterReminders.length > 0) {
    messages.push({ role: 'system', content: '[Reminders]\n' + characterReminders.join('\n') });
  }

  // Ephemeral instruction (from slash commands like /ai <instruction>).
  // Deliberately placed AFTER the active-turn cue so it's the LAST system
  // directive before the model writes — closer placement = better adherence.
  // Wording is intentionally forceful; "Turn direction:" alone gets ignored.

  // Build a late-stage "you are X" re-anchor + anti-repetition guard.
  // The character roster lives at position 0 of the system prompt; by the
  // time we're deep into history its influence has decayed and the model
  // drifts (writes for other characters, repeats its own openings).
  // Putting the persona + recent-output reminder right before generation
  // is the cheapest reliable fix.
  let speakerLateAnchor = null;
  let speakerAvoidRepeat = null;
  if (respondAs && respondAs !== SELF_SPEAKER && respondAs !== NARRATOR_SPEAKER) {
    const respondChar = chars.find(c =>
      c.fileName === respondAs || (c.frontmatter.name || '').toLowerCase() === String(respondAs).toLowerCase()
    );
    if (respondChar) {
      const rName = respondChar.frontmatter.name || respondChar.fileName.replace(/\.(md|json)$/, '');
      // One-line persona recap for the late re-anchor. Pull the first non-
      // empty line of the description so we don't bloat the prompt.
      const desc = (respondChar.sections?.description || respondChar.frontmatter?.description || '')
        .split('\n').map(s => s.trim()).find(Boolean) || '';
      const personaLine = desc ? ` Persona recap: ${desc.slice(0, 220)}` : '';
      speakerLateAnchor = `[You are ${rName}. Stay strictly in ${rName}'s voice. Do not write, quote, or describe internal thoughts for any other character. Do not write the user's words or actions.${personaLine}]`;

      // Anti-repetition guard — the model's own last 2 outputs as this speaker.
      const recentSelfOutputs = filteredHistory
        .filter(m => m.author === 'ai' && m.characterFile === respondChar.fileName)
        .slice(-2)
        .map(m => (m.content || '').trim())
        .filter(Boolean);
      if (recentSelfOutputs.length > 0) {
        const openings = recentSelfOutputs.map((text) => {
          // First sentence (up to first . ! ? or 100 chars) for compactness.
          const m = text.match(/^[^.!?\n]{1,100}[.!?]?/);
          const opener = (m ? m[0] : text.slice(0, 100)).trim();
          return `— "${opener}"`;
        }).join('\n');
        speakerAvoidRepeat =
          `[Vary your prose this turn. Do NOT echo the openings, phrasings, sentence shapes, or beats from your recent replies as ${rName}:\n${openings}\nUse fresh openings, different sentence rhythms, and unique imagery.]`;
      }
    }
  }

  // Turn-taking cue — explicit signal right before the user message.
  // Strengthened wording: most failures come from the model speaking for
  // the wrong character or continuing into the user's turn.
  if (respondAs) {
    if (respondAs === SELF_SPEAKER) {
      messages.push({ role: 'system', content: '[Active turn: user. Draft only the next user-authored message with no speaker prefix.]' });
    } else if (respondAs === NARRATOR_SPEAKER) {
      messages.push({ role: 'system', content: '[Active turn: Narrator. Write only the next narrative beat in prose. Do not write any character\'s spoken dialogue. Do not use "CharacterName:" prefixes.]' });
    } else {
      const respondChar = chars.find(c =>
        c.fileName === respondAs || (c.frontmatter.name || '').toLowerCase() === String(respondAs).toLowerCase()
      );
      const rName = respondChar ? (respondChar.frontmatter.name || respondChar.fileName.replace(/\.(md|json)$/, '')) : String(respondAs).replace(/\.(md|json)$/, '');
      messages.push({ role: 'system', content: `[Active turn: ${rName}. Write ONLY ${rName}'s next turn. Do not write for, narrate, or quote any other character. Do not include the "${rName}:" prefix — just the message body.]` });
    }
  }

  // Late-stage re-anchor + anti-repetition (after active-turn cue, just before
  // ephemeral directive and user message). Placement is intentional:
  // anti-repetition lands closer to generation than the active-turn cue.
  if (speakerLateAnchor) {
    messages.push({ role: 'system', content: speakerLateAnchor });
  }
  if (speakerAvoidRepeat) {
    messages.push({ role: 'system', content: speakerAvoidRepeat });
  }

  if (ephemeralInstruction) {
    messages.push({
      role: 'system',
      content: `[IMPORTANT — user-supplied directive for THIS response only. Apply it directly to the next message you write: ${ephemeralInstruction}]`,
    });
  }

  // User message. Falls back to a strong synthetic stage-direction when the
  // user hasn't typed anything (e.g. shortcut button, /ai with no text,
  // regenerate). The old fallback was a useless "[Continue]" — we'd hand the
  // model the strongest role (user) with the weakest signal possible. Now
  // we put the active-turn intent directly on the user turn where it lands
  // hardest.
  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  } else if (!messages.some(m => m.role === 'user')) {
    let directive = '[Stage direction — not part of the story. Now write the next message according to the active-turn instructions above.';
    if (respondAs && respondAs !== SELF_SPEAKER && respondAs !== NARRATOR_SPEAKER) {
      const respondChar = chars.find(c =>
        c.fileName === respondAs || (c.frontmatter.name || '').toLowerCase() === String(respondAs).toLowerCase()
      );
      const rName = respondChar ? (respondChar.frontmatter.name || respondChar.fileName.replace(/\.(md|json)$/, '')) : String(respondAs);
      directive = `[Stage direction — not part of the story. Write ${rName}'s next reply now. Stay strictly in ${rName}'s voice. Do not write for any other character. Do not include the "${rName}:" prefix. Match the writing style and POV defined above.`;
    } else if (respondAs === NARRATOR_SPEAKER) {
      directive = '[Stage direction — not part of the story. Write the next narrative beat in prose. Do not write any character\'s dialogue. Match the writing style above.';
    }
    if (ephemeralInstruction) {
      directive += ` User directive for this turn: ${ephemeralInstruction}`;
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await fs.writeFile(resolveUri(threadDir, 'thread.json'), JSON.stringify(meta, null, 2));
  await fs.writeFile(resolveUri(threadDir, 'messages.jsonl'), '');
  return meta;
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
  const line = JSON.stringify(message);
  let existing = '';
  try { existing = (await fs.readFile(file)).content || ''; } catch { /* first msg */ }
  // Ensure newline separator — avoid corrupting last line if file lacks trailing newline
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(file, existing + separator + line);
}

async function rewriteMessages(fs, workspaceUri, threadId, messages) {
  const file = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/messages.jsonl`);
  const serialized = messages
    .map((message) => JSON.stringify({
      author: message.author || (message.role === 'assistant' ? 'ai' : message.role) || 'user',
      name: message.name || null,
      characterFile: message.characterFile || null,
      content: message.content || '',
      timestamp: message.timestamp || Date.now(),
      instruction: message.instruction || null,
      generatedBy: message.generatedBy || ((message.author || message.role) === 'user' ? 'human' : 'model'),
      hiddenFrom: message.hiddenFrom || null,
      expectsReply: message.expectsReply !== undefined ? message.expectsReply : true,
      variants: message.variants || null,
      variantIndex: message.variantIndex ?? null,
    }))
    .join('\n');
  await fs.writeFile(file, serialized);
}

async function readMessages(fs, workspaceUri, threadId) {
  const file = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/messages.jsonl`);
  try {
    const { content } = await fs.readFile(file);
    if (!content.trim()) return [];
    return content.trim().split('\n').map((l) => {
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
      return msg;
    });
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
// SECTION 8: DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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
        if (!confirm(`Delete chat "${th.title || 'Untitled'}"? This cannot be undone.`)) return;
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
  const modelSelect = el('select', 'tg-chat-toolbar-select');
  const spacer = el('span', 'tg-chat-toolbar-spacer');
  const summaryEl = el('span', 'tg-chat-toolbar-charname');
  const tokenCountEl = el('span', 'tg-token-count');
  const viewPromptBtn = el('button', 'tg-chat-toolbar-btn', { html: icon('eye', 16) });
  viewPromptBtn.title = 'View system prompt';
  toolbar.append(modelLabel, modelSelect, spacer, tokenCountEl, viewPromptBtn, summaryEl);
  root.appendChild(toolbar);

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
  const sendBtn = el('button', 'tg-input-send', { html: icon('send', 16) });
  sendBtn.title = 'Send (Enter)';
  inputToolbar.append(optionsBtn, sendBtn);

  const textareaWrap = el('div', 'tg-textarea-wrap');
  textareaWrap.append(textarea, inputToolbar);
  inputCard.append(textareaWrap);

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
  inputWrap.appendChild(inputCard);
  root.appendChild(inputWrap);

  let thread = null;
  let characters = [];
  let allLorebooks = [];
  let messageHistory = [];
  let models = [];
  let selectedModelId = null;
  let currentSettings = null;
  let lastAssembledContext = null;
  let isGenerating = false;
  let stopRequested = false;
  let selectedComposeSpeaker = SELF_SPEAKER;
  let selectedReplySpeaker = null;
  let transientMessage = null;
  let renderQueued = false;
  let fileWatcher = null;

  function getCharacterByFile(fileName) {
    // Normalize .md/.json extensions for backward compatibility after migration
    const baseName = fileName.replace(/\.(md|json)$/, '');
    return characters.find((char) => char.fileName.replace(/\.(md|json)$/, '') === baseName) || null;
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
      await saveSettings(fs, workspaceUri, currentSettings).catch(() => {});
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
    const roster = characters.map((char) => getCharacterName(char)).join(', ');
    return thread?.title ? `${thread.title} • ${roster}` : roster;
  }

  function updateChrome() {
    summaryEl.textContent = getThreadSummary();
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
    if (isGenerating) {
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
          updateThreadMeta(fs, workspaceUri, threadId, { shortcuts: thread.shortcuts }).catch(() => {});
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
    if (isGenerating) return;
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

    const customBtn = el('button', 'tg-shortcut-btn', { html: `${icon('sparkles', 14)} add a custom shortcut` });
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
          await updateThreadMeta(fs, workspaceUri, threadId, { shortcuts }).catch(() => {});
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
    const inputStyle = 'padding:6px 10px; border:1px solid var(--vscode-input-border, #3c3c3c); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-size:12px; font-family:var(--parallx-fontFamily-ui); box-sizing:border-box; width:100%;';

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
    const insertSelect = el('select');
    insertSelect.style.cssText = inputStyle;
    for (const [val, txt] of [['replace', 'Replace existing reply box text (if any)'], ['append', 'Append to existing reply box text'], ['newline', 'Append on new line']]) {
      const opt = el('option', null, { text: txt });
      opt.value = val;
      insertSelect.appendChild(opt);
    }
    body.appendChild(mkField('Insertion type (what happens when you click the shortcut):', insertSelect));

    // Auto-send
    const autoSendSelect = el('select');
    autoSendSelect.style.cssText = inputStyle;
    for (const [val, txt] of [['yes', 'Yes, send on click'], ['no', 'No, just insert into reply box']]) {
      const opt = el('option', null, { text: txt });
      opt.value = val;
      autoSendSelect.appendChild(opt);
    }
    body.appendChild(mkField('Auto-send?', autoSendSelect));

    // Clear after send
    const clearSelect = el('select');
    clearSelect.style.cssText = inputStyle;
    for (const [val, txt] of [['yes', 'Yes, clear it'], ['no', 'No, keep it']]) {
      const opt = el('option', null, { text: txt });
      opt.value = val;
      clearSelect.appendChild(opt);
    }
    body.appendChild(mkField('Clear reply box after sending?', clearSelect));

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
      await updateThreadMeta(fs, workspaceUri, threadId, { shortcuts }).catch(() => {});
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
    bulkInput.style.cssText = 'width:100%; box-sizing:border-box; padding:10px; border:1px solid var(--vscode-input-border, #3c3c3c); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-size:12px; font-family:monospace; line-height:1.5; resize:vertical; min-height:200px;';
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
      await updateThreadMeta(fs, workspaceUri, threadId, { shortcuts: parsed }).catch(() => {});
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

  function showPromptModal() {
    if (!lastAssembledContext) return;
    const overlay = el('div', 'tg-modal-overlay');
    const modal = el('div', 'tg-modal');
    const header = el('div', 'tg-modal-header');
    header.appendChild(el('span', 'tg-modal-title', { text: 'Last System Prompt' }));
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

    body.appendChild(el('div', 'tg-prompt-role', { text: '— prompt sent to model —' }));
    for (const msg of lastAssembledContext.messages) {
      body.appendChild(el('div', 'tg-prompt-role', { text: msg.role }));
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

  viewPromptBtn.addEventListener('click', showPromptModal);

  function renderMessageRow(msg, index = null, isTransient = false) {
    const hiddenClass = msg.hiddenFrom ? ` tg-msg--dim` : '';
    const messageEl = el('div', `tg-msg tg-msg--${msg.author || 'system'}${isTransient ? ' tg-msg--streaming' : ''}${hiddenClass}`);
    const nameRow = el('div', 'tg-msg-name-row');
    nameRow.appendChild(el('span', `tg-msg-name ${getNameColorClass(msg)}`, { text: getVisibleName(msg) }));

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

      if (msg.author === 'ai') {
        const regenBtn = el('button', 'tg-msg-action-btn', { html: icon('refresh-cw', 13) });
        regenBtn.title = 'Regenerate this turn';
        regenBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (isGenerating || !messageHistory[index]) return;
          const target = messageHistory[index];
          // Warn if regenerating will delete messages after this one
          const messagesAfter = messageHistory.length - 1 - index;
          if (messagesAfter > 0) {
            if (!confirm(`Regenerating will remove ${messagesAfter} message${messagesAfter > 1 ? 's' : ''} after this one. Continue?`)) return;
          }
          const speaker = !target.characterFile && (target.name || '').toLowerCase() === 'narrator'
            ? NARRATOR_SPEAKER
            : (target.characterFile || characters[0]?.fileName);
          // Snapshot variants. Always make sure target.content is preserved as a variant
          // — covers the case where the user edited the message after creating variants.
          const existingVariants = Array.isArray(target.variants) ? target.variants : [];
          const previousVariants = existingVariants.includes(target.content)
            ? [...existingVariants]
            : (existingVariants.length ? [...existingVariants, target.content] : [target.content]);
          const targetSnapshot = { ...target, variants: previousVariants, variantIndex: previousVariants.indexOf(target.content) };
          // Remove this message and everything after it, then regenerate
          messageHistory = messageHistory.slice(0, index);
          await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
          renderMessages();
          await generateTurn({ speaker, instruction: target.instruction || null });
          // Locate the freshly generated AI message (skip past any error system msgs).
          const newIdx = messageHistory.findIndex((m, i) => i >= index && m.author === 'ai' && m.generatedBy === 'model');
          if (newIdx >= 0) {
            const newMsg = messageHistory[newIdx];
            newMsg.variants = [...previousVariants, newMsg.content];
            newMsg.variantIndex = newMsg.variants.length - 1;
            await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
            renderMessages();
          } else {
            // Failure path: cancelled, empty response, or only error system messages.
            // Reinsert the original AI message at its original index so nothing is lost.
            messageHistory = [
              ...messageHistory.slice(0, index),
              targetSnapshot,
              ...messageHistory.slice(index),
            ];
            await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
            renderMessages();
          }
        });
        actions.appendChild(regenBtn);

      } else if (msg.author === 'user') {
        const rewriteBtn = el('button', 'tg-msg-action-btn', { html: icon('refresh-cw', 13) });
        rewriteBtn.title = 'Rewrite with more depth';
        rewriteBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (isGenerating || !messageHistory[index]) return;
          const target = messageHistory[index];
          const originalText = target.content;
          const historyBefore = messageHistory.slice(0, index);

          try {
            isGenerating = true;
            stopRequested = false;
            transientMessage = { ...target, content: '' };
            renderMessages();
            updateChrome();

            const rewriteInstruction = `Rewrite the following user message with richer detail, more vivid description, and greater depth while preserving the original intent, voice, and meaning. Return only the rewritten message with no preamble or explanation.\n\nOriginal message:\n${originalText}`;
            const { assembled, modelId } = await buildContextForGeneration({
              speaker: selectedComposeSpeaker || SELF_SPEAKER,
              instruction: rewriteInstruction,
              historyOverride: historyBefore,
            });
            const messagesForApi = [...assembled.messages];
            messagesForApi.push({
              role: 'system',
              content: `[Rewrite the user's message below with more depth, vivid detail, and richer prose. Preserve intent and voice. Return only the rewritten text.]\n\n${originalText}`,
            });
            const stream = parallx.lm.sendChatRequest(modelId, messagesForApi, getGenerationOptions(null, true));
            let fullResponse = '';
            let isThinking = false;

            for await (const chunk of stream) {
              if (stopRequested) break;
              if (chunk.thinking && !chunk.content) {
                if (!isThinking) {
                  isThinking = true;
                  transientMessage.content = '*Thinking…*';
                  queueRender();
                }
                continue;
              }
              if (chunk.content) {
                isThinking = false;
                fullResponse += chunk.content;
                transientMessage.content = fullResponse;
                queueRender();
              }
            }

            if (fullResponse.trim()) {
              messageHistory[index].content = fullResponse.trim();
              messageHistory[index].generatedBy = 'model';
              await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
            }
          } catch (err) {
            console.warn('[TextGenerator] Rewrite failed:', err);
          } finally {
            transientMessage = null;
            isGenerating = false;
            renderMessages();
            updateChrome();
          }
        });
        actions.appendChild(rewriteBtn);
      }

      const copyBtn = el('button', 'tg-msg-action-btn', { html: icon('clipboard', 13) });
      copyBtn.title = 'Copy to clipboard';
      copyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        navigator.clipboard?.writeText(msg.content || '');
      });
      actions.appendChild(copyBtn);

      // hiddenFrom visibility toggle — cycles null → 'ai' → 'user' → null
      const visLabel = msg.hiddenFrom === 'ai' ? '👁 Hidden from AI' : msg.hiddenFrom === 'user' ? '👁 Hidden from display' : '';
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
      deleteBtn.title = 'Delete message';
      deleteBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const removed = messageHistory[index];
        const removedIndex = index;
        messageHistory.splice(index, 1);
        await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
        renderMessages();
        updateChrome();
        showToast('Message deleted.', 'Undo', async () => {
          // Restore at original index (clamped if list shrank further).
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

    const contentWrap = el('div', 'tg-msg-content-wrap');
    contentWrap.appendChild(nameRow);
    const body = el('div', 'tg-msg-body', { html: renderMessageMarkup(msg.content || '') });

    // Inline edit logic — shared by double-click and pencil button
    function startInlineEdit(bodyEl, msgIndex) {
      if (isGenerating) return;
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
        const autoBtn = el('button', 'tg-inline-edit-btn tg-inline-edit-btn--auto', { html: `${icon('sparkles', 12)} Autocomplete` });
        autoBtn.title = 'Save edits and AI continues writing from where the text ends';
        // mousedown preventDefault keeps textarea focused so blur doesn't race
        autoBtn.addEventListener('mousedown', (e) => e.preventDefault());
        autoBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isGenerating) return;
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
      if (!target || isGenerating) return;
      const textSoFar = target.content;
      if (!textSoFar.trim()) return;
      const continueSpeaker = target.characterFile || await resolveReplySpeaker();
      isGenerating = true;
      stopRequested = false;
      transientMessage = { ...target, content: textSoFar + '…' };
      renderMessages();
      updateChrome();
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
        const stream = parallx.lm.sendChatRequest(modelId, messagesForApi, getGenerationOptions(continueSpeaker));
        let fullResponse = '';
        let isThinking = false;
        for await (const chunk of stream) {
          if (stopRequested) break;
          if (chunk.thinking && !chunk.content) {
            if (!isThinking) {
              isThinking = true;
              transientMessage.content = textSoFar + ' *Thinking…*';
              queueRender();
            }
            continue;
          }
          if (chunk.content) {
            isThinking = false;
            fullResponse += chunk.content;
            const speakerName = target.name || '';
            const stripped = stripSpeakerLabel(fullResponse.trimStart(), speakerName);
            const spacer = textSoFar && !textSoFar.endsWith(' ') && stripped && !stripped.startsWith(' ') ? ' ' : '';
            transientMessage.content = textSoFar + spacer + stripped;
            queueRender();
          }
        }
        if (fullResponse.trim()) {
          const speakerName = target.name || '';
          const stripped = stripSpeakerLabel(fullResponse.trim(), speakerName);
          const spacer = textSoFar && !textSoFar.endsWith(' ') && stripped && !stripped.startsWith(' ') ? ' ' : '';
          messageHistory[msgIndex].content = textSoFar + spacer + stripped;
          await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
        }
      } catch (err) {
        console.warn('[TextGenerator] Autocomplete failed:', err);
      } finally {
        transientMessage = null;
        isGenerating = false;
        renderTurnControls();
        renderMessages();
        updateChrome();
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
    messagesEl.innerHTML = '';
    let visibleCount = 0;
    for (let index = 0; index < messageHistory.length; index++) {
      const msg = messageHistory[index];
      if (msg.hiddenFrom === 'user') continue;
      visibleCount += 1;
      renderMessageRow(msg, index, false);
    }
    if (transientMessage) {
      renderMessageRow(transientMessage, null, true);
      visibleCount += 1;
    }
    if (visibleCount === 0) {
      const welcome = el('div', 'tg-welcome');
      welcome.appendChild(el('div', 'tg-welcome-name', { text: getCharacterName(characters[0]) }));
      welcome.appendChild(el('div', 'tg-welcome-hint', { text: 'Start the scene below.' }));
      messagesEl.appendChild(welcome);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function buildContextForGeneration({ speaker, userText = '', instruction = null, historyOverride = null } = {}) {
    const rawId = selectedModelId || thread?.modelId || null;
    const modelId = (rawId && models.some(m => m.id === rawId)) ? rawId : models[0]?.id;
    if (!modelId) throw new Error('No model selected');
    const modelInfo = models.find((item) => item.id === modelId);
    const contextWindow = thread?.contextWindowOverride || modelInfo?.contextLength || currentSettings?.defaultContextWindow || 8192;
    // Lorebooks come from the primary (first) character only. If multi-character
    // chats are introduced, the original character’s lore wins. If the character
    // hasn't picked any books, fall back to all available books.
    const primaryCharLore = characters[0]?.rawData?.lorebookFiles;
    const lorebooks = Array.isArray(primaryCharLore) && primaryCharLore.length
      ? allLorebooks.filter((book) => primaryCharLore.includes(book.fileName))
      : allLorebooks;
    const budget = computeTokenBudget(contextWindow, currentSettings);
    // Build recent context string for lorebook trigger matching (last ~10 messages + user text).
    // Filter out AI-hidden messages so triggers can't fire on text the AI is forbidden from seeing.
    const baseHistory = historyOverride || messageHistory;
    const recentForTriggers = baseHistory
      .slice(-10)
      .filter((m) => m.hiddenFrom !== 'ai')
      .map((m) => m.content || '')
      .join('\n') + (userText ? '\n' + userText : '');
    const loreContent = assembleLoreContent(lorebooks, budget.lore, recentForTriggers);
    const loreDebug = debugLorebookTriggers(lorebooks, recentForTriggers);
    const memoryContent = await readMemories(fs, workspaceUri, threadId);
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
      try {
        const previewMessages = effectiveHistory.map(m => ({
          role: mapAuthorToRole(m.author || m.role, m),
          content: (m.author === 'user' && !m.characterFile) ? `${getUserName()}: ${m.content || ''}` : (m.name ? `${m.name}: ${m.content || ''}` : (m.content || '')),
        })).filter(m => m.content);
        // Mirror the floor logic to estimate the real history budget.
        const estCharTokens = 1000; // safe over-estimate; refined below if available
        const floorPreview = applyHistoryFloor(budget, estCharTokens);
        const dropped = computeDroppedMessages(previewMessages, floorPreview.effectiveHistory);
        if (dropped.length > 0) {
          // Cache key = stable hash of the dropped messages' content. Keying on
          // count alone caused stale summaries to survive deletes / regenerates /
          // edits when the count happened to stay the same.
          const droppedKey = hashDroppedMessages(dropped);
          const cached = thread?.cachedSummary;
          if (cached && cached.key === droppedKey) {
            historySummary = cached.text || '';
          } else if (parallx?.lm?.sendChatRequest) {
            // Surface that we're spending an extra LLM call so the user knows
            // why the first token is slower than usual.
            transientMessage = {
              author: 'system',
              role: 'system',
              content: `*Summarising ${dropped.length} earlier turn${dropped.length === 1 ? '' : 's'}…*`,
              hiddenFrom: null,
            };
            queueRender();
            const summariserMessages = [
              {
                role: 'system',
                content:
                  'You compress a roleplay conversation into a brief recap. ' +
                  'Output 2-4 short sentences capturing key plot beats, setting, ' +
                  'character relationships and unresolved threads. No preamble, ' +
                  'no quotation marks, no list markers.',
              },
              {
                role: 'user',
                content: 'Summarise the following conversation excerpt:\n\n' +
                  dropped.map(m => `${m.role}: ${(m.content || '').slice(0, 800)}`).join('\n\n'),
              },
            ];
            try {
              const stream = parallx.lm.sendChatRequest(modelId, summariserMessages, {
                temperature: 0.3,
                maxTokens: 250,
                think: false,
              });
              let summaryText = '';
              for await (const chunk of stream) {
                if (chunk?.content) summaryText += chunk.content;
              }
              historySummary = summaryText.trim();
              if (historySummary && thread) {
                thread.cachedSummary = { key: droppedKey, droppedCount: dropped.length, text: historySummary };
                await updateThreadMeta(fs, workspaceUri, thread.id, { cachedSummary: thread.cachedSummary });
              }
            } catch (err) {
              console.warn('[TextGenerator] Summarisation request failed:', err);
            } finally {
              // Clear the summarisation transient message so the actual
              // generation transient can take over without leaking.
              if (transientMessage?.content?.startsWith('*Summarising')) {
                transientMessage = null;
                queueRender();
              }
            }
          }
        }
      } catch (err) {
        console.warn('[TextGenerator] Summarisation pre-pass failed:', err);
      }
    }

    const assembled = assembleContext({
      characters,
      writingPreset: thread?.writingPreset || currentSettings?.defaultWritingPreset || 'immersive-rp',
      pov: thread?.pov || primaryChar?.frontmatter?.pov || currentSettings?.defaultPov || '',
      loreContent,
      memoryContent,
      history: effectiveHistory,
      userMessage: userText,
      contextWindow,
      userName: getUserName(),
      respondAs: speaker,
      responseLength: thread?.responseLength,
      settings: currentSettings,
      ephemeralInstruction: instruction,
      historySummary,
    });
    // Annotate with diagnostic info the inspect modal + token chip surface.
    assembled.loreDebug = loreDebug;
    const charLenLimit = primaryChar?.frontmatter?.messageLengthLimit;
    if (charLenLimit) {
      assembled.responseLengthSource = `character (${primaryChar.frontmatter.name || 'character'}: ${charLenLimit})`;
    } else if (thread?.responseLength) {
      assembled.responseLengthSource = `thread (${thread.responseLength})`;
    } else if (currentSettings?.defaultResponseLength) {
      assembled.responseLengthSource = `global default (${currentSettings.defaultResponseLength})`;
    } else {
      assembled.responseLengthSource = 'unset';
    }
    assembled.fitMethodSource = primaryChar?.frontmatter?.fitMessagesInContextMethod
      ? `character (${primaryChar.frontmatter.name || 'character'})`
      : (currentSettings?.defaultFitMethod ? 'global default' : 'fallback');
    assembled.activeFitMethod = fitMethod;
    // POV cascade: thread → character → global default → inherit-from-preset.
    if (thread?.pov) {
      assembled.povSource = `thread (${POV_OPTIONS[thread.pov]?.label || thread.pov})`;
    } else if (primaryChar?.frontmatter?.pov) {
      assembled.povSource = `character (${POV_OPTIONS[primaryChar.frontmatter.pov]?.label || primaryChar.frontmatter.pov})`;
    } else if (currentSettings?.defaultPov) {
      assembled.povSource = `global default (${POV_OPTIONS[currentSettings.defaultPov]?.label || currentSettings.defaultPov})`;
    } else {
      assembled.povSource = 'inherit (preset decides)';
    }
    lastAssembledContext = assembled;
    selectedModelId = modelId;
    updateChrome();
    return { assembled, modelId };
  }

  function getGenerationOptions(speaker, asUser = false) {
    const character = !asUser && speaker && speaker !== NARRATOR_SPEAKER ? getCharacterByFile(speaker) : null;
    const maxTokens = thread?.maxTokensOverride ?? character?.frontmatter.maxTokensPerMessage ?? currentSettings?.defaultMaxTokens ?? undefined;
    return {
      think: true,
      temperature: thread?.temperatureOverride ?? character?.frontmatter.temperature ?? currentSettings?.defaultTemperature ?? 0.8,
      ...(maxTokens ? { maxTokens } : {}),
      numCtx: thread?.contextWindowOverride || currentSettings?.defaultContextWindow || undefined,
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
    if (!selectedComposeSpeaker || selectedComposeSpeaker === SELF_SPEAKER) {
      return {
        author: 'user',
        name: getUserName(),
        characterFile: null,
        content: text,
        timestamp: Date.now(),
        generatedBy: 'human',
        hiddenFrom: null,
      };
    }
    return {
      author: 'user',
      name: getCharacterName(selectedComposeSpeaker),
      characterFile: selectedComposeSpeaker,
      content: text,
      timestamp: Date.now(),
      generatedBy: 'human',
      hiddenFrom: null,
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
  function stripSpeakerLabel(text, speakerName) {
    if (!speakerName || !text) return text;
    // Escape regex-special characters in the name
    const escaped = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: optional bold markers, name, optional bold markers, colon, optional whitespace
    const pattern = new RegExp(`^\\**${escaped}\\**\\s*:\\s*`, 'i');
    return text.replace(pattern, '');
  }

  async function generateTurn({ speaker = null, instruction = null, asUser = false, userText = '' } = {}) {
    if (isGenerating || characters.length === 0 || !parallx.lm) return;
    const effectiveSpeaker = speaker || (asUser ? selectedComposeSpeaker : await resolveReplySpeaker());
    if (!effectiveSpeaker) return;

    isGenerating = true;
    stopRequested = false;
    transientMessage = buildGeneratedTurnMessage('', effectiveSpeaker, instruction, asUser);
    renderMessages();
    updateChrome();

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
      const _genOpts = getGenerationOptions(effectiveSpeaker, asUser);
      const stream = parallx.lm.sendChatRequest(modelId, messagesForApi, _genOpts);
      let fullResponse = '';
      let isThinking = false;

      for await (const chunk of stream) {
        if (stopRequested) break;
        if (chunk.thinking && !chunk.content) {
          if (!isThinking) {
            isThinking = true;
            transientMessage.content = '*Thinking…*';
            queueRender();
          }
          continue;
        }
        if (chunk.content) {
          isThinking = false;
          fullResponse += chunk.content;
          // Strip leading speaker label during streaming
          const speakerName = transientMessage?.name || '';
          transientMessage.content = stripSpeakerLabel(fullResponse.trimStart(), speakerName);
          queueRender();
        }
      }

      if (fullResponse.trim()) {
        // Strip leading speaker label the model may echo (e.g. "Ada Lovelace: ...")
        const speakerName = transientMessage?.name || '';
        const cleaned = stripSpeakerLabel(fullResponse.trim(), speakerName);
        const finalMessage = buildGeneratedTurnMessage(cleaned, effectiveSpeaker, instruction, asUser);
        messageHistory.push(finalMessage);
        await appendMessage(fs, workspaceUri, threadId, finalMessage);
      }
    } catch (err) {
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
      transientMessage = null;
      isGenerating = false;
      renderTurnControls();
      renderMessages();
      updateChrome();
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
        if (isGenerating || characters.length === 0 || !parallx.lm) break;
        isGenerating = true;
        stopRequested = false;
        transientMessage = { ...lastAiMsg, content: lastAiMsg.content + '…' };
        renderMessages();
        updateChrome();
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
          const stream = parallx.lm.sendChatRequest(modelId, messagesForApi, getGenerationOptions(continueSpeaker));
          let fullResponse = '';
          let isThinking = false;
          for await (const chunk of stream) {
            if (stopRequested) break;
            if (chunk.thinking && !chunk.content) {
              if (!isThinking) {
                isThinking = true;
                transientMessage.content = lastAiMsg.content + ' *Thinking…*';
                queueRender();
              }
              continue;
            }
            if (chunk.content) {
              isThinking = false;
              fullResponse += chunk.content;
              const speakerName = lastAiMsg.name || '';
              const stripped = stripSpeakerLabel(fullResponse.trimStart(), speakerName);
              const spacer = lastAiMsg.content && !lastAiMsg.content.endsWith(' ') && stripped && !stripped.startsWith(' ') ? ' ' : '';
              transientMessage.content = lastAiMsg.content + spacer + stripped;
              queueRender();
            }
          }
          if (fullResponse.trim()) {
            const speakerName = lastAiMsg.name || '';
            const stripped = stripSpeakerLabel(fullResponse.trim(), speakerName);
            const spacer = lastAiMsg.content && !lastAiMsg.content.endsWith(' ') && stripped && !stripped.startsWith(' ') ? ' ' : '';
            messageHistory[lastAiIndex].content = lastAiMsg.content + spacer + stripped;
            await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
          }
        } catch (err) {
          const errorMessage = { author: 'system', name: 'System', content: 'Error: ' + (err.message || String(err)), timestamp: Date.now(), generatedBy: 'human', hiddenFrom: 'ai' };
          messageHistory.push(errorMessage);
          await appendMessage(fs, workspaceUri, threadId, errorMessage);
        } finally {
          transientMessage = null;
          isGenerating = false;
          renderTurnControls();
          renderMessages();
          updateChrome();
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
          : allLorebooks;
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
    let messageText = text;
    if (lines.length > 1 && lastLine.startsWith('/ai ')) {
      inlineInstruction = lastLine.slice(4).trim();
      messageText = lines.slice(0, -1).join('\n').trim();
    }

    if (!messageText && inlineInstruction) {
      await generateTurn({ speaker: await resolveReplySpeaker(selectedReplySpeaker), instruction: inlineInstruction });
      return;
    }

    const userMessage = buildHumanMessage(messageText);
    messageHistory.push(userMessage);
    await appendMessage(fs, workspaceUri, threadId, userMessage);

    if (thread.title === 'New Chat' && messageHistory.filter((msg) => msg.hiddenFrom !== 'user').length <= 1) {
      const autoTitle = messageText.length > 48 ? messageText.slice(0, 48) + '…' : messageText;
      thread.title = autoTitle;
      await updateThreadMeta(fs, workspaceUri, threadId, { title: autoTitle });
      _refreshSidebar?.();
    }

    renderMessages();
    updateChrome();

    // Honor autoReply toggle and expectsReply on the last message
    if (thread?.autoReply !== false) {
      const lastMsg = messageHistory[messageHistory.length - 1];
      if (lastMsg?.expectsReply !== false) {
        await generateTurn({ speaker: await resolveReplySpeaker(selectedReplySpeaker), instruction: inlineInstruction || null, userText: messageText });
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
    // Persist updated thread references if any .md → .json renames happened
    if (threadNeedsUpdate) {
      await updateThreadMeta(fs, workspaceUri, threadId, { characters: thread.characters }).catch(() => {});
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
    modelSelect.innerHTML = '';
    if (!parallx.lm) {
      const option = el('option', null, { text: 'Ollama offline' });
      option.value = '';
      modelSelect.appendChild(option);
      return;
    }
    try {
      models = await parallx.lm.getModels();
    } catch {
      models = [];
    }
    if (models.length === 0) {
      const option = el('option', null, { text: 'No models' });
      option.value = '';
      modelSelect.appendChild(option);
      return;
    }
    for (const model of models) {
      const option = el('option', null, { text: model.displayName || model.id });
      option.value = model.id;
      modelSelect.appendChild(option);
    }
    const threadModel = thread?.modelId && models.some(m => m.id === thread.modelId) ? thread.modelId : null;
    selectedModelId = threadModel || models[0]?.id || null;
    if (selectedModelId) modelSelect.value = selectedModelId;
  }

  /**
   * Show the Perchance-style options menu above the input bar.
   * Items: change user name, toggle autoreply,
   * response length, add character, edit character, reply as..., options (full page).
   */
  function showOptionsMenu() {
    // Remove existing menu if open
    const existing = root.querySelector('.tg-options-menu');
    if (existing) { existing.remove(); return; }

    const menu = el('div', 'tg-options-menu');
    const dismiss = () => { menu.remove(); document.removeEventListener('click', onOutside, true); };
    const onOutside = (e) => { if (!menu.contains(e.target) && e.target !== optionsBtn) dismiss(); };
    setTimeout(() => document.addEventListener('click', onOutside, true), 0);

    const item = (iconName, label, handler) => {
      const btn = el('button', 'tg-options-item');
      btn.innerHTML = `<span style="width:20px;display:inline-flex;align-items:center;justify-content:center">${icon(iconName, 16)}</span> ${label}`;
      btn.addEventListener('click', () => { dismiss(); handler(); });
      menu.appendChild(btn);
    };

    // ── Change user name ──
    item('pencil', 'Change User Name', async () => {
      const currentName = getUserName();
      const overlay = el('div', 'tg-modal-overlay');
      const modal = el('div', 'tg-modal');
      modal.style.maxWidth = '340px';
      const header = el('div', 'tg-modal-header');
      header.appendChild(el('span', 'tg-modal-title', { text: 'Change User Name' }));
      const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
      closeBtn.addEventListener('click', () => overlay.remove());
      header.appendChild(closeBtn);
      modal.appendChild(header);
      const body = el('div', 'tg-modal-body');
      body.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:8px;';
      const nameInput = el('input');
      nameInput.type = 'text';
      nameInput.value = currentName;
      nameInput.style.cssText = 'padding:6px 10px; border:1px solid var(--vscode-input-border, #3c3c3c); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-size:12px; width:100%; box-sizing:border-box;';
      body.appendChild(nameInput);
      modal.appendChild(body);
      const footer = el('div', 'tg-modal-footer');
      footer.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; padding:8px 16px;';
      const cancelBtn2 = el('button', 'tg-shortcut-btn', { text: 'Cancel' });
      cancelBtn2.addEventListener('click', () => overlay.remove());
      const saveBtn = el('button', 'tg-shortcut-btn', { text: 'Save' });
      saveBtn.style.cssText = 'background:var(--vscode-button-background); color:var(--vscode-button-foreground);';
      const doSave = async () => {
        const newName = nameInput.value.trim() || 'Anon';
        thread.userName = newName;
        await updateThreadMeta(fs, workspaceUri, threadId, { userName: newName }).catch(() => {});
        await propagateUserName(newName);
        overlay.remove();
        renderShortcutButtons();
        renderMessages();
      };
      saveBtn.addEventListener('click', doSave);
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
      footer.append(cancelBtn2, saveBtn);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
      nameInput.focus();
      nameInput.select();
    });

    // ── Toggle autoreply ──
    const autoReplyEnabled = thread?.autoReply !== false;
    item('refresh-cw', autoReplyEnabled ? 'Disable Autoreply' : 'Enable Autoreply', async () => {
      thread.autoReply = !autoReplyEnabled;
      await updateThreadMeta(fs, workspaceUri, threadId, { autoReply: thread.autoReply }).catch(() => {});
    });

    // ── Response length ──
    item('ruler', 'Response Length…', () => {
      const overlay = el('div', 'tg-modal-overlay');
      const modal = el('div', 'tg-modal');
      modal.style.maxWidth = '340px';
      const header = el('div', 'tg-modal-header');
      header.appendChild(el('span', 'tg-modal-title', { text: 'Response Length' }));
      const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
      closeBtn.addEventListener('click', () => overlay.remove());
      header.appendChild(closeBtn);
      modal.appendChild(header);
      const body = el('div', 'tg-modal-body');
      body.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:6px;';
      body.appendChild(el('div', null, { text: 'Try setting this to one paragraph if the character keeps undesirably talking or acting on your behalf.' }));
      body.querySelector('div').style.cssText = 'font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:4px;';
      const lengthSelect = el('select');
      lengthSelect.style.cssText = 'padding:6px 10px; border:1px solid var(--vscode-input-border, #3c3c3c); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-size:12px; width:100%; box-sizing:border-box;';
      for (const [val, txt] of [['', 'No reply length limit'], ['short', 'Short (1 paragraph)'], ['medium', 'Medium (2-3 paragraphs)'], ['long', 'Long (4+ paragraphs)']]) {
        const opt = el('option', null, { text: txt });
        opt.value = val;
        lengthSelect.appendChild(opt);
      }
      lengthSelect.value = thread?.responseLength || '';
      body.appendChild(lengthSelect);
      modal.appendChild(body);
      const footer = el('div', 'tg-modal-footer');
      footer.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; padding:8px 16px;';
      const cancelBtn2 = el('button', 'tg-shortcut-btn', { text: 'Cancel' });
      cancelBtn2.addEventListener('click', () => overlay.remove());
      const saveBtn = el('button', 'tg-shortcut-btn', { text: 'Save' });
      saveBtn.style.cssText = 'background:var(--vscode-button-background); color:var(--vscode-button-foreground);';
      saveBtn.addEventListener('click', async () => {
        thread.responseLength = lengthSelect.value || null;
        await updateThreadMeta(fs, workspaceUri, threadId, { responseLength: thread.responseLength }).catch(() => {});
        overlay.remove();
      });
      footer.append(cancelBtn2, saveBtn);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    });

    // ── Add character ──
    item('plus', 'Add Character', async () => {
      const allChars = await scanCharacters(fs, workspaceUri);
      const available = allChars.filter(c => !thread.characters.find(tc => tc.file === c.fileName));
      const overlay = el('div', 'tg-modal-overlay');
      const modal = el('div', 'tg-modal');
      modal.style.maxWidth = '340px';
      const header = el('div', 'tg-modal-header');
      header.appendChild(el('span', 'tg-modal-title', { text: 'Add Character' }));
      const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
      closeBtn.addEventListener('click', () => overlay.remove());
      header.appendChild(closeBtn);
      modal.appendChild(header);
      const body = el('div', 'tg-modal-body');
      body.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:6px;';
      if (available.length === 0) {
        body.appendChild(el('div', 'tg-empty', { text: allChars.length === 0 ? 'No characters found. Create one first.' : 'All characters are already in this chat.' }));
      } else {
        for (const char of available) {
          const cName = getCharacterName(char);
          const btn = el('button', 'tg-shortcut-btn', { html: `${icon('message-circle', 14)} ${escapeHtml(cName)}` });
          btn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
          btn.addEventListener('click', async () => {
            thread.characters.push({ file: char.fileName, addedAt: Date.now() });
            await updateThreadMeta(fs, workspaceUri, threadId, { characters: thread.characters }).catch(() => {});
            overlay.remove();
            await reloadThreadState();
          });
          body.appendChild(btn);
        }
      }
      modal.appendChild(body);
      overlay.appendChild(modal);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    });

    // ── Edit character (opens character editor for primary character) ──
    item('pencil-line', 'Edit Character', () => {
      const primaryChar = characters[0];
      if (!primaryChar) return;
      parallx.editors.openEditor({
        typeId: 'text-generator-character-editor',
        title: getCharacterName(primaryChar),
        icon: 'user',
        instanceId: primaryChar.fileName,
      });
    });

    // ── Reply as... ──
    item('message-circle', 'Reply As…', () => {
      const overlay = el('div', 'tg-modal-overlay');
      const modal = el('div', 'tg-modal');
      modal.style.maxWidth = '340px';
      const header = el('div', 'tg-modal-header');
      header.appendChild(el('span', 'tg-modal-title', { text: 'Reply As...' }));
      const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
      closeBtn.addEventListener('click', () => overlay.remove());
      header.appendChild(closeBtn);
      modal.appendChild(header);
      const body = el('div', 'tg-modal-body');
      body.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:6px;';
      // Self option
      const selfBtn = el('button', 'tg-shortcut-btn', { html: `${icon('user', 14)} ${escapeHtml(getUserName())} (yourself)` });
      selfBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
      if (selectedComposeSpeaker === SELF_SPEAKER) selfBtn.style.borderColor = 'var(--vscode-focusBorder)';
      selfBtn.addEventListener('click', async () => {
        selectedComposeSpeaker = SELF_SPEAKER;
        thread.userPlaysAs = null;
        await updateThreadMeta(fs, workspaceUri, threadId, { userPlaysAs: null }).catch(() => {});
        overlay.remove();
        renderTurnControls();
      });
      body.appendChild(selfBtn);
      // Character options
      for (const char of characters) {
        const cName = getCharacterName(char);
        const btn = el('button', 'tg-shortcut-btn', { html: `${icon('message-circle', 14)} ${escapeHtml(cName)}` });
        btn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
        if (selectedComposeSpeaker === char.fileName) btn.style.borderColor = 'var(--vscode-focusBorder)';
        btn.addEventListener('click', async () => {
          selectedComposeSpeaker = char.fileName;
          thread.userPlaysAs = char.fileName;
          await updateThreadMeta(fs, workspaceUri, threadId, { userPlaysAs: char.fileName }).catch(() => {});
          overlay.remove();
          renderTurnControls();
        });
        body.appendChild(btn);
      }
      modal.appendChild(body);
      overlay.appendChild(modal);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    });

    // ── Options (full settings page) ──
    item('settings', 'Options', () => {
      parallx.editors.openEditor({
        typeId: 'text-generator-chat-settings',
        title: 'Chat Settings',
        icon: 'sliders',
        instanceId: `chat-settings:${threadId}`,
      });
    });

    root.appendChild(menu);
  }

  optionsBtn.addEventListener('click', () => {
    showOptionsMenu();
  });

  async function sendMessage() {
    if (isGenerating || !parallx.lm || characters.length === 0) return;
    const text = textarea.value.trim();
    textarea.value = '';
    textarea.style.height = 'auto';
    if (!text) {
      // Empty send always triggers generation regardless of autoReply
      await generateTurn({ speaker: await resolveReplySpeaker(selectedReplySpeaker) });
      return;
    }
    await handleUserInput(text);
  }

  sendBtn.addEventListener('click', () => {
    if (isGenerating) {
      stopRequested = true;
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

  modelSelect.addEventListener('change', () => {
    selectedModelId = modelSelect.value || null;
    if (thread && selectedModelId) {
      updateThreadMeta(fs, workspaceUri, threadId, { modelId: selectedModelId }).catch(() => {});
    }
  });

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
      if (!isGenerating) reloadThreadState().catch(() => {});
    }, 300);
  };
  container.addEventListener('focusin', focusHandler);
  fileWatcher = parallx.workspace.onDidFilesChange?.((events) => {
    if (isGenerating) return;
    if (events.some((event) => event.uri.includes('/text-generator/'))) {
      clearTimeout(_focusDebounce);
      _focusDebounce = setTimeout(() => {
        if (!isGenerating) reloadThreadState().catch(() => {});
      }, 300);
    }
  });

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
      container.innerHTML = '';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10B: HOME PAGE
// ═══════════════════════════════════════════════════════════════════════════════

function renderHomePage(container, parallx) {
  injectStyles();

  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;

  const root = el('div', 'tg-page');
  container.appendChild(root);

  // Header
  const header = el('div', 'tg-page-header');
  header.innerHTML = icon('sparkles', 28);
  const info = el('div', 'tg-page-header-info');
  info.appendChild(el('div', 'tg-page-header-title', { text: 'Text Generator' }));
  info.appendChild(el('div', 'tg-page-header-subtitle', { text: 'Character chat powered by local Ollama models' }));
  header.appendChild(info);
  root.appendChild(header);

  const content = el('div', 'tg-page-content');
  root.appendChild(content);

  // Quick actions
  const actionsSection = el('div', 'tg-page-section');
  actionsSection.appendChild(el('div', 'tg-page-section-title', { text: 'Quick Actions' }));
  const actions = el('div', 'tg-quick-actions');

  function quickAction(iconName, label, command) {
    const btn = el('button', 'tg-quick-action');
    btn.innerHTML = icon(iconName, 14) + ` <span>${label}</span>`;
    btn.addEventListener('click', () => parallx.commands.executeCommand(command));
    return btn;
  }

  actions.appendChild(quickAction('plus', 'New Chat', 'textGenerator.newChat'));
  actions.appendChild(quickAction('users', 'Characters', 'textGenerator.openCharacters'));
  actions.appendChild(quickAction('settings', 'Settings', 'textGenerator.openSettings'));
  actionsSection.appendChild(actions);
  content.appendChild(actionsSection);

  if (!fs || !workspaceUri) return { dispose() { container.innerHTML = ''; } };

  // Recent chats
  const recentChatsSection = el('div', 'tg-page-section');
  recentChatsSection.appendChild(el('div', 'tg-page-section-title', { text: 'Recent Chats' }));
  const recentChatsList = el('div', 'tg-recent-list');
  recentChatsSection.appendChild(recentChatsList);
  content.appendChild(recentChatsSection);

  // Recent characters
  const recentCharsSection = el('div', 'tg-page-section');
  recentCharsSection.appendChild(el('div', 'tg-page-section-title', { text: 'Characters' }));
  const recentCharsList = el('div', 'tg-recent-list');
  recentCharsSection.appendChild(recentCharsList);
  content.appendChild(recentCharsSection);

  async function load() {
    // Recent chats (last 5)
    recentChatsList.innerHTML = '';
    const threads = await listThreads(fs, workspaceUri);
    const recent = threads.slice(0, 5);
    if (recent.length === 0) {
      recentChatsList.appendChild(el('div', 'tg-empty', { text: 'No conversations yet. Start a new chat!' }));
    } else {
      for (const th of recent) {
        const row = el('div', 'tg-recent-row');
        row.appendChild(el('span', 'tg-recent-row-label', { text: th.title || 'Untitled' }));
        row.appendChild(el('span', 'tg-recent-row-time', { text: formatTimeAgo(th.updatedAt) }));
        row.addEventListener('click', () => {
          parallx.editors.openEditor({
            typeId: 'text-generator-chat',
            title: th.title,
            icon: 'message-circle',
            instanceId: th.id,
          });
        });
        recentChatsList.appendChild(row);
      }
    }

    // Characters
    recentCharsList.innerHTML = '';
    const characters = await scanCharacters(fs, workspaceUri);
    if (characters.length === 0) {
      recentCharsList.appendChild(el('div', 'tg-empty', { text: 'No characters yet. Create one to get started!' }));
    } else {
      for (const ch of characters) {
        const name = ch.frontmatter.name || ch.fileName;
        const row = el('div', 'tg-recent-row');
        row.innerHTML = icon('user', 14);
        row.appendChild(el('span', 'tg-recent-row-label', { text: name }));
        row.addEventListener('click', async () => {
          let modelId = 'unknown';
          if (parallx.lm) {
            try {
              const mdls = await parallx.lm.getModels();
              if (mdls.length) modelId = mdls[0].id;
            } catch { /* fallback */ }
          }
          const thread = await createThread(fs, workspaceUri, ch.fileName, modelId);
          _refreshSidebar?.();
          await parallx.editors.openEditor({
            typeId: 'text-generator-chat',
            title: name,
            icon: 'message-circle',
            instanceId: thread.id,
          });
        });
        recentCharsList.appendChild(row);
      }
    }
  }

  load();
  return { dispose() { container.innerHTML = ''; } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10C: CHARACTERS PAGE
// ═══════════════════════════════════════════════════════════════════════════════

function renderCharactersPage(container, parallx) {
  injectStyles();

  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;

  const root = el('div', 'tg-page');
  container.appendChild(root);

  // Header
  const header = el('div', 'tg-page-header');
  header.innerHTML = icon('users', 28);
  const info = el('div', 'tg-page-header-info');
  info.appendChild(el('div', 'tg-page-header-title', { text: 'Characters' }));
  info.appendChild(el('div', 'tg-page-header-subtitle', { text: 'Manage your character definitions' }));
  header.appendChild(info);
  root.appendChild(header);

  const content = el('div', 'tg-page-content');
  root.appendChild(content);

  if (!fs || !workspaceUri) {
    content.appendChild(el('div', 'tg-empty', { text: 'Open a workspace to manage characters.' }));
    return { dispose() { container.innerHTML = ''; } };
  }

  const grid = el('div', 'tg-card-grid');
  content.appendChild(grid);

  // Lorebook section — created once, content refreshed
  const loreSection = el('div', 'tg-page-section');
  loreSection.style.marginTop = '32px';
  loreSection.appendChild(el('div', 'tg-page-section-title', { text: 'Lorebooks' }));
  const loreGrid = el('div', 'tg-card-grid');
  loreSection.appendChild(loreGrid);
  content.appendChild(loreSection);

  async function refresh() {
    grid.innerHTML = '';
    loreGrid.innerHTML = '';

    // Create new card
    const createCard = el('div', 'tg-card tg-card--create');
    createCard.innerHTML = icon('plus', 24);
    createCard.appendChild(el('span', 'tg-card--create-label', { text: 'Create New Character' }));
    createCard.addEventListener('click', async () => {
      const dir = resolveUri(workspaceUri, `${EXT_ROOT}/characters`);
      await ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', 'text-generator', 'characters']);
      const id = generateId().slice(0, 8);
      const fileName = `character-${id}.json`;
      const newChar = createCharacterJson();
      await fs.writeFile(resolveUri(dir, fileName), JSON.stringify(newChar, null, 2));
      await parallx.editors.openEditor({
        typeId: 'text-generator-character-editor',
        title: 'New Character',
        icon: 'user',
        instanceId: fileName,
      });
      setTimeout(refresh, 500);
    });
    grid.appendChild(createCard);

    // Character cards
    const characters = await scanCharacters(fs, workspaceUri);
    for (const ch of characters) {
      const name = ch.frontmatter.name || ch.fileName.replace(/\.(md|json)$/, '');
      const desc = ch.sections.roleInstruction
        ? ch.sections.roleInstruction.slice(0, 80) + (ch.sections.roleInstruction.length > 80 ? '\u2026' : '')
        : 'No description';

      const card = el('div', 'tg-card');

      // Top: avatar + name
      const top = el('div', 'tg-card-top');
      const avatar = el('div', 'tg-card-avatar');
      avatar.innerHTML = icon('user', 18);
      top.appendChild(avatar);
      top.appendChild(el('div', 'tg-card-name', { text: name }));
      card.appendChild(top);

      // Description
      card.appendChild(el('div', 'tg-card-desc', { text: desc }));

      // Actions
      const actionsRow = el('div', 'tg-card-actions');

      const editBtn = el('button', 'tg-card-action');
      editBtn.innerHTML = icon('edit', 12) + ' Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        parallx.editors.openEditor({
          typeId: 'text-generator-character-editor',
          title: name,
          icon: 'user',
          instanceId: ch.fileName,
        });
      });

      const dupeBtn = el('button', 'tg-card-action');
      dupeBtn.innerHTML = icon('copy', 12) + ' Duplicate';
      dupeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const dir = resolveUri(workspaceUri, `${EXT_ROOT}/characters`);
        const srcPath = resolveUri(dir, ch.fileName);
        try {
          const { content: srcContent } = await fs.readFile(srcPath);
          let dupeData;
          if (ch.fileName.endsWith('.json')) {
            dupeData = JSON.parse(srcContent);
          } else {
            dupeData = migrateCharacterMdToJson(srcContent, ch.fileName);
          }
          const id = generateId().slice(0, 8);
          dupeData.id = 'char-' + id;
          dupeData.name = (dupeData.name || 'Character') + ' (copy)';
          dupeData.createdAt = Date.now();
          dupeData.updatedAt = Date.now();
          const dupeName = ch.fileName.replace(/\.(json|md)$/, '') + `-copy-${id}.json`;
          await fs.writeFile(resolveUri(dir, dupeName), JSON.stringify(dupeData, null, 2));
          refresh();
        } catch (err) { console.warn('[TextGenerator] Duplicate failed:', err); }
      });

      const delBtn = el('button', 'tg-card-action tg-card-action--danger');
      delBtn.innerHTML = icon('trash', 12) + ' Delete';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete character "${name}"? This cannot be undone.`)) return;
        const dir = resolveUri(workspaceUri, `${EXT_ROOT}/characters`);
        try {
          await fs.delete(resolveUri(dir, ch.fileName));
          refresh();
          _refreshSidebar?.();
        } catch { /* ignore */ }
      });

      actionsRow.append(editBtn, dupeBtn, delBtn);
      card.appendChild(actionsRow);

      // Click card to launch a new chat with this character
      card.addEventListener('click', async () => {
        let modelId = 'unknown';
        if (parallx.lm) {
          try {
            const mdls = await parallx.lm.getModels();
            if (mdls.length) modelId = mdls[0].id;
          } catch { /* fallback */ }
        }
        const thread = await createThread(fs, workspaceUri, ch.fileName, modelId);
        _refreshSidebar?.();
        await parallx.editors.openEditor({
          typeId: 'text-generator-chat',
          title: name,
          icon: 'message-circle',
          instanceId: thread.id,
        });
      });

      grid.appendChild(card);
    }

    // Create lorebook card
    const createLore = el('div', 'tg-card tg-card--create');
    createLore.innerHTML = icon('plus', 24);
    createLore.appendChild(el('span', 'tg-card--create-label', { text: 'Create Lorebook' }));
    createLore.addEventListener('click', async () => {
      const dir = resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks`);
      await ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', 'text-generator', 'lorebooks']);
      const id = generateId().slice(0, 8);
      const fileName = `lorebook-${id}.md`;
      await fs.writeFile(resolveUri(dir, fileName), LOREBOOK_TEMPLATE);
      await parallx.editors.openFileEditor(resolveUri(dir, fileName));
      setTimeout(refresh, 500);
    });
    loreGrid.appendChild(createLore);

    const lorebooks = await scanLorebooks(fs, workspaceUri);
    for (const lb of lorebooks) {
      const loreParsed = parseFrontmatter(lb.content);
      const loreName = loreParsed.frontmatter.name || lb.fileName.replace('.md', '');
      const loreBody = loreParsed.body.trim();
      const loreCard = el('div', 'tg-card');
      const loreTop = el('div', 'tg-card-top');
      const loreAvatar = el('div', 'tg-card-avatar');
      loreAvatar.innerHTML = icon('book-open', 18);
      loreTop.appendChild(loreAvatar);
      loreTop.appendChild(el('div', 'tg-card-name', { text: loreName }));
      loreCard.appendChild(loreTop);
      loreCard.appendChild(el('div', 'tg-card-desc', {
        text: loreBody.slice(0, 80) + (loreBody.length > 80 ? '\u2026' : ''),
      }));

      const loreActions = el('div', 'tg-card-actions');
      const loreEdit = el('button', 'tg-card-action');
      loreEdit.innerHTML = icon('edit', 12) + ' Edit';
      loreEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        parallx.editors.openFileEditor(resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks/${lb.fileName}`));
      });
      const loreDupe = el('button', 'tg-card-action');
      loreDupe.innerHTML = icon('copy', 12) + ' Duplicate';
      loreDupe.addEventListener('click', async (e) => {
        e.stopPropagation();
        const dir = resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks`);
        const srcPath = resolveUri(dir, lb.fileName);
        try {
          const { content: srcContent } = await fs.readFile(srcPath);
          // Append (copy) to the frontmatter name if present
          let dupeContent = srcContent;
          const nameMatch = dupeContent.match(/^(---[\s\S]*?\nname:\s*)(.+)(\n[\s\S]*?---)/);
          if (nameMatch) {
            dupeContent = dupeContent.replace(nameMatch[0], nameMatch[1] + nameMatch[2].trim() + ' (copy)' + nameMatch[3]);
          }
          const id = generateId().slice(0, 8);
          const dupeName = lb.fileName.replace('.md', '') + `-copy-${id}.md`;
          await fs.writeFile(resolveUri(dir, dupeName), dupeContent);
          refresh();
        } catch (err) { console.warn('[TextGenerator] Lorebook duplicate failed:', err); }
      });
      const loreDel = el('button', 'tg-card-action tg-card-action--danger');
      loreDel.innerHTML = icon('trash', 12) + ' Delete';
      loreDel.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete lorebook "${loreName}"? This cannot be undone.`)) return;
        try {
          await fs.delete(resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks/${lb.fileName}`));
          refresh();
        } catch { /* ignore */ }
      });
      loreActions.append(loreEdit, loreDupe, loreDel);
      loreCard.appendChild(loreActions);

      loreCard.addEventListener('click', () => {
        parallx.editors.openFileEditor(resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks/${lb.fileName}`));
      });

      loreGrid.appendChild(loreCard);
    }

  }

  refresh();
  return { dispose() { container.innerHTML = ''; } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10D: SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS = {
  tokenBudgetCharacter: 15,
  tokenBudgetLore: 20,
  tokenBudgetHistory: 35,
  tokenBudgetUser: 30,
  defaultTemperature: 0.8,
  defaultMaxTokens: 0,
  defaultContextWindow: 8192,
  userName: 'Anon',
  defaultWritingPreset: 'immersive-rp',
  defaultResponseLength: '',
  defaultPov: '',
  defaultModel: '',
  defaultFitMethod: 'dropOld',
  customWritingStyle: '',
};

async function loadSettings(fs, workspaceUri) {
  const path = resolveUri(workspaceUri, `${EXT_ROOT}/settings.json`);
  try {
    const { content } = await fs.readFile(path);
    return { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
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

  // Header
  const header = el('div', 'tg-page-header');
  header.innerHTML = icon('sliders', 28);
  const info = el('div', 'tg-page-header-info');
  info.appendChild(el('div', 'tg-page-header-title', { text: 'Settings' }));
  info.appendChild(el('div', 'tg-page-header-subtitle', { text: 'Configure token budgets, defaults, and preferences' }));
  header.appendChild(info);
  root.appendChild(header);

  const content = el('div', 'tg-page-content');
  root.appendChild(content);

  if (!fs || !workspaceUri) {
    content.appendChild(el('div', 'tg-empty', { text: 'Open a workspace to configure settings.' }));
    return { dispose() { container.innerHTML = ''; } };
  }

  const form = el('div', 'tg-settings-form');
  content.appendChild(form);

  function formGroup(label, hint, inputType, key, opts = {}) {
    const group = el('div', 'tg-form-group');
    group.appendChild(el('label', 'tg-form-label', { text: label }));
    if (hint) group.appendChild(el('div', 'tg-form-hint', { text: hint }));

    let input;
    if (inputType === 'select' && opts.options) {
      input = el('select', 'tg-form-select');
      for (const opt of opts.options) {
        const option = el('option', null, { text: opt.label || opt.value });
        option.value = opt.value;
        input.appendChild(option);
      }
    } else {
      input = el('input', 'tg-form-input');
      input.type = inputType;
      if (opts.min !== undefined) input.min = opts.min;
      if (opts.max !== undefined) input.max = opts.max;
      if (opts.step !== undefined) input.step = opts.step;
    }
    input.dataset.key = key;
    group.appendChild(input);
    form.appendChild(group);
    return input;
  }

  // Token budget section
  form.appendChild(el('div', 'tg-page-section-title', { text: 'Token Budget (% of context window)' }));
  const budgetTotalEl = el('div', 'tg-form-budget-total');
  form.appendChild(budgetTotalEl);
  const charBudget = formGroup('Character prompt 🧠', 'Higher = richer persona, but eats history. Default 15%.', 'number', 'tokenBudgetCharacter', { min: 0, max: 90 });
  const loreBudget = formGroup('Lore / World info 📚', 'Lorebook + long-term memory share. Default 20%.', 'number', 'tokenBudgetLore', { min: 0, max: 90 });
  const histBudget = formGroup('Chat history 💬', 'Older turns kept in context. Default 35%.', 'number', 'tokenBudgetHistory', { min: 0, max: 90 });
  const userBudget = formGroup('User message ✍️', 'Headroom for your latest message. Default 30%.', 'number', 'tokenBudgetUser', { min: 0, max: 90 });
  function recomputeBudgetTotal() {
    const sum = [charBudget, loreBudget, histBudget, userBudget]
      .map(i => Number(i.value) || 0).reduce((a, b) => a + b, 0);
    if (sum === 100) {
      budgetTotalEl.textContent = `Total: ${sum}% ✓`;
      budgetTotalEl.className = 'tg-form-budget-total tg-form-budget-total--ok';
    } else if (sum === 0) {
      budgetTotalEl.textContent = 'Total: 0% — falls back to defaults';
      budgetTotalEl.className = 'tg-form-budget-total tg-form-budget-total--warn';
    } else {
      budgetTotalEl.textContent = `Total: ${sum}% — values will be scaled to 100%`;
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
  const ctxInput = formGroup('Default context window', 'Used when model info is unavailable', 'number', 'defaultContextWindow', { min: 2048, max: 131072 });
  const userNameInput = formGroup('User display name', 'Used in {{user}} template substitution', 'text', 'userName');
  const presetSelect = formGroup('Default writing preset', 'Applied to newly created chats', 'select', 'defaultWritingPreset', {
    options: Object.entries(WRITING_PRESETS).map(([key, p]) => ({ label: p.label, value: key })),
  });

  // Custom writing-style editor — the prompt text used when any chat selects
  // the "Custom" preset. Always visible so users can draft a custom style
  // before switching the dropdown over.
  const customStyleGroup = el('div', 'tg-form-group');
  customStyleGroup.appendChild(el('label', 'tg-form-label', { text: 'Custom writing style' }));
  customStyleGroup.appendChild(el('div', 'tg-form-hint', {
    text: 'Used when a chat or character selects the "Custom" preset. Markdown is fine — this text is injected verbatim under "## Writing Style".',
  }));
  const customStyleInput = el('textarea', 'tg-form-input');
  customStyleInput.rows = 10;
  customStyleInput.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
  customStyleInput.style.minHeight = '180px';
  customStyleInput.placeholder = '- Write in second-person, present tense.\n- Keep paragraphs short.\n- Lean into sensory detail and quiet beats.';
  customStyleGroup.appendChild(customStyleInput);
  form.appendChild(customStyleGroup);
  const responseLengthSelect = formGroup('Default response length', 'Applied to newly created chats when no character override exists', 'select', 'defaultResponseLength', {
    options: [
      { value: '', label: 'No limit (default)' },
      { value: 'short', label: 'Short (1 paragraph)' },
      { value: 'medium', label: 'Medium (2-3 paragraphs)' },
      { value: 'long', label: 'Long (4+ paragraphs)' },
    ],
  });
  const defaultPovSelect = formGroup('Default point of view', 'POV override applied when no character/thread setting exists. Inherit lets the writing preset decide.', 'select', 'defaultPov', {
    options: Object.entries(POV_OPTIONS).map(([key, p]) => ({ label: p.label, value: key })),
  });
  const defaultModelSelect = formGroup('Default model', 'Used for newly created chats. Leave empty to auto-select first available model.', 'select', 'defaultModel', {
    options: [{ value: '', label: '(auto — first available)' }],
  });
  const fitMethodSelect = formGroup('Default context-fit method', 'How to handle conversations longer than the context window.', 'select', 'defaultFitMethod', {
    options: [
      { value: 'dropOld', label: 'Drop oldest messages (fast)' },
      { value: 'summarizeOld', label: 'Summarize oldest messages (1 extra LLM call/turn, smarter)' },
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
    charBudget.value = s.tokenBudgetCharacter;
    loreBudget.value = s.tokenBudgetLore;
    histBudget.value = s.tokenBudgetHistory;
    userBudget.value = s.tokenBudgetUser;
    tempInput.value = s.defaultTemperature;
    maxTokInput.value = s.defaultMaxTokens;
    ctxInput.value = s.defaultContextWindow;
    userNameInput.value = s.userName;
    presetSelect.value = s.defaultWritingPreset || 'immersive-rp';
    customStyleInput.value = s.customWritingStyle || '';
    responseLengthSelect.value = s.defaultResponseLength || '';
    defaultPovSelect.value = s.defaultPov || '';
    fitMethodSelect.value = s.defaultFitMethod || 'dropOld';
    // Populate model dropdown from available LM models
    if (parallx.lm) {
      try {
        const availableModels = await (parallx.lm.getModels?.() || parallx.lm.listModels?.() || Promise.resolve([]));
        for (const m of availableModels) {
          const opt = el('option', null, { text: m.displayName || m.name || m.id });
          opt.value = m.id;
          defaultModelSelect.appendChild(opt);
        }
        // If saved default is no longer available, surface a warning.
        if (s.defaultModel && !availableModels.some(m => m.id === s.defaultModel)) {
          const warn = el('div', 'tg-form-hint tg-form-hint--warn', {
            text: `⚠ Saved default model "${s.defaultModel}" is not currently available. Using auto-select.`,
          });
          defaultModelSelect.parentElement?.appendChild(warn);
        }
      } catch { /* no models available */ }
    }
    defaultModelSelect.value = (s.defaultModel && Array.from(defaultModelSelect.options).some(o => o.value === s.defaultModel)) ? s.defaultModel : '';
    recomputeBudgetTotal();
  }

  saveBtn.addEventListener('click', async () => {
    const settings = {
      tokenBudgetCharacter: Number.isFinite(Number(charBudget.value)) ? Number(charBudget.value) : DEFAULT_SETTINGS.tokenBudgetCharacter,
      tokenBudgetLore: Number.isFinite(Number(loreBudget.value)) ? Number(loreBudget.value) : DEFAULT_SETTINGS.tokenBudgetLore,
      tokenBudgetHistory: Number.isFinite(Number(histBudget.value)) ? Number(histBudget.value) : DEFAULT_SETTINGS.tokenBudgetHistory,
      tokenBudgetUser: Number.isFinite(Number(userBudget.value)) ? Number(userBudget.value) : DEFAULT_SETTINGS.tokenBudgetUser,
      defaultTemperature: Number.isFinite(Number(tempInput.value)) ? Number(tempInput.value) : DEFAULT_SETTINGS.defaultTemperature,
      defaultMaxTokens: Number.isFinite(Number(maxTokInput.value)) ? Number(maxTokInput.value) : DEFAULT_SETTINGS.defaultMaxTokens,
      defaultContextWindow: Number.isFinite(Number(ctxInput.value)) && Number(ctxInput.value) > 0 ? Number(ctxInput.value) : DEFAULT_SETTINGS.defaultContextWindow,
      userName: userNameInput.value.trim() || DEFAULT_SETTINGS.userName,
      defaultWritingPreset: presetSelect.value || DEFAULT_SETTINGS.defaultWritingPreset,
      defaultResponseLength: responseLengthSelect.value || '',
      defaultPov: defaultPovSelect.value || '',
      defaultModel: defaultModelSelect.value || '',
      defaultFitMethod: fitMethodSelect.value || DEFAULT_SETTINGS.defaultFitMethod,
      customWritingStyle: customStyleInput.value || '',
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
  roleInput.placeholder = 'Include the most important details first. Also, it\'s a good idea to include example dialogue if you can — show the AI how you want the character to speak.';
  root.appendChild(field(
    `${icon('file-text', 14)} Character description/personality/instruction/role`,
    'This should ideally be less than 1000 words. You can write {{user}} to refer to the user\'s name.',
    roleInput,
  ));

  const lengthSelect = el('select', 'tg-ce-select');
  for (const opt of [
    { value: '', label: 'No reply length limit' },
    { value: 'short', label: '1 paragraph' },
    { value: 'medium', label: '2-3 paragraphs' },
    { value: 'long', label: '4+ paragraphs' },
  ]) {
    const o = el('option', null, { text: opt.label });
    o.value = opt.value;
    lengthSelect.appendChild(o);
  }
  root.appendChild(field(`${icon('ruler', 14)} Strict message length limit`, 'Try setting this to one paragraph if the character keeps undesirably talking/acting on your behalf.', lengthSelect));

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
    'Remind the AI of important things, writing tips, and so on. Use this for important stuff that the AI often forgets. Try to keep this under 100 words — i.e. about a paragraph at most.',
    reminderInput,
  ));

  const presetSelect = el('select', 'tg-ce-select');
  for (const [key, p] of Object.entries(WRITING_PRESETS)) {
    const o = el('option', null, { text: p.label });
    o.value = key;
    presetSelect.appendChild(o);
  }
  const presetField = field(
    `${icon('pencil-line', 14)} General writing instructions`,
    'These instructions apply to the whole chat, regardless of which character is currently speaking. It\'s for defining general writing style and the "type of experience".',
    presetSelect,
  );
  // Inheritance hint: per-thread > per-character > global default.
  presetField.appendChild(el('div', 'tg-form-inherit', {
    text: 'Per-thread setting overrides this. If unset, the global default in Settings is used.',
  }));
  root.appendChild(presetField);

  // Point of view override — stacks under the writing preset.
  const povSelect = el('select', 'tg-ce-select');
  for (const [key, p] of Object.entries(POV_OPTIONS)) {
    const o = el('option', null, { text: p.label });
    o.value = key;
    povSelect.appendChild(o);
  }
  const povField = field(
    `${icon('eye', 14)} Point of view`,
    'Locks narration POV regardless of writing preset. "Inherit" lets the preset decide.',
    povSelect,
  );
  povField.appendChild(el('div', 'tg-form-inherit', {
    text: 'Per-thread setting overrides this. If unset, the global default in Settings is used.',
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
  const loreListContainer = el('div', 'tg-ce-lore-list');
  let _allLoreFiles = [];
  const _loreSelected = new Set();
  function rebuildLoreList() {
    loreListContainer.innerHTML = '';
    const known = new Set(_allLoreFiles);
    if (_allLoreFiles.length === 0 && _loreSelected.size === 0) {
      loreListContainer.appendChild(el('div', 'tg-ce-lore-empty', {
        text: 'No lorebooks in the lorebooks/ folder yet. Create one from the Home page.',
      }));
      return;
    }
    for (const fname of _allLoreFiles) {
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
    for (const sel of _loreSelected) {
      if (known.has(sel)) continue;
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
  root.appendChild(field(
    `${icon('book-open', 14)} Lorebooks`,
    'Tick lorebooks this character should pull world info from. Triggers fire when keywords appear in recent context.',
    loreListContainer,
  ));

  // ── Temperature + max tokens (lifted out of "More") ──
  const genRow = el('div', 'tg-ce-row');
  const tempInput = el('input', 'tg-ce-input');
  tempInput.type = 'number';
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  genRow.appendChild(field('Temperature 🌡️', 'Creativity 0–2. Lower = consistent, higher = wild. Default 0.8.', tempInput));
  const maxTokInput = el('input', 'tg-ce-input');
  maxTokInput.type = 'number';
  maxTokInput.min = '0';
  genRow.appendChild(field('Max tokens ⚡', '0 = unlimited (best for thinking models). Caps reply length — lower = faster.', maxTokInput));
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
  const fitSelect = el('select', 'tg-ce-select');
  for (const opt of [
    { value: '', label: '(use global default)' },
    { value: 'dropOld', label: 'Drop oldest messages (fast)' },
    { value: 'summarizeOld', label: 'Summarize oldest messages (smarter, +1 LLM call/turn)' },
  ]) {
    const o = el('option', null, { text: opt.label });
    o.value = opt.value;
    fitSelect.appendChild(o);
  }
  moreSection.appendChild(field('Context-fit method', 'How to handle conversations longer than the context window. Overrides the global default.', fitSelect));

  // Extended memory
  const memorySelect = el('select', 'tg-ce-select');
  for (const opt of [
    { value: 'false', label: 'Off' },
    { value: 'true', label: 'On — reserve ≥40% of lore lane for /mem entries' },
  ]) {
    const o = el('option', null, { text: opt.label });
    o.value = opt.value;
    memorySelect.appendChild(o);
  }
  moreSection.appendChild(field(
    `${icon('brain', 14)} Extended character memory`,
    'When On, /mem entries are guaranteed at least 40% of the Lore lane (vs. proportional to size). Use it when long-term recall matters more than world-info detail.',
    memorySelect,
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
  const sandboxBtn = el('button', 'tg-ce-cancel-btn', { html: `${icon('play', 13)} Test in chat` });
  sandboxBtn.title = 'Save then open a fresh chat with this character';
  const savedLabel = el('span', 'tg-ce-saved', { text: 'Saved!' });
  const saveBtn = el('button', 'tg-ce-save-btn', { text: 'Save Character' });
  footer.append(cancelBtn, sandboxBtn, savedLabel, saveBtn);
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

  cancelBtn.addEventListener('click', () => {
    if (isDirty() && !confirm('Discard unsaved changes?')) return;
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
  const titleEl = el('div', 'tg-chat-settings-title', { text: 'Chat Settings' });
  const subtitleEl = el('div', 'tg-chat-settings-subtitle', { text: 'Configure this conversation' });
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
  const personaSelect = el('select', 'tg-cs-select');
  personaRow.appendChild(personaSelect);
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

  // ── Context ──
  const contextSection = el('div', 'tg-cs-section');
  contextSection.appendChild(el('div', 'tg-cs-section-title', { text: 'Context' }));
  const presetRow = el('div', 'tg-cs-row');
  presetRow.appendChild(el('div', 'tg-cs-label', { text: 'Writing Preset' }));
  const presetSelect = el('select', 'tg-cs-select');
  for (const [key, p] of Object.entries(WRITING_PRESETS)) {
    const option = el('option', null, { text: p.label });
    option.value = key;
    presetSelect.appendChild(option);
  }
  presetRow.appendChild(presetSelect);
  contextSection.appendChild(presetRow);
  contextSection.appendChild(el('div', 'tg-cs-hint', { text: 'Shared writing conventions for the whole chat. Character-specific instructions override this.' }));

  const povRow = el('div', 'tg-cs-row');
  povRow.appendChild(el('div', 'tg-cs-label', { text: 'Point of View' }));
  const povSelect = el('select', 'tg-cs-select');
  for (const [key, p] of Object.entries(POV_OPTIONS)) {
    const option = el('option', null, { text: p.label });
    option.value = key;
    povSelect.appendChild(option);
  }
  povRow.appendChild(povSelect);
  contextSection.appendChild(povRow);
  contextSection.appendChild(el('div', 'tg-cs-hint', { text: 'Overrides POV regardless of preset. Inherit cascades: character → global default → preset.' }));

  contextSection.appendChild(el('div', 'tg-cs-hint', {
    text: 'Lorebooks are configured on the character. In multi-character chats, the original character\'s lore is used.',
  }));
  root.appendChild(contextSection);

  // ── Generation ──
  const generationSection = el('div', 'tg-cs-section');
  generationSection.appendChild(el('div', 'tg-cs-section-title', { text: 'Generation' }));
  const modelRow = el('div', 'tg-cs-row');
  modelRow.appendChild(el('div', 'tg-cs-label', { text: 'Model' }));
  const modelSelect = el('select', 'tg-cs-select');
  modelRow.appendChild(modelSelect);
  generationSection.appendChild(modelRow);

  const tempRow = el('div', 'tg-cs-row');
  tempRow.appendChild(el('div', 'tg-cs-label', { text: 'Temperature Override' }));
  const tempInput = el('input', 'tg-cs-input');
  tempInput.type = 'number';
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  tempRow.appendChild(tempInput);
  generationSection.appendChild(tempRow);

  const maxTokensRow = el('div', 'tg-cs-row');
  maxTokensRow.appendChild(el('div', 'tg-cs-label', { text: 'Max Tokens Override' }));
  const maxTokensInput = el('input', 'tg-cs-input');
  maxTokensInput.type = 'number';
  maxTokensInput.min = '128';
  maxTokensRow.appendChild(maxTokensInput);
  generationSection.appendChild(maxTokensRow);

  const contextRow = el('div', 'tg-cs-row');
  contextRow.appendChild(el('div', 'tg-cs-label', { text: 'Context Window Override' }));
  const contextInput = el('input', 'tg-cs-input');
  contextInput.type = 'number';
  contextInput.min = '2048';
  contextRow.appendChild(contextInput);
  generationSection.appendChild(contextRow);

  const lengthRow = el('div', 'tg-cs-row');
  lengthRow.appendChild(el('div', 'tg-cs-label', { text: 'Response Length' }));
  const lengthSelect = el('select', 'tg-cs-select');
  for (const opt of [
    { value: '', label: 'Default (no constraint)' },
    { value: 'short', label: 'Short (1 paragraph)' },
    { value: 'medium', label: 'Medium (2-3 paragraphs)' },
    { value: 'long', label: 'Long (4+ paragraphs)' },
  ]) {
    const option = el('option', null, { text: opt.label });
    option.value = opt.value;
    lengthSelect.appendChild(option);
  }
  lengthRow.appendChild(lengthSelect);
  generationSection.appendChild(lengthRow);
  generationSection.appendChild(el('div', 'tg-cs-hint', { text: 'Default cascade: character override → this chat → global default. Leaving fields blank inherits.' }));

  root.appendChild(generationSection);

  const saveRow = el('div', 'tg-cs-save-row');
  const saveBtn = el('button', 'tg-cs-save-btn', { text: 'Save Chat Settings' });
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
    personaSelect.innerHTML = '';
    const selfOption = el('option', null, { text: 'Myself' });
    selfOption.value = SELF_SPEAKER;
    personaSelect.appendChild(selfOption);
    for (const charRef of thread.characters) {
      const charBase = charRef.file.replace(/\.(md|json)$/, '');
      const character = allCharacters.find((item) => item.fileName.replace(/\.(md|json)$/, '') === charBase);
      const option = el('option', null, {
        text: character ? (character.frontmatter.name || character.fileName.replace(/\.(md|json)$/, '')) : charRef.file,
      });
      option.value = charRef.file;
      personaSelect.appendChild(option);
    }
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
      writingPreset: presetSelect.value || 'immersive-rp',
      pov: povSelect.value || '',
      modelId: modelSelect.value || thread.modelId,
      temperatureOverride: tempInput.value.trim() && Number.isFinite(Number(tempInput.value)) ? Number(tempInput.value) : null,
      maxTokensOverride: maxTokensInput.value.trim() && Number.isFinite(Number(maxTokensInput.value)) ? Number(maxTokensInput.value) : null,
      contextWindowOverride: contextInput.value.trim() && Number.isFinite(Number(contextInput.value)) ? Number(contextInput.value) : null,
      responseLength: lengthSelect.value || null,
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

    presetSelect.value = thread.writingPreset || 'immersive-rp';
    povSelect.value = thread.pov || '';

    modelSelect.innerHTML = '';
    if (models.length > 0) {
      for (const model of models) {
        const option = el('option', null, { text: model.displayName || model.id });
        option.value = model.id;
        modelSelect.appendChild(option);
      }
      const validThreadModel = thread.modelId && models.some(m => m.id === thread.modelId) ? thread.modelId : models[0].id;
      modelSelect.value = validThreadModel;
    } else {
      const option = el('option', null, { text: 'Ollama offline' });
      option.value = '';
      modelSelect.appendChild(option);
    }

    tempInput.value = thread.temperatureOverride ?? '';
    maxTokensInput.value = thread.maxTokensOverride ?? '';
    contextInput.value = thread.contextWindowOverride ?? '';
    lengthSelect.value = thread.responseLength || '';

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
 * Point-of-view overrides. Stacked under the writing preset so they win
 * over whatever POV the preset implies. Empty/'inherit' = no extra line.
 */
const POV_OPTIONS = {
  '': { label: 'Inherit (preset decides)', content: '' },
  'first-person': {
    label: 'First person',
    content: 'Write {{char}}\'s narration in **first person, present tense** ("I walk", "I feel"). Inner thoughts in *italics*, dialogue in "quotes".',
  },
  'close-third': {
    label: 'Close third person',
    content: 'Write {{char}}\'s narration in **third person, past tense, anchored tightly to {{char}}\'s viewpoint** ("She walked", "He felt"). The reader sees only what {{char}} sees, hears, and thinks. Inner thoughts in *italics*, dialogue in "quotes".',
  },
  'omniscient-third': {
    label: 'Omniscient third person',
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

  // Character editor
  const charEditorDisposable = parallx.editors.registerEditorProvider('text-generator-character-editor', {
    createEditorPane(container, input) {
      return renderCharacterEditor(container, parallx, input);
    },
  });
  context.subscriptions.push(charEditorDisposable);

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
      parallx.window?.showErrorMessage(
        'No character files found. Create one in the Characters page first.',
      );
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

    let modelId = 'unknown';
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
      title: 'Text Generator',
      icon: 'sparkles',
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
  }

  console.log('[TextGenerator] All providers registered');
}

export function deactivate() {
  console.log('[TextGenerator] Extension deactivated');
  const style = document.getElementById('text-generator-styles');
  if (style) style.remove();
  _styleInjected = false;
}
