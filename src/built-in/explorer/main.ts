// Explorer Built-In Tool — main activation entry point
//
// Implements:
//   • File tree view (Task 3.2) — expandable/collapsible directory tree
//   • Open Editors view (Task 3.3) — list of open editor tabs
//   • Context menu (Task 3.4) — right-click file operations via ui/ContextMenu
//   • Keyboard navigation and inline rename/create
//
// VS Code reference:
//   src/vs/workbench/contrib/files/browser/views/explorerViewer.ts
//   src/vs/workbench/contrib/files/browser/explorerService.ts

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { ContextMenu, type IContextMenuItem } from '../../ui/contextMenu.js';

// ─── Types (avoid circular imports) ──────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: Record<string, unknown>): IDisposable;
    setBadge(containerId: string, badge: { count?: number; dot?: boolean } | undefined): void;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  workspace: {
    readonly workspaceFolders: readonly { uri: string; name: string; index: number }[] | undefined;
    getWorkspaceFolder(uri: string): { uri: string; name: string; index: number } | undefined;
    readonly onDidChangeWorkspaceFolders: (listener: (e: { added: readonly { uri: string; name: string; index: number }[]; removed: readonly { uri: string; name: string; index: number }[] }) => void) => IDisposable;
    readonly name: string | undefined;
    readonly fs?: {
      readFile(uri: string): Promise<{ content: string; encoding: string }>;
      writeFile(uri: string, content: string): Promise<void>;
      stat(uri: string): Promise<{ type: number; size: number; mtime: number }>;
      readdir(uri: string): Promise<{ name: string; type: number }[]>;
      exists(uri: string): Promise<boolean>;
      rename(source: string, target: string): Promise<void>;
      delete(uri: string, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void>;
      mkdir(uri: string): Promise<void>;
    };
    getConfiguration(section?: string): { get<T>(key: string, defaultValue?: T): T | undefined; has(key: string): boolean };
    readonly onDidChangeConfiguration: (listener: (e: { affectsConfiguration(section: string): boolean }) => void) => IDisposable;
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showInputBox(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
  };
  context: {
    createContextKey<T extends string | number | boolean | undefined>(name: string, defaultValue: T): { key: string; get(): T; set(value: T): void; reset(): void };
  };
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
    openFileEditor(uri: string, options?: { pinned?: boolean }): Promise<void>;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;
const INDENT_PX = 20;
const EXPAND_STATE_KEY = 'explorer.expandedPaths';

// ─── Tree Node Model ─────────────────────────────────────────────────────────

interface TreeNode {
  uri: string;
  name: string;
  type: number; // FILE_TYPE_FILE or FILE_TYPE_DIRECTORY
  depth: number;
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  children: TreeNode[];
  parent: TreeNode | null;
  element?: HTMLElement;
}

// ─── State ───────────────────────────────────────────────────────────────────

let _api: ParallxApi;
let _context: ToolContext;
let _showHidden = true;
let _selectedNode: TreeNode | null = null;
let _roots: TreeNode[] = [];
let _treeContainer: HTMLElement | null = null;
let _openEditorsContainer: HTMLElement | null = null;
let _openEditorsCountKey: ReturnType<ParallxApi['context']['createContextKey']>;
let _activeContextMenu: ContextMenu | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  _api = api;
  _context = context;

  // Context key for open editors count
  _openEditorsCountKey = api.context.createContextKey('openEditorsCount', 0);

  // Register view providers
  context.subscriptions.push(
    api.views.registerViewProvider('view.explorer', {
      createView(container: HTMLElement): IDisposable {
        return createExplorerView(container);
      },
    }),
  );

  context.subscriptions.push(
    api.views.registerViewProvider('view.openEditors', {
      createView(container: HTMLElement): IDisposable {
        return createOpenEditorsView(container);
      },
    }),
  );

  // Register commands
  registerCommands(api, context);

  // Subscribe to folder changes
  context.subscriptions.push(
    api.workspace.onDidChangeWorkspaceFolders(() => {
      rebuildTree();
    }),
  );
}

export function deactivate(): void {
  _activeContextMenu?.dismiss();
  _activeContextMenu = null;
  _roots = [];
  _selectedNode = null;
  _treeContainer = null;
  _openEditorsContainer = null;
}

// ─── Explorer View ───────────────────────────────────────────────────────────

function createExplorerView(container: HTMLElement): IDisposable {
  container.classList.add('explorer-tree');
  container.setAttribute('role', 'tree');
  container.tabIndex = 0;

  _treeContainer = container;

  // Keyboard navigation
  container.addEventListener('keydown', handleTreeKeydown);
  // Context menu
  container.addEventListener('contextmenu', handleContextMenu);

  // Initial build
  rebuildTree();

  return {
    dispose() {
      container.removeEventListener('keydown', handleTreeKeydown);
      container.removeEventListener('contextmenu', handleContextMenu);
      _treeContainer = null;
    },
  };
}

// ─── Tree Building ───────────────────────────────────────────────────────────

function rebuildTree(): void {
  if (!_treeContainer) return;

  const folders = _api.workspace.workspaceFolders;
  _roots = [];

  if (!folders || folders.length === 0) {
    _treeContainer.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'explorer-empty';
    empty.textContent = 'No folder opened. Open a folder to start.';

    const openBtn = document.createElement('button');
    openBtn.className = 'explorer-empty-open-btn';
    openBtn.textContent = 'Open Folder';
    openBtn.addEventListener('click', () => {
      _api.commands.executeCommand('workspace.openFolder');
    });
    empty.appendChild(openBtn);
    _treeContainer.appendChild(empty);
    return;
  }

  // Load expanded state from storage
  const savedExpanded = _context.workspaceState.get<string[]>(EXPAND_STATE_KEY) ?? [];
  const expandedSet = new Set(savedExpanded);

  // Create root nodes
  for (const folder of folders) {
    const node: TreeNode = {
      uri: folder.uri,
      name: folder.name,
      type: FILE_TYPE_DIRECTORY,
      depth: folders.length > 1 ? 0 : -1, // single folder: children start at depth 0
      expanded: expandedSet.has(folder.uri) || folders.length === 1, // auto-expand single root
      loaded: false,
      loading: false,
      children: [],
      parent: null,
    };
    _roots.push(node);
  }

  renderTree();

  // Kick off lazy loading for expanded roots
  for (const root of _roots) {
    if (root.expanded && !root.loaded) {
      loadChildren(root);
    }
  }
}

function renderTree(): void {
  if (!_treeContainer) return;
  _treeContainer.innerHTML = '';

  for (const root of _roots) {
    if (root.depth === -1) {
      // Single folder: render children directly at depth 0
      if (root.loaded) {
        for (const child of root.children) {
          renderNodeFlat(_treeContainer!, child);
        }
      } else if (root.loading) {
        const loadingEl = createLoadingElement(0);
        _treeContainer.appendChild(loadingEl);
      }
    } else {
      renderNodeFlat(_treeContainer, root);
    }
  }
}

function renderNodeFlat(container: HTMLElement, node: TreeNode): void {
  const depth = Math.max(0, node.depth);
  const el = document.createElement('div');
  el.className = 'tree-node';
  if (_selectedNode === node) {
    el.classList.add('tree-node--selected');
  }
  el.setAttribute('role', 'treeitem');
  el.setAttribute('data-uri', node.uri);
  // Computed layout dimension — allowed inline per project rules
  el.style.paddingLeft = `${depth * INDENT_PX + 4}px`;

  // Chevron for directories
  if (node.type === FILE_TYPE_DIRECTORY) {
    const chevron = document.createElement('span');
    chevron.className = 'tree-node-chevron';
    chevron.textContent = node.expanded ? '▾' : '▸';
    el.appendChild(chevron);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'tree-node-spacer';
    el.appendChild(spacer);
  }

  // Icon
  const icon = document.createElement('span');
  icon.className = 'tree-node-icon';
  icon.textContent = node.type === FILE_TYPE_DIRECTORY ? '📁' : '📄';
  el.appendChild(icon);

  // Label
  const label = document.createElement('span');
  label.className = 'tree-node-label';
  label.textContent = node.name;
  el.appendChild(label);

  node.element = el;

  // Click handlers
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    selectNode(node);
    if (node.type === FILE_TYPE_DIRECTORY) {
      toggleExpand(node);
    } else {
      // Single click: preview
      openFile(node, false);
    }
  });

  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (node.type === FILE_TYPE_FILE) {
      openFile(node, true); // pinned
    }
  });

  container.appendChild(el);

  // Render children if expanded
  if (node.type === FILE_TYPE_DIRECTORY && node.expanded) {
    if (node.loading && !node.loaded) {
      container.appendChild(createLoadingElement(depth + 1));
    } else if (node.loaded && node.children.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'tree-empty-dir';
      // Computed layout dimension
      emptyEl.style.paddingLeft = `${(depth + 1) * INDENT_PX + 20}px`;
      emptyEl.textContent = '(empty)';
      container.appendChild(emptyEl);
    } else {
      for (const child of node.children) {
        renderNodeFlat(container, child);
      }
    }
  }
}

