import { describe, it, expect } from "vitest";
import { URI, URIMap, uriCompare } from "../../src/platform/uri";

describe("URI", () => {
  describe("URI.file", () => {
    it("creates a file URI with leading slash", () => {
      const u = URI.file("C:/foo/bar.txt");
      expect(u.scheme).toBe("file");
      expect(u.authority).toBe("");
      expect(u.path).toBe("/C:/foo/bar.txt");
    });

    it("normalises backslashes to forward slashes", () => {
      const u = URI.file("C:\\foo\\bar.txt");
      expect(u.path).toBe("/C:/foo/bar.txt");
    });

    it("preserves existing leading slash", () => {
      const u = URI.file("/home/user/x.txt");
      expect(u.path).toBe("/home/user/x.txt");
    });

    it("handles empty path", () => {
      const u = URI.file("");
      expect(u.path).toBe("");
    });
  });

  describe("URI.from", () => {
    it("fills missing components with empty strings", () => {
      const u = URI.from({ scheme: "https" });
      expect(u.scheme).toBe("https");
      expect(u.authority).toBe("");
      expect(u.path).toBe("");
      expect(u.query).toBe("");
      expect(u.fragment).toBe("");
    });

    it("retains provided components", () => {
      const u = URI.from({ scheme: "x", authority: "a", path: "/p", query: "q=1", fragment: "f" });
      expect(u.authority).toBe("a");
      expect(u.path).toBe("/p");
      expect(u.query).toBe("q=1");
      expect(u.fragment).toBe("f");
    });
  });

  describe("URI.parse", () => {
    it("parses file:/// fast path with decoding", () => {
      const u = URI.parse("file:///C:/foo%20bar.txt");
      expect(u.scheme).toBe("file");
      expect(u.authority).toBe("");
      expect(u.path).toBe("/C:/foo bar.txt");
    });

    it("parses file://authority/path", () => {
      const u = URI.parse("file://server/share/file");
      expect(u.scheme).toBe("file");
      expect(u.authority).toBe("server");
      expect(u.path).toBe("/share/file");
    });

    it("parses file://authority with no path", () => {
      const u = URI.parse("file://server");
      expect(u.authority).toBe("server");
      expect(u.path).toBe("/");
    });

    it("parses generic scheme URIs", () => {
      const u = URI.parse("https://example.com/a/b?x=1#frag");
      expect(u.scheme).toBe("https");
      expect(u.authority).toBe("example.com");
      expect(u.path).toBe("/a/b");
      expect(u.query).toBe("x=1");
      expect(u.fragment).toBe("frag");
    });

    it("parses untitled: scheme without authority", () => {
      const u = URI.parse("untitled:Untitled-1");
      expect(u.scheme).toBe("untitled");
      expect(u.authority).toBe("");
      expect(u.path).toBe("Untitled-1");
    });

    it("falls back to 'unknown' scheme for unparseable input", () => {
      const u = URI.parse("not a uri at all !!!");
      expect(u.scheme).toBe("unknown");
      expect(u.path).toBe("not a uri at all !!!");
    });
  });

  describe("URI.revive", () => {
    it("reconstructs a URI from a JSON payload", () => {
      const u = URI.revive({ scheme: "file", path: "/a", authority: "", query: "", fragment: "" });
      expect(u).toBeInstanceOf(URI);
      expect(u.scheme).toBe("file");
      expect(u.path).toBe("/a");
    });

    it("defaults missing optional fields to empty string", () => {
      const u = URI.revive({ scheme: "x", path: "/p" });
      expect(u.authority).toBe("");
      expect(u.query).toBe("");
      expect(u.fragment).toBe("");
    });
  });

  describe("fsPath", () => {
    it("strips leading slash for Windows drive paths", () => {
      const u = URI.file("C:/foo/bar.txt");
      expect(u.fsPath).toBe("C:/foo/bar.txt");
    });

    it("keeps leading slash for posix paths", () => {
      const u = URI.file("/home/user/x.txt");
      expect(u.fsPath).toBe("/home/user/x.txt");
    });

    it("throws for non-file schemes", () => {
      const u = URI.parse("https://x.com/y");
      expect(() => u.fsPath).toThrow(/Cannot get fsPath/);
    });
  });

  describe("with()", () => {
    it("returns a new URI with replaced components", () => {
      const u = URI.parse("https://a/b?q=1#f");
      const u2 = u.with({ scheme: "http", path: "/c" });
      expect(u2.scheme).toBe("http");
      expect(u2.path).toBe("/c");
      expect(u2.authority).toBe("a");
      expect(u2.query).toBe("q=1");
      expect(u2.fragment).toBe("f");
    });

    it("retains all components when given an empty change set", () => {
      const u = URI.file("/p");
      const u2 = u.with({});
      expect(u2.equals(u)).toBe(true);
    });
  });

  describe("toString()", () => {
    it("serialises file URIs with empty authority", () => {
      const u = URI.file("C:/foo");
      expect(u.toString()).toBe("file:///C:/foo");
    });

    it("encodes special characters in path but preserves / and :", () => {
      const u = URI.file("C:/space dir/файл");
      const s = u.toString();
      expect(s.startsWith("file:///C:/space%20dir/")).toBe(true);
      expect(s).toContain("%");
    });

    it("includes query and fragment when present", () => {
      const u = URI.from({ scheme: "https", authority: "a", path: "/b", query: "x=1", fragment: "f" });
      expect(u.toString()).toBe("https://a/b?x=1#f");
    });

    it("omits query and fragment when empty", () => {
      const u = URI.from({ scheme: "x", path: "p" });
      expect(u.toString()).toBe("x:p");
    });
  });

  describe("toJSON", () => {
    it("returns a plain object with all five fields", () => {
      const u = URI.file("/p");
      const j = u.toJSON();
      expect(j).toEqual({ scheme: "file", authority: "", path: "/p", query: "", fragment: "" });
    });
  });

  describe("equals", () => {
    it("returns true for structurally equal URIs", () => {
      expect(URI.file("/p").equals(URI.file("/p"))).toBe(true);
    });

    it("returns false for any component difference", () => {
      expect(URI.file("/p").equals(URI.file("/q"))).toBe(false);
      expect(URI.parse("http://a/x").equals(URI.parse("https://a/x"))).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(URI.file("/p").equals(null)).toBe(false);
      expect(URI.file("/p").equals(undefined)).toBe(false);
    });
  });

  describe("toKey", () => {
    it("returns a lowercased string", () => {
      const u = URI.file("/Path/CASE");
      expect(u.toKey()).toBe(u.toString().toLowerCase());
    });

    it("equal URIs share a key", () => {
      expect(URI.file("/a").toKey()).toBe(URI.file("/a").toKey());
    });
  });

  describe("basename/extname/dirname", () => {
    it("basename returns last segment", () => {
      expect(URI.file("/a/b/c.txt").basename).toBe("c.txt");
    });

    it("basename returns whole path when no slash", () => {
      expect(URI.from({ scheme: "untitled", path: "Untitled-1" }).basename).toBe("Untitled-1");
    });

    it("extname returns extension with dot", () => {
      expect(URI.file("/a/b.txt").extname).toBe(".txt");
    });

    it("extname empty when no extension", () => {
      expect(URI.file("/a/b").extname).toBe("");
    });

    it("extname empty when basename starts with dot", () => {
      expect(URI.file("/a/.hidden").extname).toBe("");
    });

    it("dirname returns parent URI", () => {
      const u = URI.file("/a/b/c.txt");
      const d = u.dirname!;
      expect(d).toBeDefined();
      expect(d.path).toBe("/a/b");
      expect(d.scheme).toBe("file");
    });

    it("dirname undefined for root or empty", () => {
      expect(URI.from({ scheme: "x", path: "/" }).dirname).toBeUndefined();
      expect(URI.from({ scheme: "x", path: "" }).dirname).toBeUndefined();
    });
  });

  describe("joinPath", () => {
    it("appends a segment with separator", () => {
      const u = URI.file("/a/b");
      expect(u.joinPath("c").path).toBe("/a/b/c");
    });

    it("appends multiple segments", () => {
      const u = URI.file("/a");
      expect(u.joinPath("b", "c", "d").path).toBe("/a/b/c/d");
    });

    it("does not double slashes when base already ends with /", () => {
      const u = URI.from({ scheme: "file", path: "/a/" });
      expect(u.joinPath("b").path).toBe("/a/b");
    });

    it("normalises backslashes in segments", () => {
      const u = URI.file("/a");
      expect(u.joinPath("b\\c").path).toBe("/a/b/c");
    });
  });
});

