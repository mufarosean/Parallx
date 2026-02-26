// databaseEditorProvider.ts — Database editor pane (full-page context)
//
// Provides the editor provider registered via
// `api.editors.registerEditorProvider('database', ...)`.
// Each editor pane builds a page-header chrome and delegates the database
// view engine to DatabaseViewHost — the single shared rendering component.
//
// Dependencies: platform/ (lifecycle), editor/ (editorInput — type-only),
// ui/ (dom), databaseRegistry (gate import)

import { Disposable, type IDisposable } from '../../../platform/lifecycle.js';
import type { IEditorInput } from '../../../editor/editorInput.js';
import { $ } from '../../../ui/dom.js';
import {
  DatabaseViewHost,
  svgIcon,
  type IDatabaseDataService,
  type OpenEditorFn,
} from './databaseRegistry.js';

import './database.css';

// ─── Database Editor Provider ────────────────────────────────────────────────

export class DatabaseEditorProvider {
  private _openEditor: OpenEditorFn | undefined;

  constructor(private readonly _dataService: IDatabaseDataService) {}

  /**
   * Set the openEditor callback so panes can navigate to row pages.
   */
  setOpenEditor(fn: OpenEditorFn): void {
    this._openEditor = fn;
  }

  /**
   * Create an editor pane for a database.
   *
   * @param container — DOM element to render into
   * @param input — the ToolEditorInput (input.id === databaseId)
   */
  createEditorPane(container: HTMLElement, input?: IEditorInput): IDisposable {
    const databaseId = input?.id ?? '';
    const databaseName = input?.name ?? 'Database';
    const pane = new DatabaseEditorPane(
      container,
      databaseId,
      databaseName,
      this._dataService,
      this._openEditor,
    );
    pane.init().catch(err => {
      console.error('[DatabaseEditorProvider] Pane init failed:', err);
    });
    return pane;
  }
}

// ─── Database Editor Pane ────────────────────────────────────────────────────

class DatabaseEditorPane extends Disposable {
  private _disposed = false;
  private _wrapper: HTMLElement | null = null;
  private _host: DatabaseViewHost | null = null;
  private _emptyState: HTMLElement | null = null;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _databaseId: string,
    private readonly _databaseName: string,
    private readonly _dataService: IDatabaseDataService,
    private readonly _openEditor: OpenEditorFn | undefined,
  ) {
    super();
  }

  // ─── Initialization ──────────────────────────────────────────────────

  async init(): Promise<void> {
    // Build layout skeleton
    this._wrapper = $('div.database-editor');
    this._container.appendChild(this._wrapper);

    // Page header (icon + title)
    const pageHeader = $('div.database-editor-page-header');
    const pageTitleRow = $('div.database-editor-page-title-row');
    const pageIcon = $('span.database-editor-page-icon');
    pageIcon.innerHTML = svgIcon('database');
    const pageTitle = $('h1.database-editor-page-title');
    pageTitle.textContent = this._databaseName;
    pageTitleRow.appendChild(pageIcon);
    pageTitleRow.appendChild(pageTitle);
    pageHeader.appendChild(pageTitleRow);
    this._wrapper.appendChild(pageHeader);

    // Slots for DatabaseViewHost
    const tabBarSlot = $('div.database-editor-toolbar');
    this._wrapper.appendChild(tabBarSlot);

    const toolbarSlot = $('div.database-editor-toolbar-buttons');
    this._wrapper.appendChild(toolbarSlot);

    const toolbarPanelsSlot = $('div.database-editor-toolbar-panels');
    this._wrapper.appendChild(toolbarPanelsSlot);

    const contentSlot = $('div.database-editor-content');
    this._wrapper.appendChild(contentSlot);

    // Create the shared view host
    this._host = this._register(new DatabaseViewHost({
      databaseId: this._databaseId,
      dataService: this._dataService,
      openEditor: this._openEditor,
      slots: {
        tabBar: tabBarSlot,
        toolbar: toolbarSlot,
        toolbarPanels: toolbarPanelsSlot,
        content: contentSlot,
      },
    }));

    this._register(this._host.onDidFailLoad(message => {
      this._showEmptyState(message);
    }));

    await this._host.load();
  }

  // ─── Empty State ─────────────────────────────────────────────────────

  private _showEmptyState(message: string): void {
    if (this._emptyState) {
      this._emptyState.textContent = message;
      return;
    }
    this._emptyState = $('div.database-empty-state');
    this._emptyState.textContent = message;
    (this._wrapper ?? this._container).appendChild(this._emptyState);
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._host = null;

    if (this._wrapper) {
      this._wrapper.remove();
      this._wrapper = null;
    }

    super.dispose();
  }
}
