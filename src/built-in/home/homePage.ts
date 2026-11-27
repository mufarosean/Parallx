// homePage.ts — Home's page, top to bottom: a greeting by the hour and by
// name, one field to ask the chat, what each tool has for today, and the
// things last worked on. On a workspace with nothing in it the same page
// says Welcome to Parallx and puts the first steps where the work will be.
//
// The page knows no tool: the cards and the things come from what tools
// registered while they run (services/homeSources.ts).

import type { IDisposable } from '../../platform/lifecycle.js';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { collectHomeCards, collectHomeEntries, getHomeCardProviders, getHomeSources, onDidChangeHomeCards, onDidChangeHomeSources, type HomeEntry } from '../../services/homeSources.js';
import { addDisposableListener } from '../../ui/dom.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { createBlock, createButton, createEmptyState, createFilterChip, createIconButton, createInput, createPageHeader, createSectionLabel, createSegmented } from '../../ui/kit.js';
import { drawCard, drawEntry, drawStep, entryKey, type HomeStep } from './homeParts.js';
import { HOME_NAME, homeName, homeWidth, type HomeSettingsRegistry } from './homeSettings.js';

export interface HomePageDeps {
  readonly context: ToolContext;
  readonly settings: HomeSettingsRegistry;
  runCommand(id: string, ...args: unknown[]): Promise<unknown>;
  /** Every command there is now: a first step is offered only when its command exists. */
  commands(): Promise<readonly string[]>;
}

/** What the commands of the page reach (they run on the Home that is open). */
export interface HomePage extends IDisposable {
  openItem(sourceId: string, itemId: string): void;
  pinItem(sourceId: string, itemId: string): void;
  ask(): void;
  /** Reads everything again: the hour and the day may have turned, and "1h ago" goes stale. */
  refresh(): void;
  keepName(): void;
  skipName(): void;
}

type Mode = 'picked' | 'pinned';
type Range = 'week' | 'month' | 'all';
const DAY = 24 * 3600e3;
const RANGE_DAYS: Record<Range, number> = { week: 7, month: 30, all: Infinity };
const PINS_KEY = 'home.pins';
const RANGE_KEY = 'home.range';
const NAME_SKIPPED_KEY = 'home.nameSkipped';
const CHANGE_PAUSE_MS = 160;
const LABEL_ID = 'home-today-label';

const STEPS: readonly HomeStep[] = [
  { id: 'openFolder', label: 'Open a Folder…', icon: 'folder-open', command: 'workspace.openFolder', hint: 'Your files appear in the sidebar and here.' },
  { id: 'newPage', label: 'New Page', icon: 'file-plus', command: 'canvas.newPage', hint: 'A page to write on.' },
  { id: 'tools', label: 'Turn On Tools…', icon: 'blocks', command: 'tools.showInstalled', hint: 'Each tool you turn on adds what it has for today here.' },
];

