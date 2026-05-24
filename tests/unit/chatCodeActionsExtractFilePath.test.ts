/**
 * Pin-the-invariant: rendering/chatCodeActions.extractFilePath — header detection.
 */
import { describe, it, expect } from "vitest";
import { extractFilePath } from "../../src/built-in/chat/rendering/chatCodeActions";

describe("extractFilePath", () => {
  it("returns null on empty input", () => {
    expect(extractFilePath("")).toBeNull();
  });

  it("detects // filepath: header (C-style)", () => {
    const r = extractFilePath("// filepath: src/a.ts\nconsole.log(1)");
    expect(r).toEqual({ filePath: "src/a.ts", codeWithoutHeader: "console.log(1)" });
  });

  it("detects # filepath: (Python/bash)", () => {
    const r = extractFilePath("# filepath: scripts/run.py\nprint('x')");
    expect(r?.filePath).toBe("scripts/run.py");
  });

  it("detects <!-- filepath: --> (HTML)", () => {
    const r = extractFilePath("<!-- filepath: index.html -->\n<html>");
    expect(r?.filePath).toBe("index.html");
  });

  it("detects -- filepath: (SQL)", () => {
    const r = extractFilePath("-- filepath: q.sql\nSELECT 1;");
    expect(r?.filePath).toBe("q.sql");
  });

  it("detects /* filepath: */ (block comment)", () => {
    const r = extractFilePath("/* filepath: app.css */\nbody{}");
    expect(r?.filePath).toBe("app.css");
  });

  it("rejects paths containing '..'", () => {
    const r = extractFilePath("// filepath: ../escape.ts\nx");
    expect(r).toBeNull();
  });

  it("returns null when first line is not a header", () => {
    const r = extractFilePath("function x(){}\n");
    expect(r).toBeNull();
  });

  it("trims surrounding whitespace from filePath", () => {
    const r = extractFilePath("// filepath:   spaced/path.ts   \nx");
    expect(r?.filePath).toBe("spaced/path.ts");
  });
});
