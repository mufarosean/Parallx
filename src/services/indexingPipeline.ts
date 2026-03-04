// indexingPipeline.ts — IIndexingPipelineService implementation (M10 Task 2.1, 2.2)
//
// Orchestrates the indexing pipeline:
//   1. On workspace open: index all canvas pages + workspace text files
//   2. On page save: re-index changed pages (debounced)
//   3. On file change: re-index changed files (debounced)
//   4. Incremental: skip sources whose content hash hasn't changed
//
// Design:
//   - The pipeline is a renderer-side singleton, created after database is open
//   - Pages are queried via IDatabaseService (direct SQL, not CanvasDataService)
//   - Files are walked via IFileService (Electron IPC bridge)
//   - Chunks + embeddings flow through IChunkingService → IEmbeddingService → IVectorStoreService
//   - All long-running work is serialized through a queue to avoid Ollama overload
//
// References:
//   - docs/Parallx_Milestone_10.md Phase 2 (Tasks 2.1, 2.2)

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import { URI } from '../platform/uri.js';
import { FileChangeType, FileType } from '../platform/fileTypes.js';
import type { FileChangeEvent } from '../platform/fileTypes.js';
import { createParallxIgnore, ParallxIgnore } from './parallxIgnore.js';
import type {
  IDatabaseService,
  IFileService,
  IEmbeddingService,
  IChunkingService,
  IVectorStoreService,
  IWorkspaceService,
  IIndexingPipelineService,
} from './serviceTypes.js';
import type { Chunk } from './chunkingService.js';
import type { EmbeddedChunk } from './vectorStoreService.js';
import { hashText } from './chunkingService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Debounce delay for page re-indexing after save (ms). */
const PAGE_DEBOUNCE_MS = 5_000;

/** Debounce delay for file re-indexing after change (ms). */
const FILE_DEBOUNCE_MS = 5_000;

/** Max concurrent embedding batches (serialized — one at a time). */
const BATCH_SIZE = 32;

/** File extensions supported for text indexing. */
const INDEXABLE_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json',
  '.py', '.css', '.scss', '.html', '.htm', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh',
  '.rs', '.go', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.lua', '.sql', '.graphql', '.gql', '.env', '.gitignore',
  '.dockerfile', '.csv', '.mdx', '.svelte', '.vue',
]);

/** Max file size to index (256 KB). Larger files are skipped. */
const MAX_FILE_SIZE = 256 * 1024;

/** Yield back to the event loop every N directory entries while walking. */
const DIRECTORY_WALK_YIELD_EVERY = 200;

/** @deprecated Use ParallxIgnore instead (M11 Task 1.9). Kept for backward compat / tests. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.parallx', '.vscode', '.idea',
  '__pycache__', '.next', '.nuxt', 'dist', 'build', 'out',
  'coverage', '.cache', '.turbo', 'vendor', 'target',
]);

// ─── Types ───────────────────────────────────────────────────────────────────

/** Progress state for the indexing pipeline. */
export interface IndexingProgress {
  /** Current phase: 'idle' | 'pages' | 'files' | 'incremental'. */
  phase: 'idle' | 'pages' | 'files' | 'incremental';
  /** Number of sources processed so far. */
  processed: number;
  /** Total sources to process (0 if unknown). */
  total: number;
  /** Currently processing source name (for status bar). */
  currentSource?: string;
}

/** Result of indexing a single source (page or file). */
export interface IndexingSourceResult {
  /** Whether this is a canvas page or a workspace file. */
  type: 'page' | 'file';
  /** Display name (page title or short file path). */
  source: string;
  /** Unique identifier (page ID or full file path). */
  sourceId: string;
  /** Outcome of the indexing attempt. */
  status: 'indexed' | 'skipped' | 'error';
  /** Error message if status is 'error'. */
  error?: string;
  /** Number of chunks produced (when indexed). */
  chunkCount?: number;
  /** Time taken in milliseconds. */
  durationMs: number;
}

/** Raw page row from the database. */
interface PageRow {
  id: string;
  title: string;
  content: string;
}

/** A file discovered during directory walk, with its mtime for fast-skip. */
interface IndexableFile {
  path: string;
  /** Modification time in ms since epoch (from stat/readdir). */
  mtime: number;
}

// ─── IndexingPipelineService ─────────────────────────────────────────────────

export class IndexingPipelineService extends Disposable implements IIndexingPipelineService {

