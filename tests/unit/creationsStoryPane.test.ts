// @vitest-environment jsdom
// Creations AI: the Story Writer pane (ext/creations-ai/story.js), driven
// with a stubbed model and file system. Never a live model.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-expect-error — JS module with no types
import { renderStoryPane, renderStoriesPage } from '../../ext/creations-ai/story.js';

function el(tag: string, className?: string | null, attrs?: Record<string, string>) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); }
  return e;
}
function dropdownStub(host: HTMLElement, { items = [], selected = '' }: any) {
  let value = selected;
  const listeners: ((v: string) => void)[] = [];
  host.setAttribute('data-dropdown', 'true');
  const dd = {
    get value() { return value; }, set value(v: string) { value = v; },
    setItems(list: any[]) { items = list; }, onDidChange(fn: (v: string) => void) { listeners.push(fn); },
    _fire(v: string) { value = v; listeners.forEach((fn) => fn(v)); }, get items() { return items; },
  };
  (host as any).__dd = dd;
  return dd;
}
function tgSelect(parallx: any, { layout = 'full', title = '', items = [], value = '', onChange = null }: any = {}) {
  const host = el('span', `tg-dd tg-dd--${layout}`);
  if (title) host.title = title;
  const dd = parallx.ui.createDropdown(host, { items, selected: value });
  if (onChange) dd.onDidChange(onChange);
  return { element: host, get value() { return dd.value ?? ''; }, set value(v: string) { dd.value = v; }, setItems(list: any[]) { dd.setItems(list); } };
}
async function* chunks(parts: string[]) { for (const p of parts) yield { content: p }; }

function makeWorld() {
  const files = new Map<string, string>();
  const requests: { messages: { role: string; content: string }[]; options: any }[] = [];
  let ids = 0;
  const parallx = {
    lm: {
      getModels: async () => [{ id: 'm1', displayName: 'Model One' }],
      sendChatRequest: (_m: string, messages: any[], options: any) => {
        requests.push({ messages, options });
        const sys = messages[0].content as string;
        const user = messages[1].content as string;
        if (sys.includes('You keep the memory')) return chunks([JSON.stringify({ memory: 'Ada lit the lamp.' })]);
        if (user.includes('REWRITE THIS BEAT')) return chunks(['Rewritten ', 'beat.']);
        if (sys.includes('You are a novelist')) return chunks(['The lamp — ', 'went out at dusk.']);
        return chunks(['']);
      },
    },
    window: { showInputBox: async () => undefined, showWarningMessage: async () => ({ title: 'Delete' }) },
    commands: { executeCommand: async () => null },
    ui: { createDropdown: dropdownStub },
    workspace: { fs: null as any, workspaceFolders: [{ uri: 'ws' }] },
  };
  const fs = {
    readFile: async (uri: string) => { const name = uri.split('/').pop()!; if (!files.has(name)) throw new Error(`no ${name}`); return { content: files.get(name) }; },
    writeFile: async (uri: string, content: string) => { files.set(uri.split('/').pop()!, content); },
    readdir: async () => [...files.keys()].map((name) => ({ name, type: 1 })),
    delete: async (uri: string) => { files.delete(uri.split('/').pop()!); },
  };
  parallx.workspace.fs = fs;
  const characters = [{ fileName: 'character-a.json', frontmatter: { name: 'Ada' }, rawData: { name: 'Ada', roleInstruction: 'Ada counts.\n\n## Voice\nShort lines.' } }];
  const deps = {
    el, icon: (n: string) => `<i data-icon="${n}"></i>`, tgSelect,
    loadSettings: async () => ({ storyModelId: '', defaultModel: '', storyContextWindow: 0, defaultContextWindow: 4096 }),
    saveSettings: async () => {},
    generateId: () => `id${++ids}xxxxxxxx`,
    scanCharacters: async () => characters,
    resolveUri: (b: string, p: string) => `${b}/${p}`,
    extRoot: '.parallx/extensions/text-generator', extFolder: 'text-generator',
    ctxPresets: [{ value: 0, label: 'Auto' }],
    ensureNestedDirs: async () => {},
    exportMarkdown: vi.fn(async () => true),
    injectStyles: () => {},
  };
  const ctx = { fs, workspaceUri: 'ws', fileName: null as string | null, onCreated: vi.fn(async () => {}) };
  return { parallx, fs, deps, ctx, files, requests };
}

