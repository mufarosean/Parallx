// keys.js — the keyboard's way to the Media Organizer's pointer gestures.
//
// Every drag in the library, the viewers and the editors has a key that does
// the same thing (docs/ACCESSIBILITY.md, section 6). Four shapes cover them:
//   moViewKeys    a zoomable view: + and - zoom about the centre, 0 fits, the
//                 arrows pan while zoomed (Shift: farther).
//   moBoxKeys     a box on a frame (a blur region, a crop window, a caption):
//                 the arrows move it, Alt+arrows size it (Right and Down grow),
//                 Shift for ten steps.
//   moSliderKeys  a value handle (a split bar, a colour wheel's ring, a curve
//                 point): a slider the arrows, Page keys, Home and End step.
//   moReorderKeys an item in a row or list: Ctrl+Shift+arrows move it.
// Each gives its element a Tab stop and a name unless it already has them, and
// leaves keys aimed at a control inside the element to that control.

const own = (el, e) => e.target === el;
const ARROW = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function reachable(el, label, role, keys) {
  if (el.tabIndex < 0 || !el.hasAttribute('tabindex')) el.tabIndex = 0;
  if (role && !el.getAttribute('role')) el.setAttribute('role', role);
  if (label && !el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
  if (keys) el.setAttribute('aria-keyshortcuts', keys);
}

/**
 * `view`: { zoom(): number, zoomBy(factor): void, pan(dx, dy): void, reset(): void }.
 * pan takes screen pixels the content moves by. A key the view does not use
 * (an arrow while not zoomed: the lightbox's next photo) is left alone.
 */
export function moViewKeys(el, label, view) {
  reachable(el, label, 'group', '+ - 0 ArrowLeft ArrowRight ArrowUp ArrowDown');
  const onKey = (e) => {
    if (!own(el, e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = ARROW[e.key];
    const step = e.shiftKey ? 160 : 40;
    if (a && view.zoom() > 1.001) view.pan(-a[0] * step, -a[1] * step);
    else if (e.key === '+' || e.key === '=') view.zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') view.zoomBy(0.8);
    else if (e.key === '0') view.reset();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener('keydown', onKey);
  return () => el.removeEventListener('keydown', onKey);
}

/**
 * `box.nudge(dx, dy, resize)`: steps, not pixels (the caller sizes a step);
 * resize grows the right or bottom edge by dx or dy. `box.commit()` (optional)
 * runs after each key, as a drag's mouseup does.
 */
export function moBoxKeys(el, label, box) {
  reachable(el, label, 'group', 'ArrowLeft ArrowRight ArrowUp ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');
  const onKey = (e) => {
    const a = ARROW[e.key];
    if (!own(el, e) || !a || e.ctrlKey || e.metaKey) return;
    const n = e.shiftKey ? 10 : 1;
    box.nudge(a[0] * n, a[1] * n, e.altKey);
    box.commit?.();
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener('keydown', onKey);
  return () => el.removeEventListener('keydown', onKey);
}

/**
 * `v`: { get(): number, set(value): void, min, max, step, big?, text?(value) }.
 * set clamps nothing itself: values arrive clamped to [min, max].
 */
export function moSliderKeys(el, label, v) {
  reachable(el, label, 'slider');
  const sync = () => {
    const x = v.get();
    el.setAttribute('aria-valuemin', String(v.min));
    el.setAttribute('aria-valuemax', String(v.max));
    el.setAttribute('aria-valuenow', String(Math.round(x * 1000) / 1000));
    if (v.text) el.setAttribute('aria-valuetext', v.text(x));
  };
  sync();
  const onKey = (e) => {
    if (!own(el, e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const x = v.get(), big = v.big ?? v.step * 10;
    const to = { ArrowRight: x + v.step, ArrowUp: x + v.step, ArrowLeft: x - v.step, ArrowDown: x - v.step, PageUp: x + big, PageDown: x - big, Home: v.min, End: v.max }[e.key];
    if (to === undefined) return;
    v.set(Math.max(v.min, Math.min(v.max, to)));
    sync();
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('pointerup', sync);
  return () => { el.removeEventListener('keydown', onKey); el.removeEventListener('pointerup', sync); };
}

/** `move(delta)`: -1 earlier, +1 later. `axis` 'x' (Left/Right) or 'y' (Up/Down). */
export function moReorderKeys(el, move, axis = 'y') {
  const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  el.setAttribute('aria-keyshortcuts', `Control+Shift+${keys[0]} Control+Shift+${keys[1]}`);
  const onKey = (e) => {
    const i = keys.indexOf(e.key);
    if (i < 0 || !e.ctrlKey || !e.shiftKey || e.altKey) return;
    move(i === 0 ? -1 : 1);
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener('keydown', onKey);
  return () => el.removeEventListener('keydown', onKey);
}
