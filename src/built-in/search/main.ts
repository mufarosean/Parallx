// Search Built-In Tool — workspace-wide text search
//
// Implements:
//   • Find in Files (Ctrl+Shift+F) — text search across workspace files,
//     as the Workspace scope of Find (services/findService.ts): the field
//     and the three toggles are Find's, the results under them are drawn here.
//     With this tool off, Find has no Workspace switch.
//   • Results tree grouped by file with match context
//   • Case-sensitive, whole-word, regex toggle options
//   • Include/exclude glob patterns
//   • Click result → open file in editor
//
// VS Code reference:
//   src/vs/workbench/contrib/search/browser/searchView.ts
//   src/vs/workbench/services/search/common/textSearchManager.ts

import { declareControl, createBlock, createButton, createList } from '../../ui/kit.js';
import './search.css';

import { SEARCH_EMPTY_STATES } from './searchEmptyStates.js';
import { SearchDocumentReader, type IDocumentTextSource, type ISearchLine } from './searchDocuments.js';
import { IFileService } from '../../services/serviceTypes.js';
import { IFindService } from '../../services/findService.js';
import { BINARY_EXTENSIONS, EXCLUDED_DIRS, buildGlobMatcher, buildSearchRegex, getExtension, type SearchRegexOptions } from './searchPatterns.js';

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $,  hide, show } from '../../ui/dom.js';
import { createIconElement, getFileTypeIcon } from '../../ui/iconRegistry.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParallxApi {
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  workspace: {
    readonly workspaceFolders: readonly { uri: string; name: string; index: number }[] | undefined;
    readonly onDidChangeWorkspaceFolders: (listener: (e: { added: readonly { uri: string; name: string; index: number }[]; removed: readonly { uri: string; name: string; index: number }[] }) => void) => IDisposable;
    readonly onDidFilesChange: (listener: (events: { type: number; uri: string }[]) => void) => IDisposable;
    readonly fs?: {
      readFile(uri: string): Promise<{ content: string; encoding: string }>;
      readdir(uri: string): Promise<{ name: string; type: number; size?: number; mtime?: number }[]>;
      exists(uri: string): Promise<boolean>;
    };
    getConfiguration(section?: string): { get<T>(key: string, defaultValue?: T): T | undefined; has(key: string): boolean };
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
  editors: {
    openFileEditor(uri: string, options?: { pinned?: boolean; reveal?: { line?: number; page?: number } }): Promise<void>;
  };
  services?: { has(id: unknown): boolean; get<T>(id: unknown): T };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;
const MAX_RESULTS_PER_FILE = 999;
const FILE_SCAN_DEPTH = 10;
const CONTEXT_CHARS = 60;

// ─── Search Result Model ─────────────────────────────────────────────────────

interface SearchMatch {
  /** 0-based line index */
  line: number;
  /** 0-based column of match start */
  column: number;
  /** Length of the match */
  matchLength: number;
  /** The full line text (trimmed for display) */
  lineText: string;
  /** In a PDF: the page the line is on (1-based). */
  page?: number;
}

interface FileResult {
  uri: string;
  relativePath: string;
  fileName: string;
  matches: SearchMatch[];
  expanded: boolean;
}

interface SearchOptions extends SearchRegexOptions {
  includePattern: string;
  excludePattern: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

let _api: ParallxApi;
/** Reads PDF, Word, Excel and other documents' text for Find in Files (searchDocuments.ts). */
let _docs: SearchDocumentReader | undefined;
let _context: ToolContext;

// Search state
let _query = '';
let _options: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  includePattern: '',
  excludePattern: '',
};
let _results: FileResult[] = [];
let _totalMatches = 0;
let _searchVersion = 0;

// DOM elements
let _resultsContainer: HTMLElement | null = null;
let _messageEl: HTMLElement | null = null;
/** Sets the short count beside Find's field. */
let _report: ((summary: string) => void) | null = null;
/** Which match Enter last opened (step). */
let _stepIndex = -1;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  _api = api;
  _docs = api.services?.has(IFileService) ? new SearchDocumentReader(api.services.get<IDocumentTextSource>(IFileService)) : undefined;
  _context = context;

  // Restore saved search options
  const saved = context.workspaceState.get<Partial<SearchOptions>>('search.options');
  if (saved) {
    _options = { ..._options, ...saved };
  }

  // The Workspace scope of Find. Without the Find service there is nowhere to search from.
  const find = api.services?.has(IFindService) ? api.services.get<IFindService>(IFindService) : undefined;
  if (find) {
    context.subscriptions.push(find.registerScope({
      id: 'workspace',
      label: 'Workspace',
      mount: mountResults,
      search(query, options) {
        _query = query;
        _options = { ..._options, ...options };
        _stepIndex = -1;
        triggerSearch();
      },
      step,
    }));
  }
  context.subscriptions.push(api.commands.registerCommand('search.findInFiles', () => { find?.open('workspace'); }));

  context.subscriptions.push(
    api.commands.registerCommand('search.clearResults', () => {
      clearResults();
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('search.collapseAll', () => {
      for (const r of _results) r.expanded = false;
      renderResults();
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('search.expandAll', () => {
      for (const r of _results) r.expanded = true;
      renderResults();
    }),
  );
}

export function deactivate(): void {
  _resultsContainer = null;
  _messageEl = null;
  _report = null;
  _results = [];
}

// ─── View Creation ───────────────────────────────────────────────────────────

/** The results under Find's field: the include and exclude filters, the status line, the list. */
function mountResults(container: HTMLElement, report: (summary: string) => void): IDisposable {
  container.classList.add('search-view');
  _report = report;

  // ── Filters (include/exclude) ──
  const filtersSection = $('div');
  filtersSection.className = 'search-filters';

  const filtersToggle = $('button');
  filtersToggle.className = 'search-filters-toggle';
  filtersToggle.textContent = '⋯ files to include/exclude';
  filtersToggle.title = 'Toggle Search Details';
  declareControl(filtersToggle, { id: 'search.toggleDetails', label: 'Toggle Search Details' });

  const filtersBody = $('div');
  filtersBody.className = 'search-filters-body';
  hide(filtersBody);

  const includeInput = $('input');
  includeInput.type = 'text';
  includeInput.className = 'search-input search-filter-input';
  includeInput.placeholder = 'files to include (e.g. *.ts, src/**)';
  declareControl(includeInput, { id: 'search.include', label: 'Files to include', kind: 'input', state: () => ({ kind: 'value', value: includeInput.value }) });
  includeInput.value = _options.includePattern;
  includeInput.addEventListener('input', () => {
    _options.includePattern = includeInput.value;
    saveOptions();
    triggerSearch();
  });

  const excludeInput = $('input');
  excludeInput.type = 'text';
  excludeInput.className = 'search-input search-filter-input';
  excludeInput.placeholder = 'files to exclude (e.g. *.min.js)';
  declareControl(excludeInput, { id: 'search.exclude', label: 'Files to exclude', kind: 'input', state: () => ({ kind: 'value', value: excludeInput.value }) });
  excludeInput.value = _options.excludePattern;
  excludeInput.addEventListener('input', () => {
    _options.excludePattern = excludeInput.value;
    saveOptions();
    triggerSearch();
  });

  filtersBody.appendChild(includeInput);
  filtersBody.appendChild(excludeInput);
  filtersSection.appendChild(filtersToggle);
  filtersSection.appendChild(filtersBody);

  filtersToggle.addEventListener('click', () => {
    const visible = filtersBody.style.display !== 'none';
    visible ? hide(filtersBody) : show(filtersBody);
    filtersToggle.classList.toggle('active', !visible);
  });

  container.appendChild(filtersSection);

  // ── Message area ──
  _messageEl = $('div');
  _messageEl.className = 'search-message';
  _messageEl.setAttribute('role', 'status');
  container.appendChild(_messageEl);

  // ── Results ──
  _resultsContainer = $('div');
  _resultsContainer.className = 'search-results';
  createList(_resultsContainer, { id: 'search.results', label: 'Results', rows: () => Array.from(_resultsContainer?.querySelectorAll<HTMLElement>('.search-result-item, .search-file-group') ?? []), selected: () => [] });
  container.appendChild(_resultsContainer);

  // What the sidebar's More Actions menu held.
  const footer = createBlock(container, 'div', { className: 'search-footer' });
  createButton(footer, { id: 'search.collapseAll', label: 'Collapse All', kind: 'ghost', size: 'sm', command: 'search.collapseAll' });
  createButton(footer, { id: 'search.clearResults', label: 'Clear', kind: 'ghost', size: 'sm', command: 'search.clearResults' });

  updateMessage();
  renderResults();

  return {
    dispose() {
      container.classList.remove('search-view');
      container.replaceChildren();
      _resultsContainer = null;
      _messageEl = null;
      _report = null;
    },
  };
}

// ─── Search Execution ───────────────────────────────────────────────────────

let _debounceHandle: ReturnType<typeof setTimeout> | null = null;

function triggerSearch(): void {
  if (_debounceHandle) clearTimeout(_debounceHandle);

  if (!_query.trim()) {
    clearResults();
    return;
  }

  _debounceHandle = setTimeout(() => executeSearch(), 50);
}

async function executeSearch(): Promise<void> {
  const query = _query.trim();
  if (!query) {
    clearResults();
    return;
  }

  const version = ++_searchVersion;
  _results = [];
  _totalMatches = 0;
  updateMessage('Searching…');

  try {
    const regex = buildSearchRegex(query, _options);
    if (!regex) {
      updateMessage('Invalid regular expression');
      return;
    }

    const folders = _api.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      updateMessage('No workspace folder open');
      return;
    }

    // Build include/exclude matchers
    const includeMatcher = buildGlobMatcher(_options.includePattern);
    const excludeMatcher = buildGlobMatcher(_options.excludePattern);

    let totalFilesScanned = 0;

    for (const folder of folders) {
      if (_searchVersion !== version) return;
      await searchDirectory(
        folder.uri, folder.name, '', regex, includeMatcher, excludeMatcher,
        0, version, () => totalFilesScanned++,
      );
    }

    if (_searchVersion !== version) return;

    if (_results.length === 0) {
      // registry voice: warm line + a concrete next step.
      updateMessage(`No matches for "${query}". ${SEARCH_EMPTY_STATES.noResults.hint}`);
    } else {
      updateMessage(); // the count is beside Find's field
    }

    renderResults();
  } catch (err) {
    if (_searchVersion !== version) return;
    console.error('[Search] Error:', err);
    updateMessage('Search failed. See the console.');
  }
}

async function searchDirectory(
  dirUri: string,
  folderName: string,
  relativePath: string,
  regex: RegExp,
  includeMatcher: ((path: string) => boolean) | null,
  excludeMatcher: ((path: string) => boolean) | null,
  depth: number,
  version: number,
  onFile: () => void,
): Promise<void> {
  if (depth >= FILE_SCAN_DEPTH || _searchVersion !== version) return;

  const fs = _api.workspace.fs;
  if (!fs) return;

  try {
    const entries = await fs.readdir(dirUri);

    for (const entry of entries) {
      if (_searchVersion !== version) return;

      const childRelative = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      const childUri = dirUri.endsWith('/')
        ? `${dirUri}${entry.name}`
        : `${dirUri}/${entry.name}`;

      if (entry.type === FILE_TYPE_DIRECTORY) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await searchDirectory(
          childUri, folderName, childRelative, regex,
          includeMatcher, excludeMatcher, depth + 1, version, onFile,
        );
      } else if (entry.type === FILE_TYPE_FILE) {
        // Skip binary files, except the documents whose text can be read
        const ext = getExtension(entry.name);
        if (BINARY_EXTENSIONS.has(ext) && !_docs?.isDocument(ext)) continue;

        // Apply include/exclude filters
        if (includeMatcher && !includeMatcher(childRelative)) continue;
        if (excludeMatcher && excludeMatcher(childRelative)) continue;

        onFile();

        // Search file content
        await searchFile(childUri, childRelative, entry.name, regex, version, entry);
      }
    }
  } catch (err) {
    // Silently skip directories we can't read
    console.warn('[Search] readdir failed:', dirUri, err);
  }
}

async function searchFile(
  uri: string,
  relativePath: string,
  fileName: string,
  regex: RegExp,
  version: number,
  stamp: { mtime?: number; size?: number } = {},
): Promise<void> {
  if (_searchVersion !== version) return;

  const fs = _api.workspace.fs;
  if (!fs) return;

  try {
    let lines: ISearchLine[];
    if (_docs?.isDocument(getExtension(fileName))) {
      const doc = await _docs.read(uri, stamp);
      if (!doc || _searchVersion !== version) return;
      lines = doc;
    } else {
      const { content } = await fs.readFile(uri);
      if (_searchVersion !== version) return;
      // Skip files that appear to be binary (null bytes in first 512 chars)
      if (content.length > 0 && content.slice(0, 512).includes('\0')) return;
      lines = content.split('\n').map((text) => ({ text }));
    }
    const matches: SearchMatch[] = [];

    for (let i = 0; i < lines.length && matches.length < MAX_RESULTS_PER_FILE; i++) {
      const line = lines[i].text;
      // Reset regex for each line (for global flag)
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      // eslint-disable-next-line no-cond-assign
      while ((match = regex.exec(line)) !== null && matches.length < MAX_RESULTS_PER_FILE) {
        matches.push({
          line: i,
          column: match.index,
          matchLength: match[0].length,
          lineText: line,
          page: lines[i].page,
        });

        // Avoid infinite loop with zero-length matches
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }
    }

    if (matches.length > 0 && _searchVersion === version) {
      _totalMatches += matches.length;
      _results.push({
        uri,
        relativePath,
        fileName,
        matches,
        expanded: true,
      });

      // Progressive rendering: the new file's group is appended on the next frame
      if (_results.length <= 10 || _results.length % 5 === 0) {
        updateMessage(
          `${_totalMatches} result${_totalMatches !== 1 ? 's' : ''} in ${_results.length} file${_results.length !== 1 ? 's' : ''} (searching…)`,
        );
      }
      appendNewResults();
    }
  } catch (err) {
    // Skip files we can't read
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function saveOptions(): void {
  _context.workspaceState.update('search.options', _options);
}

function clearResults(): void {
  _results = [];
  _totalMatches = 0;
  _searchVersion++;
  renderResults();
  updateMessage();
}

/** Enter in Find: open the next (or the previous) match, wrapping round. */
function step(delta: 1 | -1): void {
  const all = _results.flatMap((r) => r.matches.map((m) => ({ uri: r.uri, match: m })));
  if (!all.length) return;
  _stepIndex = (_stepIndex + delta + all.length) % all.length;
  void openResult(all[_stepIndex].uri, all[_stepIndex].match);
}

function updateMessage(text?: string): void {
  _report?.(_results.length ? `${_totalMatches} in ${_results.length} file${_results.length !== 1 ? 's' : ''}` : '');
  if (!_messageEl) return;

  if (text) {
    _messageEl.textContent = text;
    show(_messageEl);
  } else if (!_query.trim()) {
    _messageEl.textContent = '';
    hide(_messageEl);
  } else {
    hide(_messageEl);
  }
}

// ─── Results Rendering ───────────────────────────────────────────────────────

/** How many of `_results` already have a group in the list. */
let _renderedCount = 0;

/** Rebuild the whole list: after a search starts, ends or a result is removed. */
function renderResults(): void {
  if (!_resultsContainer) return;
  _resultsContainer.innerHTML = '';
  for (const fileResult of _results) _resultsContainer.appendChild(renderFileGroup(fileResult));
  _renderedCount = _results.length;
}

// While a search runs, each new file adds its own group; rebuilding the list
// for every fifth file made a large search quadratic.
let _appendQueued = false;
function appendNewResults(): void {
  if (_appendQueued) return;
  _appendQueued = true;
  requestAnimationFrame(() => {
    _appendQueued = false;
    if (!_resultsContainer) return;
    if (_renderedCount > _results.length) { renderResults(); return; }
    for (; _renderedCount < _results.length; _renderedCount++) {
      _resultsContainer.appendChild(renderFileGroup(_results[_renderedCount]));
    }
  });
}

function renderFileGroup(fileResult: FileResult): HTMLElement {
  const fileGroup = $('div');
  fileGroup.className = 'search-file-group';

  // File header
  const fileHeader = $('div');
  fileHeader.className = 'search-file-header';
  fileHeader.addEventListener('click', () => {
    fileResult.expanded = !fileResult.expanded;
    chevron.classList.toggle('search-file-chevron--open', fileResult.expanded);
    fileResult.expanded ? show(matchList) : hide(matchList);
  });

  const chevron = createIconElement('chevron-right', 14);
  chevron.classList.add('search-file-chevron');
  chevron.classList.toggle('search-file-chevron--open', fileResult.expanded);
  fileHeader.appendChild(chevron);

  const fileIcon = $('span');
  fileIcon.className = 'search-file-icon';
  fileIcon.innerHTML = getFileIcon(fileResult.fileName);
  fileHeader.appendChild(fileIcon);

  const filePath = $('span');
  filePath.className = 'search-file-path';
  fileHeader.appendChild(filePath);

  // File name (bold) + directory (dim)
  const nameSpan = $('span');
  nameSpan.className = 'search-file-name';
  nameSpan.textContent = fileResult.fileName;
  filePath.appendChild(nameSpan);

  const dirSpan = $('span');
  dirSpan.className = 'search-file-dir';
  const dir = fileResult.relativePath.slice(0, -(fileResult.fileName.length + 1));
  if (dir) {
    dirSpan.textContent = ` ${dir}`;
  }
  filePath.appendChild(dirSpan);

  // Match count badge
  const badge = $('span');
  badge.className = 'search-file-badge';
  badge.textContent = String(fileResult.matches.length);
  fileHeader.appendChild(badge);

  fileGroup.appendChild(fileHeader);

  // Match list
  const matchList = $('div');
  matchList.className = 'search-match-list';
  fileResult.expanded ? show(matchList) : hide(matchList);

  for (const match of fileResult.matches) {
    const matchEl = $('div');
    matchEl.className = 'search-match-item';
    matchEl.addEventListener('click', (e) => {
      e.stopPropagation();
      openResult(fileResult.uri, match);
    });

    // Render line text with match highlighting
    renderMatchLine(matchEl, match);

    matchList.appendChild(matchEl);
  }

  fileGroup.appendChild(matchList);
  return fileGroup;
}

function renderMatchLine(container: HTMLElement, match: SearchMatch): void {
  const lineText = match.lineText;
  const start = match.column;
  const end = start + match.matchLength;

  // Determine visible window around the match
  const contextStart = Math.max(0, start - CONTEXT_CHARS);
  const contextEnd = Math.min(lineText.length, end + CONTEXT_CHARS);

  const prefix = (contextStart > 0 ? '…' : '') +
    lineText.slice(contextStart, start);
  const matched = lineText.slice(start, end);
  const suffix = lineText.slice(end, contextEnd) +
    (contextEnd < lineText.length ? '…' : '');

  // Line number
  const lineNum = $('span');
  lineNum.className = 'search-match-line-num';
  lineNum.textContent = match.page ? `p. ${match.page}` : String(match.line + 1);
  container.appendChild(lineNum);

  // Text before match
  if (prefix) {
    const pre = $('span');
    pre.className = 'search-match-context';
    pre.textContent = prefix;
    container.appendChild(pre);
  }

  // Highlighted match
  const hl = $('span');
  hl.className = 'search-match-highlight';
  hl.textContent = matched;
  container.appendChild(hl);

  // Text after match
  if (suffix) {
    const post = $('span');
    post.className = 'search-match-context';
    post.textContent = suffix;
    container.appendChild(post);
  }
}

function getFileIcon(fileName: string): string {
  const ext = getExtension(fileName);
  // Strip leading dot — shared icon registry handles both '.ts' and 'ts'
  const normalized = ext.startsWith('.') ? ext.slice(1) : ext;
  return getFileTypeIcon(normalized);
}

async function openResult(uri: string, match: SearchMatch): Promise<void> {
  try {
    // At the match: a PDF's page, a text file's line.
    await _api.editors.openFileEditor(uri, { pinned: false, reveal: match.page ? { page: match.page } : { line: match.line + 1 } });
  } catch (err) {
    console.error('[Search] Failed to open file:', err);
  }
}
