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
/* One reading measure for everything a session reads (the card, its answer box, the verdict, the quote,
   Learn, the results): about 70 characters of its text, so the eye never travels 100 and more. */
.st-root { --st-measure: 34rem; position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--px-window); color: var(--px-text); font-size: var(--px-text-base); outline: none; }
.st-root:focus-visible { box-shadow: inset 0 0 0 var(--px-focus-width) var(--px-accent); }
.st-qwrap[hidden], .st-ctl[hidden], .st-card[hidden], .st-fb[hidden] { display: none; }
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
.st-strand { display: flex; gap: var(--px-space-1); flex: 0 1 240px; min-width: 120px; }
.st-strand i { flex: 1; height: 3px; border-radius: var(--px-radius-full); background: var(--px-surface-active); transition: background var(--px-dur-base) var(--px-ease), transform var(--px-dur-base) var(--px-ease-spring); }
.st-strand i.ok { background: var(--px-success); }
.st-strand i.no { background: var(--px-danger); }
.st-strand i.cur { background: var(--px-accent); }
/* Test: an answered item is neutral until the results; no verdict during the test. */
.st-strand i.ans { background: var(--px-text-faint); }
.st-strand i.just { transform: scaleY(1.9); }
.st-sess-main { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; padding: var(--px-space-5) var(--px-space-6) var(--px-space-6); overflow-y: auto; }
.st-qwrap { width: 100%; max-width: var(--st-measure); position: relative; }

/* ── Eyebrow ────────────────────────────────────────────────────────────── */
.st-eyebrow { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-text-muted); margin-bottom: var(--px-space-2); min-height: var(--px-control-h-sm); }
.st-eyebrow__cpt { color: var(--px-text-secondary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-eyebrow__dot { width: 3px; height: 3px; border-radius: var(--px-radius-full); background: var(--px-text-faint); flex: none; }
.st-eyebrow__src { color: var(--px-text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-eyebrow__acts { margin-left: auto; display: inline-flex; align-items: center; gap: var(--px-space-1); }
.st-eyebrow__acts .px-btn { color: var(--px-text-muted); }
.st-eyebrow__acts .px-btn.st-mark--on { color: var(--px-accent-text); }

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
.st-card__q, .st-opt__text, .st-ta__field, .st-ta__line, .st-ta__num, .st-past__typed, .st-quote__text, .st-full__text, .st-learn__pt, .st-review__stem, .st-review__ans { font-family: Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, 'Times New Roman', serif; }
.st-card__q { font-size: var(--px-text-xl); font-weight: 700; line-height: var(--px-leading-tight); margin: 0 0 var(--px-space-4); transition: font-size var(--px-dur-base) var(--px-ease); }
/* Answered: the question steps back so the verdict under the card is the first thing read. */
.st-card--answered .st-card__q { font-size: var(--px-text-lg); font-weight: 600; }
.st-card__q .px-markdown p { margin: 0; }
.st-card .px-markdown code { background: var(--px-stock-well); color: var(--px-stock-ink); }
.st-card .px-markdown pre { background: var(--px-stock-well); border-color: var(--px-stock-edge); color: var(--px-stock-ink); }
.st-card .px-markdown a { color: var(--px-accent-text); }
/* Options: rows on the card with a keycap at the left, divided by the card's
   own hairline. No radio circles: the keycap is the letter and the key. */
.st-opts { margin: 0 calc(var(--px-space-6) * -1); border-top: 1px solid var(--px-stock-line); }
.st-opt { display: flex; align-items: flex-start; gap: var(--px-space-3); padding: var(--px-space-3) var(--px-space-6); border-bottom: 1px solid var(--px-stock-line); font-size: var(--px-text-md); line-height: var(--px-leading-base); cursor: pointer; position: relative; transition: background var(--px-dur-fast) var(--px-ease), transform var(--px-dur-instant) var(--px-ease); }
.st-opt:last-child { border-bottom: 0; }
.st-opt:hover { background: var(--px-stock-well); }
.st-opt:active { transform: var(--px-press); }
.st-opt__text { flex: 1; min-width: 0; }
.st-opt__text .px-markdown p { margin: 0; }
.st-opt__key { flex: none; width: 20px; height: 20px; margin-top: 1px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--px-stock-edge); border-radius: var(--px-radius-sm); font-size: var(--px-text-xs); font-weight: 500; color: var(--px-stock-ink-soft); transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease), border-color var(--px-dur-fast) var(--px-ease); }
.st-opt__mark { flex: none; width: 16px; height: 16px; margin: 3px 0 0 auto; opacity: 0; transform: scale(.6); transition: opacity var(--px-dur-fast) var(--px-ease), transform var(--px-dur-base) var(--px-ease-spring); }
.st-opts--done .st-opt { cursor: default; }
.st-opts--done .st-opt:hover { background: transparent; }
.st-opt--right { background: color-mix(in srgb, var(--px-success) 15%, transparent); }
.st-opt--right .st-opt__key { background: var(--px-success); border-color: var(--px-success); color: var(--px-stock); }
.st-opt--right .st-opt__mark { opacity: 1; transform: none; color: var(--px-success); }
.st-opt--wrong { background: var(--px-danger-soft); }
.st-opt--wrong .st-opt__key { background: var(--px-danger); border-color: var(--px-danger); color: var(--px-stock); }
.st-opt--wrong .st-opt__mark { opacity: 1; transform: none; color: var(--px-danger); }
.st-opts--done .st-opt:not(.st-opt--right):not(.st-opt--wrong) { color: var(--px-stock-ink-soft); }
.st-opts--done .st-opt:not(.st-opt--right):not(.st-opt--wrong) .st-opt__key { color: var(--px-stock-ink-soft); border-color: var(--px-stock-line); }
/* Typed answer: a well on the card. */
.st-ta { margin: 0 calc(var(--px-space-6) * -1) calc(var(--px-space-2) * -1); border-top: 1px solid var(--px-stock-line); padding: var(--px-space-4) var(--px-space-6) var(--px-space-5); }
.st-ta__field, .st-ta__line, .st-ta__num { width: 100%; border: 1px solid var(--px-stock-line); border-radius: var(--px-radius-sm); padding: var(--px-space-2) var(--px-space-3); font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-stock-ink); background: var(--px-stock-well); outline: none; box-sizing: border-box; transition: border-color var(--px-dur-fast) var(--px-ease), box-shadow var(--px-dur-fast) var(--px-ease); }
.st-ta__field { min-height: 96px; resize: none; field-sizing: content; max-height: var(--px-textarea-max-h); }
.st-ta__field--essay { min-height: 130px; }
.st-ta__line { height: var(--px-control-h-lg); }
.st-ta__num { width: 180px; height: var(--px-control-h-lg); font-variant-numeric: tabular-nums; }
.st-ta__field::placeholder, .st-ta__line::placeholder, .st-ta__num::placeholder { color: var(--px-stock-ink-soft); opacity: 1; }
.st-ta__field:focus, .st-ta__line:focus, .st-ta__num:focus { border-color: var(--px-accent); box-shadow: var(--px-ring-accent); background: var(--px-stock); }
/* His answer once it is in: read only, still legible (never the browser's grey for a disabled field). */
.st-ta__field[readonly], .st-ta__line[readonly], .st-ta__num[readonly], .st-ta__field[disabled], .st-ta__line[disabled], .st-ta__num[disabled] { color: var(--px-stock-ink-soft); -webkit-text-fill-color: var(--px-stock-ink-soft); opacity: 1; }
.st-past__typed { font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-stock-ink); white-space: pre-wrap; margin-top: var(--px-space-1); }
.st-ta__row { display: flex; align-items: center; gap: var(--px-space-2); }
.st-ta__units { color: var(--px-stock-ink-soft); font-size: var(--px-text-md); }
.st-ta__hint { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); margin-top: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-stock-ink-soft); }

