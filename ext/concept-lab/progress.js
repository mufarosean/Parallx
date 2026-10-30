// progress.js — where you are in each Concept Lab module, kept with the
// workspace: the story step and the predictions answered, so the home can
// show it and Resume it after a restart. Slider values stay per run.

const CL_PROGRESS_KEY = 'conceptLab.progress';
let store = null; // the workspace's memento, from activate

export function setProgressStore(next) { store = next || null; }

/** { last: module id or null, modules: { [id]: { step, answers, at } } } */
export function clProgress() {
  let p = null;
  try { p = store?.get?.(CL_PROGRESS_KEY); } catch { /* none */ }
  return p && typeof p === 'object' ? { last: p.last ?? null, modules: { ...(p.modules || {}) } } : { last: null, modules: {} };
}

/** Remember the module's step and answers, and that it is the one you were last in. */
export function clNoteProgress(mod, st) {
  if (!store || !mod) return;
  const p = clProgress();
  p.modules[mod.id] = { step: st.storyIndex, answers: { ...st.predictAnswers }, at: Date.now() };
  p.last = mod.id;
  try { void Promise.resolve(store.update(CL_PROGRESS_KEY, p)).catch(() => {}); } catch { /* kept for this run */ }
}

/** Where a module stands: started, its step, and its predictions answered (all of them is done). */
export function clStanding(mod, rec) {
  const steps = mod.story.length;
  const predicts = mod.story.map((s, i) => (s.predict ? i : -1)).filter((i) => i >= 0);
  const answered = rec ? predicts.filter((i) => rec.answers?.[i] !== undefined).length : 0;
  const step = rec ? Math.max(0, Math.min(Number(rec.step) || 0, steps - 1)) : 0;
  const done = !!rec && (predicts.length ? answered === predicts.length : step >= steps - 1);
  return { started: !!rec, step, steps, predicts: predicts.length, answered, done };
}

/** The line a module's card and the Continue strip show. */
export function clStandingText(s) {
  if (!s.started) return 'Not started';
  if (s.done) return s.predicts ? `Done, ${s.answered} of ${s.predicts} predictions answered` : 'Done';
  return `Step ${s.step + 1} of ${s.steps}` + (s.predicts ? `, ${s.answered} of ${s.predicts} predictions answered` : '');
}
