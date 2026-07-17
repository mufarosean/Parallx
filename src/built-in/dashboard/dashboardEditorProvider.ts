// dashboardEditorProvider.ts — editor provider + pane for `typeId: 'dashboard'`.
//
// Each editor pane represents one dashboard page. The pane owns:
//   - The 12-column grid host
//   - The page chrome (title bar, edit-mode toggle, "+ Add widget" button)
//   - Widget instance lifecycle (instantiate from DB → render → handle config /
//     refresh / remove)
//   - Drag-to-move + drag-to-resize in edit mode
//   - The "Add widget" picker overlay
//   - The settings drawer overlay
//
// Phase 1 ships with the grid + chrome + empty state. Widgets land in
// Phase 2 (clock-and-links), refresh in Phase 3, AI in Phase 4. The pane
// is built so each phase plugs in without restructuring this file.

import type { IDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { DashboardDataService } from './dashboardDataService.js';
import type { DashboardWidgetRegistry } from './dashboardWidgetRegistry.js';
import type { DashboardRefreshScheduler } from './dashboardRefreshScheduler.js';
import {
  DASHBOARD_GRID_COLS,
  type DashboardWidgetRow,
  type WidgetAppearance,
  type WidgetContext,
  type WidgetHandle,
  type WidgetPlacement,
  type WidgetTypeRegistration,
} from './dashboardTypes.js';
import { renderMarkdownToDom } from './widgets/markdownRenderer.js';
import { ILinkResolverService } from '../../links/linkResolverService.js';
import { WIDGET_TEMPLATES } from './widgetTemplates.js';

// ─── Minimal local API shape (avoids cross-tool import) ──────────────────────

interface DashboardEditorInput {
  readonly id: string;          // === pageId
  setName?(name: string): void;
  setIconHtml?(html: string | undefined): void;
}

interface DashboardApiSurface {
  editors: {
    openFileEditor?(uri: string, options?: { pinned?: boolean }): Promise<void>;
    focusEditor?(editorId: string): Promise<boolean>;
  };
  commands: {
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  window: {
    showInputBox?(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
  // DI access, so widgets can resolve cross-tool services (e.g. the notes
  // widget hosting a canvas page via ICanvasDataService).
  services?: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function isHexColor(v: string | null): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Resize handle direction — cardinal edges + corners. */
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface SelectOption { value: string; label: string; }
interface CustomSelect {
  el: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
}

/**
 * A fully self-styled dropdown. Native <select> popups render with OS chrome
 * that CSS cannot reach, so we build a trigger button plus a fixed-positioned
 * popup list that matches the Parallx surface.
 */
function createSelect(options: SelectOption[], initial: string, onChange: (value: string) => void): CustomSelect {
  let value = initial;

  const wrap = el('div', 'dashboard-select');
  const trigger = el('button', 'dashboard-select__trigger');
  trigger.type = 'button';
  const labelSpan = el('span', 'dashboard-select__label');
  trigger.appendChild(labelSpan);
  const chevron = el('span', 'dashboard-select__chevron');
  chevron.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  trigger.appendChild(chevron);
  wrap.appendChild(trigger);

  const labelFor = (v: string) => options.find(o => o.value === v)?.label ?? '';
  const syncLabel = () => { labelSpan.textContent = labelFor(value); };
  syncLabel();

  let popup: HTMLElement | null = null;

  const close = () => {
    if (!popup) return;
    popup.remove();
    popup = null;
    wrap.classList.remove('dashboard-select--open');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
  };

  const onOutside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!popup?.contains(t) && !wrap.contains(t)) close();
  };

  const open = () => {
    if (popup) { close(); return; }
    popup = el('div', 'dashboard-select__popup');
    for (const opt of options) {
      const item = el('button', 'dashboard-select__option');
      item.type = 'button';
      item.textContent = opt.label;
      if (opt.value === value) item.classList.add('dashboard-select__option--active');
      item.addEventListener('click', () => {
        value = opt.value;
        syncLabel();
        close();
        onChange(value);
      });
      popup.appendChild(item);
    }
    const rect = trigger.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.width = `${rect.width}px`;
    document.body.appendChild(popup);
    wrap.classList.add('dashboard-select--open');
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  };

  trigger.addEventListener('click', open);

  return {
    el: wrap,
    getValue: () => value,
    setValue: (v: string) => { value = v; syncLabel(); },
  };
}

const DASHBOARD_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';

// ─── Provider ────────────────────────────────────────────────────────────────

export class DashboardEditorProvider {
  constructor(
    private readonly _data: DashboardDataService,
    private readonly _registry: DashboardWidgetRegistry,
    private readonly _scheduler: DashboardRefreshScheduler,
    private readonly _api: DashboardApiSurface,
  ) {}

  createEditorPane(container: HTMLElement, input?: DashboardEditorInput): IDisposable {
    const pane = new DashboardEditorPane(
      container,
      input,
      this._data,
      this._registry,
      this._scheduler,
      this._api,
    );
    pane.init().catch(err => {
      console.error('[DashboardEditorProvider] pane init failed:', err);
    });
    return pane;
  }
}

// ─── Pane ────────────────────────────────────────────────────────────────────

class DashboardEditorPane implements IDisposable {
  private readonly _container: HTMLElement;
  private _root: HTMLElement | null = null;
  private _gridEl: HTMLElement | null = null;
  private _emptyEl: HTMLElement | null = null;
  private _pageId: string;
  private _disposed = false;
  private _disposables: IDisposable[] = [];

  /** Per-widget runtime state, keyed by widgetId. */
  private readonly _instances = new Map<string, {
    row: DashboardWidgetRow;
    typeReg: WidgetTypeRegistration<unknown> | undefined;
    cardEl: HTMLElement;
    bodyEl: HTMLElement;
    handle: WidgetHandle | null;
    configEmitter: Emitter<unknown>;
  }>();

  constructor(
    container: HTMLElement,
    private readonly _input: DashboardEditorInput | undefined,
    private readonly _data: DashboardDataService,
    private readonly _registry: DashboardWidgetRegistry,
    private readonly _scheduler: DashboardRefreshScheduler,
    private readonly _api: DashboardApiSurface,
  ) {
    this._container = container;
    this._pageId = _input?.id ?? '';
  }

  async init(): Promise<void> {
    if (this._disposed) return;

    // Resolve / create page.
    let page = this._pageId ? await this._data.getPage(this._pageId) : null;
    if (!page) page = await this._data.ensureDefaultPage();
    this._pageId = page.id;

    // Restore tab label + icon — same restore-on-open pattern as canvas pane,
    // because iconHtml isn't persisted by the editor input deserializer.
    this._input?.setName?.(page.name || 'Dashboard');
    this._input?.setIconHtml?.(DASHBOARD_ICON_SVG);

    // Build chrome + grid.
    this._buildShell(page.name);
    this._restorePaneHeaderState(page.headerHidden);
    await this._renderAllWidgets();

    // Subscribe to data changes (widget add / remove / config edits etc.)
    this._disposables.push(this._data.onDidChange((e) => {
      if (this._disposed) return;
      if (e.pageId && e.pageId !== this._pageId) return;
      void this._reconcile(e.kind, e.widgetId);
    }));

    // Registry changed mid-session (extension activated / deactivated /
    // re-registered): live placeholder ⇄ widget swap. Re-mount any mounted
    // instance whose type registration object changed, so a late-activating
    // contributor upgrades its placeholders without reopening the page and a
    // deactivated one degrades to placeholders instead of dangling renderers.
    this._disposables.push(this._registry.onDidChange(() => {
      if (this._disposed) return;
      for (const [id, inst] of [...this._instances]) {
        const current = this._registry.getWidgetType(inst.row.widgetTypeId);
        if (current !== inst.typeReg) {
          void this._remountWidget(id);
        }
      }
    }));

    // Command-side hooks (AI-invocable commands fire DOM events the active
    // pane reacts to). We only respond if our root is connected — multiple
    // dashboards open simultaneously each install these but only the focused
    // one is in the DOM.
    const onAdd = () => { if (this._root?.isConnected) void this._openWidgetPicker(); };
    const onRefreshAll = () => {
      if (!this._root?.isConnected) return;
      for (const id of this._instances.keys()) void this._triggerManualRefresh(id);
    };
    document.addEventListener('parallx.dashboard.addWidget', onAdd);
    document.addEventListener('parallx.dashboard.refreshAll', onRefreshAll);
    this._disposables.push({
      dispose() {
        document.removeEventListener('parallx.dashboard.addWidget', onAdd);
        document.removeEventListener('parallx.dashboard.refreshAll', onRefreshAll);
      },
    });
  }

  // ── Shell ──────────────────────────────────────────────────────────────

  private _buildShell(pageName: string): void {
    this._container.innerHTML = '';
    this._container.classList.add('dashboard-pane-host');

    const root = el('div', 'dashboard-pane');
    this._root = root;

    // Header — title + actions only. No standalone icon, no date subline
    // (the clock-and-links widget owns the date if the user wants one).
    // Header can be collapsed via the chevron; when collapsed, hovering
    // the top edge reveals a slim floating action strip so the user can
    // still reach Add widget / Edit layout / re-expand.
    const header = el('header', 'dashboard-header');
    header.dataset.role = 'pane-header';

    const titleEl = el('h1', 'dashboard-header__title');
    titleEl.textContent = pageName;
    titleEl.title = 'Click to rename';
    titleEl.addEventListener('click', () => void this._promptRename());
    header.appendChild(titleEl);

    const actions = el('div', 'dashboard-header__actions');

    const addBtn = el('button', 'dashboard-btn dashboard-btn--primary');
    addBtn.type = 'button';
    addBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add widget</span>';
    addBtn.addEventListener('click', () => void this._openWidgetPicker());
    actions.appendChild(addBtn);

    // Refresh all (M86 C4): one click refreshes every widget on the page.
    // Query/static widgets run in parallel; AI widgets fan out to background
    // agents through the scheduler's admission queue (concurrency-capped) —
    // the chat panel is never touched.
    const refreshAllBtn = el('button', 'dashboard-btn dashboard-btn--ghost');
    refreshAllBtn.type = 'button';
    refreshAllBtn.title = 'Refresh every widget on this page';
    refreshAllBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Refresh all</span>';
    refreshAllBtn.addEventListener('click', () => {
      for (const id of this._instances.keys()) void this._triggerManualRefresh(id);
    });
    actions.appendChild(refreshAllBtn);

    // Page schedule (M86 C4): "refresh this whole page on a schedule" —
    // runs headlessly whether or not the page is open.
    const scheduleBtn = el('button', 'dashboard-btn dashboard-btn--ghost dashboard-btn--icon-only');
    scheduleBtn.type = 'button';
    scheduleBtn.title = 'Schedule automatic refresh for this page';
    scheduleBtn.dataset.role = 'page-schedule';
    scheduleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    scheduleBtn.addEventListener('click', () => void this._openScheduleEditor(scheduleBtn));
    actions.appendChild(scheduleBtn);

    const collapseBtn = el('button', 'dashboard-btn dashboard-btn--ghost dashboard-btn--icon-only');
    collapseBtn.type = 'button';
    collapseBtn.title = 'Hide header';
    collapseBtn.dataset.role = 'header-collapse';
    collapseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
    collapseBtn.addEventListener('click', () => this._togglePaneHeader());
    actions.appendChild(collapseBtn);

    header.appendChild(actions);
    root.appendChild(header);

    // Reveal strip — visible only when the header is collapsed; hovering
    // it slides the action toolbar back in so the user can re-expand.
    const reveal = el('div', 'dashboard-reveal');
    reveal.dataset.role = 'pane-reveal';
    const revealActions = el('div', 'dashboard-reveal__actions');

    const revealAdd = el('button', 'dashboard-btn dashboard-btn--primary dashboard-btn--small');
    revealAdd.type = 'button';
    revealAdd.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add widget</span>';
    revealAdd.addEventListener('click', () => void this._openWidgetPicker());
    revealActions.appendChild(revealAdd);

    const revealExpand = el('button', 'dashboard-btn dashboard-btn--ghost dashboard-btn--small dashboard-btn--icon-only');
    revealExpand.type = 'button';
    revealExpand.title = 'Show header';
    revealExpand.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    revealExpand.addEventListener('click', () => this._togglePaneHeader());
    revealActions.appendChild(revealExpand);

    reveal.appendChild(revealActions);
    root.appendChild(reveal);

    // Grid host
    const gridWrap = el('div', 'dashboard-grid-wrap');
    const grid = el('div', 'dashboard-grid');
    grid.style.setProperty('--dashboard-cols', String(DASHBOARD_GRID_COLS));
    gridWrap.appendChild(grid);
    this._gridEl = grid;

    // Empty state lives inside gridWrap so it follows the same width
    const empty = el('div', 'dashboard-empty');
    empty.innerHTML = `
      <div class="dashboard-empty__art">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1"/>
          <rect x="14" y="3" width="7" height="5" rx="1"/>
          <rect x="14" y="12" width="7" height="9" rx="1"/>
          <rect x="3" y="16" width="7" height="5" rx="1"/>
        </svg>
      </div>
      <h2 class="dashboard-empty__title">Make this yours</h2>
      <p class="dashboard-empty__body">Add widgets to see your workspace at a glance — recent files, news briefs, the time, anything tools contribute.</p>
    `;
    const emptyAddBtn = el('button', 'dashboard-btn dashboard-btn--primary dashboard-empty__cta');
    emptyAddBtn.type = 'button';
    emptyAddBtn.textContent = 'Add your first widget';
    emptyAddBtn.addEventListener('click', () => void this._openWidgetPicker());
    empty.appendChild(emptyAddBtn);
    gridWrap.appendChild(empty);
    this._emptyEl = empty;

    root.appendChild(gridWrap);

    this._container.appendChild(root);
  }

  // ── Pane header collapse ───────────────────────────────────────────────

  private _togglePaneHeader(): void {
    const root = this._root;
    if (!root) return;
    const next = !root.classList.contains('dashboard-pane--header-hidden');
    root.classList.toggle('dashboard-pane--header-hidden', next);
    // Persist in the workspace DB (travels with the workspace, survives
    // relaunch) — not renderer localStorage, which M53 treats as legacy and
    // does not migrate for unprefixed keys.
    void this._data.setPageHeaderHidden(this._pageId, next).catch((err) => {
      console.error('[Dashboard] setPageHeaderHidden failed:', err);
    });
  }

  private _restorePaneHeaderState(hidden: boolean): void {
    const root = this._root;
    if (!root) return;
    if (hidden) root.classList.add('dashboard-pane--header-hidden');
  }

  // ── Page schedule editor (M86 C4) ──────────────────────────────────────

  /**
   * Compact popover to set the page's headless refresh schedule.
   * Preset-first (off / hourly / every 4h / daily / weekdays) with a raw
   * cron field for power users. Daily/weekday times are entered in LOCAL
   * time and converted to UTC (the cron evaluator runs in UTC). Note: for
   * times where the UTC date differs from the local date, weekday schedules
   * shift by a day at the boundary — acceptable for the target use
   * ("weekdays 7:00"-style morning schedules).
   */
  private async _openScheduleEditor(anchor: HTMLElement): Promise<void> {
    document.querySelector('.dashboard-schedule-pop')?.remove();
    const page = await this._data.getPage(this._pageId);
    const current = page?.refreshPolicy ?? null;

    const pop = el('div', 'dashboard-schedule-pop');
    const title = el('div', 'dashboard-schedule-pop__title');
    title.textContent = 'Refresh this page automatically';
    pop.appendChild(title);

    const select = document.createElement('select');
    select.className = 'dashboard-schedule-pop__select';
    const options: { value: string; label: string }[] = [
      { value: 'off', label: 'Off' },
      { value: 'hourly', label: 'Every hour' },
      { value: 'every4h', label: 'Every 4 hours' },
      { value: 'daily', label: 'Daily at…' },
      { value: 'weekdays', label: 'Weekdays at…' },
      { value: 'cron', label: 'Custom cron…' },
    ];
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    }
    pop.appendChild(select);

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = '07:00';
    timeInput.className = 'dashboard-schedule-pop__time';
    pop.appendChild(timeInput);

    const cronInput = document.createElement('input');
    cronInput.type = 'text';
    cronInput.placeholder = '0 12 * * 1-5  (5-field cron, UTC)';
    cronInput.className = 'dashboard-schedule-pop__cron';
    pop.appendChild(cronInput);

    const hint = el('div', 'dashboard-schedule-pop__hint');
    pop.appendChild(hint);

    // Initial state from the persisted policy.
    if (!current) {
      select.value = 'off';
    } else if (current.kind === 'interval') {
      select.value = current.ms === 4 * 3_600_000 ? 'every4h' : 'hourly';
    } else if (current.kind === 'cron') {
      // Try to recognise our own daily/weekday shapes; otherwise show raw.
      const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/.exec(current.cron.trim());
      if (m) {
        const local = new Date();
        local.setUTCHours(parseInt(m[2], 10), parseInt(m[1], 10), 0, 0);
        timeInput.value = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
        select.value = m[3] === '1-5' ? 'weekdays' : 'daily';
      } else {
        select.value = 'cron';
        cronInput.value = current.cron;
      }
    }

    const syncVisibility = (): void => {
      const v = select.value;
      timeInput.style.display = v === 'daily' || v === 'weekdays' ? '' : 'none';
      cronInput.style.display = v === 'cron' ? '' : 'none';
      hint.textContent =
        v === 'off' ? 'Widgets only refresh manually or on their own schedules.'
        : v === 'cron' ? 'Standard 5-field cron, evaluated in UTC.'
        : v === 'daily' || v === 'weekdays' ? 'Local time. AI widgets run as background agents.'
        : 'AI widgets run as background agents; the chat is never opened.';
    };
    syncVisibility();
    select.addEventListener('change', syncVisibility);

    const row = el('div', 'dashboard-schedule-pop__actions');
    const save = el('button', 'dashboard-btn dashboard-btn--primary');
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      let policy: import('./dashboardTypes.js').WidgetRefreshPolicy | null = null;
      const v = select.value;
      if (v === 'hourly') policy = { kind: 'interval', ms: 3_600_000 };
      else if (v === 'every4h') policy = { kind: 'interval', ms: 4 * 3_600_000 };
      else if (v === 'daily' || v === 'weekdays') {
        const [hh, mm] = (timeInput.value || '07:00').split(':').map((s) => parseInt(s, 10));
        const local = new Date();
        local.setHours(hh || 7, mm || 0, 0, 0);
        policy = {
          kind: 'cron',
          cron: `${local.getUTCMinutes()} ${local.getUTCHours()} * * ${v === 'weekdays' ? '1-5' : '*'}`,
        };
      } else if (v === 'cron') {
        const cron = cronInput.value.trim();
        if (cron) policy = { kind: 'cron', cron };
      }
      try {
        await this._data.setPageRefreshPolicy(this._pageId, policy);
        pop.remove();
      } catch (err) {
        hint.textContent = err instanceof Error ? err.message : String(err);
      }
    });
    row.appendChild(save);
    const cancel = el('button', 'dashboard-btn dashboard-btn--ghost');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => pop.remove());
    row.appendChild(cancel);
    pop.appendChild(row);

    // Anchor under the button; dismiss on outside click.
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    document.body.appendChild(pop);
    const dismiss = (e: MouseEvent): void => {
      if (!pop.contains(e.target as Node) && e.target !== anchor) {
        pop.remove();
        document.removeEventListener('mousedown', dismiss, true);
      }
    };
    document.addEventListener('mousedown', dismiss, true);
  }

  // ── Rename flow ────────────────────────────────────────────────────────

  private async _promptRename(): Promise<void> {
    if (!this._api.window.showInputBox) return;
    const page = await this._data.getPage(this._pageId);
    const next = await this._api.window.showInputBox({
      prompt: 'Rename dashboard',
      value: page?.name ?? '',
      placeholder: 'Dashboard',
    });
    if (next && next.trim() && next !== page?.name) {
      await this._data.renamePage(this._pageId, next.trim());
      this._input?.setName?.(next.trim());
      const titleEl = this._root?.querySelector('.dashboard-header__title') as HTMLElement | null;
      if (titleEl) titleEl.textContent = next.trim();
    }
  }

  // ── Widget rendering ───────────────────────────────────────────────────

  private async _renderAllWidgets(): Promise<void> {
    if (!this._gridEl) return;
    this._gridEl.innerHTML = '';

    // Dispose previous instances first.
    for (const inst of this._instances.values()) {
      try { inst.handle?.dispose(); } catch { /* noop */ }
      inst.configEmitter.dispose();
      this._scheduler.cancel(inst.row.id);
    }
    this._instances.clear();

    const rows = await this._data.listWidgets(this._pageId);
    if (rows.length === 0) {
      this._setEmptyState(true);
      return;
    }
    this._setEmptyState(false);

    for (const row of rows) {
      this._mountWidget(row);
    }
  }

  private _setEmptyState(empty: boolean): void {
    if (!this._emptyEl || !this._gridEl) return;
    this._emptyEl.classList.toggle('dashboard-empty--hidden', !empty);
    this._gridEl.classList.toggle('dashboard-grid--hidden', empty);
  }

  private _mountWidget(row: DashboardWidgetRow): void {
    if (!this._gridEl) return;
    const typeReg = this._registry.getWidgetType(row.widgetTypeId);

    // Card chrome
    const card = el('article', 'dashboard-widget');
    card.dataset.widgetId = row.id;
    card.dataset.typeId = row.widgetTypeId;
    // Chrome preset (card | minimal | bare) drives background, header, and
    // footer visibility via CSS. Defaults to full 'card' chrome.
    card.dataset.chrome = typeReg?.chromeStyle ?? 'card';
    card.style.gridRow = `${row.placement.row + 1} / span ${row.placement.rowSpan}`;
    card.style.gridColumn = `${row.placement.col + 1} / span ${row.placement.colSpan}`;
    this._applyAppearance(card, row.appearance);

    // Header
    const header = el('header', 'dashboard-widget__header');
    const drag = el('span', 'dashboard-widget__drag');
    drag.title = 'Drag to move';
    drag.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
    header.appendChild(drag);

    const titleEl = el('span', 'dashboard-widget__title');
    titleEl.dataset.defaultTitle = typeReg?.displayName ?? row.widgetTypeId;
    titleEl.textContent = row.appearance.title?.trim() || titleEl.dataset.defaultTitle;
    header.appendChild(titleEl);

    const status = el('span', 'dashboard-widget__status');
    status.dataset.role = 'status';
    header.appendChild(status);

    const actions = el('div', 'dashboard-widget__actions');

    if (typeReg?.refresh) {
      const refreshBtn = el('button', 'dashboard-widget__btn');
      refreshBtn.type = 'button';
      refreshBtn.title = typeReg.category === 'ai' ? 'Refresh (background agent)' : 'Refresh';
      refreshBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
      refreshBtn.addEventListener('click', () => void this._triggerManualRefresh(row.id));
      actions.appendChild(refreshBtn);

      // Escape hatch (M86 C4): run this AI widget's prompt through the
      // visible chat session instead of a background agent — for debugging
      // a prompt while watching the turn stream. Never the default path.
      if (typeReg.category === 'ai') {
        const chatBtn = el('button', 'dashboard-widget__btn');
        chatBtn.type = 'button';
        chatBtn.title = 'Run in chat (visible — for debugging the prompt)';
        chatBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
        chatBtn.addEventListener('click', () => void this._triggerManualRefresh(row.id, 'chat'));
        actions.appendChild(chatBtn);
      }
    }

    if (typeReg?.configSchema) {
      const settingsBtn = el('button', 'dashboard-widget__btn');
      settingsBtn.type = 'button';
      settingsBtn.title = 'Configure';
      settingsBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
      settingsBtn.addEventListener('click', () => this._openSettingsDrawer(row.id));
      actions.appendChild(settingsBtn);
    }

    // Appearance button — universal, available on every widget.
    const appearanceBtn = el('button', 'dashboard-widget__btn');
    appearanceBtn.type = 'button';
    appearanceBtn.title = 'Appearance';
    appearanceBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>';
    appearanceBtn.addEventListener('click', () => this._openAppearanceDrawer(row.id));
    actions.appendChild(appearanceBtn);

    const removeBtn = el('button', 'dashboard-widget__btn dashboard-widget__btn--danger');
    removeBtn.type = 'button';
    removeBtn.title = 'Remove widget';
    removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    removeBtn.addEventListener('click', () => void this._removeWidget(row.id));
    actions.appendChild(removeBtn);

    header.appendChild(actions);
    card.appendChild(header);

    // Resize handles — every edge and corner EXCEPT the top ('n'): the top edge
    // is the universal move strip (below), so widgets with no title bar (bare
    // image/video) are still draggable. The NW/NE corners still resize the top.
    // Edge handles resize along one axis; corners resize both, moving the
    // origin so the opposite edge stays pinned.
    const resizeDirs: ResizeDir[] = ['s', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    for (const dir of resizeDirs) {
      const h = el('span', `dashboard-widget__resize dashboard-widget__resize--${dir}`);
      h.dataset.role = 'resize';
      h.dataset.dir = dir;
      h.title = 'Drag to resize';
      card.appendChild(h);
      this._installDragResize(card, h, row.id, dir);
    }

    // Move strip — the TOP EDGE is the drag-to-move surface for EVERY widget
    // type (title bar or not), hover-revealed like the resize handles. The
    // header grip drags too (a nicer target on widgets that show a header).
    const moveStrip = el('span', 'dashboard-widget__move');
    moveStrip.dataset.role = 'move';
    moveStrip.title = 'Drag to move';
    card.appendChild(moveStrip);
    this._installDragMove(moveStrip, card, row.id);
    this._installDragMove(drag, card, row.id);

    // Body
    const body = el('div', 'dashboard-widget__body');
    card.appendChild(body);

    // Footer (cached-at metadata)
    const footer = el('footer', 'dashboard-widget__footer');
    footer.dataset.role = 'footer';
    if (row.cachedAt) {
      footer.textContent = `Updated ${this._formatRelative(row.cachedAt)}`;
    } else {
      footer.textContent = typeReg?.refresh ? 'Never refreshed' : '';
    }
    if (!footer.textContent) footer.style.display = 'none';
    card.appendChild(footer);

    this._gridEl.appendChild(card);

    // Instantiate widget renderer
    const configEmitter = new Emitter<unknown>();
    let handle: WidgetHandle | null = null;

    if (!typeReg) {
      // Unavailable placeholder. Never evict the instance — layout, config,
      // and cached output all survive until the providing tool returns.
      const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const source = row.providerToolId
        ? `Provided by <code>${esc(row.providerToolId)}</code>, which isn't currently active.`
        : `The "<code>${esc(row.widgetTypeId)}</code>" widget type is not registered.`;
      body.innerHTML = `
        <div class="dashboard-widget__unavailable">
          <strong>Widget unavailable</strong>
          <p>${source}<br/>Enable the providing extension to bring it back, or remove the widget.</p>
        </div>
      `;
      status.dataset.value = 'stale';
    } else {
      const ctx = this._buildContext(row, configEmitter);
      try {
        // renderMode 'markdown' (M86): the dashboard renders cached output
        // itself, so contributed widgets (especially plain-JS extensions)
        // don't need to ship a renderer.
        handle = typeReg.createWidget
          ? typeReg.createWidget(body, ctx)
          : this._createMarkdownHandle(body, ctx);
      } catch (err) {
        console.error(`[Dashboard] widget renderer crashed for ${row.id}:`, err);
        body.innerHTML = `<div class="dashboard-widget__error">Widget failed to render.</div>`;
        status.dataset.value = 'error';
      }

      // Render initial cached output if widget provides a hook.
      if (handle?.refreshFromCache) {
        try { handle.refreshFromCache(row.cachedOutput); } catch { /* noop */ }
      }

      // Wire scheduled refresh.
      this._scheduler.schedule(row.id, typeReg, row.refreshPolicy, async () => {
        await this._runRefresh(row.id);
      });
    }

    this._updateStatusBadge(status, row.status, row.errorMessage);

    this._instances.set(row.id, {
      row,
      typeReg,
      cardEl: card,
      bodyEl: body,
      handle,
      configEmitter,
    });
  }

  /**
   * Built-in body renderer for `renderMode: 'markdown'` widget types (M86):
   * paints the cached output as Markdown, mirrors the AI widgets' empty and
   * error states, and re-paints from cache on delivery.
   */
  private _createMarkdownHandle(body: HTMLElement, ctx: WidgetContext<unknown>): WidgetHandle {
    body.classList.add('dashboard-md');
    const surface = el('div', 'dashboard-md__surface');
    body.appendChild(surface);

    // Doors, not posters: parallx:// links in rendered markdown route
    // through the link resolver (e.g. the canvas page-embed's heading link
    // opens the real page). Plain web links open externally as usual.
    surface.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('parallx://')) return;
      e.preventDefault();
      try {
        const services = (this._api as { services?: { has(id: { id: string }): boolean; get<T>(id: { id: string }): T } }).services;
        if (services?.has(ILinkResolverService)) {
          void services.get<import('../../links/linkResolverService.js').ILinkResolverService>(ILinkResolverService).open(href);
        }
      } catch (err) {
        console.warn('[Dashboard] parallx:// link open failed:', err);
      }
    });

    const paint = (cached: string | null): void => {
      surface.innerHTML = '';
      if (!cached) {
        const empty = el('div', 'dashboard-md__empty');
        empty.innerHTML = '<strong>Nothing here yet</strong><p>Click the refresh icon above to fill this widget.</p>';
        surface.appendChild(empty);
        return;
      }
      const md = el('div', 'dashboard-md__body');
      md.appendChild(renderMarkdownToDom(cached));
      surface.appendChild(md);
    };
    const paintError = (message: string): void => {
      surface.innerHTML = '';
      const err = el('div', 'dashboard-md__error');
      const title = document.createElement('strong');
      title.textContent = 'Couldn’t update this widget';
      const detail = document.createElement('p');
      detail.textContent = message;
      err.appendChild(title);
      err.appendChild(detail);
      surface.appendChild(err);
    };

    if (ctx.errorMessage && !ctx.cachedOutput) paintError(ctx.errorMessage);
    else paint(ctx.cachedOutput);

    return {
      refreshFromCache(cached: string | null) { paint(cached); },
      renderError(message: string | null) {
        if (message) paintError(message);
        else paint(ctx.cachedOutput);
      },
      dispose() { /* nothing owned */ },
    };
  }

  private _buildContext(row: DashboardWidgetRow, configEmitter: Emitter<unknown>): WidgetContext<unknown> {
    return {
      instanceId: row.id,
      pageId: row.pageId,
      config: row.config,
      api: this._api,
      cachedOutput: row.cachedOutput,
      errorMessage: row.errorMessage,
      onDidChangeConfig: configEmitter.event,
      requestRefresh: () => void this._triggerManualRefresh(row.id),
      setCachedOutput: (output: string) => {
        void this._data.setWidgetCachedOutput(row.id, output);
      },
      setError: (message: string) => {
        void this._data.setWidgetError(row.id, message);
      },
      clearError: () => {
        void this._data.clearWidgetError(row.id);
      },
    };
  }

  private _formatRelative(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
    return `${Math.round(diff / 86_400_000)}d ago`;
  }

  private _updateStatusBadge(el: HTMLElement, status: string, errorMessage: string | null): void {
    el.dataset.value = status;
    if (status === 'error' && errorMessage) {
      el.title = errorMessage;
    } else {
      el.removeAttribute('title');
    }
  }

  // ── Refresh ────────────────────────────────────────────────────────────

  /**
   * User-initiated refresh. Routed through the scheduler's runOnce so manual
   * clicks and Refresh-all get the same single-flight + AI-concurrency
   * admission as scheduled refreshes (M86 C4 — previously manual refreshes
   * bypassed the cap and N clicks meant N concurrent AI turns).
   */
  private async _triggerManualRefresh(widgetId: string, mode?: 'background' | 'chat'): Promise<void> {
    await this._scheduler.runOnce(widgetId, () => this._runRefresh(widgetId, mode));
  }

  private async _runRefresh(widgetId: string, mode?: 'background' | 'chat'): Promise<void> {
    const inst = this._instances.get(widgetId);
    if (!inst || !inst.typeReg?.refresh) return;
    const card = inst.cardEl;
    const statusEl = card.querySelector('[data-role="status"]') as HTMLElement | null;
    if (statusEl) statusEl.dataset.value = 'running';
    card.classList.add('dashboard-widget--running');

    try {
      const output = await inst.typeReg.refresh({
        instanceId: inst.row.id,
        pageId: inst.row.pageId,
        config: inst.row.config,
        api: this._api,
        cachedOutput: inst.row.cachedOutput,
        mode: mode ?? 'background',
      });
      // A string persists as the widget's cache. `null` means the refresh
      // delivered its own output (e.g. an AI turn wrote the cache via
      // dashboard_render_widget mid-run) — writing here would clobber it.
      if (typeof output === 'string') {
        await this._data.setWidgetCachedOutput(widgetId, output);
      } else {
        await this._data.clearWidgetError(widgetId);
      }
      // Re-read the row to pick up the new cachedAt / delivered content.
      const fresh = await this._data.getWidget(widgetId);
      if (fresh) {
        inst.row = fresh;
        if (inst.handle?.renderError) inst.handle.renderError(null);
        if (inst.handle?.refreshFromCache) inst.handle.refreshFromCache(fresh.cachedOutput);
        this._updateFooter(inst);
      }
      if (statusEl) statusEl.dataset.value = 'ok';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._data.setWidgetError(widgetId, msg);
      if (inst.handle?.renderError) inst.handle.renderError(msg);
      if (statusEl) {
        statusEl.dataset.value = 'error';
        statusEl.title = msg;
      }
    } finally {
      card.classList.remove('dashboard-widget--running');
    }
  }

  private _updateFooter(inst: { cardEl: HTMLElement; row: DashboardWidgetRow }): void {
    const footer = inst.cardEl.querySelector('[data-role="footer"]') as HTMLElement | null;
    if (!footer) return;
    if (inst.row.cachedAt) {
      footer.textContent = `Updated ${this._formatRelative(inst.row.cachedAt)}`;
      footer.style.display = '';
    } else {
      footer.style.display = 'none';
    }
  }

  // ── Reconcile (data-change driven) ─────────────────────────────────────

  private async _reconcile(_kind: string, widgetId?: string): Promise<void> {
    // Phase 1 is coarse: re-render the entire page. Phase 5 can optimise.
    if (!widgetId) {
      await this._renderAllWidgets();
      return;
    }
    const inst = this._instances.get(widgetId);
    if (!inst) {
      await this._renderAllWidgets();
      return;
    }
    // Mounted widget — sync cache / status from DB.
    const fresh = await this._data.getWidget(widgetId);
    if (!fresh) {
      // Widget was removed.
      await this._renderAllWidgets();
      return;
    }
    inst.row = fresh;
    if (inst.handle?.refreshFromCache) inst.handle.refreshFromCache(fresh.cachedOutput);
    const statusEl = inst.cardEl.querySelector('[data-role="status"]') as HTMLElement | null;
    if (statusEl) this._updateStatusBadge(statusEl, fresh.status, fresh.errorMessage);
    this._updateFooter(inst);
  }

  /**
   * Dispose one mounted instance and mount it again from a fresh DB row.
   * Used when its type's availability changed (placeholder ⇄ live widget).
   */
  private async _remountWidget(widgetId: string): Promise<void> {
    const inst = this._instances.get(widgetId);
    if (!inst) return;
    try { inst.handle?.dispose(); } catch { /* noop */ }
    inst.configEmitter.dispose();
    this._scheduler.cancel(widgetId);
    inst.cardEl.remove();
    this._instances.delete(widgetId);

    const row = await this._data.getWidget(widgetId);
    if (this._disposed || !row || row.pageId !== this._pageId) return;
    if (this._instances.has(widgetId)) return; // re-mounted concurrently
    this._mountWidget(row);
  }

  // ── Remove ─────────────────────────────────────────────────────────────

  private async _removeWidget(widgetId: string): Promise<void> {
    await this._data.removeWidget(widgetId);
    this._scheduler.cancel(widgetId);
  }

  // ── Widget picker ──────────────────────────────────────────────────────

  private async _openWidgetPicker(): Promise<void> {
    const root = this._root;
    if (!root) return;

    // Phase 1: minimal picker. Phase 2 brings the polished overlay.
    const overlay = el('div', 'dashboard-picker-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const sheet = el('div', 'dashboard-picker');

    const head = el('div', 'dashboard-picker__head');
    const ht = el('h2', 'dashboard-picker__title');
    ht.textContent = 'Add a widget';
    head.appendChild(ht);
    const hint = el('p', 'dashboard-picker__hint');
    hint.textContent = 'Choose what to surface on this dashboard.';
    head.appendChild(hint);
    sheet.appendChild(head);

    const types = this._registry.listWidgetTypes();
    if (types.length === 0) {
      const empty = el('div', 'dashboard-picker__empty');
      empty.innerHTML = `
        <strong>No widgets registered yet</strong>
        <p>Built-in widgets and extension-contributed widgets will appear here. Check back after activating more tools.</p>
      `;
      sheet.appendChild(empty);
    } else {
      // ── Templates rail (M86 C3): preconfigured recipes — one click adds
      // a fully configured widget. Only recipes whose type is currently
      // registered are shown, so a disabled extension hides its recipes.
      const recipes = WIDGET_TEMPLATES.filter((r) => this._registry.getWidgetType(r.typeId));
      if (recipes.length > 0) {
        const tHead = el('div', 'dashboard-picker__section');
        tHead.textContent = 'Templates';
        sheet.appendChild(tHead);
        const rail = el('div', 'dashboard-picker__templates');
        for (const recipe of recipes) {
          const tile = el('button', 'dashboard-picker__template');
          tile.setAttribute('type', 'button');
          const name = el('span', 'dashboard-picker__template-name');
          name.textContent = recipe.name;
          tile.appendChild(name);
          const desc = el('span', 'dashboard-picker__template-desc');
          desc.textContent = recipe.description;
          tile.appendChild(desc);
          tile.addEventListener('click', async () => {
            const reg = this._registry.getWidgetType(recipe.typeId);
            if (!reg) return;
            const placement = await this._nextPlacement(reg.defaultSize);
            await this._data.createWidget({
              pageId: this._pageId,
              widgetTypeId: reg.typeId,
              placement,
              config: { ...(reg.defaultConfig as Record<string, unknown>), ...recipe.config },
              refreshPolicy: recipe.refreshPolicy ?? reg.defaultRefreshPolicy ?? { kind: 'manual' },
              providerToolId: this._registry.getWidgetTypeOwner(reg.typeId),
            });
            overlay.remove();
          });
          rail.appendChild(tile);
        }
        sheet.appendChild(rail);
      }

      const grid = el('div', 'dashboard-picker__grid');
      const grouped = new Map<string, WidgetTypeRegistration<unknown>[]>();
      for (const t of types) {
        const k = t.category;
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k)!.push(t);
      }
      const order: { key: string; label: string }[] = [
        { key: 'static', label: 'At a glance' },
        { key: 'query', label: 'Workspace activity' },
        { key: 'ai', label: 'AI-backed' },
      ];
      for (const { key, label } of order) {
        const items = grouped.get(key);
        if (!items || items.length === 0) continue;
        const section = el('section', 'dashboard-picker__section');
        const heading = el('h3', 'dashboard-picker__section-title');
        heading.textContent = label;
        section.appendChild(heading);
        const list = el('div', 'dashboard-picker__items');
        for (const t of items) {
          const tile = this._buildPickerTile(t, overlay);
          list.appendChild(tile);
        }
        section.appendChild(list);
        grid.appendChild(section);
      }
      sheet.appendChild(grid);
    }

    const foot = el('div', 'dashboard-picker__foot');
    const close = el('button', 'dashboard-btn dashboard-btn--ghost');
    close.type = 'button';
    close.textContent = 'Cancel';
    close.addEventListener('click', () => overlay.remove());
    foot.appendChild(close);
    sheet.appendChild(foot);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
  }

  private _buildPickerTile(reg: WidgetTypeRegistration<unknown>, overlay: HTMLElement): HTMLElement {
    const tile = el('button', 'dashboard-picker__tile');
    tile.type = 'button';

    const icon = el('span', 'dashboard-picker__tile-icon');
    icon.innerHTML = reg.icon ?? DASHBOARD_ICON_SVG;
    tile.appendChild(icon);

    const text = el('span', 'dashboard-picker__tile-text');
    const name = el('span', 'dashboard-picker__tile-name');
    name.textContent = reg.displayName;
    text.appendChild(name);
    if (reg.description) {
      const desc = el('span', 'dashboard-picker__tile-desc');
      desc.textContent = reg.description;
      text.appendChild(desc);
    }
    tile.appendChild(text);

    tile.addEventListener('click', async () => {
      try {
        await this._addWidgetOfType(reg);
        overlay.remove();
      } catch (err) {
        console.error('[Dashboard] addWidgetOfType failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        await this._api.window.showErrorMessage(`Could not add widget: ${msg}`);
      }
    });

    return tile;
  }

  // ── Placement helper ───────────────────────────────────────────────────

  private async _addWidgetOfType(reg: WidgetTypeRegistration<unknown>): Promise<void> {
    const placement = await this._nextPlacement(reg.defaultSize);
    await this._data.createWidget({
      pageId: this._pageId,
      widgetTypeId: reg.typeId,
      placement,
      config: { ...(reg.defaultConfig as Record<string, unknown>) },
      refreshPolicy: reg.defaultRefreshPolicy ?? { kind: 'manual' },
      providerToolId: this._registry.getWidgetTypeOwner(reg.typeId),
    });
  }

  /**
   * Naive bottom-stack placement: drop the new widget below the current
   * lowest row, left-aligned. Phase 5's drag/resize lets the user move it.
   * Avoids overlap detection complexity for now.
   */
  private async _nextPlacement(size: { colSpan: number; rowSpan: number }): Promise<WidgetPlacement> {
    const widgets = await this._data.listWidgets(this._pageId);
    let maxRow = -1;
    for (const w of widgets) {
      const bottom = w.placement.row + w.placement.rowSpan - 1;
      if (bottom > maxRow) maxRow = bottom;
    }
    return {
      row: maxRow + 1,
      col: 0,
      rowSpan: Math.max(1, size.rowSpan),
      colSpan: Math.min(DASHBOARD_GRID_COLS, Math.max(1, size.colSpan)),
    };
  }

  // ── Drag-to-move ───────────────────────────────────────────────────────

  private _installDragMove(handle: HTMLElement, card: HTMLElement, widgetId: string): void {
    // Live editing: dragging the widget's HEADER (title bar) moves it — a big,
    // obvious target — while the body stays fully interactive. A small movement
    // threshold distinguishes a drag from a plain click (so the title can still
    // rename); buttons and resize handles opt out.
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // primary button only
      const t = e.target as HTMLElement | null;
      if (t?.closest('.dashboard-widget__btn, .dashboard-widget__resize')) return;

      const inst = this._instances.get(widgetId);
      if (!inst) return;
      const origPlacement = inst.row.placement;
      const gridRect = this._gridEl!.getBoundingClientRect();
      const cellWidth = gridRect.width / DASHBOARD_GRID_COLS;
      const cellHeight = this._rowHeight();
      const startX = e.clientX;
      const startY = e.clientY;

      let dragging = false;
      let ghost: HTMLElement | null = null;
      let lastTarget = origPlacement;
      let pendingDx = 0;
      let pendingDy = 0;
      let rafId = 0;

      // The card follows the pointer via transform (GPU-composited, no layout);
      // the ghost snaps to whole cells to preview where it lands. rAF-batched.
      const flush = () => {
        rafId = 0;
        card.style.transform = `translate(${pendingDx}px, ${pendingDy}px)`;
        const deltaCol = Math.round(pendingDx / cellWidth);
        const deltaRow = Math.round(pendingDy / cellHeight);
        const targetCol = Math.max(0, Math.min(DASHBOARD_GRID_COLS - origPlacement.colSpan, origPlacement.col + deltaCol));
        const targetRow = Math.max(0, origPlacement.row + deltaRow);
        if (ghost && (targetCol !== lastTarget.col || targetRow !== lastTarget.row)) {
          lastTarget = { ...origPlacement, col: targetCol, row: targetRow };
          this._placeAt(ghost, lastTarget);
        }
      };

      const beginDrag = () => {
        dragging = true;
        card.classList.add('dashboard-widget--dragging');
        ghost = el('div', 'dashboard-widget__ghost');
        this._gridEl!.appendChild(ghost);
        this._placeAt(ghost, origPlacement);
      };

      const onMove = (ev: PointerEvent) => {
        pendingDx = ev.clientX - startX;
        pendingDy = ev.clientY - startY;
        if (!dragging) {
          if (Math.hypot(pendingDx, pendingDy) < 4) return; // still a click
          beginDrag();
        }
        if (!rafId) rafId = requestAnimationFrame(flush);
      };

      const onUp = async () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (!dragging) return; // never crossed the threshold — let the click be
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        ghost?.remove();
        card.classList.remove('dashboard-widget--dragging');
        card.style.transform = '';
        // Swallow the click that fires after the drag so the title doesn't rename.
        const cancelClick = (ce: Event) => { ce.stopPropagation(); ce.preventDefault(); };
        card.addEventListener('click', cancelClick, { capture: true, once: true });
        setTimeout(() => card.removeEventListener('click', cancelClick, { capture: true } as EventListenerOptions), 60);
        if (lastTarget.col !== origPlacement.col || lastTarget.row !== origPlacement.row) {
          card.style.gridRow = `${lastTarget.row + 1} / span ${lastTarget.rowSpan}`;
          card.style.gridColumn = `${lastTarget.col + 1} / span ${lastTarget.colSpan}`;
          try {
            await this._data.updateWidgetPlacement(widgetId, lastTarget);
            inst.row = { ...inst.row, placement: lastTarget };
          } catch (err) {
            console.warn('[Dashboard] commit placement failed:', err);
          }
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  // ── Drag-to-resize ─────────────────────────────────────────────────────

  private _installDragResize(card: HTMLElement, handle: HTMLElement, widgetId: string, dir: ResizeDir): void {
    const movesWest = dir.includes('w');
    const movesNorth = dir.includes('n');
    const affectsCol = dir.includes('e') || dir.includes('w');
    const affectsRow = dir.includes('n') || dir.includes('s');

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // primary button only
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);

      const gridRect = this._gridEl!.getBoundingClientRect();
      const cellWidth = gridRect.width / DASHBOARD_GRID_COLS;
      const cellHeight = this._rowHeight();
      const startX = e.clientX;
      const startY = e.clientY;
      const inst = this._instances.get(widgetId);
      if (!inst) return;
      const origPlacement = inst.row.placement;
      const typeReg = inst.typeReg;
      const minColSpan = typeReg?.sizeBounds?.minColSpan ?? 1;
      const maxColSpan = typeReg?.sizeBounds?.maxColSpan ?? DASHBOARD_GRID_COLS;
      const minRowSpan = typeReg?.sizeBounds?.minRowSpan ?? 1;
      const maxRowSpan = typeReg?.sizeBounds?.maxRowSpan ?? 12;

      // Fixed edges (the side opposite the handle stays pinned).
      const rightEdge = origPlacement.col + origPlacement.colSpan; // exclusive
      const bottomEdge = origPlacement.row + origPlacement.rowSpan; // exclusive

      card.classList.add('dashboard-widget--resizing');

      // Live-resize the card itself (rAF-batched) so its content reflows as
      // the user drags and stays visible — no ghost, no dimming. Spans snap to
      // whole cells, which is also the commit granularity.
      let lastTarget = origPlacement;
      let pendingDx = 0;
      let pendingDy = 0;
      let rafId = 0;
      const flush = () => {
        rafId = 0;
        const deltaCol = Math.round(pendingDx / cellWidth);
        const deltaRow = Math.round(pendingDy / cellHeight);

        let col = origPlacement.col;
        let colSpan = origPlacement.colSpan;
        if (affectsCol) {
          if (movesWest) {
            // Left edge moves; right edge pinned at rightEdge.
            const minCol = Math.max(0, rightEdge - maxColSpan);
            const maxCol = rightEdge - minColSpan;
            col = Math.max(minCol, Math.min(maxCol, origPlacement.col + deltaCol));
            colSpan = rightEdge - col;
          } else {
            // Right edge moves; left edge (col) pinned.
            const want = origPlacement.colSpan + deltaCol;
            colSpan = Math.max(minColSpan, Math.min(maxColSpan, want));
            colSpan = Math.min(colSpan, DASHBOARD_GRID_COLS - col);
          }
        }

        let row = origPlacement.row;
        let rowSpan = origPlacement.rowSpan;
        if (affectsRow) {
          if (movesNorth) {
            // Top edge moves; bottom edge pinned at bottomEdge.
            const minRow = Math.max(0, bottomEdge - maxRowSpan);
            const maxRow = bottomEdge - minRowSpan;
            row = Math.max(minRow, Math.min(maxRow, origPlacement.row + deltaRow));
            rowSpan = bottomEdge - row;
          } else {
            // Bottom edge moves; top edge (row) pinned.
            const want = origPlacement.rowSpan + deltaRow;
            rowSpan = Math.max(minRowSpan, Math.min(maxRowSpan, want));
          }
        }

        if (col === lastTarget.col && row === lastTarget.row
          && colSpan === lastTarget.colSpan && rowSpan === lastTarget.rowSpan) return;
        lastTarget = { col, row, colSpan, rowSpan };
        card.style.gridColumn = `${col + 1} / span ${colSpan}`;
        card.style.gridRow = `${row + 1} / span ${rowSpan}`;
      };
      const onMove = (ev: PointerEvent) => {
        pendingDx = ev.clientX - startX;
        pendingDy = ev.clientY - startY;
        if (!rafId) rafId = requestAnimationFrame(flush);
      };
      const onUp = async (ev: PointerEvent) => {
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        try { handle.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
        card.classList.remove('dashboard-widget--resizing');
        const changed = lastTarget.col !== origPlacement.col || lastTarget.row !== origPlacement.row
          || lastTarget.colSpan !== origPlacement.colSpan || lastTarget.rowSpan !== origPlacement.rowSpan;
        if (changed) {
          try {
            await this._data.updateWidgetPlacement(widgetId, lastTarget);
            inst.row = { ...inst.row, placement: lastTarget };
          } catch (err) {
            console.warn('[Dashboard] commit resize failed:', err);
            // Revert to the original placement on failure.
            card.style.gridColumn = `${origPlacement.col + 1} / span ${origPlacement.colSpan}`;
            card.style.gridRow = `${origPlacement.row + 1} / span ${origPlacement.rowSpan}`;
          }
        }
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  private _placeAt(el: HTMLElement, p: WidgetPlacement): void {
    el.style.gridRow = `${p.row + 1} / span ${p.rowSpan}`;
    el.style.gridColumn = `${p.col + 1} / span ${p.colSpan}`;
  }

  private _rowHeight(): number {
    // Rows are a fixed, uniform track (grid-auto-rows), so the drag math has
    // an exact px-per-row. Read it (plus the row gap) straight from the grid's
    // computed style so JS and CSS stay in lockstep.
    const grid = this._gridEl;
    if (!grid) return 96;
    const cs = getComputedStyle(grid);
    const rowH = parseFloat(cs.gridAutoRows) || 80;
    const gap = parseFloat(cs.rowGap) || 16;
    return rowH + gap;
  }

  /**
   * Apply per-instance appearance overrides as inline styles. Inline wins over
   * the chrome classes and hover rules, so an explicit choice is consistent.
   * Each axis left at 'default' clears the inline style and defers to chrome.
   */
  private _applyAppearance(card: HTMLElement, a: WidgetAppearance): void {
    if (a.background === 'transparent') {
      card.style.background = 'transparent';
    } else if (a.background === 'custom' && a.backgroundColor) {
      card.style.background = a.backgroundColor;
    } else {
      card.style.removeProperty('background');
    }

    if (a.border === 'none') {
      card.style.border = 'none';
    } else if (a.border === 'custom' && a.borderColor) {
      card.style.border = `1px solid ${a.borderColor}`;
    } else {
      card.style.removeProperty('border');
    }

    // When the outer border is gone, the inner header/footer separators look
    // orphaned — drop them too so the card reads as a single clean surface.
    if (a.border === 'none') card.dataset.borderless = 'true';
    else delete card.dataset.borderless;

    // Title override + hide. Title text only updates when the element already
    // exists (it doesn't during the very first mount call — _mountWidget sets
    // the initial text itself); this branch drives live preview in the drawer.
    if (a.titleHidden) card.dataset.titleHidden = 'true';
    else delete card.dataset.titleHidden;
    const titleEl = card.querySelector<HTMLElement>('.dashboard-widget__title');
    if (titleEl) {
      titleEl.textContent = a.title?.trim() || titleEl.dataset.defaultTitle || '';
    }
  }

  // ── Appearance drawer ──────────────────────────────────────────────────

  private async _openAppearanceDrawer(widgetId: string): Promise<void> {
    const inst = this._instances.get(widgetId);
    if (!inst) return;
    const original = inst.row.appearance;

    const overlay = el('div', 'dashboard-settings-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { this._applyAppearance(inst.cardEl, original); overlay.remove(); }
    });

    const sheet = el('aside', 'dashboard-settings');

    const head = el('div', 'dashboard-settings__head');
    const ht = el('h2', 'dashboard-settings__title');
    ht.textContent = 'Appearance';
    head.appendChild(ht);
    const hint = el('p', 'dashboard-settings__hint');
    hint.textContent = 'Background and border for this widget. Changes preview live.';
    head.appendChild(hint);
    sheet.appendChild(head);

    const body = el('div', 'dashboard-settings__body');
    sheet.appendChild(body);

    // Working copy mutated by the controls; previewed live on the card.
    const draft: { -readonly [K in keyof WidgetAppearance]: WidgetAppearance[K] } = { ...original };
    const preview = () => this._applyAppearance(inst.cardEl, draft);

    // ── Background ──
    const bgBlock = el('div', 'dashboard-field');
    const bgLabel = el('label', 'dashboard-field__label');
    bgLabel.textContent = 'Background';
    bgBlock.appendChild(bgLabel);
    const bgColor = document.createElement('input');
    bgColor.type = 'color';
    bgColor.className = 'dashboard-field__color';
    bgColor.value = isHexColor(draft.backgroundColor) ? draft.backgroundColor! : '#1e1e1e';
    bgColor.style.display = draft.background === 'custom' ? '' : 'none';
    const bgSelect = createSelect(
      [{ value: 'default', label: 'Theme default' }, { value: 'transparent', label: 'Transparent' }, { value: 'custom', label: 'Custom color' }],
      draft.background,
      (v) => {
        draft.background = v as WidgetAppearance['background'];
        bgColor.style.display = draft.background === 'custom' ? '' : 'none';
        if (draft.background === 'custom') draft.backgroundColor = bgColor.value;
        preview();
      },
    );
    bgBlock.appendChild(bgSelect.el);
    bgBlock.appendChild(bgColor);
    bgColor.addEventListener('input', () => { draft.backgroundColor = bgColor.value; preview(); });
    body.appendChild(bgBlock);

    // ── Border ──
    const bdBlock = el('div', 'dashboard-field');
    const bdLabel = el('label', 'dashboard-field__label');
    bdLabel.textContent = 'Border';
    bdBlock.appendChild(bdLabel);
    const bdColor = document.createElement('input');
    bdColor.type = 'color';
    bdColor.className = 'dashboard-field__color';
    bdColor.value = isHexColor(draft.borderColor) ? draft.borderColor! : '#3c3c3c';
    bdColor.style.display = draft.border === 'custom' ? '' : 'none';
    const bdSelect = createSelect(
      [{ value: 'default', label: 'Theme default' }, { value: 'none', label: 'No border' }, { value: 'custom', label: 'Custom color' }],
      draft.border,
      (v) => {
        draft.border = v as WidgetAppearance['border'];
        bdColor.style.display = draft.border === 'custom' ? '' : 'none';
        if (draft.border === 'custom') draft.borderColor = bdColor.value;
        preview();
      },
    );
    bdBlock.appendChild(bdSelect.el);
    bdBlock.appendChild(bdColor);
    bdColor.addEventListener('input', () => { draft.borderColor = bdColor.value; preview(); });
    body.appendChild(bdBlock);

    // ── Title ──
    const defaultTitle = inst.cardEl.querySelector<HTMLElement>('.dashboard-widget__title')?.dataset.defaultTitle
      ?? inst.typeReg?.displayName ?? '';
    const titleBlock = el('div', 'dashboard-field');
    const titleLabel = el('label', 'dashboard-field__label');
    titleLabel.textContent = 'Title';
    titleBlock.appendChild(titleLabel);
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'dashboard-field__input';
    titleInput.value = draft.title ?? '';
    titleInput.placeholder = defaultTitle;
    titleBlock.appendChild(titleInput);
    titleInput.addEventListener('input', () => {
      draft.title = titleInput.value.trim() ? titleInput.value : null;
      preview();
    });
    body.appendChild(titleBlock);

    // ── Hide title ──
    const hideBlock = el('div', 'dashboard-field');
    const hideRow = el('div', 'dashboard-field__checkbox-row');
    const hideCheckbox = document.createElement('input');
    hideCheckbox.type = 'checkbox';
    hideCheckbox.checked = draft.titleHidden;
    hideRow.appendChild(hideCheckbox);
    const hideText = document.createElement('span');
    hideText.textContent = 'Hide title bar';
    hideRow.appendChild(hideText);
    hideBlock.appendChild(hideRow);
    hideCheckbox.addEventListener('change', () => { draft.titleHidden = hideCheckbox.checked; preview(); });
    body.appendChild(hideBlock);

    const foot = el('div', 'dashboard-settings__foot');
    const cancel = el('button', 'dashboard-btn dashboard-btn--ghost');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { this._applyAppearance(inst.cardEl, original); overlay.remove(); });
    foot.appendChild(cancel);
    const save = el('button', 'dashboard-btn dashboard-btn--primary');
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      const next: WidgetAppearance = {
        background: draft.background,
        backgroundColor: draft.background === 'custom' ? bgColor.value : null,
        border: draft.border,
        borderColor: draft.border === 'custom' ? bdColor.value : null,
        title: titleInput.value.trim() ? titleInput.value.trim() : null,
        titleHidden: hideCheckbox.checked,
      };
      try {
        await this._data.updateWidgetAppearance(widgetId, next);
        inst.row = { ...inst.row, appearance: next };
        this._applyAppearance(inst.cardEl, next);
      } catch (err) {
        console.error('[Dashboard] updateWidgetAppearance failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        await this._api.window.showErrorMessage(`Could not save appearance: ${msg}`);
        return;
      }
      overlay.remove();
    });
    foot.appendChild(save);
    sheet.appendChild(foot);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
  }

  // ── Settings drawer ────────────────────────────────────────────────────

  private async _openSettingsDrawer(widgetId: string): Promise<void> {
    const inst = this._instances.get(widgetId);
    if (!inst) return;
    const typeReg = inst.typeReg;
    if (!typeReg?.configSchema) return;
    const schema = typeReg.configSchema;

    const overlay = el('div', 'dashboard-settings-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const sheet = el('aside', 'dashboard-settings');

    const head = el('div', 'dashboard-settings__head');
    const ht = el('h2', 'dashboard-settings__title');
    ht.textContent = `Configure ${typeReg.displayName}`;
    head.appendChild(ht);
    const hint = el('p', 'dashboard-settings__hint');
    hint.textContent = typeReg.description ?? 'Adjust this widget instance.';
    head.appendChild(hint);
    sheet.appendChild(head);

    const body = el('div', 'dashboard-settings__body');
    sheet.appendChild(body);

    const current = { ...(inst.row.config as Record<string, unknown>) };
    const inputs = new Map<string, () => unknown>();

    for (const [name, field] of Object.entries(schema.fields)) {
      const block = el('div', 'dashboard-field');

      const addLabelAndHint = () => {
        const label = el('label', 'dashboard-field__label');
        label.textContent = field.label;
        block.appendChild(label);
        if (field.description) {
          const hint = el('span', 'dashboard-field__hint');
          hint.textContent = field.description;
          block.appendChild(hint);
        }
      };

      if (field.type === 'boolean') {
        // Boolean fields render label inline with the checkbox.
        const row = el('div', 'dashboard-field__checkbox-row');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(current[name] ?? field.default ?? false);
        row.appendChild(checkbox);
        const text = document.createElement('span');
        text.textContent = field.label;
        row.appendChild(text);
        block.appendChild(row);
        if (field.description) {
          const hint = el('span', 'dashboard-field__hint');
          hint.textContent = field.description;
          block.appendChild(hint);
        }
        inputs.set(name, () => checkbox.checked);
      } else if (field.type === 'enum') {
        addLabelAndHint();
        const opts = (field.options ?? []).map(o => ({ value: o.value, label: o.label }));
        const cur = String(current[name] ?? field.default ?? opts[0]?.value ?? '');
        const sel = createSelect(opts, cur, () => {});
        block.appendChild(sel.el);
        inputs.set(name, () => sel.getValue());
      } else if (field.type === 'textarea') {
        addLabelAndHint();
        const ta = document.createElement('textarea');
        ta.className = 'dashboard-field__textarea';
        ta.value = String(current[name] ?? field.default ?? '');
        if (field.placeholder) ta.placeholder = field.placeholder;
        block.appendChild(ta);
        inputs.set(name, () => ta.value);
      } else if (field.type === 'markdown') {
        addLabelAndHint();
        // Live-preview markdown editor: a textarea whose formatted result
        // renders beneath it as you type. Reuses the dashboard's shared
        // markdown renderer, so the input reads the way the widget output will.
        const wrap = document.createElement('div');
        wrap.className = 'dashboard-field__markdown';
        const ta = document.createElement('textarea');
        ta.className = 'dashboard-field__textarea dashboard-field__markdown-input';
        ta.value = String(current[name] ?? field.default ?? '');
        if (field.placeholder) ta.placeholder = field.placeholder;
        const preview = document.createElement('div');
        // Reuse dashboard-md__body so the preview matches the widget's own
        // rendered output exactly.
        preview.className = 'dashboard-field__markdown-preview dashboard-md__body';
        let rafId = 0;
        const renderPreview = (): void => {
          rafId = 0;
          preview.replaceChildren(renderMarkdownToDom(ta.value));
          preview.classList.toggle('is-empty', ta.value.trim() === '');
        };
        ta.addEventListener('input', () => {
          if (!rafId) rafId = requestAnimationFrame(renderPreview);
        });
        renderPreview();
        wrap.appendChild(ta);
        wrap.appendChild(preview);
        block.appendChild(wrap);
        inputs.set(name, () => ta.value);
      } else if (field.type === 'string-list') {
        addLabelAndHint();
        const ta = document.createElement('textarea');
        ta.className = 'dashboard-field__textarea';
        const value = current[name];
        ta.value = Array.isArray(value)
          ? value.map((v: unknown) => {
              if (typeof v === 'string') return v;
              if (v && typeof v === 'object' && 'label' in v && 'url' in v) {
                const o = v as { label?: unknown; url?: unknown };
                return `${o.label ?? ''} | ${o.url ?? ''}`;
              }
              return '';
            }).join('\n')
          : String(value ?? '');
        if (field.placeholder) ta.placeholder = field.placeholder;
        block.appendChild(ta);
        inputs.set(name, () => ta.value.split('\n').map(s => s.trim()).filter(Boolean));
      } else if (field.type === 'number') {
        addLabelAndHint();
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'dashboard-field__input';
        const v = current[name];
        if (typeof v === 'number' && Number.isFinite(v)) input.value = String(v);
        else if (typeof field.default === 'number') input.value = String(field.default);
        if (field.placeholder) input.placeholder = field.placeholder;
        block.appendChild(input);
        inputs.set(name, () => {
          const v = Number(input.value);
          return Number.isFinite(v) ? v : 0;
        });
      } else {
        // 'string' default
        addLabelAndHint();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'dashboard-field__input';
        input.value = String(current[name] ?? field.default ?? '');
        if (field.placeholder) input.placeholder = field.placeholder;
        block.appendChild(input);
        inputs.set(name, () => input.value);
      }

      body.appendChild(block);
    }

    const foot = el('div', 'dashboard-settings__foot');
    const cancel = el('button', 'dashboard-btn dashboard-btn--ghost');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => overlay.remove());
    foot.appendChild(cancel);
    const save = el('button', 'dashboard-btn dashboard-btn--primary');
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      const next: Record<string, unknown> = {};
      for (const [k, getter] of inputs) next[k] = getter();
      try {
        await this._data.updateWidgetConfig(widgetId, next);
        inst.row = { ...inst.row, config: next };
        inst.configEmitter.fire(next);
      } catch (err) {
        console.error('[Dashboard] updateWidgetConfig failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        await this._api.window.showErrorMessage(`Could not save configuration: ${msg}`);
        return;
      }
      overlay.remove();
    });
    foot.appendChild(save);
    sheet.appendChild(foot);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
  }

  // ── Disposal ───────────────────────────────────────────────────────────

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const inst of this._instances.values()) {
      try { inst.handle?.dispose(); } catch { /* noop */ }
      inst.configEmitter.dispose();
      this._scheduler.cancel(inst.row.id);
    }
    this._instances.clear();
    for (const d of this._disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
    this._disposables.length = 0;
    if (this._root && this._root.parentElement) {
      this._root.remove();
    }
    this._container.classList.remove('dashboard-pane-host');
  }
}
