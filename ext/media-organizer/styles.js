// styles.js — the Media Organizer stylesheet's later sections (the duplicate
// finder through the Media Gallery block), split out of main.js, which joins
// them onto MO_CSS. Same text, same order.

export const MO_CSS_MORE = `
.mo-hidden { display: none !important; }
/* Duplicate finder */
.mo-dup-dialog { width: 800px; max-width: 96vw; }
.mo-dup-body { padding: 12px 16px; max-height: 70vh; overflow-y: auto; }
.mo-dup-summary { font-size: 12px; opacity: 0.8; margin-bottom: 12px; }
.mo-dup-group {
  border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
  border-radius: 4px; padding: 8px; margin-bottom: 10px;
}
.mo-dup-group-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
.mo-dup-group-label { font-weight: 600; }
.mo-dup-group-count { opacity: 0.7; }
.mo-dup-list { display: flex; flex-direction: column; gap: 4px; }
.mo-dup-row {
  display: grid; grid-template-columns: auto 1fr; gap: 8px;
  align-items: center; padding: 4px 6px;
}
.mo-dup-name { font-size: 12px; }
.mo-dup-meta { font-size: 11px; opacity: 0.6; }
.mo-dup-actions { margin-top: 8px; display: flex; justify-content: flex-end; }
.mo-dup-empty { padding: 24px; text-align: center; color: var(--px-text-muted); }

/* ═══ Home feed (Section 26B) ═══ */
.mo-home-title { font-size: 15px; font-weight: 600; }
.mo-home-sub { font-size: 11px; opacity: 0.7; }
.mo-home-chips { display: flex; gap: 4px; }
.mo-home-chip { border: 1px solid var(--vscode-panel-border, var(--px-border)); background: transparent; color: inherit; border-radius: 999px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
.mo-home-chip:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.mo-home-chip.active { background: var(--vscode-badge-background, var(--px-accent)); color: var(--vscode-badge-foreground, #fff); border-color: transparent; }
.mo-feed { display: flex; gap: 10px; padding: var(--px-space-1) var(--px-space-6) var(--px-space-8); align-items: flex-start; }
/* Grouped by date: a section per group, each with its own columns. */
.mo-feed.mo-feed--grouped { flex-direction: column; align-items: stretch; gap: var(--px-space-6); }
.mo-feed-group { display: flex; flex-direction: column; gap: var(--px-space-2); }
.mo-feed-group-header { margin: 0; font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.mo-feed-cols { display: flex; gap: 10px; align-items: flex-start; }
/* Library in a compact pane: search gets its own row, the header's action
   keeps its icon and tooltip only, and the edges come in. */
@container mo-grid (max-width: 719px) {
  .mo-grid-browser > .mo-page-header { padding: var(--px-space-4) var(--px-space-3) var(--px-space-2); }
  .mo-page-header .px-btn--primary .px-btn__label { display: none; }
  .mo-page-header .px-btn--primary { width: var(--px-control-h); padding: 0; justify-content: center; }
  .mo-toolbar, .mo-filter-chip-bar { padding-left: var(--px-space-3); padding-right: var(--px-space-3); }
  .mo-toolbar .mo-search-wrap { flex-basis: 100%; max-width: none; order: -1; }
  .mo-toolbar .mo-filters-btn .px-btn__label,
  .mo-toolbar .mo-menu-btn .mo-menu-btn-label { display: none; }
  .mo-feed { padding-left: var(--px-space-3); padding-right: var(--px-space-3); }
}
.mo-feed-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.mo-feed-card { position: relative; width: 100%; border-radius: var(--parallx-radius-md, 6px); overflow: hidden; background: var(--vscode-input-background, var(--px-bg-inset)); cursor: pointer; }
.mo-feed-card img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform var(--px-dur-slow, 260ms) var(--px-ease, ease); }
.mo-feed-card:hover img { transform: scale(1.02); }
.mo-feed-card--loading { background: linear-gradient(100deg, var(--px-bg-inset, rgba(128,128,128,0.10)) 30%, var(--px-bg, rgba(128,128,128,0.20)) 50%, var(--px-bg-inset, rgba(128,128,128,0.10)) 70%); background-size: 200% 100%; animation: mo-skeleton-shimmer 1.3s ease-in-out infinite; }
.mo-feed-card--missing { display: flex; align-items: center; justify-content: center; opacity: 0.6; }
.mo-feed-badge { position: absolute; top: 6px; right: 6px; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; letter-spacing: 0.3px; background: rgba(0,0,0,0.6); color: #fff; pointer-events: none; }
.mo-feed-cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 10px 8px; background: linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0)); color: #fff; opacity: 0; transition: opacity var(--px-dur-fast, 120ms) var(--px-ease, ease); pointer-events: none; }
.mo-feed-card:hover .mo-feed-cap, .mo-feed-card:focus-within .mo-feed-cap, [data-input-modality="touch"] .mo-feed-card .mo-feed-cap { opacity: 1; }
.mo-feed-cap-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-feed-cap-sub { font-size: 11px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-feed-sentinel { height: 1px; }
.mo-feed-sentinel.is-loading { height: 40px; }
.mo-feed-empty { padding: 40px; text-align: center; color: var(--px-text-muted); font-size: 13px; }
/* Selection in the feed: a circle on hover, every circle while selecting; a picked tile shrinks in its cell with the accent around it, so nothing reflows. */
.mo-feed-card { transition: transform 120ms ease, box-shadow 120ms ease; }
.mo-feed-pick { position: absolute; top: 8px; left: 8px; width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid var(--vscode-editor-background, var(--px-bg)); background: color-mix(in srgb, var(--vscode-editor-background, var(--px-bg)) 55%, transparent); color: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: opacity 120ms ease; z-index: 2; }
.mo-feed-card:hover .mo-feed-pick, .mo-feed.is-selecting .mo-feed-pick, .mo-feed-card:focus-within .mo-feed-pick, [data-input-modality="touch"] .mo-feed-card .mo-feed-pick { opacity: 1; }
.mo-feed-pick:hover { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.mo-feed-card.is-selected .mo-feed-pick { opacity: 1; background: var(--vscode-focusBorder, var(--px-accent)); border-color: var(--vscode-focusBorder, var(--px-accent)); color: var(--vscode-button-foreground, #fff); }
.mo-feed-card.is-selected { transform: scale(0.94); box-shadow: 0 0 0 3px var(--vscode-focusBorder, var(--px-accent)); }
.mo-feed-card.is-selected:hover img { transform: none; }
.mo-type-chips { display: flex; gap: 4px; }
.mo-drop-import { outline: 2px dashed var(--vscode-focusBorder, var(--px-accent)); outline-offset: -6px; }
@media (prefers-reduced-motion: reduce) {
  .mo-feed-card img, .mo-feed-cap, .mo-feed-card { transition: none; }
  .mo-feed-card:hover img { transform: none; }
}


/* ═══ Similar photos strip (Section 29B) ═══ */
.mo-detail-main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.mo-detail-main > .mo-detail-preview { min-height: 0; }
.mo-similar { flex: 0 0 auto; border-top: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-sideBar-background, var(--px-bg)); padding: 8px 12px 10px; }
.mo-similar-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.mo-similar-title { font-size: 11px; font-weight: 600; text-transform: none; letter-spacing: normal; opacity: 0.8; }
.mo-similar-hint { font-size: 11px; opacity: 0.7; margin-left: auto; }
.mo-similar-link { background: none; border: none; color: var(--vscode-textLink-foreground, var(--px-accent)); cursor: pointer; font-size: 11px; padding: 0; }
.mo-similar-link:hover { text-decoration: underline; }
.mo-similar-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.mo-similar-card { flex: 0 0 auto; width: 128px; height: 96px; border-radius: var(--parallx-radius-sm, 4px); overflow: hidden; background: var(--vscode-input-background, var(--px-bg-inset)); cursor: pointer; border: 1px solid transparent; }
.mo-similar-card:hover { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.mo-similar-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mo-similar-status { font-size: 11px; opacity: 0.7; }
/* Tag names are stored in capitals (docs/AI_TAGGING.md); inputs that name a
   tag show them that way while typing. Placeholders stay as written. */
.mo-tag-name-input { text-transform: uppercase; }
.mo-tag-name-input::placeholder { text-transform: none; }
.mo-sidebar-item-count:empty { display: none; }
/* SECTION 43: Tag Review */
.mo-tr-page { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--vscode-editor-background, var(--px-bg)); color: var(--vscode-foreground, var(--px-text)); }
.mo-tr-head { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); flex-wrap: wrap; }
.mo-tr-title-wrap { display: flex; flex-direction: column; min-width: 0; margin-right: auto; }
.mo-tr-title { font-size: 15px; font-weight: 600; }
.mo-tr-sub { font-size: 11px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-tr-sub.is-error { color: var(--vscode-errorForeground, var(--px-text)); }
.mo-tr-actions-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mo-tr-opt { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; margin-right: 4px; }
.mo-tr-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--vscode-panel-border, var(--px-border)); background: transparent; color: inherit; border-radius: var(--parallx-radius-md, 6px); padding: 4px 12px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.mo-tr-btn:hover:not(:disabled) { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.mo-tr-btn:disabled { opacity: 0.5; cursor: default; }
.mo-tr-btn.has-rules { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.mo-tr-btn.is-on { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.mo-tr-rules { display: flex; flex-direction: column; gap: 4px; padding: 8px 14px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); }
.mo-tr-rules-box { width: 100%; box-sizing: border-box; resize: vertical; min-height: 88px; font: inherit; font-size: 12px; line-height: 1.45; padding: 6px 8px; border: 1px solid var(--vscode-panel-border, var(--px-border)); border-radius: var(--parallx-radius-md, 6px); background: var(--vscode-input-background, var(--px-bg-inset)); color: inherit; outline: none; }
.mo-tr-rules-box:focus { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.mo-tr-rules-status { font-size: 11px; min-height: 14px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-tr-btn.primary { background: var(--vscode-button-background, var(--px-accent)); color: var(--vscode-button-foreground, var(--px-text)); border-color: transparent; }
.mo-tr-btn.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, var(--vscode-button-background, var(--px-accent))); }
.mo-tr-progress { flex-basis: 100%; height: 3px; border-radius: 2px; overflow: hidden; background: var(--vscode-input-background, var(--px-bg-inset)); }
.mo-tr-progress-fill { height: 100%; width: 0; background: var(--vscode-button-background, var(--px-accent)); transition: width var(--px-dur-slow, 260ms) var(--px-ease, ease); }
.mo-tr-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.mo-tr-list { display: flex; flex-direction: column; }
.mo-tr-row { display: grid; grid-template-columns: 132px minmax(0, 1fr) auto; gap: 14px; align-items: start; padding: 12px 14px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); }
.mo-tr-row.is-queued, .mo-tr-row.is-running { opacity: 0.75; }
.mo-tr-thumb { width: 132px; height: 99px; border-radius: var(--parallx-radius-sm, 3px); overflow: hidden; background: var(--vscode-input-background, var(--px-bg-inset)); cursor: zoom-in; }
.mo-tr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mo-tr-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mo-tr-name-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mo-tr-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-tr-status { flex-shrink: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.3px; padding: 1px 6px; border-radius: 3px; background: var(--vscode-badge-background, var(--px-bg-elevated)); color: var(--vscode-badge-foreground, var(--px-text)); }
.mo-tr-status.is-failed { background: transparent; color: var(--vscode-errorForeground, var(--px-text)); border: 1px solid var(--vscode-errorForeground, var(--px-border)); }
.mo-tr-note { font-size: 11px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-tr-replaced { text-decoration: line-through; }
.mo-tr-status.is-retag { background: transparent; color: var(--vscode-focusBorder, var(--px-accent)); border: 1px solid var(--vscode-focusBorder, var(--px-accent)); }
.mo-tr-error { font-size: 11px; color: var(--vscode-errorForeground, var(--px-text)); }
.mo-tr-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.mo-tr-chip { display: inline-flex; align-items: center; max-width: 100%; padding: 2px 4px 2px 8px; border-radius: var(--parallx-radius-sm, 3px); border: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-input-background, var(--px-bg-inset)); font-size: 11px; line-height: 16px; }
.mo-tr-chip-path { color: var(--vscode-descriptionForeground, var(--px-text-secondary)); white-space: pre; }
.mo-tr-chip-leaf { font-weight: 600; }
.mo-tr-chip button { border: none; background: transparent; color: inherit; cursor: pointer; padding: 0 4px; margin-left: 2px; font-size: 13px; line-height: 1; opacity: 0.6; }
.mo-tr-chip button:hover { opacity: 1; }
.mo-tr-add-input { width: 170px; box-sizing: border-box; background: var(--vscode-input-background, var(--px-bg)); color: var(--vscode-input-foreground, var(--vscode-foreground, var(--px-text))); border: 1px solid var(--vscode-input-border, var(--px-bg-elevated)); border-radius: var(--parallx-radius-sm, 3px); padding: 3px 6px; font-size: 11px; }
.mo-tr-add-input:focus { border-color: var(--vscode-focusBorder, var(--px-accent, var(--mo-accent))); outline: none; }
.mo-tr-row-actions { display: flex; flex-direction: column; gap: 6px; align-items: stretch; min-width: 88px; }
.mo-tr-empty { padding: 48px 14px; text-align: center; font-size: 12px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-tr-suggest { position: fixed; z-index: 10005; min-width: 220px; max-width: 380px; max-height: 240px; overflow-y: auto; padding: 2px 0; background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); border: 1px solid var(--vscode-editorWidget-border, var(--px-border-strong)); border-radius: var(--parallx-radius-sm, 3px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); }
.mo-tr-suggest-item { padding: 4px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-tr-suggest-item:hover, .mo-tr-suggest-item.is-active { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }

/* ── Preview copies and offline folders ── */
.mo-player-preview-note { position: absolute; top: 12px; left: 12px; z-index: 5; padding: 4px 10px; font-size: 11px; border-radius: var(--parallx-radius-sm, 3px); background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); border: 1px solid var(--vscode-editorWidget-border, var(--px-border)); color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-sidebar-item.is-offline { opacity: 0.6; }
.mo-sidebar-item.is-offline .mo-sidebar-item-count { font-style: italic; }
.mo-clip-hint { font-size: 11px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }

/* ── Practice ── */
.mo-practice { position: absolute; inset: 0; background: var(--vscode-editor-background, var(--px-bg)); color: var(--vscode-foreground, var(--px-text)); overflow: hidden; outline: none; user-select: none; }
.mo-practice-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.mo-practice-img { max-width: 100%; max-height: 100%; object-fit: contain; transition: filter 120ms ease; }
.mo-practice-img.is-mirror { transform: scaleX(-1); }
.mo-practice-img.is-grey { filter: grayscale(1); }
.mo-practice-hud { position: absolute; top: 12px; right: 14px; display: flex; align-items: baseline; gap: 10px; padding: 4px 10px; border-radius: var(--parallx-radius-sm, 3px); background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); border: 1px solid var(--vscode-editorWidget-border, var(--px-border)); font-variant-numeric: tabular-nums; }
.mo-practice-clock { font-size: 18px; font-weight: 600; }
.mo-practice-hud.is-low .mo-practice-clock { color: var(--vscode-errorForeground, var(--px-danger)); }
.mo-practice-counter { font-size: 11px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-practice-controls { position: absolute; left: 50%; bottom: 72px; transform: translateX(-50%); display: flex; gap: 4px; padding: 4px; border-radius: var(--parallx-radius-sm, 3px); background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); border: 1px solid var(--vscode-editorWidget-border, var(--px-border)); transition: opacity 160ms ease; }
.mo-practice-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: var(--parallx-radius-sm, 3px); background: transparent; color: var(--vscode-foreground, var(--px-text)); cursor: pointer; }
.mo-practice-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--px-surface-hover)); }
.mo-practice-btn.is-on { background: var(--vscode-button-background, var(--px-accent)); color: var(--vscode-button-foreground, var(--px-text-on-accent)); }
.mo-practice-sep { width: 1px; align-self: stretch; margin: 4px 2px; background: var(--vscode-editorWidget-border, var(--px-border)); }
.mo-practice-strip { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 4px; justify-content: center; padding: 8px 12px; overflow-x: auto; transition: opacity 160ms ease; }
.mo-practice-strip-item { flex: 0 0 auto; width: 44px; height: 44px; border-radius: var(--parallx-radius-sm, 3px); overflow: hidden; border: 2px solid transparent; opacity: 0.7; cursor: pointer; background: var(--px-bg-inset, rgba(128, 128, 128, 0.1)); }
.mo-practice-strip-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mo-practice-strip-item.is-done { opacity: 0.45; }
.mo-practice-strip-item.is-current { opacity: 1; border-color: var(--vscode-focusBorder, var(--px-accent)); }
.mo-practice.is-idle .mo-practice-controls, .mo-practice.is-idle .mo-practice-strip { opacity: 0; pointer-events: none; }
.mo-practice-notice { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); padding: 8px 16px; border-radius: var(--parallx-radius-sm, 3px); background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); border: 1px solid var(--vscode-editorWidget-border, var(--px-border)); font-size: 14px; font-weight: 600; opacity: 0; transition: opacity 200ms ease; pointer-events: none; }
.mo-practice-notice.is-on { opacity: 1; }
.mo-practice-end { position: absolute; inset: 0; overflow-y: auto; padding: 40px 32px; display: flex; flex-direction: column; align-items: center; gap: 18px; background: var(--vscode-editor-background, var(--px-bg)); }
.mo-practice-end-title { font-size: 20px; font-weight: 600; }
.mo-practice-end-sub { font-size: 13px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-practice-end-strip { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; max-width: 900px; }
.mo-practice-end-item { width: 120px; cursor: pointer; }
.mo-practice-end-item img { width: 120px; height: 120px; object-fit: cover; display: block; border-radius: var(--parallx-radius-sm, 3px); background: var(--px-bg-inset, rgba(128, 128, 128, 0.1)); }
.mo-practice-end-item span { display: block; margin-top: 4px; font-size: 11px; text-align: center; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-practice-end-actions { display: flex; gap: 8px; }
.mo-practice-empty { padding: 40px; text-align: center; font-size: 12px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-practice-setup { position: absolute; inset: 0; overflow-y: auto; padding: 20px 24px 32px; background: var(--vscode-editor-background, var(--px-bg)); color: var(--vscode-foreground, var(--px-text)); }
.mo-practice-form { display: flex; flex-direction: column; gap: 12px; max-width: 680px; margin-top: 16px; }
.mo-practice-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mo-practice-label { flex: 0 0 120px; font-size: 12px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-practice-pooldetail { display: inline-flex; flex: 1 1 160px; min-width: 0; }
.mo-practice-pooldetail:empty { display: none; }
.mo-practice-pooldetail .mo-dd { flex: 1 1 auto; }
.mo-practice-summary { font-size: 12px; margin-left: 128px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-practice-poolcount { font-size: 12px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-practice-start { padding: 6px 16px; border: 0; border-radius: var(--parallx-radius-sm, 3px); background: var(--vscode-button-background, var(--px-accent)); color: var(--vscode-button-foreground, var(--px-text-on-accent)); font-size: 12px; font-weight: 600; cursor: pointer; }
.mo-practice-start:hover { background: var(--vscode-button-hoverBackground, var(--px-accent)); }
.mo-practice-start:disabled { opacity: 0.5; cursor: default; }
.mo-practice-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
.mo-practice-section { margin-top: 28px; max-width: 900px; }
.mo-practice-section-title { font-size: 11px; font-weight: 600; text-transform: none; letter-spacing: normal; opacity: 0.8; margin-bottom: 8px; }
.mo-practice-thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
.mo-practice-thumb { width: 96px; cursor: pointer; }
.mo-practice-thumb img { width: 96px; height: 96px; object-fit: cover; display: block; border-radius: var(--parallx-radius-sm, 3px); background: var(--px-bg-inset, rgba(128, 128, 128, 0.1)); }
.mo-practice-thumb span { display: block; margin-top: 3px; font-size: 11px; text-align: center; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-practice-list { display: flex; flex-direction: column; }
.mo-practice-list-row { display: flex; gap: 10px; align-items: center; padding: 6px 8px; font-size: 12px; border-radius: var(--parallx-radius-sm, 3px); cursor: pointer; }
.mo-practice-list-row:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.mo-practice-dim { color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-daily { display: flex; align-items: center; gap: 14px; margin: 0 16px 10px; padding: 10px 12px; border: 1px solid var(--vscode-panel-border, var(--px-border)); border-radius: var(--parallx-radius-sm, 3px); background: var(--vscode-sideBar-background, var(--px-bg-elevated)); }
.mo-daily img { width: 72px; height: 72px; object-fit: cover; border-radius: var(--parallx-radius-sm, 3px); background: var(--px-bg-inset, rgba(128, 128, 128, 0.1)); cursor: pointer; display: block; }
.mo-daily-text { flex: 1 1 auto; min-width: 0; }
.mo-daily-title { font-size: 13px; font-weight: 600; }
.mo-daily-sub { font-size: 12px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); margin-top: 2px; }
.mo-practice-history-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.mo-practice-history-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }

/* ── Painting plans ── */
.mo-plan { position: absolute; inset: 0; display: flex; background: var(--vscode-editor-background, var(--px-bg)); color: var(--vscode-foreground, var(--px-text)); outline: none; }
.mo-plan-tools { flex: 0 0 64px; overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0; border-right: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-sideBar-background, var(--px-bg-elevated)); }
.mo-plan-tool { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: var(--parallx-radius-sm, 3px); background: transparent; color: var(--vscode-foreground, var(--px-text)); cursor: pointer; opacity: 0.75; }
.mo-plan-tools .mo-plan-tool { width: 56px; height: auto; padding: 6px 0 5px; flex-direction: column; gap: 3px; font-size: var(--px-text-2xs); }
.mo-plan-tool:hover { background: var(--vscode-toolbar-hoverBackground, var(--px-surface-hover)); opacity: 1; }
.mo-plan-tool.is-on { background: var(--vscode-button-background, var(--px-accent)); color: var(--vscode-button-foreground, var(--px-text-on-accent)); opacity: 1; }
.mo-plan-panel { flex: 0 0 232px; overflow-y: auto; padding: 10px 12px; border-right: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-sideBar-background, var(--px-bg-elevated)); display: flex; flex-direction: column; gap: 14px; }
.mo-plan-section { display: flex; flex-direction: column; gap: 8px; }
.mo-plan-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mo-plan-hint { font-size: 11px; line-height: 1.4; }
.mo-plan-slider { display: flex; flex-direction: column; gap: 2px; }
.mo-plan-slider-head { display: flex; justify-content: space-between; font-size: 12px; }
.mo-plan-slider input[type="range"] { width: 100%; margin: 0; accent-color: var(--vscode-focusBorder, var(--px-accent)); }
.mo-plan-notes { min-height: 120px; resize: vertical; font: inherit; font-size: 12px; line-height: 1.4; }
.mo-plan-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.mo-plan-topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); }
.mo-plan-topbar-left { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.mo-plan-topbar-right { display: flex; align-items: center; gap: 6px; }
.mo-plan-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-plan-stage { flex: 1 1 auto; min-height: 0; position: relative; display: flex; align-items: center; justify-content: center; padding: 12px; background: var(--px-bg-inset, var(--vscode-editor-background)); }
.mo-plan-frame { position: relative; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35); }
.mo-plan-canvas { display: block; }
.mo-plan-overlay { position: absolute; inset: 0; pointer-events: none; }
.mo-plan-cropbox { position: absolute; border: 1px solid var(--vscode-focusBorder, var(--px-accent)); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5); cursor: move; touch-action: none; }
.mo-plan-crophandle { position: absolute; width: 12px; height: 12px; background: var(--vscode-focusBorder, var(--px-accent)); border: 1px solid rgba(0, 0, 0, 0.5); }
.mo-plan-crophandle--nw { left: -6px; top: -6px; cursor: nwse-resize; }
.mo-plan-crophandle--ne { right: -6px; top: -6px; cursor: nesw-resize; }
.mo-plan-crophandle--sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
.mo-plan-crophandle--se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.mo-plan-variants { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px; overflow-x: auto; border-top: 1px solid var(--vscode-panel-border, var(--px-border)); }
.mo-plan-variant { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 4px; border-radius: var(--parallx-radius-sm, 3px); border: 1px solid transparent; cursor: pointer; font-size: 11px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-plan-variant img { height: 56px; min-width: 24px; display: block; border-radius: 2px; background: var(--px-bg-inset, rgba(128, 128, 128, 0.1)); }
.mo-plan-variant:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.mo-plan-variant.is-current { border-color: var(--vscode-focusBorder, var(--px-accent)); color: var(--vscode-foreground, var(--px-text)); }
.mo-plan-variant-actions { display: flex; gap: 6px; margin-left: auto; flex: 0 0 auto; }
.mo-plan-variants { flex-wrap: wrap; row-gap: 6px; overflow-x: hidden; }
.mo-pv-list { display: flex; gap: 8px; flex: 0 1 auto; min-width: 72px; overflow-x: auto; }
.px-btn.mo-plan-variant { height: auto; flex: 0 0 auto; flex-direction: column; gap: 3px; padding: 4px; }
.mo-pv-status { flex: 1 1 160px; min-width: 0; font-size: var(--px-text-xs); }
.mo-plan-variants .mo-plan-variant-actions { flex-wrap: wrap; }
.mo-plan-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.mo-plan-swatch { width: 28px; height: 28px; border-radius: var(--parallx-radius-sm, 3px); border: 1px solid rgba(0, 0, 0, 0.35); cursor: pointer; }
/* Painting Plans: stages, the colour picker, saved colours and paint mixes (plan-colours.js) */
.mo-pc-stagebar { display: flex; justify-content: center; align-self: center; max-width: 100%; margin: var(--px-space-2) var(--px-space-3) 0; overflow-x: auto; }
.mo-pc-stages { display: flex; flex-direction: column; gap: var(--px-space-1); }
.mo-pc-stages .mo-pc-stage { width: 100%; height: auto; justify-content: flex-start; display: flex; align-items: center; gap: var(--px-space-2); padding: var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: transparent; color: var(--px-text); font: inherit; text-align: left; cursor: pointer; }
.mo-pc-stages .mo-pc-stage:hover { background: var(--px-surface-hover); }
.mo-pc-stages .mo-pc-stage.is-on { border-color: var(--px-accent); background: var(--px-accent-soft); }
.mo-pc-stage-num { flex: none; width: 20px; height: 20px; border-radius: var(--px-radius-full); display: inline-flex; align-items: center; justify-content: center; background: var(--px-surface-active); font-size: var(--px-text-xs); font-weight: 700; }
.mo-pc-stage.is-on .mo-pc-stage-num { background: var(--px-accent); color: var(--px-text-on-accent); }
.mo-pc-stage-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.mo-pc-stage-name { font-size: var(--px-text-sm); font-weight: 600; }
.mo-pc-stage-sum { font-size: var(--px-text-xs); color: var(--px-text-muted); }
.mo-pc-split { padding-top: var(--px-space-3); margin-top: var(--px-space-2); border-top: 1px solid var(--px-border); }
.mo-pc-field { display: flex; flex-direction: column; gap: var(--px-space-1); font-size: var(--px-text-sm); }
.mo-pc-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--px-space-2); }
.mo-pc-head .mo-practice-section-title { margin-bottom: 0; }
.mo-pc-colour { display: flex; align-items: center; gap: var(--px-space-3); }
.mo-pc-chip-lg { flex: none; width: 52px; height: 52px; border-radius: var(--px-radius-md); background: var(--px-bg-inset); box-shadow: var(--px-ring); }
.mo-pc-chip-xl { width: 64px; height: 64px; }
.mo-pc-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mo-pc-name { font-size: var(--px-text-md); font-weight: 600; }
.mo-pc-sub, .mo-pc-hex { font-size: var(--px-text-xs); }
.mo-pc-hex { font-family: var(--px-font-mono); }
.mo-pc-chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(32px, 1fr)); gap: var(--px-space-1); }
.mo-pc-chips .mo-pc-chip { aspect-ratio: 1; height: auto; min-width: 0; min-height: 32px; padding: 0; border: 0; border-radius: var(--px-radius-sm); box-shadow: var(--px-ring); cursor: pointer; }
.mo-plan-panel .mo-pc-back { align-self: flex-start; display: inline-flex; align-items: center; gap: var(--px-space-1); margin-bottom: var(--px-space-2); }
.mo-pc-card { padding: var(--px-space-3); margin: var(--px-space-3) 0; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-inset); }
.mo-pc-close { display: inline-flex; align-items: center; gap: 5px; font-size: var(--px-text-xs); white-space: nowrap; }
.mo-pc-close::before { content: ''; width: 7px; height: 7px; border-radius: var(--px-radius-full); background: var(--px-text-muted); }
.mo-pc-close--very-close::before, .mo-pc-close--close::before { background: var(--px-success); }
.mo-pc-close--near::before { background: var(--px-warning); }
.mo-pc-close--far::before { background: var(--px-danger); }
.mo-pc-bar { display: flex; height: 12px; border-radius: var(--px-radius-full); overflow: hidden; box-shadow: var(--px-ring); }
.mo-pc-bar--sm { flex: none; width: 48px; height: 8px; }
.mo-pc-paints { display: flex; flex-direction: column; }
.mo-pc-paint { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: center; gap: var(--px-space-2); min-height: 28px; font-size: var(--px-text-sm); }
.mo-pc-dot { width: 14px; height: 14px; border-radius: var(--px-radius-full); box-shadow: var(--px-ring); }
.mo-pc-compare { display: flex; gap: var(--px-space-2); }
.mo-pc-compare-col { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.mo-pc-compare-sw { height: 36px; border-radius: var(--px-radius-sm); box-shadow: var(--px-ring); }
.mo-pc-simpler { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-sm); }
.mo-pc-simpler > span:nth-child(2) { flex: 1; min-width: 0; }
.mo-pc-layer { position: absolute; inset: 0; cursor: crosshair; touch-action: none; }
.mo-ps-lens { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.mo-ps-marks { position: absolute; inset: 0; pointer-events: none; }
.mo-ps-spot { position: absolute; width: 18px; height: 18px; margin: -10px 0 0 -10px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--px-viewer-ink); border-radius: var(--px-radius-full); box-shadow: 0 0 0 1px var(--px-viewer-bar); background: var(--px-viewer-scrim); color: var(--px-viewer-ink); font-size: var(--px-text-2xs); font-weight: 700; }
.mo-ps-spot--cursor { border-style: dashed; }
.mo-ps-lenses, .mo-ps-masses { display: flex; flex-direction: column; gap: 1px; }
.px-btn.mo-ps-lens-btn { width: 100%; justify-content: flex-start; gap: var(--px-space-2); padding: 0 var(--px-space-2); }
.px-btn.mo-ps-lens-btn[aria-pressed="true"], .px-btn.mo-ps-mass[aria-pressed="true"] { background: var(--px-accent-soft); color: var(--px-accent-text); }
.mo-ps-tip { padding: var(--px-space-2); border-radius: var(--px-radius-md); background: var(--px-bg-inset); color: var(--px-text-secondary); font-size: var(--px-text-xs); line-height: 1.45; }
.mo-ps-readout { display: flex; flex-direction: column; }
.mo-ps-row { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: center; gap: var(--px-space-2); min-height: 22px; font-size: var(--px-text-sm); }
.mo-ps-row-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-ps-num { color: var(--px-text-secondary); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mo-ps-sw { width: 14px; height: 14px; border-radius: var(--px-radius-sm); box-shadow: var(--px-ring); }
.px-btn.mo-ps-mass { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; grid-template-areas: "sw name num" "sw detail num"; align-items: center; column-gap: var(--px-space-2); row-gap: 0; width: 100%; height: auto; padding: var(--px-space-1) var(--px-space-2); text-align: left; }
.px-btn.mo-ps-mass .mo-ps-sw { grid-area: sw; }
.px-btn.mo-ps-mass .px-btn__label { grid-area: name; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.px-btn.mo-ps-mass .mo-ps-mass-detail { grid-area: detail; color: var(--px-text-secondary); font-size: var(--px-text-2xs); font-weight: normal; }
.px-btn.mo-ps-mass .mo-ps-num { grid-area: num; }
.mo-ps-compare { margin: 0; padding-left: var(--px-space-4); font-size: var(--px-text-sm); line-height: 1.45; }
.px-btn.mo-ps-wide { width: 100%; }
.mo-ps-hist { display: flex; align-items: flex-end; gap: 2px; height: 40px; }
.mo-ps-bar { flex: 1; min-height: 1px; background: var(--px-border); }
.mo-ps-bar.is-kept { background: var(--px-accent); }
.mo-pc-layer:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 2px; }
.mo-pc-pins { position: absolute; inset: 0; pointer-events: none; }
.mo-pc-pin { position: absolute; width: 10px; height: 10px; margin: -7px 0 0 -7px; border: 2px solid var(--px-viewer-ink); border-radius: var(--px-radius-full); box-shadow: 0 0 0 1px var(--px-viewer-bar); }
.mo-pc-loupe { position: absolute; width: 84px; height: 84px; margin: -45px 0 0 -45px; border: 3px solid var(--px-viewer-ink); border-radius: var(--px-radius-full); box-shadow: 0 0 0 1px var(--px-viewer-bar), var(--px-shadow-md); display: flex; align-items: center; justify-content: center; pointer-events: none; }
.mo-pc-loupe-box { border: 1.5px solid var(--px-viewer-ink); box-shadow: 0 0 0 1px var(--px-viewer-bar); }
.mo-pc-loupe-tag { position: absolute; padding: 3px 8px; border-radius: var(--px-radius-sm); background: var(--px-viewer-scrim); color: var(--px-viewer-ink); font-size: var(--px-text-xs); white-space: nowrap; pointer-events: none; }
.mo-pc-marks { position: absolute; inset: 0; pointer-events: none; }
.mo-pc-gl { position: absolute; font-size: var(--px-text-2xs); color: var(--px-text-muted); line-height: 1; transform: translate(-50%, -50%); }
.mo-pc-gl--col { top: -12px; }
.mo-pc-gl--row { left: -12px; }
.mo-plan-topbar .mo-toolbar-btn[aria-pressed="true"] { background: var(--px-accent-soft); color: var(--px-accent-text); }
.mo-pc-ba { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.mo-pc-ba-line { position: absolute; top: 0; bottom: 0; width: 24px; margin-left: -12px; pointer-events: auto; cursor: ew-resize; touch-action: none; }
.mo-pc-ba-line::before { content: ''; position: absolute; top: 0; bottom: 0; left: 11px; width: 2px; background: var(--px-viewer-ink); box-shadow: 0 0 0 1px var(--px-viewer-bar); }
.mo-pc-ba-line:focus-visible { outline: var(--px-focus-width) solid var(--vscode-focusBorder, var(--px-accent)); outline-offset: -2px; }
.mo-pc-ba-knob { position: absolute; top: 50%; left: 50%; width: 28px; height: 28px; transform: translate(-50%, -50%); border-radius: var(--px-radius-full); background: var(--px-viewer-scrim); border: 2px solid var(--px-viewer-ink); box-sizing: border-box; }
.mo-pc-ba-knob::before, .mo-pc-ba-knob::after { content: ''; position: absolute; top: 50%; width: 0; height: 0; margin-top: -4px; border: 4px solid transparent; }
.mo-pc-ba-knob::before { left: 2px; border-right-color: var(--px-viewer-ink); }
.mo-pc-ba-knob::after { right: 2px; border-left-color: var(--px-viewer-ink); }
.mo-pc-ba-tag { position: absolute; top: var(--px-space-2); padding: 2px 8px; margin: 0 var(--px-space-3); white-space: nowrap; border-radius: var(--px-radius-sm); background: var(--px-viewer-scrim); color: var(--px-viewer-ink); font-size: var(--px-text-xs); }
.mo-plan-tool-gap { width: 36px; height: 1px; margin: var(--px-space-1) auto; background: var(--px-border); flex: none; }
.mo-plan-field-label { font-size: var(--px-text-sm); margin-top: var(--px-space-1); }
.mo-plan-danger { background: transparent; color: var(--px-danger); border: 1px solid color-mix(in srgb, var(--px-danger) 45%, transparent); }
.mo-pc-chips .mo-pc-chip.is-picked { box-shadow: var(--px-ring), inset 0 -4px 0 var(--px-accent); }
.mo-pc-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
/* The board (board.js) */
.mo-bd { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--px-bg); color: var(--px-text); outline: none; }
.mo-bd-header { flex: none; display: flex; align-items: baseline; gap: var(--px-space-3); padding: var(--px-space-2) var(--px-space-4); border-bottom: 1px solid var(--px-border); }
.mo-bd-title { font-size: var(--px-text-md); font-weight: 600; }
.mo-bd-head-right { margin-left: auto; display: flex; gap: var(--px-space-2); align-self: center; }
.mo-bd-view { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background-color: var(--px-bg-inset); background-image: radial-gradient(var(--px-border) 1px, transparent 1px); cursor: default; }
.mo-bd-view[data-tool="pan"] { cursor: grab; }
.mo-bd-view[data-tool="arrowTool"] .mo-bd-item { cursor: crosshair; }
.mo-bd-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.mo-bd-links { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: 5; }
.mo-bd-link { fill: none; stroke: var(--px-accent); stroke-width: 1.5; }
.mo-bd-link-dot { fill: var(--px-accent); }
.mo-bd-item { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); box-shadow: var(--px-shadow-md); overflow: hidden; cursor: move; touch-action: none; user-select: none; }
.mo-bd-item:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 2px; }
.mo-bd-item.is-selected { border-color: var(--px-accent); box-shadow: 0 0 0 1px var(--px-accent), var(--px-shadow-md); }
.mo-bd-item--frame { background: transparent; border: 1px dashed var(--px-border-strong); box-shadow: none; overflow: visible; }
.mo-bd-frame-title { position: absolute; left: var(--px-space-3); top: -12px; width: auto; max-width: 70%; padding: 0 var(--px-space-2); border: 0; background: var(--px-bg-inset); color: var(--px-text-secondary); font: inherit; font-size: var(--px-text-sm); font-weight: 600; }
.mo-bd-img { flex: 1 1 auto; min-height: 0; width: 100%; object-fit: cover; display: block; background: var(--px-bg-inset); pointer-events: none; }
.mo-bd-cap { flex: none; display: flex; flex-direction: column; gap: 1px; padding: var(--px-space-2) var(--px-space-3); }
.mo-bd-cap .mo-pc-name { font-size: var(--px-text-sm); }
.mo-bd-swatches { flex: 1 1 auto; display: flex; min-height: 40px; }
.mo-bd-swatches .mo-bd-swatch { position: relative; flex: 1 1 0; min-width: 0; height: auto; padding: 0; border: 0; border-radius: 0; }
.mo-bd-swatches .mo-bd-swatch:focus-visible { outline: var(--px-focus-width) solid var(--px-viewer-ink); outline-offset: -4px; }
.mo-bd-far { position: absolute; right: 4px; top: 4px; width: 16px; height: 16px; border-radius: var(--px-radius-full); background: var(--px-viewer-scrim); color: var(--px-warning); font-size: var(--px-text-2xs); font-weight: 700; display: flex; align-items: center; justify-content: center; }
.mo-bd-pad { padding: var(--px-space-3); }
.mo-bd-mixhead { display: flex; align-items: center; gap: var(--px-space-2); padding: var(--px-space-3) var(--px-space-3) var(--px-space-2); }
.mo-bd-mixhead .mo-pc-close { margin-left: auto; }
.mo-bd-mixsw { flex: none; width: 34px; height: 34px; border-radius: var(--px-radius-sm); box-shadow: var(--px-ring); }
.mo-bd-item--mix .mo-pc-bar { margin: 0 var(--px-space-3); }
.mo-bd-recipe { padding: var(--px-space-2) var(--px-space-3); font-size: var(--px-text-xs); color: var(--px-text-secondary); }
.mo-bd-grip { flex: none; padding: var(--px-space-2) var(--px-space-3) 0; font-size: var(--px-text-xs); font-weight: 600; color: var(--px-text-muted); }
.mo-bd-note { flex: 1 1 auto; margin: var(--px-space-1) var(--px-space-2) var(--px-space-2); padding: var(--px-space-1); border: 0; resize: none; background: transparent; color: var(--px-text); font: inherit; font-size: var(--px-text-sm); line-height: 1.5; cursor: text; user-select: text; }
.mo-bd-lock { position: absolute; right: 6px; top: 6px; padding: 1px 6px; border-radius: var(--px-radius-sm); background: var(--px-viewer-scrim); color: var(--px-viewer-ink); font-size: var(--px-text-2xs); }
.mo-bd-overlay { position: absolute; inset: 0; pointer-events: none; }
.mo-bd-overlay > * { pointer-events: auto; }
.mo-bd-overlay > .mo-bd-guides, .mo-bd-overlay > .mo-bd-sizetag { pointer-events: none; }
.mo-bd-guides { position: absolute; inset: 0; }
.mo-bd-guide { position: absolute; background: var(--px-danger); }
.mo-bd-handles { position: absolute; pointer-events: none; }
.mo-bd-handle { position: absolute; width: 10px; height: 10px; margin: -6px 0 0 -6px; background: var(--px-viewer-ink); border: 1.5px solid var(--px-accent); border-radius: 2px; pointer-events: auto; touch-action: none; }
.mo-bd-handle--nw { left: 0; top: 0; cursor: nwse-resize; } .mo-bd-handle--n { left: 50%; top: 0; cursor: ns-resize; } .mo-bd-handle--ne { left: 100%; top: 0; cursor: nesw-resize; }
.mo-bd-handle--e { left: 100%; top: 50%; cursor: ew-resize; } .mo-bd-handle--se { left: 100%; top: 100%; cursor: nwse-resize; } .mo-bd-handle--s { left: 50%; top: 100%; cursor: ns-resize; }
.mo-bd-handle--sw { left: 0; top: 100%; cursor: nesw-resize; } .mo-bd-handle--w { left: 0; top: 50%; cursor: ew-resize; }
[data-input-modality="touch"] .mo-bd-handle { width: 22px; height: 22px; margin: -12px 0 0 -12px; }
.mo-bd-sizetag { position: absolute; padding: 2px 8px; border-radius: var(--px-radius-sm); background: var(--px-accent); color: var(--px-text-on-accent); font-size: var(--px-text-xs); }
.mo-bd-ctxbar, .mo-bd-toolbar, .mo-bd-zoom { position: absolute; display: flex; align-items: center; gap: 2px; padding: var(--px-space-1); background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); box-shadow: var(--px-shadow-md); z-index: 30; }
.mo-bd-toolbar { left: 50%; top: var(--px-space-3); transform: translateX(-50%); width: max-content; max-width: calc(100% - 32px); flex-wrap: wrap; justify-content: center; }
.mo-bd-toolbar .is-on { background: var(--px-accent); color: var(--px-text-on-accent); }
.mo-bd-sep { width: 1px; height: 20px; margin: 0 var(--px-space-1); background: var(--px-border); }
.mo-bd-zoom { right: var(--px-space-4); bottom: var(--px-space-4); }
.mo-bd-zoom-label { min-width: 44px; text-align: center; font-size: var(--px-text-xs); }
.mo-bd-mini { position: absolute; right: var(--px-space-4); bottom: 64px; width: 168px; height: 104px; background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); cursor: pointer; z-index: 30; }
.mo-bd-empty { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); max-width: 380px; display: flex; flex-direction: column; gap: var(--px-space-2); text-align: center; pointer-events: none; }
.mo-bd-pop { position: absolute; width: 320px; max-height: 420px; overflow: auto; box-sizing: border-box; padding: var(--px-space-4); display: flex; flex-direction: column; gap: var(--px-space-3); background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); box-shadow: var(--px-shadow-lg); z-index: 40; }
.mo-bd-swatchpop, .mo-bd-picker { display: flex; flex-direction: column; gap: var(--px-space-3); }
.mo-bd-picker-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--px-space-1); }
.mo-bd-picker-grid .mo-bd-pick { aspect-ratio: 1; height: auto; min-width: 0; padding: 0; overflow: hidden; border-radius: var(--px-radius-sm); }
.mo-bd-pick img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mo-plan-variant-tag { font-size: var(--px-text-2xs); padding: 0 6px; border-radius: var(--px-radius-full); background: var(--px-accent-soft); color: var(--px-accent-text); }
.mo-plan-shelf { display: flex; flex-direction: column; gap: 8px; }
.mo-plan-shelf-open { flex: none; padding: 0; border: 0; background: transparent; cursor: pointer; }
.mo-plan-section > .mo-clip-input--grow { flex: none; }
.mo-plan-variant { font: inherit; color: inherit; background: transparent; }
.mo-plan-shelf-item { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.mo-plan-shelf-item img { width: 48px; height: 48px; object-fit: cover; border-radius: var(--parallx-radius-sm, 3px); background: var(--px-bg-inset, rgba(128, 128, 128, 0.1)); cursor: pointer; }
.mo-plan-shelf-item span { flex: 1 1 auto; }
.mo-plans-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.mo-plans-head { display: flex; align-items: flex-end; gap: var(--px-space-4); margin-bottom: var(--px-space-4); }
.mo-plans-words { flex: 1 1 auto; min-width: 0; }
.mo-plans-picker { display: flex; flex-direction: column; gap: var(--px-space-3); max-width: 640px; padding: var(--px-space-4); margin-bottom: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); }
.mo-plans-picker > .mo-clip-input, .mo-bd-picker > .mo-clip-input { flex: none; height: var(--px-control-h); }
.mo-plans-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: var(--px-space-2); }
.mo-plans-picker-grid .mo-plans-pick { aspect-ratio: 1; height: auto; min-width: 0; padding: 0; overflow: hidden; border-radius: var(--px-radius-sm); }
.mo-plans-pick img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mo-plans-card { width: 200px; display: flex; flex-direction: column; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); overflow: hidden; }
.mo-plans-card .mo-plans-open { height: auto; padding: var(--px-space-2); display: flex; flex-direction: column; align-items: stretch; gap: 3px; text-align: left; border-radius: 0; font-size: var(--px-text-sm); white-space: normal; }
.mo-plans-open img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; border-radius: var(--px-radius-sm); background: var(--px-bg-inset); margin-bottom: var(--px-space-1); }
.mo-plans-card-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-plans-dots { display: flex; gap: 3px; min-height: 12px; margin-top: 2px; }
.mo-plans-dots span { width: 12px; height: 12px; border-radius: var(--px-radius-full); box-shadow: var(--px-ring); }
.mo-plans-actions { display: flex; align-items: center; gap: var(--px-space-1); padding: var(--px-space-1) var(--px-space-2) var(--px-space-2); }
.mo-plans-actions > :first-child { margin-right: auto; }
/* Image editor (docs/IMAGE_EDITOR.md, docs/mockups/image-editor-redesign.html):
   top bar · presets | the stage over the filmstrip | the panel with its tool
   tabs. --px-* tokens and the Tier 3 "Image editor" block in px-tokens.css. */
.mo-edit { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--px-bg); color: var(--px-text); outline: none; font-family: var(--px-font-ui); font-size: var(--px-text-base); --mo-edit-line: var(--px-text); --mo-edit-faint: var(--px-border); }
.mo-edit button:disabled { cursor: default; }
.mo-edit-ico { display: inline-flex; align-items: center; justify-content: center; flex: none; }
.mo-edit-ico svg { display: block; }
.mo-edit .px-btn.mo-active, .mo-edit .px-btn--icon.mo-active { background: var(--px-surface-selected); color: var(--px-accent-text); }
/* Top bar */
.mo-edit-topbar { flex: 0 0 auto; display: flex; align-items: center; gap: var(--px-space-2); height: 44px; padding: 0 var(--px-space-2); border-bottom: 1px solid var(--px-border); min-width: 0; }
.mo-edit-topbar-left { display: flex; align-items: center; gap: var(--px-space-2); min-width: 0; flex: 1 1 auto; }
.mo-edit-topbar-right { display: flex; align-items: center; gap: var(--px-space-1); flex: 0 0 auto; }
.mo-edit-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mo-edit-dim { font-size: var(--px-text-sm); color: var(--px-text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; flex: none; }
.mo-edit-edited { flex: none; font-size: var(--px-text-xs); color: var(--px-accent-text); background: var(--px-accent-soft); padding: 1px var(--px-space-2); border-radius: var(--px-radius-full); white-space: nowrap; }
.mo-edit-sep { width: 1px; height: 18px; background: var(--px-border); margin: 0 var(--px-space-1); flex: none; }
.mo-edit-seg { display: inline-flex; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); overflow: hidden; flex: none; }
.mo-edit-segbtn { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 var(--px-space-2); border: 0; border-right: 1px solid var(--px-border); background: transparent; color: var(--px-text-secondary); font: inherit; font-size: var(--px-text-sm); cursor: pointer; user-select: none; }
.mo-edit-segbtn:last-child { border-right: 0; }
.mo-edit-segbtn:hover:not(:disabled) { background: var(--px-surface-hover); color: var(--px-text); }
.mo-edit-segbtn.is-on { background: var(--px-surface-selected); color: var(--px-accent-text); }
.mo-edit-segbtn:disabled { opacity: 0.45; }
.mo-edit-kbd { font-family: var(--px-font-mono); font-size: var(--px-text-2xs); color: var(--px-text-faint); border: 1px solid var(--px-border); border-radius: 3px; padding: 0 3px; line-height: 14px; }
.mo-edit-zoombtn { display: inline-flex; align-items: center; gap: var(--px-space-1); height: 28px; padding: 0 var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: transparent; color: var(--px-text-secondary); font: inherit; font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; cursor: pointer; flex: none; }
.mo-edit-zoombtn:hover:not(:disabled) { background: var(--px-surface-hover); color: var(--px-text); }
.mo-edit-zoombtn:disabled { opacity: 0.45; }
.mo-edit-zoomval { min-width: 34px; text-align: right; }
.mo-edit-split { display: inline-flex; flex: none; margin-left: var(--px-space-1); }
.mo-edit-split > .px-btn--primary { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.mo-edit-split > .mo-edit-split-menu { border-top-left-radius: 0; border-bottom-left-radius: 0; background: var(--px-accent); color: var(--px-text-on-accent); border-left: 1px solid color-mix(in srgb, var(--px-text-on-accent) 25%, transparent); }
.mo-edit-split > .mo-edit-split-menu:hover:not(:disabled) { background: var(--px-accent-hover); color: var(--px-text-on-accent); }
.mo-edit-split > .mo-edit-split-menu:disabled, .mo-edit-split > .px-btn--primary:disabled { background: var(--px-surface-active); color: var(--px-text-faint); }
.mo-edit--narrow .mo-edit-seg, .mo-edit--narrow .mo-edit-zoombtn, .mo-edit--narrow .mo-edit-dim, .mo-edit--narrow .mo-edit-edited { display: none; }
/* Body */
.mo-edit-body { flex: 1 1 auto; min-height: 0; display: flex; position: relative; }
.mo-edit-centre { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
/* The stage stays neutral dark in both modes. */
.mo-edit-stage { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; background: var(--px-edit-stage); touch-action: none; user-select: none; }
.mo-edit-stage.is-pannable { cursor: grab; }
.mo-edit-stage.is-panning { cursor: grabbing; }
.mo-edit-stage.is-picking, .mo-edit-stage.is-picking.is-pannable { cursor: crosshair; }
.mo-edit-stage.is-brushing, .mo-edit-stage.is-brushing.is-pannable { cursor: crosshair; }
.mo-edit-canvas, .mo-edit-paint { position: absolute; left: 0; top: 0; display: block; }
.mo-edit-paint { pointer-events: none; }
.mo-edit-message { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: var(--px-space-6); text-align: center; font-size: var(--px-text-sm); color: var(--px-viewer-ink-muted); pointer-events: none; }
.mo-edit-stagechip { position: absolute; font-size: var(--px-text-xs); color: var(--px-viewer-ink); background: var(--px-viewer-bar); padding: 3px var(--px-space-2); border-radius: var(--px-radius-full); white-space: nowrap; border: 1px solid var(--px-viewer-line); pointer-events: none; z-index: 2; }
.mo-edit-stagechip b { font-weight: 600; }
.mo-edit-stagechip--top { top: var(--px-space-2); left: 50%; transform: translateX(-50%); }
.mo-edit-stagechip--zoom { right: var(--px-space-2); bottom: var(--px-space-2); font-variant-numeric: tabular-nums; }
.mo-edit-stagechip--zoom:empty { display: none; }
.mo-edit-chip { position: absolute; left: 50%; bottom: var(--px-space-4); transform: translateX(-50%); box-sizing: border-box; width: 300px; max-width: calc(100% - 32px); display: flex; flex-direction: column; gap: 7px; padding: 9px 12px; border-radius: var(--px-radius-md); font-size: var(--px-text-sm); background: var(--px-bg-elevated); border: 1px solid var(--px-border); box-shadow: var(--px-shadow-md); pointer-events: none; z-index: 3; }
.mo-edit-chip-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.mo-edit-chip-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-edit-chip-note { flex: 0 0 auto; color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.mo-edit-toast { position: absolute; left: var(--px-space-3); bottom: var(--px-space-3); display: flex; align-items: center; gap: var(--px-space-2); max-width: calc(100% - 24px); padding: var(--px-space-1) var(--px-space-1) var(--px-space-1) var(--px-space-3); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); border: 1px solid var(--px-border); box-shadow: var(--px-shadow-md); font-size: var(--px-text-sm); z-index: 4; }
.mo-edit-toast-ok { color: var(--px-success); }
.mo-edit-toast-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-edit-brush { position: absolute; border-radius: 50%; border: 1.5px solid var(--px-viewer-ink); box-shadow: 0 0 0 1px var(--px-viewer-scrim); pointer-events: none; }
.mo-edit-markbox { position: absolute; border: 1.5px dashed var(--px-viewer-ink); border-radius: var(--px-radius-sm); box-shadow: 0 0 0 1px var(--px-viewer-scrim); pointer-events: none; }
/* Split compare */
.mo-edit-splitbar { position: absolute; top: 0; bottom: 0; width: 13px; margin-left: -6px; cursor: ew-resize; background: linear-gradient(to right, transparent 6px, var(--px-viewer-ink) 6px, var(--px-viewer-ink) 7px, transparent 7px); z-index: 1; }
.mo-edit-splitknob { position: absolute; top: 50%; left: 50%; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; background: var(--px-viewer-ink); color: var(--px-edit-stage); display: flex; align-items: center; justify-content: center; box-shadow: var(--px-shadow-md); pointer-events: none; }
.mo-edit-ba { position: absolute; top: var(--px-space-3); font-size: var(--px-text-xs); font-weight: 600; color: var(--px-viewer-ink); background: var(--px-viewer-bar); padding: 2px var(--px-space-2); border-radius: var(--px-radius-sm); pointer-events: none; z-index: 1; }
/* Crop */
.mo-edit-cropframe { position: absolute; box-sizing: border-box; border: 1.5px solid var(--px-viewer-ink); box-shadow: 0 0 0 1px var(--px-viewer-scrim); cursor: move; }
.mo-edit-crophandle { position: absolute; width: 16px; height: 16px; }
.mo-edit-crophandle--nw { left: -4px; top: -4px; cursor: nwse-resize; border-left: 3px solid var(--px-viewer-ink); border-top: 3px solid var(--px-viewer-ink); }
.mo-edit-crophandle--ne { right: -4px; top: -4px; cursor: nesw-resize; border-right: 3px solid var(--px-viewer-ink); border-top: 3px solid var(--px-viewer-ink); }
.mo-edit-crophandle--se { right: -4px; bottom: -4px; cursor: nwse-resize; border-right: 3px solid var(--px-viewer-ink); border-bottom: 3px solid var(--px-viewer-ink); }
.mo-edit-crophandle--sw { left: -4px; bottom: -4px; cursor: nesw-resize; border-left: 3px solid var(--px-viewer-ink); border-bottom: 3px solid var(--px-viewer-ink); }
.mo-edit-crophandle--n, .mo-edit-crophandle--s { left: calc(50% - 12px); width: 24px; height: 10px; cursor: ns-resize; }
.mo-edit-crophandle--n { top: -6px; } .mo-edit-crophandle--s { bottom: -6px; }
.mo-edit-crophandle--e, .mo-edit-crophandle--w { top: calc(50% - 12px); width: 10px; height: 24px; cursor: ew-resize; }
.mo-edit-crophandle--e { right: -6px; } .mo-edit-crophandle--w { left: -6px; }
.mo-edit-crophandle--n::after, .mo-edit-crophandle--s::after { content: ''; position: absolute; left: 0; right: 0; top: 3px; height: 3px; border-radius: 2px; background: var(--px-viewer-ink); }
.mo-edit-crophandle--e::after, .mo-edit-crophandle--w::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 3px; border-radius: 2px; background: var(--px-viewer-ink); }
.mo-edit-cropline { position: absolute; background: var(--px-viewer-line); pointer-events: none; }
.mo-edit-cropline--v1 { left: 33.333%; top: 0; bottom: 0; width: 1px; }
.mo-edit-cropline--v2 { left: 66.666%; top: 0; bottom: 0; width: 1px; }
.mo-edit-cropline--h1 { top: 33.333%; left: 0; right: 0; height: 1px; }
.mo-edit-cropline--h2 { top: 66.666%; left: 0; right: 0; height: 1px; }
.mo-edit-cropsize { position: absolute; left: 50%; top: var(--px-space-2); transform: translateX(-50%); font-size: var(--px-text-xs); color: var(--px-viewer-ink); background: var(--px-viewer-bar); padding: 2px 7px; border-radius: var(--px-radius-sm); white-space: nowrap; font-variant-numeric: tabular-nums; pointer-events: none; }
.mo-edit-dial { position: absolute; left: 50%; bottom: var(--px-space-3); transform: translateX(-50%); width: min(420px, 80%); height: 42px; cursor: ew-resize; z-index: 2; touch-action: none; }
.mo-edit-dial-ticks { position: absolute; left: 0; right: 0; top: 4px; height: 16px; background-image: repeating-linear-gradient(90deg, var(--px-viewer-ink-muted) 0 1px, transparent 1px 10px); -webkit-mask: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); mask: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
.mo-edit-dial-mid { position: absolute; left: 50%; top: 0; width: 2px; height: 24px; margin-left: -1px; border-radius: 1px; background: var(--px-accent); }
.mo-edit-dial-value { position: absolute; left: 50%; top: 24px; transform: translateX(-50%); font-size: var(--px-text-xs); color: var(--px-viewer-ink); font-variant-numeric: tabular-nums; }
/* The enlarged preview, at 100% */
.mo-edit-preview { position: absolute; inset: 0; overflow: auto; background: var(--px-edit-stage); z-index: 1; cursor: grab; }
.mo-edit-preview.is-panning { cursor: grabbing; }
.mo-edit-preview-img { display: block; max-width: none; image-rendering: auto; }
/* Filmstrip */
.mo-edit-film { flex: 0 0 76px; display: flex; align-items: center; gap: var(--px-space-3); padding: 0 var(--px-space-3); border-top: 1px solid var(--px-border); background: var(--px-bg); }
.mo-edit-film-count { flex: 0 0 auto; font-size: var(--px-text-xs); color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.mo-edit-film-strip { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--px-space-2); overflow-x: auto; overflow-y: hidden; height: 100%; }
.mo-edit-film-item { position: relative; flex: 0 0 auto; height: 56px; min-width: 44px; padding: 0; border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); background: var(--px-bg-inset); cursor: pointer; overflow: hidden; }
.mo-edit-film-item img { display: block; height: 54px; width: auto; min-width: 40px; max-width: 120px; object-fit: cover; }
.mo-edit-film-item:hover { border-color: var(--px-border-strong); }
.mo-edit-film-item.is-current { outline: 2px solid var(--px-accent); outline-offset: 1px; }
.mo-edit-film-item.is-edited::after { content: ''; position: absolute; right: 4px; top: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--px-accent); box-shadow: 0 0 0 1.5px var(--px-viewer-scrim); }
/* Presets */
.mo-edit-presets { flex: 0 0 var(--px-edit-presets-w); width: var(--px-edit-presets-w); display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--px-border); background: var(--px-bg); }
.mo-edit-presets--over { position: absolute; left: 0; top: 0; bottom: 0; z-index: 5; box-shadow: var(--px-shadow-lg); }
.mo-edit-presets-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; height: 38px; padding: 0 var(--px-space-1) 0 var(--px-space-3); border-bottom: 1px solid var(--px-divider); }
.mo-edit-presets-btns { display: flex; gap: 2px; }
.mo-edit-presets-filter { margin: var(--px-space-2) var(--px-space-2) 0; height: 26px; padding: 0 var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-inset); color: var(--px-text); font: inherit; font-size: var(--px-text-sm); outline: none; }
.mo-edit-presets-filter:focus { border-color: var(--px-accent); }
.mo-edit-presets-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--px-space-2) var(--px-space-2) var(--px-space-3); }
.mo-edit-presets-group { padding: var(--px-space-2) 2px var(--px-space-1); font-size: var(--px-text-xs); color: var(--px-text-muted); font-weight: 600; }
.mo-edit-presets-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--px-space-2); }
.mo-edit-ptile { display: flex; flex-direction: column; gap: 3px; padding: 0; border: 0; background: transparent; color: var(--px-text-secondary); font: inherit; font-size: var(--px-text-xs); text-align: left; cursor: pointer; min-width: 0; }
.mo-edit-ptile-im { aspect-ratio: 3 / 2; border-radius: var(--px-radius-sm); overflow: hidden; border: 1px solid var(--px-border); background: var(--px-edit-stage); }
.mo-edit-ptile-im img { width: 100%; height: 100%; display: block; object-fit: cover; }
.mo-edit-ptile:hover .mo-edit-ptile-im { outline: 1px solid var(--px-border-strong); outline-offset: 1px; }
.mo-edit-ptile:hover { color: var(--px-text); }
.mo-edit-ptile.is-on { color: var(--px-text); }
.mo-edit-ptile.is-on .mo-edit-ptile-im { outline: 2px solid var(--px-accent); outline-offset: 1px; }
.mo-edit-ptile-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Panel */
.mo-edit-panel { flex: 0 0 var(--px-edit-panel-w); width: var(--px-edit-panel-w); display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--px-border); background: var(--px-bg); }
.mo-edit-tabs { flex: none; display: flex; padding: 0 var(--px-space-1); border-bottom: 1px solid var(--px-border); }
.mo-edit-tab { flex: 1 1 0; position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 0 6px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--px-text-muted); font: inherit; font-size: var(--px-text-xs); cursor: pointer; }
.mo-edit-tab:hover:not(:disabled) { color: var(--px-text); }
.mo-edit-tab.is-on { color: var(--px-text); border-bottom-color: var(--px-accent); }
.mo-edit-tab:disabled { opacity: 0.45; }
.mo-edit-tab-dot { position: absolute; top: 6px; left: calc(50% + 9px); width: 6px; height: 6px; border-radius: 50%; background: var(--px-accent); display: none; }
.mo-edit-tab.is-used:not(.is-on) .mo-edit-tab-dot { display: block; }
.mo-edit--narrow .mo-edit-tab { flex-direction: row; justify-content: center; padding: 10px 0 9px; }
.mo-edit--narrow .mo-edit-tab-label { display: none; }
.mo-edit--narrow .mo-edit-panel { flex-basis: calc(var(--px-edit-panel-w) - 40px); width: calc(var(--px-edit-panel-w) - 40px); }
.mo-edit-hist { flex: 0 0 auto; position: relative; height: 78px; margin: var(--px-space-3) var(--px-space-3) 2px; border-radius: var(--px-radius-md); border: 1px solid var(--px-divider); background: var(--px-bg-inset); overflow: hidden; }
.mo-edit-hist-canvas { display: block; width: 100%; height: 100%; }
.mo-edit-clip { position: absolute; top: 4px; width: 16px; height: 16px; padding: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 3px; background: transparent; color: var(--px-text-faint); cursor: pointer; }
.mo-edit-clip--lo { left: 4px; } .mo-edit-clip--hi { right: 4px; }
.mo-edit-clip.is-on { color: var(--px-warning); background: rgba(var(--px-yellow-rgb), 0.15); }
.mo-edit-clip.is-showing { color: var(--px-accent-text); background: var(--px-accent-soft); }
.mo-edit-histcap { flex: none; display: flex; justify-content: space-between; gap: var(--px-space-2); margin: 0 var(--px-space-3) var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-text-faint); font-variant-numeric: tabular-nums; min-height: 16px; }
.mo-edit-histcap-exif { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-edit-histcap-clip { white-space: nowrap; }
.mo-edit-histcap-clip.is-warn { color: var(--px-warning); }
.mo-edit-panel-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.mo-edit-panel-body > .mo-edit-hint { padding: var(--px-space-3); }
.mo-edit-section { border-top: 1px solid var(--px-divider); }
.mo-edit-section-head { display: flex; align-items: center; gap: 2px; padding: 0 var(--px-space-2) 0 0; min-height: 34px; }
.mo-edit-section-fold { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: var(--px-space-2) var(--px-space-3); border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.mo-edit-section-fold:hover .mo-edit-section-title { color: var(--px-text); }
.mo-edit-section-title { font-size: var(--px-text-sm); font-weight: 600; }
.mo-edit-section-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--px-accent); flex: none; }
.mo-edit-section-acts { display: flex; align-items: center; gap: 2px; flex: none; }
.mo-edit-chevron { display: inline-flex; color: var(--px-text-faint); }
.mo-edit-section.is-shut > .mo-edit-section-head .mo-edit-chevron { transform: rotate(-90deg); }
.mo-edit-section.is-shut > .mo-edit-section-body { display: none; }
.mo-edit-section-body { display: flex; flex-direction: column; gap: 4px; padding: 0 var(--px-space-3) var(--px-space-3); }
.mo-edit-headbtn.px-btn { height: 22px; padding: 0 6px; color: var(--px-text-secondary); }
.mo-edit-mini { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--px-radius-sm); background: transparent; color: var(--px-text-faint); cursor: pointer; }
.mo-edit-mini:hover:not(:disabled) { background: var(--px-surface-hover); color: var(--px-text); }
.mo-edit-mini.is-on { color: var(--px-accent-text); background: var(--px-accent-soft); }
.mo-edit-mini:disabled { opacity: 0.35; }
.mo-edit-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.mo-edit-label { font-size: var(--px-text-xs); color: var(--px-text-muted); font-weight: 600; margin-top: var(--px-space-2); }
.mo-edit-hint { font-size: var(--px-text-xs); line-height: 1.45; color: var(--px-text-muted); }
/* One row per slider: name, track, value */
.mo-edit-slider { display: grid; grid-template-columns: 92px minmax(0, 1fr) 46px; align-items: center; gap: var(--px-space-2); min-height: 26px; }
.mo-edit-slider.is-dim { opacity: 0.5; }
.mo-edit-slider-name { font-size: var(--px-text-sm); color: var(--px-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
.mo-edit-slider.is-changed .mo-edit-slider-name { color: var(--px-text); }
.mo-edit-value { justify-self: end; min-width: 40px; padding: 0 3px; border: 0; border-radius: 2px; background: transparent; color: var(--px-text-muted); font: inherit; font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; text-align: right; cursor: text; }
.mo-edit-slider.is-changed .mo-edit-value { color: var(--px-accent-text); font-weight: 600; }
.mo-edit-value:hover { background: var(--px-surface-hover); color: var(--px-text); }
.mo-edit-value-input { width: 46px; padding: 0 3px; border: 1px solid var(--px-accent); border-radius: 2px; background: var(--px-bg-inset); color: inherit; font: inherit; font-size: var(--px-text-sm); text-align: right; outline: none; }
.mo-edit-range { -webkit-appearance: none; appearance: none; width: 100%; height: 16px; margin: 0; background: transparent; cursor: pointer; }
.mo-edit-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--px-surface-active) var(--lo, 0%), var(--px-accent) var(--lo, 0%), var(--px-accent) var(--hi, 0%), var(--px-surface-active) var(--hi, 0%)); }
.mo-edit-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 12px; margin-top: -4px; border: 1px solid var(--px-border-strong); border-radius: 50%; background: var(--px-edit-knob); box-shadow: var(--px-shadow-sm); }
.mo-edit-range:focus-visible { outline: 1px solid var(--px-accent); outline-offset: 2px; }
.mo-edit-range--warmth::-webkit-slider-runnable-track { background: linear-gradient(to right, rgb(79, 127, 214), rgb(154, 164, 181), rgb(224, 176, 64)); }
.mo-edit-range--tint::-webkit-slider-runnable-track { background: linear-gradient(to right, rgb(61, 187, 106), rgb(154, 164, 181), rgb(214, 91, 196)); }
.mo-edit-range--vibrance::-webkit-slider-runnable-track, .mo-edit-range--saturation::-webkit-slider-runnable-track { background: linear-gradient(to right, rgb(138, 143, 153), rgb(90, 170, 230), rgb(217, 88, 76)); }
/* Chips (curve channels, crop shapes, Enhance) */
.mo-edit-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mo-edit-chipbtn { height: 26px; min-width: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: transparent; color: var(--px-text-secondary); font: inherit; font-size: var(--px-text-sm); cursor: pointer; }
.mo-edit-chipbtn:hover:not(:disabled) { background: var(--px-surface-hover); color: var(--px-text); }
.mo-edit-chipbtn.is-on { background: var(--px-surface-selected); border-color: color-mix(in srgb, var(--px-accent) 45%, transparent); color: var(--px-accent-text); }
.mo-edit-chipbtn:disabled { opacity: 0.4; }
.mo-edit-shape { display: inline-block; box-sizing: border-box; border: 1.5px solid currentColor; border-radius: 2px; opacity: 0.85; }
.mo-edit-shape--free { width: 12px; height: 12px; border-style: dashed; }
.mo-edit-iconrow { display: flex; gap: var(--px-space-1); }
.mo-edit-iconrow .px-btn--icon { border: 1px solid var(--px-border); }
.mo-edit-curve { display: block; width: 100%; aspect-ratio: 1 / 1; margin-top: var(--px-space-1); border: 1px solid var(--px-divider); border-radius: var(--px-radius-sm); background: var(--px-bg-inset); cursor: crosshair; touch-action: none; }
.mo-edit-dots { display: flex; justify-content: space-between; gap: 4px; margin-bottom: var(--px-space-1); }
.mo-edit-dot { width: 20px; height: 20px; padding: 0; border: 2px solid transparent; border-radius: 50%; cursor: pointer; box-shadow: 0 0 0 1px var(--px-border-strong); }
.mo-edit-dot.is-on { border-color: var(--px-text); }
.mo-edit-dot.is-set { box-shadow: 0 0 0 1px var(--px-border-strong), 0 0 0 3px var(--px-accent); }
.mo-edit-wheels { display: flex; justify-content: space-between; gap: 6px; margin-bottom: var(--px-space-1); }
.mo-edit-wheel-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mo-edit-wheel { position: relative; width: 72px; height: 72px; border-radius: 50%; cursor: crosshair; touch-action: none; box-shadow: 0 0 0 1px var(--px-border-strong); background: radial-gradient(circle, rgb(128, 128, 128) 0%, rgba(128, 128, 128, 0) 72%), conic-gradient(from 90deg, hsl(360, 85%, 55%), hsl(300, 85%, 55%), hsl(240, 85%, 55%), hsl(180, 85%, 55%), hsl(120, 85%, 55%), hsl(60, 85%, 55%), hsl(0, 85%, 55%)); }
.mo-edit-wheel-knob { position: absolute; width: 9px; height: 9px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--px-viewer-ink); border: 1px solid var(--px-viewer-scrim); pointer-events: none; }
.mo-edit-wheel-name { font-size: var(--px-text-xs); color: var(--px-text-muted); }
.mo-edit-progress { height: 4px; border-radius: 2px; background: var(--px-surface-active); overflow: hidden; }
.mo-edit-progress-fill { height: 100%; background: var(--px-accent); transition: width var(--px-dur-base, 180ms) var(--px-ease-out, ease-out); }
/* Remove */
.mo-edit-list { border: 1px solid var(--px-divider); border-radius: var(--px-radius-md); overflow: hidden; }
.mo-edit-li { display: flex; align-items: center; gap: var(--px-space-2); min-height: 40px; padding: var(--px-space-1) var(--px-space-1) var(--px-space-1) var(--px-space-2); border-bottom: 1px solid var(--px-divider); cursor: pointer; outline: none; }
.mo-edit-li:last-child { border-bottom: 0; }
.mo-edit-li:hover { background: var(--px-surface-hover); }
.mo-edit-li.is-on { background: var(--px-surface-selected); }
.mo-edit-li:focus-visible { box-shadow: inset 0 0 0 1px var(--px-accent); }
.mo-edit-li.is-hidden .mo-edit-removal-thumb, .mo-edit-li.is-hidden .mo-edit-li-text { opacity: 0.5; }
.mo-edit-removal-thumb { width: 36px; height: 24px; flex: none; border-radius: 3px; border: 1px solid var(--px-border); object-fit: cover; }
.mo-edit-li-text { flex: 1 1 auto; min-width: 0; }
.mo-edit-li-name { font-size: var(--px-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-edit-li-meta { font-size: var(--px-text-xs); color: var(--px-text-muted); }
.mo-edit-local { display: flex; align-items: center; gap: var(--px-space-1); padding: var(--px-space-3); font-size: var(--px-text-xs); color: var(--px-text-muted); border-top: 1px solid var(--px-divider); }
/* Setup cards (Remove, Enhance) */
.mo-edit-setup { margin: var(--px-space-3); padding: var(--px-space-3); border-radius: var(--px-radius-md); border: 1px solid var(--px-border); background: var(--px-bg-elevated); }
.mo-edit-setup-title { font-weight: 600; font-size: var(--px-text-sm); margin-bottom: var(--px-space-1); }
.mo-edit-setup p { margin: 0 0 var(--px-space-2); font-size: var(--px-text-sm); color: var(--px-text-secondary); }
.mo-edit-facts { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px 6px; margin-bottom: var(--px-space-3); font-size: var(--px-text-xs); color: var(--px-text-muted); }
.mo-edit-setup .mo-edit-progress { margin: var(--px-space-2) 0 var(--px-space-1); }
.mo-enhance-row { display: flex; gap: var(--px-space-2); flex-wrap: wrap; margin-top: var(--px-space-2); }
.mo-enhance-setup .mo-enhance-error { color: var(--px-danger); }
/* Enhance */
.mo-edit-fact { display: flex; justify-content: space-between; align-items: center; min-height: 26px; font-size: var(--px-text-sm); color: var(--px-text-secondary); }
.mo-edit-fact b { color: var(--px-text); font-weight: 600; font-variant-numeric: tabular-nums; }
/* Remove From Other Photos */
.mo-br-marks { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 14px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); }
.mo-br-marks:empty { display: none; }
.mo-br-marks-label { font-size: 11px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-br-mark { display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px; border: 1px solid var(--vscode-panel-border, var(--px-border)); border-radius: var(--parallx-radius-sm, 3px); font-size: 11px; cursor: pointer; }
.mo-br-mark img { display: block; height: 36px; max-width: 180px; object-fit: contain; background: var(--px-bg-inset, rgba(128, 128, 128, 0.1)); }
.mo-br-mark.is-plain { opacity: 0.6; cursor: default; }
.mo-br-pickbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 14px 0; }
.mo-br-pickbar[hidden] { display: none; }
.mo-br-picked { margin-left: 6px; font-size: 11px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-br-filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 14px 0; }
.mo-br-filters:empty { display: none; }
.mo-br-page .mo-dd.is-disabled { pointer-events: none; opacity: 0.5; }
.mo-br-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; padding: 12px 14px 20px; align-items: start; }
.mo-br-tile { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--vscode-panel-border, var(--px-border)); border-radius: var(--parallx-radius-md, 6px); overflow: hidden; background: var(--px-bg-inset, rgba(128, 128, 128, 0.06)); }
.mo-br-tile[hidden] { display: none; }
.mo-br-tile.is-ticked, .mo-br-tile.is-busy { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.mo-br-tile.is-ticked { box-shadow: inset 0 0 0 1px var(--vscode-focusBorder, var(--px-accent)); }
.mo-br-pic { cursor: pointer; }
.mo-br-pic { position: relative; width: 100%; margin: 0 auto; aspect-ratio: 3 / 2; background: var(--px-bg-inset, rgba(128, 128, 128, 0.1)); }
.mo-br-pic img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.mo-br-finds { position: absolute; inset: 0; }
.mo-br-find { position: absolute; box-sizing: border-box; min-width: 8px; min-height: 8px; padding: 0; border: 1px solid var(--vscode-focusBorder, var(--px-accent)); border-radius: 2px; background: transparent; cursor: pointer; }
.mo-br-find.is-unsure { border-color: var(--vscode-editorWarning-foreground, var(--px-warning, currentColor)); }
.mo-br-find.is-off { border-style: dashed; background: transparent; }
.mo-br-shape { position: absolute; inset: 0; pointer-events: none; background: var(--vscode-focusBorder, var(--px-accent)); opacity: 0.8; -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
.mo-br-find.is-unsure .mo-br-shape { background: var(--vscode-editorWarning-foreground, var(--px-warning, currentColor)); }
.mo-br-find.is-off .mo-br-shape { display: none; }
.mo-br-mark-pic { position: relative; display: block; }
.mo-br-find:focus-visible { outline: 2px solid var(--vscode-focusBorder, var(--px-accent)); outline-offset: 2px; }
.mo-br-find:disabled { cursor: default; }
.mo-br-cap { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; padding: 6px 8px; font-size: 12px; min-width: 0; }
.mo-br-pick { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 100%; cursor: pointer; }
.mo-br-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-br-status { flex: 1 1 auto; min-width: 0; font-size: 11px; color: var(--vscode-descriptionForeground, var(--px-text-secondary)); }
.mo-br-tile.is-unsure .mo-br-status { color: var(--vscode-editorWarning-foreground, var(--px-warning, currentColor)); }
.mo-br-tile.is-failed .mo-br-status { color: var(--vscode-errorForeground, var(--px-danger)); }
.mo-br-open { flex: 0 0 auto; }
.mo-practice-history-actions { display: flex; gap: 6px; }
/* Media Gallery block in pages */
.mo-page-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
.mo-page-gallery__tile { position: relative; aspect-ratio: 1; padding: 0; overflow: hidden; background: var(--px-bg-inset); border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); cursor: zoom-in; }
.mo-page-gallery__tile:hover { border-color: var(--px-border-strong); }
.mo-page-gallery__tile:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 1px; }
.mo-page-gallery__img { display: block; width: 100%; height: 100%; object-fit: cover; }
.mo-page-gallery__placeholder { display: flex; align-items: center; justify-content: center; height: 100%; padding: 6px; color: var(--px-text-muted); font-size: var(--px-text-xs); overflow-wrap: anywhere; }
.mo-page-gallery__badge { position: absolute; right: 4px; bottom: 4px; padding: 1px 6px; background: color-mix(in srgb, var(--px-bg) 80%, transparent); border-radius: var(--px-radius-sm); color: var(--px-text); font-size: var(--px-text-xs); }
`;
