import { Disposable } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import type { IFileService, IWorkspaceMemoryService, IWorkspaceService } from './serviceTypes.js';

const MEMORY_ROOT_SEGMENTS = ['.parallx', 'memory'] as const;
const DURABLE_MEMORY_FILE = 'MEMORY.md';
const PREFERENCES_SECTION_HEADING = '## Preferences';
const CONCEPTS_SECTION_HEADING = '## Concepts';
const LEGACY_IMPORT_SECTION_HEADING = '## Legacy Import';

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

function parseConceptSection(section: string | undefined): Array<{ concept: string; category: string; summary: string; encounterCount: number; masteryLevel: number; struggleCount: number }> {
  if (!section) {
    return [];
  }

  const blocks = section.split(/\n(?=### )/g).map((block) => block.trim()).filter(Boolean);
  const concepts: Array<{ concept: string; category: string; summary: string; encounterCount: number; masteryLevel: number; struggleCount: number }> = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines[0]?.startsWith('### ')) {
      continue;
    }
    const concept = lines[0].slice(4).trim();
    if (!concept) {
      continue;
    }

    const metadata = new Map<string, string>();
    for (const line of lines.slice(1)) {
      if (!line.startsWith('- ')) {
        continue;
      }
      const separatorIndex = line.indexOf(':');
      if (separatorIndex < 0) {
        continue;
      }
      metadata.set(line.slice(2, separatorIndex).trim().toLowerCase(), line.slice(separatorIndex + 1).trim());
    }

    concepts.push({
      concept,
      category: metadata.get('category') || 'general',
      summary: metadata.get('summary') || '',
      encounterCount: Number.parseInt(metadata.get('encounters') || '1', 10) || 1,
      masteryLevel: Number.parseFloat(metadata.get('mastery') || '0') || 0,
      struggleCount: Number.parseInt(metadata.get('struggles') || '0', 10) || 0,
    });
  }

  return concepts;
}

function normalizeConceptKey(concept: string): string {
  return concept.trim().toLowerCase();
}

