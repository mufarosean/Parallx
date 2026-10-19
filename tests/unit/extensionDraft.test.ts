// @vitest-environment jsdom
// An extension the assistant wrote: checked, shown for review, installed
// only when the person presses Install (tools/extensionDraft.ts,
// chat/rendering/extensionReview.ts, electron/extensionDraftBridge.cjs).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { draftFailures, readExtensionDraft, type ExtensionDraft } from '../../src/tools/extensionDraft';
import { registerExtensionReview, EXTENSION_DRAFT_COMMAND } from '../../src/built-in/chat/rendering/extensionReview';
import { ILanguageModelToolsService } from '../../src/services/chatTypes';

const MAIN = `export function activate(api, context) {
  context.subscriptions.push(api.commands.registerCommand('assistant.recipes.open', () => {}));
  context.subscriptions.push(api.chat.registerTool('recipes_convert', { description: 'x', parameters: {}, requiresConfirmation: false, handler: async () => ({ content: '' }) }));
  const db = api.database;
  api.commands.executeCommand('assistant.recipes.open');
}
export function deactivate() {}`;

const good = (): ExtensionDraft => ({
  manifest: {
    manifestVersion: 1, id: 'assistant.recipes', name: 'Recipe Converter', version: '0.1.0', publisher: 'assistant',
    description: 'Converts recipes to metric.', main: 'main.js', activationEvents: ['onStartupFinished'], engines: { parallx: '>=0.1.0' },
    contributes: { commands: [{ id: 'assistant.recipes.open', title: 'Convert A Recipe…' }] },
  },
  files: { 'main.js': MAIN, 'styles.css': '.r { color: var(--px-text); font-size: var(--px-text-sm); }' },
});

describe('reading a draft', () => {
  it('a draft that keeps the rules passes every check, and says what it adds and reaches', () => {
    const r = readExtensionDraft(good());
    expect(draftFailures(r)).toBe('');
    expect(r.passed).toBe(r.checks.length);
    expect(r.checks.length).toBeGreaterThanOrEqual(14);
    expect(r.adds).toEqual([
      { kind: 'Command', what: 'Convert A Recipe…' },
      { kind: 'AI tool', what: 'recipes_convert, so chat can use it' },
      { kind: 'Saved data', what: 'Its own table, kept when it is turned off' },
    ]);
    expect(r.reach).toEqual([
      { what: 'Your workspace files', allowed: false },
      { what: 'The internet', allowed: false },
      { what: 'Other tools and their data', allowed: false },
    ]);
  });

  it('refuses network, the app bridge, code from text, other tools, raw colours and stray files', () => {
    const d = good();
    const r = readExtensionDraft({
      manifest: { ...d.manifest, id: 'Bad_Id' },
      files: {
        'main.js': `${MAIN}\nfetch('https://x.example'); window.parallxElectron.fs; eval('1'); setTimeout(() => {}, 1);\napi.commands.executeCommand('canvas.deletePage'); api.commands.executeCommand(name);\nel.style.color = '#ff0000'; alert('hi');`,
        '../evil.js': 'x',
      },
    });
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.rule);
    expect(failed).toEqual(expect.arrayContaining([
      'Its id is lowercase with exactly one dot (publisher.name)',
      'Only its own small files (.js, .css, .json, .md; under 512 KB)',
      expect.stringMatching(/^Reaches no network/),
      expect.stringMatching(/^Stays out of the app itself/),
      expect.stringMatching(/^Runs no code built from text/),
      expect.stringMatching(/^Starts no timers/),
      'Uses theme colours, never raw ones',
      expect.stringMatching(/^No browser dialogs/),
      "Runs only its own commands (no other tool's)",
    ]));
    expect(r.reach.find((x) => x.what === 'The internet')?.allowed).toBe(true);
    expect(draftFailures(r)).toMatch(/runs [^)]*canvas\.deletePage, name/);
  });

  it('needs main.js with an activate function', () => {
    const r = readExtensionDraft({ manifest: good().manifest, files: { 'other.js': 'export const x = 1;' } });
    expect(r.checks.filter((c) => !c.ok).map((c) => c.rule)).toEqual(expect.arrayContaining([
      'Its code is main.js, at the top of the extension', 'It has an activate function',
    ]));
  });
});

