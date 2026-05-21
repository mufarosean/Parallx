// canvasTemplates.ts — Page template catalog (M77 Phase 11.4 + post-ship rev)
//
// Provides starter templates so a new page isn't always an empty
// paragraph. Templates have two flavors:
//
//   1. Built-in templates: curated starter set defined inline below.
//      Pure data (TipTap doc JSON + metadata). `source: 'builtin'`.
//      `icon` is a Lucide icon ID (matches the Parallx icon system —
//      `createIconElement(id, size)` consumes the same vocabulary).
//
//   2. User templates: stored in `<workspace>/.parallx/canvas-templates/*.json`.
//      Loaded async. Users create them via "Save page as template" or by
//      editing the JSON directly. `source: 'user'`.
//
// The picker UI lives in `canvasTemplatePicker.ts`; this file holds the
// data + the API the picker consumes. Templates are pure data — they
// don't touch the DOM or DB themselves; the caller creates the page
// through CanvasDataService and seeds its content via `flushContentSave`.

/**
 * Minimal API shape this module needs. Mirrors a slice of the host's
 * frozen `ParallxApiObject` (and of canvas/main.ts's local ParallxApi):
 * workspace folders + the workspace fs bridge. Kept local so the canvas
 * tool's tightly-scoped internal ParallxApi interface remains assignable
 * structurally without dragging in unrelated namespaces.
 */
export interface CanvasTemplateApi {
  readonly workspace?: {
    readonly workspaceFolders?: readonly { readonly uri: string }[];
    readonly fs?: {
      readFile(uri: string): Promise<{ content: string; encoding: string }>;
      writeFile(uri: string, content: string): Promise<void>;
      readdir(uri: string): Promise<readonly { name: string; type: number }[]>;
      exists(uri: string): Promise<boolean>;
      mkdir(uri: string): Promise<void>;
      delete(uri: string, options?: { useTrash?: boolean; recursive?: boolean }): Promise<void>;
    };
  };
}

export type CanvasTemplateSource = 'builtin' | 'user';

export interface CanvasPageTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /**
   * Lucide-style icon ID consumed by `createIconElement` in the canvas
   * icon registry. Falls back to `'file-text'` if unrecognized. NEVER
   * an emoji — Parallx system UI uses the Lucide SVG vocabulary.
   */
  readonly icon: string;
  /** Built-in or user-authored. Affects sort order + edit affordances. */
  readonly source: CanvasTemplateSource;
  /** Path on disk for user templates (omitted for built-ins). */
  readonly filePath?: string;
  /** TipTap doc JSON for the page body. */
  buildDoc(): unknown;
  /** Default title applied to the new page. */
  defaultTitle: string;
}

function todayLabel(): string {
  // YYYY-MM-DD with the user's local date (not UTC) so a 10pm note
  // doesn't get tomorrow's date in time zones west of UTC.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const BUILTIN_CANVAS_TEMPLATES: CanvasPageTemplate[] = [
  {
    id: 'daily-note',
    name: 'Daily note',
    description: 'Date-stamped journal with three quick sections.',
    icon: 'calendar-days',
    source: 'builtin',
    defaultTitle: `${todayLabel()} — Daily note`,
    buildDoc(): unknown {
      return {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Focus today' }] },
          { type: 'paragraph' },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Reflection' }] },
          { type: 'paragraph' },
        ],
      };
    },
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    description: 'Attendees, agenda, decisions, and action items.',
    icon: 'users',
    source: 'builtin',
    defaultTitle: 'Meeting — ',
    buildDoc(): unknown {
      return {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Attendees: ' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Date: ' }, { type: 'text', text: todayLabel() }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Agenda' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Decisions' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Action items' }] },
          { type: 'taskList', content: [
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] },
          ]},
        ],
      };
    },
  },
  {
    id: 'project-brief',
    name: 'Project brief',
    description: 'Goal, scope, deliverables, and timeline outline.',
    icon: 'target',
    source: 'builtin',
    defaultTitle: 'Project: ',
    buildDoc(): unknown {
      return {
        type: 'doc',
        content: [
          { type: 'callout', attrs: { emoji: '💡' }, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'One-sentence summary of what this project is.' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goal' }] },
          { type: 'paragraph' },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Scope' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'In:' }, { type: 'text', text: ' ' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Out:' }, { type: 'text', text: ' ' }] }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Deliverables' }] },
          { type: 'taskList', content: [
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Timeline' }] },
          { type: 'paragraph' },
        ],
      };
    },
  },
];

// ─── User template storage ───────────────────────────────────────────────────
//
// User templates live as JSON files in `<workspace>/.parallx/canvas-templates/`.
// One file per template. The filename (sans `.json`) is the template id.
// Files are written + read via the workspace fs bridge, so they migrate
// with the workspace folder.

const USER_TEMPLATE_DIR = '.parallx/canvas-templates';

interface IUserTemplateFile {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly defaultTitle?: string;
  readonly doc: unknown;
}

/** Sanitize a template id so it's safe as a filename. */
function _sanitizeTemplateId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'template';
}

