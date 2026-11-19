// colour-study-styles.js — Colour Study's styles (colour-study.js): two columns
// that stack when narrow, the wheel with its dots, the palette's lightness
// bars, the colour card on its ground, the rows of cells, the mix bench and
// the paints. Colours on the page that are paint (a swatch, a cell, the
// ground) are set from data; everything else is a token.

export const MO_COLOUR_CSS = `
.mo-cs { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--px-bg); color: var(--px-text); font-size: var(--px-text-sm); }
.mo-cs-top { display: flex; align-items: center; gap: var(--px-space-2); padding: var(--px-space-2) var(--px-space-4); border-bottom: 1px solid var(--px-border); flex: none; }
.mo-cs-title { margin: 0; font-size: var(--px-text-md); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mo-cs-grow { flex: 1; }
.mo-cs-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--px-space-5); padding: var(--px-space-4); width: 100%; margin: 0 auto; box-sizing: border-box; }
.mo-cs-left { flex: 0 0 300px; max-width: 100%; display: flex; flex-direction: column; gap: var(--px-space-3); }
.mo-cs-right { flex: 1 1 420px; min-width: 0; container-type: inline-size; display: flex; flex-direction: column; gap: var(--px-space-3); }
.mo-cs-block, .mo-cs-view { display: flex; flex-direction: column; gap: var(--px-space-2); min-width: 0; }
.mo-cs-line { display: flex; align-items: center; gap: var(--px-space-2); min-width: 0; }
.mo-cs-wrap { flex-wrap: wrap; }
.mo-cs-cap { font-size: var(--px-text-xs); line-height: var(--px-leading-base); }
.mo-cs .mo-practice-section-title { margin-bottom: 0; }
.mo-cs-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.mo-cs .px-btn[aria-pressed="true"] { background: var(--px-accent-soft); color: var(--px-accent-text); }
.mo-cs.is-grey .mo-cs-body, .mo-cs-row.is-grey .mo-cs-cells, .mo-cs-cmp.is-grey { filter: grayscale(1); }

/* swatches */
.mo-cs-sw { flex: none; width: 18px; height: 18px; border-radius: var(--px-radius-xs); box-shadow: var(--px-ring); }
.mo-cs-sw-sm { width: 10px; height: 10px; border-radius: var(--px-radius-full); }

/* the wheel */
.mo-cs-wheel { position: relative; width: 100%; max-width: 280px; aspect-ratio: 1; align-self: center; touch-action: none; }
.mo-cs-wheel-canvas { display: block; border-radius: var(--px-radius-full); cursor: crosshair; touch-action: none; }
.mo-cs-dots { position: absolute; inset: 0; pointer-events: none; }
.mo-cs-dot { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: var(--px-radius-full); border: 2px solid white; box-shadow: 0 0 0 1px black; display: grid; place-items: center; font-size: var(--px-text-2xs); font-weight: 600; line-height: 1; cursor: grab; pointer-events: auto; touch-action: none; box-sizing: border-box; }
.mo-cs-dot.is-on { width: 28px; height: 28px; margin: -14px 0 0 -14px; border-width: 3px; }
.mo-cs-dot:focus-visible, .mo-cs-vbar:focus-visible, .mo-cs-picture:focus-visible, .mo-cs-cell:focus-visible, .mo-cs-pal-pick:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 2px; }

/* the palette */
.mo-cs-pal { display: flex; flex-direction: column; gap: var(--px-space-1); }
.mo-cs-pal-row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--px-space-2); padding: 2px var(--px-space-1); border-radius: var(--px-radius-sm); }
.mo-cs-pal-row.is-on { background: var(--px-surface-selected); }
.mo-cs-pal-pick { display: inline-flex; align-items: center; gap: var(--px-space-2); padding: 2px; border: 0; border-radius: var(--px-radius-sm); background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
.mo-cs-pal-n { width: 12px; text-align: center; color: var(--px-text-muted); font-size: var(--px-text-xs); }
.mo-cs-vbar { position: relative; height: 16px; min-width: 48px; border-radius: var(--px-radius-full); background: linear-gradient(90deg, black, white); box-shadow: var(--px-ring); cursor: ew-resize; touch-action: none; }
.mo-cs-vbar-knob { position: absolute; top: -3px; width: 6px; height: 22px; margin-left: -3px; border-radius: var(--px-radius-xs); background: var(--px-text); box-shadow: 0 0 0 1px var(--px-bg); }
.mo-cs .mo-pc-close:empty { display: none; }

/* the picture */
.mo-cs-picture-box { position: relative; align-self: flex-start; max-width: 100%; line-height: 0; }
.mo-cs-picture { display: block; max-width: 100%; height: auto; border-radius: var(--px-radius-sm); cursor: crosshair; touch-action: none; }
.mo-cs-pin { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: var(--px-radius-full); border: 2px solid white; box-shadow: 0 0 0 1px black; pointer-events: none; box-sizing: border-box; }
.mo-cs-picker { display: flex; flex-direction: column; gap: var(--px-space-2); padding: var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); }
.mo-cs-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: var(--px-space-1); max-height: 220px; overflow-y: auto; }
.mo-cs-picker-grid .px-btn { height: auto; padding: 0; }
.mo-cs-picker-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--px-radius-xs); display: block; }
.mo-cs-masses { display: flex; flex-direction: column; }
.mo-cs-masses .px-btn.mo-cs-mass { height: auto; justify-content: flex-start; gap: var(--px-space-2); padding: 3px var(--px-space-1); text-align: left; }
.mo-cs-mass-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* the colour and its mix */
.mo-cs-card { display: flex; flex-wrap: wrap; gap: var(--px-space-4); padding: var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); }
.mo-cs-ground-col { display: flex; flex-direction: column; gap: var(--px-space-1); flex: none; }
.mo-cs-ground { display: flex; padding: var(--px-space-3); border-radius: var(--px-radius-md); }
.mo-cs-target, .mo-cs-mix { width: 64px; height: 52px; }
.mo-cs-target { border-radius: var(--px-radius-xs) 0 0 var(--px-radius-xs); }
.mo-cs-mix { border-radius: 0 var(--px-radius-xs) var(--px-radius-xs) 0; }
.mo-cs-ground-cap { display: flex; padding: 0 var(--px-space-3); font-size: var(--px-text-2xs); color: var(--px-text-muted); }
.mo-cs-ground-cap span { width: 64px; text-align: center; }
.mo-cs-card-words { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: var(--px-space-2); }
.mo-cs-card-acts { margin-left: auto; display: flex; align-items: center; gap: 2px; flex: none; align-self: flex-start; }
.mo-cs-parts-bar { display: flex; height: 14px; max-width: 320px; border-radius: var(--px-radius-xs); overflow: hidden; box-shadow: var(--px-ring); }
.mo-cs-chip-role { min-height: 1.4em; font-size: var(--px-text-xs); }
.mo-cs-name { font-size: var(--px-text-lg); font-weight: 600; line-height: var(--px-leading-tight); }
.mo-cs-sub { font-variant-numeric: tabular-nums; }
.mo-cs-chips { display: flex; flex-wrap: wrap; gap: var(--px-space-1); }
.mo-cs-chips .px-btn.mo-cs-chip { height: auto; gap: 5px; padding: 2px var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-full); font-size: var(--px-text-xs); }
.mo-cs-chips .px-btn.mo-cs-chip[aria-pressed="true"] { border-color: var(--px-accent); }
.mo-cs-role { font-size: var(--px-text-xs); }

/* the rows */
.mo-cs-rows-view { position: relative; }
.mo-cs-row { display: grid; grid-template-columns: minmax(0, 1fr) 236px; column-gap: var(--px-space-4); align-items: center; }
.mo-cs-row-main { display: flex; flex-direction: column; gap: var(--px-space-1); min-width: 0; }
.mo-cs .px-btn.mo-cs-why-btn { width: 20px; height: 20px; color: var(--px-text-muted); }
.mo-cs-why { position: absolute; width: 320px; max-width: calc(100% - var(--px-space-4)); padding: var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-border-strong); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); box-shadow: var(--px-shadow-md); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.mo-cs-why-title { color: var(--px-text); font-weight: 600; margin-bottom: 2px; }
@container (max-width: 680px) { .mo-cs-row { grid-template-columns: minmax(0, 1fr); } .mo-cs-row-note { margin-top: var(--px-space-1); } }
.mo-cs-cells { display: flex; gap: 2px; }
.mo-cs-cells .px-btn.mo-cs-cell { flex: 1; min-width: 0; width: auto; height: 30px; padding: 0; border: 0; border-radius: var(--px-radius-xs); cursor: pointer; }
.mo-cs-cell.is-base { box-shadow: 0 0 0 2px var(--px-bg), 0 0 0 3px var(--px-text); position: relative; }
/* the base carries a mark of its own, so it is told from the shown cell without colour */
.mo-cs-cell.is-base::after { content: ''; position: absolute; left: 3px; top: 3px; width: 6px; height: 6px; border-radius: var(--px-radius-full); background: white; box-shadow: 0 0 0 1px black; }
.mo-cs-cell.is-shown { box-shadow: 0 0 0 2px var(--px-bg), 0 0 0 4px var(--px-accent); position: relative; }
.mo-cs-nums { display: flex; gap: 2px; font-size: var(--px-text-2xs); color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.mo-cs-nums span { flex: 1; text-align: center; }
.mo-cs-row-note { min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-left: var(--px-space-3); border-left: 2px solid var(--px-divider); font-size: var(--px-text-xs); line-height: var(--px-leading-tight); }
.mo-cs-note-fact { color: var(--px-text); }
.mo-cs-note-advice { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--px-text-muted); }
.mo-cs-note-paint { color: var(--px-text-secondary); }
.mo-cs-fix-advice { padding: var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-divider); border-radius: var(--px-radius-md); background: var(--px-bg-inset); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.mo-cs-compare, .mo-cs-tubes { display: flex; flex-direction: column; gap: var(--px-space-2); padding-top: var(--px-space-3); border-top: 1px solid var(--px-divider); }
.mo-cs-cmp { flex: none; width: 44px; height: 32px; border-radius: var(--px-radius-xs); box-shadow: var(--px-ring); }
.mo-cs-cmp:nth-child(2) { margin-right: var(--px-space-3); }
.mo-cs-verdict { margin-left: var(--px-space-2); }
.mo-cs-notes { width: 100%; box-sizing: border-box; min-height: 48px; padding: var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); background: var(--px-bg-inset); color: var(--px-text); font: inherit; resize: vertical; }
.mo-cs-notes:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 1px; }

/* the bench */
.mo-cs-drift { font-size: var(--px-text-base); min-height: 1.4em; }
.mo-cs-tube-list, .mo-cs-paint-list { display: flex; flex-direction: column; }
.mo-cs-tube { display: grid; grid-template-columns: auto minmax(90px, 150px) auto 1fr auto; align-items: center; gap: var(--px-space-2); padding: var(--px-space-1) 0; border-bottom: 1px solid var(--px-divider); }
.mo-cs-tube-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-cs-step { display: inline-flex; align-items: center; gap: 2px; }
.mo-cs-parts { min-width: 24px; text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; }
.mo-cs-nudges { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--px-space-2); }
.mo-cs-nudges .px-btn.mo-cs-nudge { height: auto; flex-direction: column; align-items: stretch; gap: 2px; padding: var(--px-space-1); text-align: left; white-space: normal; font-size: var(--px-text-xs); }
.mo-cs-nudge b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-cs-nudge-sw { display: block; height: 30px; border-radius: var(--px-radius-xs); box-shadow: var(--px-ring); }

/* the paints */
.mo-cs-paint { display: grid; grid-template-columns: auto minmax(90px, 1fr) minmax(140px, 1fr) auto; align-items: center; gap: var(--px-space-2); padding: var(--px-space-1) 0; border-bottom: 1px solid var(--px-divider); }
.mo-cs-paint .px-btn.mo-cs-paint-colour { padding: 2px; }
.mo-cs-strength { min-width: 0; font-size: var(--px-text-xs); }
.mo-cs-strength .mo-plan-slider { margin: 0; }
.mo-cs-tube-chip { gap: 5px; }
.mo-cs-tube-chip[aria-pressed="false"] { opacity: 0.55; text-decoration: line-through; }

/* the home */
.mo-cs-home-strip { display: flex; height: 56px; border-radius: var(--px-radius-sm); overflow: hidden; }
.mo-cs-home-strip span { flex: 1; }
@media (prefers-reduced-motion: no-preference) { .mo-cs-dot { transition: width var(--px-dur-fast) var(--px-ease), height var(--px-dur-fast) var(--px-ease); } }
`;