function createLoadingElement(depth: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tree-loading';
  // Computed layout dimension
  el.style.paddingLeft = `${depth * INDENT_PX + 20}px`;
  el.textContent = '...';
  return el;
}

// ─── Tree Operations ─────────────────────────────────────────────────────────

function selectNode(node: TreeNode): void {
  // Deselect previous
  if (_selectedNode?.element) {
    _selectedNode.element.classList.remove('tree-node--selected');
  }
  _selectedNode = node;
  if (node.element) {
    node.element.classList.add('tree-node--selected');
    node.element.scrollIntoView({ block: 'nearest' });
  }
}

async function toggleExpand(node: TreeNode): Promise<void> {
  if (node.type !== FILE_TYPE_DIRECTORY) return;

  node.expanded = !node.expanded;

  if (node.expanded && !node.loaded) {
    await loadChildren(node);
  }

  renderTree();
  saveExpandState();
}

async function loadChildren(node: TreeNode): Promise<void> {
  if (node.loaded || node.loading) return;
  node.loading = true;
  renderTree(); // show loading indicator

  try {
    const entries = await readDirectory(node.uri);
    node.children = entries
      .filter(e => _showHidden || !e.name.startsWith('.'))
      .sort(sortEntries)
      .map(e => ({
        uri: joinUri(node.uri, e.name),
        name: e.name,
        type: e.type,
        depth: node.depth + 1,
        expanded: false,
        loaded: false,
        loading: false,
        children: [],
        parent: node,
      }));
    node.loaded = true;
  } catch (err) {
    console.error('[Explorer] Failed to load directory:', node.uri, err);
    node.children = [];
    node.loaded = true;
  }

  node.loading = false;
  renderTree();
}

