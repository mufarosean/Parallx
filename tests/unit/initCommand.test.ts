/**
 * Pin-the-invariant: built-in/chat/commands/initCommand.executeInitCommand
 * top-level guards: no-workspace, abort, empty output.
 */
import { describe, it, expect, vi } from "vitest";
import { executeInitCommand } from "../../src/built-in/chat/commands/initCommand";

function makeResponse() {
  const warnings: string[] = [];
  const progresses: string[] = [];
  const markdowns: string[] = [];
  return {
    response: {
      warning: (s: string) => warnings.push(s),
      progress: (s: string) => progresses.push(s),
      markdown: (s: string) => markdowns.push(s),
    } as any,
    warnings,
    progresses,
    markdowns,
  };
}

describe("executeInitCommand — guards", () => {
  it("warns when listFiles is missing", async () => {
    const { response, warnings } = makeResponse();
    await executeInitCommand({} as any, response);
    expect(warnings[0]).toContain("/init requires a workspace");
  });

  it("warns when readFile is missing even if listFiles exists", async () => {
    const { response, warnings } = makeResponse();
    await executeInitCommand({ listFiles: vi.fn() } as any, response);
    expect(warnings[0]).toContain("/init requires a workspace");
  });

  it("aborts cleanly when sendChatRequest throws AbortError", async () => {
    const { response, warnings } = makeResponse();
    async function* abortingStream() {
      throw new DOMException("aborted", "AbortError");
    }
    const services = {
      listFiles: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(""),
      exists: vi.fn().mockResolvedValue(false),
      getWorkspaceName: () => "ws",
      sendChatRequest: () => abortingStream(),
    };
    await executeInitCommand(services as any, response);
    expect(warnings.some((w) => w.includes("cancelled"))).toBe(true);
  });

  it("warns when model returns empty content", async () => {
    const { response, warnings } = makeResponse();
    async function* emptyStream() {
      yield { content: "   " };
    }
    const services = {
      listFiles: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(""),
      exists: vi.fn().mockResolvedValue(false),
      getWorkspaceName: () => "ws",
      sendChatRequest: () => emptyStream(),
    };
    await executeInitCommand(services as any, response);
    expect(warnings.some((w) => w.includes("empty content"))).toBe(true);
  });

  it("writes AGENTS.md when content is non-empty", async () => {
    const { response } = makeResponse();
    const writeFile = vi.fn().mockResolvedValue(undefined);
    async function* okStream() {
      yield { content: "# AGENTS\nbody" };
    }
    const services = {
      listFiles: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(""),
      exists: vi.fn().mockResolvedValue(false),
      getWorkspaceName: () => "ws",
      sendChatRequest: () => okStream(),
      writeFile,
    };
    await executeInitCommand(services as any, response);
    const agentsCall = writeFile.mock.calls.find((c) => c[0] === ".parallx/AGENTS.md");
    expect(agentsCall).toBeTruthy();
    expect(agentsCall![1]).toContain("# AGENTS");
  });
});
