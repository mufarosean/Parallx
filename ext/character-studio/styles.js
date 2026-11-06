// styles.js — Character Studio's stylesheet: added while the tool runs,
// removed when it is turned off. Tokens only (--px-*).

export const CS_CSS = `
.cs-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--px-bg); color: var(--px-text); }
.cs-header { flex: none; padding: 0 var(--px-space-6); border-bottom: 1px solid var(--px-divider); }
.cs-main { flex: 1; display: flex; min-height: 0; }
.cs-stage { position: relative; flex: 1; min-width: 0; background: var(--px-bg-inset); }
.cs-canvas { display: block; width: 100%; height: 100%; outline: none; touch-action: none; cursor: grab; }
.cs-canvas:active { cursor: grabbing; }
.cs-canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--px-accent); }
.cs-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; margin: 0; padding: var(--px-space-6); text-align: center; font-size: var(--px-text-sm); color: var(--px-text-muted); }
.cs-stage-tools { position: absolute; top: var(--px-space-2); left: var(--px-space-2); display: flex; gap: var(--px-space-1); padding: var(--px-space-1); background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); box-shadow: var(--px-shadow-sm); }
.cs-controls { flex: none; width: 360px; max-width: 45%; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--px-divider); background: var(--px-bg); }
.cs-tabs { flex: none; padding: 0 var(--px-space-2); border-bottom: 1px solid var(--px-divider); }
.cs-tabs .ui-tab { flex: 1 1 0; min-width: 0; justify-content: center; padding: 0 var(--px-space-2); }
.cs-tab-body { flex: 1; overflow: auto; padding: var(--px-space-3) var(--px-space-4) var(--px-space-6); }
.cs-slider { padding: var(--px-space-1) 0 var(--px-space-2); }
.cs-slider-head { display: flex; justify-content: space-between; gap: var(--px-space-2); font-size: var(--px-text-sm); }
.cs-slider-name { color: var(--px-text-secondary); }
.cs-slider-value { color: var(--px-text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cs-row-actions { display: flex; gap: var(--px-space-2); padding-top: var(--px-space-3); }

.cs-section { padding-bottom: var(--px-space-4); }
.cs-section > .ui-choice-grid { margin-top: var(--px-space-2); }

/* The characters list (sidebar) */
.cs-side { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.cs-side-head { display: flex; align-items: center; justify-content: space-between; padding: var(--px-space-2) var(--px-space-3) var(--px-space-1); }
.cs-side-list { flex: 1; overflow: auto; padding: 0 var(--px-space-2) var(--px-space-3); }
.cs-side-row { display: flex; align-items: center; gap: var(--px-space-2); border-radius: var(--px-radius-sm); }
.cs-side-row:hover, .cs-side-row:focus-within { background: var(--px-surface-hover); }
.cs-side-open { flex: 1; min-width: 0; justify-content: flex-start; gap: var(--px-space-2); height: auto; min-height: 40px; padding: var(--px-space-1); }
.cs-side-open > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-side-open.cs-has-thumb > :not(span):not(img) { display: none; }
.cs-side-thumb { order: -1; flex: none; width: 32px; height: 32px; border-radius: var(--px-radius-sm); background: var(--px-bg-inset); object-fit: cover; }
.cs-side-empty { padding: var(--px-space-4) var(--px-space-3); }
`;