function sortEntries(a: { name: string; type: number }, b: { name: string; type: number }): number {
  // Directories first
  if (a.type === FILE_TYPE_DIRECTORY && b.type !== FILE_TYPE_DIRECTORY) return -1;
  if (a.type !== FILE_TYPE_DIRECTORY && b.type === FILE_TYPE_DIRECTORY) return 1;
  // Alphabetical (case-insensitive)
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

function openFile(node: TreeNode, pinned: boolean): void {
  if (node.type !== FILE_TYPE_FILE) return;
  _api.editors.openFileEditor(node.uri, { pinned });
}

function saveExpandState(): void {
  const expanded: string[] = [];
  function collect(nodes: TreeNode[]): void {
    for (const n of nodes) {
      if (n.expanded) {
        expanded.push(n.uri);
        collect(n.children);
      }
    }
  }
  collect(_roots);
  _context.workspaceState.update(EXPAND_STATE_KEY, expanded);
}

// ─── URI ↔ Path Helpers ──────────────────────────────────────────────────────

/**
 * Convert a `file:///` URI string to an OS filesystem path.
 * e.g. `file:///D:/project/src` → `D:/project/src`
 *      `file:///home/user/proj` → `/home/user/proj`
 * If the string is already a filesystem path, returns it unchanged.
 */
function uriToFsPath(uri: string): string {
  if (!uri.startsWith('file:///')) return uri;
  // Strip scheme.  On Windows: file:///D:/foo → D:/foo
  //                On Linux:   file:///home   → /home
  const raw = uri.slice('file:///'.length);
  // If it looks like a Windows drive letter (e.g. D:/...), keep as-is
  if (/^[a-zA-Z]:/.test(raw)) return raw;
  // Otherwise it's a Unix path — prepend the leading /
  return '/' + raw;
}

// ─── Filesystem Helpers ──────────────────────────────────────────────────────

async function readDirectory(uri: string): Promise<{ name: string; type: number }[]> {
  const electronFs = (globalThis as any).parallxElectron?.fs;
  if (electronFs) {
    try {
      const result = await electronFs.readdir(uriToFsPath(uri));
      // IPC returns { entries: [...], error: null } or { error: {...} }
      if (result.error) {
        console.error('[Explorer] readdir error:', result.error);
        return [];
      }
      const entries: { name: string; type: string }[] = result.entries ?? result;
      return entries.map(e => ({
        name: e.name,
        type: e.type === 'directory' ? FILE_TYPE_DIRECTORY : FILE_TYPE_FILE,
      }));
    } catch (err) {
      console.error('[Explorer] readdir failed:', err);
      return [];
    }
  }
  return [];
}

function joinUri(base: string, name: string): string {
  if (base.startsWith('file:///')) {
    // Always use forward slashes inside file:/// URIs
    const cleaned = base.endsWith('/') ? base.slice(0, -1) : base;
    return cleaned + '/' + name;
  }
  const sep = base.includes('\\') ? '\\' : '/';
  return base + sep + name;
}

async function fsCreateFile(parentUri: string, name: string): Promise<void> {
  const electronFs = (globalThis as any).parallxElectron?.fs;
  if (!electronFs) return;
  const childPath = uriToFsPath(joinUri(parentUri, name));
  await electronFs.writeFile(childPath, '');
}

async function fsCreateFolder(parentUri: string, name: string): Promise<void> {
  const electronFs = (globalThis as any).parallxElectron?.fs;
  if (!electronFs) return;
  const childPath = uriToFsPath(joinUri(parentUri, name));
  await electronFs.mkdir(childPath);
}

async function fsDelete(uri: string): Promise<void> {
  const electronFs = (globalThis as any).parallxElectron?.fs;
  if (!electronFs) return;
  await electronFs.delete(uriToFsPath(uri), { recursive: true, useTrash: true });
}

async function fsRename(oldUri: string, newUri: string): Promise<void> {
  const electronFs = (globalThis as any).parallxElectron?.fs;
  if (!electronFs) return;
  await electronFs.rename(uriToFsPath(oldUri), uriToFsPath(newUri));
}

// ─── Keyboard Navigation ─────────────────────────────────────────────────────

function handleTreeKeydown(e: KeyboardEvent): void {
  const allNodes = getAllVisibleNodes();
  const idx = _selectedNode ? allNodes.indexOf(_selectedNode) : -1;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (idx < allNodes.length - 1) selectNode(allNodes[idx + 1]);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (idx > 0) selectNode(allNodes[idx - 1]);
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (_selectedNode?.type === FILE_TYPE_DIRECTORY && !_selectedNode.expanded) {
        toggleExpand(_selectedNode);
      }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (_selectedNode?.type === FILE_TYPE_DIRECTORY && _selectedNode.expanded) {
        toggleExpand(_selectedNode);
      } else if (_selectedNode?.parent) {
        selectNode(_selectedNode.parent);
      }
      break;
    case 'Enter':
      e.preventDefault();
      if (_selectedNode) {
        if (_selectedNode.type === FILE_TYPE_DIRECTORY) {
          toggleExpand(_selectedNode);
        } else {
          openFile(_selectedNode, true);
        }
      }
      break;
  }
}

