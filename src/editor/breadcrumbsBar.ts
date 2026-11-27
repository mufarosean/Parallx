// breadcrumbsBar.ts — file-path breadcrumbs for an editor group
//
// Mirrors VS Code's BreadcrumbsControl + BreadcrumbsModel:
//   src/vs/workbench/browser/parts/editor/breadcrumbsControl.ts
//   src/vs/workbench/browser/parts/editor/breadcrumbsModel.ts
//
// Architecture:
//  - One BreadcrumbsBar per EditorGroupView
//  - Shows the file path of the active editor as clickable segments
//  - Each segment is a folder in the path from workspace root → file
//  - Clicking a segment fires an event (for future: show picker dropdown)
//  - A tab with a trail of its own (editorTrail.ts: a tool's place) shows
//    that instead, each crumb going to its place in the same tab
//  - Updates automatically when the active editor changes
//
// DOM structure:
//   .breadcrumbs-control
//     .parallx-breadcrumbs (from BreadcrumbsWidget)
//       .parallx-breadcrumb-item  (×N, one per path segment)

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { URI } from '../platform/uri.js';
import { BreadcrumbsWidget, BreadcrumbsItem } from '../ui/breadcrumbs.js';
import type { IEditorInput } from '../editor/editorInput.js';
import { $ } from '../ui/dom.js';
import { createList } from '../ui/kit.js';
import { createIconElement, getFileTypeIcon, getFolderIcon } from '../ui/iconRegistry.js';
import { createBlock } from '../ui/block.js';
import { trailSourceOf, type IEditorTrailCrumb } from './editorTrail.js';
import { ContextMenu } from '../ui/contextMenu.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const BREADCRUMBS_HEIGHT = 26; // The canvas ribbon's height too: a path strip, not a toolbar

const FOLDER_ICON_SVG = getFolderIcon();

// ─── FileElement ─────────────────────────────────────────────────────────────

/**
 * Represents a single segment in the file path breadcrumbs.
 * Mirrors VS Code's FileElement in breadcrumbsModel.ts.
 */
interface FileElement {
  readonly uri: URI;
  readonly kind: 'file' | 'folder' | 'root-folder';
  readonly label: string;
}

// ─── FileBreadcrumbItem ──────────────────────────────────────────────────────

/**
 * Concrete BreadcrumbsItem for a file path segment.
 * Mirrors VS Code's FileItem in breadcrumbsControl.ts.
 */
class FileBreadcrumbItem extends BreadcrumbsItem {
  constructor(
    readonly element: FileElement,
    private readonly _showIcon: boolean,
  ) {
    super();
  }

  dispose(): void {
    // No resources to clean up
  }

  equals(other: BreadcrumbsItem): boolean {
    if (!(other instanceof FileBreadcrumbItem)) return false;
    return this.element.uri.equals(other.element.uri);
  }

  render(container: HTMLElement): void {
    // Icon — codicon-style SVG for folders and files
    if (this._showIcon) {
      const icon = $('span');
      icon.className = 'breadcrumb-icon';
      if (this.element.kind === 'file') {
        const extMatch = this.element.label.match(/\.([a-zA-Z0-9]+)$/);
        icon.innerHTML = getFileTypeIcon(extMatch ? extMatch[1] : '');
      } else {
        icon.innerHTML = FOLDER_ICON_SVG;
      }
      container.appendChild(icon);
    }

    // Label text
    const label = $('span');
    label.className = 'breadcrumb-label';
    label.textContent = this.element.label;
    container.appendChild(label);

    // CSS class for styling based on kind
    container.classList.add(this.element.kind);
  }
}

// ─── TrailBreadcrumbItem ──────────────────────────────────────────────────────

/**
 * A crumb of a tab's own trail (editorTrail.ts): a tool's tab names the tool,
 * then the place it is on. Pressing it goes there in the same tab.
 */
class TrailBreadcrumbItem extends BreadcrumbsItem {
  constructor(readonly crumb: IEditorTrailCrumb) {
    super();
  }

  dispose(): void { /* nothing held */ }

  equals(other: BreadcrumbsItem): boolean {
    return other instanceof TrailBreadcrumbItem && other.crumb.label === this.crumb.label && other.crumb.address === this.crumb.address;
  }

  render(container: HTMLElement): void {
    if (this.crumb.icon) container.appendChild(createIconElement(this.crumb.icon, 14)).classList.add('breadcrumb-icon');
    createBlock(container, 'span', { className: 'breadcrumb-label', text: this.crumb.label });
    container.classList.add('trail');
    if (this.crumb.address) container.dataset.address = this.crumb.address;
    if (this.crumb.current) {
      container.classList.add('current');
      container.setAttribute('aria-current', 'location');
    }
  }
}

