/**
 * Pin: openclawToolDescriptionSummary — strips structured docs and produces
 * a short prompt-friendly tool catalog summary.
 */
import { describe, it, expect } from "vitest";
import {
  summarizeToolDescriptionText,
  truncateSummary,
} from "../../src/openclaw/openclawToolDescriptionSummary";

describe("truncateSummary", () => {
  it("returns input unchanged when within budget", () => {
    expect(truncateSummary("hello world", 120)).toBe("hello world");
  });

  it("trims whitespace on short input", () => {
    expect(truncateSummary("  hi  ", 120)).toBe("hi");
  });

  it("uses sentence boundary when it occupies >=40% of the budget", () => {
    const text = "First sentence. Second one continues with more details.";
    // maxChars 30, "First sentence." length 15, 15 >= 30*0.4 → use it
    expect(truncateSummary(text, 30)).toBe("First sentence.");
  });

  it("falls back to last space + ellipsis when sentence is too short", () => {
    const text = "Hi. then much longer continuation that overflows";
    // sentence "Hi." len=3, 3 < 40*0.4=16 → fall back
    expect(truncateSummary(text, 40)).toBe("Hi. then much longer continuation that…");
  });

  it("falls back to raw slice + ellipsis when no whitespace inside budget", () => {
    const text = "abcdefghijklmnopqrstuvwxyz1234567890";
    expect(truncateSummary(text, 10)).toBe("abcdefghij…");
  });

  it("default maxChars is 120", () => {
    const s = "a".repeat(200);
    expect(truncateSummary(s).length).toBeLessThanOrEqual(121); // 120 + ellipsis
    expect(truncateSummary(s).endsWith("…")).toBe(true);
  });

  it("recognises ?/! as sentence boundaries", () => {
    // Within budget=200 the period after "so" is the last sentence-ender.
    expect(truncateSummary("Why? Because it is so. More text continues here", 200)).toBe(
      "Why? Because it is so. More text continues here",
    );
    // At budget=22 the sentence "Why?" is only 4 chars (< 22*0.4=8.8) →
    // fall back to last-space slice with ellipsis.
    expect(truncateSummary("Why? Because it is the way. More text", 22)).toBe(
      "Why? Because it is…",
    );
    expect(truncateSummary("Run it! Then look at the output", 20)).toBe(
      "Run it! Then look…",
    );
  });
});

describe("summarizeToolDescriptionText", () => {
  it("returns empty string for empty input", () => {
    expect(summarizeToolDescriptionText("")).toBe("");
  });

  it("strips structured blocks marked by JSON, list, or label prefixes", () => {
    expect(summarizeToolDescriptionText("Search the workspace.\n{ \"q\": \"...\" }")).toBe("Search the workspace.");
    expect(summarizeToolDescriptionText("List files.\n- one\n- two")).toBe("List files.");
    expect(summarizeToolDescriptionText("Run a task.\n* alpha\n* beta")).toBe("Run a task.");
    expect(summarizeToolDescriptionText("Foo.\nACTIONS: do things")).toBe("Foo.");
    expect(summarizeToolDescriptionText("Bar.\nPARAMETERS: x")).toBe("Bar.");
    expect(summarizeToolDescriptionText("Baz.\nJOB SCHEMA: ...")).toBe("Baz.");
    expect(summarizeToolDescriptionText("Q.\nEXAMPLES: ...")).toBe("Q.");
    expect(summarizeToolDescriptionText("R.\nNOTES: ...")).toBe("R.");
    expect(summarizeToolDescriptionText("S.\nIMPORTANT: do not...")).toBe("S.");
    expect(summarizeToolDescriptionText("T.\n[ array start ]")).toBe("T.");
  });

  it("collapses multi-line preamble to a single paragraph", () => {
    expect(summarizeToolDescriptionText("Line one\nstill one paragraph")).toBe("Line one still one paragraph");
  });

  it("takes only the first paragraph (split on blank line)", () => {
    expect(
      summarizeToolDescriptionText("First paragraph.\n\nSecond paragraph that is dropped."),
    ).toBe("First paragraph.");
  });

  it("returns '' when the entire description is structured (no prose preamble)", () => {
    expect(summarizeToolDescriptionText("{ \"action\": \"x\" }")).toBe("");
    expect(summarizeToolDescriptionText("ACTIONS: do thing")).toBe("");
  });

  it("respects maxChars and truncates with ellipsis", () => {
    const long =
      "This is a fairly long preamble that exceeds twenty chars no doubt";
    expect(summarizeToolDescriptionText(long, 20)).toMatch(/^This is a fairly( ?…)?$/);
  });

  it("default maxChars is 120", () => {
    const s = "a".repeat(200);
    const out = summarizeToolDescriptionText(s);
    expect(out.length).toBeLessThanOrEqual(121);
  });
});
