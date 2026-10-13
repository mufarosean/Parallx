// @vitest-environment jsdom
// workspaceGraphKeys.test.ts — the Workspace Graph from the keyboard, in the
// editor and the sidebar alike: PageDown/PageUp pick a node, the arrows move
// it (pinned, as a drag pins it) or pan with none picked, Enter opens it,
// Space pins, Escape lets go, + and - zoom about the middle, 0 fits.
// docs/ACCESSIBILITY.md, section 6.

import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error — plain-JS extension module with no types
import { wgGraphKeys } from '../../ext/workspace-graph/keys.js';

type N = { id: string; label: string; x: number; y: number; vx: number; vy: number; visible: boolean; pinned: boolean };

describe('the graph from the keyboard', () => {
  it('picks, moves, pins, opens, pans and zooms', () => {
    const cvs = document.createElement('canvas');
    Object.defineProperty(cvs, 'clientWidth', { value: 400 });
    Object.defineProperty(cvs, 'clientHeight', { value: 300 });
    document.body.appendChild(cvs);
    const node = (id: string, x: number, visible = true): N => ({ id, label: id.toUpperCase(), x, y: 0, vx: 3, vy: 3, visible, pinned: false });
    const nodes = [node('a', 0), node('hidden', 10, false), node('b', 50)];
    const view = { x: 200, y: 150, s: 1 };
    let hovered: N | null = null;
    const opts = {
      label: 'Workspace graph', nodes: () => nodes, view,
      pick: (n: N | null) => { hovered = n; }, moved: vi.fn(), redraw: vi.fn(), open: vi.fn(), fit: vi.fn(),
    };
    wgGraphKeys(cvs, opts);
    expect(cvs.tabIndex).toBe(0);
    cvs.focus();
    const key = (k: string, init: KeyboardEventInit = {}) => cvs.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

    key('ArrowRight'); // none picked: pans
    expect(view.x).toBe(184);
    key('PageDown');
    expect(hovered).toBe(nodes[0]);
    expect(cvs.getAttribute('aria-label')).toBe('Workspace graph: A');
    key('PageDown'); // the hidden node is skipped
    expect(hovered).toBe(nodes[2]);
    key('ArrowDown', { shiftKey: true });
    expect(nodes[2]).toMatchObject({ y: 80, vx: 0, pinned: true });
    expect(opts.moved).toHaveBeenCalled();
    key(' ');
    expect(nodes[2].pinned).toBe(false);
    key('Enter');
    expect(opts.open).toHaveBeenCalledWith(nodes[2]);
    key('PageDown'); // wraps
    expect(hovered).toBe(nodes[0]);
    key('Escape');
    expect(hovered).toBeNull();
    const s0 = view.s;
    key('+');
    expect(view.s).toBeCloseTo(s0 * 1.2, 9);
    key('0');
    expect(opts.fit).toHaveBeenCalled();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    cvs.dispatchEvent(esc); // nothing picked: Escape is not ours
    expect(esc.defaultPrevented).toBe(false);
    cvs.blur();
    expect(hovered).toBeNull();
  });
});
