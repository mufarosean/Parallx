// openDocumentWriter.ts — one writer per file.
//
// When something other than the editor wants to write a file — the assistant's
// fs_write_file / fs_edit_file, an extension, a background job — it must not
// write to disk behind an open editor. Doing so creates TWO writers for the same
// bytes, and every bad outcome follows from that:
//
//   - The open model's in-memory copy is now stale.
//   - The user sees nothing change; the editor is still rendering the old text.
//   - The editor's next save silently overwrites what was written.
//
// `TextFileModel.handleExternalChange()` does detect this and set a conflicted
// flag, but nothing in the app subscribes to `onDidChangeConflicted` or reads
// `isConflicted` — so the conflict was recorded and never surfaced, and the
// clobber happened anyway with no error anywhere.
//
// The fix is not to reconcile the two writers. It is to stop making a second
// one: if the file is open, write THROUGH its document. The change then appears
// in the editor immediately, lands in its undo stack so the user can take their
// version back with Ctrl+Z, and is persisted by the same path a manual save
// uses. Canvas has always worked this way — one service that both the editor and
// the assistant go through — which is why it needed only a staleness check and
// never a refusal.

import type { URI } from '../platform/uri.js';
import type { IFileService, ITextFileModelManager } from './serviceTypes.js';

/**
 * Write `content` to `uri`, through the open document when there is one.
 *
 * @param models  the open-document registry, or undefined when unavailable
 * @param fileService  used only when the file is not open
 * @param ensureParent  called before a direct disk write, to create directories
 */
export async function writeThroughOpenDocument(
  models: ITextFileModelManager | undefined,
  fileService: IFileService,
  uri: URI,
  content: string,
  ensureParent?: () => Promise<void>,
): Promise<void> {
  const open = models?.get(uri);
  if (open && !open.isDisposed) {
    open.updateContent(content);
    await open.save();
    return;
  }

  if (ensureParent) await ensureParent();
  await fileService.writeFile(uri, content);
}

/** True when `uri` is currently held by an open editor document. */
export function isDocumentOpen(models: ITextFileModelManager | undefined, uri: URI): boolean {
  const open = models?.get(uri);
  return !!open && !open.isDisposed;
}
