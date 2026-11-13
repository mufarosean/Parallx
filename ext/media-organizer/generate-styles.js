// generate-styles.js — the Image Editor's Generate tab (edit-generate.js): its
// three steps in the panel, and what it draws over the picture. Loaded after
// styles.js.

export const MO_GENERATE_CSS = `
/* Over the picture: the mark, the brush, a try shown in place */
.mo-gen-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; --mo-gen-tint: var(--px-danger); }
.mo-gen-layer.is-brush { pointer-events: auto; cursor: none; touch-action: none; }
.mo-gen-layer:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: -2px; }
.mo-gen-ink { position: absolute; inset: 0; width: 100%; height: 100%; }
.mo-gen-try { position: absolute; left: 0; top: 0; transform-origin: 0 0; max-width: none; }
.mo-gen-cursor { position: absolute; border: 1.5px solid var(--px-text-on-accent); box-shadow: 0 0 0 1px var(--px-bg); border-radius: var(--px-radius-full); transform: translate(-50%, -50%); pointer-events: none; }

/* The panel: one block per step, one line between blocks */
.mo-gen-step { display: flex; flex-direction: column; gap: var(--px-space-2); padding: var(--px-space-3); border-bottom: 1px solid var(--px-border); }
.mo-gen-step-head { display: flex; align-items: center; gap: var(--px-space-2); }
.mo-gen-step-n { flex: 0 0 auto; width: 20px; height: 20px; border-radius: var(--px-radius-full); background: var(--px-surface-active); color: var(--px-text-secondary); font-size: var(--px-text-xs); font-weight: 600; display: flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
.mo-gen-step-n.is-done { background: var(--px-accent); color: var(--px-text-on-accent); }
.mo-gen-step-title { flex: 1 1 auto; font-size: var(--px-text-sm); font-weight: 600; }
.mo-gen-ok { font-size: var(--px-text-xs); color: var(--px-success); }
.mo-gen-ways { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--px-space-1); }
.mo-gen-ways .px-btn { justify-content: center; }
.mo-gen-ways .px-btn:last-child:nth-child(odd) { grid-column: 1 / -1; } /* an odd one out takes the row */
.mo-gen-ways .px-btn.is-on { background: var(--px-accent-soft); color: var(--px-accent-text); border-color: var(--px-accent); }
.mo-gen-row { display: flex; align-items: center; gap: var(--px-space-2); }
.mo-gen-row > .mo-edit-range, .mo-gen-row > .mo-gen-dim { flex: 1 1 auto; }
.mo-gen-row > .mo-gen-dim:first-child:not(:only-child) { flex: 0 0 auto; }
.mo-gen-val { flex: 0 0 auto; min-width: 48px; text-align: right; font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; }
.mo-gen-dim { margin: 0; font-size: var(--px-text-xs); color: var(--px-text-secondary); line-height: 1.45; }
.mo-gen-pad { padding: var(--px-space-3); }
.mo-gen-error { margin: 0; font-size: var(--px-text-xs); color: var(--px-danger); line-height: 1.45; }
.mo-gen-running { margin: 0; font-size: var(--px-text-sm); font-weight: 600; }
.mo-gen-text { width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; max-height: var(--px-textarea-max-h, 240px); padding: var(--px-space-2); border: 1px solid var(--px-border-strong); border-radius: var(--px-radius-md); background: var(--px-bg-inset); color: var(--px-text); font: inherit; font-size: var(--px-text-sm); line-height: 1.45; }
.mo-gen-text:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 1px; }
.mo-gen-starts { display: flex; flex-wrap: wrap; gap: var(--px-space-1); }
.px-btn.mo-gen-go { width: 100%; justify-content: center; }
.mo-gen-card { display: flex; flex-direction: column; gap: var(--px-space-2); }
.mo-gen-meter { height: 6px; border-radius: var(--px-radius-full); background: var(--px-surface-active); overflow: hidden; }
.mo-gen-meter-fill { height: 100%; background: var(--px-warning); }
.mo-gen-tries { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--px-space-2); }
.px-btn.mo-gen-thumb { position: relative; height: 72px; padding: 0; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-inset); overflow: hidden; }
.px-btn.mo-gen-thumb > :not(img) { display: none; } /* the picture is the button's face; its name is still read out */
.mo-gen-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; background: var(--px-bg-inset); }
.px-btn.mo-gen-thumb.is-on { border-color: var(--px-accent); box-shadow: 0 0 0 1px var(--px-accent); }
.mo-gen-thumb:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 1px; }
`;
