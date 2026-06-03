import { Disposable } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import type { IFileService, IWorkspaceMemoryService, IWorkspaceService } from './serviceTypes.js';

const MEMORY_ROOT_SEGMENTS = ['.parallx', 'memory'] as const;
const DURABLE_MEMORY_FILE = 'MEMORY.md';
const PREFERENCES_SECTION_HEADING = '## Preferences';
const LEGACY_IMPORT_SECTION_HEADING = '## Legacy Import';
// M81 Phase 3 Stage 2 — `## Concepts` section was an auto-extracted index of
// file paths / URIs / capitalized entities. Removed in favor of agent-curated
// MEMORY.md content via the `memory_write` tool.

// M81 Phase 8 — lessons + index. MEMORY.md becomes a bounded INDEX of pointers
// to per-topic lesson files at `.parallx/memory/lessons/<slug>.md`. Archived
// lessons and the pre-M81 regex-extraction noise move to `_archive/`.
const LESSONS_DIR = 'lessons';
const ARCHIVE_DIR = '_archive';
const ARCHIVE_LESSONS_DIR = 'lessons';
const ARCHIVE_LEGACY_CONCEPTS_FILE = 'pre-m81-concepts.md';
const MEMORY_INDEX_DESCRIPTION_MAX = 120;
const MEMORY_INDEX_HEADER = [
  '# Memory Index',
  '',
  'Long-term lessons. Each line points to a lesson file with the full',
  'body. Bounded — when the index is full the agent removes an old entry',
  'before adding a new one.',
  '',
].join('\n');
// Em-dash (—, U+2014) is the parser anchor for index lines. Required.
const MEMORY_INDEX_LINE_REGEX = /^- \[([^\]]+)\]\(lessons\/([^)]+)\.md\)\s+—\s+(.+)$/;
// Pre-M81 regex-extraction `## Concepts` blocks contain `- Category:`,
// `- Encounters: <n>`, `- Mastery: <x>`, `- Struggles: <n>`, and `- Summary:`
// lines under each `### Title` entry. We detect the signature in the section
// body and archive the whole section if present.
const LEGACY_CONCEPTS_SIGNATURE_PATTERNS: readonly RegExp[] = [
  /\n- Category: /,
  /\n- Encounters: \d+/,
  /\n- Mastery: /,
  /\n- Struggles: \d+/,
  /\n- Summary: /,
];

/**
 * M81 — USER.md is an identity bootstrap file (sibling of SOUL.md and AGENTS.md),
 * not a memory file. It lives at `.parallx/USER.md`, not under `.parallx/memory/`.
 * Scaffolding to disk is owned by `/init` (the single workspace-setup command),
 * matching how SOUL.md and TOOLS.md behave. We keep the path segments here so
 * the read/write methods used by `memory_write` can resolve the file URI.
 */
const USER_FILE_SEGMENTS = ['.parallx', 'USER.md'] as const;

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeMarkdown(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceMarkdownSection(content: string, heading: string, body: string): string {
  const normalized = content.trimEnd();
  const sectionText = `${heading}\n\n${body.trim()}\n`;

  const headingIndex = normalized.indexOf(heading);
  if (headingIndex >= 0) {
    const nextSectionIndex = normalized.indexOf('\n## ', headingIndex + heading.length);
    const before = normalized.slice(0, headingIndex).trimEnd();
    const after = nextSectionIndex >= 0
      ? normalized.slice(nextSectionIndex).trimStart()
      : '';
    const joined = [before, sectionText.trimEnd(), after].filter(Boolean).join('\n\n');
    return ensureTrailingNewline(joined);
  }

  if (!normalized) {
    return ensureTrailingNewline(sectionText);
  }

  return ensureTrailingNewline(`${normalized}\n\n${sectionText}`);
}

function extractMarkdownSection(content: string, heading: string): string | undefined {
  const normalized = content.replace(/\r\n/g, '\n');
  const headingIndex = normalized.indexOf(heading);
  if (headingIndex < 0) {
    return undefined;
  }
  const bodyStart = headingIndex + heading.length;
  const nextSectionIndex = normalized.indexOf('\n## ', bodyStart);
  const rawSection = nextSectionIndex >= 0
    ? normalized.slice(bodyStart, nextSectionIndex)
    : normalized.slice(bodyStart);
  const trimmed = rawSection.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractLegacyImportTimestamp(section: string | undefined): string | undefined {
  if (!section) {
    return undefined;
  }

  const match = section.match(/^- Imported at: (.+)$/m);
  return match?.[1]?.trim() || undefined;
}

function humanizeSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) {
    return '';
  }
  const words = trimmed
    .replace(/[_\s]+/g, '-')
    .split('-')
    .filter((part) => part.length > 0);
  if (words.length === 0) {
    return '';
  }
  const [first, ...rest] = words;
  const capFirst = first.charAt(0).toUpperCase() + first.slice(1);
  return [capFirst, ...rest].join(' ');
}

