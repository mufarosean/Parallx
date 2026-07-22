// tableWidget.ts — a table (with optional bar chart) over a spreadsheet or
// CSV file in the workspace (M86 C3).
//
// The first real consumer of the `xlsx` capability: the main process parses
// .csv/.tsv/.xlsx/.xls via the dashboard:readTable bridge (the renderer's fs
// bridge is utf-8-only, so binary workbooks can't be read here) and the
// widget renders rows plus an optional inline bar chart for one numeric
// column. Spreadsheets are how people already store their lives —
// practice-exam scores for one person, a net-worth ledger or utility bills
// for another. Refresh re-reads the file; pair with an interval policy for
// a file that changes.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface TableConfig {
  readonly filePath: string;
  readonly sheet: string;
  readonly maxRows: number;
  readonly chartColumn: string;
  readonly labelColumn: string;
}

const DEFAULT_CONFIG: TableConfig = { filePath: '', sheet: '', maxRows: 10, chartColumn: '', labelColumn: '' };

interface TableData {
  readonly header: string[];
  readonly rows: string[][];
  readonly sheetNames?: string[];
  readonly totalRows?: number;
}

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

interface WorkspaceApi {
  workspace?: { workspaceFolders?: readonly { uri: string }[] };
}

interface ReadTableBridge {
  dashboardAssets?: {
    readTable?(filePath: string, opts?: { sheet?: string; maxRows?: number }): Promise<
      { header: string[]; rows: string[][]; sheetNames: string[]; totalRows: number } | { error: string }
    >;
  };
}

function normalize(raw: unknown): TableConfig {
  const cfg = (raw ?? {}) as Partial<TableConfig>;
  const maxRows = Math.floor(Number(cfg.maxRows));
  return {
    filePath: typeof cfg.filePath === 'string' ? cfg.filePath.trim() : '',
    sheet: typeof cfg.sheet === 'string' ? cfg.sheet.trim() : '',
    maxRows: Number.isFinite(maxRows) ? Math.max(1, Math.min(100, maxRows)) : DEFAULT_CONFIG.maxRows,
    chartColumn: typeof cfg.chartColumn === 'string' ? cfg.chartColumn.trim() : '',
    labelColumn: typeof cfg.labelColumn === 'string' ? cfg.labelColumn.trim() : '',
  };
}

