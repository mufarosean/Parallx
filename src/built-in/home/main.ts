// Home — one front door for everything recent.
//
// A page, opened from the Parallx icon in the title bar: a search field,
// a chip per tool and per tag, and every tool's recent items as one stream,
// newest first, as cards or as a list. Home knows no tool by name; each
// item comes from a source a tool registered while it runs
// (services/homeSources.ts). A tool that is off contributes nothing, so its
// chip and its items are simply absent.

import './home.css';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { collectHomeEntries, getHomeSources, onDidChangeHomeSources, type HomeEntry } from '../../services/homeSources.js';
import { addDisposableListener } from '../../ui/dom.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { formatRelativeTime } from '../../ui/relativeTime.js';
import { createBlock, createButton, createEmptyState, createFilterChip, createInput, createSegmented, sceneSlug } from '../../ui/kit.js';

interface ParallxApi {
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
  commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable };
}

type Layout = 'cards' | 'list';
const LAYOUT_KEY = 'home.layout';
const TYPING_PAUSE_MS = 160;
const MAX_TAG_CHIPS = 8;

/** What the page last drew, so `home.openItem` can open one by its ids. */
let _shown: readonly HomeEntry[] = [];

export function activate(api: ParallxApi, context: ToolContext): void {
  context.subscriptions.push(api.editors.registerEditorProvider('home', {
    createEditorPane: (container) => renderHome(container, context),
  }));
  context.subscriptions.push(api.commands.registerCommand('home.open', () =>
    api.editors.openEditor({ typeId: 'home', title: 'Home', icon: 'px-mark', instanceId: 'home' })));
  context.subscriptions.push(api.commands.registerCommand('home.openItem', (sourceId, itemId) => {
    _shown.find((e) => e.source.id === sourceId && e.item.id === itemId)?.item.open();
  }));
}

export function deactivate(): void {
  _shown = [];
}