function getAllVisibleNodes(): TreeNode[] {
  const result: TreeNode[] = [];
  function collect(nodes: TreeNode[]): void {
    for (const n of nodes) {
      if (n.depth >= 0) result.push(n);
      if (n.expanded) collect(n.children);
    }
  }
  for (const root of _roots) {
    if (root.depth === -1) {
      if (root.expanded) collect(root.children);
    } else {
      result.push(root);
      if (root.expanded) collect(root.children);
    }
  }
  return result;
}

// ─── Context Menu (uses src/ui/ContextMenu) ──────────────────────────────────

function handleContextMenu(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();

  // Find the node under the cursor
  const target = (e.target as HTMLElement).closest('.tree-node') as HTMLElement | null;
  let node: TreeNode | null = null;
  if (target) {
    const uri = target.getAttribute('data-uri');
    node = uri ? findNodeByUri(uri) : null;
    if (node) selectNode(node);
  }

  showContextMenu(e.clientX, e.clientY, node);
}

function findNodeByUri(uri: string): TreeNode | null {
  function find(nodes: TreeNode[]): TreeNode | null {
    for (const n of nodes) {
      if (n.uri === uri) return n;
      const found = find(n.children);
      if (found) return found;
    }
    return null;
  }
  return find(_roots);
}

