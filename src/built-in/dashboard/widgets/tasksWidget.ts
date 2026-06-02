// tasksWidget.ts — an interactive checklist widget.
//
// Add items, check them off, delete them. The full list is serialized as JSON
// and persisted in `cached_output` via ctx.setCachedOutput (same self-owned
// store the notes / image widgets use), so the checklist survives reloads with
// no extra storage column. No refresh handler — the list is purely user-owned.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface TaskItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

interface TasksConfig {
  /** Hide checked-off items instead of striking them through. */
  readonly hideCompleted: boolean;
}

const DEFAULT_CONFIG: TasksConfig = { hideCompleted: false };

const MAX_ITEMS = 200;
const MAX_TEXT_CHARS = 500;

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

function normalizeConfig(raw: unknown): TasksConfig {
  const cfg = (raw ?? {}) as Partial<TasksConfig>;
  return { hideCompleted: cfg.hideCompleted === true };
}

function parseItems(cached: string | null): TaskItem[] {
  if (!cached) return [];
  try {
    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        id: typeof x.id === 'string' ? x.id : genId(),
        text: typeof x.text === 'string' ? x.text.slice(0, MAX_TEXT_CHARS) : '',
        done: x.done === true,
      }))
      .filter((it) => it.text.length > 0)
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function genId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const TASKS_WIDGET: WidgetTypeRegistration<TasksConfig> = {
  typeId: 'parallx.dashboard.tasks',
  displayName: 'Task list',
  description: 'A simple checklist. Add items, tick them off, delete them. Persists across reloads.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 4 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      hideCompleted: {
        type: 'boolean',
        label: 'Hide completed items',
        description: 'When on, checked items disappear instead of showing struck through.',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<TasksConfig>): WidgetHandle {
    container.classList.add('tkw');
    let config = normalizeConfig(ctx.config);
    let items: TaskItem[] = parseItems(ctx.cachedOutput);

    const list = document.createElement('div');
    list.className = 'tkw__list';

    const addRow = document.createElement('form');
    addRow.className = 'tkw__add';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tkw__input';
    input.placeholder = 'Add a task…';
    input.maxLength = MAX_TEXT_CHARS;
    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.className = 'tkw__add-btn';
    addBtn.title = 'Add task';
    addBtn.textContent = '+';
    addRow.appendChild(input);
    addRow.appendChild(addBtn);

    container.appendChild(list);
    container.appendChild(addRow);

    function persist(): void {
      ctx.setCachedOutput(JSON.stringify(items));
    }

    function paint(): void {
      list.innerHTML = '';
      const visible = config.hideCompleted ? items.filter((it) => !it.done) : items;

      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tkw__empty';
        const allDone = items.length > 0 && items.every((it) => it.done);
        empty.innerHTML = allDone
          ? '<strong>All done</strong><p>Every task is checked off. Nice.</p>'
          : '<strong>No tasks yet</strong><p>Type below and press Enter to add one.</p>';
        list.appendChild(empty);
        return;
      }

      const done = visible.filter((it) => it.done).length;
      const summary = document.createElement('div');
      summary.className = 'tkw__summary';
      summary.textContent = `${done}/${visible.length} done`;
      list.appendChild(summary);

      for (const it of visible) {
        const row = document.createElement('div');
        row.className = 'tkw__row' + (it.done ? ' tkw__row--done' : '');

        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'tkw__check';
        check.setAttribute('aria-label', it.done ? 'Mark as not done' : 'Mark as done');
        check.setAttribute('aria-pressed', String(it.done));
        check.innerHTML = it.done
          ? '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 4"/></svg>'
          : '';
        check.addEventListener('click', () => {
          items = items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x));
          persist();
          paint();
        });

        const label = document.createElement('span');
        label.className = 'tkw__label';
        label.textContent = it.text;

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'tkw__del';
        del.title = 'Delete task';
        del.setAttribute('aria-label', 'Delete task');
        del.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>';
        del.addEventListener('click', () => {
          items = items.filter((x) => x.id !== it.id);
          persist();
          paint();
        });

        row.appendChild(check);
        row.appendChild(label);
        row.appendChild(del);
        list.appendChild(row);
      }
    }

    addRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      if (items.length >= MAX_ITEMS) return;
      items = [...items, { id: genId(), text: value.slice(0, MAX_TEXT_CHARS), done: false }];
      input.value = '';
      persist();
      paint();
    });

    const sub = ctx.onDidChangeConfig((next) => {
      config = normalizeConfig(next);
      paint();
    });

    paint();

    return {
      refreshFromCache(cached: string | null) {
        items = parseItems(cached);
        paint();
      },
      dispose() { sub.dispose(); },
    };
  },
};
