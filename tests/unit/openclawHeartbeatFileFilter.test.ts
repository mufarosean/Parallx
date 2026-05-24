import { describe, it, expect } from "vitest";
import {
  globToRegex,
  shouldHeartbeatAcceptPath,
} from "../../src/openclaw/openclawHeartbeatFileFilter";

describe("globToRegex", () => {
  it("'**' matches any path segments including empty", () => {
    const re = globToRegex("**/node_modules/**");
    expect(re.test("node_modules/foo")).toBe(true);
    expect(re.test("a/b/node_modules/c/d")).toBe(true);
    expect(re.test("src/a.ts")).toBe(false);
  });

  it("'*' matches any chars except slash", () => {
    const re = globToRegex("src/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/nested/a.ts")).toBe(false);
  });

  it("'?' matches exactly one char (not slash)", () => {
    const re = globToRegex("a?.ts");
    expect(re.test("ab.ts")).toBe(true);
    expect(re.test("abb.ts")).toBe(false);
    expect(re.test("a/.ts")).toBe(false);
  });

  it("is case-insensitive", () => {
    const re = globToRegex("**/Node_Modules/**");
    expect(re.test("a/node_modules/b")).toBe(true);
    expect(re.test("a/NODE_MODULES/b")).toBe(true);
  });

  it("escapes regex metacharacters in literal segments", () => {
    const re = globToRegex("a.b+c(d)");
    expect(re.test("a.b+c(d)")).toBe(true);
    expect(re.test("axbxcxd")).toBe(false);
  });

  it("anchors at start and end", () => {
    const re = globToRegex("foo.ts");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("xfoo.ts")).toBe(false);
    expect(re.test("foo.tsx")).toBe(false);
  });
});

describe("shouldHeartbeatAcceptPath — exclude wins", () => {
  it("excludes always trump includes", () => {
    expect(
      shouldHeartbeatAcceptPath(
        "C:/repo/node_modules/foo.ts",
        [".ts"],
        ["**/node_modules/**"],
      ),
    ).toBe(false);
  });

  it("excludes are evaluated against normalized paths", () => {
    expect(
      shouldHeartbeatAcceptPath(
        "C:\\repo\\dist\\bundle.js",
        [".js"],
        ["**/dist/**"],
      ),
    ).toBe(false);
  });
});

describe("shouldHeartbeatAcceptPath — include allowlist", () => {
  it("empty include list accepts all (minus excludes)", () => {
    expect(shouldHeartbeatAcceptPath("/a/b.xyz", [], [])).toBe(true);
  });

  it("rejects extensionless files when include list is non-empty", () => {
    expect(shouldHeartbeatAcceptPath("/a/README", [".md"], [])).toBe(false);
  });

  it("matches the extension case-insensitively", () => {
    expect(shouldHeartbeatAcceptPath("/a/F.TS", [".ts"], [])).toBe(true);
    expect(shouldHeartbeatAcceptPath("/a/F.ts", [".TS"], [])).toBe(true);
  });

  it("normalizes include entries lacking a leading dot", () => {
    expect(shouldHeartbeatAcceptPath("/a/file.md", ["md"], [])).toBe(true);
  });

  it("rejects files whose extension isn't in the list", () => {
    expect(shouldHeartbeatAcceptPath("/a/file.py", [".ts", ".md"], [])).toBe(false);
  });

  it("'.' inside a directory segment does not count as the file extension", () => {
    // Last '.' comes before the last '/', so getExtension returns ''.
    expect(shouldHeartbeatAcceptPath("/a.b/c", [".ts"], [])).toBe(false);
  });
});

describe("shouldHeartbeatAcceptPath — path normalization", () => {
  it("strips file:// scheme and decodes URI components", () => {
    expect(
      shouldHeartbeatAcceptPath(
        "file:///C:/repo/path%20with%20spaces/x.ts",
        [".ts"],
        [],
      ),
    ).toBe(true);
  });

  it("strips leading slash before Windows drive letter", () => {
    // After normalization, "C:/repo/node_modules/foo.ts" should still hit the
    // exclude glob "**/node_modules/**".
    expect(
      shouldHeartbeatAcceptPath(
        "file:///C:/repo/node_modules/foo.ts",
        [".ts"],
        ["**/node_modules/**"],
      ),
    ).toBe(false);
  });

  it("converts backslashes to forward slashes for glob matching", () => {
    expect(
      shouldHeartbeatAcceptPath(
        "C:\\repo\\node_modules\\x.ts",
        [".ts"],
        ["**/node_modules/**"],
      ),
    ).toBe(false);
  });

  it("tolerates malformed file:// URIs via fallback regex strip", () => {
    // URL parser may throw on file:/foo (single slash). Fallback path:
    // replace /^file:\/+/ with '/'. The path then becomes "/foo/x.ts".
    expect(
      shouldHeartbeatAcceptPath("file:/foo/x.ts", [".ts"], []),
    ).toBe(true);
  });
});
