// @vitest-environment jsdom
//
// budgetDropdown.test.ts — the Budget extension's category picker.
//
// Written because the category menu on a transaction row could not be scrolled:
// it dismissed itself on the first wheel tick. The cause was a capture-phase
// `scroll` listener on `window` calling close() unconditionally — capture
// propagation runs window -> document -> ... -> target, so it fired for scroll
// events targeting the menu's OWN scroller.
//
// That bug lived in a 200-line hand-rolled dropdown inside the extension. The fix
// was not to patch the clone but to delete it: makeDropdown is now a thin adapter
// over `api.ui.createDropdown`, the one `.ui-dropdown` component the whole app
// shares. So these tests assert the ADAPTER's contract — that the call sites'
// `.value` / `.setOptions` surface still works, that categories keep their colour
// swatches, and that what renders is the shared component rather than a local
// copy. The scroll and placement behaviour itself is tested once, at the
// component, in uiComponents.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';
import { Dropdown, createDropdownHandle } from '../../src/ui/dropdown.js';

const { makeDropdown, categoryOptions, scopedCategoryOptions, __setApi } = __testables as {
  __setApi: (api: unknown) => void;
  scopedCategoryOptions: (
    cats: ReadonlyArray<{ id: string; name: string; color?: string; kind?: string }>,
    txType: string | null,
    selectedId?: string,
    placeholder?: string,
  ) => Array<{ value: string; label: string; color?: string }>;
  makeDropdown: (
    options: ReadonlyArray<{ value: string; label: string; color?: string }>,
    value?: string,
    onChange?: (v: string) => void,
    opts?: { placeholder?: string; className?: string; ariaLabel?: string },
  ) => HTMLElement & { value: string; setOptions(o: unknown[], v?: string): void; focus(): void };
  categoryOptions: (
    cats: ReadonlyArray<{ id: string; name: string; color?: string }>,
    placeholder?: string,
  ) => Array<{ value: string; label: string; color?: string }>;
};

// The 12 categories main.js seeds into an empty database, so the fixture matches
// what a real user's menu holds before they add any of their own. At ~27px per
// option that is already past the list's 320px cap — the scroller is not
// hypothetical.
const SEEDED = [
  ['Groceries', '#5cb87a'], ['Dining', '#e8924a'], ['Transport', '#5b8fd6'],
  ['Utilities', '#e3c04e'], ['Shopping', '#e07ba0'], ['Health', '#e0625e'],
  ['Entertainment', '#b07fb0'], ['Subscriptions', '#5bb5bf'], ['Travel', '#b08968'],
  ['Other', '#98a2b3'], ['Income', '#4e9e6a'], ['Transfer', '#7d8aa0'],
].map(([name, color], i) => ({ id: `cat-${i}`, name, color }));

let hosts: HTMLElement[] = [];

beforeEach(() => {
  hosts = [];
  // `api.ui.createDropdown` is wired to the REAL factory the host injects — the
  // same function apiFactory hands every extension — not a stand-in. A stub would
  // let this adapter drift back into a private implementation with every test
  // still green, which is the failure mode that produced the clone.
  __setApi({ ui: { createDropdown: createDropdownHandle } });
});

afterEach(() => {
  for (const h of hosts) h.remove();
  for (const l of Array.from(document.querySelectorAll('.ui-dropdown__list'))) l.remove();
  vi.restoreAllMocks();
});

function mount(value = '', onChange?: (v: string) => void, opts?: Record<string, unknown>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const dd = makeDropdown(categoryOptions(SEEDED), value, onChange, opts ?? {});
  host.appendChild(dd);
  const btn = dd.querySelector('.ui-dropdown__button') as HTMLButtonElement;
  return {
    dd,
    btn,
    host,
    open: () => { btn.click(); return document.querySelector('.ui-dropdown__list') as HTMLElement; },
    list: () => document.querySelector('.ui-dropdown__list') as HTMLElement | null,
    items: () => Array.from(document.querySelectorAll<HTMLElement>('.ui-dropdown__list .ui-dropdown__item')),
  };
}

// ── It is the shared component, not a clone ──────────────────────────────────

describe('compliance with the one-dropdown rule', () => {
  it('renders the core .ui-dropdown inside the budget host', () => {
    const d = mount();
    expect(d.dd.classList.contains('budget-dd')).toBe(true);
    expect(d.dd.querySelector('.ui-dropdown')).not.toBeNull();
    expect(d.dd.querySelector('.ui-dropdown__button')).not.toBeNull();
  });

  it('no longer emits any of the clone\'s markup', () => {
    // If any of these come back, a local dropdown has been reintroduced.
    const d = mount('cat-3');
    d.open();
    for (const dead of ['.budget-dd-btn', '.budget-dd-menu', '.budget-dd-opt', '.budget-dd-caret', '.budget-dd-check']) {
      expect(document.querySelector(dead), `${dead} should be gone`).toBeNull();
    }
  });

  it('opens its list into the body layer, so a scrolling table cannot clip it', () => {
    // The reason the clone existed: .budget-editor is overflow:auto, and an
    // absolutely-positioned list inside the row was clipped by it.
    const d = mount();
    const list = d.open();
    expect(list).not.toBeNull();
    expect(list.parentElement).toBe(document.body);
    expect(d.host.querySelector('.ui-dropdown__list')).toBeNull();
  });
});

