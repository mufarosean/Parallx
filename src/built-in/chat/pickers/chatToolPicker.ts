// chatToolPicker.ts — Configure Tools dialog (M9 Cap 6 — tool enablement)
//
// Full VS Code-style modal overlay for searching, enabling, and disabling
// tools available to the AI agent.  Opens from the wrench icon in the
// chat input toolbar.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/tools/toolSetsContribution.ts
//   (ConfigureToolSets action — modal tool tree with checkboxes)

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $ } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import type { IToolPickerServices } from '../chatTypes.js';

// IToolPickerServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IToolPickerServices } from '../chatTypes.js';

/** Categorised tool for display. */
interface ToolCategory {
  label: string;
  collapsed: boolean;
  tools: { name: string; description: string; enabled: boolean }[];
}

// ── Component ──

/**
 * The "Configure Tools" dialog.
 *
 * Renders as a centered modal overlay on `document.body` with:
 *   • Title bar — "Configure Tools" + close button
 *   • Search row — filter input + "N Selected" badge + OK button
 *   • Description text
 *   • Scrollable tool tree with checkboxes (grouped by category)
 */
export class ChatToolPicker extends Disposable {
  private _overlay: HTMLElement | undefined;
  private _services: IToolPickerServices | undefined;

  private readonly _onDidClose = this._register(new Emitter<void>());
  readonly onDidClose: Event<void> = this._onDidClose.event;

  /** Bind services (can be called later when services become available). */
  setServices(services: IToolPickerServices): void {
    this._services = services;
  }

  /** Open the dialog. */
  open(): void {
    if (this._overlay || !this._services) { return; }
    this._buildDialog();
  }