/* ── Feedback under the card ────────────────────────────────────────────── */
.st-fb { margin-top: var(--px-space-4); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--px-space-3); align-items: start; opacity: 0; transform: translateY(6px); transition: opacity var(--px-dur-base) var(--px-ease-out), transform var(--px-dur-base) var(--px-ease-out); pointer-events: none; }
.st-fb--show { opacity: 1; transform: none; pointer-events: auto; }
/* The verdict leads: the largest, heaviest line once he has answered; then the reason, the quote, the explanation. */
.st-fb__verdict { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--px-space-2); font-size: var(--px-text-xl); font-weight: 700; line-height: var(--px-leading-tight); min-height: var(--px-control-h-sm); }
.st-fb__verdict .st-fb__dot { align-self: center; }
.st-fb__dot { width: 10px; height: 10px; border-radius: var(--px-radius-full); background: var(--px-text-faint); flex: none; }
.st-fb--ok .st-fb__verdict { color: var(--px-success); }
.st-fb--ok .st-fb__dot { background: var(--px-success); }
.st-fb--no .st-fb__verdict { color: var(--px-danger); }
.st-fb--no .st-fb__dot { background: var(--px-danger); }
.st-fb__grade { display: inline-flex; align-items: center; gap: var(--px-space-1); font-size: var(--px-text-sm); font-weight: 400; color: var(--px-text-muted); }
.st-fb__grade b { font-weight: 600; color: var(--px-warning); }
.st-fb--ok .st-fb__grade b { color: var(--px-success); }
.st-fb--no .st-fb__grade b { color: var(--px-danger); }
.st-fb__why { grid-column: 1 / -1; font-size: var(--px-text-md); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.st-fb__why b, .st-fb__why strong { color: var(--px-text); font-weight: 600; }
.st-fb__why .px-markdown p { margin: 0; }
/* The actions under the verdict: small ghost buttons, each led by its icon. */
.st-fb__acts { display: flex; margin-top: calc(var(--px-space-2) * -1); flex-wrap: wrap; gap: var(--px-space-1) var(--px-space-3); align-items: center; }
.st-fb__acts .px-btn { height: var(--px-control-h-sm); padding: 0 var(--px-space-1); margin-left: calc(var(--px-space-1) * -1); color: var(--px-text-muted); font-weight: 500; }
.st-fb__acts .px-btn:hover:not(:disabled) { color: var(--px-text); background: none; }
/* The anchor quote with the warning-coloured left rule and the page link. */
.st-quote { grid-column: 1 / -1; display: flex; gap: var(--px-space-2); padding: var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-border); border-left: 2px solid var(--px-warning); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-text-secondary); }
.st-quote__text { flex: 1; min-width: 0; }
.st-quote__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; align-self: flex-start; min-height: var(--px-control-h-sm); cursor: pointer; background: none; border: 0; padding: 0; font-weight: 500; }
.st-quote__pg:hover { text-decoration: underline; }
/* Rubric points land one after another: 50 ms apart, --st-i set per row. */
.st-rub { grid-column: 1 / -1; display: grid; gap: var(--px-space-2); }
.st-rub__pt { display: flex; align-items: flex-start; gap: var(--px-space-2); font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-text-secondary); opacity: 0; transform: translateX(-4px); animation: st-pt-in var(--px-dur-base) var(--px-ease-out) forwards; animation-delay: calc(var(--st-i, 0) * 50ms); }
@keyframes st-pt-in { to { opacity: 1; transform: none; } }
.st-rub__g { flex: none; width: 18px; height: 18px; border-radius: var(--px-radius-sm); display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
.st-rub__g .svg-icon svg { width: 12px; height: 12px; }
.st-rub__pt--hit .st-rub__g { background: color-mix(in srgb, var(--px-success) 15%, transparent); color: var(--px-success); }
.st-rub__pt--partial .st-rub__g { background: var(--px-warning-soft); color: var(--px-warning); }
.st-rub__pt--miss .st-rub__g { background: var(--px-danger-soft); color: var(--px-danger); }
.st-rub__pt--miss { color: var(--px-text); }
.st-rub__req { font-size: var(--px-text-2xs); color: var(--px-text-faint); margin-left: var(--px-space-1); }
/* The full answer stays folded; the explanation streams into a block. */
.st-full { grid-column: 1 / -1; }
.st-full summary { font-size: var(--px-text-sm); color: var(--px-text-muted); cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: var(--px-space-1); min-height: var(--px-control-h-sm); }
.st-full summary::-webkit-details-marker { display: none; }
.st-full__text, .st-explain { margin: var(--px-space-2) 0 0; font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-text-secondary); padding: var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); }
.st-explain { grid-column: 1 / -1; margin-top: 0; white-space: pre-wrap; }
.st-explain .px-markdown { white-space: normal; }
.st-explain--busy { color: var(--px-text-muted); }

