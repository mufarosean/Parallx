import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolFileSystem,
  IBuiltInToolCanonicalMemorySearch,
  IBuiltInToolWorkspaceMemory,
} from '../chatTypes.js';

const MEMORY_ROOT = '.parallx/memory';
const DURABLE_MEMORY_PATH = `${MEMORY_ROOT}/MEMORY.md`;

/**
 * M81 Phase 2 — bounded curation caps for agent-writable memory files.
 *
 * Mirrors the Hermes pattern (~2,200 chars for MEMORY, ~1,375 for USER) but
 * uses round numbers (2,500 / 1,500) that survive minor edits without triggering
 * thrash. Bounds are enforced *before* the write — a write that would exceed
 * the cap returns an error with the current file contents so the agent must
 * choose what to consolidate or remove. Daily files are unbounded because they
 * are append-only logs, not a curated surface.
 */
const USER_MEMORY_CAP_CHARS = 1500;
const DURABLE_MEMORY_CAP_CHARS = 2500;

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveDailyPath(dateInput?: string): { path: string; date: string } | { error: string } {
  const date = (dateInput?.trim() || formatDate(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'date must be in YYYY-MM-DD format' };
  }
  return {
    path: `${MEMORY_ROOT}/${date}.md`,
    date,
  };
}

function normalizeLayer(value: unknown): 'durable' | 'daily' | 'all' {
  const layer = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (layer === 'durable' || layer === 'daily') {
    return layer;
  }
  return 'all';
}

function formatSearchResults(results: Array<{ sourceId: string; contextPrefix: string; text: string; score: number }>): string {
  return results.map((result, index) => {
    const layer = result.sourceId === DURABLE_MEMORY_PATH ? 'Durable' : 'Daily';
    const source = result.contextPrefix || result.sourceId;
    return [
      `[${index + 1}] ${layer} Memory`,
      `Path: ${result.sourceId}`,
      `Source: ${source}`,
      `Score: ${result.score.toFixed(3)}`,
      result.text,
    ].join('\n');
  }).join('\n\n---\n\n');
}

/**
 * `memory_read` — read a canonical workspace-memory file.
 *
 * Reads are routed through `IBuiltInToolWorkspaceMemory` when available so the
 * tool sees the same scaffold/normalization as `memory_write`. The raw
 * `IBuiltInToolFileSystem` is kept as a fallback for legacy callers that
 * activate the tool before `WorkspaceMemoryService` is bound (and for unit
 * tests that exercise the read path without the full service surface).
 *
 * M81 Phase 8 — `name=<slug>` reads `.parallx/memory/lessons/<slug>.md` and
 * requires `workspaceMemory` (lessons live behind the service, not the raw fs).
 */
