// @vitest-environment jsdom
// Creations AI: the Character Studio pane (ext/creations-ai/studio.js),
// rendered against a stubbed model and file system. Never a live model.
//
// What it proves: the screens in docs/CREATIONS_AI.md exist as written
// (bar, Make, Sheet, Canon, Try A Line; Title Case; no native select, no
// native dialogs, no em dashes), a concept becomes a sheet that autosaves,
// locks hold, sources with a Twist produce a canon with kept/changed/added,
// a reroll can be undone, a legacy character opens with its rows filled,
// and Twist Again hands the lineage on.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-expect-error — JS module with no types
import { renderStudioPane } from '../../ext/creations-ai/studio.js';

type Chunk = { content?: string };

const SHEET = {
  name: 'Ada Lovelace', tagline: 'Counts what others feel', description: 'Ada counts everything.', appearance: 'Tall, ink on her cuffs.',
  personality: 'Dry and exact.', voice: 'Short lines. Says "noted". Never says "whatever".', backstory: 'Born in 1815 in London.',
  drives: 'Wants order. Fears chaos. Her brother stands in the way.', secrets: 'She cannot add in her head.', relationships: 'Babbage: strained.',
  exampleDialogue: '[USER]: hi\n[AI]: Noted.', reminder: 'Ada never lies.',
};

function el(tag: string, className?: string | null, attrs?: Record<string, string>) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); }
  return e;
}
function dropdownStub(host: HTMLElement, { items = [], selected = '' }: { items?: { value: string; label: string }[]; selected?: string }) {
  let value = selected;
  const listeners: ((v: string) => void)[] = [];
  host.setAttribute('data-dropdown', 'true');
  return {
    get value() { return value; },
    set value(v: string) { value = v; },
    setItems(list: { value: string; label: string }[]) { items = list; },
    onDidChange(fn: (v: string) => void) { listeners.push(fn); },
    _fire(v: string) { value = v; listeners.forEach((fn) => fn(v)); },
    get items() { return items; },
  };
}
function tgSelect(parallx: any, { layout = 'full', title = '', items = [], value = '', onChange = null }: any = {}) {
  const host = el('span', `tg-dd tg-dd--${layout}`);
  if (title) host.title = title;
  const dd = parallx.ui.createDropdown(host, { items, selected: value });
  if (onChange) dd.onDidChange(onChange);
  return { element: host, get value() { return dd.value ?? ''; }, set value(v: string) { dd.value = v; }, setItems(list: any[]) { dd.setItems(list); } };
}
async function* chunks(parts: string[]): AsyncGenerator<Chunk> { for (const p of parts) yield { content: p }; }