/* ── Controls row ───────────────────────────────────────────────────────── */
/* The action row stays where it is from question to question: under the card's scrolling area, one measure wide. */
.st-foot { flex: none; display: flex; flex-direction: column; align-items: center; padding: var(--px-space-3) var(--px-space-6); border-top: 1px solid var(--px-divider); background: var(--px-bg); }
.st-ctl { display: flex; align-items: center; gap: var(--px-space-2); width: 100%; max-width: var(--st-measure); }
.st-ctl__where { font-size: var(--px-text-sm); color: var(--px-text-muted); }
.st-k { margin-left: var(--px-space-1); font-size: var(--px-text-xs); font-weight: 400; }
/* Editing a question: its wording and answer in two fields where the card was. */
.st-edit { display: grid; gap: var(--px-space-2); padding: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); }
.st-edit__lab { font-size: var(--px-text-sm); color: var(--px-text-muted); }
.st-edit__field { width: 100%; box-sizing: border-box; min-height: calc(var(--px-control-h-lg) * 2); max-height: var(--px-textarea-max-h); resize: vertical; field-sizing: content; padding: var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-border-strong); border-radius: var(--px-radius-sm); background: var(--px-bg-inset); color: var(--px-text); font: inherit; font-size: var(--px-text-md); line-height: var(--px-leading-base); outline: none; }
.st-edit__field:focus { border-color: var(--px-accent); box-shadow: var(--px-ring-accent); }
.st-edit__hint { font-size: var(--px-text-sm); color: var(--px-text-muted); }
.st-edit__acts { display: flex; align-items: center; gap: var(--px-space-2); margin-top: var(--px-space-2); }

/* ── Setup sheet: scrim and sheet over the pane ─────────────────────────── */
.st-scrim { position: absolute; inset: 0; background: color-mix(in srgb, var(--px-bg) 55%, transparent); animation: st-fade var(--px-dur-base) var(--px-ease-out); }
@keyframes st-fade { from { opacity: 0; } to { opacity: 1; } }
.st-sheet { position: absolute; top: 50%; left: 50%; width: min(640px, calc(100% - var(--px-space-8))); container-type: inline-size; container-name: st-sheet; transform: translate(-50%, -50%); background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); box-shadow: var(--px-shadow-lg), var(--px-edge-light); animation: st-rise var(--px-dur-slow) var(--px-ease-out); }
@keyframes st-rise { from { opacity: 0; transform: translate(-50%, -50%) translateY(10px) scale(.985); } to { opacity: 1; transform: translate(-50%, -50%); } }
.st-sheet__hd { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); padding: var(--px-space-4) var(--px-space-5) 0; }
.st-sheet__title { margin: 0; font-size: var(--px-text-md); font-weight: 600; }
.st-sheet__sub { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: var(--px-space-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-sheet__bd { padding: var(--px-space-4) var(--px-space-5) var(--px-space-5); display: grid; gap: var(--px-space-4); }
.st-row { display: flex; align-items: center; gap: var(--px-space-3); flex-wrap: wrap; }
.st-row__lab { width: 64px; flex: none; font-size: var(--px-text-sm); color: var(--px-text-muted); }
.st-row__lab--inline { width: auto; margin-left: var(--px-space-3); }
/* Mode and Answer: one row that never wraps at the sheet's full width; two
   rows on the same label column when the sheet is narrower. */
.st-ma { display: flex; align-items: center; gap: var(--px-space-3); flex-wrap: nowrap; }
.st-ma__pair { display: flex; align-items: center; gap: var(--px-space-3); flex: none; }
@container st-sheet (max-width: 600px) {
  .st-ma { flex-direction: column; align-items: flex-start; gap: var(--px-space-4); }
  .st-ma .st-row__lab--inline { width: 64px; margin-left: 0; }
}
/* New Subject: label and field on one line, a hint under the field; the columns of his database in two columns. */
.st-subj__row { display: grid; grid-template-columns: 112px minmax(0, 1fr); align-items: center; column-gap: var(--px-space-3); row-gap: var(--px-space-1); }
.st-subj .st-row__lab { width: auto; }
.st-subj__cell { display: flex; align-items: flex-start; gap: var(--px-space-2); min-width: 0; }
.st-subj__cell > .px-btn { flex: none; }
.st-subj__cell > .ui-input-box, .st-subj__cell > .ui-select, .st-subj__pair > .ui-select { flex: 1; min-width: 0; }
.st-subj__cell .ui-dropdown, .st-subj__pair .ui-dropdown { width: 100%; }
.st-subj__row > .st-subj__hint { grid-column: 2; }
.st-subj__hint { font-size: var(--px-text-xs); color: var(--px-text-muted); line-height: 1.4; }
.st-subj__map { padding: var(--px-space-3); display: grid; gap: var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-inset); }
.st-subj__map[hidden] { display: none; }
.st-subj__maphd { display: grid; gap: var(--px-space-1); }
.st-subj__mapt { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text); }
.st-subj__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--px-space-2) var(--px-space-4); }
.st-subj__pair { display: grid; grid-template-columns: 100px minmax(0, 1fr); align-items: center; gap: var(--px-space-2); min-width: 0; }
.st-subj__problem { flex: 1; min-width: 0; font-size: var(--px-text-sm); color: var(--px-danger); }
@container st-sheet (max-width: 560px) {
  .st-subj__row { grid-template-columns: minmax(0, 1fr); }
  .st-subj__row > .st-subj__hint { grid-column: 1; }
  .st-subj__grid { grid-template-columns: minmax(0, 1fr); }
}
.st-sheet__count { font-size: var(--px-text-sm); color: var(--px-text-muted); }
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
.st-input:focus { border-color: var(--px-accent); box-shadow: var(--px-ring-accent); }
.st-selection { padding: var(--px-space-2) var(--px-space-3); border: 1px solid var(--px-border); border-left: 2px solid var(--px-accent); border-radius: var(--px-radius-md); background: var(--px-bg-inset); font-size: var(--px-text-sm); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.st-sheet__ft { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); padding: var(--px-space-3) var(--px-space-5) var(--px-space-4); border-top: 1px solid var(--px-divider); }
.st-sheet__mdl { min-width: 0; max-width: 100%; color: var(--px-text-secondary); }
.st-sheet__mdl .px-btn__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.st-sheet__chev { display: inline-flex; flex: none; color: var(--px-text-muted); }
.st-sheet__acts { display: flex; gap: var(--px-space-2); flex: none; }