export function createMemoryGetTool(
  fs: IBuiltInToolFileSystem | undefined,
  workspaceMemory?: IBuiltInToolWorkspaceMemory,
): IChatTool {
  return {
    name: 'memory_read',
    displaySummary: 'Read canonical workspace memory.',
    description:
      'Reads from `.parallx/memory/`. Three modes: ' +
      '(1) default / `layer=durable` — the MEMORY.md INDEX of lesson pointers; ' +
      '(2) `layer=daily` (+ optional `date=YYYY-MM-DD`) — a date-stamped log; ' +
      '(3) `name=<slug>` — the body of a specific lesson at `lessons/<slug>.md` ' +
      '(typically used after scanning the MEMORY.md index and finding a relevant slug). ' +
      'Use when the user references prior context, asks what you remember, or you need to look up a stored fact. ' +
      'For semantic search across all memory layers by topic, use `memory_search` instead.',
    parameters: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['durable', 'daily'], description: 'durable (default) for the MEMORY.md index, daily for a date-stamped log.' },
        date: { type: 'string', description: 'YYYY-MM-DD, defaults to today. Only applies when layer="daily".' },
        name: { type: 'string', description: 'Lesson slug (kebab-case). When provided, reads `.parallx/memory/lessons/<slug>.md` and ignores `layer`/`date`.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'memory',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      // ── Lesson read by slug (M81 Phase 8) ──
      const rawName = typeof args['name'] === 'string' ? args['name'].trim() : '';
      if (rawName) {
        if (!workspaceMemory) {
          return { content: 'Lesson files are not available — no workspace folder is open.', isError: true };
        }
        const slugError = validateLessonSlug(rawName);
        if (slugError) {
          return { content: slugError, isError: true };
        }
        const content = await workspaceMemory.readLessonFile(rawName);
        if (!content.trim()) {
          return { content: `No lesson found at lessons/${rawName}.md.` };
        }
        return { content: `Lesson from lessons/${rawName}.md:\n\n${content}` };
      }

      const layer = normalizeLayer(args['layer']) === 'daily' ? 'daily' : 'durable';
      if (layer === 'durable') {
        if (workspaceMemory) {
          const content = await workspaceMemory.readDurableMemory();
          if (!content.trim()) {
            return { content: `No durable memory file exists yet at ${DURABLE_MEMORY_PATH}.` };
          }
          return { content: `Durable memory from ${DURABLE_MEMORY_PATH}:\n\n${content}` };
        }
        if (!fs) {
          return { content: 'Memory files are not available — no workspace folder is open.', isError: true };
        }
        if (!(await fs.exists(DURABLE_MEMORY_PATH))) {
          return { content: `No durable memory file exists yet at ${DURABLE_MEMORY_PATH}.` };
        }
        const result = await fs.readFileContent(DURABLE_MEMORY_PATH);
        return { content: `Durable memory from ${DURABLE_MEMORY_PATH}:\n\n${result.content}` };
      }

      const resolved = resolveDailyPath(typeof args['date'] === 'string' ? args['date'] : undefined);
      if ('error' in resolved) {
        return { content: resolved.error, isError: true };
      }
      if (workspaceMemory) {
        const dateObj = parseDateString(resolved.date);
        const content = await workspaceMemory.readDailyMemory(dateObj);
        if (!content.trim()) {
          return { content: `No daily memory recorded for ${resolved.date} at ${resolved.path}.` };
        }
        return { content: `Daily memory from ${resolved.path}:\n\n${content}` };
      }
      if (!fs) {
        return { content: 'Memory files are not available — no workspace folder is open.', isError: true };
      }
      if (!(await fs.exists(resolved.path))) {
        return { content: `No daily memory recorded for ${resolved.date} at ${resolved.path}.` };
      }
      const result = await fs.readFileContent(resolved.path);
      return { content: `Daily memory from ${resolved.path}:\n\n${result.content}` };
    },
  };
}

export function createMemorySearchTool(memorySearch: IBuiltInToolCanonicalMemorySearch | undefined): IChatTool {
  return {
    name: 'memory_search',
    displaySummary: 'Semantic search over workspace memory.',
    description:
      'Semantic (embedding) search across the workspace canonical memory in `.parallx/memory/` ' +
      '(both the durable MEMORY.md and all daily logs). ' +
      'Use when looking for stored facts by topic rather than by date/layer — e.g. "what do we know about X", ' +
      '"have we discussed Y before". ' +
      'For reading a specific memory layer directly use `memory_read`.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural-language query describing the topic to recall.' },
        layer: { type: 'string', enum: ['all', 'durable', 'daily'], description: 'Restrict search to one layer. Defaults to all.' },
        date: { type: 'string', description: 'YYYY-MM-DD filter for daily layer.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'memory',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!memorySearch) {
        return { content: 'Memory search is not available — the retrieval service has not been initialized.', isError: true };
      }
      if (!memorySearch.isReady()) {
        return { content: 'Memory search is not available yet — canonical memory indexing is still in progress. Please try again shortly.' };
      }

      const query = String(args['query'] || '').trim();
      if (!query) {
        return { content: 'Search query is empty.', isError: true };
      }

      const layer = normalizeLayer(args['layer']);
      const dailyFilter = resolveDailyPath(typeof args['date'] === 'string' ? args['date'] : undefined);
      if (typeof args['date'] === 'string' && 'error' in dailyFilter) {
        return { content: dailyFilter.error, isError: true };
      }

      const filtered = await memorySearch.search(query, {
        layer,
        date: 'path' in dailyFilter ? dailyFilter.date : undefined,
      });

      if (filtered.length === 0) {
        return { content: `No canonical memory results found for "${query}".` };
      }

      return {
        content: `Found ${filtered.length} canonical memory result(s):\n\n${formatSearchResults(filtered)}`,
      };
    },
  };
}