function scoreConcept(queryTerms: string[], concept: { concept: string; category: string; summary: string }): number {
  const haystack = `${concept.concept} ${concept.category} ${concept.summary}`.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (concept.concept.toLowerCase().includes(term)) {
      score += 4;
    }
    if (concept.category.toLowerCase().includes(term)) {
      score += 2;
    }
    if (haystack.includes(term)) {
      score += 1;
    }
  }
  return score;
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

  async syncConcepts(concepts: Array<{ concept: string; category: string; summary: string; encounterCount?: number; masteryLevel?: number; struggleCount?: number }>): Promise<void> {
    await this.ensureScaffold();

    const lines = concepts.length > 0
      ? concepts.map((concept) => {
          const details = [
            `- Category: ${concept.category || 'general'}`,
            typeof concept.encounterCount === 'number' ? `- Encounters: ${concept.encounterCount}` : undefined,
            typeof concept.masteryLevel === 'number' ? `- Mastery: ${concept.masteryLevel}` : undefined,
            typeof concept.struggleCount === 'number' ? `- Struggles: ${concept.struggleCount}` : undefined,
            `- Summary: ${concept.summary || ''}`,
          ].filter(Boolean);
          return [`### ${concept.concept}`, '', ...details].join('\n');
        })
      : ['- No imported concepts recorded yet.'];

    const current = await this.readDurableMemory();
    const base = current.trim().length > 0
      ? current
      : '# Durable Memory\n\nCurated long-term decisions, preferences, conventions, and critical facts.\n';
    const next = replaceMarkdownSection(base, CONCEPTS_SECTION_HEADING, lines.join('\n\n'));
    await this.writeDurableMemory(next);
  }

  async readConcepts(): Promise<Array<{ concept: string; category: string; summary: string; encounterCount: number; masteryLevel: number; struggleCount: number }>> {
    const durableMemory = await this.readDurableMemory();
    return parseConceptSection(extractMarkdownSection(durableMemory, CONCEPTS_SECTION_HEADING));
  }

  async upsertConcepts(concepts: Array<{ concept: string; category: string; summary: string; encounterCount?: number; masteryLevel?: number; struggleCount?: number }>): Promise<void> {
    if (concepts.length === 0) {
      return;
    }

    const merged = new Map<string, { concept: string; category: string; summary: string; encounterCount: number; masteryLevel: number; struggleCount: number }>();
    for (const concept of await this.readConcepts()) {
      merged.set(normalizeConceptKey(concept.concept), concept);
    }

    for (const concept of concepts) {
      const key = normalizeConceptKey(concept.concept);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          concept: concept.concept.trim(),
          category: concept.category || 'general',
          summary: concept.summary || '',
          encounterCount: concept.encounterCount ?? 1,
          masteryLevel: concept.masteryLevel ?? 0,
          struggleCount: concept.struggleCount ?? 0,
        });
        continue;
      }

      merged.set(key, {
        concept: existing.concept,
        category: existing.category === 'general' ? (concept.category || existing.category) : existing.category,
        summary: (concept.summary || '').length > existing.summary.length ? (concept.summary || '') : existing.summary,
        encounterCount: existing.encounterCount + (concept.encounterCount ?? 1),
        masteryLevel: Math.max(0, Math.min(1, concept.masteryLevel ?? existing.masteryLevel)),
        struggleCount: existing.struggleCount + (concept.struggleCount ?? 0),
      });
    }

    await this.syncConcepts(Array.from(merged.values()));
  }

  async searchConcepts(query: string, topK: number = 5): Promise<Array<{ concept: string; category: string; summary: string; encounterCount: number; masteryLevel: number; struggleCount: number }>> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const queryTerms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
    const concepts = await this.readConcepts();
    return concepts
      .map((concept) => ({ concept, score: scoreConcept(queryTerms, concept) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.concept.encounterCount - a.concept.encounterCount)
      .slice(0, topK)
      .map((entry) => entry.concept);
  }

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
    concepts: Array<{ concept: string; category: string; summary: string; encounterCount?: number; masteryLevel?: number }>;
  }): Promise<{ imported: boolean; reason: 'imported' | 'already-imported' | 'empty-snapshot' }> {
    await this.ensureScaffold();

    const durableMemory = await this.readDurableMemory();
    const existingImportSection = extractMarkdownSection(durableMemory, LEGACY_IMPORT_SECTION_HEADING);
    const alreadyImported = existingImportSection?.includes('Imported legacy DB snapshot: yes') === true;

    const hasContent = snapshot.memories.length > 0 || snapshot.preferences.length > 0 || snapshot.concepts.length > 0;
    if (!hasContent) {
      return { imported: false, reason: 'empty-snapshot' };
    }

    const existingPreferences = await this.readPreferences();
    const existingPreferenceKeys = new Set(existingPreferences.map((preference) => preference.key));
    const missingPreferences = snapshot.preferences.filter((preference) => !existingPreferenceKeys.has(preference.key));
    if (missingPreferences.length > 0) {
      await this.upsertPreferences(missingPreferences);
    }

    const existingConcepts = await this.readConcepts();
    const existingConceptKeys = new Set(existingConcepts.map((concept) => normalizeConceptKey(concept.concept)));
    const missingConcepts = snapshot.concepts.filter((concept) => !existingConceptKeys.has(normalizeConceptKey(concept.concept)));
    if (missingConcepts.length > 0) {
      await this.upsertConcepts(missingConcepts.map((concept) => ({
        concept: concept.concept,
        category: concept.category,
        summary: concept.summary,
        encounterCount: concept.encounterCount,
        masteryLevel: concept.masteryLevel,
        struggleCount: 0,
      })));
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
    const importedConcepts = missingConcepts.length;
    const appliedChanges = importedMemories > 0 || importedPreferences > 0 || importedConcepts > 0;

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
      `- Imported concepts: ${snapshot.concepts.length}`,
      `- Last normalized at: ${new Date().toISOString()}`,
      `- Canonical memories present: ${snapshot.memories.length - importedMemories}/${snapshot.memories.length}`,
      `- Canonical preferences present: ${snapshot.preferences.length - importedPreferences}/${snapshot.preferences.length}`,
      `- Canonical concepts present: ${snapshot.concepts.length - importedConcepts}/${snapshot.concepts.length}`,
    ].join('\n');
    const nextDurableMemory = replaceMarkdownSection(refreshedDurableMemory, LEGACY_IMPORT_SECTION_HEADING, importBody);
    await this.writeDurableMemory(nextDurableMemory);

    return { imported: true, reason: 'imported' };
  }
}