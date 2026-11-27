// editorInputDeserializer.ts — registry for reconstructing editor inputs from serialized state
//
// Maps typeId → factory function that creates an IEditorInput from serialized data.
// Used during workspace restore to reopen editor tabs.
//
// VS Code reference: EditorInputSerializer in src/vs/workbench/common/editor.ts

import type { IEditorInput } from './editorInput.js';
import { Emitter, type Event } from '../platform/events.js';
import { URI } from '../platform/uri.js';
import { FileEditorInput } from '../editor/panes/fileEditorInput.js';
import { PdfEditorInput } from '../editor/panes/pdf/pdfEditorInput.js';
import { EpubEditorInput } from '../editor/panes/epubEditorInput.js';
import { ImageEditorInput } from '../editor/panes/imageEditorInput.js';
import { MarkdownPreviewInput } from '../editor/panes/markdownPreviewInput.js';
import { NotebookEditorInput } from '../editor/panes/notebook/notebookEditorInput.js';
import type { ITextFileModelManager, IFileService } from '../services/serviceTypes.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Factory function that reconstructs an IEditorInput from serialized data.
 * Returns null when reconstruction fails (e.g. missing URI).
 */
export type EditorInputDeserializer = (data: Record<string, unknown> | undefined) => IEditorInput | null;

/**
 * Service context needed by built-in deserializers.
 */
export interface EditorDeserializerContext {
  readonly textFileModelManager: ITextFileModelManager;
  readonly fileService: IFileService;
}

// ─── Registry ────────────────────────────────────────────────────────────────

/** typeId → factory */
const _deserializers = new Map<string, EditorInputDeserializer>();
/** typeId → whether what makes it is running now (a tool's editor goes with the tool). */
const _live = new Map<string, () => boolean>();

/**
 * Register a deserializer for an editor input type.
 * Typically called by each editor input module at import time.
 */
export function registerEditorInputDeserializer(typeId: string, factory: EditorInputDeserializer, isLive?: () => boolean): void {
  if (_deserializers.has(typeId)) {
    console.warn(`[EditorInputDeserializer] Duplicate registration for "${typeId}" — overwriting.`);
  }
  _deserializers.set(typeId, factory);
  if (isLive) _live.set(typeId, isLive); else _live.delete(typeId);
}

const _onDidChangeLive = new Emitter<void>();
/** Fires when what makes an editor type stops or starts running (a tool turned off or on). */
export const onDidChangeEditorTypeLive: Event<void> = _onDidChangeLive.event;
/** Said by whoever runs an editor type, once it has stopped or started. */
export function notifyEditorTypeLiveChanged(): void { _onDidChangeLive.fire(); }

/** Whether an editor of this type can be opened again now: a factory, and what it needs running (Back to a closed tab). */
export function canReopenEditorType(typeId: string): boolean {
  return _deserializers.has(typeId) && (_live.get(typeId)?.() ?? true);
}

/**
 * Deserialize an editor input by type ID and data.
 * Returns null if no deserializer is registered or reconstruction fails.
 */
export function deserializeEditorInput(typeId: string, data?: Record<string, unknown>): IEditorInput | null {
  const factory = _deserializers.get(typeId);
  if (!factory) {
    console.warn(`[EditorInputDeserializer] No deserializer for "${typeId}"`);
    return null;
  }
  try {
    return factory(data);
  } catch (err) {
    console.warn(`[EditorInputDeserializer] Failed to deserialize "${typeId}":`, err);
    return null;
  }
}

/**
 * Check if a deserializer is registered for a given typeId.
 */
export function hasEditorInputDeserializer(typeId: string): boolean {
  return _deserializers.has(typeId);
}

// ─── Built-in Registrations ──────────────────────────────────────────────────

/**
 * Initialize built-in deserializers.
 * Call once during workbench startup (after services are available).
 */
export function registerBuiltinEditorDeserializers(ctx: EditorDeserializerContext): void {
  // File editor — needs URI + services
  registerEditorInputDeserializer(FileEditorInput.TYPE_ID, (data) => {
    const uri = data?.uri;
    if (typeof uri !== 'string') return null;
    return FileEditorInput.create(URI.parse(uri), ctx.textFileModelManager, ctx.fileService);
  });

  // PDF editor — needs URI, optionally restores page & scale
  registerEditorInputDeserializer(PdfEditorInput.TYPE_ID, (data) => {
    const uri = data?.uri;
    if (typeof uri !== 'string') return null;
    const page = typeof data?.page === 'number' ? (data.page as number) : 1;
    const scaleValue = typeof data?.scaleValue === 'string' ? (data.scaleValue as string) : undefined;
    return PdfEditorInput.create(URI.parse(uri), page, scaleValue);
  });

  // EPUB editor - needs URI, optionally restores scroll and text size
  registerEditorInputDeserializer(EpubEditorInput.TYPE_ID, (data) => {
    const uri = data?.uri;
    if (typeof uri !== 'string') return null;
    const scrollTop = typeof data?.scrollTop === 'number' ? (data.scrollTop as number) : 0;
    const fontScale = typeof data?.fontScale === 'number' ? (data.fontScale as number) : 1;
    return EpubEditorInput.create(URI.parse(uri), scrollTop, fontScale);
  });

  // Image editor — needs URI
  registerEditorInputDeserializer(ImageEditorInput.TYPE_ID, (data) => {
    const uri = data?.uri;
    if (typeof uri !== 'string') return null;
    return ImageEditorInput.create(URI.parse(uri));
  });

  // Markdown preview — needs URI (of the source file)
  registerEditorInputDeserializer(MarkdownPreviewInput.TYPE_ID, (data) => {
    const uri = data?.uri;
    if (typeof uri !== 'string') return null;
    const sourceInput = FileEditorInput.create(URI.parse(uri), ctx.textFileModelManager, ctx.fileService);
    return MarkdownPreviewInput.create(sourceInput);
  });

  // Notebook editor — needs URI; the document itself is re-read from disk by
  // `resolve()` on render, so nothing but the path has to survive.
  //
  // This was missing, which is why a notebook open at quit did not come back:
  // NotebookEditorInput.serialize() wrote its entry into the restored state
  // perfectly well, but with no deserializer registered for its TYPE_ID the
  // entry could not be turned back into an input and the tab was silently
  // dropped. Every other editor type is restored here; the notebook simply was
  // never added to the list.
  registerEditorInputDeserializer(NotebookEditorInput.TYPE_ID, (data) => {
    const uri = data?.uri;
    if (typeof uri !== 'string') return null;
    const relativePath = typeof data?.relativePath === 'string' ? (data.relativePath as string) : undefined;
    return NotebookEditorInput.create(URI.parse(uri), ctx.fileService, relativePath);
  });

  // The old settings-editor tab type is retired: restored 'settings'
  // editors are dropped on deserialize (no factory registered), and the
  // unified Settings hub is the one settings surface.

  // The old keybindings-editor tab type is retired the same way: the hub's
  // Keyboard Shortcuts panel (which can rebind) is the one surface.

  // The Welcome page's tab type ('parallx.welcome.editor') is retired the same
  // way: Home is the page the app opens on, and a restored Welcome tab is dropped.
}