// ─── memory_write (M81 Phase 2 + Phase 8) ─────────────────────────────────────

type MemoryEditFile = 'USER' | 'MEMORY' | 'daily' | 'lesson';
type MemoryEditAction = 'add' | 'replace' | 'remove';

function isMemoryEditFile(value: unknown): value is MemoryEditFile {
  return value === 'USER' || value === 'MEMORY' || value === 'daily' || value === 'lesson';
}

// ── M81 Phase 8 — lesson slug + description validation ──────────────────────

const LESSON_SLUG_MAX_CHARS = 40;
const LESSON_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const LESSON_DESCRIPTION_MAX_CHARS = 120;

/**
 * Validate a lesson slug. Returns an error string on failure, undefined on
 * success. Kebab-case only — must start with a lowercase letter or digit and
 * may contain lowercase letters, digits, and hyphens. Bounded at 40 chars so
 * the index lines stay scannable.
 */
function validateLessonSlug(slug: string): string | undefined {
  if (!slug) {
    return '`slug` is required for file=lesson.';
  }
  if (slug.length > LESSON_SLUG_MAX_CHARS) {
    return `\`slug\` must be ≤${LESSON_SLUG_MAX_CHARS} chars (got ${slug.length}).`;
  }
  if (!LESSON_SLUG_REGEX.test(slug)) {
    return '`slug` must be kebab-case: lowercase letters, digits, and hyphens; must start with a letter or digit.';
  }
  return undefined;
}

/**
 * Parse a YYYY-MM-DD date string into a local-time Date so the round trip
 * through `WorkspaceMemoryService.getDailyMemoryRelativePath` (which uses
 * local-time accessors) is stable regardless of the user's timezone.
 */
function parseDateString(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    return new Date();
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Capitalize-first-word version of a kebab slug — mirrors `humanizeSlug` in WorkspaceMemoryService. */
function humanizeSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) { return ''; }
  const words = trimmed.replace(/[_\s]+/g, '-').split('-').filter((p) => p.length > 0);
  if (words.length === 0) { return ''; }
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/**
 * Project what the MEMORY.md INDEX content length will be after `addMemoryIndexEntry`
 * writes `slug` with `description`. Mirrors the service's compose logic exactly:
 *   - If slug is already present in the index, the existing line is replaced in-place.
 *   - Otherwise, a new line is appended after stripping trailing blank lines,
 *     with a single `\n` separator and a trailing `\n`.
 * Returns the projected total length in chars.
 */
function projectIndexLengthAfterAdd(
  currentIndex: string,
  parsed: Array<{ slug: string; description: string; path: string }>,
  slug: string,
  description: string,
): number {
  const truncatedDescription = description.trim().slice(0, LESSON_DESCRIPTION_MAX_CHARS);
  const title = humanizeSlug(slug);
  const newLine = `- [${title}](lessons/${slug}.md) — ${truncatedDescription}`;

  const memoryIndexHeader = [
    '# Memory Index',
    '',
    'Long-term lessons. Each line points to a lesson file with the full',
    'body. Bounded — when the index is full the agent removes an old entry',
    'before adding a new one.',
    '',
  ].join('\n');

  const base = currentIndex.includes('# Memory Index') ? currentIndex : memoryIndexHeader;
  const replaced = parsed.some((entry) => entry.slug === slug);

  if (replaced) {
    // Same number of lines, different content. Compute by substituting.
    const lines = base.split('\n');
    const nextLines = lines.map((line) => {
      const m = line.trimEnd().match(/^- \[([^\]]+)\]\(lessons\/([^)]+)\.md\)\s+—\s+(.+)$/);
      if (m && m[2] === slug) {
        return newLine;
      }
      return line;
    });
    return nextLines.join('\n').length;
  }

  // Append path mirrors the service: trim trailing newlines, add `\n<newLine>\n`.
  const trimmedBase = base.replace(/\n+$/, '');
  return `${trimmedBase}\n${newLine}\n`.length;
}

