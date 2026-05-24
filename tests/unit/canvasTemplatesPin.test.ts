/**
 * Pin-the-invariant: canvasTemplates loader/saver/deleter for user templates.
 */
import { describe, it, expect, vi } from "vitest";
import {
  getBuiltinCanvasTemplates,
  loadUserCanvasTemplates,
  getAllCanvasTemplates,
  saveUserCanvasTemplate,
  deleteUserCanvasTemplate,
} from "../../src/built-in/canvas/canvasTemplates";

function makeApi(fsImpl: any) {
  return {
    workspace: {
      fs: fsImpl,
      workspaceFolders: [{ uri: "file:///ws" }],
    },
  } as any;
}

describe("getBuiltinCanvasTemplates", () => {
  it("returns non-empty list of builtin source templates", () => {
    const list = getBuiltinCanvasTemplates();
    expect(list.length).toBeGreaterThan(0);
    for (const t of list) {
      expect(t.source).toBe("builtin");
      expect(typeof t.id).toBe("string");
      expect(typeof t.buildDoc).toBe("function");
    }
  });
});

describe("loadUserCanvasTemplates", () => {
  it("returns [] when fs bridge is unavailable", async () => {
    const list = await loadUserCanvasTemplates({ workspace: {} } as any);
    expect(list).toEqual([]);
  });

  it("returns [] when workspace folder is missing", async () => {
    const list = await loadUserCanvasTemplates({ workspace: { fs: {} } } as any);
    expect(list).toEqual([]);
  });

  it("returns [] when directory does not exist", async () => {
    const fs = { exists: vi.fn().mockResolvedValue(false), readdir: vi.fn() };
    const list = await loadUserCanvasTemplates(makeApi(fs));
    expect(list).toEqual([]);
    expect(fs.readdir).not.toHaveBeenCalled();
  });

  it("returns [] and swallows readdir errors", async () => {
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readdir: vi.fn().mockRejectedValue(new Error("io")),
    };
    expect(await loadUserCanvasTemplates(makeApi(fs))).toEqual([]);
  });

  it("skips non-json entries and malformed JSON; loads valid ones; sorts by name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readdir: vi.fn().mockResolvedValue([
        { name: "z.json", type: 1 },
        { name: "a.json", type: 1 },
        { name: "skip.txt", type: 1 },
        { name: "bad.json", type: 1 },
      ]),
      readFile: vi.fn(async (uri: string) => {
        if (uri.endsWith("z.json")) {
          return { content: JSON.stringify({ id: "z", name: "Zebra", doc: { type: "doc" } }) };
        }
        if (uri.endsWith("a.json")) {
          return { content: JSON.stringify({ id: "a", name: "Alpha", doc: { type: "doc" } }) };
        }
        if (uri.endsWith("bad.json")) {
          return { content: "not-json{" };
        }
        return undefined;
      }),
    };
    const list = await loadUserCanvasTemplates(makeApi(fs));
    expect(list.map((t) => t.name)).toEqual(["Alpha", "Zebra"]);
    expect(list.every((t) => t.source === "user")).toBe(true);
    warn.mockRestore();
  });

  it("skips templates missing required fields", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readdir: vi.fn().mockResolvedValue([{ name: "broken.json", type: 1 }]),
      readFile: vi.fn().mockResolvedValue({ content: JSON.stringify({ id: "x" }) }),
    };
    expect(await loadUserCanvasTemplates(makeApi(fs))).toEqual([]);
    warn.mockRestore();
  });
});

describe("getAllCanvasTemplates", () => {
  it("returns builtins first then user (alphabetical) when both present", async () => {
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readdir: vi.fn().mockResolvedValue([{ name: "u.json", type: 1 }]),
      readFile: vi.fn().mockResolvedValue({
        content: JSON.stringify({ id: "u", name: "User One", doc: { type: "doc" } }),
      }),
    };
    const list = await getAllCanvasTemplates(makeApi(fs));
    const builtins = getBuiltinCanvasTemplates();
    expect(list.slice(0, builtins.length).map((t) => t.id)).toEqual(builtins.map((t) => t.id));
    expect(list[list.length - 1].id).toBe("u");
  });
});

describe("saveUserCanvasTemplate", () => {
  it("throws if fs bridge or workspace missing", async () => {
    await expect(
      saveUserCanvasTemplate({ workspace: {} } as any, { name: "x", doc: {} }),
    ).rejects.toThrow(/Workspace filesystem unavailable/);
  });

  it("creates directory and writes <id>.json with sanitized id", async () => {
    const fs = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };
    const out = await saveUserCanvasTemplate(makeApi(fs), {
      name: "My Cool!! Template",
      doc: { foo: 1 },
    });
    expect(fs.mkdir).toHaveBeenCalledWith("file:///ws/.parallx/canvas-templates");
    expect(out.id).toBe("my-cool-template");
    expect(out.filePath).toBe("file:///ws/.parallx/canvas-templates/my-cool-template.json");
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(payload.name).toBe("My Cool!! Template");
    expect(payload.icon).toBe("file-text");
    expect(payload.doc).toEqual({ foo: 1 });
  });

  it("respects provided id over name when sanitizing", async () => {
    const fs = { mkdir: vi.fn(), writeFile: vi.fn() };
    const out = await saveUserCanvasTemplate(makeApi(fs), { id: "custom_id", name: "Whatever", doc: {} });
    expect(out.id).toBe("custom_id");
  });

  it("falls back to 'template' if sanitization yields empty", async () => {
    const fs = { mkdir: vi.fn(), writeFile: vi.fn() };
    const out = await saveUserCanvasTemplate(makeApi(fs), { id: "!!!", name: "n", doc: {} });
    expect(out.id).toBe("template");
  });
});

describe("deleteUserCanvasTemplate", () => {
  it("throws when fs unavailable", async () => {
    await expect(deleteUserCanvasTemplate({ workspace: {} } as any, "/x.json")).rejects.toThrow(
      /Workspace filesystem unavailable/,
    );
  });

  it("no-ops when file absent", async () => {
    const fs = { exists: vi.fn().mockResolvedValue(false), delete: vi.fn() };
    await deleteUserCanvasTemplate(makeApi(fs), "/x.json");
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it("deletes with useTrash:true when present", async () => {
    const fs = { exists: vi.fn().mockResolvedValue(true), delete: vi.fn().mockResolvedValue(undefined) };
    await deleteUserCanvasTemplate(makeApi(fs), "/x.json");
    expect(fs.delete).toHaveBeenCalledWith("/x.json", { useTrash: true });
  });
});
