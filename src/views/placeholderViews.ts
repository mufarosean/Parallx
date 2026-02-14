// placeholderViews.ts — test / dummy views for development
import { View } from './view.js';
import { IViewDescriptor, ViewDescriptorBuilder } from './viewDescriptor.js';
import { $ } from '../ui/dom.js';

// ─── Logging base class ─────────────────────────────────────────────────────

/**
 * Shared base for all placeholder views.
 * — Logs every lifecycle transition to console.
 * — Shows a small dimension badge in the top-right corner.
 */
abstract class PlaceholderView extends View {

  private _dimensionBadge: HTMLElement | undefined;

  /** Subclasses override this instead of `createViewContent`. */
  protected abstract createPlaceholderContent(container: HTMLElement): void;

  protected override createViewContent(container: HTMLElement): void {
    console.log(`[View:${this.id}] createViewContent`);

    // Dimension badge
    this._dimensionBadge = $('div');
    this._dimensionBadge.classList.add('placeholder-dimension-badge');
    container.appendChild(this._dimensionBadge);

    this.createPlaceholderContent(container);
  }

  override setVisible(visible: boolean): void {
    console.log(`[View:${this.id}] setVisible(${visible})`);
    super.setVisible(visible);
  }

  protected override layoutContent(width: number, height: number): void {
    console.log(`[View:${this.id}] layout(${width}×${height})`);
    if (this._dimensionBadge) {
      this._dimensionBadge.textContent = `${width}×${height}`;
    }
  }

  override focus(): void {
    console.log(`[View:${this.id}] focus`);
    super.focus();
  }

  override dispose(): void {
    console.log(`[View:${this.id}] dispose`);
    super.dispose();
  }
}

// ─── Explorer View ───────────────────────────────────────────────────────────

/**
 * A simple placeholder view that mimics a file explorer tree.
 * min-width: 170px, max-width: 800px
 */
export class ExplorerPlaceholderView extends PlaceholderView {

  constructor() {
    super('view.explorer', 'Explorer', 'codicon-files');
  }

  get minimumWidth(): number { return 170; }
  get maximumWidth(): number { return 800; }
  get minimumHeight(): number { return 100; }
  get maximumHeight(): number { return Number.POSITIVE_INFINITY; }

  protected override createPlaceholderContent(container: HTMLElement): void {
    container.classList.add('placeholder-explorer');

    const tree = [
      { label: 'src', indent: 0, icon: '📁' },
      { label: 'main.ts', indent: 1, icon: '📄' },
      { label: 'workbench.css', indent: 1, icon: '🎨' },
      { label: 'platform', indent: 1, icon: '📁' },
      { label: 'types.ts', indent: 2, icon: '📄' },
      { label: 'lifecycle.ts', indent: 2, icon: '📄' },
      { label: 'views', indent: 1, icon: '📁' },
      { label: 'view.ts', indent: 2, icon: '📄' },
      { label: 'viewContainer.ts', indent: 2, icon: '📄' },
      { label: 'docs', indent: 0, icon: '📁' },
      { label: 'package.json', indent: 0, icon: '📄' },
      { label: 'tsconfig.json', indent: 0, icon: '⚙️' },
    ];

    for (const item of tree) {
      const row = $('div');
      row.classList.add('placeholder-tree-row');
      row.style.paddingLeft = `${item.indent * 16}px`;
      row.textContent = `${item.icon} ${item.label}`;
      container.appendChild(row);
    }
  }

  protected override saveViewState(): Record<string, unknown> {
    return { scrollPosition: 0 };
  }
}

export const explorerViewDescriptor: IViewDescriptor = ViewDescriptorBuilder
  .create('view.explorer', 'Explorer')
  .icon('codicon-files')
  .container('sidebar')
  .order(1)
  .constraints({ minimumWidth: 170, maximumWidth: 800, minimumHeight: 100, maximumHeight: Number.POSITIVE_INFINITY })
  .factory(() => new ExplorerPlaceholderView())
  .build();

// ─── Search View ─────────────────────────────────────────────────────────────

/**
 * A placeholder search view with a text input and mock results.
 * min-width: 200px, max-width: 600px
 */
export class SearchPlaceholderView extends PlaceholderView {

  constructor() {
    super('view.search', 'Search', 'codicon-search');
  }

  get minimumWidth(): number { return 200; }
  get maximumWidth(): number { return 600; }
  get minimumHeight(): number { return 120; }
  get maximumHeight(): number { return Number.POSITIVE_INFINITY; }