/* ── Generation screen ──────────────────────────────────────────────────── */
.st-gen { width: 560px; max-width: calc(100% - var(--px-space-8)); margin: calc(var(--px-space-8) + var(--px-space-6)) auto 0; }
.st-gen__t { font-size: var(--px-text-md); font-weight: 600; }
.st-gen__s { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: var(--px-space-1); }
.st-gen__now { font-size: var(--px-text-sm); color: var(--px-text); margin-top: var(--px-space-2); min-height: 1.4em; }
.st-gen__bar { height: 4px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; margin: var(--px-space-4) 0 var(--px-space-4); }
.st-gen__bar .st-gen__fill { display: block; height: 100%; width: 0; background: var(--px-accent); border-radius: var(--px-radius-full); transition: width var(--px-dur-slow) var(--px-ease); }
.st-genline { display: flex; gap: var(--px-space-5); font-size: var(--px-text-base); color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.st-genline strong { color: var(--px-text); font-weight: 600; }
.st-checks { margin-top: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); overflow: hidden; }
.st-ck { display: flex; align-items: center; gap: var(--px-space-2); height: var(--px-control-h); padding: 0 var(--px-space-3); font-size: var(--px-text-sm); border-top: 1px solid var(--px-divider); color: var(--px-text-secondary); }
.st-ck:first-child { border-top: 0; }
.st-ck__d { width: 7px; height: 7px; border-radius: var(--px-radius-full); background: var(--px-success); flex: none; }
.st-ck__d--run { background: var(--px-accent); animation: st-pulse calc(var(--px-dur-slow) * 5) var(--px-ease) infinite; }
.st-ck__d--idle { background: var(--px-border-strong); }
.st-ck__n { margin-left: auto; color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
@keyframes st-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.st-gen__acts { display: flex; align-items: center; gap: var(--px-space-2); margin-top: var(--px-space-4); justify-content: flex-end; }
.st-gen__hint { margin-right: auto; font-size: var(--px-text-sm); color: var(--px-text-muted); }
/* The making, beside the questions: one line under the session toolbar. */
.st-making { display: flex; align-items: center; gap: var(--px-space-3); min-height: var(--px-control-h-lg); padding: var(--px-space-1) var(--px-space-4); border-bottom: 1px solid var(--px-divider); background: var(--px-bg); font-size: var(--px-text-sm); color: var(--px-text-muted); flex: none; }
.st-making[hidden], .st-making [hidden] { display: none; }
.st-making__now { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-making__n { color: var(--px-text); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-making__t { font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-making--failed .st-making__now { color: var(--px-text); white-space: normal; }
.st-ended { margin-top: var(--px-space-8); }
.st-ended .px-btn--ghost { margin-top: var(--px-space-2); }
.st-sheet__notice { padding: var(--px-space-3) var(--px-space-5); border-top: 1px solid var(--px-divider); }
.st-sheet__notice .px-btn--ghost { margin-top: var(--px-space-2); }

/* ── Results ────────────────────────────────────────────────────────────── */
.st-res { width: 100%; max-width: var(--st-measure); margin: 0 auto; animation: st-card-in var(--px-dur-slow) var(--px-ease-out); }
.st-res__top { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--px-space-4); padding: var(--px-space-6) 0 var(--px-space-5); border-bottom: 1px solid var(--px-divider); flex-wrap: wrap; }
/* The one hero number, derived from the top step of the ladder. */
.st-res__big { font-size: var(--px-text-xl); font-weight: 600; line-height: 1; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.st-res__big small { font-size: var(--px-text-lg); color: var(--px-text-muted); font-weight: 500; margin-left: var(--px-space-1); }
.st-res__under { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: var(--px-space-2); }
.st-res__under b { color: var(--px-text); font-weight: 600; }
.st-res__acts { display: flex; gap: var(--px-space-2); flex-wrap: wrap; justify-content: flex-end; }
.st-res__acts .st-faint { margin-left: var(--px-space-1); }
.st-cov { display: flex; gap: var(--px-space-1); height: 6px; margin: var(--px-space-5) 0 var(--px-space-2); }
.st-cov i { flex: 1; border-radius: var(--px-radius-xs); background: var(--px-surface-active); }
.st-cov i.c { background: var(--px-success); }
.st-cov i.w { background: var(--px-danger); }
.st-cov i.n { background: var(--px-surface-active); }
.st-cov i.c.just { animation: st-fill var(--px-dur-base) var(--px-ease-out) both; animation-delay: calc(var(--st-i, 0) * 24ms); }
@keyframes st-fill { from { transform: scaleX(.2); opacity: .4; } to { transform: none; opacity: 1; } }
.st-covl { display: flex; justify-content: space-between; font-size: var(--px-text-xs); color: var(--px-text-muted); }
.st-covl b { color: var(--px-text); font-weight: 600; }
.st-missed { margin-top: var(--px-space-5); }
.st-missed .px-section-label { padding-top: 0; }
.st-mrow { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--px-space-3); padding: var(--px-space-2) 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-base); }
.st-mrow:first-of-type { border-top: 0; }
.st-mrow__c { font-weight: 500; min-width: 0; }
.st-mrow__c small { display: block; font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: var(--px-space-1); font-weight: 400; }
.st-mrow__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; background: none; border: 0; padding: 0; cursor: pointer; font-weight: 500; }
.st-mrow__pg:hover { text-decoration: underline; }
.st-mrow__st { display: inline-flex; align-items: center; gap: var(--px-space-1); font-size: var(--px-text-xs); color: var(--px-text-muted); white-space: nowrap; }
.st-mrow__st i { width: 6px; height: 6px; border-radius: var(--px-radius-full); background: var(--px-danger); }
.st-mrow__st--w i { background: var(--px-warning); }
.st-res__ft { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); margin-top: var(--px-space-5); padding-top: var(--px-space-4); border-top: 1px solid var(--px-divider); }
.st-res__lhs { font-size: var(--px-text-sm); color: var(--px-text-muted); }

/* ── Review ─────────────────────────────────────────────────────────────── */
.st-review { width: 100%; max-width: var(--st-measure); margin: 0 auto; display: grid; gap: var(--px-space-3); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-review__item { padding: var(--px-space-3) 0 var(--px-space-4); border-top: 1px solid var(--px-divider); display: grid; gap: var(--px-space-2); }
.st-review__item:first-child { border-top: 0; }
.st-review__stem { font-size: var(--px-text-md); font-weight: 600; color: var(--px-text); line-height: var(--px-leading-tight); }
.st-review__stem .px-markdown p { margin: 0; }
.st-review__ans { font-size: var(--px-text-base); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.st-review__ans .px-markdown { display: inline; }
.st-review__ans .px-markdown p { display: inline; margin: 0; }
.st-review__lab { font-size: var(--px-text-xs); color: var(--px-text-faint); margin-right: var(--px-space-1); }
.st-review__ans--ok { color: var(--px-success); }
.st-review__ans--no { color: var(--px-danger); }
.st-review__ans--skip { color: var(--px-text-muted); }
.st-review .st-quote { max-width: none; }

.st-review__v { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-muted); }
.st-review__v .st-fb__grade { font-weight: 400; }
.st-review__v--ok { color: var(--px-success); }
.st-review__v--no { color: var(--px-danger); }
.st-review .st-rub { margin-top: 0; }
.st-marking { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: var(--px-space-4); }

/* ── Learn ──────────────────────────────────────────────────────────────── */
.st-learn { width: 100%; max-width: var(--st-measure); margin: 0 auto; padding-top: var(--px-space-2); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-learn__h { font-size: var(--px-text-xl); font-weight: 600; line-height: var(--px-leading-tight); margin: var(--px-space-2) 0 var(--px-space-1); }
.st-learn__sub { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-bottom: var(--px-space-5); }
.st-learn__pt { display: grid; grid-template-columns: 1fr auto; gap: var(--px-space-4); padding: var(--px-space-3) 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-text-secondary); }
.st-learn__pt b { color: var(--px-text); font-weight: 600; }
.st-learn__pt:hover { color: var(--px-text); }
.st-learn__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; align-self: start; margin-top: var(--px-space-1); cursor: pointer; background: none; border: 0; padding: 0; font-weight: 500; }
.st-learn__pg:hover { text-decoration: underline; }
.st-learn__ft { display: flex; justify-content: space-between; align-items: center; gap: var(--px-space-3); margin-top: var(--px-space-4); padding-top: var(--px-space-4); border-top: 1px solid var(--px-divider); font-size: var(--px-text-sm); color: var(--px-text-muted); }

