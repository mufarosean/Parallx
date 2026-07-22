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
import { readFileSync } from 'fs';
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
      try {
        const sql = readFileSync(resolve(dir, 'flashcards_001_initial.sql'), 'utf8');
        sqlite.exec(sql);
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
      provider.createEditorPane(host, { setName() { /* noop */ } });
    },
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

  return { api, sqlite, scripted, setConfig, lmCalls, chatTools, cronJobs, widgets, linkContracts, paneHosts };
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
    // Both cards are new → the new-count badge shows 2.
    expect(sidebar.querySelector('.fc-deck-row__new')?.textContent).toBe('2');
  });
});

describe('editor pane', () => {
  it('opens on the decks view and lists the deck', async () => {
    await fake.api.commands.executeCommand('flashcards.open');
    await settle();
    const pane = document.querySelector('.fc-pane')!;
    expect(pane).toBeTruthy();
    expect(pane.querySelector('.fc-deck-card__name')?.textContent).toBe('Reserving');
    expect(pane.querySelector('.fc-deck-card__meta')?.textContent).toContain('2 cards');
  });

  it('navigates to browse and adds a card through the inline form', async () => {
    const pane = document.querySelector('.fc-pane')!;
    (pane.querySelector('.fc-deck-card__info') as HTMLElement).click();
    await settle();

    // Open the add form, fill it, save.
    const addToggle = [...pane.querySelectorAll('button')].find((b) => b.textContent?.includes('Add card'))!;
    addToggle.click();
    const front = pane.querySelector('.fc-form textarea') as HTMLTextAreaElement;
    const backTa = pane.querySelectorAll('.fc-form textarea')[1] as HTMLTextAreaElement;
    front.value = 'Mack model estimates what?';
    backTa.value = 'The standard error of chain-ladder reserves.';
    const save = [...pane.querySelectorAll('.fc-form button')].find((b) => b.textContent === 'Add card') as HTMLButtonElement;
    save.click();
    await settle();

    const count = fake.sqlite.prepare('SELECT COUNT(*) AS n FROM fc_cards').get() as { n: number };
    expect(count.n).toBe(3);
    expect(pane.querySelectorAll('.fc-cardrow').length).toBe(3);
  });
});

describe('study flow', () => {
  it('reveals, grades Good, persists SM-2 state and logs the review', async () => {
    const pane = document.querySelector('.fc-pane')!;
    // Jump to study via the tab.
    const studyTab = [...pane.querySelectorAll('.fc-pane__tab')].find((t) => t.textContent?.includes('Study')) as HTMLElement;
    studyTab.click();
    await settle();

    // 3 new cards → the queue exists; front shown, no back yet.
    expect(pane.querySelector('.fc-study__front')).toBeTruthy();
    expect(pane.querySelector('.fc-study__back')).toBeNull();

    (([...pane.querySelectorAll('button')].find((b) => b.textContent === 'Show answer')) as HTMLButtonElement).click();
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
});

describe('AI generation flow', () => {
  it('canvas page → generate → editable review → import', async () => {
    const pane = document.querySelector('.fc-pane')!;
    const createTab = [...pane.querySelectorAll('.fc-pane__tab')].find((t) => t.textContent?.includes('Create')) as HTMLElement;
    createTab.click();
    await settle();

    // Load the canvas source (quick pick auto-selects the only page).
    const canvasBtn = [...pane.querySelectorAll('button')].find((b) => b.textContent?.includes('Canvas page')) as HTMLButtonElement;
    canvasBtn.click();
    await settle();
    expect(pane.querySelector('.fc-src-status')!.textContent).toContain('Canvas: Exam 7 Notes');

    // Generate — the lm fake returns two fenced JSON cards.
    const genBtn = [...pane.querySelectorAll('button')].find((b) => b.textContent?.includes('Generate cards')) as HTMLButtonElement;
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
    const importBtn = [...pane.querySelectorAll('button')].find((b) => b.textContent === 'Import cards') as HTMLButtonElement;
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
