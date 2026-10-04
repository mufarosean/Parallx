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

import { decodeCanvasContent, isUnreadableCanvasContent } from './contentSchema.js';
import { appDayKey } from '../../services/localTime.js';

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
  /**
   * Compact structural snapshot for AI template selection: lists the
   * headings / key sections so the AI can decide whether this template
   * fits the user's request without reading the full doc.
   * e.g. "Sections: Goal | Scope | Deliverables | Timeline"
   */
  readonly snapshot?: string;
  /** TipTap doc JSON for the page body. */
  buildDoc(): unknown;
  /** Default title applied to the new page. */
  defaultTitle: string;
}

function todayLabel(): string {
  // YYYY-MM-DD with the user's local date (not UTC) so a 10pm note
  // doesn't get tomorrow's date in time zones west of UTC. Local is the
  // app's Time Zone setting, else this computer's zone.
  return appDayKey(Date.now());
}

/**
 * Walk a TipTap doc JSON tree and collect heading texts as a compact
 * structural snapshot, e.g. "Sections: Focus today | Notes | Reflection".
 * Exported so the AI tools layer can compute snapshots for user templates
 * at list-time without re-importing the full template catalog.
 */
export function extractTemplateSnapshot(doc: unknown, maxChars = 120): string {
  const headings: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n['type'] === 'heading') {
      const texts: string[] = [];
      const collectText = (child: unknown): void => {
        if (!child || typeof child !== 'object') return;
        const c = child as Record<string, unknown>;
        if (c['type'] === 'text' && typeof c['text'] === 'string') texts.push(c['text'] as string);
        if (Array.isArray(c['content'])) (c['content'] as unknown[]).forEach(collectText);
      };
      if (Array.isArray(n['content'])) (n['content'] as unknown[]).forEach(collectText);
      const heading = texts.join('').trim();
      if (heading) headings.push(heading);
    }
    if (Array.isArray(n['content'])) (n['content'] as unknown[]).forEach(walk);
  };
  walk(doc);
  if (headings.length === 0) return '';
  const result = 'Sections: ' + headings.join(' | ');
  return result.length > maxChars ? result.slice(0, maxChars - 1) + '…' : result;
}

const BUILTIN_CANVAS_TEMPLATES: CanvasPageTemplate[] = [
  {
    id: 'daily-note',
    name: 'Daily note',
    description: 'Date-stamped journal with three quick sections.',
    snapshot: 'Sections: Focus today | Notes | Reflection',
    icon: 'calendar-days',
    source: 'builtin',
    defaultTitle: `${todayLabel()} · Daily note`,
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
    snapshot: 'Sections: Agenda | Decisions | Action items (checklist)',
    icon: 'users',
    source: 'builtin',
    defaultTitle: 'Meeting: ',
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
    // M102. The structure IS the feature: grading finds your answers by
    // position (the list under each question heading) rather than by
    // guessing at page shape, and writes its marking into a callout so the
    // three roles — asked, answered, marked — stay visually distinct on
    // re-reading. Deviating from the shape still works, it just makes the
    // AI's job of locating answers a guess again.
    id: 'quiz',
    name: 'Quiz',
    description: 'Questions with room to answer, for AI marking in place.',
    snapshot: 'Sections: Source | Question headings with answer lists',
    icon: 'graduation-cap',
    source: 'builtin',
    defaultTitle: 'Quiz: ',
    buildDoc(): unknown {
      const question = (): unknown[] => ([
        { type: 'heading', attrs: { level: 2 }, content: [] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph' }] },
        ]},
      ]);
      return {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Source: ' },
          ]},
          { type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'italic' }], text: 'Each heading is a question. Answer in the list under it, then ask the AI to mark this page.' },
          ]},
          ...question(),
          ...question(),
          ...question(),
        ],
      };
    },
  },
  {
    id: 'project-brief',
    name: 'Project brief',
    description: 'Goal, scope, deliverables, and timeline outline.',
    snapshot: 'Sections: Goal | Scope | Deliverables | Timeline',
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

/**
 * The body of a template made from a page's stored content (the
 * `{schemaVersion, doc}` envelope), or null when the page is empty or
 * cannot be read. Sub-page cards are left out (they are the source page's
 * children; a second card would point at the same page) and so are block
 * ids (each new page gets fresh ones).
 */
export function templateDocFromPage(storedContent: string | null | undefined): unknown | null {
  if (!storedContent || isUnreadableCanvasContent(storedContent)) return null;
  const { doc } = decodeCanvasContent(storedContent);
  return normalizeTemplateDoc(doc);
}

/** A template body as a doc: unwraps an envelope saved by older code. */
function normalizeTemplateDoc(raw: unknown): unknown | null {
  let doc = raw as { type?: unknown; doc?: unknown; content?: unknown } | null;
  if (doc && typeof doc === 'object' && doc.type !== 'doc' && doc.doc && typeof doc.doc === 'object') {
    doc = doc.doc as typeof doc;
  }
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc' || !Array.isArray(doc.content)) return null;
  const cleaned = _withoutCardsAndIds(doc) as { content?: unknown[] };
  if (!cleaned.content || cleaned.content.length === 0) cleaned.content = [{ type: 'paragraph' }];
  return cleaned;
}

/** Blocks that must keep at least one block inside. */
const _NEEDS_BLOCK = new Set(['column', 'callout', 'blockquote', 'detailsContent', 'tableCell', 'tableHeader', 'listItem', 'taskItem']);

function _withoutCardsAndIds(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  const out: Record<string, unknown> = { ...n };
  if (n.attrs) {
    const { id: _id, ...attrs } = n.attrs;
    if (Object.keys(attrs).length > 0) out['attrs'] = attrs;
    else delete out['attrs'];
  }
  if (Array.isArray(n.content)) {
    const kids = n.content
      .filter((c) => !(c && typeof c === 'object' && (c as { type?: string }).type === 'pageBlock'))
      .map(_withoutCardsAndIds);
    if (kids.length === 0 && n.type && _NEEDS_BLOCK.has(n.type)) kids.push({ type: 'paragraph' });
    out['content'] = kids;
  }
  return out;
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
      const doc = normalizeTemplateDoc(parsed.doc);
      if (!doc) {
        console.warn(`[CanvasTemplates] skipping template ${entry.name}: its body is not a page`);
        continue;
      }
      templates.push({
        id: parsed.id,
        name: parsed.name,
        description: parsed.description ?? '',
        icon: parsed.icon || 'file-text',
        source: 'user',
        filePath: fileUri,
        snapshot: extractTemplateSnapshot(doc) || undefined,
        defaultTitle: parsed.defaultTitle ?? parsed.name,
        // A fresh copy per page, so one page's edits never reach the next.
        buildDoc: (): unknown => structuredClone(doc),
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