/** "Good morning", "Good afternoon" or "Good evening", by the hour of the day. */
export function greetingFor(now: Date): string {
  const h = now.getHours();
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "Friday 27 November": the weekday, the day and the month, in words. */
export function dateLine(now: Date): string {
  return `${now.toLocaleDateString('en-US', { weekday: 'long' })} ${now.getDate()} ${now.toLocaleDateString('en-US', { month: 'long' })}`;
}

/** Whether a thing touched at `touchedAt` is inside the range: the last 7 days, the last 30, or any time. */
export function inRange(touchedAt: number, range: Range, now: number): boolean {
  return now - touchedAt <= RANGE_DAYS[range] * DAY;
}

export function renderHome(container: HTMLElement, deps: HomePageDeps): HomePage {
  const { context, settings } = deps;
  const page = createBlock(container, 'div', { className: 'home' });
  const column = createBlock(page, 'div', { className: 'home-column' });
  const head = createBlock(column, 'div', { className: 'home-head' });
  const nameHost = createBlock(column, 'div', { className: 'home-name' });

  // ── The field to ask in ──
  const askRow = createBlock(column, 'div', { className: 'home-ask' });
  askRow.appendChild(createIconElement('sparkles', 16));
  const ask = createInput(askRow, { id: 'home.ask', label: 'Ask your workspace', placeholder: 'Ask your workspace, or say what you want to work on' });
  const askInput = ask.element.querySelector('input') as HTMLInputElement;
  createIconButton(askRow, { id: 'home.send', icon: 'arrow-up', title: 'Send to Chat', command: 'home.ask' });

  // ── Today, from your tools ──
  const today = createBlock(column, 'section', { className: 'home-today' });
  createSectionLabel(today, 'Today, from your tools').id = LABEL_ID;
  const cardList = createBlock(today, 'ul', { className: 'home-cards', attrs: { 'aria-labelledby': LABEL_ID } });

  // ── The first steps of a new workspace ──
  const start = createBlock(column, 'section', { className: 'home-today' });
  createSectionLabel(start, 'Start');
  const stepList = createBlock(start, 'ul', { className: 'home-cards', attrs: { 'aria-label': 'Start' } });

  // ── The feed, under its filter words ──
  const work = createBlock(column, 'section', { className: 'home-work' });
  const filters = createBlock(work, 'div', { className: 'home-filters' });
  let mode: Mode = 'picked';
  const saved = context.workspaceState.get<Range>(RANGE_KEY);
  let range: Range = saved === 'week' || saved === 'month' ? saved : 'all';
  // Which things: each word is a button of its own, so the keys reach "pinned" directly; one of the two is on.
  const modes = createBlock(filters, 'div', { className: 'home-filters__show', attrs: { role: 'group', 'aria-label': 'Show' } });
  const setMode = (to: Mode): void => { mode = to; pickedChip.pressed = to === 'picked'; pinnedChip.pressed = to === 'pinned'; drawFeed(); };
  const pickedChip = createFilterChip(modes, { id: 'home.show.pickedUp', label: 'picked up', pressed: true, title: 'Everything you last worked on, newest first', onToggle: () => setMode('picked') });
  const pinnedChip = createFilterChip(modes, { id: 'home.show.pinned', label: 'pinned', title: 'Only the things you pinned', onToggle: () => setMode('pinned') });
  const rangeSwitch = createSegmented(filters, {
    id: 'home.range', ariaLabel: 'From', value: range,
    items: [{ value: 'week', label: 'this week' }, { value: 'month', label: 'this month' }, { value: 'all', label: 'all' }],
    onChange: (v) => { range = v === 'week' || v === 'month' ? v : 'all'; void context.workspaceState.update(RANGE_KEY, range); drawFeed(); },
  });
  const feed = createBlock(work, 'ul', { className: 'home-feed', attrs: { 'aria-label': 'Your work' } });

  let all: HomeEntry[] = [];
  let loaded = false;
  let run = 0;
  let pins = new Set(context.workspaceState.get<string[]>(PINS_KEY) ?? []);
  let nameField: ReturnType<typeof createInput> | undefined;
  const isNew = (): boolean => loaded && all.length === 0;

  const drawHead = (): void => {
    head.replaceChildren();
    nameField?.dispose();
    nameField = undefined;
    nameHost.replaceChildren();
    if (!loaded) return;
    const now = new Date();
    const name = homeName(settings);
    const fresh = isNew();
    const says = fresh ? 'Welcome to ' : name ? `${greetingFor(now)}, ` : greetingFor(now);
    const sub = fresh ? 'This workspace is empty. Start with any of these; the page fills in as you work.'
      : all.length ? `${dateLine(now)}. You left off on ${all[0].item.title || 'Untitled'}.` : `${dateLine(now)}.`;
    const header = createPageHeader(head, { title: says, subtitle: sub, front: true });
    const italic = fresh ? 'Parallx' : name;
    if (italic) createBlock(header.querySelector('h1'), 'em', { text: italic });

    // Asked once: answered it is a setting, declined it is not asked again.
    if (fresh || name || context.globalState.get<boolean>(NAME_SKIPPED_KEY)) return;
    createBlock(nameHost, 'span', { className: 'home-name__question', text: 'What should Home call you?' });
    nameField = createInput(nameHost, { id: 'home.name', label: 'What should Home call you?', placeholder: 'Your name' });
    createButton(nameHost, { id: 'home.keepName', label: 'Keep', size: 'sm', command: 'home.keepName' });
    createButton(nameHost, { id: 'home.skipName', label: 'Not Now', size: 'sm', kind: 'ghost', command: 'home.skipName' });
  };

  let cardRun = 0;
  const loadCards = async (): Promise<void> => {
    const mine = ++cardRun;
    const cards = await collectHomeCards();
    if (mine !== cardRun) return; // a newer read is on its way
    // The keys stay on the card's action when its number changes under them.
    const at = document.activeElement instanceof HTMLElement && cardList.contains(document.activeElement) ? Array.from(cardList.children).indexOf(document.activeElement.closest('li') as Element) : -1;
    cardList.replaceChildren();
    cards.forEach((card, i) => drawCard(cardList, card, i === 0));
    today.hidden = cards.length === 0;
    if (at >= 0) (cardList.children[Math.min(at, cards.length - 1)]?.querySelector('button') as HTMLElement | null)?.focus();
  };

  const shown = (): HomeEntry[] => {
    const now = Date.now();
    return all.filter((e) => inRange(e.item.touchedAt, range, now) && (mode === 'picked' || pins.has(entryKey(e))));
  };

  const drawFeed = (): void => {
    const fresh = isNew();
    start.hidden = !fresh;
    work.hidden = fresh || !loaded;
    // The keys stay where they were: on the same thing's title or its pin.
    const at = document.activeElement instanceof HTMLElement && feed.contains(document.activeElement) ? document.activeElement : null;
    const atKey = at?.closest('[data-key]')?.getAttribute('data-key');
    const atPin = !!at?.classList.contains('home-entry__pin');
    feed.replaceChildren();
    const list = shown();
    for (const entry of list) drawEntry(feed, entry, pins.has(entryKey(entry)));
    if (!list.length && !fresh) {
      createEmptyState(createBlock(feed, 'li', { className: 'home-feed__none' }), mode === 'pinned'
        ? { headline: 'Nothing pinned', hint: 'Pin a thing from its entry to keep it here.' }
        : { headline: 'Nothing in this range', hint: 'Choose a longer range to see older work.' });
    }
    if (atKey) {
      const li = Array.from(feed.children).find((c) => c.getAttribute('data-key') === atKey);
      (li?.querySelector(atPin ? '.home-entry__pin' : '.home-entry__title') as HTMLElement | null)?.focus();
    }
  };

  const applyWidth = (): void => { column.setAttribute('data-width', homeWidth(settings)); };

  const load = async (again = false): Promise<void> => {
    const mine = ++run;
    const [entries, commands] = await Promise.all([collectHomeEntries(''), deps.commands().catch((): readonly string[] => [])]);
    if (mine !== run) return; // a newer read is on its way
    stepList.replaceChildren();
    for (const step of STEPS) if (commands.includes(step.command)) drawStep(stepList, step);
    const wasNew = isNew();
    const first = !loaded;
    const leftOff = all[0] ? entryKey(all[0]) : '';
    all = entries;
    loaded = true;
    if (first || again || wasNew !== isNew() || leftOff !== (all[0] ? entryKey(all[0]) : '')) drawHead();
    drawFeed();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), CHANGE_PAUSE_MS); };
  const listeners: IDisposable[] = [];
  // Sources come and go with their tools, and say when their things changed.
  const followSources = (): void => {
    for (const d of listeners.splice(0)) d.dispose();
    for (const s of getHomeSources()) { const d = s.onDidChange?.(soon); if (d) listeners.push(d); }
  };
  const cardListeners: IDisposable[] = [];
  const followCards = (): void => {
    for (const d of cardListeners.splice(0)) d.dispose();
    for (const p of getHomeCardProviders()) { const d = p.onDidChange?.(() => void loadCards()); if (d) cardListeners.push(d); }
  };
  const subscriptions: IDisposable[] = [
    onDidChangeHomeSources(() => { followSources(); void load(); }),
    onDidChangeHomeCards(() => { followCards(); void loadCards(); }),
    settings.onDidChange((e) => { if (e.key === HOME_NAME) drawHead(); else applyWidth(); }),
    addDisposableListener(askInput, 'keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); api.ask(); } }),
    addDisposableListener(nameHost, 'keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.target instanceof HTMLInputElement) { e.preventDefault(); api.keepName(); } }),
  ];

  const api: HomePage = {
    openItem(sourceId, itemId) {
      all.find((e) => e.source.id === sourceId && e.item.id === itemId)?.item.open();
    },
    pinItem(sourceId, itemId) {
      const key = `${sourceId}\n${itemId}`;
      pins = new Set(pins);
      if (!pins.delete(key)) pins.add(key);
      void context.workspaceState.update(PINS_KEY, [...pins]);
      drawFeed();
    },
    ask() {
      const text = ask.value.trim();
      if (!text) return;
      ask.value = '';
      // The chat takes it as a question asked; when its panel is not up yet, the words wait in its field.
      void deps.runCommand('chat.submitPrompt', { text }).catch(() => deps.runCommand('chat.stagePrompt', { text }).catch(() => { ask.value = text; }));
    },
    refresh() {
      // Not while the name is being typed: the head is drawn again and would take the field with it.
      void load(!nameHost.contains(document.activeElement));
      void loadCards();
    },
    keepName() {
      const name = nameField?.value.trim();
      if (name) void settings.setValue(HOME_NAME, name);
    },
    skipName() {
      void context.globalState.update(NAME_SKIPPED_KEY, true);
      drawHead();
      askInput.focus();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      run++;
      cardRun++;
      for (const d of [...subscriptions, ...listeners, ...cardListeners]) d.dispose();
      nameField?.dispose();
      ask.dispose();
      rangeSwitch.dispose();
      page.remove();
    },
  };

  // Coming back to the tab is coming back to Home: what it says is read again.
  let seen = true;
  const watcher = new IntersectionObserver((records) => {
    const now = records.some((r) => r.isIntersecting);
    if (now && !seen) api.refresh();
    seen = now;
  });
  watcher.observe(page);
  subscriptions.push({ dispose: () => watcher.disconnect() });

  applyWidth();
  today.hidden = true;
  drawFeed();
  followSources();
  followCards();
  void loadCards();
  void load();
  return api;
}