/* ── Sidebar ────────────────────────────────────────────────────────────── */
.st-sb { display: flex; flex-direction: column; height: 100%; min-width: 0; font-size: var(--px-text-sm); }
.st-sb__btn--on { color: var(--px-accent-text); background: var(--px-accent-faint); }
.st-sb__body { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: var(--px-space-3); }
.st-sb__sec { padding: var(--px-space-1) 0 var(--px-space-2); }
.st-sb__secl { display: flex; align-items: center; gap: var(--px-space-1); min-height: var(--px-control-h); padding: 0 var(--px-space-2) 0 var(--px-sidebar-inset); }
.st-sb__secl .px-section-label + .st-sp { min-width: var(--px-space-2); }
.st-sb__secl .px-section-label { display: inline-flex; align-items: center; gap: var(--px-space-1); min-width: 0; }
.st-sb__secl--fold .px-section-label { cursor: pointer; color: var(--px-text-faint); }
.st-sb__secl--fold .px-section-label:hover { color: var(--px-text-secondary); }
.st-sb__secl--fold .px-section-label:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 2px; border-radius: var(--px-radius-sm); color: var(--px-text-secondary); }
.st-sb__n { color: var(--px-text-faint); font-weight: 500; margin-left: var(--px-space-1); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; }
.st-sb__it { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: var(--px-space-2); height: var(--px-control-h); padding: 0 var(--px-sidebar-inset); color: var(--px-text-secondary); white-space: nowrap; cursor: pointer; transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease); }
.st-sb__it:hover { background: var(--px-surface-hover); color: var(--px-text); }
.st-sb__it--on { background: var(--px-surface-selected); color: var(--px-text); }
.st-sb__it .svg-icon { color: var(--px-text-muted); display: inline-flex; }
.st-sb__nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.st-mini { width: 48px; height: 3px; border-radius: var(--px-radius-full); background: var(--px-surface-active); overflow: hidden; display: flex; }
.st-sb__r { font-size: var(--px-text-xs); color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
.st-sb__r--weak { color: var(--px-danger); }
.st-sb__it--sub { padding-left: var(--px-space-8); grid-template-columns: minmax(0, 1fr) auto; }
/* Select mode: a check well replaces the icon; chosen rows tint. */
.st-sb__ck { width: 15px; height: 15px; border-radius: var(--px-radius-sm); border: 1px solid var(--px-border-strong); background: var(--px-bg-inset); display: inline-flex; align-items: center; justify-content: center; color: transparent; }
.st-sb__ck .svg-icon svg { width: 11px; height: 11px; }
.st-sb__ck--on { background: var(--px-accent); border-color: var(--px-accent); color: var(--px-text-on-accent); }
.st-sb__it--picked { background: var(--px-accent-faint); color: var(--px-text); }
.st-sb__bar { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--px-space-2); margin: var(--px-space-1) var(--px-sidebar-inset) var(--px-space-2); padding: var(--px-space-2) var(--px-space-3); white-space: nowrap; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); font-size: var(--px-text-sm); color: var(--px-text-secondary); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-sb__bar b { color: var(--px-text); font-weight: 600; }
.st-sb__bar small { display: block; font-size: var(--px-text-xs); color: var(--px-text-muted); margin-top: 1px; }
.st-sb__live { width: 6px; height: 6px; border-radius: var(--px-radius-full); background: var(--px-accent); animation: st-pulse calc(var(--px-dur-slow) * 6) var(--px-ease) infinite; justify-self: center; }
/* Review rows (Weak Spots, Marked): kit buttons laid out as the rows around them. */
.st-sb__sec--review .st-sb__nav, .st-sb__sec--subjects .st-sb__nav { display: flex; width: 100%; justify-content: flex-start; gap: var(--px-space-2); height: var(--px-control-h); padding: 0 var(--px-sidebar-inset); border-radius: 0; color: var(--px-text-secondary); font-weight: 400; }
.st-sb__nav .px-btn__label { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; }
/* A subject: its name studies all of it, More Actions beside it; a unit is a row under it, its mark filling as it is answered. */
.st-sb__subj { display: flex; align-items: center; padding-right: var(--px-space-2); }
.st-sb__subj .st-sb__nav { flex: 1; min-width: 0; width: auto; padding-right: var(--px-space-1); color: var(--px-text); font-weight: 500; }
.st-sb__sec--subjects .st-sb__nav .svg-icon { color: var(--px-text-muted); flex: none; }
/* A unit is set in under its subject, by less on a sidebar too narrow to spare it (the bar's left edge follows: it starts under the name). */
.st-sb__sec--subjects .st-sb__nav--unit { padding-left: min(var(--px-space-8), 15%); }
.st-sb__sec--subjects .st-sb__nav--unit .svg-icon { color: var(--px-text-faint); }
.st-sb__sec--subjects .st-sb__nav--done .svg-icon { color: var(--px-success); }
.st-sb__sec--subjects .st-sb__nav:hover { background: var(--px-surface-hover); color: var(--px-text); }
.st-sb__nav .st-sb__r { flex: none; font-weight: 400; }
/* A name is never squeezed to a letter by its count: on a sidebar too narrow for both (or zoomed), the count goes under the name, at the end of the row. */
.st-sb__sec--subjects .st-sb__subj .st-sb__nav, .st-sb__sec--subjects .st-sb__nav--unit { flex-wrap: wrap; align-content: center; row-gap: 0; height: auto; min-height: var(--px-control-h); padding-block: var(--px-space-1); }
.st-sb__sec--subjects .st-sb__nav .px-btn__label { flex: 1 1 min(7ch, calc(100% - 16px - var(--px-space-2))); }
.st-sb__sec--subjects .st-sb__nav .st-sb__r { margin-left: auto; }
.st-sb__none--unit { padding-left: min(var(--px-space-8), 15%); }
/* A unit with a bar is two lines: its name has the whole first line, whatever the sidebar's width; under it the thin bar (the
   kit's stacked bar) runs from the name's edge to the "N of M" at the end of its line (--st-count-w is the count's width,
   50-sidebar.js). Bar and count lie over the foot of the button, which stays the whole row to press. On a sidebar so narrow
   (or zoomed) that under 24px is left between the two, the bar is not drawn: a sliver says nothing, the count says it. */
