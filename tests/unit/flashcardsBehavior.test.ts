// @vitest-environment jsdom
//
// M93 — Flashcards extension: headless BEHAVIORAL suite.
//
// Drives the REAL ext/flashcards/main.js — activate(), sidebar, editor pane,
// study flow, AI generation, chat tools, cron reminder — against a faithful
// fake of the parallx bridge. The database fake is not a stub: it runs the
// extension's actual migration SQL on an in-memory node:sqlite database, so
// every query the extension issues executes for real.
//
// Module state in main.js is a singleton, so this file is ONE sequential
// story: activate once, then walk create → browse → study → generate →
// tools. (Vitest runs `it` blocks in order within a file.)

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
// @ts-expect-error — JS module with no types
import { activate, deactivate } from '../../ext/flashcards/main.js';

// node:sqlite is a Node built-in vite refuses to bundle for the jsdom
// environment — load it at runtime instead (tests still execute in Node).
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = _require('node:sqlite') as { DatabaseSync: any };

const EXT_DIR = resolve(__dirname, '../../ext/flashcards');

// ─── settle: flush a few macrotask turns so async renders finish ─────────────

const settle = async (turns = 6): Promise<void> => {
  for (let i = 0; i < turns; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

// ─── Fake parallx bridge ─────────────────────────────────────────────────────

function makeFakeApi() {
  const sqlite = new DatabaseSync(':memory:');

  const database = {
    open: async () => ({ error: null }),
    migrate: async (dir: string) => {
      // Mirror the real host (electron/database.cjs): EVERY *.sql applied in
      // lexicographic order. Hardcoding one file silently skips later
      // migrations and fails the suite with missing-column errors (M98).
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
        for (const f of files) {
          sqlite.exec(readFileSync(resolve(dir, f), 'utf8'));
        }
        return { error: null };
      } catch (err) {
        return { error: { code: 'MIGRATE', message: (err as Error).message } };
      }
    },
    run: async (sql: string, params: unknown[] = []) => {
      try {
        const res = sqlite.prepare(sql).run(...params);
        return { error: null, lastInsertRowid: Number(res.lastInsertRowid), changes: Number(res.changes) };
      } catch (err) {
        return { error: { code: 'RUN', message: (err as Error).message } };
      }
    },
    get: async (sql: string, params: unknown[] = []) => {
      try {
        const row = sqlite.prepare(sql).get(...params);
        return { error: null, row: row ? { ...row } : undefined };
      } catch (err) {
        return { error: { code: 'GET', message: (err as Error).message } };
      }
    },
    all: async (sql: string, params: unknown[] = []) => {
      try {
        const rows = sqlite.prepare(sql).all(...params).map((r: object) => ({ ...r }));
        return { error: null, rows };
      } catch (err) {
        return { error: { code: 'ALL', message: (err as Error).message } };
      }
    },
    runTransaction: async () => ({ error: null, results: [] }),
  };

  // ── command registry (with a fake canvas read surface) ──
  const commands = new Map<string, (...a: unknown[]) => unknown>();
  // Long enough to clear the extension's low-content guard (< 120 chars of
  // markdown = "page may be empty" error, by design).
  commands.set('canvas.getPageMarkdown', async (pageId: unknown) => ({
    id: pageId,
    title: 'Exam 7 Notes',
    markdown: [
      '# Exam 7 Notes',
      '',
      'The Bornhuetter-Ferguson method blends expected losses with actual emergence.',
      'BF ultimate = actual reported + expected losses x (1 - 1/CDF), where the',
      '(1 - 1/CDF) term is the expected unreported fraction of ultimate losses.',
    ].join('\n'),
  }));

  // ── editors: create panes on demand, once per instanceId ──
  const editorProviders = new Map<string, { createEditorPane(c: HTMLElement, i?: unknown): { dispose(): void } }>();
  const paneHosts = new Map<string, HTMLElement>();
  const panes = new Map<string, { dispose(): void }>();
  const editors = {
    registerEditorProvider: (typeId: string, provider: { createEditorPane(c: HTMLElement, i?: unknown): { dispose(): void } }) => {
      editorProviders.set(typeId, provider);
      return { dispose() { editorProviders.delete(typeId); } };
    },
    openEditor: async (options: { typeId: string; instanceId?: string }) => {
      const key = `${options.typeId}:${options.instanceId ?? ''}`;
      if (paneHosts.has(key)) return;
      const provider = editorProviders.get(options.typeId);
      if (!provider) throw new Error(`no provider for ${options.typeId}`);
      const host = document.createElement('div');
      document.body.appendChild(host);
      paneHosts.set(key, host);
      panes.set(key, provider.createEditorPane(host, { setName() { /* noop */ } }));
    },
    // The real workbench exposes the open TABS and lets a tool refocus one
    // without rebuilding its pane. Without these the extension falls back to
    // openEditor, which is a no-op on an already-open editor — so every
    // navigation from outside the pane looked like it did nothing, which is
    // exactly the bug this fake must be able to reproduce.
    get openEditors() {
      return [...paneHosts.keys()].map((key) => ({
        id: `parallx-community.flashcards:${key}`,
        name: 'Flashcards',
      }));
    },
    focusEditor: async (_editorId: string) => true,
  };

  // ── window: scripted prompts ──
  const scripted = {
    inputBoxQueue: [] as (string | undefined)[],
    quickPickIndex: 0,
    messages: [] as string[],
  };
  const windowApi = {
    showInformationMessage: async (msg: string) => { scripted.messages.push(msg); return undefined; },
    showWarningMessage: async (msg: string, ...actions: { title: string }[]) => {
      scripted.messages.push(msg);
      return actions[0]; // always confirm the destructive first action
    },
    showErrorMessage: async (msg: string) => { scripted.messages.push(msg); return undefined; },
    showInputBox: async () => scripted.inputBoxQueue.shift(),
    showQuickPick: async (items: { label: string }[]) => items[scripted.quickPickIndex],
  };

  // ── config + change event ──
  const configValues = new Map<string, unknown>();
  const configListeners = new Set<(e: { affectsConfiguration(s: string): boolean }) => void>();
  const workspace = {
    getConfiguration: () => ({
      get: <T>(key: string, dflt: T): T => (configValues.has(key) ? configValues.get(key) as T : dflt),
      has: (key: string) => configValues.has(key),
    }),
    onDidChangeConfiguration: (fn: (e: { affectsConfiguration(s: string): boolean }) => void) => {
      configListeners.add(fn);
      return { dispose() { configListeners.delete(fn); } };
    },
    getCanvasPageTree: async () => ([
      { id: 'page-1', title: 'Exam 7 Notes', children: [] },
    ]),
  };
  const setConfig = (key: string, value: unknown): void => {
    configValues.set(key, value);
    for (const fn of configListeners) fn({ affectsConfiguration: () => true });
  };

  // ── lm: canned generation + discussion ──
  const lmCalls: { messages: { role: string; content: string }[] }[] = [];
  const lm = {
    getActiveModel: () => 'mock-model',
    getModels: async () => [{ id: 'mock-model' }],
    sendChatRequest: (_model: string, messages: { role: string; content: string }[]) => {
      lmCalls.push({ messages });
      const isGeneration = messages[0]?.content?.startsWith('You create high-quality');
      const reply = isGeneration
        ? 'Here are your cards:\n```json\n[\n  {"front": "What does the BF method blend?", "back": "Expected losses with actual emergence.", "tags": ["reserving"]},\n  {"front": "BF stands for?", "back": "Bornhuetter-Ferguson."}\n]\n```'
        : 'The key insight is credibility weighting between the two estimates.';
      return (async function* () {
        yield { content: reply, done: false };
        yield { content: '', done: true };
      })();
    },
  };

  // ── chat tools / cron / dashboard / links captures ──
  const chatTools = new Map<string, { handler: (args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }> }>();
  const cronJobs = new Map<string, Record<string, unknown>>();
  const widgets = new Map<string, Record<string, unknown>>();
  const linkContracts: Record<string, unknown>[] = [];

  const api = {
    env: { toolPath: EXT_DIR, appName: 'parallx', appVersion: '0.0.0' },
    database,
    commands: {
      registerCommand: (id: string, handler: (...a: unknown[]) => unknown) => {
        commands.set(id, handler);
        return { dispose() { commands.delete(id); } };
      },
      executeCommand: async (id: string, ...args: unknown[]) => {
        const h = commands.get(id);
        if (!h) throw new Error(`no command ${id}`);
        return h(...args);
      },
    },
    views: {
      registerViewProvider: (_id: string, provider: { createView(c: HTMLElement): { dispose(): void } }) => {
        const host = document.createElement('div');
        host.dataset.role = 'sidebar-host';
        document.body.appendChild(host);
        provider.createView(host);
        return { dispose() { host.remove(); } };
      },
    },
    editors,
    window: windowApi,
    workspace,
    lm,
    icons: { createIconHtml: () => '', getIcon: () => '', hasIcon: () => false },
    ui: {
      createDropdown: (container: HTMLElement, options?: { items?: { value: string; label: string }[]; selected?: string }) => {
        const elx = document.createElement('div');
        elx.className = 'fake-dropdown';
        container.appendChild(elx);
        const listeners = new Set<(v: string) => void>();
        const handle = {
          element: elx,
          value: options?.selected ?? '',
          setItems() { /* noop */ },
          onDidChange(fn: (v: string) => void) { listeners.add(fn); return { dispose() { listeners.delete(fn); } }; },
          focus() { /* noop */ },
          setDisabled() { /* noop */ },
          dispose() { elx.remove(); },
          _fire(v: string) { handle.value = v; for (const fn of listeners) fn(v); },
        };
        return handle;
      },
      rafThrottle: <A extends unknown[]>(fn: (...a: A) => void) => {
        const wrapped = (...a: A) => fn(...a);
        (wrapped as { dispose?: () => void }).dispose = () => { /* noop */ };
        return wrapped;
      },
      createAiButton: (container: HTMLElement, options: { label: string }) => {
        const btn = document.createElement('button');
        btn.className = 'px-ai-btn';
        const label = document.createElement('span');
        label.className = 'px-ai-btn__label';
        label.textContent = options.label;
        btn.appendChild(label);
        container.appendChild(btn);
        return btn;
      },
      renderMarkdown: (markdown: string) => {
        const d = document.createElement('div');
        d.className = 'px-markdown';
        d.textContent = markdown;
        return d;
      },
      // Renders a real clickable menu so tests can drive items by label.
      showContextMenu: (
        _anchor: { x: number; y: number },
        items: { label?: string; separator?: boolean; onSelect?: () => void }[],
      ) => {
        const menu = document.createElement('div');
        menu.className = 'fake-context-menu';
        for (const it of items) {
          if (it.separator) continue;
          const row = document.createElement('button');
          row.className = 'fake-context-menu__item';
          row.textContent = it.label ?? '';
          if (it.onSelect) row.addEventListener('click', () => { menu.remove(); it.onSelect!(); });
          menu.appendChild(row);
        }
        document.body.appendChild(menu);
        return { dispose() { menu.remove(); } };
      },
    },
    chat: {
      registerTool: (name: string, def: { handler: (args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }> }) => {
        chatTools.set(name, def);
        return { dispose() { chatTools.delete(name); } };
      },
    },
    cron: {
      upsertJob: (job: { id: string } & Record<string, unknown>) => { cronJobs.set(job.id, job); },
      removeJob: (id: string) => cronJobs.delete(id),
    },
    dashboard: {
      registerWidgetType: (reg: { typeId: string } & Record<string, unknown>) => {
        widgets.set(reg.typeId, reg);
        return { dispose() { widgets.delete(reg.typeId); } };
      },
    },
    links: {
      register: (contract: Record<string, unknown>) => {
        linkContracts.push(contract);
        return { dispose() { /* noop */ } };
      },
    },
  };

  /**
   * Reproduce the workbench state that broke navigation: the TAB stays open
   * (so `openEditors` still lists it) while its PANE is gone — which is what
   * a workspace restore, a retention-LRU eviction, and the pre-retention
   * tab-switch teardown all leave behind.
   */
  const evictPane = (typeId = 'flashcards', instanceId = 'main') => {
    const key = `${typeId}:${instanceId}`;
    panes.get(key)?.dispose();
    panes.delete(key);
    paneHosts.get(key)?.remove();
  };
  /** The workbench rebuilding the pane when the tab is next shown. */
  const rebuildPane = (typeId = 'flashcards', instanceId = 'main') => {
    const key = `${typeId}:${instanceId}`;
    const host = paneHosts.get(key)!;
    document.body.appendChild(host);
    panes.set(key, editorProviders.get(typeId)!.createEditorPane(host, { setName() { /* noop */ } }));
  };

  return { api, sqlite, scripted, setConfig, lmCalls, chatTools, cronJobs, widgets, linkContracts, paneHosts, evictPane, rebuildPane };
}

// ─── The story ───────────────────────────────────────────────────────────────

const fake = makeFakeApi();
const context = { subscriptions: [] as { dispose(): void }[] };

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });
  await activate(fake.api, context);
});