function isMemoryEditAction(value: unknown): value is MemoryEditAction {
  return value === 'add' || value === 'replace' || value === 'remove';
}

/**
 * "Body-edit" files — the subset of `MemoryEditFile` the substring-edit path
 * handles. `lesson` is a separate code path that addresses files by slug, so
 * it is intentionally excluded here.
 */
type MemoryEditBodyFile = 'USER' | 'MEMORY' | 'daily';

function fileCap(file: MemoryEditBodyFile): number | null {
  if (file === 'USER') { return USER_MEMORY_CAP_CHARS; }
  if (file === 'MEMORY') { return DURABLE_MEMORY_CAP_CHARS; }
  return null; // daily is unbounded — it's an append-only log
}

function filePath(workspaceMemory: IBuiltInToolWorkspaceMemory, file: MemoryEditBodyFile, date?: Date): string {
  if (file === 'USER') { return workspaceMemory.getUserFileRelativePath(); }
  if (file === 'MEMORY') { return workspaceMemory.getDurableMemoryRelativePath(); }
  return workspaceMemory.getDailyMemoryRelativePath(date);
}

async function readFileContent(workspaceMemory: IBuiltInToolWorkspaceMemory, file: MemoryEditBodyFile, date?: Date): Promise<string> {
  if (file === 'USER') { return await workspaceMemory.readUserFile(); }
  if (file === 'MEMORY') { return await workspaceMemory.readDurableMemory(); }
  return await workspaceMemory.readDailyMemory(date);
}

/**
 * Strip the `# YYYY-MM-DD` header off a daily file's full content so the body
 * can be passed to `writeDailyMemory` (which re-applies the header). For
 * USER.md and MEMORY.md this returns the content as-is.
 */
