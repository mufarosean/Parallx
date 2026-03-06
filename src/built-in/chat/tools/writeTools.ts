// writeTools.ts — File write/edit/delete tool registrations (M13 Phase 5)

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolFileSystem,
  IBuiltInToolFileWriter,
} from '../chatTypes.js';

// ── Tool helpers ──

function requireFs(fs: IBuiltInToolFileSystem | undefined): asserts fs is IBuiltInToolFileSystem {
  if (!fs) {
    throw new Error('File system is not available — no workspace folder is open');
  }
}

function requireWriter(writer: IBuiltInToolFileWriter | undefined): asserts writer is IBuiltInToolFileWriter {
  if (!writer) {
    throw new Error('File writer is not available — no workspace folder is open');
  }
}

/**
 * Sanitize a relative path: normalize separators, reject path traversal,
 * and validate against .parallxignore.
 */
function sanitizeRelativePath(relPath: string, writer: IBuiltInToolFileWriter): string {
  // Normalize
  let clean = relPath.replace(/\\/g, '/').replace(/^\.?\/?/, '');

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
    name: 'write_file',
    description:
      'Write (create or overwrite) a file in the workspace. Path is relative to the workspace root. ' +
      'Validates path against .parallxignore sandbox rules. Requires user approval.',
    parameters: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string', description: 'Relative file path from workspace root' },
        content: { type: 'string', description: 'The full file content to write' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
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

        await writer.writeFile(cleanPath, content);

        const action = existed ? 'Overwrote' : 'Created';
        const lineCount = content.split('\n').length;
        return { content: `${action} "${cleanPath}" (${lineCount} lines, ${content.length} chars)` };
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
    name: 'edit_file',
    description:
      'Edit an existing file by replacing a specific substring. ' +
      'Provide the exact old content to replace and the new content. ' +
      'The old content must match exactly (whitespace-sensitive). ' +
      'Use read_file first to get the current content. Requires user approval.',
    parameters: {
      type: 'object',
      required: ['path', 'old_content', 'new_content'],
      properties: {
        path: { type: 'string', description: 'Relative file path from workspace root' },
        old_content: { type: 'string', description: 'The exact existing content to find and replace (must match exactly)' },
        new_content: { type: 'string', description: 'The new content to replace it with' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
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

        // Read current file content
        const currentContent = await fs!.readFile(cleanPath);

        // Find the old content
        const idx = currentContent.indexOf(oldContent);
        if (idx === -1) {
          return {
            content: `Could not find the specified old_content in "${cleanPath}". ` +
              `Make sure it matches exactly (including whitespace and indentation). ` +
              `Use read_file to see the current content.`,
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

        // Apply the edit
        const newFile = currentContent.slice(0, idx) + newContent + currentContent.slice(idx + oldContent.length);

        await writer.writeFile(cleanPath, newFile);

        // Report simple stats
        const oldLines = oldContent.split('\n').length;
        const newLines = newContent.split('\n').length;
        return {
          content: `Edited "${cleanPath}": replaced ${oldLines} line(s) with ${newLines} line(s)`,
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
    name: 'delete_file',
    description:
      'Delete a file from the workspace. Path is relative to the workspace root. ' +
      'The file is moved to the OS trash/recycle bin when possible. Requires user approval.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Relative file path from workspace root to delete' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
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

        // Resolve to absolute path and delete via Electron IPC (to use trash)
        const electron = (globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown> | undefined;
        const fsBridge = electron?.fs as { delete?: (path: string, options?: { useTrash?: boolean }) => Promise<{ error: { code: string; message: string } | null }> } | undefined;

        if (fsBridge?.delete) {
          // Resolve absolute path: workspace root + relative path
          const absPath = workspaceRoot
            ? (workspaceRoot.replace(/[\\/]$/, '') + '/' + cleanPath.replace(/^[\\/]/, '')).replace(/\//g, (globalThis as Record<string, unknown>).process ? '\\' : '/')
            : cleanPath;
          const result = await fsBridge.delete(absPath, { useTrash: true });
          if (result.error) {
            return { content: `Failed to delete "${cleanPath}": ${result.error.message}`, isError: true };
          }
          return { content: `Deleted "${cleanPath}" (moved to trash)` };
        }

        return { content: `Cannot delete "${cleanPath}": no file system bridge available`, isError: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Failed to delete file: ${msg}`, isError: true };
      }
    },
  };
}