afterAll(async () => {
  await deactivate();
  for (const d of context.subscriptions) { try { d.dispose(); } catch { /* noop */ } }
  vi.restoreAllMocks();
});

describe('activation', () => {
  it('applies the real migration (fc_* tables exist)', () => {
    const tables = fake.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fc_%' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);
    expect(tables).toEqual(['fc_cards', 'fc_decks', 'fc_reviews']);
  });

  it('registers chat tools, dashboard widget, and links contract', () => {
    expect([...fake.chatTools.keys()].sort()).toEqual([
      'flashcards.createCards', 'flashcards.getDue', 'flashcards.getStats',
    ]);
    expect(fake.widgets.has('parallx-community.flashcards.due')).toBe(true);
    expect(fake.linkContracts).toHaveLength(1);
    expect((fake.linkContracts[0] as { segment: string }).segment).toBe('flashcards');
  });

  it('does not schedule the reminder while the setting is off', () => {
    expect(fake.cronJobs.size).toBe(0);
  });
});

describe('chat tool: createCards', () => {
  it('creates the deck and cards, and the sidebar shows them', async () => {
    const tool = fake.chatTools.get('flashcards.createCards')!;
    const result = await tool.handler({
      deckName: 'Reserving',
      cards: [
        { front: 'Chain ladder assumes?', back: 'Development patterns persist.' },
        { front: 'What is IBNR?', back: 'Incurred but not reported losses.', tags: ['definitions'] },
      ],
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('2 cards');

    await settle();
    const sidebar = document.querySelector('[data-role="sidebar-host"]')!;
    expect(sidebar.textContent).toContain('Reserving');
    // Both cards are new → the deck row's new-count shows 2.
    expect(sidebar.querySelector('.fc-deck-row__ct--new')?.textContent).toBe('2');
    // Today section reflects the new cards too.
    expect(sidebar.querySelector('.fc-today__num--new')?.textContent).toBe('2');
  });
});

describe('editor pane', () => {
  it('opens on the decks home and lists the deck', async () => {
    await fake.api.commands.executeCommand('flashcards.open');
    await settle();
    const pane = document.querySelector('.fc-pane')!;
    expect(pane).toBeTruthy();
    // The home leads with what the collection IS, then the decks in it.
    expect(pane.querySelector('.fc-home__title')?.textContent).toBe('Decks');
    expect(pane.querySelector('.fc-home__sub')?.textContent).toContain('1 deck');
    expect(pane.querySelector('.fc-home__sub')?.textContent).toContain('2 cards');
    expect(pane.querySelector('.fc-deck-card__name')?.textContent).toBe('Reserving');
    // Counts are labelled per state, not a run-on meta string.
    expect(pane.querySelector('.fc-deck-count__n--new')?.textContent).toBe('2');
  });

  it('navigation lives in the sidebar, not on the pane', async () => {
    const pane = document.querySelector('.fc-pane')!;
    const sidebar = document.querySelector('[data-role="sidebar-host"]')!;
    // The pane's tab strip is gone: it was the tool's only map, and it was
    // inside the thing it mapped.
    expect(pane.querySelectorAll('.fc-pane__tab')).toHaveLength(0);
    expect([...sidebar.querySelectorAll('.fc-sb__nav-item')].map((n) => n.textContent))
      .toEqual(['Decks', 'Study', 'Create', 'Import', 'Stats']);
    // The pane says where you are instead.
    expect(pane.querySelector('.fc-pane__crumbs')?.textContent).toBe('Decks');
    expect(sidebar.querySelector('.fc-sb__nav-item--active')?.getAttribute('data-view')).toBe('decks');
  });

  it('navigates to browse and adds a card through the inline form', async () => {
    const pane = document.querySelector('.fc-pane')!;
    (pane.querySelector('.fc-deck-card__info') as HTMLElement).click();
    await settle();

    // Inside a deck the breadcrumb names it, and the sidebar selects its row.
    expect(pane.querySelector('.fc-pane__crumbs')?.textContent).toContain('Reserving');
    const sidebar = document.querySelector('[data-role="sidebar-host"]')!;
    expect(sidebar.querySelector('.fc-deck-row--active')?.textContent).toContain('Reserving');

    // Open the add form, fill it, save.
    const addToggle = [...pane.querySelectorAll('button')].find((b) => b.textContent?.includes('Add Card'))!;
    addToggle.click();
    const front = pane.querySelector('.fc-form textarea') as HTMLTextAreaElement;
    const backTa = pane.querySelectorAll('.fc-form textarea')[1] as HTMLTextAreaElement;
    front.value = 'Mack model estimates what?';
    backTa.value = 'The standard error of chain-ladder reserves.';
    const save = [...pane.querySelectorAll('.fc-form button')].find((b) => b.textContent === 'Save Card') as HTMLButtonElement;
    save.click();
    await settle();

    const count = fake.sqlite.prepare('SELECT COUNT(*) AS n FROM fc_cards').get() as { n: number };
    expect(count.n).toBe(3);
    expect(pane.querySelectorAll('.fc-cardrow').length).toBe(3);
  });

  it('selects rows by click, Shift+click range, Ctrl+click toggle', async () => {
    const pane = document.querySelector('.fc-pane')!;
    const rows = [...pane.querySelectorAll('.fc-cardrow')] as HTMLElement[];
    expect(rows.length).toBe(3);
    const click = (target: HTMLElement, init: MouseEventInit = {}) =>
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));

    // Plain click selects just that row and shows the bulk bar.
    click(rows[0].querySelector('.fc-cardrow__front') as HTMLElement);
    expect(rows[0].classList.contains('fc-cardrow--selected')).toBe(true);
    expect(pane.querySelector('.fc-bulkbar__count')?.textContent).toBe('1 Selected');

    // Shift+click extends the range from the anchor.
    click(rows[2].querySelector('.fc-cardrow__front') as HTMLElement, { shiftKey: true });
    expect(pane.querySelector('.fc-bulkbar__count')?.textContent).toBe('3 Selected');

    // Ctrl+click toggles a row back out.
    click(rows[1].querySelector('.fc-cardrow__front') as HTMLElement, { ctrlKey: true });
    expect(pane.querySelector('.fc-bulkbar__count')?.textContent).toBe('2 Selected');
    expect(rows[1].classList.contains('fc-cardrow--selected')).toBe(false);

    // Clicks on row buttons never touch the selection.
    const edit = [...rows[0].querySelectorAll('button')].find((b) => b.textContent === 'Edit') as HTMLElement;
    click(edit, {});
    await settle();
    expect(pane.querySelector('.fc-bulkbar__count')?.textContent).toBe('2 Selected');
    const cancel = [...pane.querySelectorAll('button')].find((b) => b.textContent === 'Cancel') as HTMLButtonElement;
    cancel?.click();
    await settle();

    // Clear Selection empties the set and hides the bar.
    const clear = [...pane.querySelectorAll('.fc-bulkbar button')]
      .find((b) => b.textContent === 'Clear Selection') as HTMLButtonElement;
    clear.click();
    await settle();
    expect(pane.querySelector('.fc-bulkbar')?.textContent ?? '').toBe('');
  });
});

