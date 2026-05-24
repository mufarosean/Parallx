/**
 * Pin: matchGlob — normalises both pattern and path separators (\\→/),
 * supports `**` (any path including across slashes), `*` (any chars within
 * a single segment), `?` (single non-slash char), and treats `.` literally.
 * Invalid regex compilation returns false.
 */
import { describe, it, expect } from "vitest";
import { matchGlob } from "../../src/services/promptFileService";

describe("services/promptFileService/matchGlob", () => {
  it("exact match", () => {
    expect(matchGlob("foo/bar.md", "foo/bar.md")).toBe(true);
    expect(matchGlob("foo/bar.md", "foo/baz.md")).toBe(false);
  });

  it("normalises backslashes to forward slashes in BOTH pattern and path", () => {
    expect(matchGlob("foo\\bar.md", "foo/bar.md")).toBe(true);
    expect(matchGlob("foo/bar.md", "foo\\bar.md")).toBe(true);
  });

  it("`*` matches within a single segment but NOT across slashes", () => {
    expect(matchGlob("*.md", "rules.md")).toBe(true);
    expect(matchGlob("foo/*.md", "foo/rules.md")).toBe(true);
    expect(matchGlob("foo/*.md", "foo/sub/rules.md")).toBe(false);
  });

  it("`**/` matches zero or more path segments", () => {
    expect(matchGlob("**/rules.md", "rules.md")).toBe(true);
    expect(matchGlob("**/rules.md", "a/rules.md")).toBe(true);
    expect(matchGlob("**/rules.md", "a/b/c/rules.md")).toBe(true);
    expect(matchGlob("**/rules.md", "a/b/c/other.md")).toBe(false);
  });

  it("bare `**` without trailing `/` matches any chars including slashes", () => {
    expect(matchGlob("foo/**bar", "foo/a/b/cbar")).toBe(true);
  });

  it("`?` matches exactly one non-slash character", () => {
    expect(matchGlob("a?.md", "ab.md")).toBe(true);
    expect(matchGlob("a?.md", "abc.md")).toBe(false);
    expect(matchGlob("a?b", "a/b")).toBe(false);
  });

  it("`.` is treated literally (not regex any-char)", () => {
    expect(matchGlob("a.b", "a.b")).toBe(true);
    expect(matchGlob("a.b", "axb")).toBe(false);
  });

  it("returns false when the resulting regex would throw (defensive try/catch)", () => {
    // matchGlob never throws — confirm pure punctuation patterns still return a boolean
    expect(typeof matchGlob("[", "x")).toBe("boolean");
  });

  it("anchors to full string (no partial match)", () => {
    expect(matchGlob("foo", "foo.md")).toBe(false);
    expect(matchGlob("foo.md", "x/foo.md")).toBe(false);
  });

  it("realistic .parallx/rules/*.md and **/AGENTS.md patterns", () => {
    expect(matchGlob(".parallx/rules/*.md", ".parallx/rules/team.md")).toBe(true);
    expect(matchGlob(".parallx/rules/*.md", ".parallx/rules/sub/team.md")).toBe(false);
    expect(matchGlob("**/AGENTS.md", "AGENTS.md")).toBe(true);
    expect(matchGlob("**/AGENTS.md", "src/AGENTS.md")).toBe(true);
  });
});