function parsePreferenceLines(section: string | undefined): Array<{ key: string; value: string }> {
  if (!section) {
    return [];
  }

  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .filter((line) => !/^- No durable preferences recorded yet\.?$/i.test(line))
    .map((line) => line.slice(2))
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex < 0) {
        return undefined;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (!key || !value) {
        return undefined;
      }
      return { key, value };
    })
    .filter((entry): entry is { key: string; value: string } => !!entry);
}

export class WorkspaceMemoryService extends Disposable implements IWorkspaceMemoryService {
  constructor(
    private readonly _fileService: IFileService,
    private readonly _workspaceService: IWorkspaceService,
  ) {
    super();
  }

  get memoryRoot(): URI | undefined {
    const root = this._workspaceService.folders[0]?.uri;
    return root?.joinPath(...MEMORY_ROOT_SEGMENTS);
  }

  get durableMemoryUri(): URI | undefined {
    return this.memoryRoot?.joinPath(DURABLE_MEMORY_FILE);
  }

  getDailyMemoryUri(date: Date = new Date()): URI | undefined {
    return this.memoryRoot?.joinPath(`${formatIsoDate(date)}.md`);
  }

  getDailyMemoryRelativePath(date: Date = new Date()): string {
    return `${MEMORY_ROOT_SEGMENTS.join('/')}/${formatIsoDate(date)}.md`;
  }

  getDurableMemoryRelativePath(): string {
    return `${MEMORY_ROOT_SEGMENTS.join('/')}/${DURABLE_MEMORY_FILE}`;
  }

  async ensureScaffold(): Promise<void> {
    const workspaceRoot = this._workspaceService.folders[0]?.uri;
    if (!workspaceRoot) {
      return;
    }

    const parallxDir = workspaceRoot.joinPath('.parallx');
    if (!(await this._fileService.exists(parallxDir))) {
      await this._fileService.mkdir(parallxDir);
    }

    const memoryDir = parallxDir.joinPath('memory');
    if (!(await this._fileService.exists(memoryDir))) {
      await this._fileService.mkdir(memoryDir);
    }

    const durableMemory = memoryDir.joinPath(DURABLE_MEMORY_FILE);
    if (!(await this._fileService.exists(durableMemory))) {
      await this._fileService.writeFile(
        durableMemory,
        '# Durable Memory\n\nCurated long-term decisions, preferences, conventions, and critical facts.\n',
      );
    }

  }

  async readDurableMemory(): Promise<string> {
    const uri = this.durableMemoryUri;
    if (!uri) {
      return '';
    }
    if (!(await this._fileService.exists(uri))) {
      return '';
    }
    const result = await this._fileService.readFile(uri);
    return normalizeMarkdown(result.content);
  }

  async writeDurableMemory(content: string): Promise<void> {
    await this.ensureScaffold();
    const uri = this.durableMemoryUri;
    if (!uri) {
      throw new Error('No workspace root folder available');
    }
    await this._fileService.writeFile(uri, ensureTrailingNewline(normalizeMarkdown(content)));
  }

  // M81 Phase 1/2 — USER.md as an identity bootstrap file. Lives at
  // .parallx/USER.md (sibling of SOUL.md, not under .parallx/memory/) but
  // managed here so all curated workspace memory flows through one service.

