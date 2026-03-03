// chatCodeActions.ts — Code action buttons for code blocks (M11 Task 2.6)
//
// Detects `// filepath: <path>` (or `# filepath:`, `<!-- filepath: -->`)
// comment headers at the top of code blocks. When detected, adds
// "Apply to File" and "Create File" action buttons.
//
// "Apply to File" triggers a diff flow: reads the existing file,
// computes a diff, and shows the diff viewer for review.
// "Create File" writes the file directly (with permission check).

import { $ } from '../../../ui/dom.js';
import type { ICodeActionRequest } from '../chatTypes.js';

// Code action types — now defined in chatTypes.ts (M13 Phase 1)
export type { CodeActionKind, ICodeActionRequest, CodeActionHandler } from '../chatTypes.js';

// ═══════════════════════════════════════════════════════════════════════════════
// filepath header detection
// ═══════════════════════════════════════════════════════════════════════════════

/** Regex patterns for filepath headers at the top of code blocks. */
const FILEPATH_PATTERNS: RegExp[] = [
  // `// filepath: path/to/file.ts` (C-style line comment)
  /^\/\/\s*filepath:\s*(.+)$/,
  // `# filepath: path/to/file.py` (Hash comment — Python, bash, etc.)
  /^#\s*filepath:\s*(.+)$/,
  // `<!-- filepath: path/to/file.html -->` (HTML comment)
  /^<!--\s*filepath:\s*(.+?)\s*-->$/,
  // `-- filepath: path/to/file.sql` (SQL comment)
  /^--\s*filepath:\s*(.+)$/,
  // `/* filepath: path/to/file.css */` (Block comment — single line)
  /^\/\*\s*filepath:\s*(.+?)\s*\*\/$/,
];

/**
 * Try to extract a filepath from the first line of a code block.
 * Returns `{ filePath, codeWithoutHeader }` if found, `null` otherwise.
 */
export function extractFilePath(code: string): { filePath: string; codeWithoutHeader: string } | null {
  const lines = code.split('\n');
  if (lines.length === 0) { return null; }

  const firstLine = lines[0].trim();
  for (const pattern of FILEPATH_PATTERNS) {
    const match = firstLine.match(pattern);
    if (match) {
      const filePath = match[1].trim();
      if (filePath.length > 0 && !filePath.includes('..')) {
        const codeWithoutHeader = lines.slice(1).join('\n').replace(/^\n/, '');
        return { filePath, codeWithoutHeader };
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Button rendering
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create code action buttons for a code block that has a filepath header.
 *
 * @param filePath The extracted file path.
 * @param code The code content (without the filepath header).
 * @param language Optional language hint.
 * @returns A `<div>` containing the action buttons, or `null` if no actions available.
 */
export function renderCodeActionButtons(
  filePath: string,
  code: string,
  language?: string,
): HTMLElement {
  const bar = $('div.parallx-chat-code-actions');

  // File path label
  const pathLabel = $('span.parallx-chat-code-actions-path');
  pathLabel.textContent = filePath;
  pathLabel.title = filePath;
  bar.appendChild(pathLabel);

  // "Apply to File" button — triggers diff flow
  const applyBtn = document.createElement('button');
  applyBtn.className = 'parallx-chat-code-action-btn parallx-chat-code-action-btn--apply';
  applyBtn.textContent = 'Apply to File';
  applyBtn.type = 'button';
  applyBtn.title = `Compare and apply changes to ${filePath}`;
  applyBtn.addEventListener('click', () => {
    bar.dispatchEvent(new CustomEvent<ICodeActionRequest>('parallx-code-action', {
      bubbles: true,
      detail: { filePath, code, language, action: 'apply' },
    }));
  });

  // "Create File" button — writes directly
  const createBtn = document.createElement('button');
  createBtn.className = 'parallx-chat-code-action-btn parallx-chat-code-action-btn--create';
  createBtn.textContent = 'Create File';
  createBtn.type = 'button';
  createBtn.title = `Create or overwrite ${filePath}`;
  createBtn.addEventListener('click', () => {
    bar.dispatchEvent(new CustomEvent<ICodeActionRequest>('parallx-code-action', {
      bubbles: true,
      detail: { filePath, code, language, action: 'create' },
    }));
  });

  bar.appendChild(applyBtn);
  bar.appendChild(createBtn);

  return bar;
}

/**
 * Replace the action buttons with a result label (after user action
 * completes outside this module).
 */
export function replaceCodeActionsWithResult(bar: HTMLElement, message: string, isSuccess: boolean): void {
  // Keep the path label, remove buttons, add result
  const buttons = bar.querySelectorAll('.parallx-chat-code-action-btn');
  buttons.forEach((btn) => btn.remove());

  const result = $('span.parallx-chat-code-action-result');
  result.textContent = message;
  result.classList.add(
    isSuccess ? 'parallx-chat-code-action-result--success' : 'parallx-chat-code-action-result--error',
  );
  bar.appendChild(result);
}