.st-sb__unit { position: relative; container-type: inline-size; }
.st-sb__sec--subjects .st-sb__unit--bar .st-sb__nav--unit { position: relative; flex-wrap: nowrap; height: calc(var(--px-control-h) + var(--px-space-3)); padding-block: 0 var(--px-space-4); }
.st-sb__sec--subjects .st-sb__unit--bar .st-sb__nav--unit .st-sb__r { position: absolute; right: var(--px-sidebar-inset); bottom: var(--px-space-1); line-height: 1; }
.st-sb__unit > .px-stacked-bar { position: absolute; bottom: var(--px-space-2); left: calc(min(var(--px-space-8), 15%) + 16px + var(--px-space-2)); right: calc(var(--px-sidebar-inset) + var(--st-count-w, 8ch) + var(--px-space-2)); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; overflow: hidden; pointer-events: none; }
@container (max-width: 136px) { .st-sb__unit > .px-stacked-bar { display: none; } }
/* A unit's own More Actions sits at the end of its first line, in a slot of its own so it never covers the count. Shown while
   the row is hovered, holds the focus, or is used by touch. */
.st-sb__sec--subjects .st-sb__unit { display: flex; align-items: flex-start; padding-right: var(--px-space-2); }
.st-sb__sec--subjects .st-sb__unit > .st-sb__nav--unit { flex: 1; min-width: 0; width: auto; padding-right: var(--px-space-1); }
.st-sb__unitmore { flex: none; margin-top: calc((var(--px-control-h) - var(--px-control-h-sm)) / 2); opacity: 0; }
.st-sb__unit--bar > .st-sb__unitmore { margin-top: 0; }
.st-sb__unit:hover > .st-sb__unitmore, .st-sb__unit:focus-within > .st-sb__unitmore, [data-input-modality="touch"] .st-sb__unit > .st-sb__unitmore { opacity: 1; }
.st-sb__sec--subjects .st-sb__unit--bar .st-sb__nav--unit .st-sb__r { right: var(--px-space-1); }
.st-sb__sec--subjects .st-sb__unit > .px-stacked-bar { right: calc(var(--px-space-2) + var(--px-control-h-sm) + var(--px-space-1) + var(--st-count-w, 8ch) + var(--px-space-2)); }
.st-sb .px-empty .px-btn--ghost { margin-top: var(--px-space-2); }
.st-sb .px-empty { padding: var(--px-space-6) var(--px-sidebar-inset); }
.st-sb__none { padding: var(--px-space-1) var(--px-sidebar-inset); font-size: var(--px-text-xs); color: var(--px-text-muted); }

/* ── Progress (63-progress-view.js): totals, a row per unit, a bar per kind ── */
/* The bars are the kit's (.px-stacked-bar); these rules only lay them out. One grid template for the head and
   every row, so every bar of a kind has the same length and the counts stand in one column. */