// ─── BreadcrumbsBar ──────────────────────────────────────────────────────────

/**
 * Breadcrumbs bar for a single editor group.
 *
 * Reads the active editor's URI, breaks it into path segments relative
 * to the workspace folder, and displays them in a BreadcrumbsWidget.
 *
 * Mirrors VS Code: BreadcrumbsControl creates BreadcrumbsModel, which
 * produces FileElement[] via _initFilePathInfo(), then wraps each in a
 * FileItem and calls widget.setItems().
 */
export class BreadcrumbsBar extends Disposable {
  static readonly HEIGHT = BREADCRUMBS_HEIGHT;

  readonly domNode: HTMLDivElement;

  private readonly _widget: BreadcrumbsWidget;

  private _workspaceFolderUris: URI[] = [];
  private _isVisible = false;

  // ── Events ──

  private readonly _onDidSelectSegment = this._register(new Emitter<FileElement>());
  /**
   * Fires when the user clicks a breadcrumb path segment.
   * Consumers can use this to navigate in the explorer or open a picker.
   */
  readonly onDidSelectSegment: Event<FileElement> = this._onDidSelectSegment.event;

  private readonly _onDidVisibilityChange = this._register(new Emitter<boolean>());
  readonly onDidVisibilityChange: Event<boolean> = this._onDidVisibilityChange.event;

  /** The input whose own trail is watched, and the watch: a move redraws the bar. */
  private _watched: IEditorInput | undefined;
  private _trailWatch: { dispose(): void } | undefined;

  /** `onTrailChange`: the group's ribbon redraws (and lays out) when the shown tab's trail changes. */
  constructor(container: HTMLElement, private readonly _onTrailChange?: (input: IEditorInput) => void) {
    super();
    this._register({ dispose: () => this._trailWatch?.dispose() });

    // .breadcrumbs-control wrapper (matches VS Code's DOM class)
    this.domNode = $('div');
    this.domNode.classList.add('breadcrumbs-control');
    this.domNode.style.height = `${BREADCRUMBS_HEIGHT}px`;
    this.domNode.style.minHeight = `${BREADCRUMBS_HEIGHT}px`;
    container.appendChild(this.domNode);

    // Widget
    this._widget = this._register(new BreadcrumbsWidget(this.domNode));
    // In the scene the path is one list; its segments, rebuilt for each file, are its rows.
    this._register(createList(this._widget.domNode, {
      id: 'editor.breadcrumbs', label: 'Path',
      rows: () => Array.from(this._widget.domNode.querySelectorAll<HTMLElement>('.parallx-breadcrumb-item')),
      selected: () => [],
    }));

    // When a breadcrumb item is selected, fire our event; a trail's crumb goes to its place
    this._register(this._widget.onDidSelectItem((e) => {
      if (e.item instanceof FileBreadcrumbItem) {
        this._onDidSelectSegment.fire(e.item.element);
      } else if (e.item instanceof TrailBreadcrumbItem) {
        const payload = e.payload as { ctrlKey?: boolean; metaKey?: boolean } | undefined;
        e.item.crumb.open?.({ newTab: !!(payload?.ctrlKey || payload?.metaKey) });
      }
    }));

    // A trail's crumb is a place link: its menu offers Open in Its Own Tab.
    const onMenu = (e: MouseEvent) => {
      const node = (e.target as HTMLElement | null)?.closest<HTMLElement>('.parallx-breadcrumb-item');
      const items = this._widget.getItems();
      const at = node ? Array.from(this._widget.domNode.children).indexOf(node) : -1;
      const item = at >= 0 ? items[at] : undefined;
      if (!(item instanceof TrailBreadcrumbItem) || !item.crumb.open) return;
      e.preventDefault();
      const r = node!.getBoundingClientRect();
      const menu = ContextMenu.show({
        items: [
          { id: 'open', label: 'Open', group: '1_open', order: 10 },
          { id: 'openInOwnTab', label: 'Open in Its Own Tab', keybinding: 'Ctrl+Click', group: '1_open', order: 20 },
        ],
        anchor: e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left, y: r.bottom },
      });
      menu.onDidSelect(({ item: chosen }) => item.crumb.open?.({ newTab: chosen.id === 'openInOwnTab' }));
    };
    this._widget.domNode.addEventListener('contextmenu', onMenu);
    this._register({ dispose: () => this._widget.domNode.removeEventListener('contextmenu', onMenu) });