  private get _userFileUri(): URI | undefined {
    const root = this._workspaceService.folders[0]?.uri;
    return root?.joinPath(...USER_FILE_SEGMENTS);
  }

  getUserFileRelativePath(): string {
    return USER_FILE_SEGMENTS.join('/');
  }

  async readUserFile(): Promise<string> {
    const uri = this._userFileUri;
    if (!uri) {
      return '';
    }
    if (!(await this._fileService.exists(uri))) {
      return '';
    }
    const result = await this._fileService.readFile(uri);
    return normalizeMarkdown(result.content);
  }

  async writeUserFile(content: string): Promise<void> {
    await this.ensureScaffold();
    const uri = this._userFileUri;
    if (!uri) {
      throw new Error('No workspace root folder available');
    }
    await this._fileService.writeFile(uri, ensureTrailingNewline(normalizeMarkdown(content)));
  }

  async readDailyMemory(date: Date = new Date()): Promise<string> {
    const uri = this.getDailyMemoryUri(date);
    if (!uri) {
      return '';
    }
    if (!(await this._fileService.exists(uri))) {
      return '';
    }
    const result = await this._fileService.readFile(uri);
    return normalizeMarkdown(result.content);
  }

  async ensureDailyMemory(date: Date = new Date()): Promise<string> {
    await this.ensureScaffold();
    const uri = this.getDailyMemoryUri(date);
    if (!uri) {
      throw new Error('No workspace root folder available');
    }

    if (!(await this._fileService.exists(uri))) {
      await this._fileService.writeFile(uri, `# ${formatIsoDate(date)}\n`);
    }

    return this.getDailyMemoryRelativePath(date);
  }

  /**
   * M81 — Overwrite the daily memory file for a date with the given body.
   * The date header (`# YYYY-MM-DD`) is re-applied at the top so callers
   * passing pure body content don't need to know the header convention.
   * Used by `memory_write` action=replace/remove on daily files.
   */
  async writeDailyMemory(body: string, date: Date = new Date()): Promise<void> {
    await this.ensureScaffold();
    const uri = this.getDailyMemoryUri(date);
    if (!uri) {
      throw new Error('No workspace root folder available');
    }
    const normalized = normalizeMarkdown(body).trim();
    const content = normalized
      ? `# ${formatIsoDate(date)}\n\n${normalized}\n`
      : `# ${formatIsoDate(date)}\n`;
    await this._fileService.writeFile(uri, content);
  }

  // ── M81 Phase 8 — lesson files (progressive disclosure) ────────────────────
  // MEMORY.md is now an INDEX of pointers. Lesson bodies live at
  // `.parallx/memory/lessons/<slug>.md` and are read on demand by the agent.

  private get _lessonsDirUri(): URI | undefined {
    return this.memoryRoot?.joinPath(LESSONS_DIR);
  }

  private get _archiveDirUri(): URI | undefined {
    return this.memoryRoot?.joinPath(ARCHIVE_DIR);
  }

  private get _archiveLessonsDirUri(): URI | undefined {
    return this._archiveDirUri?.joinPath(ARCHIVE_LESSONS_DIR);
  }

  private _lessonFileUri(slug: string): URI | undefined {
    return this._lessonsDirUri?.joinPath(`${slug}.md`);
  }

  private _archiveLessonFileUri(slug: string): URI | undefined {
    return this._archiveLessonsDirUri?.joinPath(`${slug}.md`);
  }

  private async _ensureLessonsDir(): Promise<URI> {
    await this.ensureScaffold();
    const uri = this._lessonsDirUri;
    if (!uri) {
      throw new Error('No workspace root folder available');
    }
    if (!(await this._fileService.exists(uri))) {
      await this._fileService.mkdir(uri);
    }
    return uri;
  }

  private async _ensureArchiveLessonsDir(): Promise<URI> {
    await this.ensureScaffold();
    const archiveRoot = this._archiveDirUri;
    if (!archiveRoot) {
      throw new Error('No workspace root folder available');
    }
    if (!(await this._fileService.exists(archiveRoot))) {
      await this._fileService.mkdir(archiveRoot);
    }
    const lessonsArchive = this._archiveLessonsDirUri;
    if (!lessonsArchive) {
      throw new Error('No workspace root folder available');
    }
    if (!(await this._fileService.exists(lessonsArchive))) {
      await this._fileService.mkdir(lessonsArchive);
    }
    return lessonsArchive;
  }

