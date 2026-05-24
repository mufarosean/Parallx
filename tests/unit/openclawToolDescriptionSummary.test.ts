import { describe, it, expect } from "vitest";
import {
  summarizeToolDescriptionText,
  truncateSummary,
} from "../../src/openclaw/openclawToolDescriptionSummary";

describe("truncateSummary", () => {
  it("returns the trimmed input unchanged when it fits in the budget", () => {
    expect(truncateSummary("short.", 120)).toBe("short.");
    expect(truncateSummary("   padded  ", 20)).toBe("padded");
  });

  it("prefers a sentence boundary inside the budget", () => {
    const text = "First sentence here. Second sentence is longer and continues.";
    const out = truncateSummary(text, 25);
    expect(out).toBe("First sentence here.");
  });

  it("uses a word boundary when sentence cut would be too short (< 40% of maxChars)", () => {
    // The first sentence is only 3 chars; below the 40% threshold, so falls
    // back to word-boundary slicing with an ellipsis.
    const text = "Hi. Then a longer trailing clause that exceeds the budget.";
    const out = truncateSummary(text, 30);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(30);
  });

  it("falls back to slice+ellipsis when no whitespace fits in the slice", () => {
    const text = "Supercalifragilisticexpialidocious";
    const out = truncateSummary(text, 10);
    expect(out).toBe("Supercalif…");
  });

  it("treats ! and ? as sentence terminators", () => {
    expect(truncateSummary("Stop! Then more words follow here.", 12)).toBe("Stop!");
    expect(truncateSummary("Really? Then more text continues here.", 12)).toBe("Really?");
  });

  it("uses the default 120-char limit when maxChars omitted", () => {
    const text = "x".repeat(200);
    const out = truncateSummary(text);
    expect(out.length).toBeLessThanOrEqual(121); // 120 chars + the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("summarizeToolDescriptionText", () => {
  it("returns empty for empty/blank input", () => {
    expect(summarizeToolDescriptionText("")).toBe("");
    expect(summarizeToolDescriptionText("   ")).toBe("");
  });

  it("strips structured blocks that start with {", () => {
    const desc = "Reads a file from disk.\n{\n  \"path\": \"...\"\n}";
    expect(summarizeToolDescriptionText(desc)).toBe("Reads a file from disk.");
  });

  it("strips ACTIONS:/PARAMETERS:/EXAMPLES:/NOTES:/IMPORTANT: blocks", () => {
    for (const marker of ["ACTIONS:", "PARAMETERS:", "EXAMPLES:", "NOTES:", "IMPORTANT:"]) {
      const desc = `Does the thing.\n${marker}\n  - one\n  - two`;
      expect(summarizeToolDescriptionText(desc)).toBe("Does the thing.");
    }
  });

  it("strips bullet/dash lists starting with '- ' or '* '", () => {
    const desc = "Lists files.\n- foo\n- bar";
    expect(summarizeToolDescriptionText(desc)).toBe("Lists files.");
    const desc2 = "Lists files.\n* foo";
    expect(summarizeToolDescriptionText(desc2)).toBe("Lists files.");
  });

  it("takes only the first paragraph (split on blank line)", () => {
    const desc = "Opens a panel.\n\nMore detail in the next paragraph.";
    expect(summarizeToolDescriptionText(desc)).toBe("Opens a panel.");
  });

  it("collapses internal whitespace within the headline paragraph", () => {
    const desc = "Multi\n  line\n  preamble all   in   one paragraph.";
    expect(summarizeToolDescriptionText(desc)).toBe(
      "Multi line preamble all in one paragraph.",
    );
  });

  it("truncates the headline paragraph to maxChars", () => {
    const long = "abcdefghij ".repeat(40); // ~440 chars
    const out = summarizeToolDescriptionText(long, 30);
    expect(out.length).toBeLessThanOrEqual(31);
  });

  it("returns empty when the description is entirely a structured block", () => {
    const desc = "{ \"foo\": 1 }";
    expect(summarizeToolDescriptionText(desc)).toBe("");
  });

  it("trims surrounding whitespace before checking emptiness", () => {
    const desc = "\n\n  \n";
    expect(summarizeToolDescriptionText(desc)).toBe("");
  });
});