const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
const buttonNamed = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const typeInto = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
const beats = (root: HTMLElement) => [...root.querySelectorAll('.st-beat:not(.st-beat--live) textarea')] as HTMLTextAreaElement[];

let container: HTMLElement;
beforeEach(() => { vi.useFakeTimers(); container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { vi.useRealTimers(); container.remove(); });

describe('the Story Writer', () => {
  it('shows the bar, the Brief, the Memory and the composer, Title Case, nothing native', async () => {
    const w = makeWorld();
    renderStoryPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.st') as HTMLElement;
    for (const label of ['Export As Markdown', 'New Chapter', 'Update Memory', 'Continue']) expect(buttonNamed(root, label), label).toBeTruthy();
    expect([...root.querySelectorAll('.cs-section-title')].map((e) => e.textContent)).toEqual(['Brief', 'Story Memory']);
    expect([...root.querySelectorAll('.cs-label')].map((e) => e.textContent)).toEqual(['Premise', 'Genre', 'Setting', 'Style', 'Point Of View', 'Tense', 'Beat Length', 'Cast', "Author's Note"]);
    expect(root.querySelector('select')).toBeNull();
    expect(root.textContent).not.toMatch(/[—–]/);
    expect(root.querySelector('.st-chapter-title')).toBeTruthy();
    expect(root.querySelector('.st-empty')?.textContent).toContain('Nothing written yet');
  });

  it('will not write without a premise, then writes a beat that streams, cleans, saves and folds the Brief', async () => {
    const w = makeWorld();
    renderStoryPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.st') as HTMLElement;
    buttonNamed(root, 'Continue').click();
    await flush();
    expect((root.querySelector('.cs-error') as HTMLElement).textContent).toContain('premise');
    typeInto(root.querySelector('.cs-title') as HTMLInputElement, 'The Light');
    typeInto(root.querySelector('textarea[aria-label="Premise"]') as HTMLTextAreaElement, 'A keeper who cannot swim.');
    typeInto(root.querySelector('input[aria-label="Direction for the next beat"]') as HTMLInputElement, 'the boat arrives');
    buttonNamed(root, 'Continue').click();
    await flush();
    expect(beats(root).map((b) => b.value)).toEqual(['The lamp, went out at dusk.']);
    expect(root.querySelector('.cs-section')?.classList.contains('cs-section--closed')).toBe(true);
    expect(root.querySelector('.st-chapter-meta')?.textContent).toBe('1 beat · 6 words');
    const req = w.requests.find((r) => r.messages[0].content.includes('You are a novelist'))!;
    expect(req.messages[0].content).toContain('Premise: A keeper who cannot swim.');
    expect(req.messages[1].content).toContain('Direction for this beat: the boat arrives');
    expect(req.options).toMatchObject({ numCtx: 4096, think: false });
    await flush(900);
    const saved = [...w.files.entries()].find(([n]) => n.startsWith('story-'))!;
    const story = JSON.parse(saved[1]);
    expect(story.title).toBe('The Light');
    expect(story.beats[0]).toMatchObject({ text: 'The lamp, went out at dusk.', instruction: 'the boat arrives', chapterId: 'ch-1' });
    expect(w.ctx.onCreated).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Saved');
  });

  it('puts new beats in the newest chapter, rewrites a beat on a direction, and can undo it', async () => {
    const w = makeWorld();
    renderStoryPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.st') as HTMLElement;
    typeInto(root.querySelector('textarea[aria-label="Premise"]') as HTMLTextAreaElement, 'P.');
    buttonNamed(root, 'Continue').click();
    await flush();
    buttonNamed(root, 'New Chapter').click();
    expect([...root.querySelectorAll('.st-chapter-title')].map((t) => (t as HTMLInputElement).value)).toEqual(['Chapter 1', 'Chapter 2']);
    buttonNamed(root, 'Continue').click();
    await flush();
    const chapters = [...root.querySelectorAll('.st-chapter')];
    expect(chapters[1].querySelectorAll('.st-beat').length).toBe(1);
    const beat = chapters[1].querySelector('.st-beat') as HTMLElement;
    (beat.querySelector('[aria-label^="Rewrite"]') as HTMLButtonElement).click();
    typeInto(beat.querySelector('.st-beat-steer input') as HTMLInputElement, 'slower');
    buttonNamed(beat, 'Rewrite').click();
    await flush();
    expect((beat.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Rewritten beat.');
    const req = w.requests[w.requests.length - 1];
    expect(req.messages[1].content).toContain('REWRITE THIS BEAT');
    expect(req.messages[1].content).toContain('How it should change: slower');
    (beat.querySelector('[aria-label^="Undo"]') as HTMLButtonElement).click();
    expect((beat.querySelector('textarea') as HTMLTextAreaElement).value).toBe('The lamp, went out at dusk.');
  });

  it('adds a cast member from the roster and the writer hears their voice; the memory updates by hand and on its own', async () => {
    const w = makeWorld();
    renderStoryPane(container, w.parallx, w.ctx, w.deps);
    await flush();
    const root = container.querySelector('.st') as HTMLElement;
    const castDd = (root.querySelector('.st-cast [data-dropdown]') as any).__dd;
    expect(castDd.items.map((i: any) => i.label)).toEqual(['Add Character', 'Ada']);
    castDd._fire('character-a.json');
    expect([...root.querySelectorAll('.st-cast .cs-chip')].map((c) => c.firstChild?.textContent)).toEqual(['Ada']);
    typeInto(root.querySelector('textarea[aria-label="Premise"]') as HTMLTextAreaElement, 'P.');
    for (let i = 0; i < 4; i++) { buttonNamed(root, 'Continue').click(); await flush(); }
    const beatReq = w.requests.find((r) => r.messages[0].content.includes('You are a novelist'))!;
    expect(beatReq.messages[0].content).toContain('Voice: Short lines.');
    // The fourth beat triggers the memory on its own.
    expect(w.requests.some((r) => r.messages[0].content.includes('You keep the memory'))).toBe(true);
    expect((root.querySelector('textarea[aria-label="Story memory"]') as HTMLTextAreaElement).value).toBe('Ada lit the lamp.');
    buttonNamed(root, 'Update Memory').click();
    await flush();
    expect(w.requests.filter((r) => r.messages[0].content.includes('You keep the memory')).length).toBe(2);
  });

  it('opens a saved story from the rail with everything in place', async () => {
    const w = makeWorld();
    w.files.set('story-old.json', JSON.stringify({ id: 'story-old', title: 'Old', brief: { premise: 'Once.', genre: 'g', pov: 'first', tense: 'present', cast: [] }, chapters: [{ id: 'ch-1', title: 'One' }], beats: [{ id: 'b1', text: 'It began.', chapterId: 'ch-1' }], memory: 'M.', memoryAt: 1, updatedAt: 5 }));
    renderStoriesPage(container, w.parallx, { instanceId: 'stories' }, w.deps);
    await flush();
    const rowEl = container.querySelector('.tg-cc-row') as HTMLElement;
    expect(rowEl.querySelector('.tg-cc-row-name')?.textContent).toBe('Old');
    rowEl.click();
    await flush();
    const root = container.querySelector('.st') as HTMLElement;
    expect((root.querySelector('.cs-title') as HTMLInputElement).value).toBe('Old');
    expect((root.querySelector('textarea[aria-label="Premise"]') as HTMLTextAreaElement).value).toBe('Once.');
    expect(beats(root).map((b) => b.value)).toEqual(['It began.']);
    expect((root.querySelector('.st-chapter-title') as HTMLInputElement).value).toBe('One');
    expect(root.querySelector('.cs-section')?.classList.contains('cs-section--closed')).toBe(true);
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Saved');
    buttonNamed(root, 'Export As Markdown').click();
    await flush();
    expect(w.deps.exportMarkdown).toHaveBeenCalledWith('old.md', '# Old\n\n## One\n\nIt began.\n', 'Old');
  });
});
