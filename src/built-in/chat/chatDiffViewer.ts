// chatDiffViewer.ts — Inline diff review component (M11 Task 2.5)
//
// Renders a unified diff with red/green highlighted lines inside the
// chat response. Includes "Accept" and "Reject" buttons plus file
// path header and line/token count summary.
//
// VS Code reference:
//   src/vs/editor/browser/widget/diffEditor/
//   Parallx uses a lightweight HTML-based renderer instead of the
//   full Monaco diff editor, since diffs are displayed inline in chat.

import { $ } from '../../ui/dom.js';
import type { IDiffResult, IDiffHunk, ILineDiffChange, IWordChange } from '../../services/diffService.js';
import { computeWordDiff, estimateDiffTokens } from '../../services/diffService.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Decision the user makes on a diff. */
export type DiffReviewDecision = 'accept' | 'reject';

/** Callback for when the user accepts or rejects a diff. */
export type DiffReviewCallback = (decision: DiffReviewDecision, diff: IDiffResult) => void;

/** Options for the diff viewer. */
export interface IDiffViewerOptions {
  /** Show word-level inline highlights within changed lines. */
  wordLevelHighlight?: boolean;
  /** Maximum number of lines to show before collapsing. */
  maxVisibleLines?: number;
  /** Show the Accept/Reject action bar. */
  showActions?: boolean;
  /** Callback when user accepts or rejects. */
  onReview?: DiffReviewCallback;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Render a diff result as an inline review card.
 *
 * @param diff The computed diff result.
 * @param options Display and interaction options.
 * @returns The root HTMLElement of the diff viewer.
 */
export function renderDiffViewer(diff: IDiffResult, options: IDiffViewerOptions = {}): HTMLElement {
  const root = $('div.parallx-chat-diff-viewer');

  // ── Header: file path + summary ──
  const header = $('div.parallx-chat-diff-header');

  const filePath = $('span.parallx-chat-diff-filepath');
  filePath.textContent = diff.filePath;
  header.appendChild(filePath);

  const summary = $('span.parallx-chat-diff-summary');
  if (diff.isIdentical) {
    summary.textContent = 'No changes';
  } else {
    const parts: string[] = [];
    if (diff.additions > 0) { parts.push(`+${diff.additions}`); }
    if (diff.deletions > 0) { parts.push(`-${diff.deletions}`); }
    summary.textContent = parts.join(' ');

    // Color the summary
    if (diff.additions > 0 && diff.deletions === 0) {
      summary.classList.add('parallx-chat-diff-summary--added');
    } else if (diff.deletions > 0 && diff.additions === 0) {
      summary.classList.add('parallx-chat-diff-summary--removed');
    } else {
      summary.classList.add('parallx-chat-diff-summary--mixed');
    }
  }
  header.appendChild(summary);

  // Token estimate
  const tokens = estimateDiffTokens(diff);
  if (tokens > 0) {
    const tokenBadge = $('span.parallx-chat-diff-tokens');
    tokenBadge.textContent = `~${tokens} tok`;
    header.appendChild(tokenBadge);
  }

  root.appendChild(header);

  // ── Diff body ──
  if (!diff.isIdentical && diff.hunks.length > 0) {
    const body = $('div.parallx-chat-diff-body');
    const maxLines = options.maxVisibleLines ?? 200;
    let totalLines = 0;
    let truncated = false;

    for (const hunk of diff.hunks) {
      const hunkEl = _renderHunk(hunk, options.wordLevelHighlight ?? true);
      body.appendChild(hunkEl);
      totalLines += hunk.changes.length;

      if (totalLines > maxLines) {
        truncated = true;
        break;
      }
    }

    if (truncated) {
      const more = $('div.parallx-chat-diff-truncated');
      more.textContent = `… ${diff.hunks.reduce((n, h) => n + h.changes.length, 0) - maxLines} more lines not shown`;
      body.appendChild(more);
    }

    root.appendChild(body);
  }

  // ── Action bar: Accept / Reject ──
  if (options.showActions !== false && !diff.isIdentical) {
    const actionBar = $('div.parallx-chat-diff-actions');

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'parallx-chat-diff-btn parallx-chat-diff-btn--accept';
    acceptBtn.textContent = 'Accept';
    acceptBtn.type = 'button';

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'parallx-chat-diff-btn parallx-chat-diff-btn--reject';
    rejectBtn.textContent = 'Reject';
    rejectBtn.type = 'button';

    const handleDecision = (decision: DiffReviewDecision): void => {
      // Disable buttons
      acceptBtn.disabled = true;
      rejectBtn.disabled = true;

      // Show result
      const result = $('span.parallx-chat-diff-result');
      result.textContent = decision === 'accept' ? '✓ Applied' : '✗ Rejected';
      result.classList.add(
        decision === 'accept'
          ? 'parallx-chat-diff-result--accepted'
          : 'parallx-chat-diff-result--rejected',
      );

      // Replace buttons with result
      actionBar.innerHTML = '';
      actionBar.appendChild(result);

      options.onReview?.(decision, diff);
    };

    acceptBtn.addEventListener('click', () => handleDecision('accept'));
    rejectBtn.addEventListener('click', () => handleDecision('reject'));

    actionBar.appendChild(acceptBtn);
    actionBar.appendChild(rejectBtn);
    root.appendChild(actionBar);
  }

  return root;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hunk rendering
// ═══════════════════════════════════════════════════════════════════════════════

/** Render a single diff hunk. */
function _renderHunk(hunk: IDiffHunk, wordHighlight: boolean): HTMLElement {
  const el = $('div.parallx-chat-diff-hunk');

  // Hunk header
  const header = $('div.parallx-chat-diff-hunk-header');
  header.textContent = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
  el.appendChild(header);

  // Build line elements
  // For word-level highlighting, pair up adjacent remove+add lines
  const changes = [...hunk.changes];
  let i = 0;

  while (i < changes.length) {
    const change = changes[i];

    if (wordHighlight && change.type === 'remove') {
      // Look ahead for a paired 'add' line (word-level diff)
      const addLines: ILineDiffChange[] = [];
      const removeLines: ILineDiffChange[] = [change];
      let j = i + 1;

      while (j < changes.length && changes[j].type === 'remove') {
        removeLines.push(changes[j]);
        j++;
      }
      while (j < changes.length && changes[j].type === 'add') {
        addLines.push(changes[j]);
        j++;
      }

      // If we have paired remove/add lines, render with word-level highlighting
      if (addLines.length > 0) {
        const pairCount = Math.min(removeLines.length, addLines.length);
        for (let p = 0; p < pairCount; p++) {
          const wordDiff = computeWordDiff(removeLines[p].content, addLines[p].content);
          el.appendChild(_renderWordDiffLine(removeLines[p], wordDiff, 'remove'));
          el.appendChild(_renderWordDiffLine(addLines[p], wordDiff, 'add'));
        }
        // Remaining unpaired lines
        for (let p = pairCount; p < removeLines.length; p++) {
          el.appendChild(_renderChangeLine(removeLines[p]));
        }
        for (let p = pairCount; p < addLines.length; p++) {
          el.appendChild(_renderChangeLine(addLines[p]));
        }
        i = j;
        continue;
      }

      // No paired add — render remove lines normally
      for (const rl of removeLines) {
        el.appendChild(_renderChangeLine(rl));
      }
      i = j;
      continue;
    }

    el.appendChild(_renderChangeLine(change));
    i++;
  }

  return el;
}

/** Render a single change line (without word-level highlighting). */
function _renderChangeLine(change: ILineDiffChange): HTMLElement {
  const line = $('div.parallx-chat-diff-line');
  line.classList.add(`parallx-chat-diff-line--${change.type}`);

  // Line number gutter
  const gutter = $('span.parallx-chat-diff-gutter');
  if (change.type === 'remove') {
    gutter.textContent = String(change.oldLineNumber ?? '');
  } else if (change.type === 'add') {
    gutter.textContent = String(change.newLineNumber ?? '');
  } else {
    gutter.textContent = String(change.oldLineNumber ?? '');
  }
  line.appendChild(gutter);

  // Change indicator
  const indicator = $('span.parallx-chat-diff-indicator');
  indicator.textContent = change.type === 'add' ? '+' : change.type === 'remove' ? '-' : ' ';
  line.appendChild(indicator);

  // Content
  const content = $('span.parallx-chat-diff-content');
  content.textContent = change.content;
  line.appendChild(content);

  return line;
}

/** Render a line with word-level diff highlighting. */
function _renderWordDiffLine(change: ILineDiffChange, wordDiff: IWordChange[], lineType: 'remove' | 'add'): HTMLElement {
  const line = $('div.parallx-chat-diff-line');
  line.classList.add(`parallx-chat-diff-line--${change.type}`);

  // Line number gutter
  const gutter = $('span.parallx-chat-diff-gutter');
  gutter.textContent = String(
    lineType === 'remove' ? (change.oldLineNumber ?? '') : (change.newLineNumber ?? ''),
  );
  line.appendChild(gutter);

  // Change indicator
  const indicator = $('span.parallx-chat-diff-indicator');
  indicator.textContent = lineType === 'add' ? '+' : '-';
  line.appendChild(indicator);

  // Content with word-level spans
  const content = $('span.parallx-chat-diff-content');

  for (const word of wordDiff) {
    if (word.type === 'equal') {
      content.appendChild(document.createTextNode(word.value));
    } else if (
      (lineType === 'remove' && word.type === 'remove') ||
      (lineType === 'add' && word.type === 'add')
    ) {
      const highlight = document.createElement('span');
      highlight.className = lineType === 'remove'
        ? 'parallx-chat-diff-word--removed'
        : 'parallx-chat-diff-word--added';
      highlight.textContent = word.value;
      content.appendChild(highlight);
    }
    // Skip words that belong to the other side (remove words on add line, etc.)
  }

  line.appendChild(content);
  return line;
}