describe("uriCompare", () => {
  it("returns negative when a < b", () => {
    expect(uriCompare(URI.file("/a"), URI.file("/b"))).toBe(-1);
  });

  it("returns positive when a > b", () => {
    expect(uriCompare(URI.file("/b"), URI.file("/a"))).toBe(1);
  });

  it("returns 0 for equal URIs", () => {
    expect(uriCompare(URI.file("/a"), URI.file("/a"))).toBe(0);
  });
});

describe("URIMap", () => {
  it("starts empty", () => {
    const m = new URIMap<number>();
    expect(m.size).toBe(0);
    expect(m.has(URI.file("/a"))).toBe(false);
    expect(m.get(URI.file("/a"))).toBeUndefined();
  });

  it("get/set/has/delete by URI", () => {
    const m = new URIMap<number>();
    m.set(URI.file("/a"), 1);
    expect(m.size).toBe(1);
    expect(m.has(URI.file("/a"))).toBe(true);
    expect(m.get(URI.file("/a"))).toBe(1);
    expect(m.delete(URI.file("/a"))).toBe(true);
    expect(m.size).toBe(0);
  });

  it("treats different-cased equivalent URIs as same key", () => {
    const m = new URIMap<string>();
    m.set(URI.from({ scheme: "file", path: "/A/B" }), "v");
    // toKey lowercases the toString output, so equivalent paths collide
    expect(m.get(URI.from({ scheme: "file", path: "/a/b" }))).toBe("v");
  });

  it("overwrites on duplicate set", () => {
    const m = new URIMap<number>();
    m.set(URI.file("/a"), 1);
    m.set(URI.file("/a"), 2);
    expect(m.size).toBe(1);
    expect(m.get(URI.file("/a"))).toBe(2);
  });

  it("delete returns false for missing key", () => {
    const m = new URIMap<number>();
    expect(m.delete(URI.file("/missing"))).toBe(false);
  });

  it("values() iterates all values", () => {
    const m = new URIMap<number>();
    m.set(URI.file("/a"), 1);
    m.set(URI.file("/b"), 2);
    expect([...m.values()].sort()).toEqual([1, 2]);
  });

  it("entries() yields [URI, value] pairs", () => {
    const m = new URIMap<number>();
    m.set(URI.file("/a"), 1);
    const entries = [...m.entries()];
    expect(entries).toHaveLength(1);
    expect(entries[0][0]).toBeInstanceOf(URI);
    expect(entries[0][1]).toBe(1);
  });

  it("forEach invokes (value, uri)", () => {
    const m = new URIMap<number>();
    m.set(URI.file("/a"), 42);
    const seen: Array<[number, string]> = [];
    m.forEach((v, u) => seen.push([v, u.path]));
    expect(seen).toEqual([[42, "/a"]]);
  });

  it("clear() empties the map", () => {
    const m = new URIMap<number>();
    m.set(URI.file("/a"), 1);
    m.set(URI.file("/b"), 2);
    m.clear();
    expect(m.size).toBe(0);
  });
});
