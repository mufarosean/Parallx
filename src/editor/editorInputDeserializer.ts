// editorInputDeserializer.ts — registry for reconstructing editor inputs from serialized state
//
// Maps typeId → factory function that creates an IEditorInput from serialized data.
// Used during workspace restore to reopen editor tabs.
//
// VS Code reference: EditorInputSerializer in src/vs/workbench/common/editor.ts

import type { IEditorInput } from './editorInput.js';
import { URI } from '../platform/uri.js';
import { FileEditorInput } from '../built-in/editor/fileEditorInput.js';
import { PdfEditorInput } from '../built-in/editor/pdfEditorInput.js';
import { ImageEditorInput } from '../built-in/editor/imageEditorInput.js';
import { MarkdownPreviewInput } from '../built-in/editor/markdownPreviewInput.js';
import { SettingsEditorInput } from '../built-in/editor/settingsEditorInput.js';
import { KeybindingsEditorInput } from '../built-in/editor/keybindingsEditorInput.js';
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

/**
 * Register a deserializer for an editor input type.
 * Typically called by each editor input module at import time.
 */
export function registerEditorInputDeserializer(typeId: string, factory: EditorInputDeserializer): void {
  if (_deserializers.has(typeId)) {
    console.warn(`[EditorInputDeserializer] Duplicate registration for "${typeId}" — overwriting.`);
  }
  _deserializers.set(typeId, factory);
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

  // PDF editor — needs URI
  registerEditorInputDeserializer(PdfEditorInput.TYPE_ID, (data) => {
    const uri = data?.uri;
    if (typeof uri !== 'string') return null;
    return PdfEditorInput.create(URI.parse(uri));
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

  // Settings editor — singleton, no data needed
  registerEditorInputDeserializer(SettingsEditorInput.TYPE_ID, () => {
    return SettingsEditorInput.getInstance();
  });

  // Keybindings editor — singleton, no data needed
  registerEditorInputDeserializer(KeybindingsEditorInput.TYPE_ID, () => {
    return KeybindingsEditorInput.getInstance();
  });

  // Note: 'parallx.welcome.editor' is a ToolEditorInput created by the Welcome tool.
  // It re-registers its provider during tool activation. We skip it here because
  // the Welcome page opens itself on first launch via the tool activation lifecycle.
}
