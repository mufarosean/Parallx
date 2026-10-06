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
  name: 'Ada Lovelace', tagline: 'Counts what others feel', description: 'Ada counts everything.',
  appearance: 'Overview: Tall, ink on her cuffs.\n\nHeight and build: Five foot nine, narrow.\n\nFace: Grey eyes that do not blink enough.\n\nClothes: Black, mended at the elbows.\n\nPhysicality: Sits very straight and taps a count on her knee.',
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
        if (sys.includes('you propose several different characters')) return chunks([JSON.stringify({ pitches: [
          { name: 'Marit Holm', tagline: 'Keeps the light and the gossip', hook: 'She runs the last manned light.', contradiction: 'Wants company, drives it off.', line: 'Sit. The kettle is on.' },
          { name: 'Teodor Brask', tagline: 'Retired, not resigned', hook: 'He took the light to be alone and hates it.', contradiction: 'Writes letters he never sends.', line: 'The boat comes Tuesday. Or it does not.' },
        ] })]);
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
    window: { showInputBox: async () => undefined, showWarningMessage: async () => undefined, showQuickPick: async (items: { label: string }[]) => items[items.length - 1] },
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
    rollSeed: async (list: string) => ({ want: 'to be asked to stay', fear: 'deep water', secret: 'they kept the money' } as Record<string, string>)[list] || '',
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
    for (const label of ['Open Chat', 'Export As Markdown', 'Chat Behaviour', 'Generate', 'Pitch Ideas', 'Roll The Dice', 'Add Link', 'Add Canvas Page', 'Add File', 'Add Text', 'Send']) expect(buttonNamed(root, label), label).toBeTruthy();
    expect([...root.querySelectorAll('.cs-section-title')].map((e) => e.textContent)).toEqual(['Make', 'Dials', 'Pitches', 'Canon', 'Sheet', 'Try A Line']);
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
    expect(data.roleInstruction).toContain('## Appearance\nOverview: Tall, ink on her cuffs.');
    expect(data.studio.sheet.secrets).toBe('She cannot add in her head.');
    expect(data.studio.concept).toBe('A countess who counts');
    expect(w.ctx.onCreated).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Saved');
    const sheetReq = w.requests.find((r) => r.messages[0].content.includes('character designer for roleplay fiction'))!;
    expect(sheetReq.options).toMatchObject({ format: 'json', think: false, numCtx: 4096 });
    expect(sheetReq.messages[1].content).not.toContain('ATTRIBUTES');
    // The shipped sheet structure rides in the request: Appearance in sections, one paragraph each.
    expect(sheetReq.messages[1].content).toMatch(/"appearance": written as 5 separate paragraphs/);
    expect(sheetReq.messages[1].content).toContain('Physicality (how they move');
  });

  it('follows the sheet structure from Settings as it stands at each generation, and an emptied one means the usual shape', async () => {
    const w = makeWorld();
    let structure: string | undefined = 'Backstory\n- Childhood: where and with whom\n- The war: what it took';
    w.deps.loadSettings = async () => ({ forgeModelId: '', defaultModel: '', forgeContextWindow: 0, defaultContextWindow: 4096, studioSourceWords: 40, ...(structure === undefined ? {} : { sheetStructure: structure }) });
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'An innkeeper');
    buttonNamed(root, 'Generate').click();
    await flush();
    const first = w.requests.filter((r) => r.messages[0].content.includes('character designer for roleplay fiction')).at(-1)!;
    expect(first.messages[1].content).toMatch(/"backstory": written as 2 separate paragraphs/);
    expect(first.messages[1].content).toMatch(/"appearance": one vivid paragraph/);
    structure = '';
    buttonNamed(root, 'Generate').click();
    await flush();
    const second = w.requests.filter((r) => r.messages[0].content.includes('character designer for roleplay fiction')).at(-1)!;
    expect(second.messages[1].content).not.toContain('separate paragraphs');
    expect(second.messages[1].content).toMatch(/"backstory": 1-2 paragraphs/);
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

  it('pitches several takes first, and writes the sheet from the one picked', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    expect(buttonNamed(root, 'Pitch Ideas')).toBeTruthy();
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'A lighthouse keeper');
    buttonNamed(root, 'Pitch Ideas').click();
    await flush();
    const cards = [...root.querySelectorAll('.cs-pitch')];
    expect(cards).toHaveLength(2);
    expect(cards[1].querySelector('.cs-pitch-name')?.textContent).toBe('Teodor Brask');
    expect(cards[1].querySelector('.cs-pitch-line')?.textContent).toBe('"The boat comes Tuesday. Or it does not."');
    const pitchReq = w.requests.find((r) => r.messages[0].content.includes('you propose several different characters'))!;
    expect(pitchReq.options.temperature).toBe(1);
    expect(pitchReq.messages[1].content).toContain('A lighthouse keeper');
    // No sheet yet: pitching is a step before the sheet.
    expect(areaOf(root, 'backstory').value).toBe('');
    (cards[1].querySelector('button') as HTMLButtonElement).click();
    await flush();
    const sheetReq = w.requests.find((r) => r.messages[0].content.includes('character designer for roleplay fiction'))!;
    expect(sheetReq.messages[1].content).toContain('NAME: Teodor Brask');
    expect(sheetReq.messages[1].content).toContain('The take to write, chosen from several pitches');
    expect(sheetReq.messages[1].content).toContain('Hook: He took the light to be alone and hates it.');
    expect(areaOf(root, 'backstory').value).toBe(SHEET.backstory);
    expect(root.querySelector('.cs-pitch--chosen .cs-pitch-name')?.textContent).toBe('Teodor Brask');
    await flush(900);
    const data = [...w.saved.values()][0];
    expect(data.studio.pitch.name).toBe('Teodor Brask');
    expect(data.studio.concept).toBe('A lighthouse keeper');
  });

  it('the dice roll a want, a fear and a secret from the seeds table, and leave a locked one alone', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    const inputOf = (label: string) => [...root.querySelectorAll('.tg-forge-row--text')].find((r) => r.querySelector('.tg-forge-row-label')?.textContent === label)!.querySelector('input') as HTMLInputElement;
    typeInto(inputOf('Fear'), 'the telephone');
    ([...root.querySelectorAll('.tg-forge-row--text')].find((r) => r.querySelector('.tg-forge-row-label')?.textContent === 'Fear')!.querySelector('.tg-forge-lock') as HTMLButtonElement).click();
    buttonNamed(root, 'Roll The Dice').click();
    await flush();
    expect(inputOf('Want').value).toBe('to be asked to stay');
    expect(inputOf('Secret').value).toBe('they kept the money');
    expect(inputOf('Fear').value).toBe('the telephone');
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'A ferry captain');
    buttonNamed(root, 'Generate').click();
    await flush();
    const req = w.requests.find((r) => r.messages[0].content.includes('character designer for roleplay fiction'))!;
    expect(req.messages[1].content).toContain('ATTRIBUTES');
  });

  it('makes one of the people in Relationships a character of their own, named, with the line as the concept', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-title') as HTMLInputElement, 'Ada Lovelace');
    typeInto(areaOf(root, 'tagline'), 'Counts what others feel');
    typeInto(areaOf(root, 'relationships'), 'Babbage: her collaborator, strained.\nDana: her sister, lives upstairs.');
    const makeBtn = rowOf(root, 'relationships').querySelector('.cs-make-them') as HTMLButtonElement;
    expect(makeBtn).toBeTruthy();
    expect(rowOf(root, 'personality').querySelector('.cs-make-them')).toBeNull();
    makeBtn.click();
    await flush();
    expect(w.ctx.openNew).toHaveBeenCalledTimes(1);
    const from = (w.ctx.openNew as any).mock.calls[0][0];
    expect(from.name).toBe('Dana');
    expect(from.concept).toContain('Dana: her sister, lives upstairs.');
    expect(from.concept).toContain('in relation to Ada Lovelace (Counts what others feel)');
    expect(from.relatedTo.name).toBe('Ada Lovelace');
    expect(from.relatedTo.how).toBe('her sister, lives upstairs.');
    // Opened from that: the Studio in concept mode, the name in the title, nothing written yet.
    const w2 = makeWorld();
    w2.ctx.from = from;
    renderStudioPane(container, w2.parallx, w2.ctx, w2.deps);
    await flush();
    const root2 = container.querySelectorAll('.cs')[1] as HTMLElement;
    expect((root2.querySelector('.cs-title') as HTMLInputElement).value).toBe('Dana');
    expect((root2.querySelector('.cs-mode[aria-pressed="true"]') as HTMLElement).textContent).toBe('From A Concept');
    expect((root2.querySelector('.cs-textarea') as HTMLTextAreaElement).value).toContain('Dana: her sister');
    expect(w2.requests).toHaveLength(0);
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
    // The reason is on the row in words, not hidden behind the chip.
    expect(rows[1].querySelector('.cs-source-why')?.textContent).toBe('This address is not allowed.');
    expect(rows[1].querySelector('.cs-chip')?.getAttribute('title')).toBe('This address is not allowed.');
    expect((globalThis as any).parallxElectron).toBeUndefined();
  });

  it('rerolls one row and can undo it', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(areaOf(root, 'backstory'), 'The old backstory.');
    const row = rowOf(root, 'backstory');
    (row.querySelector('[aria-label^="Rewrite"]') as HTMLButtonElement).click();
    // Rewrite opens the direction box first; nothing is sent yet.
    expect(row.classList.contains('cs-row--steer')).toBe(true);
    expect(w.requests).toHaveLength(0);
    // Empty direction: a fresh take, as before.
    (row.querySelector('.cs-row-steer .cs-btn--primary') as HTMLButtonElement).click();
    await flush();
    expect(areaOf(root, 'backstory').value).toBe('Rewritten backstory.');
    expect(row.classList.contains('cs-row--steer')).toBe(false);
    expect(w.requests[0].messages[1].content).not.toContain('DIRECTION');
    const undo = rowOf(root, 'backstory').querySelector('[aria-label^="Undo"]') as HTMLButtonElement;
    expect(undo.style.display).toBe('');
    undo.click();
    expect(areaOf(root, 'backstory').value).toBe('The old backstory.');
    expect(undo.style.display).toBe('none');
    const req = w.requests[0];
    expect(req.messages[1].content).toContain('"backstory": "The old backstory."');
  });

  it('rewrites a row the way the user directs, and saves what comes back', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-title') as HTMLInputElement, 'Ada Lovelace'); // a named character autosaves
    typeInto(areaOf(root, 'backstory'), 'The old backstory.');
    const row = rowOf(root, 'backstory');
    const open = row.querySelector('[aria-label^="Rewrite"]') as HTMLButtonElement;
    open.click();
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const box = row.querySelector('.cs-row-steer textarea') as HTMLTextAreaElement;
    expect(box.placeholder).toContain('How should it change?');
    expect(document.activeElement).toBe(box);
    // Escape closes it without sending; the rewrite icon opens it again.
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(row.classList.contains('cs-row--steer')).toBe(false);
    open.click();
    box.value = 'More about the war years and her brother.';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(w.requests).toHaveLength(1);
    expect(w.requests[0].messages[1].content).toContain('DIRECTION: More about the war years and her brother.');
    expect(areaOf(root, 'backstory').value).toBe('Rewritten backstory.');
    expect(row.classList.contains('cs-row--steer')).toBe(false);
    expect(box.value).toBe('');
    await flush(900); // autosave
    expect(JSON.stringify([...w.saved.values()])).toContain('Rewritten backstory.');
    // Shift+Enter is a new line in the box, not a send.
    open.click();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    await flush();
    expect(w.requests).toHaveLength(1);
  });

  it('a locked row cannot open the direction box, and locking closes it', async () => {
    const w = makeWorld();
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    const row = rowOf(root, 'voice');
    (row.querySelector('[aria-label^="Rewrite"]') as HTMLButtonElement).click();
    expect(row.classList.contains('cs-row--steer')).toBe(true);
    (row.querySelector('[aria-label^="Lock"]') as HTMLButtonElement).click();
    expect(row.classList.contains('cs-row--steer')).toBe(false);
    (row.querySelector('[aria-label^="Rewrite"]') as HTMLButtonElement).click();
    expect(row.classList.contains('cs-row--steer')).toBe(false);
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

describe('connected people (2026-10-06)', () => {
  const ashby = { id: 'char-ashby', name: 'Lord Ashby', roleInstruction: '', studio: { sheet: { name: 'Lord Ashby', tagline: 'Owns the valley', description: 'Ashby holds Harrow Court, a grey stone house above the river.', relationships: 'Clara Ashby: his wife.' } } };

  it('adds a person from the roster with a line, sends their card as fact, saves the link and shows it', async () => {
    const w = makeWorld();
    w.saved.set('character-ashby.json', ashby);
    w.parallx.window.showInputBox = async () => 'works for Lord Ashby at Harrow Court as his gamekeeper';
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-title') as HTMLInputElement, 'Tom Hale');
    buttonNamed(root, 'Add Person').click();
    await flush();
    const row = root.querySelector('.cs-connection') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.querySelector('.cs-source-title')?.textContent).toBe('Lord Ashby');
    expect((row.querySelector('.cs-connection-how') as HTMLInputElement).value).toBe('works for Lord Ashby at Harrow Court as his gamekeeper');
    expect(root.querySelector('.cs-crumbs')?.textContent).toBe('Connected to Lord Ashby');
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'A gamekeeper');
    buttonNamed(root, 'Generate').click();
    await flush(900);
    const req = w.requests.filter((r) => r.messages[0].content.includes('character designer for roleplay fiction')).at(-1)!;
    expect(req.messages[1].content).toContain('CONNECTED PEOPLE');
    expect(req.messages[1].content).toContain('### Lord Ashby');
    expect(req.messages[1].content).toContain('Harrow Court, a grey stone house');
    expect(req.messages[1].content).toContain("Tom Hale to them, from Tom Hale's side: works for Lord Ashby");
    const tom = [...w.saved.entries()].find(([f]) => f !== 'character-ashby.json')![1];
    expect(tom.studio.connections).toEqual([{ fileName: 'character-ashby.json', name: 'Lord Ashby', how: 'works for Lord Ashby at Harrow Court as his gamekeeper' }]);
    // The back-link: one line onto Ashby's card, not twice.
    (row.querySelector('.cs-backlink') as HTMLButtonElement).click();
    await flush();
    expect(w.saved.get('character-ashby.json').studio.sheet.relationships).toBe('Clara Ashby: his wife.\nTom Hale: works for Lord Ashby at Harrow Court as his gamekeeper.');
    expect(w.saved.get('character-ashby.json').roleInstruction).toContain('Tom Hale: works for Lord Ashby');
    (row.querySelector('.cs-backlink') as HTMLButtonElement).click();
    await flush();
    expect(w.saved.get('character-ashby.json').studio.sheet.relationships.match(/Tom Hale/g)).toHaveLength(1);
    // Removing the connection drops it from the save and the crumbs.
    (row.querySelector('[title="Remove this connection"]') as HTMLButtonElement).click();
    await flush(900);
    expect([...w.saved.entries()].find(([f]) => f !== 'character-ashby.json')![1].studio.connections).toEqual([]);
    expect((root.querySelector('.cs-crumbs') as HTMLElement).style.display).toBe('none');
  });

  it('opens a saved character with its connections, and Make One Of Their People arrives connected', async () => {
    const w = makeWorld({ existing: { id: 'char-tom', name: 'Tom Hale', roleInstruction: '', studio: { sheet: { name: 'Tom Hale' }, connections: [{ fileName: 'character-ashby.json', name: 'Lord Ashby', how: 'his gamekeeper' }] } } });
    w.ctx.fileName = 'character-legacy.json';
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    expect(root.querySelector('.cs-connection .cs-source-title')?.textContent).toBe('Lord Ashby');
    const w2 = makeWorld();
    w2.ctx.from = { concept: 'Dana: her sister', name: 'Dana', relatedTo: { fileName: 'character-ada.json', name: 'Ada Lovelace', how: 'her sister, lives upstairs' } };
    renderStudioPane(container, w2.parallx, w2.ctx, w2.deps);
    await flush();
    const root2 = container.querySelectorAll('.cs')[1] as HTMLElement;
    expect(root2.querySelector('.cs-connection .cs-source-title')?.textContent).toBe('Ada Lovelace');
    expect((root2.querySelector('.cs-connection-how') as HTMLInputElement).value).toBe('her sister, lives upstairs');
  });
});

