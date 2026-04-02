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
// SECTION 1A: INLINE LUCIDE SVG ICONS
// ═══════════════════════════════════════════════════════════════════════════════

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>',
  'message-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
  'book-open': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>',
  'chevron-right': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8h4"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M17 16h4"/><path d="M19 12V3"/><path d="M19 21v-5"/><path d="M3 14h4"/><path d="M5 10V3"/><path d="M5 21v-7"/></svg>',
  'refresh-cw': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
  'pencil-line': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/><path d="m15 5 3 3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  square: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
  'chevron-down': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
};

function icon(name, size = 16) {
  const svg = ICONS[name] || '';
  return `<span class="tg-icon" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</span>`;
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
  font-size: var(--parallx-fontSize-base, 12px);
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
  font-size: var(--parallx-fontSize-base, 12px);
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
  font-size: var(--parallx-fontSize-base, 12px);
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

/* Avatar image in message row */
.tg-msg-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  margin-top: 2px;
}
.tg-msg-avatar--square { border-radius: 4px; }
.tg-msg-avatar--circle { border-radius: 50%; }
.tg-msg-avatar--default { border-radius: 50%; }
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
  padding: 8px 16px 12px;
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
  background: var(--vscode-editor-background);
}
.tg-input-card {
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--vscode-input-border, #3c3c3c) 70%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--vscode-input-background, #3c3c3c) 92%, var(--vscode-editorWidget-background, #252526) 8%);
  overflow: hidden;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.tg-input-card:focus-within {
  border-color: var(--vscode-focusBorder, #007fd4);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.tg-input-textarea {
  width: 100%;
  min-height: 40px;
  max-height: 160px;
  padding: 12px 14px 6px;
  border: none;
  background: transparent;
  color: var(--vscode-input-foreground, #ccc);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-md, 13px);
  line-height: 1.4;
  resize: none;
  overflow-y: auto;
  outline: none;
  box-sizing: border-box;
}
.tg-input-textarea::placeholder { color: var(--vscode-input-placeholderForeground, #6e6e6e); }
.tg-input-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 8px 6px;
}
.tg-input-toolbar-spacer { flex: 1; }
.tg-input-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  cursor: pointer;
  transition: opacity 80ms ease, background 80ms ease;
  padding: 0;
}
.tg-input-send:hover { opacity: 0.85; }
.tg-input-send:disabled { opacity: 0.35; cursor: default; }
.tg-input-send .tg-icon { color: inherit; }

/* Stop button */
.tg-input-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--vscode-testing-iconFailed, #f14c4c);
  color: #fff;
  cursor: pointer;
  padding: 0;
  transition: opacity 80ms ease;
}
.tg-input-stop:hover { opacity: 0.85; }

/* Options button */
.tg-input-options-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
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

/* ═══ Unified shortcut bar (Perchance-style: characters + custom shortcuts) ═══ */
.tg-shortcut-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 2px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.tg-shortcut-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 10px;
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: 12px;
  background: var(--vscode-editorWidget-background, #252526);
  color: var(--vscode-descriptionForeground);
  font-family: var(--parallx-fontFamily-ui);
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 80ms ease, background 80ms ease, color 80ms ease;
}
.tg-shortcut-btn:hover {
  border-color: var(--vscode-focusBorder, #007fd4);
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}
.tg-shortcut-btn--char { color: #dcdcaa; border-color: color-mix(in srgb, #dcdcaa 30%, transparent); }
.tg-shortcut-btn--user { color: #73c991; border-color: color-mix(in srgb, #73c991 30%, transparent); }
.tg-shortcut-btn--narrator { color: #c586c0; border-color: color-mix(in srgb, #c586c0 30%, transparent); }
.tg-shortcut-btn--system { color: #9cdcfe; border-color: color-mix(in srgb, #9cdcfe 30%, transparent); }
.tg-shortcut-btn--add {
  border-style: dashed;
  color: var(--vscode-descriptionForeground);
  border-color: var(--vscode-panel-border, #2a2a2a);
  opacity: 0.7;
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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: text };

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (!isNaN(value) && value !== '') {
      value = Number(value);
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body: text.slice(match[0].length).trim() };
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function trimTextToBudget(text, budgetTokens) {
  if (!text) return '';
  if (estimateTokens(text) <= budgetTokens) return text;
  return text.slice(0, budgetTokens * 4);
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

  // Parse @CharName from the rest
  const atMatch = rest.match(/^@(\S+)\s*(.*)/s);
  if (atMatch) {
    targetCharacter = atMatch[1];
    instruction = atMatch[2].trim();
  }

  return { command, args: rest, instruction, targetCharacter };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: TOKEN BUDGET (← openclawTokenBudget.ts)
// ═══════════════════════════════════════════════════════════════════════════════

function computeTokenBudget(contextWindow, settings = null) {
  const total = Math.max(0, Math.floor(contextWindow));
  const charPct = (settings?.tokenBudgetCharacter || 15) / 100;
  const lorePct = (settings?.tokenBudgetLore || 20) / 100;
  const histPct = (settings?.tokenBudgetHistory || 35) / 100;
  const userPct = (settings?.tokenBudgetUser || 30) / 100;
  return {
    total,
    character: Math.floor(total * charPct),
    lore: Math.floor(total * lorePct),
    history: Math.floor(total * histPct),
    user: Math.floor(total * userPct),
  };
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
          // Auto-migrate .md to .json
          const { content } = await fs.readFile(resolveUri(charsDir, entry.name));
          const char = migrateCharacterMdToJson(content, entry.name);
          const jsonName = entry.name.replace('.md', '.json');
          await fs.writeFile(resolveUri(charsDir, jsonName), JSON.stringify(char, null, 2));
          try { await fs.delete(resolveUri(charsDir, entry.name)); } catch { /* ok */ }
          results.push(normalizeCharacterForRuntime(char, jsonName));
        }
      } catch { /* skip broken */ }
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
    temperature: 0.8,
    maxTokensPerMessage: 2048,
    messageLengthLimit: '',
    userName: '',
    userDescription: '',
    userAvatarUrl: '',
    avatarUrl: '',
    avatarSize: 1,
    avatarShape: 'default',
    userAvatarSize: 1,
    userAvatarShape: 'default',
    lorebookFiles: [],
    fitMessagesInContextMethod: 'dropOld',
    extendedMemory: false,
    shortcutButtons: '',
    systemName: '',
    systemAvatarUrl: '',
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
      maxTokensPerMessage: data.maxTokensPerMessage ?? 2048,
      writingPreset: data.writingPreset || 'immersive-rp',
      avatar: data.avatarUrl || '',
      messageLengthLimit: data.messageLengthLimit || '',
      userName: data.userName || '',
      userDescription: data.userDescription || '',
      userAvatarUrl: data.userAvatarUrl || '',
      avatarSize: data.avatarSize ?? 1,
      avatarShape: data.avatarShape || 'default',
      userAvatarSize: data.userAvatarSize ?? 1,
      userAvatarShape: data.userAvatarShape || 'default',
      fitMessagesInContextMethod: data.fitMessagesInContextMethod || 'dropOld',
      extendedMemory: data.extendedMemory || false,
      shortcutButtons: data.shortcutButtons || '',
      systemName: data.systemName || '',
      systemAvatarUrl: data.systemAvatarUrl || '',
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
    name: parsed.frontmatter.name || fileName.replace('.md', ''),
    roleInstruction: parsed.sections.roleInstruction || '',
    exampleDialogue: parsed.sections.exampleDialogue || '',
    reminder: parsed.sections.reminder || '',
    initialMessages: parsed.sections.initialMessages || '',
    temperature: parsed.frontmatter.temperature ?? 0.8,
    maxTokensPerMessage: parsed.frontmatter.maxTokensPerMessage ?? 2048,
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
        } catch { /* skip */ }
      }
    }
    return results;
  } catch {
    return [];
  }
}

function assembleLoreContent(lorebooks, budgetTokens) {
  let combined = '';
  let used = 0;
  for (const lb of lorebooks) {
    const t = estimateTokens(lb.content);
    if (used + t > budgetTokens) {
      const rem = budgetTokens - used;
      if (rem > 50) combined += '\n\n' + trimTextToBudget(lb.content, rem);
      break;
    }
    combined += (combined ? '\n\n' : '') + lb.content;
    used += t;
  }
  return combined.trim();
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
    loreContent = '',
    memoryContent = '',
    respondAs = null,
    userName = 'Anon',
    userDescription = '',
    responseLength = null,
  } = params;

  const parts = [];
  const castEntries = [];
  const characterReminders = [];

  // 1. Writing preset at the TOP — sets the shared writing framework.
  const presetContent = getPresetContent(writingPreset);
  if (presetContent) {
    parts.push(['## Writing Style', presetContent].join('\n'));
  }

  // 1b. User identity — description/role if provided by character config.
  if (userDescription) {
    parts.push(['## User Identity', `The user (${userName}) is described as: ${userDescription}`].join('\n'));
  }

  // 2. Cast definitions — each character's full roleInstruction block.
  for (const char of characters) {
    const name = char.frontmatter.name || char.fileName.replace('.md', '');
    const roleInstruction = char.sections.roleInstruction;
    const charParts = [];

    if (roleInstruction) {
      charParts.push(substituteVars(roleInstruction, name, userName));
    }
    if (char.sections.exampleDialogue) {
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

  // 4. Lore.
  if (loreContent) {
    parts.push('## World & Lore\n' + loreContent);
  }

  // 5. Thread memory.
  if (memoryContent) {
    parts.push('## Conversation Memories\n' + memoryContent);
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
      ? (respondChar.frontmatter.name || respondChar.fileName.replace('.md', ''))
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

// Backward-compatible wrapper for single-character usage
function buildCharacterSystemPrompt(character, options = {}) {
  const { userName = 'User', loreContent = '', memoryContent = '', writingPreset = 'immersive-rp' } = options;
  return buildSystemPrompt({
    characters: [character],
    loreContent,
    memoryContent,
    userName,
    writingPreset,
  }).prompt;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: CONTEXT ASSEMBLY (← openclawContextEngine.ts)
// ═══════════════════════════════════════════════════════════════════════════════

function trimHistoryToBudget(messages, budgetTokens) {
  const result = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i].content);
    if (used + t > budgetTokens) break;
    result.unshift(messages[i]);
    used += t;
  }
  return result;
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
  } = params;

  // Support both old (single character) and new (characters array) signatures
  const chars = characters.length > 0 ? characters : (character ? [character] : []);
  const budget = computeTokenBudget(contextWindow, settings);

  // Reserve part of the lore lane for thread memory so it never disappears behind lorebook size.
  const memoryBudget = Math.max(0, Math.floor(budget.lore * 0.4));
  const loreBudget = Math.max(0, budget.lore - memoryBudget);
  const loreTrimmed = trimTextToBudget(loreContent, loreBudget);
  const memTrimmed = trimTextToBudget(memoryContent, memoryBudget);

  // Extract per-character overrides from primary character
  const primaryChar = chars[0] || null;
  const charUserDesc = primaryChar?.frontmatter?.userDescription || '';
  const charUserReminder = primaryChar?.userReminder || primaryChar?.sections?.userReminder || '';
  const charMsgLenLimit = primaryChar?.frontmatter?.messageLengthLimit || '';
  // Character messageLengthLimit overrides thread responseLength when set
  const effectiveResponseLength = charMsgLenLimit || responseLength;

  const buildResult = buildSystemPrompt({
    characters: chars,
    writingPreset,
    loreContent: loreTrimmed,
    memoryContent: memTrimmed,
    respondAs,
    userName,
    userDescription: charUserDesc,
    responseLength: effectiveResponseLength,
  });
  const systemPrompt = buildResult.prompt;
  const characterReminders = buildResult.reminders || [];

  // Check if system prompt overflows character budget — borrow from history
  const charTokens = estimateTokens(systemPrompt);
  let historyBudget = budget.history;
  if (charTokens > budget.character) {
    const overflow = charTokens - budget.character;
    historyBudget = Math.max(0, historyBudget - overflow);
  }

  const messages = [{ role: 'system', content: systemPrompt }];

  // History — filter out hiddenFrom:"ai" messages, map author→role
  const filteredHistory = history.filter(m => m.hiddenFrom !== 'ai');
  const mappedHistory = filteredHistory.map(m => ({
    role: mapAuthorToRole(m.author || m.role, m),
    content: m.name ? `${m.name}: ${m.content}` : m.content,
  }));

  // fitMessagesInContextMethod — character-level preference for context trimming
  // 'dropOld' (default): drop oldest messages when budget exceeded
  // 'summarizeOld': summarize oldest messages (future: requires async LLM call)
  const charFitMethod = primaryChar?.frontmatter?.fitMessagesInContextMethod || 'dropOld';

  messages.push(...trimHistoryToBudget(mappedHistory, historyBudget));

  // Character reminders — injected right before AI response for maximum recency
  // (matches Perchance behavior: reminder as hidden system msg near end of context)
  // Also inject userReminder (Perchance: separate user-perspective reminder)
  if (charUserReminder) {
    characterReminders.push(`- User reminder: ${charUserReminder}`);
  }
  if (characterReminders.length > 0) {
    messages.push({ role: 'system', content: '[Reminders]\n' + characterReminders.join('\n') });
  }

  // Ephemeral instruction (from slash commands like /ai <instruction>)
  if (ephemeralInstruction) {
    messages.push({ role: 'system', content: `[Turn direction: ${ephemeralInstruction}]` });
  }

  // Turn-taking cue — explicit signal right before the user message
  if (respondAs) {
    if (respondAs === SELF_SPEAKER) {
      messages.push({ role: 'system', content: '[Active turn: user. Draft only the next user-authored message with no speaker prefix.]' });
    } else if (respondAs === NARRATOR_SPEAKER) {
      messages.push({ role: 'system', content: '[Active turn: Narrator. Write only the next narrative beat in prose. Do not use "CharacterName:" prefixes.]' });
    } else {
      const respondChar = chars.find(c =>
        c.fileName === respondAs || (c.frontmatter.name || '').toLowerCase() === String(respondAs).toLowerCase()
      );
      const rName = respondChar ? (respondChar.frontmatter.name || respondChar.fileName.replace('.md', '')) : String(respondAs).replace('.md', '');
      messages.push({ role: 'system', content: `[Active turn: ${rName}. Write only ${rName}'s next turn with no speaker prefix.]` });
    }
  }

  // User message
  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  return {
    messages,
    estimatedTokens: estimateTokens(messages.map((m) => m.content).join('\n')),
    budget,
  };
}

/** Map message author to LLM API role. */
function mapAuthorToRole(author, msg) {
  if (author === 'ai' || author === 'assistant') return 'assistant';
  if (author === 'system') return 'system';
  return 'user';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: THREAD SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

async function createThread(fs, workspaceUri, characterFile, modelId) {
  const id = generateId();
  const settings = await loadSettings(fs, workspaceUri);
  const lorebooks = await scanLorebooks(fs, workspaceUri);
  const threadDir = await ensureNestedDirs(fs, workspaceUri, [
    '.parallx', 'extensions', 'text-generator', 'threads', id,
  ]);

  const meta = {
    id,
    title: 'New Chat',
    characters: [{ file: characterFile, addedAt: Date.now() }],
    writingPreset: settings.defaultWritingPreset || 'immersive-rp',
    lorebookFiles: lorebooks.map((lb) => lb.fileName),
    userName: settings.userName || 'Anon',
    userPlaysAs: null,
    responseLength: null,
    temperatureOverride: null,
    maxTokensOverride: null,
    contextWindowOverride: null,
    modelId,
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
        catch { /* skip corrupted */ }
      }
    }
    return threads.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

async function appendMessage(fs, workspaceUri, threadId, message) {
  const file = resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/messages.jsonl`);
  let existing = '';
  try { existing = (await fs.readFile(file)).content; } catch { /* first msg */ }
  const line = JSON.stringify(message);
  await fs.writeFile(file, existing ? existing + '\n' + line : line);
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
        else if (msg.author === 'ai' && msg.characterFile) msg.name = msg.characterFile.replace('.md', '').replace(/-/g, ' ');
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

  function renderChatList(filter) {
    chatList.innerHTML = '';
    const filtered = filter
      ? allThreads.filter((t) => {
          const q = filter.toLowerCase();
          const characterNames = (t.characters || []).map((c) => c.file || '').join(' ');
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
      row.innerHTML = icon('message-circle', 14);
      const info = el('div', 'tg-chat-row-info');
      info.appendChild(el('div', 'tg-chat-row-title', { text: th.title || 'Untitled' }));
      const charLabel = (th.characters || [])
        .map((c) => (c.file || '').replace('.md', '').replace(/-/g, ' '))
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
    allThreads = await listThreads(fs, workspaceUri);
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
  const stopBtn = el('button', 'tg-input-stop', { html: icon('square', 16) });
  stopBtn.title = 'Stop generating';
  const inputSpacer = el('span', 'tg-input-toolbar-spacer');
  const optionsBtn = el('button', 'tg-input-options-btn', { html: icon('sliders', 16) });
  optionsBtn.title = 'Chat settings';
  const sendBtn = el('button', 'tg-input-send', { html: icon('send', 16) });
  sendBtn.title = 'Send (Enter)';
  inputToolbar.append(stopBtn, inputSpacer, optionsBtn, sendBtn);

  inputCard.append(textarea, inputToolbar);

  // Shortcut buttons bar (Perchance-style quick actions)
  const shortcutBar = el('div', 'tg-shortcut-bar');
  inputWrap.appendChild(shortcutBar);
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

  function getVisibleName(msg) {
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
    tokenCountEl.textContent = lastAssembledContext ? `~${lastAssembledContext.estimatedTokens} tokens` : '';
    stopBtn.style.display = isGenerating ? '' : 'none';
    sendBtn.disabled = isGenerating;
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
    if (thread?.shortcuts && thread.shortcuts.length > 0) return thread.shortcuts;
    // Migrate old customShortcuts format to new shortcuts model
    if (thread?.customShortcuts && thread.customShortcuts.length > 0) {
      const migrated = thread.customShortcuts.map(sc => {
        const type = sc.type || 'ai';
        let message = sc.message || '';
        if (type === 'system') message = `/sys ${message}`;
        else if (type === 'narrator') message = `/nar ${message}`;
        else if (type === 'ai') message = `/ai ${message}`;
        else if (type === 'user') message = `/user ${message}`;
        return { name: `🗣️ ${sc.label}`, message: message.trim(), insertionType: 'replace', autoSend: 'yes', clearAfterSend: 'yes' };
      });
      if (thread) thread.shortcuts = migrated;
      return migrated;
    }
    // Seed defaults matching Perchance's default set
    const defaults = [
      { name: '🗣️ {{char}}', message: '/ai <optional writing instruction>', insertionType: 'replace', autoSend: 'no', clearAfterSend: 'no' },
      { name: '🗣️ {{user}}', message: '/user <optional writing instruction>', insertionType: 'replace', autoSend: 'no', clearAfterSend: 'no' },
      { name: '🗣️ Narrator', message: '/nar <optional writing instruction>', insertionType: 'replace', autoSend: 'no', clearAfterSend: 'no' },
    ];
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

    const charBtn = el('button', 'tg-shortcut-btn', { text: '🗣️ add a character shortcut' });
    charBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
    charBtn.addEventListener('click', () => { overlay.remove(); showAddCharacterShortcutDialog(); });

    const customBtn = el('button', 'tg-shortcut-btn', { text: '✨ add a custom shortcut' });
    customBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
    customBtn.addEventListener('click', () => { overlay.remove(); showAddCustomShortcutDialog(); });

    const bulkBtn = el('button', 'tg-shortcut-btn', { text: '📝 bulk edit/delete shortcuts' });
    bulkBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
    bulkBtn.addEventListener('click', () => { overlay.remove(); showBulkEditShortcutsDialog(); });

    const cancelBtn = el('button', 'tg-shortcut-btn', { text: 'cancel' });
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
      for (const character of characters) {
        const cName = getCharacterName(character);
        const charBtn = el('button', 'tg-shortcut-btn', { text: `🗣️ ${cName}` });
        charBtn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
        charBtn.addEventListener('click', async () => {
          const shortcuts = getThreadShortcuts();
          shortcuts.push({
            name: `🗣️ ${cName}`,
            message: `/ai @${cName} <optional writing instruction>`,
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
    }

    const footer = el('div', 'tg-modal-footer');
    footer.style.cssText = 'display:flex; justify-content:flex-end; padding:8px 16px;';
    const cancelBtn = el('button', 'tg-shortcut-btn', { text: 'cancel' });
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
    body.appendChild(mkField('Shortcut button label (you can use emojis):', labelInput));

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
    const cancelBtn = el('button', 'tg-shortcut-btn', { text: 'cancel' });
    cancelBtn.addEventListener('click', () => overlay.remove());
    const createBtn = el('button', 'tg-shortcut-btn', { text: 'create' });
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
    const cancelBtn = el('button', 'tg-shortcut-btn', { text: 'cancel' });
    cancelBtn.addEventListener('click', () => overlay.remove());
    const saveBtn = el('button', 'tg-shortcut-btn', { text: 'save' });
    saveBtn.style.cssText = 'background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:var(--vscode-button-background);';
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
    const wrapperStyle = primaryChar?.frontmatter?.messageWrapperStyle || '';
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
    const messageEl = el('div', `tg-msg tg-msg--${msg.author || 'system'}${isTransient ? ' tg-msg--streaming' : ''}`);
    const nameRow = el('div', 'tg-msg-name-row');
    nameRow.appendChild(el('span', `tg-msg-name ${getNameColorClass(msg)}`, { text: getVisibleName(msg) }));

    let actions = null;
    if (!isTransient && index !== null) {
      actions = el('div', 'tg-msg-inline-actions');

      const editBtn = el('button', 'tg-msg-action-btn', { html: icon('pencil-line', 13) });
      editBtn.title = 'Edit message';
      editBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const nextText = prompt('Edit message', messageHistory[index]?.content || '');
        if (nextText === null || !messageHistory[index]) return;
        messageHistory[index].content = nextText;
        await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
        renderMessages();
      });
      actions.appendChild(editBtn);

      if (msg.author === 'ai') {
        const regenBtn = el('button', 'tg-msg-action-btn', { html: icon('refresh-cw', 13) });
        regenBtn.title = 'Regenerate this turn';
        regenBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (isGenerating || !messageHistory[index]) return;
          const target = messageHistory[index];
          const speaker = getVisibleName(target).toLowerCase() === 'narrator'
            ? NARRATOR_SPEAKER
            : (target.characterFile || resolveReplySpeaker());
          // Store current content as a variant before regenerating
          if (!target.variants) target.variants = [target.content];
          const variantsBefore = target.variants;
          // Remove this message and everything after it, then regenerate
          messageHistory = messageHistory.slice(0, index);
          await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
          renderMessages();
          await generateTurn({ speaker, instruction: target.instruction || null });
          // After generation, attach previous variants to the new message
          if (messageHistory[index]) {
            const newMsg = messageHistory[index];
            newMsg.variants = [...variantsBefore, newMsg.content];
            newMsg.variantIndex = newMsg.variants.length - 1;
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

            for await (const chunk of stream) {
              if (stopRequested) break;
              if (chunk.content) {
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

      const deleteBtn = el('button', 'tg-msg-action-btn tg-msg-action-btn--danger', { html: icon('trash', 13) });
      deleteBtn.title = 'Delete message';
      deleteBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        messageHistory.splice(index, 1);
        await rewriteMessages(fs, workspaceUri, threadId, messageHistory);
        renderMessages();
        updateChrome();
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

    // Avatar image — resolve from character or user config
    const avatarInfo = getMessageAvatar(msg);
    if (avatarInfo) {
      const img = document.createElement('img');
      img.className = `tg-msg-avatar tg-msg-avatar--${avatarInfo.shape || 'default'}`;
      img.src = avatarInfo.url;
      img.alt = '';
      img.style.width = `${Math.round(36 * (avatarInfo.size || 1))}px`;
      img.style.height = `${Math.round(36 * (avatarInfo.size || 1))}px`;
      img.onerror = () => { img.style.display = 'none'; };
      messageEl.appendChild(img);
    }

    const contentWrap = el('div', 'tg-msg-content-wrap');
    contentWrap.appendChild(nameRow);
    const body = el('div', 'tg-msg-body', { html: renderMessageMarkup(msg.content || '') });
    contentWrap.appendChild(body);
    if (actions) contentWrap.appendChild(actions);
    messageEl.appendChild(contentWrap);
    messagesEl.appendChild(messageEl);
  }

  /**
   * Resolve avatar URL, size, and shape for a message based on author type
   * and primary character config.
   */
  function getMessageAvatar(msg) {
    const primaryChar = characters[0] || null;
    if (!primaryChar) return null;
    const fm = primaryChar.frontmatter || {};

    if (msg.author === 'ai') {
      // Character avatar — check the specific character if multi-char
      const charForMsg = msg.characterFile ? getCharacterByFile(msg.characterFile) : primaryChar;
      const charFm = charForMsg?.frontmatter || fm;
      const url = charFm.avatar || charFm.avatarUrl || '';
      if (!url) return null;
      return { url, size: charFm.avatarSize ?? 1, shape: charFm.avatarShape || 'default' };
    }
    if (msg.author === 'user') {
      const url = fm.userAvatarUrl || '';
      if (!url) return null;
      return { url, size: fm.userAvatarSize ?? 1, shape: fm.userAvatarShape || 'default' };
    }
    if (msg.author === 'system' || msg.author === 'scenario') {
      const url = fm.systemAvatarUrl || '';
      if (!url) return null;
      return { url, size: 1, shape: 'default' };
    }
    return null;
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
    const modelId = selectedModelId || thread?.modelId || models[0]?.id;
    if (!modelId) throw new Error('No model selected');
    const modelInfo = models.find((item) => item.id === modelId);
    const contextWindow = thread?.contextWindowOverride || modelInfo?.contextLength || currentSettings?.defaultContextWindow || 8192;
    const lorebooks = thread?.lorebookFiles?.length
      ? allLorebooks.filter((book) => thread.lorebookFiles.includes(book.fileName))
      : allLorebooks;
    const budget = computeTokenBudget(contextWindow, currentSettings);
    const loreContent = assembleLoreContent(lorebooks, budget.lore);
    const memoryContent = await readMemories(fs, workspaceUri, threadId);
    const assembled = assembleContext({
      characters,
      writingPreset: thread?.writingPreset || currentSettings?.defaultWritingPreset || 'immersive-rp',
      loreContent,
      memoryContent,
      history: historyOverride || messageHistory,
      userMessage: userText,
      contextWindow,
      userName: getUserName(),
      respondAs: speaker,
      responseLength: thread?.responseLength,
      settings: currentSettings,
      ephemeralInstruction: instruction,
    });
    lastAssembledContext = assembled;
    selectedModelId = modelId;
    updateChrome();
    return { assembled, modelId };
  }

  function getGenerationOptions(speaker, asUser = false) {
    const character = !asUser && speaker && speaker !== NARRATOR_SPEAKER ? getCharacterByFile(speaker) : null;
    return {
      temperature: thread?.temperatureOverride ?? character?.frontmatter.temperature ?? currentSettings?.defaultTemperature ?? 0.8,
      maxTokens: thread?.maxTokensOverride ?? character?.frontmatter.maxTokensPerMessage ?? currentSettings?.defaultMaxTokens ?? 2048,
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

  function resolveReplySpeaker(selection = selectedReplySpeaker) {
    if (selection === NARRATOR_SPEAKER) return NARRATOR_SPEAKER;
    if (selection) return selection;
    const lastCharacterTurn = [...messageHistory].reverse().find((msg) => msg.characterFile)?.characterFile;
    return pickNextCharacter(lastCharacterTurn || characters[0]?.fileName);
  }

  function resolveCharacterReference(nameOrFile) {
    const raw = String(nameOrFile || '').trim().replace(/^@/, '');
    if (!raw) return null;
    const lowered = raw.toLowerCase();
    if (lowered === 'narrator' || lowered === 'nar') return NARRATOR_SPEAKER;
    const exact = characters.find((char) =>
      char.fileName.toLowerCase() === lowered ||
      char.fileName.replace('.md', '').toLowerCase() === lowered ||
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

  async function generateTurn({ speaker = null, instruction = null, asUser = false } = {}) {
    if (isGenerating || characters.length === 0 || !parallx.lm) return;
    const effectiveSpeaker = speaker || (asUser ? selectedComposeSpeaker : resolveReplySpeaker());
    if (!effectiveSpeaker) return;

    isGenerating = true;
    stopRequested = false;
    transientMessage = buildGeneratedTurnMessage('', effectiveSpeaker, instruction, asUser);
    renderMessages();
    updateChrome();

    try {
      const { assembled, modelId } = await buildContextForGeneration({
        speaker: effectiveSpeaker,
        instruction,
      });
      const messagesForApi = [...assembled.messages];
      if (asUser) {
        messagesForApi.push({
          role: 'system',
          content: `[Draft the next user-authored message as ${getComposeSelectionLabel(effectiveSpeaker)}. Return only the message content.]`,
        });
      }
      const stream = parallx.lm.sendChatRequest(modelId, messagesForApi, getGenerationOptions(effectiveSpeaker, asUser));
      let fullResponse = '';

      for await (const chunk of stream) {
        if (stopRequested) break;
        if (chunk.content) {
          fullResponse += chunk.content;
          // Strip leading speaker label during streaming
          let display = fullResponse.trimStart();
          const speakerName = transientMessage?.name || '';
          if (speakerName) {
            const prefix = speakerName + ':';
            if (display.startsWith(prefix)) {
              display = display.slice(prefix.length).trimStart();
            } else if (display.toLowerCase().startsWith(prefix.toLowerCase())) {
              display = display.slice(prefix.length).trimStart();
            }
          }
          transientMessage.content = display;
          queueRender();
        }
      }

      if (fullResponse.trim()) {
        // Strip leading speaker label the model may echo (e.g. "Ada Lovelace: ...")
        let cleaned = fullResponse.trim();
        const speakerName = transientMessage?.name || '';
        if (speakerName) {
          const prefix = speakerName + ':';
          if (cleaned.startsWith(prefix)) {
            cleaned = cleaned.slice(prefix.length).trimStart();
          } else if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
            cleaned = cleaned.slice(prefix.length).trimStart();
          }
        }
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
        const nextSpeaker = requestedSpeaker || resolveReplySpeaker();
        await generateTurn({ speaker: nextSpeaker, instruction: cmd.instruction || null });
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
        if (cmd.args || cmd.instruction) {
          const narratorMessage = {
            author: 'system',
            name: 'Narrator',
            content: cmd.instruction || cmd.args,
            timestamp: Date.now(),
            generatedBy: 'human',
            hiddenFrom: null,
          };
          messageHistory.push(narratorMessage);
          await appendMessage(fs, workspaceUri, threadId, narratorMessage);
          renderMessages();
        } else {
          await generateTurn({ speaker: NARRATOR_SPEAKER, instruction: 'Advance the scene with concise third-person narration.' });
        }
        break;
      }
      case 'name': {
        if (cmd.args) {
          thread.userName = cmd.args.trim();
          await updateThreadMeta(fs, workspaceUri, threadId, { userName: thread.userName });
          if (selectedComposeSpeaker === SELF_SPEAKER) renderTurnControls();
          renderMessages();
          updateChrome();
        }
        break;
      }
      case 'mem': {
        try {
          await parallx.editors.openFileEditor(resolveUri(workspaceUri, `${EXT_ROOT}/threads/${threadId}/memories.md`));
        } catch { /* ignore */ }
        break;
      }
      case 'lore': {
        const activeLorebooks = thread?.lorebookFiles?.length
          ? allLorebooks.filter((book) => thread.lorebookFiles.includes(book.fileName))
          : allLorebooks;
        const lorebook = activeLorebooks[0] || allLorebooks[0];
        if (!lorebook) break;
        const lorePath = resolveUri(workspaceUri, `${EXT_ROOT}/lorebooks/${lorebook.fileName}`);
        if (cmd.args) {
          const existing = await fs.readFile(lorePath);
          await fs.writeFile(lorePath, existing.content + `\n\n## ${cmd.args}`);
          allLorebooks = await scanLorebooks(fs, workspaceUri);
        } else {
          try { await parallx.editors.openFileEditor(lorePath); } catch { /* ignore */ }
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
      await generateTurn({ speaker: resolveReplySpeaker(selectedReplySpeaker), instruction: inlineInstruction });
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

    await generateTurn({ speaker: resolveReplySpeaker(selectedReplySpeaker), instruction: inlineInstruction || null });
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
      } catch { /* ignore broken character entries */ }
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
    selectedModelId = thread?.modelId || models[0]?.id || null;
    if (selectedModelId) modelSelect.value = selectedModelId;
  }

  let picsHidden = false;

  /**
   * Show the Perchance-style options menu above the input bar.
   * Items: toggle pics, change user name, change user pic, toggle autoreply,
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

    const item = (emoji, label, handler) => {
      const btn = el('button', 'tg-options-item');
      btn.innerHTML = `<span style="width:20px;text-align:center">${emoji}</span> ${label}`;
      btn.addEventListener('click', () => { dismiss(); handler(); });
      menu.appendChild(btn);
    };

    // ── Toggle pics ──
    item('🚫', picsHidden ? 'show pics' : 'toggle pics', () => {
      picsHidden = !picsHidden;
      messagesEl.querySelectorAll('.tg-msg-avatar').forEach(img => {
        img.style.display = picsHidden ? 'none' : '';
      });
    });

    // ── Change user name ──
    item('📝', 'change user name', async () => {
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
      const cancelBtn2 = el('button', 'tg-shortcut-btn', { text: 'cancel' });
      cancelBtn2.addEventListener('click', () => overlay.remove());
      const saveBtn = el('button', 'tg-shortcut-btn', { text: 'save' });
      saveBtn.style.cssText = 'background:var(--vscode-button-background); color:var(--vscode-button-foreground);';
      saveBtn.addEventListener('click', async () => {
        const newName = nameInput.value.trim() || 'Anon';
        thread.userName = newName;
        await updateThreadMeta(fs, workspaceUri, threadId, { userName: newName }).catch(() => {});
        overlay.remove();
        renderShortcutButtons();
        renderMessages();
      });
      footer.append(cancelBtn2, saveBtn);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
      nameInput.focus();
      nameInput.select();
    });

    // ── Change user pic ──
    item('👤', 'change user pic', async () => {
      const primaryChar = characters[0] || null;
      const currentUrl = primaryChar?.frontmatter?.userAvatarUrl || '';
      const overlay = el('div', 'tg-modal-overlay');
      const modal = el('div', 'tg-modal');
      modal.style.maxWidth = '380px';
      const header = el('div', 'tg-modal-header');
      header.appendChild(el('span', 'tg-modal-title', { text: 'Change User Avatar' }));
      const closeBtn = el('button', 'tg-modal-close', { html: icon('x', 16) });
      closeBtn.addEventListener('click', () => overlay.remove());
      header.appendChild(closeBtn);
      modal.appendChild(header);
      const body = el('div', 'tg-modal-body');
      body.style.cssText = 'padding:16px; display:flex; flex-direction:column; gap:8px;';
      body.appendChild(el('div', null, { text: 'Enter an image URL for your avatar:' }));
      body.querySelector('div').style.cssText = 'font-size:11px; color:var(--vscode-descriptionForeground);';
      const urlInput = el('input');
      urlInput.type = 'text';
      urlInput.value = currentUrl;
      urlInput.placeholder = 'https://example.com/avatar.png';
      urlInput.style.cssText = 'padding:6px 10px; border:1px solid var(--vscode-input-border, #3c3c3c); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-size:12px; width:100%; box-sizing:border-box;';
      body.appendChild(urlInput);
      modal.appendChild(body);
      const footer = el('div', 'tg-modal-footer');
      footer.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; padding:8px 16px;';
      const cancelBtn2 = el('button', 'tg-shortcut-btn', { text: 'cancel' });
      cancelBtn2.addEventListener('click', () => overlay.remove());
      const saveBtn = el('button', 'tg-shortcut-btn', { text: 'save' });
      saveBtn.style.cssText = 'background:var(--vscode-button-background); color:var(--vscode-button-foreground);';
      saveBtn.addEventListener('click', async () => {
        if (primaryChar) {
          primaryChar.frontmatter.userAvatarUrl = urlInput.value.trim();
          const charPath = resolveUri(workspaceUri, `${EXT_ROOT}/characters/${primaryChar.fileName}`);
          await fs.writeFile(charPath, JSON.stringify(primaryChar.rawData ? { ...primaryChar.rawData, userAvatarUrl: urlInput.value.trim() } : primaryChar.frontmatter, null, 2)).catch(() => {});
        }
        overlay.remove();
        renderMessages();
      });
      footer.append(cancelBtn2, saveBtn);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
      urlInput.focus();
    });

    // ── Toggle autoreply ──
    const autoReplyEnabled = thread?.autoReply !== false;
    item('🔄', autoReplyEnabled ? 'disable autoreply' : 'enable autoreply', async () => {
      thread.autoReply = !autoReplyEnabled;
      await updateThreadMeta(fs, workspaceUri, threadId, { autoReply: thread.autoReply }).catch(() => {});
    });

    // ── Response length ──
    item('📏', 'response length...', () => {
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
      const cancelBtn2 = el('button', 'tg-shortcut-btn', { text: 'cancel' });
      cancelBtn2.addEventListener('click', () => overlay.remove());
      const saveBtn = el('button', 'tg-shortcut-btn', { text: 'save' });
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
    item('➕', 'add character', async () => {
      const allChars = await scanCharacters(fs, workspaceUri);
      const available = allChars.filter(c => !thread.characters.find(tc => tc.file === c.fileName));
      if (available.length === 0) return;
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
      for (const char of available) {
        const cName = getCharacterName(char);
        const btn = el('button', 'tg-shortcut-btn', { text: `🗣️ ${cName}` });
        btn.style.cssText = 'width:100%; justify-content:center; padding:8px 16px; font-size:12px;';
        btn.addEventListener('click', async () => {
          thread.characters.push({ file: char.fileName, addedAt: Date.now() });
          await updateThreadMeta(fs, workspaceUri, threadId, { characters: thread.characters }).catch(() => {});
          overlay.remove();
          await reloadThreadState();
        });
        body.appendChild(btn);
      }
      modal.appendChild(body);
      overlay.appendChild(modal);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    });

    // ── Edit character (opens character editor for primary character) ──
    item('✏️', 'edit character', () => {
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
    item('💬', 'reply as...', () => {
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
      const selfBtn = el('button', 'tg-shortcut-btn', { text: `🗣️ ${getUserName()} (yourself)` });
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
        const btn = el('button', 'tg-shortcut-btn', { text: `🗣️ ${cName}` });
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
    item('⚙️', 'options', () => {
      parallx.editors.openEditor({
        typeId: 'text-generator-chat-settings',
        title: 'Chat Settings',
        icon: 'sliders',
        instanceId: threadId,
      });
    });

    root.appendChild(menu);
  }

  optionsBtn.addEventListener('click', () => {
    showOptionsMenu();
  });

  stopBtn.addEventListener('click', () => {
    stopRequested = true;
  });

  async function sendMessage() {
    if (isGenerating || !parallx.lm || characters.length === 0) return;
    const text = textarea.value.trim();
    textarea.value = '';
    textarea.style.height = 'auto';
    if (!text) {
      await generateTurn({ speaker: resolveReplySpeaker(selectedReplySpeaker) });
      return;
    }
    await handleUserInput(text);
  }

  sendBtn.addEventListener('click', sendMessage);
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
  const focusHandler = () => {
    clearTimeout(_focusDebounce);
    _focusDebounce = setTimeout(() => {
      if (!isGenerating) reloadThreadState().catch(() => {});
    }, 300);
  };
  container.addEventListener('focusin', focusHandler);
  fileWatcher = parallx.workspace.onDidFilesChange?.((events) => {
    if (isGenerating) return;
    if (events.some((event) => event.uri.includes('/text-generator/'))) {
      reloadThreadState().catch(() => {});
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
        row.innerHTML = icon('message-circle', 14);
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

  async function refresh() {
    grid.innerHTML = '';

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
      const name = ch.frontmatter.name || ch.fileName.replace('.md', '');
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
          const dupeData = JSON.parse(srcContent);
          const id = generateId().slice(0, 8);
          dupeData.id = 'char-' + id;
          dupeData.name = (dupeData.name || 'Character') + ' (copy)';
          const dupeName = ch.fileName.replace(/\.(json|md)$/, '') + `-copy-${id}.json`;
          await fs.writeFile(resolveUri(dir, dupeName), JSON.stringify(dupeData, null, 2));
          refresh();
        } catch { /* ignore */ }
      });

      const delBtn = el('button', 'tg-card-action tg-card-action--danger');
      delBtn.innerHTML = icon('trash', 12) + ' Delete';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
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

    // Lorebooks sub-section
    const loreSection = el('div', 'tg-page-section');
    loreSection.style.marginTop = '32px';
    loreSection.appendChild(el('div', 'tg-page-section-title', { text: 'Lorebooks' }));
    const loreGrid = el('div', 'tg-card-grid');
    loreSection.appendChild(loreGrid);

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
      const loreCard = el('div', 'tg-card');
      const loreTop = el('div', 'tg-card-top');
      const loreAvatar = el('div', 'tg-card-avatar');
      loreAvatar.innerHTML = icon('book-open', 18);
      loreTop.appendChild(loreAvatar);
      loreTop.appendChild(el('div', 'tg-card-name', { text: lb.fileName.replace('.md', '') }));
      loreCard.appendChild(loreTop);
      loreCard.appendChild(el('div', 'tg-card-desc', {
        text: lb.content.slice(0, 80) + (lb.content.length > 80 ? '\u2026' : ''),
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
          const id = generateId().slice(0, 8);
          const dupeName = lb.fileName.replace('.md', '') + `-copy-${id}.md`;
          await fs.writeFile(resolveUri(dir, dupeName), srcContent);
          refresh();
        } catch { /* ignore */ }
      });
      const loreDel = el('button', 'tg-card-action tg-card-action--danger');
      loreDel.innerHTML = icon('trash', 12) + ' Delete';
      loreDel.addEventListener('click', async (e) => {
        e.stopPropagation();
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

    content.appendChild(loreSection);
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
  defaultMaxTokens: 2048,
  defaultContextWindow: 8192,
  userName: 'Anon',
  defaultWritingPreset: 'immersive-rp',
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
  const charBudget = formGroup('Character prompt', 'Percentage for character definition + system prompt', 'number', 'tokenBudgetCharacter', { min: 5, max: 50 });
  const loreBudget = formGroup('Lore / World info', 'Percentage for lorebook content', 'number', 'tokenBudgetLore', { min: 5, max: 50 });
  const histBudget = formGroup('Chat history', 'Percentage for conversation history', 'number', 'tokenBudgetHistory', { min: 10, max: 60 });
  const userBudget = formGroup('User message', 'Percentage for the current user message', 'number', 'tokenBudgetUser', { min: 10, max: 50 });

  // Defaults section
  const sep = el('div', 'tg-page-section-title', { text: 'Generation Defaults' });
  sep.style.marginTop = '24px';
  form.appendChild(sep);
  const tempInput = formGroup('Temperature', 'Controls randomness (0.0 = deterministic, 2.0 = very random)', 'number', 'defaultTemperature', { min: 0, max: 2, step: 0.1 });
  const maxTokInput = formGroup('Max tokens per response', 'Maximum tokens the model can generate', 'number', 'defaultMaxTokens', { min: 128, max: 16384 });
  const ctxInput = formGroup('Default context window', 'Used when model info is unavailable', 'number', 'defaultContextWindow', { min: 2048, max: 131072 });
  const userNameInput = formGroup('User display name', 'Used in {{user}} template substitution', 'text', 'userName');
  const presetSelect = formGroup('Default writing preset', 'Applied to newly created chats', 'select', 'defaultWritingPreset', {
    options: Object.entries(WRITING_PRESETS).map(([key, p]) => ({ label: p.label, value: key })),
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

  const inputs = { charBudget, loreBudget, histBudget, userBudget, tempInput, maxTokInput, ctxInput, userNameInput };

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
  }

  saveBtn.addEventListener('click', async () => {
    const settings = {
      tokenBudgetCharacter: Number(charBudget.value) || DEFAULT_SETTINGS.tokenBudgetCharacter,
      tokenBudgetLore: Number(loreBudget.value) || DEFAULT_SETTINGS.tokenBudgetLore,
      tokenBudgetHistory: Number(histBudget.value) || DEFAULT_SETTINGS.tokenBudgetHistory,
      tokenBudgetUser: Number(userBudget.value) || DEFAULT_SETTINGS.tokenBudgetUser,
      defaultTemperature: Number(tempInput.value) ?? DEFAULT_SETTINGS.defaultTemperature,
      defaultMaxTokens: Number(maxTokInput.value) || DEFAULT_SETTINGS.defaultMaxTokens,
      defaultContextWindow: Number(ctxInput.value) || DEFAULT_SETTINGS.defaultContextWindow,
      userName: userNameInput.value.trim() || DEFAULT_SETTINGS.userName,
      defaultWritingPreset: presetSelect.value || DEFAULT_SETTINGS.defaultWritingPreset,
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
  function field(labelText, hintText, inputEl) {
    const wrap = el('div', 'tg-ce-field');
    const lbl = el('label', 'tg-ce-label', { text: labelText });
    wrap.appendChild(lbl);
    if (hintText) wrap.appendChild(el('div', 'tg-ce-hint', { text: hintText }));
    wrap.appendChild(inputEl);
    return wrap;
  }

  // ── Basic fields ──
  const nameInput = el('input', 'tg-ce-input');
  nameInput.placeholder = 'Character name';
  root.appendChild(field('🎭 Character name', null, nameInput));

  const roleInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--tall');
  roleInput.placeholder = 'Include the most important details first. Also, it\'s a good idea to include example dialogue if you can — show the AI how you want the character to speak.';
  root.appendChild(field(
    '🐾 Character description/personality/instruction/role',
    'This should ideally be less than 1000 words. You can write {{user}} to refer to the user\'s name.',
    roleInput,
  ));

  const avatarInput = el('input', 'tg-ce-input');
  avatarInput.placeholder = '(optional) path or URL to character avatar image';
  root.appendChild(field('🧑 Character avatar image URL', null, avatarInput));

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
  root.appendChild(field('📏 Strict message length limit', 'Try setting this to one paragraph if the character keeps undesirably talking/acting on your behalf.', lengthSelect));

  const userNameInput = el('input', 'tg-ce-input');
  userNameInput.placeholder = '(optional)';
  root.appendChild(field('User\'s name', 'This overrides the user\'s default username when creating a new chat thread with this character.', userNameInput));

  const userDescInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--short');
  userDescInput.placeholder = '(optional)';
  root.appendChild(field('User\'s description/role', 'What role do you, the user, play when talking to this character? This overrides the user\'s default description.', userDescInput));

  const userAvatarInput = el('input', 'tg-ce-input');
  userAvatarInput.placeholder = '(optional) path or URL';
  root.appendChild(field('User\'s avatar pic URL', null, userAvatarInput));

  root.appendChild(el('hr', 'tg-ce-separator'));

  const reminderInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--short');
  reminderInput.placeholder = '(optional) e.g. "Responses should be short and creative. Always stay in character."';
  root.appendChild(field(
    '🟢 Character reminder note',
    'Remind the AI of important things, writing tips, and so on. Use this for important stuff that the AI often forgets. Try to keep this under 100 words — i.e. about a paragraph at most.',
    reminderInput,
  ));

  const presetSelect = el('select', 'tg-ce-select');
  for (const [key, p] of Object.entries(WRITING_PRESETS)) {
    const o = el('option', null, { text: p.label });
    o.value = key;
    presetSelect.appendChild(o);
  }
  root.appendChild(field(
    '✏️ General writing instructions',
    'These instructions apply to the whole chat, regardless of which character is currently speaking. It\'s for defining general writing style and the "type of experience".',
    presetSelect,
  ));

  const initialMsgInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--tall');
  initialMsgInput.placeholder = '[USER]: hey\n[AI]: um hi\n[SYSTEM; hiddenFrom=ai]: The AI can\'t see this message. Useful for user instructions / welcome messages / credits / etc.';
  root.appendChild(field(
    '⚫ Initial chat messages',
    'You can use this to teach the AI how this character typically speaks, and/or to define an initial scenario. Follow the "[AI]: ... [USER]: ..." format.',
    initialMsgInput,
  ));

  // ── "show more settings" / collapsed section ──
  const moreBtn = el('button', 'tg-ce-more-btn', { text: 'show more settings' });
  root.appendChild(moreBtn);
  const moreSection = el('div', 'tg-ce-more-section');
  root.appendChild(moreSection);

  moreBtn.addEventListener('click', () => {
    const visible = moreSection.classList.toggle('tg-ce-more-section--visible');
    moreBtn.textContent = visible ? 'hide more settings' : 'show more settings';
  });

  // ── More Settings fields ──
  const userReminderInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--short');
  userReminderInput.placeholder = '(optional) e.g. "Responses should be short and creative. Always stay in character."';
  moreSection.appendChild(field(
    '🟡 User reminder note',
    'In case you get the AI to write on your behalf, this is the reminder note used in that case.',
    userReminderInput,
  ));

  const msgStyleInput = el('input', 'tg-ce-input');
  msgStyleInput.placeholder = 'e.g. color:blue; font-size:90%;';
  moreSection.appendChild(field(
    '🎨 Default message style (color, font, size, etc.)',
    'Try adding CSS like color:blue; font-size:90%. This customizes message bubble appearance.',
    msgStyleInput,
  ));

  moreSection.appendChild(el('hr', 'tg-ce-separator'));

  // Lorebooks
  const loreTextarea = el('textarea', 'tg-ce-textarea tg-ce-textarea--short');
  loreTextarea.placeholder = 'lorebook1.md\nlorebook2.md';
  moreSection.appendChild(field(
    '📚 Lorebook files',
    'One lorebook file name per line. These are from the lorebooks/ folder.',
    loreTextarea,
  ));

  // Context method
  const fitSelect = el('select', 'tg-ce-select');
  for (const opt of [
    { value: 'dropOld', label: 'drop oldest messages' },
    { value: 'summarizeOld', label: 'summarize oldest messages' },
  ]) {
    const o = el('option', null, { text: opt.label });
    o.value = opt.value;
    fitSelect.appendChild(o);
  }
  moreSection.appendChild(field('Method for fitting messages within model\'s context limit', null, fitSelect));

  // Extended memory
  const memorySelect = el('select', 'tg-ce-select');
  for (const opt of [
    { value: 'false', label: 'Long-term memory disabled' },
    { value: 'true', label: 'Long-term memory enabled' },
  ]) {
    const o = el('option', null, { text: opt.label });
    o.value = opt.value;
    memorySelect.appendChild(o);
  }
  moreSection.appendChild(field('🔮 Extended character memory', 'AI response will be slower, but often smarter.', memorySelect));

  moreSection.appendChild(el('hr', 'tg-ce-separator'));

  // Avatar settings row
  const avatarRow = el('div', 'tg-ce-row');
  const avatarSizeInput = el('input', 'tg-ce-input');
  avatarSizeInput.type = 'number';
  avatarSizeInput.min = '0.5';
  avatarSizeInput.max = '3';
  avatarSizeInput.step = '0.25';
  avatarRow.appendChild(field('Character\'s avatar pic size', 'A multiplier (1 = default, 2 = 2x).', avatarSizeInput));
  const avatarShapeSelect = el('select', 'tg-ce-select');
  for (const opt of ['default', 'square', 'circle']) {
    const o = el('option', null, { text: opt });
    o.value = opt;
    avatarShapeSelect.appendChild(o);
  }
  avatarRow.appendChild(field('Character\'s avatar shape', null, avatarShapeSelect));
  moreSection.appendChild(avatarRow);

  const userAvatarRow = el('div', 'tg-ce-row');
  const userAvatarSizeInput = el('input', 'tg-ce-input');
  userAvatarSizeInput.type = 'number';
  userAvatarSizeInput.min = '0.5';
  userAvatarSizeInput.max = '3';
  userAvatarSizeInput.step = '0.25';
  userAvatarRow.appendChild(field('User\'s avatar pic size', null, userAvatarSizeInput));
  const userAvatarShapeSelect = el('select', 'tg-ce-select');
  for (const opt of ['default', 'square', 'circle']) {
    const o = el('option', null, { text: opt });
    o.value = opt;
    userAvatarShapeSelect.appendChild(o);
  }
  userAvatarRow.appendChild(field('User\'s avatar shape', null, userAvatarShapeSelect));
  moreSection.appendChild(userAvatarRow);

  moreSection.appendChild(el('hr', 'tg-ce-separator'));

  // Shortcut buttons
  const shortcutInput = el('textarea', 'tg-ce-textarea');
  shortcutInput.placeholder = '@name= 🗣️ {{char}}\n@message=/ai <optional writing instruction>\n@insertionType=replace\n@autoSend=no\n\n@name= 🗣️ {{user}}\n@message=/user <optional writing instruction>\n@insertionType=replace\n@autoSend=no';
  moreSection.appendChild(field(
    '👆 Shortcut buttons (above reply box)',
    'Leave this empty to use the defaults. See Perchance format.',
    shortcutInput,
  ));

  moreSection.appendChild(el('hr', 'tg-ce-separator'));

  // System name, system avatar, placeholder
  const sysNameInput = el('input', 'tg-ce-input');
  sysNameInput.placeholder = '(optional)';
  moreSection.appendChild(field('System\'s name', null, sysNameInput));

  const sysAvatarInput = el('input', 'tg-ce-input');
  sysAvatarInput.placeholder = '(optional)';
  moreSection.appendChild(field('System\'s avatar pic URL', null, sysAvatarInput));

  const placeholderInput = el('input', 'tg-ce-input');
  placeholderInput.placeholder = 'e.g. "Type your reply to {{char}} here..."';
  moreSection.appendChild(field('Message input placeholder', null, placeholderInput));

  // Example dialogue (at the bottom of more section)
  moreSection.appendChild(el('hr', 'tg-ce-separator'));
  const exampleInput = el('textarea', 'tg-ce-textarea tg-ce-textarea--tall');
  exampleInput.placeholder = '[USER]: How are you?\n[AI]: I\'m doing well, thank you for asking!';
  moreSection.appendChild(field(
    '💬 Example dialogue',
    'Example conversations that teach the AI the character\'s speaking style. Use [AI]: and [USER]: format.',
    exampleInput,
  ));

  // Temperature & max tokens
  const genRow = el('div', 'tg-ce-row');
  const tempInput = el('input', 'tg-ce-input');
  tempInput.type = 'number';
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  genRow.appendChild(field('Temperature', 'LLM creativity (0-2). Default: 0.8', tempInput));
  const maxTokInput = el('input', 'tg-ce-input');
  maxTokInput.type = 'number';
  maxTokInput.min = '64';
  genRow.appendChild(field('Max tokens per message', 'Max token budget per reply. Default: 2048', maxTokInput));
  moreSection.appendChild(genRow);

  // ── Footer: cancel + save ──
  const footer = el('div', 'tg-ce-footer');
  const cancelBtn = el('button', 'tg-ce-cancel-btn', { text: 'cancel' });
  const savedLabel = el('span', 'tg-ce-saved', { text: 'Saved!' });
  const saveBtn = el('button', 'tg-ce-save-btn', { text: 'save character' });
  footer.append(cancelBtn, savedLabel, saveBtn);
  root.appendChild(footer);

  let charData = null;

  // ── Populate form from loaded data ──
  function populateForm(data) {
    nameInput.value = data.name || '';
    roleInput.value = data.roleInstruction || '';
    avatarInput.value = data.avatarUrl || '';
    lengthSelect.value = data.messageLengthLimit || '';
    userNameInput.value = data.userName || '';
    userDescInput.value = data.userDescription || '';
    userAvatarInput.value = data.userAvatarUrl || '';
    reminderInput.value = data.reminder || '';
    presetSelect.value = data.writingPreset || 'immersive-rp';
    initialMsgInput.value = data.initialMessages || '';
    userReminderInput.value = data.userReminder || '';
    msgStyleInput.value = data.messageWrapperStyle || '';
    loreTextarea.value = (data.lorebookFiles || []).join('\n');
    fitSelect.value = data.fitMessagesInContextMethod || 'dropOld';
    memorySelect.value = String(data.extendedMemory || false);
    avatarSizeInput.value = data.avatarSize ?? 1;
    avatarShapeSelect.value = data.avatarShape || 'default';
    userAvatarSizeInput.value = data.userAvatarSize ?? 1;
    userAvatarShapeSelect.value = data.userAvatarShape || 'default';
    shortcutInput.value = data.shortcutButtons || '';
    sysNameInput.value = data.systemName || '';
    sysAvatarInput.value = data.systemAvatarUrl || '';
    placeholderInput.value = data.messageInputPlaceholder || '';
    exampleInput.value = data.exampleDialogue || '';
    tempInput.value = data.temperature ?? 0.8;
    maxTokInput.value = data.maxTokensPerMessage ?? 2048;
  }

  // ── Collect form into data object ──
  function collectForm() {
    const loreLines = loreTextarea.value.trim().split('\n').map(l => l.trim()).filter(Boolean);
    return {
      ...charData,
      name: nameInput.value.trim() || 'Unnamed',
      roleInstruction: roleInput.value,
      avatarUrl: avatarInput.value.trim(),
      messageLengthLimit: lengthSelect.value,
      userName: userNameInput.value.trim(),
      userDescription: userDescInput.value,
      userAvatarUrl: userAvatarInput.value.trim(),
      reminder: reminderInput.value,
      writingPreset: presetSelect.value || 'immersive-rp',
      initialMessages: initialMsgInput.value,
      userReminder: userReminderInput.value,
      messageWrapperStyle: msgStyleInput.value.trim(),
      lorebookFiles: loreLines,
      fitMessagesInContextMethod: fitSelect.value || 'dropOld',
      extendedMemory: memorySelect.value === 'true',
      avatarSize: Number(avatarSizeInput.value) || 1,
      avatarShape: avatarShapeSelect.value || 'default',
      userAvatarSize: Number(userAvatarSizeInput.value) || 1,
      userAvatarShape: userAvatarShapeSelect.value || 'default',
      shortcutButtons: shortcutInput.value,
      systemName: sysNameInput.value.trim(),
      systemAvatarUrl: sysAvatarInput.value.trim(),
      messageInputPlaceholder: placeholderInput.value.trim(),
      exampleDialogue: exampleInput.value,
      temperature: Number(tempInput.value) || 0.8,
      maxTokensPerMessage: Number(maxTokInput.value) || 2048,
    };
  }

  saveBtn.addEventListener('click', async () => {
    const data = collectForm();
    await saveCharacter(fs, workspaceUri, charFileName, data);
    charData = data;
    savedLabel.classList.add('tg-ce-saved--show');
    setTimeout(() => savedLabel.classList.remove('tg-ce-saved--show'), 2000);
    _refreshSidebar?.();
  });

  cancelBtn.addEventListener('click', () => {
    // Re-populate from last saved data to discard changes
    if (charData) populateForm(charData);
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
    populateForm(charData);
    subtitleEl.textContent = charData.name || charFileName;
  }

  init();
  return { dispose() { container.innerHTML = ''; } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10E: PER-CHAT SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════════════════

function renderChatSettingsPage(container, parallx, input) {
  injectStyles();

  const fs = parallx.workspace?.fs;
  const workspaceUri = parallx.workspace?.workspaceFolders?.[0]?.uri;
  const threadId = input?.instanceId || input?.id;

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

  const loreTitle = el('div', 'tg-cs-section-title', { text: 'Lorebooks' });
  loreTitle.style.marginTop = '16px';
  contextSection.appendChild(loreTitle);
  contextSection.appendChild(el('div', 'tg-cs-hint', { text: 'Only selected lorebooks are injected into this chat.' }));
  const loreChipList = el('div', 'tg-cs-chip-list');
  contextSection.appendChild(loreChipList);
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
      const label = item.frontmatter?.name || item.fileName.replace('.md', '');
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
      lorebookFiles: collectActiveFiles(loreChipList),
      modelId: modelSelect.value || thread.modelId,
      temperatureOverride: tempInput.value.trim() ? Number(tempInput.value) : null,
      maxTokensOverride: maxTokensInput.value.trim() ? Number(maxTokensInput.value) : null,
      contextWindowOverride: contextInput.value.trim() ? Number(contextInput.value) : null,
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

    modelSelect.innerHTML = '';
    if (models.length > 0) {
      for (const model of models) {
        const option = el('option', null, { text: model.displayName || model.id });
        option.value = model.id;
        modelSelect.appendChild(option);
      }
      modelSelect.value = thread.modelId || models[0].id;
    } else {
      const option = el('option', null, { text: thread.modelId || 'Ollama offline' });
      option.value = thread.modelId || '';
      modelSelect.appendChild(option);
    }

    tempInput.value = thread.temperatureOverride ?? '';
    maxTokensInput.value = thread.maxTokensOverride ?? '';
    contextInput.value = thread.contextWindowOverride ?? '';
    lengthSelect.value = thread.responseLength || '';

    renderCharacterChips();
    populatePersonaOptions();
    renderToggleChips(loreChipList, allLorebooks, new Set(thread.lorebookFiles || []));
  }

  init();
  return { dispose() { container.innerHTML = ''; } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

const CHARACTER_TEMPLATE = `---
name: New Character
temperature: 0.8
maxTokensPerMessage: 2048
writingPreset: immersive-rp
---

Describe your character's personality, backstory, speaking style, and behavior here.
Everything in this section becomes the character's core instructions.
Use {{char}} to refer to the character and {{user}} to refer to the user.

{{char}} acts and speaks in character at all times. {{char}} never references being an AI.

## Reminder

A short reminder placed near the end of context to reinforce character behavior.

## Initial Messages

[AI]: Hello! I'm {{char}}. Edit my .md file to give me a personality!

## Example Dialogue

[USER]: How are you?
[AI]: I'm doing well, thank you for asking!
`;

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
- Dialogue in "quotes", actions in *asterisks*
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
};

function getPresetContent(presetKey) {
  return WRITING_PRESETS[presetKey]?.content || WRITING_PRESETS['immersive-rp'].content;
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

  const exampleChar = resolveUri(workspaceUri, `${EXT_ROOT}/characters/ada-lovelace.md`);
  if (!(await fs.exists(exampleChar))) {
    await fs.writeFile(exampleChar, EXAMPLE_CHARACTER);
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
maxTokensPerMessage: 2048
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
