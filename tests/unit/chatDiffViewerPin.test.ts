/**
 * @vitest-environment jsdom
 *
 * Pin: renderDiffViewer — header (filepath + summary class + token badge),
 * isIdentical short-circuit (no body / no actions), hunk header format,
 * line gutters/indicators/content, word-level highlight pairing, Accept /
 * Reject decision flow, showActions:false suppression, truncation message.
 */
import { describe, it, expect } from "vitest";
import { renderDiffViewer } from "../../src/built-in/chat/rendering/chatDiffViewer";
import type { IDiffResult } from "../../src/services/diffService.js";

const hunk = (overrides: any = {}) => ({
  oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
  changes: [], ...overrides,
});

const diffIdentical: IDiffResult = {
  filePath: "src/a.ts", isIdentical: true, hunks: [],
  additions: 0, deletions: 0, unifiedDiff: "",
};

const diffAddOnly: IDiffResult = {
  filePath: "src/add.ts", isIdentical: false,
  hunks: [hunk({
    oldStart: 5, oldCount: 0, newStart: 5, newCount: 1,
    changes: [{ type: "add", content: "hello", newLineNumber: 5 }],
  })],
  additions: 1, deletions: 0, unifiedDiff: "x",
};

const diffRemoveOnly: IDiffResult = {
  filePath: "src/rm.ts", isIdentical: false,
  hunks: [hunk({
    oldStart: 2, oldCount: 1, newStart: 2, newCount: 0,
    changes: [{ type: "remove", content: "gone", oldLineNumber: 2 }],
  })],
  additions: 0, deletions: 1, unifiedDiff: "x",
};

const diffMixed: IDiffResult = {
  filePath: "src/mix.ts", isIdentical: false,
  hunks: [hunk({
    oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
    changes: [
      { type: "remove", content: "foo bar baz", oldLineNumber: 1 },
      { type: "add",    content: "foo qux baz", newLineNumber: 1 },
      { type: "equal",  content: "context",     oldLineNumber: 2, newLineNumber: 2 },
    ],
  })],
  additions: 1, deletions: 1, unifiedDiff: "x",
};

