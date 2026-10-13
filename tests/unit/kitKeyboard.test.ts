// @vitest-environment jsdom
// kitKeyboard.test.ts — a pressable control declared on an element the
// keyboard could not reach (a div or span with a click listener) joins the
// Tab order and answers Enter and Space; one that already handles its keys
// is left alone. docs/ACCESSIBILITY.md, section 2.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { declareControl } from '../../src/ui/kit.js';
import { scene } from '../../src/ui/scene.js';

const press = (el: HTMLElement, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

afterEach(() => { document.body.innerHTML = ''; scene.reset(); });

describe('declared controls are keyboard controls', () => {
  it('a clickable div becomes reachable and pressable', () => {
    const card = document.createElement('div');
    card.textContent = 'New Page';
    const clicked = vi.fn();
    card.addEventListener('click', clicked);
    document.body.appendChild(card);
    declareControl(card, { id: 'welcome.newPage', label: 'New Page' });
    expect(card.tabIndex).toBe(0);
    expect(card.getAttribute('role')).toBe('button');
    press(card, 'Enter');
    press(card, ' ');
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it('a select declared on its wrapper names the button inside, not the wrapper', () => {
    const wrap = document.createElement('div');
    const button = document.createElement('button');
    button.textContent = 'Quiet ▾';
    wrap.appendChild(button);
    document.body.appendChild(wrap);
    declareControl(wrap, { id: 'routine.class', label: 'Routine class', kind: 'select' });
    expect(wrap.hasAttribute('role')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Routine class');
  });

  it('leaves alone an element with its own tabindex, a native button, and a wrapper of one', () => {
    const own = document.createElement('div');
    own.tabIndex = -1;
    const btn = document.createElement('button');
    const wrap = document.createElement('div');
    wrap.appendChild(document.createElement('button'));
    document.body.append(own, btn, wrap);
    declareControl(own, { id: 'a.own', label: 'Own' });
    declareControl(btn, { id: 'a.btn', label: 'Button' });
    declareControl(wrap, { id: 'a.wrap', label: 'Wrap' });
    expect(own.tabIndex).toBe(-1);
    expect(btn.getAttribute('tabindex')).toBeNull();
    expect(wrap.getAttribute('tabindex')).toBeNull();
  });
});

describe('a slider declared on its wrapper', () => {
  it('names the range input inside and leaves the wrapper without a role', () => {
    const wrap = document.createElement('div');
    const range = document.createElement('input');
    range.type = 'range';
    wrap.appendChild(range);
    document.body.appendChild(wrap);
    declareControl(wrap, { id: 'aiSettings.agent.maxIterations', label: 'Max iterations', kind: 'slider' });
    expect(wrap.hasAttribute('role')).toBe(false);
    expect(range.getAttribute('aria-label')).toBe('Max iterations');
  });
});
