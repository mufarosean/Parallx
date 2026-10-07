// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 40: CSS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Every st-* rule the sidebar, the pane and the dashboard widget use, written
// once into one <style id="study-styles">. The look is docs/mockups/study.html
// on the app's tokens: the card is the Flashcards white serif stock (the
// --px-stock-* tokens), everything around it is the workbench's own chrome.
// Motion only through --px-dur-* and --px-ease*; reduced motion collapses it
// all (the core stills everything in px-motion.css, and the same two
// selectors are repeated here scoped to Study so the rule holds on its own).
// Copied from the Flashcards injectStyles pattern (one style element, an
// idempotent guard) so Study turned on twice never writes its rules twice.

let _stStyleInjected = false;

function injectStyles() {
  if (_stStyleInjected) return;
  if (document.getElementById('study-styles')) { _stStyleInjected = true; return; }
  _stStyleInjected = true;
  const style = document.createElement('style');
  style.id = 'study-styles';
  style.textContent = `
/* ── Pane root ──────────────────────────────────────────────────────────── */
.st-root { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--px-window); color: var(--px-text); font-size: var(--px-text-base); outline: none; }
.st-root:focus-visible { box-shadow: inset 0 0 0 1px var(--px-accent); }
.st-root .svg-icon { display: inline-flex; }
.st-error { margin: var(--px-space-8) auto; max-width: 70ch; padding: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); color: var(--px-text-secondary); display: grid; gap: var(--px-space-3); }
.st-error__t { font-weight: 600; color: var(--px-text); }
.st-sp { flex: 1; }
.st-num { font-variant-numeric: tabular-nums; }
.st-faint { color: var(--px-text-faint); }
.st-muted { color: var(--px-text-muted); }

/* ── Session toolbar and the strand ─────────────────────────────────────── */
.st-sess { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--px-window); }
.st-sess-tb { display: flex; align-items: center; gap: var(--px-space-3); height: 40px; padding: 0 var(--px-space-4); border-bottom: 1px solid var(--px-divider); background: var(--px-bg); flex: none; }
.st-sess-tb__scope { font-size: var(--px-text-sm); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.st-sess-tb__scope .m { color: var(--px-text-muted); font-weight: 400; }
.st-strand { display: flex; gap: 3px; flex: 0 1 240px; min-width: 120px; }
.st-strand i { flex: 1; height: 3px; border-radius: var(--px-radius-full); background: var(--px-surface-active); transition: background var(--px-dur-base) var(--px-ease), transform var(--px-dur-base) var(--px-ease-spring); }
.st-strand i.ok { background: var(--px-success); }
.st-strand i.no { background: var(--px-danger); }
.st-strand i.cur { background: var(--px-accent); }
.st-strand i.just { transform: scaleY(1.9); }
.st-sess-main { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; padding: var(--px-space-5) var(--px-space-6) var(--px-space-6); overflow-y: auto; }
.st-qwrap { width: 100%; max-width: 760px; position: relative; }

/* ── Eyebrow ────────────────────────────────────────────────────────────── */
.st-eyebrow { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-text-muted); margin-bottom: var(--px-space-2); min-height: var(--px-control-h-sm); }
.st-eyebrow__cpt { color: var(--px-text-secondary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-eyebrow__dot { width: 3px; height: 3px; border-radius: var(--px-radius-full); background: var(--px-text-faint); flex: none; }
.st-eyebrow__src { color: var(--px-text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-eyebrow__acts { margin-left: auto; display: inline-flex; align-items: center; gap: var(--px-space-1); }
.st-eyebrow__acts .px-btn { color: var(--px-text-faint); }

/* ── The card: the Flashcards stock, white paper and dark ink in every
   theme (the --px-stock-* tokens are the same in light and dark). ───────── */
.st-card { background: var(--px-stock); border: 1px solid var(--px-stock-edge); box-shadow: var(--px-stock-shadow); padding: var(--px-space-5) var(--px-space-6) var(--px-space-2); color: var(--px-stock-ink); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-card--leaving { animation: st-card-out var(--px-dur-fast) var(--px-ease) forwards; }
@keyframes st-card-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes st-card-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(-14px); } }
/* Card ink is a book serif, as the Flashcards card: printed-card text, not
   UI chrome. It matches KaTeX's serif math, so a formula in a stem reads as
   one sentence instead of sans colliding with serif math. The one deliberate
   font-family in the extension; the keycaps and hints inherit the UI face. */
.st-card__q, .st-opt__text, .st-ta__field, .st-ta__line, .st-ta__num, .st-quote__text, .st-full__text, .st-learn__pt, .st-review__stem, .st-review__ans { font-family: Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, 'Times New Roman', serif; }
.st-card__q { font-size: var(--px-text-xl); font-weight: 700; line-height: 1.35; margin: 0 0 var(--px-space-4); }
.st-card__q .px-markdown p { margin: 0; }
.st-card .px-markdown code { background: var(--px-stock-well); color: var(--px-stock-ink); }
.st-card .px-markdown pre { background: var(--px-stock-well); border-color: var(--px-stock-edge); color: var(--px-stock-ink); }
.st-card .px-markdown a { color: var(--px-accent-text); }
/* Options: rows on the card with a keycap at the left, divided by the card's
   own hairline. No radio circles: the keycap is the letter and the key. */
.st-opts { margin: 0 calc(var(--px-space-6) * -1); border-top: 1px solid var(--px-stock-line); }
.st-opt { display: flex; align-items: flex-start; gap: var(--px-space-3); padding: 11px var(--px-space-6); border-bottom: 1px solid var(--px-stock-line); font-size: var(--px-text-md); line-height: 1.45; cursor: pointer; position: relative; transition: background var(--px-dur-fast) var(--px-ease), transform var(--px-dur-instant) var(--px-ease); }
.st-opt:last-child { border-bottom: 0; }
.st-opt:hover { background: var(--px-stock-well); }
.st-opt:active { transform: var(--px-press); }
.st-opt__text { flex: 1; min-width: 0; }
.st-opt__text .px-markdown p { margin: 0; }
.st-opt__key { flex: none; width: 20px; height: 20px; margin-top: 1px; border: 1px solid var(--px-stock-line); border-radius: var(--px-radius-sm); font-size: var(--px-text-xs); font-weight: 500; line-height: 18px; text-align: center; color: var(--px-stock-ink-faint); transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease), border-color var(--px-dur-fast) var(--px-ease); }
.st-opt__mark { flex: none; width: 16px; height: 16px; margin: 3px 0 0 auto; opacity: 0; transform: scale(.6); transition: opacity var(--px-dur-fast) var(--px-ease), transform var(--px-dur-base) var(--px-ease-spring); }
.st-opts--done .st-opt { cursor: default; }
.st-opts--done .st-opt:hover { background: transparent; }
.st-opt--right { background: rgba(var(--px-green-rgb), .09); }
.st-opt--right .st-opt__key { background: var(--px-success); border-color: var(--px-success); color: var(--px-stock); }
.st-opt--right .st-opt__mark { opacity: 1; transform: none; color: var(--px-success); }
.st-opt--wrong { background: rgba(var(--px-red-rgb), .08); }
.st-opt--wrong .st-opt__key { background: var(--px-danger); border-color: var(--px-danger); color: var(--px-stock); }
.st-opt--wrong .st-opt__mark { opacity: 1; transform: none; color: var(--px-danger); }
.st-opts--done .st-opt:not(.st-opt--right):not(.st-opt--wrong) { color: var(--px-stock-ink-faint); }
.st-opts--done .st-opt:not(.st-opt--right):not(.st-opt--wrong) .st-opt__key { color: var(--px-stock-ink-faint); border-color: var(--px-stock-line); }
/* Typed answer: a well on the card. */
.st-ta { margin: 0 calc(var(--px-space-6) * -1) calc(var(--px-space-2) * -1); border-top: 1px solid var(--px-stock-line); padding: var(--px-space-4) var(--px-space-6) var(--px-space-5); }
.st-ta__field, .st-ta__line, .st-ta__num { width: 100%; border: 1px solid var(--px-stock-line); border-radius: var(--px-radius-sm); padding: 10px 12px; font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-stock-ink); background: var(--px-stock-well); outline: none; box-sizing: border-box; transition: border-color var(--px-dur-fast) var(--px-ease), box-shadow var(--px-dur-fast) var(--px-ease); }
.st-ta__field { min-height: 96px; resize: vertical; }
.st-ta__field--essay { min-height: 130px; }
.st-ta__line { height: 40px; }
.st-ta__num { width: 180px; height: 40px; font-variant-numeric: tabular-nums; }
.st-ta__field:focus, .st-ta__line:focus, .st-ta__num:focus { border-color: var(--px-accent); box-shadow: 0 0 0 1px var(--px-accent); background: var(--px-stock); }
.st-ta__field[disabled], .st-ta__line[disabled], .st-ta__num[disabled] { color: var(--px-stock-ink-soft); }
.st-ta__row { display: flex; align-items: center; gap: var(--px-space-2); }
.st-ta__units { color: var(--px-stock-ink-soft); font-size: var(--px-text-md); }
.st-ta__hint { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); margin-top: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-stock-ink-faint); }

/* ── Feedback under the card ────────────────────────────────────────────── */
.st-fb { margin-top: var(--px-space-4); display: grid; grid-template-columns: 1fr auto; gap: var(--px-space-3) var(--px-space-4); align-items: start; opacity: 0; transform: translateY(6px); transition: opacity var(--px-dur-base) var(--px-ease-out), transform var(--px-dur-base) var(--px-ease-out); pointer-events: none; }
.st-fb--show { opacity: 1; transform: none; pointer-events: auto; }
.st-fb__verdict { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-base); font-weight: 600; min-height: var(--px-control-h-sm); }
.st-fb__dot { width: 8px; height: 8px; border-radius: var(--px-radius-full); background: var(--px-text-faint); flex: none; }
.st-fb--ok .st-fb__verdict { color: var(--px-success); }
.st-fb--ok .st-fb__dot { background: var(--px-success); }
.st-fb--no .st-fb__verdict { color: var(--px-danger); }
.st-fb--no .st-fb__dot { background: var(--px-danger); }
.st-fb__grade { display: inline-flex; align-items: center; gap: var(--px-space-1); font-size: var(--px-text-sm); font-weight: 400; color: var(--px-text-muted); }
.st-fb__grade b { font-weight: 600; color: var(--px-warning); }
.st-fb--ok .st-fb__grade b { color: var(--px-success); }
.st-fb--no .st-fb__grade b { color: var(--px-danger); }
.st-fb__why { grid-column: 1 / -1; font-size: var(--px-text-base); color: var(--px-text-secondary); line-height: var(--px-leading-base); margin-top: calc(var(--px-space-1) * -1); max-width: 70ch; }
.st-fb__why b, .st-fb__why strong { color: var(--px-text); font-weight: 600; }
.st-fb__why .px-markdown p { margin: 0; }
/* The text actions on the verdict line: words, not buttons. */
.st-fb__acts { grid-column: 2; grid-row: 1; display: flex; gap: var(--px-space-4); align-items: center; justify-self: end; }
.st-fb__acts .px-btn { height: auto; padding: 0; border: 0; background: none; color: var(--px-text-muted); font-weight: 500; }
.st-fb__acts .px-btn:hover:not(:disabled) { color: var(--px-text); background: none; }
.st-fb__acts .px-btn .svg-icon { display: none; }
/* The anchor quote with the warning-coloured left rule and the page link. */
.st-quote { grid-column: 1 / -1; display: flex; gap: var(--px-space-2); padding: 10px 12px; border: 1px solid var(--px-border); border-left: 2px solid var(--px-warning); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); font-size: var(--px-text-base); line-height: var(--px-leading-base); color: var(--px-text-secondary); max-width: 70ch; }
.st-quote__text { flex: 1; min-width: 0; }
.st-quote__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; align-self: flex-start; margin-top: 2px; cursor: pointer; background: none; border: 0; padding: 0; font-weight: 500; }
.st-quote__pg:hover { text-decoration: underline; }
/* Rubric points land one after another: 50 ms apart, --st-i set per row. */
.st-rub { grid-column: 1 / -1; display: grid; gap: 6px; margin-top: calc(var(--px-space-1) * -1); }
.st-rub__pt { display: flex; align-items: flex-start; gap: 10px; font-size: var(--px-text-base); line-height: 1.45; color: var(--px-text-secondary); opacity: 0; transform: translateX(-4px); animation: st-pt-in var(--px-dur-base) var(--px-ease-out) forwards; animation-delay: calc(var(--st-i, 0) * 50ms); }
@keyframes st-pt-in { to { opacity: 1; transform: none; } }
.st-rub__g { flex: none; width: 18px; height: 18px; border-radius: var(--px-radius-sm); display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
.st-rub__g .svg-icon svg { width: 12px; height: 12px; }
.st-rub__pt--hit .st-rub__g { background: rgba(var(--px-green-rgb), .18); color: var(--px-success); }
.st-rub__pt--partial .st-rub__g { background: rgba(var(--px-yellow-rgb), .18); color: var(--px-warning); }
.st-rub__pt--miss .st-rub__g { background: rgba(var(--px-red-rgb), .18); color: var(--px-danger); }
.st-rub__pt--miss { color: var(--px-text); }
.st-rub__req { font-size: var(--px-text-2xs); color: var(--px-text-faint); margin-left: var(--px-space-1); }
/* The full answer stays folded; the explanation streams into a block. */
.st-full { grid-column: 1 / -1; margin-top: 2px; }
.st-full summary { font-size: var(--px-text-sm); color: var(--px-text-muted); cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 5px; }
.st-full summary::-webkit-details-marker { display: none; }
.st-full__text, .st-explain { margin: var(--px-space-2) 0 0; font-size: var(--px-text-base); line-height: 1.55; color: var(--px-text-secondary); max-width: 70ch; padding: 10px 12px; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); }
.st-explain { grid-column: 1 / -1; margin-top: 0; white-space: pre-wrap; }
.st-explain .px-markdown { white-space: normal; }
.st-explain--busy { color: var(--px-text-muted); }

/* ── Controls row ───────────────────────────────────────────────────────── */
.st-ctl { display: flex; align-items: center; gap: var(--px-space-2); width: 100%; max-width: 760px; margin-top: var(--px-space-5); }
.st-k { margin-left: 6px; opacity: .55; font-size: var(--px-text-xs); font-weight: 400; }

/* ── Setup sheet: scrim and sheet over the pane ─────────────────────────── */
.st-scrim { position: absolute; inset: 0; background: color-mix(in srgb, var(--px-bg) 55%, transparent); animation: st-fade var(--px-dur-base) var(--px-ease-out); }
@keyframes st-fade { from { opacity: 0; } to { opacity: 1; } }
.st-sheet { position: absolute; top: 50%; left: 50%; width: 560px; max-width: calc(100% - 32px); transform: translate(-50%, -50%); background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); box-shadow: var(--px-shadow-lg), var(--px-edge-light); animation: st-rise var(--px-dur-slow) var(--px-ease-out); }
@keyframes st-rise { from { opacity: 0; transform: translate(-50%, -50%) translateY(10px) scale(.985); } to { opacity: 1; transform: translate(-50%, -50%); } }
.st-sheet__hd { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); padding: var(--px-space-4) var(--px-space-5) 0; }
.st-sheet__title { margin: 0; font-size: var(--px-text-md); font-weight: 600; }
.st-sheet__sub { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-sheet__bd { padding: var(--px-space-4) var(--px-space-5) var(--px-space-5); display: grid; gap: var(--px-space-4); }
.st-row { display: flex; align-items: center; gap: var(--px-space-3); flex-wrap: wrap; }
.st-row__lab { width: 92px; flex: none; font-size: var(--px-text-sm); color: var(--px-text-muted); }
.st-row__lab--inline { width: auto; margin-left: var(--px-space-3); }
.st-outline { border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-inset); overflow: hidden; max-height: 240px; overflow-y: auto; }
.st-outline__o { display: flex; align-items: center; gap: var(--px-space-2); min-height: var(--px-control-h); padding: 0 var(--px-space-3); font-size: var(--px-text-sm); color: var(--px-text-secondary); border-top: 1px solid var(--px-divider); cursor: pointer; }
.st-outline__o:first-child { border-top: 0; }
.st-outline__o:hover { background: var(--px-surface-hover); }
.st-outline__o--on { background: var(--px-surface-selected); color: var(--px-text); }
.st-outline__nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-outline__pp { width: 64px; text-align: right; color: var(--px-text-faint); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; }
/* Coverage bars: green share clean, accent share answered but not clean. */
.st-ocov { margin-left: auto; width: 56px; height: 3px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; flex: none; display: flex; }
.st-ocov i, .st-mini i { display: block; height: 100%; }
.st-cov-c { background: var(--px-success); }
.st-cov-w { background: var(--px-accent); }
.st-pages { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-sm); color: var(--px-text-muted); }
.st-input { height: var(--px-control-h); width: 72px; padding: 0 var(--px-space-2); border: 1px solid var(--px-border-strong); border-radius: var(--px-radius-sm); background: var(--px-bg-inset); color: var(--px-text); font: inherit; font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; outline: none; }
.st-input:focus { border-color: var(--px-accent); box-shadow: 0 0 0 1px var(--px-accent); }
.st-selection { padding: 10px 12px; border: 1px solid var(--px-border); border-left: 2px solid var(--px-accent); border-radius: var(--px-radius-md); background: var(--px-bg-inset); font-size: var(--px-text-sm); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.st-sheet__ft { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); padding: var(--px-space-3) var(--px-space-5) var(--px-space-4); border-top: 1px solid var(--px-divider); }
.st-sheet__st { font-size: var(--px-text-sm); color: var(--px-text-muted); display: inline-flex; align-items: center; gap: var(--px-space-2); min-width: 0; flex-wrap: wrap; }
.st-sheet__st b { color: var(--px-text); font-weight: 600; }
.st-sheet__mdl { display: inline-flex; align-items: center; gap: 5px; color: var(--px-text-secondary); cursor: pointer; background: none; border: 0; padding: 0; font: inherit; font-size: var(--px-text-sm); white-space: nowrap; }
.st-sheet__mdl:hover { color: var(--px-text); }
.st-sheet__acts { display: flex; gap: var(--px-space-2); flex: none; }

/* ── Generation screen ──────────────────────────────────────────────────── */
.st-gen { width: 560px; max-width: calc(100% - 32px); margin: 56px auto 0; }
.st-gen__t { font-size: var(--px-text-md); font-weight: 600; }
.st-gen__s { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: 2px; }
.st-gen__bar { height: 4px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; margin: var(--px-space-4) 0 var(--px-space-4); }
.st-gen__bar i { display: block; height: 100%; width: 0; background: var(--px-accent); border-radius: var(--px-radius-full); transition: width var(--px-dur-slow) var(--px-ease); }
.st-genline { display: flex; gap: var(--px-space-5); font-size: var(--px-text-base); color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.st-genline b { color: var(--px-text); font-weight: 600; }
.st-checks { margin-top: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); overflow: hidden; }
.st-ck { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 var(--px-space-3); font-size: var(--px-text-sm); border-top: 1px solid var(--px-divider); color: var(--px-text-secondary); }
.st-ck:first-child { border-top: 0; }
.st-ck__d { width: 7px; height: 7px; border-radius: var(--px-radius-full); background: var(--px-success); flex: none; }
.st-ck__d--run { background: var(--px-accent); animation: st-pulse calc(var(--px-dur-slow) * 5) var(--px-ease) infinite; }
.st-ck__d--idle { background: var(--px-border-strong); }
.st-ck__n { margin-left: auto; color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
@keyframes st-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.st-gen__acts { display: flex; gap: var(--px-space-2); margin-top: var(--px-space-4); justify-content: flex-end; }

/* ── Results ────────────────────────────────────────────────────────────── */
.st-res { width: 100%; max-width: 760px; margin: 0 auto; animation: st-card-in var(--px-dur-slow) var(--px-ease-out); }
.st-res__top { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--px-space-4); padding: var(--px-space-6) 0 var(--px-space-5); border-bottom: 1px solid var(--px-divider); flex-wrap: wrap; }
/* The one hero number, derived from the top step of the ladder. */
.st-res__big { font-size: calc(var(--px-text-xl) * 1.8); font-weight: 600; line-height: 1; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.st-res__big small { font-size: var(--px-text-lg); color: var(--px-text-muted); font-weight: 500; margin-left: var(--px-space-1); }
.st-res__under { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: var(--px-space-2); }
.st-res__under b { color: var(--px-text); font-weight: 600; }
.st-res__acts { display: flex; gap: var(--px-space-2); flex-wrap: wrap; justify-content: flex-end; }
.st-res__acts .st-faint { margin-left: var(--px-space-1); }
.st-cov { display: flex; gap: 2px; height: 6px; margin: var(--px-space-5) 0 6px; }
.st-cov i { flex: 1; border-radius: 2px; background: var(--px-surface-active); }
.st-cov i.c { background: var(--px-success); }
.st-cov i.w { background: var(--px-danger); }
.st-cov i.n { background: var(--px-surface-active); }
.st-cov i.c.just { animation: st-fill var(--px-dur-base) var(--px-ease-out) both; animation-delay: calc(var(--st-i, 0) * 24ms); }
@keyframes st-fill { from { transform: scaleX(.2); opacity: .4; } to { transform: none; opacity: 1; } }
.st-covl { display: flex; justify-content: space-between; font-size: var(--px-text-xs); color: var(--px-text-muted); }
.st-covl b { color: var(--px-text); font-weight: 600; }
.st-missed { margin-top: var(--px-space-5); }
.st-missed .px-section-label { padding-top: 0; }
.st-mrow { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--px-space-3); padding: 10px 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-base); }
.st-mrow:first-of-type { border-top: 0; }
.st-mrow__c { font-weight: 500; min-width: 0; }
.st-mrow__c small { display: block; font-size: var(--px-text-xs); color: var(--px-text-muted); margin-top: 1px; font-weight: 400; }
.st-mrow__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; background: none; border: 0; padding: 0; cursor: pointer; font-weight: 500; }
.st-mrow__pg:hover { text-decoration: underline; }
.st-mrow__st { display: inline-flex; align-items: center; gap: 6px; font-size: var(--px-text-xs); color: var(--px-text-muted); white-space: nowrap; }
.st-mrow__st i { width: 6px; height: 6px; border-radius: var(--px-radius-full); background: var(--px-danger); }
.st-mrow__st--w i { background: var(--px-warning); }
.st-res__ft { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); margin-top: var(--px-space-5); padding-top: var(--px-space-4); border-top: 1px solid var(--px-divider); }
.st-res__lhs { font-size: var(--px-text-sm); color: var(--px-text-muted); }

/* ── Review ─────────────────────────────────────────────────────────────── */
.st-review { width: 100%; max-width: 760px; margin: 0 auto; display: grid; gap: var(--px-space-3); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-review__item { padding: var(--px-space-3) 0 var(--px-space-4); border-top: 1px solid var(--px-divider); display: grid; gap: var(--px-space-2); }
.st-review__item:first-child { border-top: 0; }
.st-review__stem { font-size: var(--px-text-md); font-weight: 600; color: var(--px-text); line-height: 1.4; }
.st-review__stem .px-markdown p { margin: 0; }
.st-review__ans { font-size: var(--px-text-base); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.st-review__ans .px-markdown { display: inline; }
.st-review__ans .px-markdown p { display: inline; margin: 0; }
.st-review__lab { font-size: var(--px-text-xs); color: var(--px-text-faint); margin-right: var(--px-space-1); }
.st-review__ans--ok { color: var(--px-success); }
.st-review__ans--no { color: var(--px-danger); }
.st-review__ans--skip { color: var(--px-text-muted); }
.st-review .st-quote { max-width: none; }

/* ── Learn ──────────────────────────────────────────────────────────────── */
.st-learn { width: 100%; max-width: 720px; margin: 0 auto; padding-top: var(--px-space-2); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-learn__h { font-size: var(--px-text-xl); font-weight: 600; line-height: 1.3; margin: 10px 0 var(--px-space-1); }
.st-learn__sub { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-bottom: var(--px-space-5); }
.st-learn__pt { display: grid; grid-template-columns: 1fr auto; gap: var(--px-space-4); padding: var(--px-space-3) 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-base); line-height: 1.55; color: var(--px-text-secondary); }
.st-learn__pt b { color: var(--px-text); font-weight: 600; }
.st-learn__pt:hover { color: var(--px-text); }
.st-learn__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; align-self: start; margin-top: 3px; cursor: pointer; background: none; border: 0; padding: 0; font-weight: 500; }
.st-learn__pg:hover { text-decoration: underline; }
.st-learn__ft { display: flex; justify-content: space-between; align-items: center; gap: var(--px-space-3); margin-top: var(--px-space-4); padding-top: var(--px-space-4); border-top: 1px solid var(--px-divider); font-size: var(--px-text-sm); color: var(--px-text-muted); }

/* ── Sidebar ────────────────────────────────────────────────────────────── */
.st-sb { display: flex; flex-direction: column; height: 100%; min-width: 0; font-size: var(--px-text-sm); }
.st-sb__hd { display: flex; align-items: center; gap: var(--px-space-1); height: 36px; flex: none; padding: 0 var(--px-space-2) 0 var(--px-sidebar-inset); }
.st-sb__btn--on { color: var(--px-accent-text); background: var(--px-accent-faint); }
.st-sb__body { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: var(--px-space-3); }
.st-sb__sec { padding: var(--px-space-1) 0 var(--px-space-2); }
.st-sb__secl { display: flex; align-items: center; gap: var(--px-space-1); padding: 0 var(--px-space-2) 0 var(--px-sidebar-inset); }
.st-sb__secl .px-section-label { display: inline-flex; align-items: center; gap: var(--px-space-1); min-width: 0; }
.st-sb__secl--fold .px-section-label { cursor: pointer; color: var(--px-text-faint); }
.st-sb__secl--fold .px-section-label:hover { color: var(--px-text-secondary); }
.st-sb__n { color: var(--px-text-faint); font-weight: 500; margin-left: 2px; font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; }
.st-sb__it { display: grid; grid-template-columns: 16px 1fr auto; align-items: center; gap: var(--px-space-2); height: 30px; padding: 0 var(--px-sidebar-inset); color: var(--px-text-secondary); white-space: nowrap; cursor: pointer; transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease); }
.st-sb__it:hover { background: var(--px-surface-hover); color: var(--px-text); }
.st-sb__it--on { background: var(--px-surface-selected); color: var(--px-text); }
.st-sb__it .svg-icon { color: var(--px-text-muted); display: inline-flex; }
.st-sb__nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.st-mini { width: 48px; height: 3px; border-radius: var(--px-radius-full); background: var(--px-surface-active); overflow: hidden; display: flex; }
.st-sb__r { font-size: var(--px-text-xs); color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
.st-sb__r--weak { color: var(--px-danger); }
.st-sb__it--sub { padding-left: 32px; grid-template-columns: 1fr auto; }
/* Select mode: a check well replaces the icon; chosen rows tint. */
.st-sb__ck { width: 15px; height: 15px; border-radius: 3px; border: 1px solid var(--px-border-strong); background: var(--px-bg-inset); display: inline-flex; align-items: center; justify-content: center; color: transparent; }
.st-sb__ck .svg-icon svg { width: 11px; height: 11px; }
.st-sb__ck--on { background: var(--px-accent); border-color: var(--px-accent); color: var(--px-text-on-accent); }
.st-sb__it--picked { background: var(--px-accent-faint); color: var(--px-text); }
.st-sb__bar { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; margin: var(--px-space-1) var(--px-sidebar-inset) 6px; padding: var(--px-space-2) 10px; white-space: nowrap; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); font-size: var(--px-text-sm); color: var(--px-text-secondary); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-sb__bar b { color: var(--px-text); font-weight: 600; }
.st-sb__bar small { display: block; font-size: var(--px-text-xs); color: var(--px-text-muted); margin-top: 1px; }
.st-sb__live { width: 6px; height: 6px; border-radius: var(--px-radius-full); background: var(--px-accent); animation: st-pulse calc(var(--px-dur-slow) * 6) var(--px-ease) infinite; justify-self: center; }
.st-sb .px-empty { padding: var(--px-space-6) var(--px-sidebar-inset); }

/* ── Dashboard widget rows (70-integration.js draws them) ──────────────── */
.st-widget { display: flex; flex-direction: column; min-height: 0; }
.st-widget__empty { font-size: var(--px-text-sm); color: var(--px-text-muted); padding: var(--px-space-2) 0; }
.st-widget__row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 7px 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-sm); cursor: pointer; color: var(--px-text); outline: none; }
.st-widget__row:first-of-type { border-top: 0; }
.st-widget__row:hover .st-widget__label, .st-widget__row:focus-visible .st-widget__label { color: var(--px-accent-text); }
.st-widget__text { min-width: 0; }
.st-widget__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-widget__under { display: block; color: var(--px-text-muted); font-size: var(--px-text-xs); margin-top: 1px; }
.st-widget__bar { width: 72px; height: 4px; border-radius: var(--px-radius-full); background: var(--px-surface-active); overflow: hidden; display: block; }
.st-widget__fill { display: block; height: 100%; background: var(--px-danger); }
.st-widget__fill--warn { background: var(--px-warning); }
.st-widget__foot { margin-top: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-accent-text); cursor: pointer; background: none; border: 0; padding: 0; text-align: left; font-family: inherit; }
.st-widget__foot:hover { text-decoration: underline; }

/* ── Reduced motion: every duration above collapses; nothing hides behind
   an animation. The core stills the whole app the same way; repeated here
   scoped to Study so the rule holds for this stylesheet on its own. ─────── */
@media (prefers-reduced-motion: reduce) {
  .st-root, .st-root *, .st-root *::before, .st-root *::after,
  .st-sb, .st-sb *, .st-widget, .st-widget * {
    animation-duration: 0.001ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    transition-delay: 0ms !important;
  }
}
:root[data-px-motion="reduced"] .st-root, :root[data-px-motion="reduced"] .st-root *,
:root[data-px-motion="reduced"] .st-root *::before, :root[data-px-motion="reduced"] .st-root *::after,
:root[data-px-motion="reduced"] .st-sb, :root[data-px-motion="reduced"] .st-sb *,
:root[data-px-motion="reduced"] .st-widget, :root[data-px-motion="reduced"] .st-widget * {
  animation-duration: 0.001ms !important;
  animation-delay: 0ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  transition-delay: 0ms !important;
}
`;
  document.head.appendChild(style);
}