  protected override createPlaceholderContent(container: HTMLElement): void {
    container.classList.add('placeholder-search-container');

    // Search input
    const input = $('input');
    input.type = 'text';
    input.placeholder = 'Search…';
    input.classList.add('placeholder-search-input');
    container.appendChild(input);

    // Mock results
    const results = [
      { file: 'main.ts', line: 12, text: 'const workbench = new Workbench();' },
      { file: 'view.ts', line: 45, text: 'abstract createViewContent(...)' },
      { file: 'grid.ts', line: 88, text: 'addView(view, sizing, ...)' },
    ];

    const list = $('div');
    list.classList.add('placeholder-search-results');
    for (const r of results) {
      const item = $('div');
      item.classList.add('placeholder-search-result-item');
      item.innerHTML = `<span class="placeholder-search-result-file">${r.file}</span>` +
        `<span class="placeholder-search-result-line">:${r.line}</span> ` +
        `<span class="placeholder-search-result-text">${r.text}</span>`;
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  protected override saveViewState(): Record<string, unknown> {
    return { query: '' };
  }
}

export const searchViewDescriptor: IViewDescriptor = ViewDescriptorBuilder
  .create('view.search', 'Search')
  .icon('codicon-search')
  .container('sidebar')
  .order(2)
  .constraints({ minimumWidth: 200, maximumWidth: 600, minimumHeight: 120, maximumHeight: Number.POSITIVE_INFINITY })
  .factory(() => new SearchPlaceholderView())
  .build();

// ─── Terminal View ───────────────────────────────────────────────────────────

/**
 * A fixed-height mock terminal view.
 * min-height: 100px, max-height: 500px
 */
export class TerminalPlaceholderView extends PlaceholderView {

  constructor() {
    super('view.terminal', 'Terminal', 'codicon-terminal');
  }

  get minimumWidth(): number { return 200; }
  get maximumWidth(): number { return Number.POSITIVE_INFINITY; }
  get minimumHeight(): number { return 100; }
  get maximumHeight(): number { return 500; }

  protected override createPlaceholderContent(container: HTMLElement): void {
    container.classList.add('placeholder-terminal');

    const lines = [
      '<span class="placeholder-terminal-prompt">$</span> npm run build',
      '<span class="placeholder-terminal-cmd">esbuild</span> src/main.ts → dist/renderer/main.js',
      '  <span class="placeholder-terminal-ok">✔</span> built in 48ms',
      '',
      '<span class="placeholder-terminal-prompt">$</span> npm start',
      '<span class="placeholder-terminal-cmd">Electron</span> starting...',
      '  <span class="placeholder-terminal-ok">✔</span> window ready (1280×800)',
      '',
      '<span class="placeholder-terminal-prompt">$</span> <span style="animation:blink 1s step-end infinite">▋</span>',
    ];

    for (const line of lines) {
      const row = $('div');
      row.innerHTML = line || '&nbsp;';
      container.appendChild(row);
    }
  }

  protected override saveViewState(): Record<string, unknown> {
    return { history: [] };
  }
}

export const terminalViewDescriptor: IViewDescriptor = ViewDescriptorBuilder
  .create('view.terminal', 'Terminal')
  .icon('codicon-terminal')
  .container('panel')
  .order(1)
  .constraints({ minimumWidth: 200, maximumWidth: Number.POSITIVE_INFINITY, minimumHeight: 100, maximumHeight: 500 })
  .factory(() => new TerminalPlaceholderView())
  .build();

// ─── Output View ─────────────────────────────────────────────────────────────

/**
 * A read-only log/output view for the panel area.
 */
export class OutputPlaceholderView extends PlaceholderView {

  constructor() {
    super('view.output', 'Output', 'codicon-output');
  }

  get minimumWidth(): number { return 200; }
  get maximumWidth(): number { return Number.POSITIVE_INFINITY; }
  get minimumHeight(): number { return 80; }
  get maximumHeight(): number { return 400; }

  protected override createPlaceholderContent(container: HTMLElement): void {
    container.classList.add('placeholder-output');

    const entries = [
      '[Info  - 10:01:23] Lifecycle service initialized',
      '[Info  - 10:01:24] Layout renderer: rendering default layout',
      '[Info  - 10:01:24] Part registry: 6 parts created',
      '[Info  - 10:01:25] View manager: 4 descriptors registered',
      '[Debug - 10:01:25] Storage: loaded 0 persisted keys',
      '[Info  - 10:01:26] Workbench ready in 312ms',
    ];

    for (const entry of entries) {
      const row = $('div');
      row.classList.add('placeholder-output-line');
      row.textContent = entry;
      container.appendChild(row);
    }
  }

  protected override saveViewState(): Record<string, unknown> {
    return { channel: 'default' };
  }
}

export const outputViewDescriptor: IViewDescriptor = ViewDescriptorBuilder
  .create('view.output', 'Output')
  .icon('codicon-output')
  .container('panel')
  .order(2)
  .constraints({ minimumWidth: 200, maximumWidth: Number.POSITIVE_INFINITY, minimumHeight: 80, maximumHeight: 400 })
  .factory(() => new OutputPlaceholderView())
  .build();

// ─── All descriptors (convenience) ──────────────────────────────────────────

/**
 * All placeholder view descriptors for sidebar and panel.
 */
export const allPlaceholderViewDescriptors: readonly IViewDescriptor[] = [
  explorerViewDescriptor,
  searchViewDescriptor,
  terminalViewDescriptor,
  outputViewDescriptor,
];

// ─── Auxiliary Bar Views ────────────────────────────────────────────────────

/**
 * Auxiliary bar view descriptors.
 * Empty for now — extensions will register their views here in later milestones.
 */
export const allAuxiliaryBarViewDescriptors: readonly IViewDescriptor[] = [];