function stripDailyHeader(content: string): string {
  const headerMatch = content.match(/^# \d{4}-\d{2}-\d{2}\n+/);
  return headerMatch ? content.slice(headerMatch[0].length).trim() : content.trim();
}

async function writeFileContent(workspaceMemory: IBuiltInToolWorkspaceMemory, file: MemoryEditBodyFile, content: string, date?: Date): Promise<void> {
  if (file === 'USER') {
    await workspaceMemory.writeUserFile(content);
    return;
  }
  if (file === 'MEMORY') {
    await workspaceMemory.writeDurableMemory(content);
    return;
  }
  // daily — strip the date header (writeDailyMemory re-applies it) so callers
  // can pass a full re-derived file body without duplicating the front matter.
  await workspaceMemory.writeDailyMemory(stripDailyHeader(content), date);
}

/**
 * Render a full file dump for the "bounded write rejected" path so the agent
 * can decide what to consolidate or remove. Matches Hermes's error-on-full
 * protocol — the model gets enough context to make a good consolidation.
 */
function formatBoundedRejection(file: MemoryEditBodyFile, current: string, cap: number, addedChars: number): string {
  const projected = current.length + addedChars;
  return [
    `Cannot add — ${file}.md would reach ${projected}/${cap} chars after this write.`,
    '',
    'Current contents:',
    '',
    current.length > 0 ? current : '(file is empty)',
    '',
    `Use action='replace' or action='remove' to free space before adding, ` +
      `or shorten the entry. The cap is a curation discipline: the file is meant ` +
      `to hold only the most durable, generally-applicable facts.`,
  ].join('\n');
}

/**
 * memory_write — single tool the agent uses to mutate workspace memory.
 *
 * Design (M81 Phase 2):
 *   - Three files: USER (identity), MEMORY (durable facts), daily (date log).
 *   - Three actions: add (append), replace (substring match), remove.
 *   - Bounded files (USER, MEMORY) enforce char caps before writing; daily is
 *     unbounded since it is an append-only history surface.
 *   - On bound exceeded, the tool returns the current file contents so the
 *     agent can choose what to consolidate. Mirrors Hermes's `memory` tool.
 *
 * Cohesion: routes every write through `IBuiltInToolWorkspaceMemory`, which is
 * a thin accessor around `WorkspaceMemoryService` — the same service that owns
 * MEMORY.md, USER.md, and daily files. No parallel write path; SQLite-side
 * caches (concepts, conversation summaries) continue to flow through the
 * separate auto-extraction pipeline being wired in Phase 3.
 */
export function createMemoryEditTool(
  workspaceMemory: IBuiltInToolWorkspaceMemory | undefined,
): IChatTool {
  return {
    name: 'memory_write',
    displaySummary: 'Add, replace, or remove an entry in workspace memory.',
    description:
      'Adds, replaces, or removes an entry in one of the workspace memory files — the canonical, durable record. ' +
      '(For your OWN soft, evolving beliefs or hunches about the user that decay over time, use `mind_remember` instead.) ' +
      'Use `file=USER` for facts about the user (identity, preferences, current focus). ' +
      'Use `file=MEMORY` for durable workspace facts (decisions, conventions, project state). ' +
      'Use `file=daily` to log dated events (today by default). ' +
      'Use `file=lesson` for durable tool-use lessons / workarounds / things-to-remember-across-sessions ' +
      '(e.g. "don\'t use X, use Y instead", recurring tool mistakes, gotchas). Each lesson is its own file at ' +
      '`.parallx/memory/lessons/<slug>.md`; MEMORY.md only stores a short index pointing at it. ' +
      'For `file=lesson` you must supply `slug` (kebab-case, ≤40 chars) — `description` (≤120 chars, one-line summary) ' +
      'is required for add and optional for replace; `entry` is the lesson body. ' +
      'Actions: `add` appends `entry` (or for lesson: writes a new lesson file + index entry); ' +
      '`replace` substitutes `entry` for the first occurrence of `target` (or for lesson: rewrites the lesson body); ' +
      '`remove` deletes the first occurrence of `target` (or for lesson: archives the file + drops the index entry). ' +
      'USER.md is capped at 1,500 chars and MEMORY.md at 2,500 chars — if an `add` would exceed the cap (for lessons: ' +
      'if the INDEX would exceed it), the tool returns the current contents so you can consolidate via `replace` or `remove` first. ' +
      'Daily logs are unbounded. ' +
      'Use this tool when the user states a durable preference, when a project decision is made, ' +
      'when the user corrects a tool-use mistake (use `file=lesson`), or when a fact emerges that should carry across future sessions. ' +
      'Read the file first with `memory_read` (or `memory_read name=<slug>` for a lesson) if you are unsure what is already there.',
    parameters: {
      type: 'object',
      required: ['file', 'action'],
      properties: {
        file: {
          type: 'string',
          enum: ['USER', 'MEMORY', 'daily', 'lesson'],
          description: 'Which memory file to edit. USER = user identity, MEMORY = durable workspace memory (index of lessons), daily = date-stamped log, lesson = a topic file under .parallx/memory/lessons/.',
        },
        action: {
          type: 'string',
          enum: ['add', 'replace', 'remove'],
          description: 'add appends `entry` (or for lesson: creates a new lesson file + index entry); replace substitutes `entry` for the first occurrence of `target` (or for lesson: rewrites the body); remove deletes the first occurrence of `target` (or for lesson: archives the file + drops the index entry).',
        },
        entry: {
          type: 'string',
          description: 'The new content to add or substitute. Required for add and replace (including lesson add/replace, where it is the lesson body). Markdown preferred — use ## / ### headers and bullet lists to match the file\'s existing structure.',
        },
        target: {
          type: 'string',
          description: 'The substring to match for replace and remove on USER / MEMORY / daily files. Ignored for file=lesson (lessons are addressed by slug). The first occurrence is acted on.',
        },
        date: {
          type: 'string',
          description: 'YYYY-MM-DD. Only applies when file=daily. Defaults to today.',
        },
        slug: {
          type: 'string',
          description: 'Lesson slug (kebab-case identifier, ≤40 chars, matches /^[a-z0-9][a-z0-9-]*$/). Required for any action when file=lesson.',
        },
        description: {
          type: 'string',
          description: 'One-line summary (≤120 chars) of the lesson, shown in the MEMORY.md index. Required for action=add on file=lesson; optional for action=replace (when supplied, the index entry description is also updated).',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'memory',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!workspaceMemory) {
        return { content: 'memory_write is not available — no workspace folder is open.', isError: true };
      }

      const file = args['file'];
      if (!isMemoryEditFile(file)) {
        return { content: "Invalid `file` — must be 'USER', 'MEMORY', 'daily', or 'lesson'.", isError: true };
      }

      const action = args['action'];
      if (!isMemoryEditAction(action)) {
        return { content: "Invalid `action` — must be 'add', 'replace', or 'remove'.", isError: true };
      }

      const entry = typeof args['entry'] === 'string' ? args['entry'] : '';
      const target = typeof args['target'] === 'string' ? args['target'] : '';
      const rawDate = typeof args['date'] === 'string' ? args['date'].trim() : '';
      let date: Date | undefined;
      if (file === 'daily' && rawDate) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
        if (!m) {
          return { content: '`date` must be in YYYY-MM-DD format.', isError: true };
        }
        // Construct as local-time so it round-trips through `formatIsoDate`
        // (which uses local-time accessors) regardless of the user's timezone.
        date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      }

      // ── file=lesson branch (M81 Phase 8) ──
      if (file === 'lesson') {
        const slug = typeof args['slug'] === 'string' ? args['slug'].trim() : '';
        const slugError = validateLessonSlug(slug);
        if (slugError) {
          return { content: slugError, isError: true };
        }
        const descriptionRaw = typeof args['description'] === 'string' ? args['description'].trim() : '';

        if (action === 'add') {
          if (!entry.trim()) {
            return { content: '`entry` (lesson body) is required for action=add on file=lesson.', isError: true };
          }
          if (!descriptionRaw) {
            return { content: '`description` is required for action=add on file=lesson — a one-line summary (≤120 chars) shown in the MEMORY.md index.', isError: true };
          }
          if (descriptionRaw.length > LESSON_DESCRIPTION_MAX_CHARS) {
            return { content: `\`description\` must be ≤${LESSON_DESCRIPTION_MAX_CHARS} chars (got ${descriptionRaw.length}).`, isError: true };
          }

          // INDEX cap check — bounds the *number* of lessons, not their bodies.
          const currentIndex = await workspaceMemory.readDurableMemory();
          const parsed = await workspaceMemory.parseMemoryIndex();
          const projectedLength = projectIndexLengthAfterAdd(currentIndex, parsed, slug, descriptionRaw);
          if (projectedLength > DURABLE_MEMORY_CAP_CHARS) {
            const indexEntries = parsed.length > 0
              ? parsed.map((e) => `- ${e.slug} — ${e.description}`).join('\n')
              : '(index is empty)';
            return {
              content: [
                `Cannot add — MEMORY.md INDEX would reach ${projectedLength}/${DURABLE_MEMORY_CAP_CHARS} chars after this write. ` +
                  'The cap bounds the number of lessons, not their bodies.',
                '',
                'Current index entries:',
                '',
                indexEntries,
                '',
                "Use action='remove' to free an entry before adding.",
              ].join('\n'),
              isError: true,
            };
          }

          await workspaceMemory.writeLessonFile(slug, entry);
          await workspaceMemory.addMemoryIndexEntry(slug, descriptionRaw);
          return { content: `Added lesson \`${slug}\` to MEMORY.md index and wrote lessons/${slug}.md.` };
        }

        if (action === 'replace') {
          if (!entry.trim()) {
            return { content: '`entry` (new lesson body) is required for action=replace on file=lesson.', isError: true };
          }
          if (descriptionRaw && descriptionRaw.length > LESSON_DESCRIPTION_MAX_CHARS) {
            return { content: `\`description\` must be ≤${LESSON_DESCRIPTION_MAX_CHARS} chars (got ${descriptionRaw.length}).`, isError: true };
          }
          const existing = await workspaceMemory.readLessonFile(slug);
          if (!existing.trim()) {
            return { content: `Lesson ${slug} doesn't exist. Use action=add instead.`, isError: true };
          }
          await workspaceMemory.writeLessonFile(slug, entry);
          if (descriptionRaw) {
            await workspaceMemory.addMemoryIndexEntry(slug, descriptionRaw);
            return { content: `Replaced lessons/${slug}.md and updated index description.` };
          }
          return { content: `Replaced lessons/${slug}.md.` };
        }

        // action === 'remove'
        const archived = await workspaceMemory.archiveLessonFile(slug);
        const parsedBefore = await workspaceMemory.parseMemoryIndex();
        const hadIndexEntry = parsedBefore.some((e) => e.slug === slug);
        await workspaceMemory.removeMemoryIndexEntry(slug);
        if (!archived && !hadIndexEntry) {
          return { content: `Lesson ${slug} not found.`, isError: true };
        }
        return { content: `Removed lesson ${slug} (archived to _archive/lessons/${slug}.md, index entry removed).` };
      }

      const path = filePath(workspaceMemory, file, date);

      if (action === 'add') {
        if (!entry.trim()) {
          return { content: '`entry` is required and cannot be empty for action=add.', isError: true };
        }

        if (file === 'daily') {
          // Daily files are append-only. WorkspaceMemoryService.appendDailyMemory
          // handles directory + scaffold + idempotent write.
          await workspaceMemory.appendDailyMemory(entry, date);
          return { content: `Appended to ${path}.` };
        }

        const current = await readFileContent(workspaceMemory, file, date);
        const cap = fileCap(file);
        if (cap !== null) {
          // Account for the "\n\n" separator the append will introduce when the
          // file already has content.
          const separatorChars = current.trim().length > 0 ? 2 : 0;
          const projected = current.length + separatorChars + entry.length;
          if (projected > cap) {
            return {
              content: formatBoundedRejection(file, current, cap, separatorChars + entry.length),
              isError: true,
            };
          }
        }

        const next = current.trim().length > 0
          ? `${current.trimEnd()}\n\n${entry.trim()}\n`
          : `${entry.trim()}\n`;
        await writeFileContent(workspaceMemory, file, next, date);
        return { content: `Added entry to ${path}.` };
      }

      // replace and remove both require target and operate on existing content
      if (!target.trim()) {
        return { content: `\`target\` is required for action=${action}.`, isError: true };
      }

      const current = await readFileContent(workspaceMemory, file, date);
      const matchIdx = current.indexOf(target);
      if (matchIdx < 0) {
        return {
          content: `Could not find target in ${path}. The substring you provided does not match any text in the file.`,
          isError: true,
        };
      }

      let next: string;
      if (action === 'replace') {
        if (!entry.trim()) {
          return { content: '`entry` is required for action=replace.', isError: true };
        }
        next = current.slice(0, matchIdx) + entry + current.slice(matchIdx + target.length);
      } else {
        // remove
        next = current.slice(0, matchIdx) + current.slice(matchIdx + target.length);
      }

      // Bound check on result. Replace can grow the file; remove always shrinks
      // it so it's safe — but we still guard for symmetry.
      const cap = fileCap(file);
      if (cap !== null && next.length > cap) {
        return {
          content: formatBoundedRejection(file, current, cap, next.length - current.length),
          isError: true,
        };
      }

      await writeFileContent(workspaceMemory, file, next, date);
      return {
        content: action === 'replace'
          ? `Replaced target in ${path}.`
          : `Removed target from ${path}.`,
      };
    },
  };
}