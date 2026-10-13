// keys.js — the graph from the keyboard, the same in the editor and the
// sidebar (docs/ACCESSIBILITY.md, section 6). The canvas takes focus;
// PageDown/PageUp pick the next or previous node (drawn as a hover is and
// brought into view); the arrows move the picked node, pinning it as a drag
// does, or with none picked pan the view (Shift: farther). Enter opens the
// picked node, Space pins or unpins it, Escape lets it go; + and - zoom
// about the middle, 0 fits.
//
// opts: { label, nodes(), view, pick(node | null), moved(), redraw(), open?(node), fit?() }

export function wgGraphKeys(cvs, opts) {
  const { view } = opts;
  let pickedId = null;
  const picked = () => (pickedId == null ? null : opts.nodes().find((n) => n.id === pickedId && n.visible) || null);
  cvs.tabIndex = 0;
  cvs.setAttribute('role', 'application');
  cvs.setAttribute('aria-roledescription', 'graph');
  cvs.setAttribute('aria-keyshortcuts', 'PageDown PageUp ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space Escape + - 0');
  const name = () => {
    const n = picked();
    cvs.setAttribute('aria-label', n ? `${opts.label}: ${n.label}${n.pinned ? ', pinned' : ''}` : `${opts.label}: PageDown picks a node, the arrows pan`);
  };
  name();

  // A focus ring drawn inside: the canvas fills its pane edge to edge.
  const ring = () => {
    const on = document.activeElement === cvs && cvs.matches(':focus-visible');
    cvs.style.boxShadow = on ? 'inset 0 0 0 var(--px-focus-width) var(--px-accent)' : '';
    opts.pick(document.activeElement === cvs ? picked() : null);
    opts.redraw();
  };
  cvs.addEventListener('focus', ring);
  cvs.addEventListener('blur', ring);

  const intoView = (n) => {
    const w = cvs.clientWidth, h = cvs.clientHeight;
    const sx = n.x * view.s + view.x, sy = n.y * view.s + view.y;
    if (sx < 40 || sx > w - 40 || sy < 40 || sy > h - 40) { view.x = w / 2 - n.x * view.s; view.y = h / 2 - n.y * view.s; }
  };

  cvs.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const n = picked();
    const step = e.shiftKey ? 80 : 16;
    if (k === 'PageDown' || k === 'PageUp') {
      const list = opts.nodes().filter((x) => x.visible);
      if (!list.length) return;
      const at = n ? list.indexOf(n) : -1;
      const fwd = k === 'PageDown';
      const next = list[at < 0 ? (fwd ? 0 : list.length - 1) : (at + (fwd ? 1 : -1) + list.length) % list.length];
      pickedId = next.id;
      intoView(next);
    } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
      const dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      if (n) {
        n.x += (dx * step) / view.s; n.y += (dy * step) / view.s;
        n.vx = 0; n.vy = 0; n.pinned = true;
        intoView(n);
        opts.moved();
      } else {
        view.x -= dx * step; view.y -= dy * step;
      }
    } else if (k === 'Enter' && n && opts.open) {
      opts.open(n);
    } else if (k === ' ' && n) {
      n.pinned = !n.pinned;
      opts.moved();
    } else if (k === 'Escape' && n) {
      pickedId = null;
    } else if (k === '+' || k === '=' || k === '-') {
      const f = k === '-' ? 1 / 1.2 : 1.2;
      const mx = cvs.clientWidth / 2, my = cvs.clientHeight / 2;
      view.x = mx - (mx - view.x) * f; view.y = my - (my - view.y) * f; view.s *= f;
    } else if (k === '0' && opts.fit) {
      opts.fit();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    name();
    ring();
  });
}