describe('the review: nothing is installed until the person presses Install', () => {
  afterEach(() => { document.body.replaceChildren(); });

  function setup() {
    const commands = new Map<string, (...a: unknown[]) => unknown>();
    let provider: { createEditorPane(c: HTMLElement, i?: { instanceId?: string }): { dispose(): void } } | undefined;
    let tool: { handler(args: Record<string, unknown>): Promise<{ content: string }> } | undefined;
    const opened: { instanceId?: string; title: string }[] = [];
    const installed = new Set<string>();
    const api = {
      commands: { registerCommand: (id: string, h: (...a: unknown[]) => unknown) => { commands.set(id, h); return { dispose() {} }; }, executeCommand: async () => undefined },
      chat: { registerTool: () => ({ dispose() {} }) },
      editors: {
        registerEditorProvider: (_t: string, p: typeof provider) => { provider = p; return { dispose() {} }; },
        openEditor: async (o: { instanceId?: string; title: string }) => { opened.push(o); },
      },
      tools: {
        getById: (id: string) => (installed.has(id) ? { state: 'activated' } : undefined),
        installFromDraft: vi.fn(async (d: ExtensionDraft) => { installed.add(String(d.manifest.id)); return { toolId: String(d.manifest.id) }; }),
        setEnabled: vi.fn(async () => {}),
      },
      services: {
        has: (id: { id: string }) => id.id === ILanguageModelToolsService.id,
        get: () => ({ registerTool: (t: typeof tool) => { tool = t; return { dispose() {} }; } }),
      },
    };
    registerExtensionReview(api as never);
    return { api, commands, opened, provider: () => provider!, tool: () => tool! };
  }

  it('a failing draft goes back to the assistant and opens nothing', async () => {
    const s = setup();
    const res = await s.tool().handler({ manifest: good().manifest, files: { 'main.js': `${MAIN}\nfetch('/x')` } });
    expect(res.content).toMatch(/did not pass these checks[\s\S]*Reaches no network/);
    expect(s.opened).toHaveLength(0);
  });

  it('a passing draft opens the review; Install installs and turns it on', async () => {
    const s = setup();
    const res = await s.tool().handler(good() as unknown as Record<string, unknown>);
    expect(res.content).toMatch(/nothing is installed unless the person presses Install/);
    expect(s.opened[0].title).toBe('Review: Recipe Converter');
    const pane = document.body.appendChild(document.createRange().createContextualFragment('<div></div>').firstElementChild as HTMLElement);
    s.provider().createEditorPane(pane, { instanceId: s.opened[0].instanceId });
    expect(pane.textContent).toContain('A new extension, written for you by the AI');
    expect(pane.textContent).toMatch(/Checked against the extension rules: (\d+) of \1 passed/);
    expect(Array.from(pane.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(['Not Now', 'View Code…', 'Install']);
    expect(s.api.tools.installFromDraft).not.toHaveBeenCalled();

    await s.commands.get(EXTENSION_DRAFT_COMMAND)!(s.opened[0].instanceId, 'code');
    expect(Array.from(pane.querySelectorAll('.px-xr__file')).map((f) => f.textContent)).toEqual(['parallx-manifest.json', 'main.js', 'styles.css']);
    expect(pane.querySelectorAll('pre')[1].textContent).toContain('export function activate');
    await s.commands.get(EXTENSION_DRAFT_COMMAND)!(s.opened[0].instanceId, 'install');
    expect(s.api.tools.installFromDraft).toHaveBeenCalledOnce();
    expect(s.api.tools.setEnabled).toHaveBeenCalledWith('assistant.recipes', true);
    expect(pane.textContent).toContain('Installed and turned on, no restart needed');
    expect(pane.querySelectorAll('button')).toHaveLength(0);
  });

  it('Not Now writes nothing; an installed name is not written over', async () => {
    const s = setup();
    await s.tool().handler(good() as unknown as Record<string, unknown>);
    await s.commands.get(EXTENSION_DRAFT_COMMAND)!(s.opened[0].instanceId, 'decline');
    expect(s.api.tools.installFromDraft).not.toHaveBeenCalled();
    await s.tool().handler(good() as unknown as Record<string, unknown>);
    await s.commands.get(EXTENSION_DRAFT_COMMAND)!(s.opened[1].instanceId, 'install');
    await s.tool().handler(good() as unknown as Record<string, unknown>);
    await s.commands.get(EXTENSION_DRAFT_COMMAND)!(s.opened[2].instanceId, 'install');
    expect(s.api.tools.installFromDraft).toHaveBeenCalledOnce();
  });
});

describe('the main process writes a reviewed draft, and only its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'px-draft-'));
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); });
  const handlers = new Map<string, (e: unknown, d: unknown) => Promise<Record<string, unknown>>>();
  createRequire(import.meta.url)('../../electron/extensionDraftBridge.cjs').setupExtensionDraftBridge({ handle: (ch: string, h: never) => handlers.set(ch, h) }, dir);
  const install = (d: unknown) => handlers.get('tools:install-from-draft')!(null, d);

  it('writes the manifest and files, marked as the assistant\'s', async () => {
    const r = await install(good());
    expect(r.error).toBeNull();
    expect(JSON.parse(readFileSync(join(dir, 'assistant.recipes', 'parallx-manifest.json'), 'utf8')).name).toBe('Recipe Converter');
    expect(existsSync(join(dir, 'assistant.recipes', 'main.js'))).toBe(true);
    expect(existsSync(join(dir, 'assistant.recipes', '.parallx-draft'))).toBe(true);
    expect((await install(good())).error).toBeNull();
  });

  it('never writes over another extension, and refuses bad names', async () => {
    mkdirSync(join(dir, 'assistant.recipes'));
    expect(String((await install(good())).error)).toMatch(/already installed/);
    expect(String((await install({ ...good(), files: { 'main.js': 'x', '../x.js': 'y' } })).error)).toMatch(/may not have/);
    expect(String((await install({ ...good(), manifest: { id: '../../evil' } })).error)).toMatch(/no valid id/);
  });
});

