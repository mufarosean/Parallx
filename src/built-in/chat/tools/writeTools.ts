// writeTools.ts — File write/edit/delete tool registrations (M13 Phase 5)

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
  IChatToolInvocationCallContext,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolFileSystem,
  IBuiltInToolFileWriter,
} from '../chatTypes.js';
import { markResourceSeen, wasResourceSeen, fileResourceKey } from '../../../services/toolResourceRegistry.js';
import { recordCheckpoint } from '../../../services/fileCheckpointService.js';

/** HARNESS.md §2.2 — checkpoint prior state; a failure never blocks the write. */
function checkpointSafely(
  path: string,
  priorContent: string | null,
  tool: string,
  intent: unknown,
): string {
  try {
    const entry = recordCheckpoint({
      path,
      priorContent,
      tool,
      intent: typeof intent === 'string' && intent.trim() ? intent.trim() : undefined,
    });
    return ` (checkpoint #${entry.id} — /rewind restores)`;
  } catch {
    return ' (checkpoint could not be saved)';
  }
}

// ── Tool helpers ──

function requireFs(fs: IBuiltInToolFileSystem | undefined): asserts fs is IBuiltInToolFileSystem {
  if (!fs) {
    throw new Error('File system is not available; no workspace folder is open');
  }
}

function requireWriter(writer: IBuiltInToolFileWriter | undefined): asserts writer is IBuiltInToolFileWriter {
  if (!writer) {
    throw new Error('File writer is not available; no workspace folder is open');
  }
}

/**
 * Sanitize a relative path: normalize separators, reject path traversal,
 * and validate against .parallxignore.
 */
export function sanitizeRelativePath(relPath: string, writer: IBuiltInToolFileWriter): string {
  // Normalize
  let clean = relPath.replace(/\\/g, '/');
  if (clean === '.' || clean === './' || clean === '') {
    clean = '.';
  } else if (clean.startsWith('./')) {
    clean = clean.slice(2);
  } else if (clean.startsWith('/')) {
    clean = clean.slice(1);
  }

  // Reject absolute paths
  if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) {
    throw new Error(`Absolute paths are not allowed: "${relPath}"`);
  }

  // Reject path traversal
  if (clean.includes('..')) {
    throw new Error(`Path traversal ("..") is not allowed: "${relPath}"`);
  }

  // Check .parallxignore rules
  if (!writer.isPathAllowed(clean)) {
    throw new Error(`Path "${clean}" is blocked by .parallxignore rules`);
  }

  return clean;
}

// ── Tool definitions ──

export function createWriteFileTool(
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
): IChatTool {
  return {
    name: 'fs_write_file',
    displaySummary: 'Create or overwrite a workspace file on disk (approval).',
    description: 'Create or overwrite a workspace FILE on disk. Path is relative to workspace root, forward slashes, no `./` or `..`. For canvas pages (the canvas page DB) use `canvas_create_page` or `canvas_edit_page` instead.',
    parameters: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string', description: 'Relative path.' },
        content: { type: 'string', description: 'File content.' },
        description: { type: 'string', description: 'One short sentence, active voice, saying what this action does and why. Shown to the user in the approval prompt and activity journal.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'file-system',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireWriter(writer);

      const rawPath = String(args['path'] || '');
      const content = String(args['content'] ?? '');

      if (!rawPath) {
        return { content: 'path is required', isError: true };
      }

      try {
        const cleanPath = sanitizeRelativePath(rawPath, writer);

        // Check if file exists for informational message
        let existed = false;
        if (fs) {
          try { existed = await fs.exists(cleanPath); } catch { /* ignore */ }
        }

        // M85 Slice C — read-before-overwrite. Replacing an EXISTING file the
        // session has never read destroys content the agent has not seen.
        // Creating a new file is always allowed.
        if (existed && invocation?.sessionId && !wasResourceSeen(invocation.sessionId, fileResourceKey(cleanPath))) {
          return {
            content: `"${cleanPath}" already exists and you have not read it this session. `
              + `Read it first with fs_read_file — overwriting unseen content is not allowed. `
              + `(If you intend a partial change, use fs_edit_file after reading.)`,
            isError: true,
          };
        }

        // §2.2 — capture the prior state before it is gone.
        let priorContent: string | null = null;
        if (existed && fs) {
          try { priorContent = (await fs.readFileContent(cleanPath)).content; } catch { /* binary/unreadable: checkpoint absence */ }
        }
        const checkpointNote = checkpointSafely(cleanPath, existed ? priorContent : null, 'fs_write_file', args.description);

        await writer.writeFile(cleanPath, content);

        // The writer knows the file's exact content now — unlock edits on it.
        if (invocation?.sessionId) {
          markResourceSeen(invocation.sessionId, fileResourceKey(cleanPath));
        }

        const action = existed ? 'Overwrote' : 'Created';
        const lineCount = content.split('\n').length;
        return { content: `${action} "${cleanPath}" (${lineCount} lines, ${content.length} chars)${checkpointNote}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Failed to write file: ${msg}`, isError: true };
      }
    },
  };
}

