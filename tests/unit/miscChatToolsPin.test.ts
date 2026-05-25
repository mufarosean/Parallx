/**
 * Pin: misc small built-in chat tools — autonomy_log, parallx_link,
 * transcript_get, transcript_search. Pins wire-protocol names, descriptions,
 * display summaries, permission posture, and parameter contracts. All four
 * are READ-ONLY tools (always-allowed, requiresConfirmation=false).
 */
import { describe, it, expect } from "vitest";
import { createAutonomyLogTool } from "../../src/built-in/chat/tools/autonomyLogTool";
import { createParallxLinkTool } from "../../src/built-in/chat/tools/parallxLinkTool";
import {
  createTranscriptGetTool,
  createTranscriptSearchTool,
} from "../../src/built-in/chat/tools/transcriptTools";

const autonomyLog = createAutonomyLogTool(undefined);
const parallxLink = createParallxLinkTool(() => []);
const transcriptGet = createTranscriptGetTool(undefined);
const transcriptSearch = createTranscriptSearchTool(undefined);

const ALL = [autonomyLog, parallxLink, transcriptGet, transcriptSearch];

describe("misc tools — wire-protocol names + read-only posture", () => {
  it("pins names: autonomy_log, parallx_link, transcript_get, transcript_search", () => {
    expect(ALL.map((t) => t.name)).toEqual([
      "autonomy_log",
      "parallx_link",
      "transcript_get",
      "transcript_search",
    ]);
  });

  it("ALL are always-allowed + no confirmation (read-only tools)", () => {
    for (const t of ALL) {
      expect(t.requiresConfirmation, t.name).toBe(false);
      expect(t.permissionLevel, t.name).toBe("always-allowed");
    }
  });
});

describe("misc tools — descriptions + display summaries", () => {
  it("autonomy_log", () => {
    expect(autonomyLog.displaySummary).toBe("Read background autonomy events.");
    expect(autonomyLog.description).toBe(
      "Read background autonomy events from heartbeat, cron, and subagent runs.",
    );
  });

  it("parallx_link", () => {
    expect(parallxLink.displaySummary).toBe(
      "Mint a validated parallx:// citation URI.",
    );
    expect(parallxLink.description).toBe(
      "Validate and mint a parallx:// citation URI. target must follow a template from the ## Linking section. Use anchor for deep-linking.",
    );
  });

  it("transcript_get", () => {
    expect(transcriptGet.description).toBe(
      "Read a session transcript from `.parallx/sessions/`.",
    );
  });

  it("transcript_search", () => {
    expect(transcriptSearch.description).toBe(
      "Semantic search over session transcripts. Disabled unless transcript indexing is on.",
    );
  });
});

describe("misc tools — parameter contracts", () => {
  it("autonomy_log: no required fields; properties = [origin, limit, onlyUnread, markRead]", () => {
    const p = autonomyLog.parameters as any;
    expect(p.required).toBeUndefined();
    expect(Object.keys(p.properties).sort()).toEqual(
      ["limit", "markRead", "onlyUnread", "origin"],
    );
  });

  it("parallx_link: requires [target]; optional [anchor, note]", () => {
    const p = parallxLink.parameters as any;
    expect(p.required).toEqual(["target"]);
    expect(Object.keys(p.properties).sort()).toEqual(["anchor", "note", "target"]);
  });

  it("transcript_search exposes [query, sessionId]", () => {
    const p = transcriptSearch.parameters as any;
    expect(Object.keys(p.properties).sort()).toEqual(["query", "sessionId"]);
  });

  it("transcript_get exposes [sessionId]", () => {
    const p = transcriptGet.parameters as any;
    expect(Object.keys(p.properties)).toEqual(["sessionId"]);
  });
});

describe("misc tools — async handlers wired", () => {
  it("every tool exposes a handler function", () => {
    for (const t of ALL) expect(typeof t.handler, t.name).toBe("function");
  });
});