describe('a structured field the model left short (2026-10-06)', () => {
  const short = { ...SHEET, appearance: 'Overview: Tall, ink on her cuffs.\n\nFace: Grey eyes.' };
  function worldWith(onComplete: (user: string) => string) {
    const w = makeWorld();
    const orig = w.parallx.lm.sendChatRequest;
    w.parallx.lm.sendChatRequest = (model: string, messages: { role: string; content: string }[], options: any) => {
      const sys = messages[0].content; const user = messages[1].content;
      if (sys.includes('character designer for roleplay fiction') && !sys.includes('exactly one string key')) { w.requests.push({ messages, options }); return chunks([JSON.stringify(short)]); }
      if (sys.includes('exactly one string key') && user.includes('ADD the missing sections')) { w.requests.push({ messages, options }); return chunks([JSON.stringify({ appearance: onComplete(user) })]); }
      return orig(model, messages, options);
    };
    return w;
  }

  it('asks once for the missing sections, keeping the rest, and takes the completed field', async () => {
    const w = worldWith(() => SHEET.appearance);
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'A countess who counts');
    buttonNamed(root, 'Generate').click();
    await flush(900);
    const completion = w.requests.find((r) => r.messages[1].content.includes('ADD the missing sections'))!;
    expect(completion).toBeTruthy();
    expect(completion.messages[1].content).toContain('Height and build (height, weight, frame, posture, how they carry it)');
    expect(completion.messages[1].content).toContain('Clothes (');
    expect(completion.messages[1].content).toContain('Physicality (');
    expect(completion.messages[1].content).not.toMatch(/missing sections: Overview/);
    expect(completion.messages[1].content).toContain('Keep every paragraph that is already there, word for word');
    expect(areaOf(root, 'appearance').value).toBe(SHEET.appearance);
    expect((rowOf(root, 'appearance').querySelector('.cs-row-error') as HTMLElement | null)?.style.display ?? 'none').toBe('none');
    // The sheet request itself was told, in the system message, that short fields are wrong.
    const sheetReq = w.requests.find((r) => r.messages[0].content.includes('character designer for roleplay fiction'))!;
    expect(sheetReq.messages[0].content).toMatch(/"appearance" \(5 sections: Overview, Height and build, Face, Clothes, Physicality\)/);
    expect(sheetReq.messages[1].content).toContain('Written like: "Overview: ...\\n\\nHeight and build: ...');
  });

  it('when the model still leaves sections out, the row says which and offers Complete, and keeps what it had', async () => {
    const w = worldWith(() => 'Overview: Tall, ink on her cuffs.\n\nFace: Grey eyes.\n\nClothes: Black.');
    renderStudioPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    typeInto(root.querySelector('.cs-textarea') as HTMLTextAreaElement, 'A countess who counts');
    buttonNamed(root, 'Generate').click();
    await flush(900);
    // Three of five came back the second time: taken (more than two), and the notice names the two still missing.
    expect(areaOf(root, 'appearance').value).toContain('Clothes: Black.');
    const err = rowOf(root, 'appearance').querySelector('.cs-row-error') as HTMLElement;
    expect(err.textContent).toContain('Missing: Height and build, Physicality.');
    expect(buttonNamed(err, 'Complete')).toBeTruthy();
    const before = w.requests.length;
    buttonNamed(err, 'Complete').click();
    await flush(900);
    expect(w.requests.length).toBe(before + 1);
  });
});