  getLessonsRootRelativePath(): string {
    return `${MEMORY_ROOT_SEGMENTS.join('/')}/${LESSONS_DIR}`;
  }

  getLessonFileRelativePath(slug: string): string {
    return `${MEMORY_ROOT_SEGMENTS.join('/')}/${LESSONS_DIR}/${slug}.md`;
  }

  async readLessonFile(slug: string): Promise<string> {
    const uri = this._lessonFileUri(slug);
    if (!uri) {
      return '';
    }
    if (!(await this._fileService.exists(uri))) {
      return '';
    }
    const result = await this._fileService.readFile(uri);
    return normalizeMarkdown(result.content);
  }

  async writeLessonFile(slug: string, content: string): Promise<void> {
    if (!slug || !slug.trim()) {
      throw new Error('lesson slug is required');
    }
    await this._ensureLessonsDir();
    const uri = this._lessonFileUri(slug);
    if (!uri) {
      throw new Error('No workspace root folder available');
    }
    await this._fileService.writeFile(uri, ensureTrailingNewline(normalizeMarkdown(content)));
  }

  async archiveLessonFile(slug: string): Promise<boolean> {
    if (!slug || !slug.trim()) {
      throw new Error('lesson slug is required');
    }
    const sourceUri = this._lessonFileUri(slug);
    if (!sourceUri || !(await this._fileService.exists(sourceUri))) {
      return false;
    }
    await this._ensureArchiveLessonsDir();
    const targetUri = this._archiveLessonFileUri(slug);
    if (!targetUri) {
      throw new Error('No workspace root folder available');
    }
    const sourceContent = (await this._fileService.readFile(sourceUri)).content;
    await this._fileService.writeFile(targetUri, sourceContent);
    await this._fileService.delete(sourceUri, { recursive: false, useTrash: false });
    return true;
  }