    // Start hidden — shown when an editor with a resource is active
    this.hide();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Tell the breadcrumbs bar about the workspace folders so it can compute
   * relative paths. Call this once during initialization and whenever
   * workspace folders change.
   */
  setWorkspaceFolders(folders: readonly { uri: URI; name: string }[]): void {
    this._workspaceFolderUris = folders.map(f => f.uri);
  }

  /**
   * Update the breadcrumbs to reflect the given editor input.
   * If the input has no URI, the breadcrumbs bar hides itself.
   *
   * VS Code equivalent: BreadcrumbsControl.update() + BreadcrumbsModel._initFilePathInfo()
   */
  update(input: IEditorInput | undefined): boolean {
    const wasVisible = this._isVisible;

    if (!input) {
      this.hide();
      return wasVisible !== this._isVisible;
    }

    // A tab with its own trail (a tool's place) shows that, and follows it.
    if (input !== this._watched) {
      this._trailWatch?.dispose();
      this._watched = input;
      this._trailWatch = trailSourceOf(input)?.onDidChangeTrail(() => { if (this._watched === input) this._onTrailChange?.(input); });
    }
    const trail = trailSourceOf(input)?.trail;
    if (trail?.length) {
      this.show();
      this._widget.setItems(trail.map((c) => new TrailBreadcrumbItem(c)));
      this._widget.revealLast();
      return wasVisible !== this._isVisible;
    }

    // Extract URI from input — all concrete inputs have a .uri getter
    const uri = (input as any).uri as URI | undefined;
    if (!uri || uri.scheme === 'untitled') {
      this.hide();
      return wasVisible !== this._isVisible;
    }

    // Build path elements
    const elements = this._buildPathElements(uri);

    if (elements.length === 0) {
      this.hide();
      return wasVisible !== this._isVisible;
    }

    // Show and render
    this.show();

    const items = elements.map(el => new FileBreadcrumbItem(el, el.kind === 'file'));
    this._widget.setItems(items);
    this._widget.revealLast();

    return wasVisible !== this._isVisible;
  }

  show(): void {
    if (this._isVisible) return;
    this._isVisible = true;
    this.domNode.classList.remove('hidden');
    this._onDidVisibilityChange.fire(true);
  }

  hide(): void {
    if (!this._isVisible) return;
    this._isVisible = false;
    this.domNode.classList.add('hidden');
    this._widget.setItems([]);
    this._onDidVisibilityChange.fire(false);
  }

  get isVisible(): boolean {
    return this._isVisible;
  }

  /**
   * Returns the current breadcrumbs height.
   * When hidden, returns 0.
   */
  get effectiveHeight(): number {
    return this._isVisible ? BREADCRUMBS_HEIGHT : 0;
  }

  // ── Path Building ──────────────────────────────────────────────────────

  /**
   * Build the file path elements from a URI.
   *
   * VS Code equivalent: BreadcrumbsModel._initFilePathInfo()
   *
   * Walks up from the file to the workspace root, building an array
   * of FileElements (folder → folder → ... → file).
   */
  private _buildPathElements(uri: URI): FileElement[] {
    const elements: FileElement[] = [];

    // Find the matching workspace folder
    const workspaceFolder = this._findWorkspaceFolder(uri);

    // Walk up from the file URI to the workspace folder (or root)
    let current: URI | undefined = uri;
    while (current && current.path !== '/' && current.path !== '') {
      // Stop at the workspace folder boundary
      if (workspaceFolder && current.equals(workspaceFolder)) {
        break;
      }

      const isFile = current.equals(uri);
      elements.unshift({
        uri: current,
        kind: isFile ? 'file' : 'folder',
        label: current.basename || current.path,
      });

      current = current.dirname;
    }

    // The workspace folder itself is not a crumb: the status bar names it,
    // and repeating it first pushed the file's own path to the right.

    return elements;
  }

  /**
   * Find which workspace folder (if any) contains the given URI.
   * Returns the folder URI if found, or undefined.
   */
  private _findWorkspaceFolder(uri: URI): URI | undefined {
    if (this._workspaceFolderUris.length === 0) return undefined;

    const uriPath = uri.path.toLowerCase();
    let bestMatch: URI | undefined;
    let bestLength = 0;

    for (const folderUri of this._workspaceFolderUris) {
      const folderPath = folderUri.path.toLowerCase();
      // Check if the URI is under this folder
      if (uriPath.startsWith(folderPath) && folderPath.length > bestLength) {
        // Ensure it's a proper path prefix (ends at a / boundary)
        const nextChar = uriPath[folderPath.length];
        if (!nextChar || nextChar === '/') {
          bestMatch = folderUri;
          bestLength = folderPath.length;
        }
      }
    }

    return bestMatch;
  }
}