  private readonly _db: IDatabaseService;
  private readonly _fileService: IFileService;
  private readonly _embeddingService: IEmbeddingService;
  private readonly _chunkingService: IChunkingService;
  private readonly _vectorStore: IVectorStoreService;
  private readonly _workspaceService: IWorkspaceService;

  // ── State ──

  private _isIndexing = false;
  private _progress: IndexingProgress = { phase: 'idle', processed: 0, total: 0 };

  /** Per-page debounce timers for incremental re-indexing. */
  private readonly _pageDebounce = new Map<string, ReturnType<typeof setTimeout>>();

  /** Per-file debounce timers for incremental re-indexing. */
  private readonly _fileDebounce = new Map<string, ReturnType<typeof setTimeout>>();

  /** Abort controller for cancelling in-progress initial indexing. */
  private _abortController: AbortController | null = null;

  /** Whether initial full indexing has completed at least once. */
  private _initialIndexComplete = false;

  /** ParallxIgnore instance for file exclusion (M11 Task 1.9). */
  private _ignore: ParallxIgnore = createParallxIgnore();

  // ── Events ──

  private readonly _onDidChangeProgress = this._register(new Emitter<IndexingProgress>());
  readonly onDidChangeProgress: Event<IndexingProgress> = this._onDidChangeProgress.event;

  private readonly _onDidCompleteInitialIndex = this._register(new Emitter<{ pages: number; files: number; durationMs: number }>());
  readonly onDidCompleteInitialIndex: Event<{ pages: number; files: number; durationMs: number }> = this._onDidCompleteInitialIndex.event;

  private readonly _onDidIndexSource = this._register(new Emitter<IndexingSourceResult>());
  readonly onDidIndexSource: Event<IndexingSourceResult> = this._onDidIndexSource.event;

  constructor(
    databaseService: IDatabaseService,
    fileService: IFileService,
    embeddingService: IEmbeddingService,
    chunkingService: IChunkingService,
    vectorStoreService: IVectorStoreService,
    workspaceService: IWorkspaceService,
  ) {
    super();
    this._db = databaseService;
    this._fileService = fileService;
    this._embeddingService = embeddingService;
    this._chunkingService = chunkingService;
    this._vectorStore = vectorStoreService;
    this._workspaceService = workspaceService;
  }

  // ── Public API ──

  /** Whether the pipeline is currently running (initial or incremental). */
  get isIndexing(): boolean { return this._isIndexing; }

  /** Current progress snapshot. */
  get progress(): IndexingProgress { return { ...this._progress }; }

  /** Whether initial full indexing has completed. */
  get isInitialIndexComplete(): boolean { return this._initialIndexComplete; }

