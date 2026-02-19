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

// ─── Constants ───────────────────────────────────────────────────────────────

export const BREADCRUMBS_HEIGHT = 22; // VS Code: BreadcrumbsControl.HEIGHT = 22

// Codicon-style SVG icons (16×16 viewBox, currentColor, matches project convention)
const FOLDER_ICON_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 2.5H6L7.5 4H14.5V13.5H1.5V2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const FILE_ICON_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.5 1H3.5C3.22 1 3 1.22 3 1.5V14.5C3 14.78 3.22 15 3.5 15H12.5C12.78 15 13 14.78 13 14.5V3.5L10.5 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 1V4H13" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

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
        icon.innerHTML = FILE_ICON_SVG;
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

  constructor(container: HTMLElement) {
    super();

    // .breadcrumbs-control wrapper (matches VS Code's DOM class)
    this.domNode = $('div');
    this.domNode.classList.add('breadcrumbs-control');
    this.domNode.style.height = `${BREADCRUMBS_HEIGHT}px`;
    this.domNode.style.minHeight = `${BREADCRUMBS_HEIGHT}px`;
    container.appendChild(this.domNode);

    // Widget
    this._widget = this._register(new BreadcrumbsWidget(this.domNode));

    // When a breadcrumb item is selected, fire our event
    this._register(this._widget.onDidSelectItem((e) => {
      if (e.item instanceof FileBreadcrumbItem) {
        this._onDidSelectSegment.fire(e.item.element);
      }
    }));

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

    const items = elements.map(el => new FileBreadcrumbItem(el, true));
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

    // If we found a workspace folder, prepend it as root
    if (workspaceFolder) {
      elements.unshift({
        uri: workspaceFolder,
        kind: 'root-folder',
        label: workspaceFolder.basename || 'Workspace',
      });
    }

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