/** Resolve a workspace-relative (or absolute) path to an absolute fs path. */
function resolveFilePath(api: unknown, filePath: string): string {
  // Absolute already? (drive letter or unix root)
  if (/^([a-zA-Z]:[\\/]|\/)/.test(filePath)) return filePath;
  const folders = (api as WorkspaceApi).workspace?.workspaceFolders;
  const rootUri = folders && folders.length > 0 ? folders[0].uri : '';
  if (!rootUri.startsWith('file:///')) return filePath;
  const root = decodeURIComponent(rootUri.slice(8)).replace(/\//g, '\\');
  const rel = filePath.replace(/\//g, '\\').replace(/^\\+/, '');
  // Unix roots decode to a leading path segment without a drive letter.
  const sep = root.includes(':') ? '\\' : '/';
  return sep === '/' ? `/${root}/${rel}`.replace(/\\/g, '/') : `${root}\\${rel}`;
}

export const TABLE_WIDGET: WidgetTypeRegistration<TableConfig> = {
  typeId: 'parallx.dashboard.table',
  displayName: 'Table / chart',
  description: 'Rows from a spreadsheet or CSV in your workspace, with an optional bar chart column. Practice scores for one person, a budget ledger for another.',
  icon: ICON_SVG,
  category: 'query',
  defaultSize: { colSpan: 6, rowSpan: 4 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      filePath: {
        type: 'string',
        label: 'File',
        description: 'Workspace-relative path to a .csv, .tsv, .xlsx, or .xls file.',
        placeholder: 'Results/scores.xlsx',
      },
      sheet: {
        type: 'string',
        label: 'Sheet (optional)',
        description: 'Sheet name for workbooks. Empty = first sheet.',
      },
      maxRows: {
        type: 'number',
        label: 'Rows to show',
        description: '1-100.',
      },
      chartColumn: {
        type: 'string',
        label: 'Chart column (optional)',
        description: 'Header of a numeric column to render as inline bars.',
      },
      labelColumn: {
        type: 'string',
        label: 'Label column (optional)',
        description: 'Header of the column that names each bar. Empty = first column.',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  async refresh(ctx: WidgetRefreshContext<TableConfig>): Promise<string> {
    const cfg = normalize(ctx.config);
    if (!cfg.filePath) {
      throw new Error('No file configured. Open settings and point this widget at a .csv or .xlsx in your workspace.');
    }
    const bridge = (globalThis as unknown as { parallxElectron?: ReadTableBridge }).parallxElectron;
    const readTable = bridge?.dashboardAssets?.readTable;
    if (!readTable) throw new Error('Table reading is not available in this shell.');
    const abs = resolveFilePath(ctx.api, cfg.filePath);
    const result = await readTable(abs, { sheet: cfg.sheet || undefined, maxRows: cfg.maxRows });
    if ('error' in result) throw new Error(result.error);
    return JSON.stringify(result);
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<TableConfig>): WidgetHandle {
    container.classList.add('dtable');
    let cfg = normalize(ctx.config);

    const host = document.createElement('div');
    host.className = 'dtable__host';
    container.appendChild(host);

    function paint(cached: string | null): void {
      host.innerHTML = '';
      let data: TableData | null = null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as TableData;
          if (parsed && Array.isArray(parsed.header) && Array.isArray(parsed.rows)) data = parsed;
        } catch { /* malformed */ }
      }
      if (!data) {
        const empty = document.createElement('div');
        empty.className = 'dtable__empty';
        empty.innerHTML = '<strong>No data yet</strong><p>Point this widget at a spreadsheet in settings, then refresh.</p>';
        host.appendChild(empty);
        return;
      }

      const { header, rows } = data;

      // Optional bar chart for one numeric column.
      const chartIdx = cfg.chartColumn ? header.findIndex((h) => h.toLowerCase() === cfg.chartColumn.toLowerCase()) : -1;
      if (chartIdx >= 0) {
        const labelIdx = cfg.labelColumn
          ? Math.max(0, header.findIndex((h) => h.toLowerCase() === cfg.labelColumn.toLowerCase()))
          : 0;
        const values = rows.map((r) => Number(String(r[chartIdx] ?? '').replace(/[$,%\s]/g, '')));
        const usable = values.filter((v) => Number.isFinite(v));
        if (usable.length > 0) {
          const maxV = Math.max(...usable.map(Math.abs), 0.0001);
          const chart = document.createElement('div');
          chart.className = 'dtable__chart';
          rows.forEach((r, i) => {
            const v = values[i];
            if (!Number.isFinite(v)) return;
            const rowEl = document.createElement('div');
            rowEl.className = 'dtable__chartrow';
            const lab = document.createElement('span');
            lab.className = 'dtable__chartlabel';
            lab.textContent = String(r[labelIdx] ?? `#${i + 1}`);
            rowEl.appendChild(lab);
            const bar = document.createElement('span');
            bar.className = 'dtable__bar';
            bar.style.width = `${Math.max(2, Math.round((Math.abs(v) / maxV) * 100))}%`;
            rowEl.appendChild(bar);
            const val = document.createElement('span');
            val.className = 'dtable__chartvalue';
            val.textContent = String(r[chartIdx]);
            rowEl.appendChild(val);
            chart.appendChild(rowEl);
          });
          host.appendChild(chart);
        }
      }

      const table = document.createElement('table');
      table.className = 'dtable__table';
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const h of header) {
        const th = document.createElement('th');
        th.textContent = h;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const r of rows) {
        const tr = document.createElement('tr');
        for (let i = 0; i < header.length; i++) {
          const td = document.createElement('td');
          td.textContent = String(r[i] ?? '');
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      host.appendChild(table);

      if (typeof data.totalRows === 'number' && data.totalRows > rows.length) {
        const more = document.createElement('div');
        more.className = 'dtable__more';
        more.textContent = `Showing ${rows.length} of ${data.totalRows} rows`;
        host.appendChild(more);
      }
    }

    paint(ctx.cachedOutput);
    const sub = ctx.onDidChangeConfig((next) => {
      cfg = normalize(next);
      ctx.requestRefresh();
    });

    return {
      refreshFromCache(cached: string | null) { paint(cached); },
      renderError(message: string | null) {
        if (!message) { paint(ctx.cachedOutput); return; }
        host.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'dtable__empty';
        const strong = document.createElement('strong');
        strong.textContent = 'Couldn’t read the file';
        const p = document.createElement('p');
        p.textContent = message;
        err.appendChild(strong);
        err.appendChild(p);
        host.appendChild(err);
      },
      dispose() { sub.dispose(); },
    };
  },
};