// ── The call sites' contract is unchanged ────────────────────────────────────

describe('adapter surface used by the ~10 call sites', () => {
  it('exposes .value as a getter', () => {
    expect(mount('cat-4').dd.value).toBe('cat-4');
  });

  it('exposes .value as a setter that repaints the trigger', () => {
    const d = mount('cat-0');
    d.dd.value = 'cat-6';
    expect(d.dd.value).toBe('cat-6');
    expect(d.btn.textContent).toContain('Entertainment');
  });

  it('reports the picked category through onChange and closes', () => {
    let picked: string | undefined;
    const d = mount('', (v) => { picked = v; });
    d.open();
    d.items()[3].click();                 // index 0 is the placeholder row
    expect(picked).toBe('cat-2');
    expect(d.dd.value).toBe('cat-2');
    expect(d.list()).toBeNull();
  });

  it('does not fire onChange when the same value is re-picked', () => {
    let calls = 0;
    const d = mount('cat-0', () => { calls++; });
    d.open();
    d.items()[1].click();
    expect(calls).toBe(0);
  });

  it('setOptions swaps the list', () => {
    const d = mount('cat-0');
    d.dd.setOptions([{ value: 'x', label: 'Custom' }]);
    d.open();
    expect(d.items()).toHaveLength(1);
    expect(d.items()[0].textContent).toBe('Custom');
  });

  it('setOptions can change items and value together without flashing the placeholder', () => {
    // Dependent dropdowns (tx type -> category kind) rely on this. Done as two
    // statements the trigger shows the placeholder in between, because the old
    // value is absent from the new list.
    const d = mount('cat-0', undefined, { placeholder: '— Pick category —' });
    d.dd.setOptions([{ value: 'n1', label: 'New One' }], 'n1');
    expect(d.dd.value).toBe('n1');
    expect(d.btn.textContent).toContain('New One');
    expect(d.btn.textContent).not.toContain('Pick category');
  });

  it('applies the caller\'s extra class to the host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const dd = makeDropdown([{ value: 'a', label: 'A' }], 'a', undefined, { className: 'budget-dd-wide' });
    host.appendChild(dd);
    expect(dd.className).toBe('budget-dd budget-dd-wide');
  });

  it('tolerates a null/undefined value the way a <select> would', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const dd = makeDropdown(categoryOptions(SEEDED), null as unknown as string);
    host.appendChild(dd);
    expect(dd.value).toBe('');
  });

  it('survives a non-array option set instead of throwing', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    expect(() => {
      const dd = makeDropdown(undefined as unknown as [], '');
      host.appendChild(dd);
      dd.setOptions(null as unknown as []);
    }).not.toThrow();
  });
});

// ── Categories keep their colours ────────────────────────────────────────────

describe('category colour swatches', () => {
  it('shows a swatch for every category in the list', () => {
    const d = mount();
    d.open();
    // Every row except the '— Uncategorized —' placeholder, which has no colour.
    expect(document.querySelectorAll('.ui-dropdown__list .ui-dropdown__swatch')).toHaveLength(SEEDED.length);
  });

  it('shows the selected category\'s swatch on the trigger', () => {
    const d = mount('cat-1');
    const sw = d.dd.querySelector('.ui-dropdown__button .ui-dropdown__swatch') as HTMLElement;
    expect(sw).not.toBeNull();
    expect(sw.style.background).toBeTruthy();
  });

  it('drops the trigger swatch for the uncategorized option', () => {
    const d = mount('cat-1');
    d.dd.value = '';
    expect(d.dd.querySelector('.ui-dropdown__button .ui-dropdown__swatch')).toBeNull();
  });

  it('carries the category colour through categoryOptions', () => {
    const opts = categoryOptions(SEEDED);
    expect(opts[0]).toEqual({ value: '', label: '— Uncategorized —' });
    expect(opts[1]).toEqual({ value: 'cat-0', label: 'Groceries', color: '#5cb87a' });
  });

  it('honours a custom placeholder label', () => {
    expect(categoryOptions(SEEDED, '— Pick category —')[0].label).toBe('— Pick category —');
  });
});

// ── The reported bug, at the adapter level ───────────────────────────────────

