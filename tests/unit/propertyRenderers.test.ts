/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for database/properties/propertyRenderers.ts
 *
 * Tests each renderer function for correct DOM structure, class names,
 * text content, and empty-state handling.
 * Runs in jsdom environment so $() / document.createElement work.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderTitle,
  renderRichText,
  renderNumber,
  renderSelect,
  renderMultiSelect,
  renderStatus,
  renderDate,
  renderCheckbox,
  renderUrl,
  renderEmail,
  renderPhone,
  renderFiles,
  renderTimestamp,
  renderUniqueId,
  renderPropertyValue,
} from '../../src/built-in/canvas/database/properties/propertyRenderers';
import type { IPropertyValue, PropertyConfig, IStatusPropertyConfig } from '../../src/built-in/canvas/database/databaseTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
});

function titleVal(text: string): IPropertyValue {
  return { type: 'title', title: [{ type: 'text', content: text }] };
}

function textVal(text: string): IPropertyValue {
  return { type: 'rich_text', rich_text: [{ type: 'text', content: text }] };
}

function numVal(n: number | null): IPropertyValue {
  return { type: 'number', number: n };
}

function selectVal(name: string, color = 'blue'): IPropertyValue {
  return { type: 'select', select: { id: `opt-${name}`, name, color } };
}

function multiVal(...opts: [string, string][]): IPropertyValue {
  return {
    type: 'multi_select',
    multi_select: opts.map(([name, color]) => ({ id: `ms-${name}`, name, color })),
  };
}

function statusVal(name: string, color = 'green', id = 'status-1'): IPropertyValue {
  return { type: 'status', status: { id, name, color } };
}

function dateVal(start: string, end: string | null = null): IPropertyValue {
  return { type: 'date', date: { start, end } };
}

function urlVal(url: string): IPropertyValue {
  return { type: 'url', url };
}

function emailVal(email: string): IPropertyValue {
  return { type: 'email', email };
}

function phoneVal(phone: string): IPropertyValue {
  return { type: 'phone_number', phone_number: phone };
}

function filesVal(...items: { name: string; url: string }[]): IPropertyValue {
  return {
    type: 'files',
    files: items.map(f => ({ name: f.name, type: 'external' as const, external: { url: f.url } })),
  };
}

function createdTimeVal(ts: string): IPropertyValue {
  return { type: 'created_time', created_time: ts };
}

function uniqueIdVal(prefix: string | null, num: number): IPropertyValue {
  return { type: 'unique_id', unique_id: { prefix, number: num } };
}

const emptyConfig: PropertyConfig = {} as any;

// ═════════════════════════════════════════════════════════════════════════════
//  Title
// ═════════════════════════════════════════════════════════════════════════════