describe('navigation reaches the pane', () => {
  // The reported failure: "Custom Study and Study Ahead — neither one works."
  // Clicking them surfaced the Flashcards tab on whatever view it last showed
  // and swallowed the navigation, because the route event was dispatched at a
  // tab whose pane was not alive to hear it.
  it('honours a route issued while the tab is open but its pane is gone', async () => {
    fake.evictPane();
    await fake.api.commands.executeCommand('flashcards.customStudy');
    await settle();
    fake.rebuildPane();
    await settle();

    const pane = document.querySelector('.fc-pane')!;
    expect(pane.querySelector('.fc-view__title')?.textContent).toBe('Custom Study');
    expect(pane.querySelector('.fc-cs__avail')?.textContent).toContain('available');
  });

  it('starts a Custom Study session from the built queue', async () => {
    const pane = document.querySelector('.fc-pane')!;
    const start = [...pane.querySelectorAll('button')]
      .find((b) => /^Study \d+ Cards?$/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(start).toBeTruthy();
    expect(start.disabled).toBe(false);
    start.click();
    await settle();
    expect(pane.querySelector('.fc-study__front')).toBeTruthy();
    // A custom session is labelled by its mode, never mistaken for the daily queue.
    expect(pane.textContent).toContain('Extra New Cards');
  });

  it('does not leave the stashed route behind to hijack the next mount', async () => {
    // A live pane consumed the route above, so rebuilding lands where the
    // pane was, not back on Custom Study.
    (document.querySelector('.fc-sb__nav-item[data-view="decks"]') as HTMLElement).click();
    await settle();
    fake.evictPane();
    fake.rebuildPane();
    await settle();
    const pane = document.querySelector('.fc-pane')!;
    expect(pane.querySelector('.fc-home__title')?.textContent).toBe('Decks');
  });
});

describe('working ahead of the schedule', () => {
  // Reported: "Custom Study literally does not show any cards." The daily
  // session was keyed by the raw deck id (a NUMBER) while the custom-session
  // pruner called String methods on every key, so launching Custom Study
  // after studying that deck threw mid-render — after the study root was
  // already appended — and left a blank pane with no error anywhere.
  it('serves a custom session for a deck whose daily session is already live', async () => {
    const pane = document.querySelector('.fc-pane')!;
    const deckAction = (label: string) => [...pane.querySelectorAll('.fc-deck-card__actions button')]
      .find((b) => b.textContent === label) as HTMLButtonElement;

    deckAction('Study').click();
    await settle();
    expect(pane.querySelector('.fc-study__front')).toBeTruthy();

    (document.querySelector('.fc-sb__nav-item[data-view="decks"]') as HTMLElement).click();
    await settle();
    deckAction('Custom').click();
    await settle();

    const start = [...pane.querySelectorAll('button')]
      .find((b) => /^Study \d+ Cards?$/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(start).toBeTruthy();
    start.click();
    await settle();

    expect(pane.querySelector('.fc-study__front')).toBeTruthy();
    expect(pane.querySelector('.fc-pane__body')!.textContent).not.toBe('');
  });

  it('shows every mode its own count, so an empty mode is not an empty deck', async () => {
    // "Studying ahead only shows one or two cards" was Review Ahead telling
    // the truth about 2 due reviews while the deck's real backlog sat in
    // another mode, invisible until you clicked it.
    const pane = document.querySelector('.fc-pane')!;
    (document.querySelector('.fc-sb__nav-item[data-view="decks"]') as HTMLElement).click();
    await settle();
    ([...pane.querySelectorAll('.fc-deck-card__actions button')]
      .find((b) => b.textContent === 'Custom') as HTMLButtonElement).click();
    await settle();

    const counts = new Map([...pane.querySelectorAll('.fc-cs__mode')].map((row) => [
      row.querySelector('.fc-cs__mode-name')!.textContent!,
      row.querySelector('.fc-cs__mode-count')!.textContent!,
    ]));
    expect(counts.get('Extra New Cards')).toBe('3');
    expect(counts.get('Cram')).toBe('3');
    expect(counts.get('Review Ahead')).toBe('none');
    expect(counts.get('Difficult Cards')).toBe('none');

    // An empty mode names the one that has the cards.
    ([...pane.querySelectorAll('.fc-cs__mode')]
      .find((m) => m.textContent?.includes('Review Ahead')) as HTMLElement).click();
    await settle();
    expect(pane.querySelector('.fc-cs__avail')!.textContent)
      .toBe('No reviews in range available. Extra New Cards has 3.');
  });
});

describe('study flow', () => {
  it('reveals, grades Good, persists SM-2 state and logs the review', async () => {
    const pane = document.querySelector('.fc-pane')!;
    // Jump to study from the sidebar rail — the tool's navigation surface.
    const sidebar = document.querySelector('[data-role="sidebar-host"]')!;
    (sidebar.querySelector('.fc-sb__nav-item[data-view="study"]') as HTMLElement).click();
    await settle();

    // 3 new cards → the queue exists; front shown, no back yet.
    expect(pane.querySelector('.fc-study__front')).toBeTruthy();
    expect(pane.querySelector('.fc-study__back')).toBeNull();

    (([...pane.querySelectorAll('button')].find((b) => b.textContent === 'Show Answer')) as HTMLButtonElement).click();
    await settle(2);
    expect(pane.querySelector('.fc-study__back')).toBeTruthy();
    // Grade buttons carry interval previews.
    const goodBtn = pane.querySelector('.fc-grade--good') as HTMLButtonElement;
    expect(goodBtn.textContent).toContain('Good');

    const frontText = pane.querySelector('.fc-study__front')!.textContent!;
    goodBtn.click();
    await settle();

    const row = fake.sqlite.prepare('SELECT * FROM fc_cards WHERE front = ?').get(frontText) as Record<string, unknown>;
    expect(row.state).toBe('learning');
    expect(row.reps).toBe(1);
    const reviews = fake.sqlite.prepare('SELECT * FROM fc_reviews').all();
    expect(reviews).toHaveLength(1);
    expect((reviews[0] as { rating: number }).rating).toBe(3);

    // The session advanced to the next card.
    expect(pane.querySelector('.fc-study__front')!.textContent).not.toBe(frontText);
  });

  it('saving an edit shows the edited card, not a different one', async () => {
    const pane = document.querySelector('.fc-pane')!;
    const sidebar = document.querySelector('[data-role="sidebar-host"]')!;
    (sidebar.querySelector('.fc-sb__nav-item[data-view="study"]') as HTMLElement).click();
    await settle();

    const before = pane.querySelector('.fc-study__front')!.textContent!;
    ([...pane.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Edit'
      || b.title.startsWith('Fix this card')) as HTMLButtonElement).click();
    await settle();
    expect(pane.querySelector('.fc-study__edit')).toBeTruthy();

    const frontIn = pane.querySelector('.fc-study__edit textarea') as HTMLTextAreaElement;
    frontIn.value = 'EDITED FRONT';
    frontIn.dispatchEvent(new window.Event('input', { bubbles: true }));
    ([...pane.querySelectorAll('.fc-study__edit button')]
      .find((b) => b.textContent === 'Save') as HTMLButtonElement).click();
    await settle(8);

    // The card on screen is the one just saved, carrying the new text.
    expect(pane.querySelector('.fc-study__edit')).toBeNull();
    const after = pane.querySelector('.fc-study__front')!.textContent!;
    expect(after).not.toBe(before);
    expect(after).toContain('EDITED FRONT');

    // NOT covered here: the reported failure needed a LEARNING card to come
    // due while the editor was open, which displaced the saved card at
    // showCard's cut-in. `pending` only fills from in-session grading and the
    // shortest learning step is one minute, so reproducing it needs real time
    // travel — and this suite's settle() runs on real setTimeout, so fake
    // timers would hang it. The `keepCurrent` guard is what fixes that path.
  });

  it('Skip defers a card to the end of the session without grading it', async () => {
    const pane = document.querySelector('.fc-pane')!;
    const sidebar = document.querySelector('[data-role="sidebar-host"]')!;
    (sidebar.querySelector('.fc-sb__nav-item[data-view="study"]') as HTMLElement).click();
    await settle();

    const reviewsBefore = fake.sqlite.prepare('SELECT COUNT(*) AS n FROM fc_reviews').get() as { n: number };
    const first = pane.querySelector('.fc-study__front')!.textContent!;
    const cardBefore = fake.sqlite.prepare('SELECT * FROM fc_cards WHERE front = ?').get(first) as Record<string, unknown>;

    (pane.querySelector('.fc-study__skip') as HTMLButtonElement).click();
    await settle();

    // Moved on, without revealing anything.
    const second = pane.querySelector('.fc-study__front')!.textContent!;
    expect(second).not.toBe(first);
    expect(pane.querySelector('.fc-study__back')).toBeNull();

    // A skip is not a grade: no review row, and the card's scheduling state
    // is untouched. This is the whole contract — deferring must cost the
    // schedule nothing, or it becomes a way to quietly corrupt FSRS.
    const reviewsAfter = fake.sqlite.prepare('SELECT COUNT(*) AS n FROM fc_reviews').get() as { n: number };
    expect(reviewsAfter.n).toBe(reviewsBefore.n);
    const cardAfter = fake.sqlite.prepare('SELECT * FROM fc_cards WHERE front = ?').get(first) as Record<string, unknown>;
    expect(cardAfter.state).toBe(cardBefore.state);
    expect(cardAfter.reps).toBe(cardBefore.reps);
    expect(cardAfter.due_at).toBe(cardBefore.due_at);

    // And it comes back later in the same session rather than being dropped.
    const seen: string[] = [second];
    for (let i = 0; i < 6 && !seen.includes(first); i++) {
      const skipBtn = pane.querySelector('.fc-study__skip') as HTMLButtonElement | null;
      if (!skipBtn) break;
      skipBtn.click();
      await settle();
      const front = pane.querySelector('.fc-study__front')?.textContent;
      if (front) seen.push(front);
    }
    expect(seen).toContain(first);
  });
});

describe('AI generation flow', () => {
  it('canvas page → generate → editable review → import', async () => {
    const pane = document.querySelector('.fc-pane')!;
    const sidebar = document.querySelector('[data-role="sidebar-host"]')!;
    (sidebar.querySelector('.fc-sb__nav-item[data-view="create"]') as HTMLElement).click();
    await settle();

    // Load the canvas source (quick pick auto-selects the only page).
    // Multi-source model: the loaded document appears as a removable CHIP;
    // the status line summarizes the source count.
    const canvasBtn = [...pane.querySelectorAll('button')].find((b) => b.textContent?.includes('Canvas Page')) as HTMLButtonElement;
    canvasBtn.click();
    await settle();
    expect(pane.querySelector('.fc-srcchip')!.textContent).toContain('Canvas: Exam 7 Notes');
    expect(pane.querySelector('.fc-src-status')!.textContent).toContain('1 source');

    // Generate — the lm fake returns two fenced JSON cards.
    const genBtn = [...pane.querySelectorAll('button')].find((b) => b.textContent?.includes('Generate Cards')) as HTMLButtonElement;
    genBtn.click();
    await settle();

    const rows = pane.querySelectorAll('.fc-genrow');
    expect(rows.length).toBe(2);
    // The generation prompt actually contained the page material.
    const genCall = fake.lmCalls.find((c) => c.messages[0]?.content?.startsWith('You create high-quality'))!;
    expect(genCall.messages[1].content).toContain('Bornhuetter-Ferguson');

    // Edit one card, drop nothing, import into the existing deck.
    const firstFront = rows[0].querySelector('textarea') as HTMLTextAreaElement;
    firstFront.value = 'EDITED: What does the BF method blend?';
    const importBtn = [...pane.querySelectorAll('button')].find((b) => b.textContent === 'Import Cards') as HTMLButtonElement;
    importBtn.click();
    await settle();

    const imported = fake.sqlite
      .prepare("SELECT * FROM fc_cards WHERE source_label LIKE 'Canvas:%' ORDER BY id")
      .all() as Record<string, unknown>[];
    expect(imported).toHaveLength(2);
    expect(imported[0].front).toBe('EDITED: What does the BF method blend?');
    expect(imported[0].source_uri).toBe('parallx://canvas/page/page-1');
  });
});

describe('workload surfaces', () => {
  it('flashcards.getDue reports totals and per-deck lines', async () => {
    const tool = fake.chatTools.get('flashcards.getDue')!;
    const result = await tool.handler({});
    expect(result.content).toContain('Total: 5');
    expect(result.content).toContain('Reserving');
  });

  it('the dashboard widget refresh returns the due summary as JSON', async () => {
    const widget = fake.widgets.get('parallx-community.flashcards.due') as {
      refresh(ctx: unknown): Promise<string | null>;
    };
    const out = await widget.refresh({});
    const parsed = JSON.parse(out!);
    expect(parsed.total).toBe(5);
    expect(typeof parsed.due).toBe('number');
    expect(typeof parsed.fresh).toBe('number');
  });
});

describe('daily reminder', () => {
  it('turning the setting on upserts an autonomy-gated cron job at the configured time', async () => {
    fake.setConfig('reminderTime', '07:30');
    fake.setConfig('dailyReminder', true);
    await settle();
    const job = fake.cronJobs.get('flashcards.daily-reminder') as {
      schedule: { cron: string };
      payload: { agentTurn: string };
    };
    expect(job).toBeTruthy();
    expect(job.schedule.cron).toBe('30 7 * * *');
    expect(job.payload.agentTurn).toContain('flashcards.getDue');
  });

  it('turning it off removes the job', async () => {
    fake.setConfig('dailyReminder', false);
    await settle();
    expect(fake.cronJobs.has('flashcards.daily-reminder')).toBe(false);
  });
});

// Runs LAST — captureSelection inserts cards, which would perturb the
// running totals the workload-surface counts assert.
describe('selection → flashcard', () => {
  it('captureSelection generates and files cards into the picked deck', async () => {
    fake.scripted.quickPickIndex = 0; // first existing deck
    const source = { fileName: 'Verrall.pdf', filePath: '/exam/Verrall.pdf', pageNumber: 12 };
    await fake.api.commands.executeCommand(
      'flashcards.captureSelection',
      'The Verrall Bayesian model treats development factors as random variables with a prior distribution.',
      source,
    );
    await settle();

    // M98: the page number is STRUCTURED provenance (source_page), no longer
    // baked into the display label — that is what makes the source line
    // clickable and the PDF reveal possible.
    const captured = fake.sqlite
      .prepare("SELECT * FROM fc_cards WHERE source_label = 'Verrall.pdf' ORDER BY id")
      .all() as Record<string, unknown>[];
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].source_uri).toBe('/exam/Verrall.pdf');
    expect(captured[0].source_page).toBe(12);
    expect(fake.scripted.messages.some((m) => /Added \d+ card/.test(m))).toBe(true);
  });

  it('rejects a too-short selection', async () => {
    const before = fake.scripted.messages.length;
    await fake.api.commands.executeCommand('flashcards.captureSelection', 'too short', {});
    await settle();
    expect(fake.scripted.messages.slice(before).some((m) => /a little more text/i.test(m))).toBe(true);
  });
});

// Runs LAST — deletes a deck.
describe('deck deletion via sidebar context menu', () => {
  it('right-click → Delete deck confirms and removes the deck and its cards', async () => {
    const host = fake.paneHosts.get('sidebar-host') ?? document.querySelector('[data-role="sidebar-host"]')!;
    const decksBefore = fake.sqlite.prepare('SELECT COUNT(*) AS n FROM fc_decks').get() as { n: number };
    expect(decksBefore.n).toBeGreaterThan(0);

    // Open the first deck's actions menu via the row's "more" button.
    const moreBtn = host.querySelector('.fc-deck-row__more') as HTMLButtonElement;
    expect(moreBtn).toBeTruthy();
    moreBtn.click();

    // Confirm modal is not exposed in the harness → falls back to the warning
    // action, which the harness auto-confirms. Click "Delete deck".
    const del = [...document.querySelectorAll('.fake-context-menu__item')]
      .find((b) => b.textContent === 'Delete Deck') as HTMLButtonElement;
    expect(del).toBeTruthy();
    del.click();
    await settle();

    const decksAfter = fake.sqlite.prepare('SELECT COUNT(*) AS n FROM fc_decks').get() as { n: number };
    expect(decksAfter.n).toBe(decksBefore.n - 1);
  });
});