describe('the API check: what a real model (qwen3.8) got wrong', () => {
  const surface = { chat: ['registerTool'], commands: ['registerCommand', 'executeCommand'], editors: ['registerEditorProvider', 'openEditor'], canvas: ['registerBlock'], ui: ['createButton', 'createInput'] };
  const withMain = (main: string): ExtensionDraft => ({ manifest: good().manifest, files: { 'main.js': main } });
  const misuse = (main: string) => readExtensionDraft(withMain(main), surface).checks.find((c) => c.rule.startsWith('Calls only the app API'));

  it('registerTool({ name, inputSchema, invoke }) is refused, with the shape it takes', () => {
    const c = misuse("export function activate(api, context) { api.chat.registerTool({ name: 'convertTemperature', invoke() {} }); }");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("api.chat.registerTool takes (name, { description, parameters, handler, requiresConfirmation })");
  });

  it('a function that does not exist (api.editors.open) is refused, naming what does', () => {
    const c = misuse("export function activate(api, context) { api.commands.registerCommand('assistant.recipes.open', () => api.editors.open('x')); }");
    expect(c?.detail).toBe('api.editors.open does not exist (it has registerEditorProvider, openEditor)');
  });

  it('the right shapes pass, whatever activate() calls the API', () => {
    const c = misuse("export function activate(px, context) { px.chat.registerTool('t', { description: 'd', parameters: {}, requiresConfirmation: false, handler: async () => ({ content: '' }) }); px.editors.openEditor({ typeId: 'a', title: 'b' }); }");
    expect(c?.ok).toBe(true);
  });
});

describe('what it adds, with ids built from a constant', () => {
  it('a block and a widget registered with ${ID} ids are listed by their labels', () => {
    const main = "const ID = 'assistant.weekly-tasks';\nexport function activate(api, context) {\n  context.subscriptions.push(api.canvas.registerBlock({ typeId: `${ID}.page`, label: 'Tasks Due This Week', description: 'd', icon: 'calendar', defaultConfig: {}, render() {} }));\n  context.subscriptions.push(api.dashboard.registerWidgetType({ typeId: `${ID}.count`, displayName: 'Tasks Due', category: 'static', defaultSize: { colSpan: 4, rowSpan: 3 }, defaultConfig: {}, createWidget() { return { dispose() {} }; } }));\n}";
    const r = readExtensionDraft({ manifest: good().manifest, files: { 'main.js': main } });
    expect(r.adds).toEqual([{ kind: 'Command', what: 'Convert A Recipe…' }, { kind: 'Page block', what: 'Tasks Due This Week' }, { kind: 'Dashboard widget', what: 'Tasks Due' }]);
  });
});