function renderHome(container: HTMLElement, context: ToolContext): IDisposable {
  const page = createBlock(container, 'div', { className: 'home' });
  const column = createBlock(page, 'div', { className: 'home-column' });

  const search = createInput(createBlock(column, 'div', { className: 'home-search' }), {
    id: 'home.search', label: 'Search everything', placeholder: 'Search pages, files and everything your tools keep',
  });
  const input = search.element.querySelector('input') as HTMLInputElement;
  search.element.prepend(createIconElement('search', 16));

  const sourceChips = createBlock(column, 'div', { className: 'home-chips', attrs: { role: 'group', 'aria-label': 'Show only' } });
  const tagChips = createBlock(column, 'div', { className: 'home-chips', attrs: { role: 'group', 'aria-label': 'Tags' } });
  const bar = createBlock(column, 'div', { className: 'home-bar' });
  const heading = createBlock(bar, 'span', { className: 'home-heading', attrs: { role: 'status' } });
  let layout: Layout = context.workspaceState.get<Layout>(LAYOUT_KEY) === 'list' ? 'list' : 'cards';
  createSegmented(bar, {
    id: 'home.layout', ariaLabel: 'Layout', value: layout,
    items: [{ value: 'cards', label: 'Cards' }, { value: 'list', label: 'List' }],
    onChange: (v) => { layout = v === 'list' ? 'list' : 'cards'; void context.workspaceState.update(LAYOUT_KEY, layout); draw(); },
  });
  const body = createBlock(column, 'div', { className: 'home-body' });

  let all: HomeEntry[] = [];
  let sourceId = '';
  let tag = '';
  let run = 0;

  const draw = (): void => {
    const shown = all.filter((e) => (!sourceId || e.source.id === sourceId) && (!tag || !!e.item.tags?.includes(tag)));
    _shown = shown;
    const filtered = !!(input.value.trim() || sourceId || tag);
    heading.textContent = filtered ? `${shown.length} found` : 'Recent';

    // A chip per source that has something to show, and the commonest tags.
    sourceChips.replaceChildren();
    const sources = getHomeSources().filter((s) => all.some((e) => e.source === s));
    if (sources.length > 1) {
      createFilterChip(sourceChips, { id: 'home.source.everything', label: 'Everything', count: all.length, pressed: !sourceId, onToggle: () => { sourceId = ''; draw(); } });
      for (const s of sources) {
        createFilterChip(sourceChips, { id: `home.source.${sceneSlug(s.id)}`, label: s.label, count: all.filter((e) => e.source === s).length, pressed: sourceId === s.id, onToggle: (on) => { sourceId = on ? s.id : ''; draw(); } });
      }
    }
    tagChips.replaceChildren();
    const counts = new Map<string, number>();
    for (const e of all) for (const t of e.item.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [t] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAG_CHIPS)) {
      createFilterChip(tagChips, { id: `home.tag.${sceneSlug(t)}`, label: `#${t}`, pressed: tag === t, onToggle: (on) => { tag = on ? t : ''; draw(); } });
    }

    body.replaceChildren();
    body.className = `home-body home-body--${layout}`;
    if (!shown.length) {
      createEmptyState(body, filtered
        ? { headline: 'Nothing matches', hint: 'Clear the search or a chip to see everything again.' }
        : { headline: 'Nothing recent yet', hint: 'Pages you write and files you open show up here, with whatever your tools keep.' });
      return;
    }
    for (const entry of shown) drawItem(body, entry, layout);
  };

  const load = async (): Promise<void> => {
    const mine = ++run;
    const entries = await collectHomeEntries(input.value);
    if (mine !== run) return; // a newer query is on its way
    all = entries;
    if (sourceId && !all.some((e) => e.source.id === sourceId)) sourceId = '';
    if (tag && !all.some((e) => e.item.tags?.includes(tag))) tag = '';
    draw();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), TYPING_PAUSE_MS); };
  const listeners: IDisposable[] = [addDisposableListener(input, 'input', soon)];
  // Sources come and go with their tools, and say when their recents changed.
  const followSources = (): void => {
    for (const d of listeners.splice(1)) d.dispose();
    for (const s of getHomeSources()) { const d = s.onDidChange?.(soon); if (d) listeners.push(d); }
  };
  const sourcesChanged = onDidChangeHomeSources(() => { followSources(); soon(); });
  followSources();
  void load();

  return {
    dispose() {
      if (timer) clearTimeout(timer);
      run++;
      sourcesChanged.dispose();
      for (const d of listeners) d.dispose();
      search.dispose();
      page.remove();
    },
  };
}

/** One item, as a card or a list row: a button that opens it. */
function drawItem(host: HTMLElement, entry: HomeEntry, layout: Layout): void {
  const { source, item } = entry;
  const when = formatRelativeTime(item.touchedAt, 'short');
  const button = createButton(host, {
    id: `home.item.${sceneSlug(`${source.id} ${item.id}`)}`, label: item.title, icon: item.icon ?? 'file', kind: 'ghost',
    command: 'home.openItem', args: [source.id, item.id],
  });
  button.className = layout === 'cards' ? 'home-card' : 'home-row';
  button.replaceChildren();
  button.setAttribute('aria-label', `${item.title}, ${item.kind}, ${source.label}, ${when}`);

  const kindLine = createBlock(button, 'span', { className: 'home-item-kind' });
  if (item.icon) kindLine.appendChild(createIconElement(item.icon, 14));
  createBlock(kindLine, 'span', { text: `${item.kind} · ${source.label}` });
  createBlock(button, 'span', { className: 'home-item-title', text: item.title || 'Untitled' });
  createBlock(button, 'span', { className: 'home-item-summary', text: item.summary ?? '' });
  const tags = createBlock(button, 'span', { className: 'home-item-tags' });
  for (const t of (item.tags ?? []).slice(0, 4)) createBlock(tags, 'span', { text: `#${t}` });
  if (layout === 'cards' && item.where) createBlock(button, 'span', { className: 'home-item-where', text: item.where });
  createBlock(button, 'span', { className: 'home-item-when', text: when });
}
