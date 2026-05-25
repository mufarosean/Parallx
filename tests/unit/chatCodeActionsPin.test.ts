/** @vitest-environment jsdom */
/**
 * Pin: chatCodeActions — filepath-header detection, action button rendering,
 * and result-replacement. Pins the 5 supported comment styles, the
 * traversal-guard (no `..`), the dispatched CustomEvent shape, and the
 * post-action label classes.
 */
import { describe, it, expect, vi } from "vitest";
import {
  extractFilePath,
  renderCodeActionButtons,
  replaceCodeActionsWithResult,
} from "../../src/built-in/chat/rendering/chatCodeActions";

describe("extractFilePath — comment-style support matrix", () => {
  it("matches `// filepath: …` (C-style line comment)", () => {
    expect(extractFilePath("// filepath: src/a.ts\nconst x=1;")).toEqual({
      filePath: "src/a.ts",
      codeWithoutHeader: "const x=1;",
    });
  });

  it("matches `# filepath: …` (hash comment — python/bash)", () => {
    expect(extractFilePath("# filepath: x.py\nprint(1)")?.filePath).toBe("x.py");
  });

  it("matches `<!-- filepath: … -->` (HTML comment)", () => {
    expect(extractFilePath("<!-- filepath: page.html -->\n<p/>")?.filePath).toBe("page.html");
  });

  it("matches `-- filepath: …` (SQL comment)", () => {
    expect(extractFilePath("-- filepath: q.sql\nSELECT 1;")?.filePath).toBe("q.sql");
  });

  it("matches `/* filepath: … */` (single-line block comment)", () => {
    expect(extractFilePath("/* filepath: style.css */\n.x{}")?.filePath).toBe("style.css");
  });

  it("returns null when no header is present", () => {
    expect(extractFilePath("just code")).toBeNull();
  });

  it("returns null when filepath contains `..` (path-traversal guard)", () => {
    expect(extractFilePath("// filepath: ../escape.ts\n;")).toBeNull();
  });

  it("returns null when extracted filepath is empty", () => {
    expect(extractFilePath("// filepath:   \n;")).toBeNull();
  });

  it("strips a single leading newline after the header", () => {
    expect(extractFilePath("// filepath: a.ts\n\nbody")?.codeWithoutHeader).toBe("body");
  });

  it("only inspects the FIRST line (header on line 2 is ignored)", () => {
    expect(extractFilePath("body\n// filepath: a.ts")).toBeNull();
  });
});

describe("renderCodeActionButtons — DOM structure + event dispatch", () => {
  it("renders a path label + two buttons (Apply to File, Create File)", () => {
    const bar = renderCodeActionButtons("src/a.ts", "code", "ts");
    expect(bar.classList.contains("parallx-chat-code-actions")).toBe(true);
    const path = bar.querySelector(".parallx-chat-code-actions-path") as HTMLElement;
    expect(path.textContent).toBe("src/a.ts");
    expect(path.title).toBe("src/a.ts");
    const buttons = bar.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Apply to File");
    expect(buttons[1].textContent).toBe("Create File");
  });

  it("Apply button dispatches a bubbling 'parallx-code-action' CustomEvent with action='apply'", () => {
    const bar = renderCodeActionButtons("src/a.ts", "CODE", "ts");
    const buttons = bar.querySelectorAll("button");
    const handler = vi.fn();
    bar.addEventListener("parallx-code-action", handler);
    (buttons[0] as HTMLButtonElement).click();
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.bubbles).toBe(true);
    expect(ev.detail).toEqual({ filePath: "src/a.ts", code: "CODE", language: "ts", action: "apply" });
  });

  it("Create button dispatches with action='create'", () => {
    const bar = renderCodeActionButtons("src/a.ts", "CODE");
    const buttons = bar.querySelectorAll("button");
    const handler = vi.fn();
    bar.addEventListener("parallx-code-action", handler);
    (buttons[1] as HTMLButtonElement).click();
    expect((handler.mock.calls[0][0] as CustomEvent).detail.action).toBe("create");
  });

  it("buttons carry stable class names for selectors / styling", () => {
    const bar = renderCodeActionButtons("a.ts", "");
    expect(bar.querySelector(".parallx-chat-code-action-btn--apply")).not.toBeNull();
    expect(bar.querySelector(".parallx-chat-code-action-btn--create")).not.toBeNull();
  });
});

describe("replaceCodeActionsWithResult — post-action label swap", () => {
  it("removes buttons and appends a success result", () => {
    const bar = renderCodeActionButtons("a.ts", "");
    replaceCodeActionsWithResult(bar, "Applied.", true);
    expect(bar.querySelectorAll("button")).toHaveLength(0);
    const result = bar.querySelector(".parallx-chat-code-action-result") as HTMLElement;
    expect(result.textContent).toBe("Applied.");
    expect(result.classList.contains("parallx-chat-code-action-result--success")).toBe(true);
  });

  it("appends an error result when isSuccess=false", () => {
    const bar = renderCodeActionButtons("a.ts", "");
    replaceCodeActionsWithResult(bar, "Failed.", false);
    const result = bar.querySelector(".parallx-chat-code-action-result") as HTMLElement;
    expect(result.classList.contains("parallx-chat-code-action-result--error")).toBe(true);
  });

  it("preserves the original path label", () => {
    const bar = renderCodeActionButtons("src/keep.ts", "");
    replaceCodeActionsWithResult(bar, "Done.", true);
    const path = bar.querySelector(".parallx-chat-code-actions-path") as HTMLElement;
    expect(path.textContent).toBe("src/keep.ts");
  });
});