describe('renderTitle', () => {
  it('renders title text with correct class', () => {
    renderTitle(titleVal('Hello World'), container);
    const span = container.querySelector('span.db-cell-title');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('Hello World');
  });

  it('renders multi-segment title joined', () => {
    const val: IPropertyValue = {
      type: 'title',
      title: [{ type: 'text', content: 'Hello ' }, { type: 'text', content: 'World' }],
    };
    renderTitle(val, container);
    expect(container.querySelector('.db-cell-title')!.textContent).toBe('Hello World');
  });

  it('renders empty placeholder for undefined value', () => {
    renderTitle(undefined, container);
    const span = container.querySelector('span.db-cell-empty');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('');
  });

  it('renders empty placeholder for empty title segments', () => {
    const val: IPropertyValue = { type: 'title', title: [] };
    renderTitle(val, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Rich Text
// ═════════════════════════════════════════════════════════════════════════════

describe('renderRichText', () => {
  it('renders text content', () => {
    renderRichText(textVal('Some text'), container);
    const span = container.querySelector('span.db-cell-text');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('Some text');
  });

  it('truncates long text', () => {
    const longText = 'A'.repeat(250);
    renderRichText(textVal(longText), container);
    const content = container.querySelector('.db-cell-text')!.textContent!;
    expect(content.length).toBeLessThan(250);
    expect(content.endsWith('…')).toBe(true);
  });

  it('renders empty for blank text', () => {
    renderRichText(textVal(''), container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Number
// ═════════════════════════════════════════════════════════════════════════════

describe('renderNumber', () => {
  it('renders plain number', () => {
    renderNumber(numVal(42), emptyConfig, container);
    expect(container.querySelector('.db-cell-number')!.textContent).toBe('42');
  });

  it('renders percent format', () => {
    renderNumber(numVal(85), { format: 'percent' } as any, container);
    expect(container.querySelector('.db-cell-number')!.textContent).toBe('85%');
  });

  it('renders dollar format', () => {
    renderNumber(numVal(1234.5), { format: 'dollar' } as any, container);
    const text = container.querySelector('.db-cell-number')!.textContent!;
    expect(text).toContain('$');
    expect(text).toContain('1,234.50');
  });

  it('renders empty for null number', () => {
    renderNumber(numVal(null), emptyConfig, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Select
// ═════════════════════════════════════════════════════════════════════════════

describe('renderSelect', () => {
  it('renders pill with name and color class', () => {
    renderSelect(selectVal('Done', 'green'), emptyConfig, container);
    const pill = container.querySelector('.db-cell-pill');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe('Done');
    expect(pill!.classList.contains('db-cell-pill--green')).toBe(true);
    expect((pill as HTMLElement).dataset.color).toBe('green');
  });

  it('renders empty for null select', () => {
    renderSelect({ type: 'select', select: null }, emptyConfig, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Multi-Select
// ═════════════════════════════════════════════════════════════════════════════

describe('renderMultiSelect', () => {
  it('renders multiple pills in a container', () => {
    renderMultiSelect(multiVal(['Bug', 'red'], ['Feature', 'blue']), emptyConfig, container);
    const wrap = container.querySelector('.db-cell-pill-container');
    expect(wrap).not.toBeNull();
    const pills = wrap!.querySelectorAll('.db-cell-pill');
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toBe('Bug');
    expect(pills[1].textContent).toBe('Feature');
  });

  it('renders empty for empty multi_select array', () => {
    renderMultiSelect({ type: 'multi_select', multi_select: [] }, emptyConfig, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Status
// ═════════════════════════════════════════════════════════════════════════════

describe('renderStatus', () => {
  it('renders status pill with color from option', () => {
    renderStatus(statusVal('In Progress', 'yellow'), emptyConfig, container);
    const pill = container.querySelector('.db-cell-pill');
    expect(pill!.textContent).toBe('In Progress');
    expect(pill!.classList.contains('db-cell-pill--yellow')).toBe(true);
  });

  it('uses group color when status config has groups', () => {
    const config: IStatusPropertyConfig = {
      options: [{ id: 'status-1', name: 'Done', color: 'green' }],
      groups: [
        { id: 'g1', name: 'Complete', color: 'purple', optionIds: ['status-1'] },
      ],
    };
    renderStatus(statusVal('Done', 'green', 'status-1'), config, container);
    const pill = container.querySelector('.db-cell-pill');
    expect(pill!.classList.contains('db-cell-pill--purple')).toBe(true);
  });

  it('renders empty for null status', () => {
    renderStatus({ type: 'status', status: null }, emptyConfig, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Date
// ═════════════════════════════════════════════════════════════════════════════

describe('renderDate', () => {
  it('renders formatted date', () => {
    renderDate(dateVal('2025-06-15'), container);
    const span = container.querySelector('.db-cell-date');
    expect(span).not.toBeNull();
    // Timezone-agnostic: just verify it produces a formatted date string
    const text = span!.textContent!;
    expect(text).toContain('2025');
    expect(text).toMatch(/Jun|Jul/); // UTC midnight may land on adjacent day
  });

  it('renders date range with arrow', () => {
    renderDate(dateVal('2025-06-15', '2025-06-20'), container);
    const text = container.querySelector('.db-cell-date')!.textContent!;
    expect(text).toContain('→');
  });

  it('renders empty for null date', () => {
    renderDate({ type: 'date', date: null }, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Checkbox
// ═════════════════════════════════════════════════════════════════════════════

describe('renderCheckbox', () => {
  it('renders checked state with checkmark', () => {
    renderCheckbox({ type: 'checkbox', checkbox: true }, container);
    const cb = container.querySelector('.db-cell-checkbox');
    expect(cb).not.toBeNull();
    expect(cb!.classList.contains('checked')).toBe(true);
    expect(cb!.getAttribute('aria-checked')).toBe('true');
    expect(cb!.textContent).toBe('✓');
  });

  it('renders unchecked state', () => {
    renderCheckbox({ type: 'checkbox', checkbox: false }, container);
    const cb = container.querySelector('.db-cell-checkbox');
    expect(cb!.classList.contains('checked')).toBe(false);
    expect(cb!.getAttribute('aria-checked')).toBe('false');
    expect(cb!.textContent).toBe('');
  });

  it('renders unchecked for undefined value', () => {
    renderCheckbox(undefined, container);
    const cb = container.querySelector('.db-cell-checkbox');
    expect(cb).not.toBeNull();
    expect(cb!.getAttribute('aria-checked')).toBe('false');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  URL
// ═════════════════════════════════════════════════════════════════════════════

describe('renderUrl', () => {
  it('renders link with href and target', () => {
    renderUrl(urlVal('https://example.com'), container);
    const link = container.querySelector('a.db-cell-url') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe('https://example.com/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('truncates long URLs in display text', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(100);
    renderUrl(urlVal(longUrl), container);
    const link = container.querySelector('.db-cell-url');
    expect(link!.textContent!.length).toBeLessThan(longUrl.length);
  });

  it('renders empty for null url', () => {
    renderUrl({ type: 'url', url: null }, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Email
// ═════════════════════════════════════════════════════════════════════════════

describe('renderEmail', () => {
  it('renders mailto link', () => {
    renderEmail(emailVal('user@example.com'), container);
    const link = container.querySelector('a.db-cell-email') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe('mailto:user@example.com');
    expect(link.textContent).toBe('user@example.com');
  });

  it('renders empty for null email', () => {
    renderEmail({ type: 'email', email: null }, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Phone
// ═════════════════════════════════════════════════════════════════════════════

describe('renderPhone', () => {
  it('renders phone number', () => {
    renderPhone(phoneVal('+1-555-1234'), container);
    expect(container.querySelector('.db-cell-phone')!.textContent).toBe('+1-555-1234');
  });

  it('renders empty for null phone', () => {
    renderPhone({ type: 'phone_number', phone_number: null }, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Files
// ═════════════════════════════════════════════════════════════════════════════

describe('renderFiles', () => {
  it('renders file links', () => {
    renderFiles(filesVal({ name: 'doc.pdf', url: 'https://example.com/doc.pdf' }), container);
    const wrap = container.querySelector('.db-cell-files');
    const links = wrap!.querySelectorAll('a.db-cell-file-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('doc.pdf');
    expect((links[0] as HTMLAnchorElement).target).toBe('_blank');
  });

  it('renders empty for empty files array', () => {
    renderFiles({ type: 'files', files: [] }, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timestamp
// ═════════════════════════════════════════════════════════════════════════════

describe('renderTimestamp', () => {
  it('renders created_time with relative text', () => {
    const recent = new Date(Date.now() - 5 * 60000).toISOString(); // 5 min ago
    renderTimestamp(createdTimeVal(recent), container);
    const span = container.querySelector('.db-cell-timestamp');
    expect(span).not.toBeNull();
    expect(span!.textContent).toContain('m ago');
  });

  it('renders empty for undefined value', () => {
    renderTimestamp(undefined, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Unique ID
// ═════════════════════════════════════════════════════════════════════════════

describe('renderUniqueId', () => {
  it('renders prefixed ID', () => {
    renderUniqueId(uniqueIdVal('TASK', 42), container);
    expect(container.querySelector('.db-cell-unique-id')!.textContent).toBe('TASK-42');
  });

  it('renders number-only ID when no prefix', () => {
    renderUniqueId(uniqueIdVal(null, 7), container);
    expect(container.querySelector('.db-cell-unique-id')!.textContent).toBe('7');
  });

  it('renders empty for undefined value', () => {
    renderUniqueId(undefined, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  renderPropertyValue (dispatch)
// ═════════════════════════════════════════════════════════════════════════════

describe('renderPropertyValue (dispatch)', () => {
  it('clears container before rendering', () => {
    container.innerHTML = '<span>old content</span>';
    renderPropertyValue('title', titleVal('New'), emptyConfig, container);
    expect(container.querySelector('.db-cell-title')).not.toBeNull();
    expect(container.textContent).not.toContain('old content');
  });

  it('dispatches to correct renderer per type', () => {
    renderPropertyValue('number', numVal(42), emptyConfig, container);
    expect(container.querySelector('.db-cell-number')!.textContent).toBe('42');
  });

  it('renders empty for unknown/deferred types', () => {
    renderPropertyValue('relation', undefined, emptyConfig, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });

  it('renders empty for formula type', () => {
    renderPropertyValue('formula', undefined, emptyConfig, container);
    expect(container.querySelector('.db-cell-empty')).not.toBeNull();
  });
});