  /**
   * Start the full indexing pipeline.
   * Call this after the database is open and migrations have run.
   *
   * - Ensures the embedding model is available (auto-pulls if needed)
   * - Initializes the vector store
   * - Indexes all pages, then all workspace files
   * - Sets up listeners for incremental re-indexing
   */
  async start(): Promise<void> {
    if (this._isIndexing) {
      console.warn('[IndexingPipeline] Already running — ignoring start()');
      return;
    }

    this._isIndexing = true;
    this._abortController = new AbortController();
    const startTime = performance.now();

    try {
      // 0. Load .parallxignore from workspace root (M11 Task 1.9)
      await this._loadIgnoreFile();

      // 1. Ensure embedding model is installed
      this._updateProgress('pages', 0, 0, 'Checking embedding model...');
      await this._embeddingService.ensureModel(this._abortController?.signal);

      // 2. Index all pages
      const pageCount = await this._indexAllPages();

      // 3. Index all workspace files
      const fileCount = await this._indexAllFiles();

      // 4. Set up listeners
      this._setupListeners();

      this._initialIndexComplete = true;
      const durationMs = performance.now() - startTime;

      console.log(
        '[IndexingPipeline] Initial indexing complete: %d pages, %d files in %dms',
        pageCount, fileCount, Math.round(durationMs),
      );

      this._onDidCompleteInitialIndex.fire({ pages: pageCount, files: fileCount, durationMs });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.log('[IndexingPipeline] Cancelled');
      } else {
        console.error('[IndexingPipeline] Error during initial indexing:', err);
      }
    } finally {
      this._isIndexing = false;
      this._abortController = null;
      this._updateProgress('idle', 0, 0);
    }
  }

  /**
   * Cancel any in-progress indexing.
   */
  cancel(): void {
    this._abortController?.abort();
  }

  /**
   * Force re-index a single page (bypass debounce).
   */
  async reindexPage(pageId: string): Promise<void> {
    const t0 = performance.now();
    try {
      const row = await this._db.get<PageRow>(
        'SELECT id, title, content FROM pages WHERE id = ? AND is_archived = 0',
        [pageId],
      );
      if (!row) { return; }

      const changed = await this._indexSinglePage(row.id, row.title, row.content);
      this._onDidIndexSource.fire({
        type: 'page', source: row.title, sourceId: pageId,
        status: changed ? 'indexed' : 'skipped',
        durationMs: performance.now() - t0,
      });
    } catch (err) {
      console.error('[IndexingPipeline] Error re-indexing page %s:', pageId, err);
      this._onDidIndexSource.fire({
        type: 'page', source: pageId, sourceId: pageId,
        status: 'error', error: String(err),
        durationMs: performance.now() - t0,
      });
    }
  }

  /**
   * Force re-index a single file (bypass debounce).
   */
  async reindexFile(filePath: string): Promise<void> {
    const t0 = performance.now();
    try {
      const changed = await this._indexSingleFile(filePath);
      this._onDidIndexSource.fire({
        type: 'file', source: filePath, sourceId: filePath,
        status: changed ? 'indexed' : 'skipped',
        durationMs: performance.now() - t0,
      });
    } catch (err) {
      console.error('[IndexingPipeline] Error re-indexing file %s:', filePath, err);
      this._onDidIndexSource.fire({
        type: 'file', source: filePath, sourceId: filePath,
        status: 'error', error: String(err),
        durationMs: performance.now() - t0,
      });
    }
  }

  // ── Internal: .parallxignore Loading (M11 Task 1.9) ──

  /**
   * Load `.parallxignore` from workspace root (if present) and merge with defaults.
   * Falls back to defaults if the file doesn't exist or can't be read.
   */
  private async _loadIgnoreFile(): Promise<void> {
    this._ignore = createParallxIgnore(); // start with defaults

    const folders = this._workspaceService.folders;
    if (!folders.length) { return; }

    const rootUri = folders[0].uri;
    const ignoreUri = rootUri.joinPath('.parallxignore');

    try {
      const ignoreFile = await this._fileService.readFile(ignoreUri);
      if (ignoreFile) {
        this._ignore.loadFromContent(ignoreFile.content);
        console.log('[IndexingPipeline] Loaded .parallxignore from workspace root');
      }
    } catch {
      // File doesn't exist or can't be read — use defaults only
    }
  }

  // ── Internal: Full Page Indexing ──

  private async _indexAllPages(): Promise<number> {
    const pages = await this._db.all<PageRow>(
      'SELECT id, title, content FROM pages WHERE is_archived = 0',
    );

    this._updateProgress('pages', 0, pages.length);
    let indexed = 0;

    for (const page of pages) {
      this._checkAborted();
      const t0 = performance.now();
      try {
        const changed = await this._indexSinglePage(page.id, page.title, page.content);
        if (changed) { indexed++; }
        this._onDidIndexSource.fire({
          type: 'page', source: page.title, sourceId: page.id,
          status: changed ? 'indexed' : 'skipped',
          durationMs: performance.now() - t0,
        });
      } catch (err) {
        console.warn('[IndexingPipeline] Failed to index page "%s": %s', page.title, err);
        this._onDidIndexSource.fire({
          type: 'page', source: page.title, sourceId: page.id,
          status: 'error', error: String(err),
          durationMs: performance.now() - t0,
        });
      }
      this._updateProgress('pages', this._progress.processed + 1, pages.length, page.title);
    }

    return indexed;
  }

  /**
   * Index a single page. Returns true if the page was actually re-indexed
   * (content changed), false if skipped (hash match).
   */
  private async _indexSinglePage(pageId: string, title: string, content: string): Promise<boolean> {
    if (!content || content === '{}') { return false; }

    // Check content hash — skip if unchanged
    const contentHash = await hashText(content);
    const storedHash = await this._vectorStore.getContentHash('page_block', pageId);
    if (storedHash === contentHash) { return false; }

    // Chunk
    const chunks = await this._chunkingService.chunkPage(pageId, title, content);
    if (chunks.length === 0) { return false; }

    // Embed
    const embeddedChunks = await this._embedChunks(chunks);
    if (embeddedChunks.length === 0) {
      // All chunks failed embedding — mark as indexed to avoid retrying unchanged content
      console.warn('[IndexingPipeline] All chunks failed embedding for page %s', pageId);
      return false;
    }

    // Store
    await this._vectorStore.upsert('page_block', pageId, embeddedChunks, contentHash);

    return true;
  }

  // ── Internal: Full File Indexing ──

  private async _indexAllFiles(): Promise<number> {
    const folders = this._workspaceService.folders;
    if (folders.length === 0) { return 0; }

    // Collect all indexable files (with mtimes for fast-skip)
    const files: IndexableFile[] = [];
    for (const folder of folders) {
      this._checkAborted();
      await this._walkDirectory(folder.uri, files);
      // Cooperative yield between folder roots so UI / switch actions stay responsive.
      await Promise.resolve();
    }

    // Bulk-fetch indexed_at timestamps for all file_chunk sources
    const indexedAtMap = await this._vectorStore.getIndexedAtMap('file_chunk');

    // Partition files into mtime-skipped (unchanged) and candidates (need checking).
    // This avoids firing 30K+ events in a tight synchronous loop which would
    // starve the renderer event loop and freeze the UI.
    const candidates: IndexableFile[] = [];
    let mtimeSkipped = 0;

    for (const file of files) {
      const indexedAtMs = indexedAtMap.get(file.path);
      if (indexedAtMs !== undefined && file.mtime < indexedAtMs) {
        mtimeSkipped++;
      } else {
        candidates.push(file);
      }
    }

    if (mtimeSkipped > 0) {
      console.log(
        '[IndexingPipeline] mtime fast-skip: %d/%d files unchanged since last index',
        mtimeSkipped, files.length,
      );
    }

    // Report progress against candidates only (skipped files are already done)
    this._updateProgress('files', 0, candidates.length);
    let indexed = 0;

    for (const file of candidates) {
      this._checkAborted();
      const t0 = performance.now();

      try {
        const changed = await this._indexSingleFile(file.path);
        if (changed) { indexed++; }
        this._onDidIndexSource.fire({
          type: 'file', source: file.path, sourceId: file.path,
          status: changed ? 'indexed' : 'skipped',
          durationMs: performance.now() - t0,
        });
      } catch (err) {
        console.warn('[IndexingPipeline] Failed to index file "%s": %s', file.path, err);
        this._onDidIndexSource.fire({
          type: 'file', source: file.path, sourceId: file.path,
          status: 'error', error: String(err),
          durationMs: performance.now() - t0,
        });
      }
      this._updateProgress('files', this._progress.processed + 1, candidates.length, file.path);
    }

    return indexed;
  }

  /**
   * Index a single workspace file. Returns true if actually indexed.
   */
  private async _indexSingleFile(filePath: string): Promise<boolean> {
    const uri = URI.file(filePath);

    // Read file content
    let content: string;
    try {
      const fileContent = await this._fileService.readFile(uri);
      if (fileContent.size > MAX_FILE_SIZE) { return false; }
      content = fileContent.content;
    } catch {
      return false; // File may have been deleted between walk and read
    }

    if (!content.trim()) { return false; }

    // Check content hash
    const contentHash = await hashText(content);
    const storedHash = await this._vectorStore.getContentHash('file_chunk', filePath);
    if (storedHash === contentHash) { return false; }

    // Detect language from extension
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const language = extToLanguage(ext);

    // Chunk
    const chunks = await this._chunkingService.chunkFile(filePath, content, language);
    if (chunks.length === 0) { return false; }

    // Embed
    const embeddedChunks = await this._embedChunks(chunks);
    if (embeddedChunks.length === 0) {
      // All chunks failed embedding — don't store, will retry next time content changes
      console.warn('[IndexingPipeline] All chunks failed embedding for file %s', filePath);
      return false;
    }

    // Store (partial results are fine — some chunks beat no chunks)
    await this._vectorStore.upsert('file_chunk', filePath, embeddedChunks, contentHash);

    return true;
  }

  // ── Internal: File Tree Walking ──

  /**
   * Recursively walk a directory, collecting indexable file paths with mtimes.
   * Respects .parallxignore patterns (M11 Task 1.9) and INDEXABLE_EXTENSIONS filters.
   */
  private async _walkDirectory(dirUri: URI, results: IndexableFile[], relativePath: string = ''): Promise<void> {
    this._checkAborted();

    let entries;
    try {
      entries = await this._fileService.readdir(dirUri);
    } catch {
      return; // Permission denied or other error — skip
    }

    let processed = 0;
    for (const entry of entries) {
      // Frequent cancellation check + cooperative yield to prevent long
      // synchronous loops from starving the renderer event loop when a
      // directory has many entries.
      this._checkAborted();
      processed++;
      if (processed % DIRECTORY_WALK_YIELD_EVERY === 0) {
        await Promise.resolve();
      }

      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.type === FileType.Directory) {
        // Skip hidden directories by default (same as prior behavior)
        if (entry.name.startsWith('.')) {
          continue;
        }
        // Check .parallxignore patterns (replaces hardcoded SKIP_DIRS)
        if (this._ignore.isIgnored(relPath, true)) {
          continue;
        }

        await this._walkDirectory(entry.uri, results, relPath);
      } else if (entry.type === FileType.File) {
        // Check .parallxignore patterns for files
        if (this._ignore.isIgnored(relPath, false)) {
          continue;
        }
        const ext = getExtension(entry.name);
        if (ext && INDEXABLE_EXTENSIONS.has(ext) && entry.size <= MAX_FILE_SIZE) {
          results.push({ path: entry.uri.fsPath, mtime: entry.mtime });
        }
      }
    }
  }

  // ── Internal: Embedding ──

  /**
   * Embed an array of chunks in batches.
   * Returns EmbeddedChunk[] with embedding vectors attached.
   */
  private async _embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    const results: EmbeddedChunk[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      this._checkAborted();

      const batch = chunks.slice(i, i + BATCH_SIZE);

      // Filter out empty/whitespace-only text before embedding
      const validBatch = batch.filter((c) => {
        const text = c.contextPrefix ? `${c.contextPrefix}\n${c.text}` : c.text;
        return text.trim().length > 0;
      });
      if (validBatch.length === 0) { continue; }

      const texts = validBatch.map((c) => c.contextPrefix ? `${c.contextPrefix}\n${c.text}` : c.text);
      const hashes = validBatch.map((c) => c.contentHash);

      try {
        const embeddings = await this._embeddingService.embedDocumentBatch(
          texts, hashes, this._abortController?.signal ?? undefined,
        );

        for (let j = 0; j < validBatch.length; j++) {
          results.push({
            ...validBatch[j],
            embedding: embeddings[j],
          });
        }
      } catch (batchErr) {
        // Batch failed — retry each chunk individually so one bad chunk
        // doesn't kill the entire file
        console.warn('[IndexingPipeline] Batch embed failed, retrying individually:', batchErr);
        for (let j = 0; j < validBatch.length; j++) {
          try {
            const [embedding] = await this._embeddingService.embedDocumentBatch(
              [texts[j]], hashes[j] ? [hashes[j]] : undefined,
              this._abortController?.signal ?? undefined,
            );
            results.push({ ...validBatch[j], embedding });
          } catch (chunkErr) {
            // Skip this chunk — log once and move on
            console.warn(
              '[IndexingPipeline] Skipping chunk %d of %s: %s',
              j, validBatch[j].sourceId, chunkErr instanceof Error ? chunkErr.message : String(chunkErr),
            );
          }
        }
      }
    }

    return results;
  }

  // ── Internal: Listeners ──

  /**
   * Set up listeners for incremental re-indexing:
   * - Database changes (page saves) via polling the onDidSavePage-equivalent
   * - File system changes via IFileService.onDidFileChange
   */
  private _setupListeners(): void {
    // Listen for page content changes via a database trigger approach.
    // Since CanvasDataService.onDidSavePage is inside the canvas built-in
    // and not accessible from the service layer, we listen for database
    // changes by watching the `pages` table revision column.
    // However, the simplest approach is to listen on IDatabaseService
    // for direct notification. For now, we expose a public reindexPage()
    // method and set up file watchers below.
    //
    // Page re-indexing is triggered externally by calling reindexPage()
    // or schedulePageReindex() — the canvas built-in will call this
    // after saves via its onDidSavePage event.

    // File system changes
    this._register(
      this._fileService.onDidFileChange((events) => this._handleFileChanges(events)),
    );
  }

  /**
   * Handle file system change events — schedule re-indexing for changed files.
   */
  private _handleFileChanges(events: FileChangeEvent[]): void {
    for (const event of events) {
      const filePath = event.uri.fsPath;
      const ext = getExtension(filePath);

      // Only care about indexable file types
      if (!ext || !INDEXABLE_EXTENSIONS.has(ext)) { continue; }

      if (event.type === FileChangeType.Deleted) {
        // Remove from index
        this._vectorStore.deleteSource('file_chunk', filePath).catch((err) => {
          console.warn('[IndexingPipeline] Failed to remove deleted file from index:', filePath, err);
        });
        this._cancelFileDebounce(filePath);
      } else {
        // Created or changed — schedule re-index
        this.scheduleFileReindex(filePath);
      }
    }
  }

  /**
   * Schedule a debounced page re-index.
   * Multiple calls within PAGE_DEBOUNCE_MS are coalesced.
   */
  schedulePageReindex(pageId: string): void {
    // Cancel existing timer
    const existing = this._pageDebounce.get(pageId);
    if (existing) { clearTimeout(existing); }

    const timer = setTimeout(async () => {
      this._pageDebounce.delete(pageId);
      try {
        await this.reindexPage(pageId);
      } catch (err) {
        console.warn('[IndexingPipeline] Debounced page re-index failed:', pageId, err);
      }
    }, PAGE_DEBOUNCE_MS);

    this._pageDebounce.set(pageId, timer);
  }

  /**
   * Schedule a debounced file re-index.
   */
  scheduleFileReindex(filePath: string): void {
    this._cancelFileDebounce(filePath);

    const timer = setTimeout(async () => {
      this._fileDebounce.delete(filePath);
      try {
        await this.reindexFile(filePath);
      } catch (err) {
        console.warn('[IndexingPipeline] Debounced file re-index failed:', filePath, err);
      }
    }, FILE_DEBOUNCE_MS);

    this._fileDebounce.set(filePath, timer);
  }

  private _cancelFileDebounce(filePath: string): void {
    const existing = this._fileDebounce.get(filePath);
    if (existing) {
      clearTimeout(existing);
      this._fileDebounce.delete(filePath);
    }
  }

  /** Timestamp of last progress event emission (for throttling). */
  private _lastProgressFire = 0;

  // ── Internal: Progress ──

  private _updateProgress(
    phase: IndexingProgress['phase'],
    processed: number,
    total: number,
    currentSource?: string,
  ): void {
    this._progress = { phase, processed, total, currentSource };

    // Throttle progress events to at most once per 250ms during bulk indexing.
    // Always fire for phase transitions (idle, first item, last item).
    const now = performance.now();
    const isPhaseEdge = phase === 'idle' || processed === 0 || processed === total;
    if (isPhaseEdge || now - this._lastProgressFire >= 250) {
      this._lastProgressFire = now;
      this._onDidChangeProgress.fire(this._progress);
    }
  }

  // ── Internal: Abort ──

  private _checkAborted(): void {
    if (this._abortController?.signal.aborted) {
      const err = new Error('Indexing cancelled');
      err.name = 'AbortError';
      throw err;
    }
  }

  // ── Cleanup ──

  override dispose(): void {
    this.cancel();

    // Clear all debounce timers
    for (const timer of this._pageDebounce.values()) { clearTimeout(timer); }
    this._pageDebounce.clear();

    for (const timer of this._fileDebounce.values()) { clearTimeout(timer); }
    this._fileDebounce.clear();

    super.dispose();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract file extension including the dot, e.g. '.ts'. */
function getExtension(filePath: string): string | null {
  const lastDot = filePath.lastIndexOf('.');
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastDot <= lastSlash || lastDot === filePath.length - 1) { return null; }
  return filePath.slice(lastDot).toLowerCase();
}

/** Map file extension to a language name for the chunking service. */
function extToLanguage(ext: string): string | undefined {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
    swift: 'swift', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    rb: 'ruby', lua: 'lua', sql: 'sql', css: 'css', scss: 'scss',
    html: 'html', htm: 'html', xml: 'xml', json: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
    mdx: 'markdown', sh: 'shell', bash: 'shell', zsh: 'shell',
    graphql: 'graphql', gql: 'graphql', svelte: 'svelte', vue: 'vue',
  };
  return map[ext];
}

export { getExtension, extToLanguage, INDEXABLE_EXTENSIONS, SKIP_DIRS, MAX_FILE_SIZE };
