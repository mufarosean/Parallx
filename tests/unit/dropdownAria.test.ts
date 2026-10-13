// @vitest-environment jsdom
// dropdownAria.test.ts — a dropdown tells a screen reader which option the
// arrow keys are on (the button's aria-activedescendant names it), Home and
// End jump, and Tab closes the list. docs/ACCESSIBILITY.md, section 1.

import { describe, it, expect, afterEach } from 'vitest';
import { Dropdown } from '../../src/ui/dropdown.js';

const key = (k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

afterEach(() => { document.body.innerHTML = ''; });

describe('dropdown for a screen reader', () => {
  it('names the highlighted option, jumps with Home and End, and closes on Tab', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dd = new Dropdown(host, { items: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }], selected: 'a', ariaLabel: 'Pick' });
    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-controls')).toMatch(/^ui-dropdown-list-/);
    button.focus();
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    key('ArrowDown');
    const active = () => document.getElementById(button.getAttribute('aria-activedescendant') ?? '-')?.textContent;
    const first = active();
    key('End');
    expect(active()).toBe('Gamma');
    key('Home');
    expect(active()).toBe('Alpha');
    expect(first).toBeTruthy();
    key('Tab');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-activedescendant')).toBe(false);
    dd.dispose();
  });
});