.st-prog { flex: 1; min-height: 0; overflow: auto; background: var(--px-bg); }
.st-prog__in { max-width: 68rem; margin: 0 auto; }
.st-prog__body { display: flex; flex-direction: column; gap: var(--px-space-4); padding: 0 var(--px-space-6) var(--px-space-8); }
.st-prog__top:empty, .st-prog__under:empty, .st-prog__bar[hidden] { display: none; }
.st-prog__top { display: flex; flex-direction: column; gap: var(--px-space-3); }
.st-prog__totals { display: flex; flex-direction: column; gap: var(--px-space-3); padding: var(--px-space-4) var(--px-space-5); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); }
.st-prog__cell { display: flex; align-items: center; gap: var(--px-space-3); min-width: 0; }
.st-prog__cell .px-stacked-bar { flex: 1; }
.st-prog__kind { flex: none; width: 6rem; color: var(--px-text-secondary); font-size: var(--px-text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-prog__n { flex: none; min-width: 7ch; text-align: right; color: var(--px-text-muted); font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-prog__totals .st-prog__kind { color: var(--px-text); font-weight: 600; }
.st-prog__totals .st-prog__n { min-width: 9ch; }
.st-prog__totals .px-stacked-bar { height: 14px; }
/* The totals lie on a card: the bars' textures are cut in its colour. Under each bar, its numbers in the kind's own words. */
.st-prog__totals { --px-bar-cut: var(--px-bg-elevated); }
.st-prog__totals .st-prog__cell { flex-wrap: wrap; row-gap: var(--px-space-1); }
.st-prog__words { flex: 0 0 100%; box-sizing: border-box; padding-left: calc(6rem + var(--px-space-3)); color: var(--px-text-muted); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; line-height: 1.4; }
.st-prog__legend { display: flex; flex-wrap: wrap; gap: var(--px-space-4); padding: 0 var(--px-space-5); color: var(--px-text-muted); font-size: var(--px-text-xs); }
.st-prog__key { display: inline-flex; align-items: center; gap: var(--px-space-2); }
.st-prog__bar { display: flex; align-items: center; gap: var(--px-space-2); margin-top: var(--px-space-2); }
.st-prog__bar .px-section-label { padding: 0; }
.st-prog__list { display: flex; flex-direction: column; }
.st-prog__row { display: grid; grid-template-columns: minmax(7rem, 12rem) repeat(var(--st-prog-kinds, 1), minmax(0, 1fr)); align-items: center; column-gap: var(--px-space-6); min-height: 36px; padding: 0 var(--px-space-2); border-top: 1px solid var(--px-divider); }
.st-prog__row--head { min-height: 28px; border-top: 0; color: var(--px-text-muted); font-size: var(--px-text-xs); }
.st-prog__row--head > span:first-child { padding-left: var(--px-space-2); }
.st-prog__row .st-prog__kind { display: none; }
.st-prog__name { justify-content: flex-start; min-width: 0; max-width: 100%; justify-self: start; color: var(--px-text); font-weight: 500; }
.st-prog__name .px-btn__label { overflow: hidden; text-overflow: ellipsis; }
.st-prog__name .svg-icon { color: var(--px-text-faint); flex: none; }
.st-prog__name--done .svg-icon { color: var(--px-success); }
.st-prog__under { display: flex; flex-direction: column; gap: var(--px-space-2); padding: var(--px-space-3) var(--px-space-2) 0; border-top: 1px solid var(--px-divider); color: var(--px-text-muted); font-size: var(--px-text-sm); line-height: 1.5; }
.st-prog__hint { display: flex; align-items: center; flex-wrap: wrap; gap: var(--px-space-2); color: var(--px-text-faint); font-size: var(--px-text-xs); }
.st-prog .px-empty { padding-top: var(--px-space-8); }

/* ── A unit's tab (67-unit-view.js): the header, then its groups as quiet lists. Each group's name with its count, its
   actions at the end of that line; under it one line per item (its icon, its title, where it lives, faint) whose press
   opens it, and its Remove; or the kinds' bars with their counts in words. ── */
.st-unit { flex: 1; min-height: 0; overflow: auto; background: var(--px-bg); }
.st-unit__in { max-width: 52rem; margin: 0 auto; }
.st-unit__body { display: flex; flex-direction: column; gap: var(--px-space-6); padding: 0 var(--px-space-6) var(--px-space-8); }
.st-unit__tools { display: contents; }
.st-unit__sec { display: flex; flex-direction: column; gap: var(--px-space-2); min-width: 0; }
.st-unit__hd { display: flex; align-items: center; flex-wrap: wrap; gap: var(--px-space-1) var(--px-space-2); min-height: var(--px-control-h); border-bottom: 1px solid var(--px-divider); padding-bottom: var(--px-space-1); }
.st-unit__name { flex: 1; min-width: 0; margin: 0; font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.st-unit__n { margin-left: var(--px-space-1); font-weight: 400; color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.st-unit__acts { display: flex; align-items: center; flex-wrap: wrap; gap: var(--px-space-1); }
.st-unit__none { color: var(--px-text-muted); font-size: var(--px-text-sm); line-height: 1.5; padding: var(--px-space-1) 0; }
.st-unit__list { display: flex; flex-direction: column; }
.st-unit__item { display: flex; align-items: center; gap: var(--px-space-1); min-width: 0; border-radius: var(--px-radius-sm); }
.st-unit__item:hover { background: var(--px-surface-hover); }
.st-unit__open { flex: 1; min-width: 0; justify-content: flex-start; height: auto; min-height: var(--px-control-h); color: var(--px-text); font-weight: 400; }
.st-unit__open:hover { background: transparent; }
.st-unit__open .svg-icon { flex: none; color: var(--px-text-muted); }
.st-unit__open .px-btn__label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.st-unit__where { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--px-text-muted); font-size: var(--px-text-sm); }
.st-unit__where--gone { color: var(--px-text-secondary); font-style: italic; }
.st-unit__item--gone .st-unit__open .px-btn__label { color: var(--px-text-secondary); text-decoration: line-through; text-decoration-color: var(--px-text-muted); }
.st-unit__rm { flex: none; color: var(--px-text-muted); opacity: 0; }
.st-unit__item:hover > .st-unit__rm, .st-unit__item:focus-within > .st-unit__rm, [data-input-modality="touch"] .st-unit__item > .st-unit__rm, .st-unit__item--gone > .st-unit__rm { opacity: 1; }
.st-unit__bar { display: flex; align-items: center; min-width: 0; padding-top: var(--px-space-1); }
.st-unit__bar .px-stacked-bar { flex: 1; }
.st-unit__words { color: var(--px-text-muted); font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; line-height: 1.5; }
/* A tab too narrow for its columns (the more kinds, the sooner; 63-progress-view.js measures it): a unit's kinds
   stack under its name, each bar named in words where the column heads were, so a bar always has room for its parts and its count. */
.st-prog__list--stacked .st-prog__row--head { display: none; }
/* The bars are a finger's height apart (WCAG 2.5.8): each part's press area is 24px tall or more and none lies over the next bar's. */
.st-prog__list--stacked .st-prog__row { grid-template-columns: minmax(0, 1fr); row-gap: var(--px-space-3); padding: var(--px-space-3) var(--px-space-2); }
.st-prog__list--stacked .st-prog__cell { min-height: var(--px-space-4); }
.st-prog__list--stacked .st-prog__row .st-prog__kind { display: block; padding-left: var(--px-space-2); }
.st-prog__list--stacked .st-prog__cell--none { display: none; }

/* ── A plan's tab (66-plan-view.js): the header and the four Open buttons, the three plans as cards, hours per day and
   the phases side by side (one over the other when narrow), the rules that disagree, then every day as a table grouped
   by week. The ordinary study day is quiet; Rest is italic, a Holiday and a Catch-up day carry a filled word, and the
   rest days' and holidays' rows sit on the inset ground, so each Type is told apart by more than its colour. ── */
.st-plan { flex: 1; min-height: 0; overflow: auto; background: var(--px-bg); }
.st-plan__in { max-width: 72rem; margin: 0 auto; container-type: inline-size; container-name: st-plan; }
.st-plan__opens { display: flex; flex-wrap: wrap; gap: var(--px-space-1); padding: 0 var(--px-space-6) var(--px-space-4); }
.st-plan__body { display: flex; flex-direction: column; gap: var(--px-space-6); padding: 0 var(--px-space-6) var(--px-space-8); }
.st-plan__sec { display: flex; flex-direction: column; gap: var(--px-space-2); min-width: 0; }
.st-plan__h { margin: 0; padding-bottom: var(--px-space-1); border-bottom: 1px solid var(--px-divider); font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.st-plan__goal, .st-plan__note, .st-plan__wait { color: var(--px-text-muted); font-size: var(--px-text-sm); line-height: 1.5; }
.st-plan__wait { padding: var(--px-space-6) 0; }
.st-plan__plans .ui-segmented-control--cards { margin-top: var(--px-space-1); }
.st-plan__pair { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--px-space-6); align-items: start; }
@container st-plan (max-width: 640px) { .st-plan__pair { grid-template-columns: minmax(0, 1fr); } }
.st-plan__bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--px-space-1); }
.st-plan__barrow { display: grid; grid-template-columns: 5ch minmax(0, 1fr) 8ch; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; }
.st-plan__barh { color: var(--px-text); text-align: right; }
.st-plan__bard { color: var(--px-text-secondary); }
.st-plan__track { display: block; height: 6px; border-radius: var(--px-radius-full); background: var(--px-surface-active); overflow: hidden; }
.st-plan__fill { display: block; height: 100%; border-radius: var(--px-radius-full); background: var(--px-accent); }
.st-plan__plist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.st-plan__phase { display: flex; flex-direction: column; gap: 2px; padding: var(--px-space-2) 0; border-top: 1px solid var(--px-divider); }
.st-plan__phase:first-child { border-top: 0; padding-top: 0; }
.st-plan__pline { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--px-space-2); min-width: 0; }
.st-plan__pname { color: var(--px-text); font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
.st-plan__kind { color: var(--px-text-muted); font-size: var(--px-text-xs); }
.st-plan__pfacts { color: var(--px-text-secondary); font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; }
.st-plan__fit { display: flex; align-items: center; flex-wrap: wrap; gap: var(--px-space-2) var(--px-space-3); font-size: var(--px-text-sm); }
.st-plan__needs { color: var(--px-danger); font-weight: 500; }
.st-plan__fits { color: var(--px-text-secondary); }
.st-plan__fitall { display: inline-flex; align-items: center; gap: var(--px-space-2); color: var(--px-text-muted); font-size: var(--px-text-xs); }
.st-plan__all { display: flex; flex-direction: column; gap: 2px; color: var(--px-text-secondary); font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; }
.st-plan__badlist { margin: 0; padding-left: var(--px-space-5); display: flex; flex-direction: column; gap: var(--px-space-1); color: var(--px-text); font-size: var(--px-text-sm); line-height: 1.5; }
.st-plan__bad .st-plan__h { color: var(--px-danger); }
.st-plan__scroll { overflow-x: auto; min-width: 0; border-radius: var(--px-radius-sm); }
.st-plan__scroll:focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 2px; }
.st-plan__table { width: 100%; border-collapse: collapse; font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; }
.st-plan__cap { caption-side: top; text-align: left; padding-bottom: var(--px-space-2); color: var(--px-text-muted); font-size: var(--px-text-xs); }
.st-plan__table th, .st-plan__table td { padding: 3px var(--px-space-2); text-align: left; white-space: nowrap; border-bottom: 1px solid var(--px-divider); }
.st-plan__table thead th { color: var(--px-text-muted); font-size: var(--px-text-xs); font-weight: 500; }
.st-plan__table .st-plan__n { text-align: right; }
.st-plan__wkrow th { padding-top: var(--px-space-3); color: var(--px-text-secondary); font-size: var(--px-text-xs); font-weight: 600; background: var(--px-bg); }
.st-plan__date { font-weight: 400; color: var(--px-text); }
.st-plan__date > span + span { margin-left: var(--px-space-2); }
.st-plan__tag { display: inline-block; padding: 0 var(--px-space-1); border: 1px solid var(--px-border); border-radius: var(--px-radius-xs); color: var(--px-text-secondary); font-size: var(--px-text-2xs); line-height: 1.5; }
.st-plan__tag--today { border-color: var(--px-accent); color: var(--px-accent-text); }
.st-plan__pcell { color: var(--px-text-secondary); max-width: 16rem; overflow: hidden; text-overflow: ellipsis; }
.st-plan__total { color: var(--px-text); font-weight: 600; }
.st-plan__done, .st-plan__run { color: var(--px-text-secondary); }
.st-plan__type { display: inline-block; padding: 0 var(--px-space-1); border-radius: var(--px-radius-xs); color: var(--px-text-secondary); }
.st-plan__type--rest { font-style: italic; }
.st-plan__type--catchup { background: var(--px-accent-soft); color: var(--px-accent-text); font-weight: 600; }
.st-plan__type--holiday { background: var(--px-warning-soft); color: var(--px-text); font-weight: 600; }
.st-plan__day--rest, .st-plan__day--holiday { background: var(--px-bg-inset); }
.st-plan__day--today > th:first-child { box-shadow: inset 3px 0 0 var(--px-accent); }
.st-plan__day:hover { background: var(--px-surface-hover); }
.st-plan__outside .st-plan__table { max-width: 40rem; }
.st-plan .px-empty { padding-top: var(--px-space-8); }

/* ── The New Plan sheet (64-plan-sheet.js): the Name, the dates and the goal as the New Subject sheet's rows; the usual
   week as a grid, a column per weekday, the personal hours over the work hours; then Floor's and Stretch's spread. ── */
.st-psheet { width: min(680px, calc(100% - var(--px-space-8))); max-height: calc(100% - var(--px-space-8)); display: flex; flex-direction: column; }
.st-psheet .st-sheet__bd { overflow: auto; min-height: 0; }
.st-psheet__week { display: flex; flex-direction: column; gap: var(--px-space-2); padding: var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-inset); }
.st-psheet__weekhd { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text); }
.st-psheet__grid { display: grid; grid-template-columns: 5rem repeat(7, minmax(0, 1fr)); align-items: center; gap: var(--px-space-1) var(--px-space-1); }
.st-psheet__day { text-align: center; color: var(--px-text-muted); font-size: var(--px-text-xs); }
.st-psheet__acct { color: var(--px-text-secondary); font-size: var(--px-text-sm); }
.st-psheet__h .ui-input-box { width: 100%; }
.st-psheet__h input { text-align: center; font-variant-numeric: tabular-nums; }
.st-psheet__spread { display: flex; flex-wrap: wrap; gap: var(--px-space-2) var(--px-space-5); }
.st-psheet__pair { display: grid; grid-template-columns: auto 4.5rem auto; align-items: center; gap: var(--px-space-2); }
.st-psheet__pair .st-row__lab { width: auto; }
.st-psheet__pair input { text-align: center; font-variant-numeric: tabular-nums; }
.st-psheet__sums { color: var(--px-text-secondary); font-size: var(--px-text-sm); line-height: 1.5; font-variant-numeric: tabular-nums; }
@container st-sheet (max-width: 520px) { .st-psheet__grid { grid-template-columns: 3.5rem repeat(7, minmax(0, 1fr)); } }