describe("built-in/chat/rendering/chatDiffViewer — renderDiffViewer", () => {
  it("isIdentical renders header 'No changes', NO body, NO actions", () => {
    const el = renderDiffViewer(diffIdentical);
    expect(el.classList.contains("parallx-chat-diff-viewer")).toBe(true);
    expect(el.querySelector(".parallx-chat-diff-filepath")?.textContent).toBe("src/a.ts");
    expect(el.querySelector(".parallx-chat-diff-summary")?.textContent).toBe("No changes");
    expect(el.querySelector(".parallx-chat-diff-body")).toBeNull();
    expect(el.querySelector(".parallx-chat-diff-actions")).toBeNull();
    expect(el.querySelector(".parallx-chat-diff-tokens")).toBeNull();
  });

  it("add-only diff: summary '+1' with --added class + token badge", () => {
    const el = renderDiffViewer(diffAddOnly);
    const summary = el.querySelector(".parallx-chat-diff-summary")!;
    expect(summary.textContent).toBe("+1");
    expect(summary.classList.contains("parallx-chat-diff-summary--added")).toBe(true);
    expect(el.querySelector(".parallx-chat-diff-tokens")?.textContent).toMatch(/^~\d+ tok$/);
  });

  it("remove-only diff: summary '-1' with --removed class", () => {
    const el = renderDiffViewer(diffRemoveOnly);
    const summary = el.querySelector(".parallx-chat-diff-summary")!;
    expect(summary.textContent).toBe("-1");
    expect(summary.classList.contains("parallx-chat-diff-summary--removed")).toBe(true);
  });

  it("mixed diff: summary '+1 -1' with --mixed class", () => {
    const el = renderDiffViewer(diffMixed);
    const summary = el.querySelector(".parallx-chat-diff-summary")!;
    expect(summary.textContent).toBe("+1 -1");
    expect(summary.classList.contains("parallx-chat-diff-summary--mixed")).toBe(true);
  });

  it("hunk header uses @@ -oldStart,oldCount +newStart,newCount @@ format", () => {
    const el = renderDiffViewer(diffAddOnly);
    expect(el.querySelector(".parallx-chat-diff-hunk-header")?.textContent)
      .toBe("@@ -5,0 +5,1 @@");
  });

  it("change-line gutters, indicators, content for add/remove/equal", () => {
    const el = renderDiffViewer(diffMixed, { wordLevelHighlight: false });
    const lines = [...el.querySelectorAll(".parallx-chat-diff-line")];
    expect(lines).toHaveLength(3);
    // First: remove
    expect(lines[0].classList.contains("parallx-chat-diff-line--remove")).toBe(true);
    expect(lines[0].querySelector(".parallx-chat-diff-indicator")?.textContent).toBe("-");
    expect(lines[0].querySelector(".parallx-chat-diff-gutter")?.textContent).toBe("1");
    expect(lines[0].querySelector(".parallx-chat-diff-content")?.textContent).toBe("foo bar baz");
    // Second: add
    expect(lines[1].classList.contains("parallx-chat-diff-line--add")).toBe(true);
    expect(lines[1].querySelector(".parallx-chat-diff-indicator")?.textContent).toBe("+");
    // Third: equal — indicator is space
    expect(lines[2].classList.contains("parallx-chat-diff-line--equal")).toBe(true);
    expect(lines[2].querySelector(".parallx-chat-diff-indicator")?.textContent).toBe(" ");
  });

  it("word-level highlight pairs remove+add, emits --removed/--added word spans on respective lines", () => {
    const el = renderDiffViewer(diffMixed); // wordLevelHighlight default true
    // Remove line should have at least one --removed word span; add line --added.
    const removeLine = el.querySelector(".parallx-chat-diff-line--remove")!;
    const addLine = el.querySelector(".parallx-chat-diff-line--add")!;
    expect(removeLine.querySelector(".parallx-chat-diff-word--removed")).not.toBeNull();
    expect(addLine.querySelector(".parallx-chat-diff-word--added")).not.toBeNull();
    // Cross-side word spans MUST NOT leak across lines.
    expect(removeLine.querySelector(".parallx-chat-diff-word--added")).toBeNull();
    expect(addLine.querySelector(".parallx-chat-diff-word--removed")).toBeNull();
  });

  it("Accept button: disables both, shows '✓ Applied' with --accepted class, fires onReview('accept', diff)", () => {
    const calls: Array<[string, IDiffResult]> = [];
    const el = renderDiffViewer(diffAddOnly, { onReview: (d, r) => calls.push([d, r]) });
    const accept = el.querySelector(".parallx-chat-diff-btn--accept") as HTMLButtonElement;
    expect(accept.type).toBe("button");
    accept.click();
    expect(calls).toEqual([["accept", diffAddOnly]]);
    const result = el.querySelector(".parallx-chat-diff-result")!;
    expect(result.textContent).toBe("✓ Applied");
    expect(result.classList.contains("parallx-chat-diff-result--accepted")).toBe(true);
    // Buttons replaced.
    expect(el.querySelector(".parallx-chat-diff-btn--accept")).toBeNull();
    expect(el.querySelector(".parallx-chat-diff-btn--reject")).toBeNull();
  });

  it("Reject button: shows '✗ Rejected' with --rejected class, fires onReview('reject', diff)", () => {
    const calls: Array<[string, IDiffResult]> = [];
    const el = renderDiffViewer(diffAddOnly, { onReview: (d, r) => calls.push([d, r]) });
    (el.querySelector(".parallx-chat-diff-btn--reject") as HTMLButtonElement).click();
    expect(calls).toEqual([["reject", diffAddOnly]]);
    const result = el.querySelector(".parallx-chat-diff-result")!;
    expect(result.textContent).toBe("✗ Rejected");
    expect(result.classList.contains("parallx-chat-diff-result--rejected")).toBe(true);
  });

  it("showActions:false suppresses the action bar", () => {
    const el = renderDiffViewer(diffAddOnly, { showActions: false });
    expect(el.querySelector(".parallx-chat-diff-actions")).toBeNull();
  });

  it("truncation: total changes > maxVisibleLines appends '… N more lines not shown'", () => {
    const lots: IDiffResult = {
      filePath: "x.ts", isIdentical: false,
      hunks: [hunk({
        oldStart: 1, oldCount: 0, newStart: 1, newCount: 5,
        changes: Array.from({ length: 5 }, (_, i) => ({
          type: "add" as const, content: `line ${i}`, newLineNumber: i + 1,
        })),
      })],
      additions: 5, deletions: 0, unifiedDiff: "x",
    };
    const el = renderDiffViewer(lots, { maxVisibleLines: 2 });
    const more = el.querySelector(".parallx-chat-diff-truncated");
    expect(more).not.toBeNull();
    expect(more!.textContent).toBe("… 3 more lines not shown");
  });
});