  async listLessons(): Promise<string[]> {
    const uri = this._lessonsDirUri;
    if (!uri) {
      return [];
    }
    if (!(await this._fileService.exists(uri))) {
      return [];
    }
    let entries: Array<{ name: string }> = [];
    try {
      entries = await this._fileService.readdir(uri) as Array<{ name: string }>;
    } catch {
      return [];
    }
    return entries
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -'.md'.length))
      .filter((slug) => slug.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }

  async parseMemoryIndex(): Promise<Array<{ slug: string; description: string; path: string }>> {
    const memory = await this.readDurableMemory();
    if (!memory.trim()) {
      return [];
    }
    const out: Array<{ slug: string; description: string; path: string }> = [];
    for (const rawLine of memory.split('\n')) {
      const line = rawLine.trimEnd();
      const match = line.match(MEMORY_INDEX_LINE_REGEX);
      if (!match) {
        continue;
      }
      const [, , slug, description] = match;
      out.push({
        slug,
        description: description.trim(),
        path: `${LESSONS_DIR}/${slug}.md`,
      });
    }
    return out;
  }

  async addMemoryIndexEntry(slug: string, description: string): Promise<void> {
    await this.ensureScaffold();
    if (!slug || !slug.trim()) {
      throw new Error('lesson slug is required');
    }
    const trimmedSlug = slug.trim();
    const truncatedDescription = (description ?? '').trim().slice(0, MEMORY_INDEX_DESCRIPTION_MAX);
    const title = humanizeSlug(trimmedSlug);
    const newLine = `- [${title}](lessons/${trimmedSlug}.md) — ${truncatedDescription}`;

    const current = normalizeMarkdown(await this.readDurableMemory());
    const base = current.includes('# Memory Index')
      ? current
      : MEMORY_INDEX_HEADER;

    const lines = base.split('\n');
    let replaced = false;
    const nextLines = lines.map((line) => {
      const trimmed = line.trimEnd();
      const match = trimmed.match(MEMORY_INDEX_LINE_REGEX);
      if (match && match[2] === trimmedSlug) {
        replaced = true;
        return newLine;
      }
      return line;
    });

    let nextContent: string;
    if (replaced) {
      nextContent = nextLines.join('\n');
    } else {
      // Append after trimming trailing blank space.
      const trimmedBase = nextLines.join('\n').replace(/\n+$/, '');
      nextContent = `${trimmedBase}\n${newLine}\n`;
    }

    await this.writeDurableMemory(nextContent);
  }

  async removeMemoryIndexEntry(slug: string): Promise<void> {
    if (!slug || !slug.trim()) {
      return;
    }
    const trimmedSlug = slug.trim();
    const current = normalizeMarkdown(await this.readDurableMemory());
    if (!current) {
      return;
    }
    const lines = current.split('\n');
    let removed = false;
    const nextLines = lines.filter((line) => {
      const match = line.trimEnd().match(MEMORY_INDEX_LINE_REGEX);
      if (match && match[2] === trimmedSlug) {
        removed = true;
        return false;
      }
      return true;
    });
    if (!removed) {
      return;
    }
    await this.writeDurableMemory(nextLines.join('\n'));
  }

  async archiveLegacyConceptSection(): Promise<{ archived: boolean; movedChars: number }> {
    const current = await this.readDurableMemory();
    if (!current.trim()) {
      return { archived: false, movedChars: 0 };
    }
    const normalized = normalizeMarkdown(current);
    const heading = '## Concepts';
    const headingIndex = normalized.indexOf(heading);
    if (headingIndex < 0) {
      return { archived: false, movedChars: 0 };
    }
    const bodyStart = headingIndex + heading.length;
    const nextSectionIndex = normalized.indexOf('\n## ', bodyStart);
    const sectionEnd = nextSectionIndex >= 0 ? nextSectionIndex : normalized.length;
    const sectionText = normalized.slice(headingIndex, sectionEnd);

    const matchesSignature = LEGACY_CONCEPTS_SIGNATURE_PATTERNS.every((pattern) => pattern.test(sectionText));
    if (!matchesSignature) {
      return { archived: false, movedChars: 0 };
    }

    await this.ensureScaffold();
    const archiveRoot = this._archiveDirUri;
    if (!archiveRoot) {
      throw new Error('No workspace root folder available');
    }
    if (!(await this._fileService.exists(archiveRoot))) {
      await this._fileService.mkdir(archiveRoot);
    }
    const archiveFileUri = archiveRoot.joinPath(ARCHIVE_LEGACY_CONCEPTS_FILE);
    const stamp = formatIsoDate(new Date());
    const archiveBody = [
      `<!-- Archived from MEMORY.md ## Concepts section on ${stamp} by M81 Phase 8. -->`,
      '',
      sectionText.trim(),
      '',
    ].join('\n');
    await this._fileService.writeFile(archiveFileUri, archiveBody);

    const before = normalized.slice(0, headingIndex).trimEnd();
    const after = nextSectionIndex >= 0
      ? normalized.slice(nextSectionIndex).trimStart()
      : '';
    const rewritten = [before, after].filter((part) => part.length > 0).join('\n\n');
    await this.writeDurableMemory(rewritten ? `${rewritten}\n` : '');

    return { archived: true, movedChars: sectionText.length };
  }

  async appendDailyMemory(text: string, date: Date = new Date()): Promise<void> {
    await this.ensureScaffold();
    const uri = this.getDailyMemoryUri(date);
    if (!uri) {
      throw new Error('No workspace root folder available');
    }

    const normalized = normalizeMarkdown(text).trim();
    if (!normalized) {
      return;
    }

    let existing = '';
    if (await this._fileService.exists(uri)) {
      existing = normalizeMarkdown((await this._fileService.readFile(uri)).content);
    }

    const nextContent = existing.trim().length > 0
      ? `${ensureTrailingNewline(existing).trimEnd()}\n\n${normalized}\n`
      : `# ${formatIsoDate(date)}\n\n${normalized}\n`;

    await this._fileService.writeFile(uri, nextContent);
  }

  async appendSessionSummary(sessionId: string, summary: string, messageCount: number, date: Date = new Date()): Promise<void> {
    await this.ensureScaffold();
    const uri = this.getDailyMemoryUri(date);
    if (!uri) {
      throw new Error('No workspace root folder available');
    }

    const normalizedSummary = normalizeMarkdown(summary).trim();
    if (!normalizedSummary) {
      return;
    }

    const sessionHeading = `## Session ${sessionId}`;
    const sessionBody = [
      `- Message count: ${messageCount}`,
      `- Summary: ${normalizedSummary}`,
    ].join('\n');

    let existing = '';
    if (await this._fileService.exists(uri)) {
      existing = normalizeMarkdown((await this._fileService.readFile(uri)).content);
    }

    const base = existing.trim().length > 0
      ? existing
      : `# ${formatIsoDate(date)}\n`;
    const nextContent = replaceMarkdownSection(base, sessionHeading, sessionBody);
    await this._fileService.writeFile(uri, nextContent);
  }

  async syncPreferences(preferences: Array<{ key: string; value: string }>): Promise<void> {
    await this.ensureScaffold();

    const lines = preferences.length > 0
      ? preferences.map((preference) => `- ${preference.key}: ${preference.value}`)
      : ['- No durable preferences recorded yet.'];

    const current = await this.readDurableMemory();
    const base = current.trim().length > 0
      ? current
      : '# Durable Memory\n\nCurated long-term decisions, preferences, conventions, and critical facts.\n';
    const next = replaceMarkdownSection(base, PREFERENCES_SECTION_HEADING, lines.join('\n'));
    await this.writeDurableMemory(next);
  }

  async readPreferences(): Promise<Array<{ key: string; value: string }>> {
    const durableMemory = await this.readDurableMemory();
    return parsePreferenceLines(extractMarkdownSection(durableMemory, PREFERENCES_SECTION_HEADING));
  }

  async upsertPreferences(preferences: Array<{ key: string; value: string }>): Promise<void> {
    if (preferences.length === 0) {
      return;
    }

    const merged = new Map<string, string>();
    for (const preference of await this.readPreferences()) {
      merged.set(preference.key, preference.value);
    }
    for (const preference of preferences) {
      merged.set(preference.key, preference.value);
    }

    await this.syncPreferences(
      Array.from(merged.entries()).map(([key, value]) => ({ key, value })),
    );
  }

  // M81 Phase 3 Stage 2 — syncConcepts / readConcepts / upsertConcepts /
  // searchConcepts were the substrate for the auto-extracted `## Concepts`
  // section in MEMORY.md. Removed; concept curation now flows through the
  // agent's `memory_write` tool, which writes free-form markdown that the
  // RAG retrieval layer surfaces in context per-turn.

  async getPreferencesPromptBlock(): Promise<string | undefined> {
    const durableMemory = await this.readDurableMemory();
    if (!durableMemory.trim()) {
      return undefined;
    }

    const preferenceLines = parsePreferenceLines(extractMarkdownSection(durableMemory, PREFERENCES_SECTION_HEADING))
      .map((preference) => `- ${preference.key}: ${preference.value}`);

    if (preferenceLines.length === 0) {
      return undefined;
    }

    return ['User preferences (learned from past conversations):', ...preferenceLines].join('\n');
  }

  async findSessionSummaryRelativePath(sessionId: string): Promise<string | undefined> {
    const memoryRoot = this.memoryRoot;
    if (!memoryRoot || !sessionId.trim()) {
      return undefined;
    }

    let entries: Array<{ name: string }> = [];
    try {
      entries = await this._fileService.readdir(memoryRoot) as Array<{ name: string }>;
    } catch {
      return undefined;
    }

    const dailyFiles = entries
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/i.test(name))
      .sort((a, b) => b.localeCompare(a));

    const heading = `## Session ${sessionId}`;
    for (const fileName of dailyFiles) {
      const fileUri = memoryRoot.joinPath(fileName);
      let content = '';
      try {
        if (await this._fileService.exists(fileUri)) {
          content = normalizeMarkdown((await this._fileService.readFile(fileUri)).content);
        }
      } catch {
        content = '';
      }
      if (content.includes(heading)) {
        return `${MEMORY_ROOT_SEGMENTS.join('/')}/${fileName}`;
      }
    }

    return undefined;
  }

  async hasSessionSummary(sessionId: string): Promise<boolean> {
    return !!(await this.findSessionSummaryRelativePath(sessionId));
  }

  async getSessionSummaryMessageCount(sessionId: string): Promise<number | null> {
    const relativePath = await this.findSessionSummaryRelativePath(sessionId);
    if (!relativePath || !this.memoryRoot) {
      return null;
    }

    const fileName = relativePath.split('/').pop();
    if (!fileName) {
      return null;
    }

    const fileUri = this.memoryRoot.joinPath(fileName);
    let content = '';
    try {
      if (await this._fileService.exists(fileUri)) {
        content = normalizeMarkdown((await this._fileService.readFile(fileUri)).content);
      }
    } catch {
      return null;
    }

    const pattern = new RegExp(`## Session ${escapeForRegExp(sessionId)}\\n[\\s\\S]*?- Message count: (\\d+)`, 'm');
    const match = content.match(pattern);
    if (!match) {
      return null;
    }

    const messageCount = Number.parseInt(match[1], 10);
    return Number.isFinite(messageCount) ? messageCount : null;
  }

  async importLegacySnapshot(snapshot: {
    memories: Array<{ sessionId: string; createdAt: string; messageCount: number; summary: string }>;
    preferences: Array<{ key: string; value: string }>;
  }): Promise<{ imported: boolean; reason: 'imported' | 'already-imported' | 'empty-snapshot' }> {
    await this.ensureScaffold();

    const durableMemory = await this.readDurableMemory();
    const existingImportSection = extractMarkdownSection(durableMemory, LEGACY_IMPORT_SECTION_HEADING);
    const alreadyImported = existingImportSection?.includes('Imported legacy DB snapshot: yes') === true;

    const hasContent = snapshot.memories.length > 0 || snapshot.preferences.length > 0;
    if (!hasContent) {
      return { imported: false, reason: 'empty-snapshot' };
    }

    const existingPreferences = await this.readPreferences();
    const existingPreferenceKeys = new Set(existingPreferences.map((preference) => preference.key));
    const missingPreferences = snapshot.preferences.filter((preference) => !existingPreferenceKeys.has(preference.key));
    if (missingPreferences.length > 0) {
      await this.upsertPreferences(missingPreferences);
    }

    let importedMemories = 0;
    for (const memory of snapshot.memories) {
      if (await this.hasSessionSummary(memory.sessionId)) {
        continue;
      }
      const createdAt = new Date(memory.createdAt);
      await this.appendSessionSummary(memory.sessionId, memory.summary, memory.messageCount, Number.isNaN(createdAt.getTime()) ? new Date() : createdAt);
      importedMemories++;
    }

    const importedPreferences = missingPreferences.length;
    const appliedChanges = importedMemories > 0 || importedPreferences > 0;

    if (!appliedChanges && alreadyImported) {
      return { imported: false, reason: 'already-imported' };
    }

    const refreshedDurableMemory = await this.readDurableMemory();
    const importedAt = extractLegacyImportTimestamp(existingImportSection) ?? new Date().toISOString();
    const importBody = [
      '- Imported legacy DB snapshot: yes',
      `- Imported at: ${importedAt}`,
      `- Imported memories: ${snapshot.memories.length}`,
      `- Imported preferences: ${snapshot.preferences.length}`,
      `- Last normalized at: ${new Date().toISOString()}`,
      `- Canonical memories present: ${snapshot.memories.length - importedMemories}/${snapshot.memories.length}`,
      `- Canonical preferences present: ${snapshot.preferences.length - importedPreferences}/${snapshot.preferences.length}`,
    ].join('\n');
    const nextDurableMemory = replaceMarkdownSection(refreshedDurableMemory, LEGACY_IMPORT_SECTION_HEADING, importBody);
    await this.writeDurableMemory(nextDurableMemory);

    return { imported: true, reason: 'imported' };
  }
}