/* ── The plan's row in the sidebar, under its subject, over its units ───── */
/* In a narrow sidebar the days left go under the name rather than squeeze it out. */
.st-sb__sec--subjects .st-sb__nav--plan { flex-wrap: wrap; align-content: center; row-gap: 0; height: auto; min-height: var(--px-control-h); padding-block: var(--px-space-1); padding-left: min(var(--px-space-8), 15%); }
.st-sb__sec--subjects .st-sb__nav--plan .svg-icon { color: var(--px-accent-text); }

/* ── Dashboard widget rows (70-integration.js draws them) ──────────────── */
.st-widget { display: flex; flex-direction: column; min-height: 0; }
.st-widget__empty { font-size: var(--px-text-sm); color: var(--px-text-muted); padding: var(--px-space-2) 0; }
.st-widget__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--px-space-2); align-items: center; padding: var(--px-space-2) 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-sm); cursor: pointer; color: var(--px-text); outline: none; }
.st-widget__row:first-of-type { border-top: 0; }
.st-widget__row:hover .st-widget__label, .st-widget__row:focus-visible .st-widget__label { color: var(--px-accent-text); }
.st-widget__text { min-width: 0; }
.st-widget__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-widget__under { display: block; color: var(--px-text-muted); font-size: var(--px-text-xs); margin-top: 1px; }
.st-widget__bar { width: 72px; height: 4px; border-radius: var(--px-radius-full); background: var(--px-surface-active); overflow: hidden; display: block; }
.st-widget__fill { display: block; height: 100%; background: var(--px-danger); }
.st-widget__fill--warn { background: var(--px-warning); }
.st-widget__foot { margin-top: var(--px-space-2); align-self: flex-start; }

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