function showContextMenu(x: number, y: number, node: TreeNode | null): void {
  // Dismiss any existing context menu
  _activeContextMenu?.dismiss();
  _activeContextMenu = null;

  const items: IContextMenuItem[] = [];

  if (node) {
    if (node.type === FILE_TYPE_FILE) {
      items.push({ id: 'open', label: 'Open', group: '1_open' });
      items.push({ id: 'rename', label: 'Rename', group: '2_edit' });
      items.push({ id: 'delete', label: 'Delete', group: '2_edit' });
      items.push({ id: 'copyPath', label: 'Copy Path', group: '3_copy' });
    } else {
      items.push({ id: 'newFile', label: 'New File...', group: '1_create' });
      items.push({ id: 'newFolder', label: 'New Folder...', group: '1_create' });
      items.push({ id: 'rename', label: 'Rename', group: '2_edit' });
      items.push({ id: 'delete', label: 'Delete', group: '2_edit' });
      items.push({ id: 'copyPath', label: 'Copy Path', group: '3_copy' });
      if (node.expanded) {
        items.push({ id: 'collapseAll', label: 'Collapse All', group: '4_collapse' });
      }
    }
  } else {
    items.push({ id: 'newFile', label: 'New File...', group: '1_create' });
    items.push({ id: 'newFolder', label: 'New Folder...', group: '1_create' });
    items.push({ id: 'refresh', label: 'Refresh', group: '2_refresh' });
  }

  const menu = ContextMenu.show({
    items,
    anchor: { x, y },
    className: 'explorer-context-menu',
  });

  _activeContextMenu = menu;

  menu.onDidSelect(({ item }) => {
    switch (item.id) {
      case 'open': if (node) openFile(node, true); break;
      case 'newFile': startInlineCreate(node ?? getActiveRoot(), 'file'); break;
      case 'newFolder': startInlineCreate(node ?? getActiveRoot(), 'folder'); break;
      case 'rename': if (node) startInlineRename(node); break;
      case 'delete': if (node) confirmDelete(node); break;
      case 'copyPath': if (node) copyToClipboard(uriToPath(node.uri)); break;
      case 'collapseAll': if (node) collapseAll(node); break;
      case 'refresh': refreshTree(); break;
    }
  });

  menu.onDidDismiss(() => {
    _activeContextMenu = null;
  });
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file:///')) {
    return uri.slice(8).replace(/\//g, '\\');
  }
  return uri;
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(err => {
    console.error('[Explorer] Failed to copy to clipboard:', err);
  });
}

