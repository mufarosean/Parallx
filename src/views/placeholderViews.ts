// placeholderViews.ts — test / dummy views for development
import { View, IView, ViewState } from './view.js';
import { IViewDescriptor, ViewDescriptorBuilder } from './viewDescriptor.js';

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
    this._dimensionBadge = document.createElement('div');
    this._dimensionBadge.style.cssText =
      'position:absolute;top:4px;right:8px;font-size:10px;color:#6a6a6a;' +
      'font-family:monospace;pointer-events:none;z-index:1;';
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
    container.style.padding = '8px';
    container.style.color = '#cccccc';
    container.style.fontSize = '13px';
    container.style.backgroundColor = '#252526';

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
      const row = document.createElement('div');
      row.style.paddingLeft = `${item.indent * 16}px`;
      row.style.lineHeight = '22px';
      row.style.cursor = 'pointer';
      row.textContent = `${item.icon} ${item.label}`;
      row.addEventListener('mouseenter', () => { row.style.backgroundColor = '#2a2d2e'; });
      row.addEventListener('mouseleave', () => { row.style.backgroundColor = 'transparent'; });
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
    container.style.padding = '8px';
    container.style.color = '#cccccc';
    container.style.fontSize = '13px';
    container.style.backgroundColor = '#1e1e1e';

    // Search input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search…';
    input.style.width = '100%';
    input.style.padding = '6px 8px';
    input.style.border = '1px solid #3c3c3c';
    input.style.borderRadius = '2px';
    input.style.backgroundColor = '#3c3c3c';
    input.style.color = '#cccccc';
    input.style.marginBottom = '8px';
    input.style.fontSize = '13px';
    input.style.outline = 'none';
    input.style.boxSizing = 'border-box';
    container.appendChild(input);

    // Mock results
    const results = [
      { file: 'main.ts', line: 12, text: 'const workbench = new Workbench();' },
      { file: 'view.ts', line: 45, text: 'abstract createViewContent(...)' },
      { file: 'grid.ts', line: 88, text: 'addView(view, sizing, ...)' },
    ];

    const list = document.createElement('div');
    list.style.marginTop = '4px';
    for (const r of results) {
      const item = document.createElement('div');
      item.style.lineHeight = '22px';
      item.style.paddingLeft = '4px';
      item.style.cursor = 'pointer';
      item.innerHTML = `<span style="color:#4ec9b0">${r.file}</span>` +
        `<span style="color:#6a9955">:${r.line}</span> ` +
        `<span style="color:#9cdcfe">${r.text}</span>`;
      item.addEventListener('mouseenter', () => { item.style.backgroundColor = '#2a2d2e'; });
      item.addEventListener('mouseleave', () => { item.style.backgroundColor = 'transparent'; });
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
    container.style.padding = '8px 12px';
    container.style.fontFamily = "'Cascadia Code', 'Consolas', monospace";
    container.style.fontSize = '13px';
    container.style.lineHeight = '20px';
    container.style.backgroundColor = '#1e1e1e';
    container.style.color = '#cccccc';

    const lines = [
      '<span style="color:#6a9955">$</span> npm run build',
      '<span style="color:#569cd6">esbuild</span> src/main.ts → dist/renderer/main.js',
      '  <span style="color:#4ec9b0">✔</span> built in 48ms',
      '',
      '<span style="color:#6a9955">$</span> npm start',
      '<span style="color:#569cd6">Electron</span> starting...',
      '  <span style="color:#4ec9b0">✔</span> window ready (1280×800)',
      '',
      '<span style="color:#6a9955">$</span> <span style="animation:blink 1s step-end infinite">▋</span>',
    ];

    for (const line of lines) {
      const row = document.createElement('div');
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
    container.style.padding = '8px 12px';
    container.style.fontFamily = "'Cascadia Code', 'Consolas', monospace";
    container.style.fontSize = '12px';
    container.style.lineHeight = '18px';
    container.style.backgroundColor = '#1e1e1e';
    container.style.color = '#858585';
    container.style.overflowY = 'auto';

    const entries = [
      '[Info  - 10:01:23] Lifecycle service initialized',
      '[Info  - 10:01:24] Layout renderer: rendering default layout',
      '[Info  - 10:01:24] Part registry: 6 parts created',
      '[Info  - 10:01:25] View manager: 4 descriptors registered',
      '[Debug - 10:01:25] Storage: loaded 0 persisted keys',
      '[Info  - 10:01:26] Workbench ready in 312ms',
    ];

    for (const entry of entries) {
      const row = document.createElement('div');
      row.style.whiteSpace = 'pre';
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
 * Placeholder "Chat" view for the auxiliary bar (secondary sidebar).
 * Demonstrates extension-like views that open in the right-side panel,
 * similar to Copilot Chat in VS Code.
 */
export class ChatPlaceholderView extends PlaceholderView {

  constructor() {
    super('view.chat', 'Chat', 'codicon-comment-discussion');
  }

  get minimumWidth(): number { return 200; }
  get maximumWidth(): number { return 800; }
  get minimumHeight(): number { return 100; }
  get maximumHeight(): number { return Number.POSITIVE_INFINITY; }

  protected override createPlaceholderContent(container: HTMLElement): void {
    container.style.padding = '12px';
    container.style.color = '#cccccc';
    container.style.fontSize = '13px';
    container.style.backgroundColor = '#252526';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100%';

    // Chat history area
    const chatHistory = document.createElement('div');
    chatHistory.style.flex = '1';
    chatHistory.style.overflowY = 'auto';
    chatHistory.style.marginBottom = '8px';

    const messages = [
      { role: 'assistant', text: 'Hello! I can help you with your code. Ask me anything.' },
      { role: 'user', text: 'How do I create a new view?' },
      { role: 'assistant', text: 'Create a class extending PlaceholderView, register a descriptor with ViewDescriptorBuilder, and add it to the ViewManager.' },
    ];

    for (const msg of messages) {
      const bubble = document.createElement('div');
      bubble.style.padding = '8px 12px';
      bubble.style.marginBottom = '8px';
      bubble.style.borderRadius = '6px';
      bubble.style.lineHeight = '1.4';
      bubble.style.maxWidth = '90%';

      if (msg.role === 'user') {
        bubble.style.backgroundColor = '#1a4b8c';
        bubble.style.marginLeft = 'auto';
        bubble.style.color = '#e0e0e0';
      } else {
        bubble.style.backgroundColor = '#2d2d2d';
        bubble.style.color = '#cccccc';
      }

      bubble.textContent = msg.text;
      chatHistory.appendChild(bubble);
    }
    container.appendChild(chatHistory);

    // Input area
    const inputRow = document.createElement('div');
    inputRow.style.display = 'flex';
    inputRow.style.gap = '6px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Ask a question…';
    input.style.flex = '1';
    input.style.padding = '8px 10px';
    input.style.border = '1px solid #3c3c3c';
    input.style.borderRadius = '4px';
    input.style.backgroundColor = '#3c3c3c';
    input.style.color = '#cccccc';
    input.style.fontSize = '13px';
    input.style.outline = 'none';
    input.style.boxSizing = 'border-box';
    inputRow.appendChild(input);

    const sendBtn = document.createElement('button');
    sendBtn.textContent = '→';
    sendBtn.style.width = '36px';
    sendBtn.style.background = '#007acc';
    sendBtn.style.color = 'white';
    sendBtn.style.border = 'none';
    sendBtn.style.borderRadius = '4px';
    sendBtn.style.cursor = 'pointer';
    sendBtn.style.fontSize = '16px';
    inputRow.appendChild(sendBtn);

    container.appendChild(inputRow);
  }

  protected override saveViewState(): Record<string, unknown> {
    return { messages: [] };
  }
}

export const chatViewDescriptor: IViewDescriptor = ViewDescriptorBuilder
  .create('view.chat', 'Chat')
  .icon('codicon-comment-discussion')
  .container('auxiliaryBar')
  .order(1)
  .constraints({ minimumWidth: 200, maximumWidth: 800, minimumHeight: 100, maximumHeight: Number.POSITIVE_INFINITY })
  .factory(() => new ChatPlaceholderView())
  .build();

/**
 * All auxiliary bar view descriptors.
 */
export const allAuxiliaryBarViewDescriptors: readonly IViewDescriptor[] = [
  chatViewDescriptor,
];