  /** Close the dialog. */
  close(): void {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = undefined;
      this._onDidClose.fire();
    }
  }

  /** Whether the dialog is currently open. */
  get isOpen(): boolean {
    return !!this._overlay;
  }

  // ── Private: build the overlay ──

  private _buildDialog(): void {
    const services = this._services!;

    // Backdrop + dialog overlay
    const overlay = $('div.parallx-chat-tool-picker-overlay');
    this._overlay = overlay;

    const backdrop = $('div.parallx-chat-tool-picker-backdrop');
    overlay.appendChild(backdrop);

    const dialog = $('div.parallx-chat-tool-picker-dialog');
    overlay.appendChild(dialog);

    // ── Title bar ──
    const titleBar = $('div.parallx-chat-tool-picker-titlebar');
    const title = $('span.parallx-chat-tool-picker-title', 'Configure Tools');
    titleBar.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'parallx-chat-tool-picker-close';
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = chatIcons.close;
    titleBar.appendChild(closeBtn);
    dialog.appendChild(titleBar);

    // ── Search row ──
    const searchRow = $('div.parallx-chat-tool-picker-search-row');

    const searchWrap = $('div.parallx-chat-tool-picker-search-wrap');
    const searchIcon = $('span.parallx-chat-tool-picker-search-icon');
    searchIcon.innerHTML = chatIcons.search;
    searchWrap.appendChild(searchIcon);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'parallx-chat-tool-picker-search-input';
    searchInput.placeholder = 'Select tools that are available to chat.';
    searchWrap.appendChild(searchInput);
    searchRow.appendChild(searchWrap);

    const badge = $('span.parallx-chat-tool-picker-badge');
    badge.textContent = `${services.getEnabledCount()} Selected`;
    searchRow.appendChild(badge);

    const okBtn = document.createElement('button');
    okBtn.className = 'parallx-chat-tool-picker-ok';
    okBtn.type = 'button';
    okBtn.textContent = 'OK';
    searchRow.appendChild(okBtn);
    dialog.appendChild(searchRow);

    // ── Description ──
    const desc = $('div.parallx-chat-tool-picker-description');
    desc.textContent = 'The selected tools will be applied globally for all chat sessions that use the default agent.';
    dialog.appendChild(desc);

    // ── Tool tree (scrollable) ──
    const treeContainer = $('div.parallx-chat-tool-picker-tree');
    dialog.appendChild(treeContainer);

    // ── State ──
    const collapsedState = new Map<string, boolean>();

    /** Build categorised tool list. */
    const buildCategories = (tools: readonly { name: string; description: string; enabled: boolean }[]): ToolCategory[] => {
      // Group tools into categories.
      // For now: "Pages" (database tools) and "Files" (filesystem tools).
      const pageTools: typeof tools[number][] = [];
      const fileTools: typeof tools[number][] = [];

      for (const tool of tools) {
        if (['list_files', 'read_file', 'search_files'].includes(tool.name)) {
          fileTools.push(tool);
        } else {
          pageTools.push(tool);
        }
      }

      const categories: ToolCategory[] = [];
      if (pageTools.length > 0) {
        categories.push({
          label: 'Pages',
          collapsed: collapsedState.get('Pages') ?? false,
          tools: pageTools,
        });
      }
      if (fileTools.length > 0) {
        categories.push({
          label: 'Files',
          collapsed: collapsedState.get('Files') ?? false,
          tools: fileTools,
        });
      }
      return categories;
    };

    /** Render the tool tree. */
    const renderTree = (query: string): void => {
      treeContainer.innerHTML = '';
      const allTools = services.getTools();
      const q = query.toLowerCase().trim();

      // Filter by search
      const filtered = q
        ? allTools.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
        : [...allTools];

      // Top-level "Built-In" group
      const builtInHeader = $('div.parallx-chat-tool-picker-group-header');

      const builtInChevron = $('span.parallx-chat-tool-picker-chevron');
      const builtInCollapsed = collapsedState.get('Built-In') ?? false;
      builtInChevron.innerHTML = builtInCollapsed ? chatIcons.chevronRight : chatIcons.sectionExpanded;
      builtInHeader.appendChild(builtInChevron);

      // Built-In checkbox (tri-state: all/some/none)
      const builtInCb = document.createElement('input');
      builtInCb.type = 'checkbox';
      builtInCb.className = 'parallx-chat-tool-picker-checkbox';
      const enabledCount = filtered.filter((t) => t.enabled).length;
      builtInCb.checked = enabledCount > 0;
      builtInCb.indeterminate = enabledCount > 0 && enabledCount < filtered.length;
      builtInHeader.appendChild(builtInCb);

      const builtInLabel = $('span.parallx-chat-tool-picker-group-label', 'Built-In');
      builtInHeader.appendChild(builtInLabel);
      treeContainer.appendChild(builtInHeader);

      // Toggle collapse on header click (not checkbox)
      builtInHeader.addEventListener('click', (e) => {
        if (e.target === builtInCb) { return; }
        collapsedState.set('Built-In', !builtInCollapsed);
        renderTree(searchInput.value);
      });

      // Built-In checkbox toggles all tools
      builtInCb.addEventListener('change', () => {
        const enable = builtInCb.checked;
        for (const tool of allTools) {
          services.setToolEnabled(tool.name, enable);
        }
        renderTree(searchInput.value);
        updateBadge();
      });

      if (builtInCollapsed && !q) {
        return; // Don't render sub-items when collapsed (unless searching)
      }

      // Sub-categories
      const categories = buildCategories(filtered);
      for (const cat of categories) {
        const catHeader = $('div.parallx-chat-tool-picker-cat-header');

        const catChevron = $('span.parallx-chat-tool-picker-chevron');
        catChevron.innerHTML = cat.collapsed ? chatIcons.chevronRight : chatIcons.sectionExpanded;
        catHeader.appendChild(catChevron);

        // Category checkbox
        const catCb = document.createElement('input');
        catCb.type = 'checkbox';
        catCb.className = 'parallx-chat-tool-picker-checkbox';
        const catEnabled = cat.tools.filter((t) => t.enabled).length;
        catCb.checked = catEnabled > 0;
        catCb.indeterminate = catEnabled > 0 && catEnabled < cat.tools.length;
        catHeader.appendChild(catCb);

        const catLabel = $('span.parallx-chat-tool-picker-cat-label', cat.label);
        catHeader.appendChild(catLabel);

        const catDesc = $('span.parallx-chat-tool-picker-cat-desc');
        catDesc.textContent = `${cat.tools.length} tool${cat.tools.length !== 1 ? 's' : ''}`;
        catHeader.appendChild(catDesc);

        treeContainer.appendChild(catHeader);

        // Toggle category collapse
        catHeader.addEventListener('click', (e) => {
          if (e.target === catCb) { return; }
          collapsedState.set(cat.label, !cat.collapsed);
          renderTree(searchInput.value);
        });

        // Category checkbox toggles all tools in category
        catCb.addEventListener('change', () => {
          const enable = catCb.checked;
          for (const tool of cat.tools) {
            services.setToolEnabled(tool.name, enable);
          }
          renderTree(searchInput.value);
          updateBadge();
        });

        // Individual tools (if not collapsed)
        if (!cat.collapsed || q) {
          for (const tool of cat.tools) {
            const toolRow = $('div.parallx-chat-tool-picker-tool-row');

            const toolCb = document.createElement('input');
            toolCb.type = 'checkbox';
            toolCb.className = 'parallx-chat-tool-picker-checkbox';
            toolCb.checked = tool.enabled;
            toolRow.appendChild(toolCb);

            const toolInfo = $('div.parallx-chat-tool-picker-tool-info');

            const toolName = $('span.parallx-chat-tool-picker-tool-name', tool.name);
            toolInfo.appendChild(toolName);

            const toolDesc = $('span.parallx-chat-tool-picker-tool-desc');
            toolDesc.textContent = `\u2014 ${tool.description}`;
            toolInfo.appendChild(toolDesc);

            toolRow.appendChild(toolInfo);
            treeContainer.appendChild(toolRow);

            // Toggle individual tool
            toolCb.addEventListener('change', () => {
              services.setToolEnabled(tool.name, toolCb.checked);
              renderTree(searchInput.value);
              updateBadge();
            });

            // Clicking the row also toggles
            toolRow.addEventListener('click', (e) => {
              if (e.target === toolCb) { return; }
              toolCb.checked = !toolCb.checked;
              services.setToolEnabled(tool.name, toolCb.checked);
              renderTree(searchInput.value);
              updateBadge();
            });
          }
        }
      }
    };

    /** Update the "N Selected" badge. */
    const updateBadge = (): void => {
      badge.textContent = `${services.getEnabledCount()} Selected`;
    };

    // ── Initial render ──
    renderTree('');

    // ── Event wiring ──

    // Search filter
    searchInput.addEventListener('input', () => {
      renderTree(searchInput.value);
    });

    // Close button
    closeBtn.addEventListener('click', () => this.close());

    // OK button
    okBtn.addEventListener('click', () => this.close());

    // Backdrop click
    backdrop.addEventListener('click', () => this.close());

    // Escape key
    const escHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        this.close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Service changes (e.g. tools registered/unregistered externally)
    const changeDisposable = services.onDidChangeTools(() => {
      if (this._overlay) {
        renderTree(searchInput.value);
        updateBadge();
      }
    });

    // Cleanup on close
    const origClose = this.close.bind(this);
    this.close = () => {
      document.removeEventListener('keydown', escHandler);
      changeDisposable.dispose();
      this.close = origClose;
      origClose();
    };

    // Mount
    document.body.appendChild(overlay);

    // Focus search input
    requestAnimationFrame(() => searchInput.focus());
  }

  override dispose(): void {
    this.close();
    super.dispose();
  }
}