function makeWorld(opts: { existing?: Record<string, any> | null } = {}) {
  const saved = new Map<string, any>();
  const files = new Map<string, string>();
  const requests: { messages: { role: string; content: string }[]; options: any }[] = [];
  let ids = 0;
  const parallx = {
    lm: {
      getModels: async () => [{ id: 'm1', displayName: 'Model One' }],
      sendChatRequest: (_model: string, messages: { role: string; content: string }[], options: any) => {
        requests.push({ messages, options });
        const sys = messages[0].content;
        const user = messages[1].content;
        if (sys.includes('You extract established facts')) return chunks([JSON.stringify({ subject: 'Ada', facts: ['Ada was born in 1815.', 'Ada is a mathematician.', 'Ada lives in London.'] })]);
        if (sys.includes('You revise a list of established facts')) return chunks([JSON.stringify({ facts: [
          { text: 'Ada was born in 1815.', status: 'kept' },
          { text: 'Ada is a lighthouse keeper.', status: 'changed', was: 'Ada is a mathematician.' },
          { text: 'Ada lives in London.', status: 'kept' },
          { text: 'Ada keeps the light on Skerry Rock.', status: 'added' },
        ] })]);
        if (sys.includes('exactly one string key')) { const key = sys.match(/one string key: "(\w+)"/)![1]; return chunks([`{"${key}": "Rewritten ${key}."}`]); }
        if (sys.includes('Stay in character')) return chunks(['Noted. ', 'What do you want?']);
        if (sys.includes('character designer for roleplay fiction')) {
          const s = { ...SHEET };
          if (user.includes('lighthouse keeper')) s.description = 'Ada keeps a lighthouse.';
          const json = JSON.stringify(s);
          const cut = json.indexOf('"appearance"');
          return chunks([json.slice(0, cut), json.slice(cut)]);
        }
        return chunks(['{}']);
      },
    },
    commands: {
      executeCommand: async (id: string, url?: string) => {
        if (id !== 'webResearch.fetchReadable') return null;
        return url === 'https://example.org/ada' ? { ok: true, text: 'Ada Lovelace was born in 1815 in London.', title: 'Ada Lovelace', source: url } : { ok: false, error: { code: 'BLOCKLISTED', message: 'Host on egress blocklist' } };
      },
    },
    window: { showInputBox: async () => undefined, showWarningMessage: async () => undefined },
    ui: { createDropdown: dropdownStub },
  };
  const fs = {
    readFile: async (uri: string) => {
      const name = uri.split('/').pop()!;
      if (files.has(name)) return { content: files.get(name) };
      if (opts.existing && name === 'character-legacy.json') return { content: JSON.stringify(opts.existing) };
      throw new Error(`no file ${name}`);
    },
    writeFile: async (uri: string, content: string) => { files.set(uri.split('/').pop()!, content); },
    readdir: async () => [],
    delete: async () => {},
  };
  const ctx = {
    fs, workspaceUri: 'ws', fileName: null as string | null, from: null as any,
    onCreated: vi.fn(async () => {}), onSaved: vi.fn(), openChat: vi.fn(async () => {}), openChatBehaviour: vi.fn(async () => {}), openCharacter: vi.fn(), openNew: vi.fn(),
  };
  const deps = {
    el, icon: (n: string) => `<i data-icon="${n}"></i>`, tgSelect,
    loadSettings: async () => ({ forgeModelId: '', defaultModel: '', forgeContextWindow: 0, defaultContextWindow: 4096, studioSourceWords: 40 }),
    saveSettings: async () => {},
    saveCharacter: async (_fs: any, _ws: string, fileName: string, data: any) => { saved.set(fileName, JSON.parse(JSON.stringify(data))); },
    createCharacterJson: (overrides: any = {}) => ({ id: `char-${++ids}`, name: 'New Character', roleInstruction: '', exampleDialogue: '', reminder: '', writingPreset: 'immersive-rp', lorebookFiles: [], ...overrides }),
    exportCharacterToMarkdown: vi.fn(async () => {}),
    ensureNestedDirs: async () => {},
    generateId: () => `id${++ids}xxxxxxxx`,
    scanCharacters: async () => [...saved.entries()].map(([fileName, data]) => ({ fileName, frontmatter: { name: data.name }, rawData: data })),
    resolveUri: (base: string, path: string) => `${base}/${path}`,
    extRoot: '.parallx/extensions/text-generator',
    ctxPresets: [{ value: 0, label: 'Auto' }, { value: 4096, label: '4k' }],
    forge: {
      AXES: [{ key: 'warmth', label: 'Warmth', low: 'cold', high: 'warm' }], RANDOM: '(random)',
      GENDERS: ['Female', 'Male'], BUILDS: ['slender', 'stocky'], BUSTS: ['small', 'full'], WAISTS: ['narrow', 'thick'], HIPS: ['slim', 'wide'],
      SKINS: ['pale', 'dark'], HAIR_COLORS: ['black', 'red'], HAIR_LENGTHS: ['short', 'long'], EYE_COLORS: ['brown', 'blue'], CLOTHING: ['casual modern', 'gothic'],
      feetInches: (n: number) => `${Math.floor(n / 12)}'${n % 12}"`,
      buildSpec: (st: any) => ({ spec: `- Gender: ${st.gender}\n- Warmth: ${st.axes.warmth}`, resolved: {} }),
    },
  };
  return { parallx, fs, ctx, deps, saved, requests };
}

const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
const rowOf = (root: HTMLElement, key: string) => root.querySelector(`.cs-row[data-key="${key}"]`) as HTMLElement;
const areaOf = (root: HTMLElement, key: string) => rowOf(root, key).querySelector('textarea') as HTMLTextAreaElement;
const buttonNamed = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const typeInto = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };

let container: HTMLElement;
beforeEach(() => { vi.useFakeTimers(); container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { vi.useRealTimers(); container.remove(); });

describe('the Studio screen', () => {
  it('shows the bar, Make, Sheet and Try A Line as designed, Title Case throughout, nothing native, no em dashes', async () => {
    const w = makeWorld();
    const pane = renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    expect(root).toBeTruthy();
    expect((root.querySelector('.cs-title') as HTMLInputElement).placeholder).toBe('Name');
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Draft');
    for (const label of ['Open Chat', 'Export As Markdown', 'Chat Behaviour', 'Generate', 'Roll The Dice', 'Add Link', 'Add Canvas Page', 'Add File', 'Add Text', 'Send']) expect(buttonNamed(root, label), label).toBeTruthy();
    expect([...root.querySelectorAll('.cs-section-title')].map((e) => e.textContent)).toEqual(['Make', 'Dials', 'Canon', 'Sheet', 'Try A Line']);
    expect(root.querySelectorAll('.cs-row')).toHaveLength(11);
    for (const l of root.querySelectorAll('.cs-row-label > span:first-child')) expect(l.textContent).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/);
    expect(rowOf(root, 'personality').querySelectorAll('.cs-icon-btn')).toHaveLength(3);
    expect(root.querySelector('select')).toBeNull();
    expect(root.querySelectorAll('[data-dropdown]').length).toBeGreaterThan(0);
    expect(root.textContent).not.toMatch(/[—–]/);
    expect((root.querySelector('.cs-mode[aria-pressed="true"]') as HTMLElement).textContent).toBe('From A Concept');
    expect((root.querySelector('.cs-section--closed .cs-section-title') as HTMLElement).textContent).toBe('Dials');
    pane.dispose();
    expect(container.querySelector('.cs')).toBeNull();
  });

  it('turns a concept into a sheet that fills as it streams, then autosaves and folds Make away', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'A countess who counts');
    buttonNamed(root, 'Generate').click();
    await flush();
    expect((root.querySelector('.cs-title') as HTMLInputElement).value).toBe('Ada Lovelace');
    expect(areaOf(root, 'backstory').value).toBe('Born in 1815 in London.');
    expect(areaOf(root, 'exampleDialogue').value).toBe('[USER]: hi\n[AI]: Noted.');
    expect(root.querySelector('.cs-section')?.classList.contains('cs-section--closed')).toBe(true);
    await flush(900);
    expect(w.saved.size).toBe(1);
    const data = [...w.saved.values()][0];
    expect(data.name).toBe('Ada Lovelace');
    expect(data.roleInstruction).toContain('## Appearance\nTall, ink on her cuffs.');
    expect(data.studio.sheet.secrets).toBe('She cannot add in her head.');
    expect(data.studio.concept).toBe('A countess who counts');
    expect(w.ctx.onCreated).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Saved');
    const sheetReq = w.requests.find((r) => r.messages[0].content.includes('character designer for roleplay fiction'))!;
    expect(sheetReq.options).toMatchObject({ format: 'json', think: false, numCtx: 4096 });
    expect(sheetReq.messages[1].content).not.toContain('ATTRIBUTES');
  });

  it('keeps the name you typed through Generate, tells the model, and the rail hears every later save', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-title') as HTMLInputElement, 'Barnaby Quill');
    await flush(900);
    expect(w.ctx.onCreated).toHaveBeenCalledTimes(1);
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'An innkeeper');
    buttonNamed(root, 'Generate').click();
    await flush();
    expect((root.querySelector('.cs-title') as HTMLInputElement).value).toBe('Barnaby Quill');
    expect(areaOf(root, 'backstory').value).toBe(SHEET.backstory);
    const req = w.requests.find((r) => r.messages[0].content.includes('character designer for roleplay fiction'))!;
    expect(req.messages[1].content).toContain('NAME: Barnaby Quill');
    await flush(900);
    const data = [...w.saved.values()][0];
    expect(data.name).toBe('Barnaby Quill');
    expect(w.ctx.onSaved).toHaveBeenCalledWith(expect.stringMatching(/^character-/), 'Barnaby Quill');
    // Clearing the name hands the choice back to the model.
    typeInto(root.querySelector('.cs-title') as HTMLInputElement, '');
    buttonNamed(root, 'Generate').click();
    await flush();
    expect((root.querySelector('.cs-title') as HTMLInputElement).value).toBe('Ada Lovelace');
  });

  it('refuses to generate with nothing to go on, in words, not a dialog', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    buttonNamed(root, 'Generate').click();
    await flush();
    expect((root.querySelector('.cs-error') as HTMLElement).textContent).toContain('Write a concept, or roll the dice.');
    expect(w.requests).toHaveLength(0);
  });

  it('keeps a locked row through Generate, and sends the dials only once they are touched', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(areaOf(root, 'personality'), 'Mine. Hands off.');
    (rowOf(root, 'personality').querySelector('[aria-label^="Lock"]') as HTMLButtonElement).click();
    expect(rowOf(root, 'personality').classList.contains('cs-row--locked')).toBe(true);
    buttonNamed(root, 'Roll The Dice').click();
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'A countess');
    buttonNamed(root, 'Generate').click();
    await flush();
    expect(areaOf(root, 'personality').value).toBe('Mine. Hands off.');
    expect(areaOf(root, 'voice').value).toBe(SHEET.voice);
    const sheetReq = w.requests.find((r) => r.messages[0].content.includes('character designer for roleplay fiction'))!;
    expect(sheetReq.messages[1].content).toContain('ATTRIBUTES');
    await flush(900);
    expect([...w.saved.values()][0].studio.locks).toEqual(['personality']);
  });

  it('builds a canon from sources, applies the Twist fact by fact, and writes the sheet from the twisted canon', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    buttonNamed(root, 'From Sources').click();
    buttonNamed(root, 'Add Text').click();
    const paste = root.querySelector('.cs-inline textarea') as HTMLTextAreaElement;
    typeInto(paste, 'Ada Lovelace was born in 1815. She is a mathematician who lives in London and writes about engines.');
    buttonNamed(root, 'Add').click();
    await flush();
    const sourceRow = root.querySelector('.cs-source') as HTMLElement;
    expect(sourceRow.querySelector('.cs-chip')?.textContent).toMatch(/^\d+ words$/);
    typeInto([...root.querySelectorAll('.cs-textarea')].find((t) => (t as HTMLTextAreaElement).placeholder.startsWith('What changes')) as HTMLTextAreaElement, 'Ada is a lighthouse keeper instead of a mathematician');
    buttonNamed(root, 'Generate').click();
    await flush();
    const canon = [...root.querySelectorAll('.cs-section')].find((s) => s.querySelector('.cs-section-title')?.textContent === 'Canon') as HTMLElement;
    expect(canon.style.display).toBe('');
    expect(canon.querySelector('.cs-section-meta')?.textContent).toBe('4 facts · 1 changed · 1 added');
    const facts = [...canon.querySelectorAll('.cs-fact')];
    expect(facts.map((f) => f.className.replace('cs-fact ', ''))).toEqual(['cs-fact--kept', 'cs-fact--changed', 'cs-fact--kept', 'cs-fact--added']);
    expect(facts[1].querySelector('.cs-fact-was')?.textContent).toBe('was: Ada is a mathematician.');
    expect(areaOf(root, 'description').value).toBe('Ada keeps a lighthouse.');
    const sheetReq = w.requests.find((r) => r.messages[0].content.includes('character designer for roleplay fiction'))!;
    expect(sheetReq.messages[1].content).toContain('- Ada is a lighthouse keeper.');
    expect(sheetReq.messages[1].content).toContain('already includes this change: Ada is a lighthouse keeper');
    // Leaving a fact out removes it from the next generation.
    (facts[3] as HTMLElement).click();
    expect(canon.querySelector('.cs-section-meta')?.textContent).toContain('1 left out');
    await flush(900);
    const data = [...w.saved.values()][0];
    expect(data.studio.canon.map((f: any) => f.status)).toEqual(['kept', 'changed', 'kept', 'added']);
    expect(data.studio.sources[0]).toMatchObject({ kind: 'text', status: 'ready' });
    expect(data.studio.excluded).toEqual([3]);
    expect(buttonNamed(root, 'Twist Again').style.display).toBe('');
  });

  it('adds a link only through the Web Research door, and shows the door\'s refusal on the row', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    buttonNamed(root, 'Add Link').click();
    typeInto(root.querySelector('.cs-inline input') as HTMLInputElement, 'https://example.org/ada');
    buttonNamed(root, 'Add').click();
    await flush();
    let rows = [...root.querySelectorAll('.cs-source')];
    expect(rows[0].querySelector('.cs-source-title')?.firstChild?.textContent).toBe('Ada Lovelace');
    expect(rows[0].querySelector('.cs-chip')?.textContent).toBe('8 words');
    buttonNamed(root, 'Add Link').click();
    typeInto(root.querySelector('.cs-inline input') as HTMLInputElement, 'https://10.0.0.1/secret');
    buttonNamed(root, 'Add').click();
    await flush();
    rows = [...root.querySelectorAll('.cs-source')];
    expect(rows[1].querySelector('.cs-chip')?.textContent).toBe('Could Not Fetch');
    expect((globalThis as any).parallxElectron).toBeUndefined();
  });

  it('rerolls one row and can undo it', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(areaOf(root, 'backstory'), 'The old backstory.');
    (rowOf(root, 'backstory').querySelector('[aria-label^="Rewrite"]') as HTMLButtonElement).click();
    await flush();
    expect(areaOf(root, 'backstory').value).toBe('Rewritten backstory.');
    const undo = rowOf(root, 'backstory').querySelector('[aria-label^="Undo"]') as HTMLButtonElement;
    expect(undo.style.display).toBe('');
    undo.click();
    expect(areaOf(root, 'backstory').value).toBe('The old backstory.');
    expect(undo.style.display).toBe('none');
    const req = w.requests[0];
    expect(req.messages[1].content).toContain('"backstory": "The old backstory."');
  });

  it('opens a character made before the Studio with its rows filled from the role instruction, and autosaves an edit without losing the rest', async () => {
    const existing = {
      id: 'char-legacy', name: 'Barnaby', writingPreset: 'immersive-rp', lorebookFiles: ['inn.md'],
      roleInstruction: 'Barnaby runs the inn.\n\n## Appearance\nBroad, apron.\n\n## Personality\nGenerous.\n\n## Voice\nLoud.',
      exampleDialogue: '[USER]: ale?\n[AI]: Always.', reminder: 'Barnaby never refuses a guest.',
    };
    const w = makeWorld({ existing });
    w.ctx.fileName = 'character-legacy.json';
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    expect((root.querySelector('.cs-title') as HTMLInputElement).value).toBe('Barnaby');
    expect(areaOf(root, 'appearance').value).toBe('Broad, apron.');
    expect(areaOf(root, 'reminder').value).toBe('Barnaby never refuses a guest.');
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Saved');
    expect(root.querySelector('.cs-section')?.classList.contains('cs-section--closed')).toBe(true);
    expect(w.saved.size).toBe(0);
    typeInto(areaOf(root, 'secrets'), 'He waters the ale.');
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Saving');
    await flush(900);
    const data = w.saved.get('character-legacy.json');
    expect(data).toMatchObject({ id: 'char-legacy', lorebookFiles: ['inn.md'], writingPreset: 'immersive-rp', reminder: 'Barnaby never refuses a guest.' });
    expect(data.roleInstruction).toBe('Barnaby runs the inn.\n\n## Appearance\nBroad, apron.\n\n## Personality\nGenerous.\n\n## Voice\nLoud.\n\n## Secrets\nHe waters the ale.');
    expect(w.ctx.onCreated).not.toHaveBeenCalled();
    buttonNamed(root, 'Chat Behaviour').click();
    await flush();
    expect(w.ctx.openChatBehaviour).toHaveBeenCalledWith('character-legacy.json');
  });

  it('answers a line in the character\'s voice, and hands the lineage on with Twist Again', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'A countess');
    buttonNamed(root, 'Generate').click();
    await flush();
    typeInto(root.querySelector('.cs-inline input') as HTMLInputElement, 'Are you well?');
    buttonNamed(root, 'Send').click();
    await flush();
    expect(root.querySelector('.cs-try-reply')?.textContent).toBe('Noted. What do you want?');
    // Twist Again only shows with a canon; give it one through sources.
    buttonNamed(root, 'From Sources').click();
    buttonNamed(root, 'Add Text').click();
    typeInto(root.querySelector('.cs-inline textarea') as HTMLTextAreaElement, 'Ada Lovelace was born in 1815.');
    buttonNamed(root, 'Add').click();
    await flush();
    buttonNamed(root, 'Generate').click();
    await flush(900);
    buttonNamed(root, 'Twist Again').click();
    await flush(900);
    expect(w.ctx.openNew).toHaveBeenCalledTimes(1);
    const from = (w.ctx.openNew as any).mock.calls[0][0];
    expect(from.parentName).toBe('Ada Lovelace');
    expect(from.parentId).toMatch(/^char-/);
    expect(from.baseFacts).toEqual(['Ada was born in 1815.', 'Ada is a mathematician.', 'Ada lives in London.']);
    expect(from.sources).toHaveLength(1);
  });

  it('shows the lineage as crumbs when opened from a Twist', async () => {
    const w = makeWorld();
    w.saved.set('character-parent.json', { id: 'char-p', name: 'Ada', roleInstruction: '', studio: {} });
    w.ctx.from = { parentId: 'char-p', parentName: 'Ada', sources: [], baseFacts: ['Ada was born in 1815.'], concept: '' };
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    expect((root.querySelector('.cs-mode[aria-pressed="true"]') as HTMLElement).textContent).toBe('From Sources');
    expect(root.querySelector('.cs-crumbs')?.textContent).toContain('From Ada');
    typeInto(root.querySelector('.cs-title') as HTMLInputElement, 'Ada Of The Rock');
    await flush(900);
    expect(root.querySelector('.cs-crumbs')?.textContent).toBe('AdaAda Of The Rock');
    (root.querySelector('.cs-crumb:not(.cs-crumb--here)') as HTMLButtonElement).click();
    expect(w.ctx.openCharacter).toHaveBeenCalledWith('character-parent.json');
  });
});
