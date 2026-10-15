// plan-styles.js — the painting plan editor's styles for its frame (plan-shell.js)
// and its five steps. Loaded after styles.js, so these rules win over the older
// plan rules there.

export const MO_PLAN_CSS = `
/* The steps down the rail */
.mo-plan-tools { flex: 0 0 72px; gap: var(--px-space-1); padding: var(--px-space-2) 0; }
.px-btn.mo-plan-step { position: relative; width: 60px; height: auto; flex-direction: column; gap: 3px; padding: 8px 0 6px; font-size: var(--px-text-2xs); color: var(--px-text-secondary); }
.px-btn.mo-plan-step .px-btn__label { white-space: nowrap; }
.px-btn.mo-plan-step:hover { color: var(--px-text); }
.px-btn.mo-plan-step.is-on { background: var(--px-accent-soft); color: var(--px-accent-text); }
.mo-plan-step-n { position: absolute; top: 3px; left: 6px; font-size: var(--px-text-2xs); line-height: 1; opacity: 0.6; font-variant-numeric: tabular-nums; }
.px-btn.mo-plan-step + .px-btn.mo-plan-step::before { content: ''; position: absolute; top: -4px; left: 50%; width: 1px; height: 4px; background: var(--px-border); }

.mo-plan-panel { flex-basis: 280px; }

/* The top bar: icons, then Export with its menu */
.mo-plan-topbar { padding: var(--px-space-1) var(--px-space-3); min-height: 40px; }
.mo-plan-topbar-right { gap: 2px; }
.mo-plan-topbar .px-btn--icon[aria-pressed="true"] { background: var(--px-accent-soft); color: var(--px-accent-text); }
.mo-plan-sep { width: 1px; height: 18px; margin: 0 var(--px-space-2); background: var(--px-border); flex: none; }
.mo-plan-export { display: inline-flex; }
.mo-plan-export .px-btn--primary { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.mo-plan-export .mo-plan-export-more { border-top-left-radius: 0; border-bottom-left-radius: 0; background: var(--px-accent); color: var(--px-text-on-accent); box-shadow: inset 1px 0 0 color-mix(in srgb, var(--px-text-on-accent) 30%, transparent); }
.mo-plan-export .mo-plan-export-more:hover { background: var(--px-accent-hover, var(--px-accent)); }

/* The view: zoom and move */
.mo-plan-stage { overflow: hidden; touch-action: none; }
.mo-plan-stage:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: calc(-1 * var(--px-focus-width)); }
.mo-plan-stage.is-zoomed, .mo-plan-stage.is-panning .mo-plan-frame { cursor: grab; }
.mo-plan-stage.is-panning, .mo-plan-stage.is-panning * { cursor: grabbing !important; }
.mo-plan-frame { flex: none; transform-origin: 50% 50%; }
.mo-plan-hud { position: absolute; right: var(--px-space-3); bottom: var(--px-space-3); z-index: 6; display: flex; align-items: center; gap: var(--px-space-1); padding: 2px 2px 2px var(--px-space-3); border-radius: var(--px-radius-full); background: var(--px-viewer-scrim); color: var(--px-viewer-ink); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; }
.mo-plan-hud .px-btn { color: var(--px-viewer-ink); border-radius: var(--px-radius-full); }
/* Marks on the picture keep their size on screen at any zoom */
.mo-plan-crophandle, .mo-pc-ba-knob, .mo-pc-pin, .mo-pc-loupe, .mo-pc-loupe-tag, .mo-ps-spot, .mo-pc-ba-tag { scale: calc(1 / var(--mo-plan-zoom, 1)); }
.mo-plan-cropbox { border-width: calc(1px / var(--mo-plan-zoom, 1)); }
.mo-pc-ba-line { width: calc(24px / var(--mo-plan-zoom, 1)); margin-left: calc(-12px / var(--mo-plan-zoom, 1)); }
.mo-pc-ba-line::before { left: 50%; width: calc(2px / var(--mo-plan-zoom, 1)); transform: translateX(-50%); }
.mo-pc-ba-tag { transform-origin: top center; }
/* Before And After sits over every layer, so its line can always be dragged */
.mo-plan-frame .mo-pc-ba { z-index: 4; }

/* The variations strip: + saves a new one */
.mo-pv-list { align-items: flex-start; }
.px-btn.mo-pv-add { flex: none; width: 56px; height: 56px; margin-top: 4px; border: 1px dashed var(--px-border); border-radius: var(--px-radius-md); color: var(--px-text-secondary); }
.px-btn.mo-pv-add:hover { color: var(--px-text); border-color: var(--px-text-muted); }
.mo-plan-variant-actions { align-items: center; gap: 2px; }

/* Compose */
.mo-pk-size .mo-clip-input--xs { flex: 1 1 0; min-width: 0; }
.mo-pk-icons { gap: 2px; }
.mo-pk-guides { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--px-space-1); }
.px-btn.mo-pk-guide { height: auto; flex-direction: column; gap: 4px; padding: var(--px-space-2) 2px; border: 1px solid transparent; font-size: var(--px-text-xs); color: var(--px-text-secondary); }
.px-btn.mo-pk-guide[aria-pressed="true"] { border-color: var(--px-accent); color: var(--px-text); background: var(--px-accent-soft); }
.mo-pk-guide-art svg { display: block; width: 34px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.2; }
.mo-plan-switch { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-2); font-size: var(--px-text-sm); }

/* Photo: Enhance, the Image Editor's sections, Remove */
.mo-plan { --mo-edit-line: var(--px-text); --mo-edit-faint: var(--px-border); }
.mo-pp-sections { margin: 0 calc(-1 * var(--px-space-3)); }
.mo-pp-sections .mo-edit-section:first-child { border-top: 0; }
.mo-pp-status { padding: var(--px-space-2); border-radius: var(--px-radius-md); background: var(--px-accent-soft); color: var(--px-text); font-size: var(--px-text-sm); }
.mo-pp-status.is-stale { background: color-mix(in srgb, var(--px-warning) 16%, transparent); }
.mo-pp-job { display: flex; flex-direction: column; gap: var(--px-space-1); font-size: var(--px-text-sm); }
.mo-pp-job-bar { height: 6px; border-radius: var(--px-radius-full); background: var(--px-bg-inset); overflow: hidden; }
.mo-pp-job-fill { height: 100%; width: 0; background: var(--px-accent); transition: width var(--px-dur-base) var(--px-ease); }
.mo-pp-paint { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.mo-pp-layer.is-picking { cursor: copy; }

/* Values: the underpainting paints and the stages */
.mo-pv-unders { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--px-space-1); }
.px-btn.mo-pv-under { height: auto; flex-direction: column; gap: 4px; padding: var(--px-space-2) 2px; border: 1px solid transparent; font-size: var(--px-text-2xs); line-height: 1.2; color: var(--px-text-secondary); white-space: normal; text-align: center; }
.px-btn.mo-pv-under .px-btn__label { white-space: normal; }
.px-btn.mo-pv-under[aria-pressed="true"] { border-color: var(--px-accent); color: var(--px-text); background: var(--px-accent-soft); }
.mo-pv-under-dot { width: 24px; height: 24px; border-radius: var(--px-radius-full); background: var(--px-text-muted); box-shadow: var(--px-ring); }
.mo-pv-stages { display: flex; gap: 2px; padding: 2px; border-radius: var(--px-radius-md); background: var(--px-bg-inset); }
.px-btn.mo-pv-stage { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--px-text-secondary); }
.px-btn.mo-pv-stage[aria-pressed="true"] { background: var(--px-bg); color: var(--px-text); box-shadow: var(--px-ring); }

/* Colour: the masses are the palette */
.mo-ps-pal { display: flex; flex-direction: column; gap: 1px; margin: 0 calc(-1 * var(--px-space-2)); }
.px-btn.mo-ps-prow { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; grid-template-areas: "sw name num" "sw mix mix"; align-items: center; column-gap: var(--px-space-2); row-gap: 4px; width: 100%; height: auto; padding: 6px var(--px-space-2); text-align: left; font-weight: normal; }
.px-btn.mo-ps-prow .mo-ps-sw { grid-area: sw; width: 22px; height: 22px; border-radius: var(--px-radius-sm); align-self: start; }
.px-btn.mo-ps-prow .px-btn__label { grid-area: name; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--px-text); }
.px-btn.mo-ps-prow .mo-ps-num { grid-area: num; display: inline-flex; align-items: center; gap: var(--px-space-1); }
.px-btn.mo-ps-prow[aria-pressed="true"] { background: var(--px-accent-soft); }
.mo-ps-mixbar { grid-area: mix; display: flex; height: 6px; border-radius: var(--px-radius-full); overflow: hidden; }
.mo-ps-mixbar--lg { height: 10px; }
.mo-ps-tw { padding: 0 5px; border-radius: var(--px-radius-full); font-size: var(--px-text-2xs); line-height: 16px; }
.mo-ps-tw.is-warm { color: var(--px-warning); box-shadow: inset 0 0 0 1px var(--px-warning); }
.mo-ps-tw.is-cool { color: var(--px-info); box-shadow: inset 0 0 0 1px var(--px-info); }
.mo-ps-recipe { display: flex; flex-direction: column; gap: var(--px-space-2); margin: 0 var(--px-space-2) var(--px-space-2) calc(22px + var(--px-space-4)); }
.mo-ps-parts { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-size: var(--px-text-sm); }
.mo-ps-parts li { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: var(--px-space-2); align-items: center; }
.mo-ps-parts b { font-weight: 600; font-variant-numeric: tabular-nums; }
.mo-ps-match { display: flex; flex-wrap: wrap; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-xs); }
.mo-ps-match .mo-ps-sw { width: 16px; height: 16px; }
.mo-ps-cmp { display: flex; flex-direction: column; gap: var(--px-space-2); }
.mo-ps-ab { display: flex; gap: var(--px-space-2); }
.mo-ps-ab span { flex: 1; height: 26px; border-radius: var(--px-radius-sm); display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--px-viewer-ink); text-shadow: 0 0 2px var(--px-viewer-bar); box-shadow: var(--px-ring); }

/* A choice of a few fills its row */
.mo-plan-panel .ui-segmented-control { display: flex; width: 100%; }
.mo-plan-panel .ui-segmented-control__segment { flex: 1 1 0; min-width: 0; padding: 2px; overflow: hidden; text-overflow: ellipsis; }
`;