function getActiveRoot(): TreeNode | null {
  if (_roots.length === 0) return null;
  if (_selectedNode) {
    let n: TreeNode | null = _selectedNode;
    while (n?.parent) n = n.parent;
    return n;
  }
  return _roots[0];
}

function collapseAll(node: TreeNode): void {
  function collapse(n: TreeNode): void {
    n.expanded = false;
    for (const c of n.children) collapse(c);
  }
  collapse(node);
  renderTree();
  saveExpandState();
}

function refreshTree(): void {
  function unload(nodes: TreeNode[]): void {
    for (const n of nodes) {
      n.loaded = false;
      n.children = [];
      unload(n.children);
    }
  }
  unload(_roots);
  for (const root of _roots) {
    root.loaded = false;
    root.children = [];
    if (root.expanded) {
      loadChildren(root);
    }
  }
  renderTree();
}

// ─── Inline Rename / Create ──────────────────────────────────────────────────

function startInlineRename(node: TreeNode): void {
  if (!node.element) return;
  const labelEl = node.element.querySelector('.tree-node-label');
  if (!labelEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tree-inline-input';
  input.value = node.name;

  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  input.select();

  const finish = async (confirm: boolean) => {
    const newName = input.value.trim();
    input.remove();
    labelEl.textContent = node.name;

    if (confirm && newName && newName !== node.name && isValidFilename(newName)) {
      const parentUri = node.parent?.uri ?? _roots[0]?.uri;
      if (parentUri) {
        const newUri = joinUri(parentUri, newName);
        try {
          await fsRename(node.uri, newUri);
          node.name = newName;
          node.uri = newUri;
          renderTree();
        } catch (err) {
          _api.window.showErrorMessage(`Failed to rename: ${err}`);
        }
      }
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.stopPropagation(); finish(true); }
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(false));
}

function startInlineCreate(parentNode: TreeNode | null, kind: 'file' | 'folder'): void {
  if (!parentNode || !_treeContainer) return;

  // Ensure parent is expanded
  if (!parentNode.expanded) {
    parentNode.expanded = true;
    if (!parentNode.loaded) {
      loadChildren(parentNode).then(() => insertCreateInput(parentNode, kind));
      return;
    }
  }
  insertCreateInput(parentNode, kind);
}

function insertCreateInput(parentNode: TreeNode, kind: 'file' | 'folder'): void {
  if (!_treeContainer) return;
  renderTree(); // re-render first to ensure DOM is current

  const depth = Math.max(0, parentNode.depth + 1);
  const inputRow = document.createElement('div');
  inputRow.className = 'tree-create-row';
  // Computed layout dimension
  inputRow.style.paddingLeft = `${depth * INDENT_PX + 20}px`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'tree-create-icon';
  iconSpan.textContent = kind === 'folder' ? '📁' : '📄';
  inputRow.appendChild(iconSpan);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tree-inline-input';
  input.placeholder = kind === 'folder' ? 'Folder name' : 'File name';
  inputRow.appendChild(input);

  // Insert after the parent's element
  const parentEl = parentNode.element;
  if (parentEl?.nextSibling) {
    _treeContainer.insertBefore(inputRow, parentEl.nextSibling);
  } else {
    _treeContainer.appendChild(inputRow);
  }

  input.focus();

  const finish = async (confirm: boolean) => {
    const name = input.value.trim();
    inputRow.remove();

    if (confirm && name && isValidFilename(name)) {
      try {
        if (kind === 'folder') {
          await fsCreateFolder(parentNode.uri, name);
        } else {
          await fsCreateFile(parentNode.uri, name);
        }
        // Reload parent
        parentNode.loaded = false;
        parentNode.children = [];
        await loadChildren(parentNode);
        renderTree();

        // Open new file in editor
        if (kind === 'file') {
          const newUri = joinUri(parentNode.uri, name);
          const newNode: TreeNode = {
            uri: newUri, name, type: FILE_TYPE_FILE,
            depth: parentNode.depth + 1, expanded: false,
            loaded: false, loading: false, children: [], parent: parentNode,
          };
          openFile(newNode, true);
        }
      } catch (err) {
        _api.window.showErrorMessage(`Failed to create ${kind}: ${err}`);
      }
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.stopPropagation(); finish(true); }
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(false));
}

function isValidFilename(name: string): boolean {
  const invalid = /[/\\:*?"<>|]/;
  if (invalid.test(name)) {
    _api.window.showErrorMessage(`Invalid filename: "${name}" contains forbidden characters.`);
    return false;
  }
  if (name.length === 0) return false;
  return true;
}

async function confirmDelete(node: TreeNode): Promise<void> {
  const result = await _api.window.showWarningMessage(
    `Are you sure you want to delete "${node.name}"?`,
    { title: 'Move to Trash' },
    { title: 'Cancel' },
  );
  if (result?.title === 'Move to Trash') {
    try {
      await fsDelete(node.uri);
      // Remove from parent
      if (node.parent) {
        node.parent.children = node.parent.children.filter(c => c !== node);
      }
      renderTree();
    } catch (err) {
      _api.window.showErrorMessage(`Failed to delete "${node.name}": ${err}`);
    }
  }
}

// ─── Open Editors View ───────────────────────────────────────────────────────

function createOpenEditorsView(container: HTMLElement): IDisposable {
  container.classList.add('open-editors-view');
  _openEditorsContainer = container;

  // Placeholder — will be wired to EditorService events in Cap 4
  renderOpenEditors();

  return {
    dispose() {
      _openEditorsContainer = null;
    },
  };
}

function renderOpenEditors(): void {
  if (!_openEditorsContainer) return;
  _openEditorsContainer.innerHTML = '';

  const placeholder = document.createElement('div');
  placeholder.className = 'open-editors-placeholder';
  placeholder.textContent = 'No open editors';
  _openEditorsContainer.appendChild(placeholder);

  _openEditorsCountKey.set(0);
}

// ─── Commands Registration ───────────────────────────────────────────────────

function registerCommands(api: ParallxApi, context: ToolContext): void {
  context.subscriptions.push(
    api.commands.registerCommand('explorer.newFile', () => {
      const parent = _selectedNode?.type === FILE_TYPE_DIRECTORY ? _selectedNode : (_selectedNode?.parent ?? getActiveRoot());
      if (parent) startInlineCreate(parent, 'file');
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('explorer.newFolder', () => {
      const parent = _selectedNode?.type === FILE_TYPE_DIRECTORY ? _selectedNode : (_selectedNode?.parent ?? getActiveRoot());
      if (parent) startInlineCreate(parent, 'folder');
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('explorer.rename', () => {
      if (_selectedNode) startInlineRename(_selectedNode);
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('explorer.delete', () => {
      if (_selectedNode) confirmDelete(_selectedNode);
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('explorer.refresh', () => {
      refreshTree();
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('explorer.collapse', () => {
      for (const root of _roots) collapseAll(root);
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('explorer.revealInExplorer', (_uri?: unknown) => {
      // TODO: Find and select the node matching the given URI, expanding parents as needed
      console.log('[Explorer] revealInExplorer — not yet implemented');
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('explorer.toggleHiddenFiles', () => {
      _showHidden = !_showHidden;
      refreshTree();
      console.log('[Explorer] Hidden files:', _showHidden ? 'shown' : 'hidden');
    }),
  );
}