export function createEditFileTool(
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
): IChatTool {
  return {
    name: 'fs_edit_file',
    displaySummary: 'Edit a workspace file on disk (approval).',
    description: 'Edit a workspace FILE on disk by exact find-and-replace. old_content must match exactly (whitespace-sensitive). For canvas pages use `canvas_edit_block` or `canvas_edit_page` instead.',
    parameters: {
      type: 'object',
      required: ['path', 'old_content', 'new_content'],
      properties: {
        path: { type: 'string', description: 'Relative path.' },
        old_content: { type: 'string', description: 'Exact text to replace.' },
        new_content: { type: 'string', description: 'Replacement text.' },
        description: { type: 'string', description: 'One short sentence, active voice, saying what this action does and why. Shown to the user in the approval prompt and activity journal.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'file-system',
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      requireFs(fs);
      requireWriter(writer);

      const rawPath = String(args['path'] || '');
      const oldContent = String(args['old_content'] ?? '');
      const newContent = String(args['new_content'] ?? '');

      if (!rawPath) {
        return { content: 'path is required', isError: true };
      }
      if (!oldContent) {
        return { content: 'old_content is required — provide the exact text to replace', isError: true };
      }

      try {
        const cleanPath = sanitizeRelativePath(rawPath, writer);

        // M85 Slice C — read-before-edit. An anchor recalled from a stale
        // context can still match text whose surroundings changed; editing a
        // file the session has never read is how those edits land wrong.
        if (invocation?.sessionId && !wasResourceSeen(invocation.sessionId, fileResourceKey(cleanPath))) {
          return {
            content: `You have not read "${cleanPath}" this session. `
              + `Read it first with fs_read_file, then retry the edit with an anchor from the CURRENT content.`,
            isError: true,
          };
        }

        const currentResult = await fs!.readFileContent(cleanPath);
        const currentContent = currentResult.content;

        // Find the old content
        const idx = currentContent.indexOf(oldContent);
        if (idx === -1) {
          return {
            content: `Could not find the specified old_content in "${cleanPath}". ` +
              `Make sure it matches exactly (including whitespace and indentation). ` +
              `Use fs_read_file to see the current content.`,
            isError: true,
          };
        }

        // Check for multiple matches (ambiguous replace)
        const secondIdx = currentContent.indexOf(oldContent, idx + 1);
        if (secondIdx !== -1) {
          return {
            content: `The old_content matches multiple locations in "${cleanPath}" (at positions ${idx} and ${secondIdx}). ` +
              `Include more surrounding context to make the match unique.`,
            isError: true,
          };
        }

        // Apply the edit — checkpointing the pre-edit state first (§2.2).
        const checkpointNote = checkpointSafely(cleanPath, currentContent, 'fs_edit_file', args.description);
        const newFile = currentContent.slice(0, idx) + newContent + currentContent.slice(idx + oldContent.length);

        await writer.writeFile(cleanPath, newFile);

        if (invocation?.sessionId) {
          markResourceSeen(invocation.sessionId, fileResourceKey(cleanPath));
        }

        // Report stats + a verification snippet: the edited region with two
        // lines of surrounding context from the NEW file, so the model can
        // confirm the edit landed where it intended without a follow-up read.
        const oldLines = oldContent.split('\n').length;
        const newLines = newContent.split('\n').length;
        const beforeLineCount = newFile.slice(0, idx).split('\n').length; // 1-indexed line of edit start
        const fileLines = newFile.split('\n');
        const snippetStart = Math.max(0, beforeLineCount - 1 - 2);
        const snippetEnd = Math.min(fileLines.length, beforeLineCount - 1 + newLines + 2);
        const snippet = fileLines.slice(snippetStart, snippetEnd)
          .map((l, i) => `${snippetStart + i + 1}| ${l}`)
          .join('\n');
        return {
          content: `Edited "${cleanPath}": replaced ${oldLines} line(s) with ${newLines} line(s)${checkpointNote}.\n\nResult (lines ${snippetStart + 1}-${snippetEnd}):\n\`\`\`\n${snippet}\n\`\`\``,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Failed to edit file: ${msg}`, isError: true };
      }
    },
  };
}

// ── Delete file tool (M11 Task 4.4) ──

export function createDeleteFileTool(
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  workspaceRoot?: string,
): IChatTool {
  return {
    name: 'fs_delete_file',
    displaySummary: 'Delete a workspace file on disk (approval).',
    description: 'Delete a workspace FILE on disk (moves to trash when possible). For canvas pages, deletion isn\'t exposed through chat tools — direct the user to delete from the canvas sidebar.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Relative path.' },
        description: { type: 'string', description: 'One short sentence, active voice, saying what this action does and why. Shown to the user in the approval prompt and activity journal.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'file-system',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      requireFs(fs);
      requireWriter(writer);

      const rawPath = String(args['path'] || '');
      if (!rawPath) {
        return { content: 'path is required', isError: true };
      }

      try {
        const cleanPath = sanitizeRelativePath(rawPath, writer);

        // Verify file exists
        const exists = await fs!.exists(cleanPath);
        if (!exists) {
          return { content: `File "${cleanPath}" does not exist.`, isError: true };
        }

        // §2.2 — checkpoint the content when readable (trash remains the
        // deeper net for deletes; the checkpoint makes /rewind symmetrical).
        let deleteCheckpointNote = '';
        try {
          const prior = (await fs!.readFileContent(cleanPath)).content;
          deleteCheckpointNote = checkpointSafely(cleanPath, prior, 'fs_delete_file', args.description);
        } catch { /* binary/unreadable — trash covers it */ }

        // Resolve to absolute path and delete via Electron IPC (to use trash)
        const electron = (globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown> | undefined;
        const fsBridge = electron?.fs as { delete?: (path: string, options?: { useTrash?: boolean }) => Promise<{ error: { code: string; message: string } | null }> } | undefined;

        if (fsBridge?.delete) {
          // Resolve absolute path: workspace root + relative path
          const absPath = workspaceRoot
            ? (workspaceRoot.replace(/[\\/]$/, '') + '/' + cleanPath.replace(/^[\\/]/, '')).replace(/\//g, (globalThis as Record<string, unknown>).process ? '\\' : '/')
            : cleanPath;
          const result = await fsBridge.delete(absPath, { useTrash: 'auto' as unknown as boolean });
          if (result.error) {
            return { content: `Failed to delete "${cleanPath}": ${result.error.message}`, isError: true };
          }
          return { content: `Deleted "${cleanPath}" (moved to trash)${deleteCheckpointNote}` };
        }

        return { content: `Cannot delete "${cleanPath}": no file system bridge available`, isError: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Failed to delete file: ${msg}`, isError: true };
      }
    },
  };
}