/** Built-in templates as-is. Synchronous since they're code-defined. */
export function getBuiltinCanvasTemplates(): readonly CanvasPageTemplate[] {
  return BUILTIN_CANVAS_TEMPLATES;
}

/**
 * Load user templates from `<workspace>/.parallx/canvas-templates/*.json`.
 * Returns an empty array if the directory doesn't exist or the fs bridge
 * is unavailable (headless tests). Malformed files are skipped with a
 * console warning rather than throwing — one bad template shouldn't break
 * the picker.
 */
export async function loadUserCanvasTemplates(api: CanvasTemplateApi): Promise<readonly CanvasPageTemplate[]> {
  const fs = api.workspace?.fs;
  const workspaceUri = api.workspace?.workspaceFolders?.[0]?.uri;
  if (!fs || !workspaceUri) return [];

  // The fs bridge URIs use workspace-relative paths through file://
  // scheme. We resolve via URI concatenation; the underlying readdir/
  // readFile handlers accept the joined path.
  const dirUri = _join(workspaceUri, USER_TEMPLATE_DIR);
  let entries: readonly { name: string; type: number }[] = [];
  try {
    if (!(await fs.exists(dirUri))) return [];
    entries = await fs.readdir(dirUri);
  } catch {
    return [];
  }

  const templates: CanvasPageTemplate[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;
    const fileUri = _join(dirUri, entry.name);
    try {
      const result = await fs.readFile(fileUri);
      if (!result || typeof result.content !== 'string') continue;
      const parsed = JSON.parse(result.content) as IUserTemplateFile;
      if (!parsed || typeof parsed.id !== 'string' || typeof parsed.name !== 'string' || parsed.doc === undefined) {
        console.warn(`[CanvasTemplates] skipping malformed template ${entry.name}: missing required fields`);
        continue;
      }
      const doc = parsed.doc;
      templates.push({
        id: parsed.id,
        name: parsed.name,
        description: parsed.description ?? '',
        icon: parsed.icon || 'file-text',
        source: 'user',
        filePath: fileUri,
        defaultTitle: parsed.defaultTitle ?? parsed.name,
        buildDoc: (): unknown => doc,
      });
    } catch (err) {
      console.warn(`[CanvasTemplates] skipping malformed template ${entry.name}:`, err);
    }
  }
  // Sort user templates alphabetically — built-ins always come first
  // (callers do the merge / sort by source).
  templates.sort((a, b) => a.name.localeCompare(b.name));
  return templates;
}

/**
 * Get the full merged list: built-ins first (in their authored order),
 * then user templates alphabetically. Async because user templates are
 * read from disk.
 */
export async function getAllCanvasTemplates(api: CanvasTemplateApi): Promise<readonly CanvasPageTemplate[]> {
  const user = await loadUserCanvasTemplates(api);
  return [...BUILTIN_CANVAS_TEMPLATES, ...user];
}

/**
 * Persist a user template to `<workspace>/.parallx/canvas-templates/<id>.json`.
 * Creates the directory if missing. Throws if `api.workspace.fs` is
 * unavailable so callers can surface a clear error to the user (no
 * silent drops).
 */
export async function saveUserCanvasTemplate(
  api: CanvasTemplateApi,
  input: {
    readonly id?: string;
    readonly name: string;
    readonly description?: string;
    readonly icon?: string;
    readonly defaultTitle?: string;
    readonly doc: unknown;
  },
): Promise<{ readonly id: string; readonly filePath: string }> {
  const fs = api.workspace?.fs;
  const workspaceUri = api.workspace?.workspaceFolders?.[0]?.uri;
  if (!fs || !workspaceUri) {
    throw new Error('Workspace filesystem unavailable; cannot save template.');
  }
  const id = _sanitizeTemplateId(input.id ?? input.name);
  const dirUri = _join(workspaceUri, USER_TEMPLATE_DIR);
  await fs.mkdir(dirUri);
  const fileUri = _join(dirUri, `${id}.json`);
  const payload: IUserTemplateFile = {
    id,
    name: input.name,
    description: input.description,
    icon: input.icon ?? 'file-text',
    defaultTitle: input.defaultTitle,
    doc: input.doc,
  };
  await fs.writeFile(fileUri, JSON.stringify(payload, null, 2));
  return { id, filePath: fileUri };
}

/**
 * Delete a user template by its on-disk path (the `filePath` field on
 * the loaded template object). No-op if the file doesn't exist; throws
 * on fs bridge errors.
 */
export async function deleteUserCanvasTemplate(
  api: CanvasTemplateApi,
  filePath: string,
): Promise<void> {
  const fs = api.workspace?.fs;
  if (!fs) {
    throw new Error('Workspace filesystem unavailable; cannot delete template.');
  }
  if (!(await fs.exists(filePath))) return;
  await fs.delete(filePath, { useTrash: true });
}

/**
 * Join two file URI / path fragments with a single forward slash. The
 * fs bridge accepts forward-slash paths on every platform. Trailing
 * slashes on `base` are tolerated so callers can pass workspace URIs
 * with or without one.
 */
function _join(base: string, child: string): string {
  const stripped = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${stripped}/${child}`;
}