describe('the original defect, end to end', () => {
  it('scrolling the open category list does not dismiss it', () => {
    // THE regression, asserted through the path a user actually takes: budget's
    // makeDropdown -> core Dropdown -> guarded scroll handler.
    const d = mount('cat-5');
    const list = d.open();
    list.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(d.list(), 'scrolling the category list dismissed it').not.toBeNull();
  });

  it('scrolling a category row does not dismiss it either', () => {
    const d = mount('cat-5');
    d.open();
    d.items()[6].dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(d.list()).not.toBeNull();
  });

  it('still dismisses when the transaction table behind it scrolls', () => {
    const d = mount('cat-5');
    d.open();
    d.host.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(d.list()).toBeNull();
  });

  it('offers all 12 categories plus uncategorized', () => {
    const d = mount();
    d.open();
    expect(d.items()).toHaveLength(SEEDED.length + 1);
  });

  it('is keyboard navigable, which a list you cannot scroll also is not', () => {
    const d = mount('cat-0');
    d.open();
    d.dd.querySelector('.ui-dropdown')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const focused = document.querySelector('.ui-dropdown__item--focused');
    expect(focused?.textContent).toContain('Dining');
  });
});

// ── Category kind scoping ────────────────────────────────────────────────────
//
// An expense transaction should not offer "Income" as a category. The old native
// <select> builder scoped the list; the behaviour was lost when the editor moved
// to makeDropdown and nothing carried it across.

describe('scopedCategoryOptions', () => {
  // A realistic mix: the seeded set spans all three kinds.
  const KINDED = [
    { id: 'e1', name: 'Groceries', kind: 'expense' },
    { id: 'e2', name: 'Dining', kind: 'expense' },
    { id: 'i1', name: 'Income', kind: 'income' },
    { id: 't1', name: 'Transfer', kind: 'transfer' },
  ];
  const labels = (o: Array<{ label: string }>) => o.map(x => x.label);

  it('offers only expense categories for a purchase', () => {
    expect(labels(scopedCategoryOptions(KINDED, 'purchase')))
      .toEqual(['— Uncategorized —', 'Groceries', 'Dining']);
  });

  it('offers only income categories for a deposit', () => {
    expect(labels(scopedCategoryOptions(KINDED, 'deposit')))
      .toEqual(['— Uncategorized —', 'Income']);
  });

  it('offers only transfer categories for a transfer', () => {
    expect(labels(scopedCategoryOptions(KINDED, 'transfer')))
      .toEqual(['— Uncategorized —', 'Transfer']);
  });

  it('scopes a fee as an expense', () => {
    // 'fee' maps to kind 'expense' in TX_TYPES; this pins that mapping.
    expect(labels(scopedCategoryOptions(KINDED, 'fee')))
      .toEqual(['— Uncategorized —', 'Groceries', 'Dining']);
  });

  it('keeps the selected category even when its kind does not match', () => {
    // Rows categorised across kinds exist — the AI pipeline can produce them. An
    // editor that dropped the category on open would save that loss as soon as
    // the user touched anything else.
    expect(labels(scopedCategoryOptions(KINDED, 'purchase', 'i1')))
      .toContain('Income');
  });

  it('falls back to the unscoped list rather than showing an empty picker', () => {
    const expensesOnly = [{ id: 'e1', name: 'Groceries', kind: 'expense' }];
    expect(labels(scopedCategoryOptions(expensesOnly, 'deposit')))
      .toEqual(['— Uncategorized —', 'Groceries']);
  });

  it('does not scope when the type is unknown', () => {
    expect(labels(scopedCategoryOptions(KINDED, null))).toHaveLength(KINDED.length + 1);
  });

  it('scopes an out-of-set tx type as an expense, matching categoryKindForTxType', () => {
    // The AI can emit 'other'; TX_TYPES has no entry, and the helper defaults to
    // expense rather than returning nothing.
    expect(labels(scopedCategoryOptions(KINDED, 'other')))
      .toEqual(['— Uncategorized —', 'Groceries', 'Dining']);
  });

  it('honours a custom placeholder', () => {
    expect(scopedCategoryOptions(KINDED, 'purchase', '', '— Pick category —')[0].label)
      .toBe('— Pick category —');
  });

  it('tolerates a missing category list', () => {
    expect(labels(scopedCategoryOptions(undefined as never, 'purchase'))).toEqual(['— Uncategorized —']);
  });

  it('keeps colours through scoping', () => {
    const withColor = [{ id: 'e1', name: 'Groceries', kind: 'expense', color: '#5cb87a' }];
    expect(scopedCategoryOptions(withColor, 'purchase')[1].color).toBe('#5cb87a');
  });
});

// ── Guard: the component under the adapter really is the shared one ──────────

describe('shared-component identity', () => {
  it('budget\'s dropdown and a directly constructed core Dropdown produce the same markup', () => {
    // If budget ever forks the component again, these diverge.
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const core = new Dropdown(host, {
      items: [{ value: 'a', label: 'Alpha', color: '#111' }],
      selected: 'a',
    });

    const d = mount('cat-0');
    const coreBtn = host.querySelector('.ui-dropdown__button')!;
    const budgetBtn = d.dd.querySelector('.ui-dropdown__button')!;
    expect(Array.from(budgetBtn.children).map(c => c.className))
      .toEqual(Array.from(coreBtn.children).map(c => c.className));
    core.dispose();
  });
});
