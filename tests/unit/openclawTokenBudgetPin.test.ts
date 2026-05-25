/**
 * Pin: openclawTokenBudget + openclawToolDescriptionSummary — two small pure
 * helpers that drive prompt construction. computeTokenBudget enforces the
 * M11 10/30/30/30 split; computeElasticBudget redistributes lane surplus
 * to RAG; summarizeToolDescriptionText derives the short catalog blurb
 * from a verbose tool description.
 */
import { describe, it, expect } from "vitest";
import {
  computeTokenBudget,
  computeElasticBudget,
  estimateMessagesTokens,
  trimTextToBudget,
  VISION_TOKENS_PER_IMAGE,
} from "../../src/openclaw/openclawTokenBudget";
import {
  truncateSummary,
  summarizeToolDescriptionText,
} from "../../src/openclaw/openclawToolDescriptionSummary";

describe("computeTokenBudget — M11 10/30/30/30 split", () => {
  it("splits 10000 ctx as system=1000 / rag=3000 / history=3000 / user=3000", () => {
    const b = computeTokenBudget(10000);
    expect(b.total).toBe(10000);
    expect(b.system).toBe(1000);
    expect(b.rag).toBe(3000);
    expect(b.history).toBe(3000);
    expect(b.user).toBe(3000);
  });

  it("floors to nearest integer (1234 → 123/370/370/370)", () => {
    const b = computeTokenBudget(1234);
    expect(b.system).toBe(123);
    expect(b.rag).toBe(370);
    expect(b.history).toBe(370);
    expect(b.user).toBe(370);
  });

  it("clamps negatives + non-integers to floor(max(0,x))", () => {
    expect(computeTokenBudget(-100).total).toBe(0);
    expect(computeTokenBudget(99.9).total).toBe(99);
  });
});

describe("computeElasticBudget — surplus flows to RAG", () => {
  it("zero context → all lanes zero", () => {
    expect(computeElasticBudget({ contextWindow: 0 })).toEqual({
      total: 0, system: 0, rag: 0, history: 0, user: 0,
    });
  });

  it("no actuals supplied → fills ceilings (matches static split)", () => {
    const b = computeElasticBudget({ contextWindow: 10000 });
    expect(b.system).toBe(1000);
    expect(b.rag).toBe(3000);
    expect(b.history).toBe(3000);
    expect(b.user).toBe(3000);
  });

  it("under-used lanes flow their surplus into RAG", () => {
    // total=10000; ceilings sys=1000 rag=3000 hist=3000 user=3000
    // Actuals: system=100, history=500, user=200 → surplus=900+2500+2800=6200
    const b = computeElasticBudget({
      contextWindow: 10000,
      systemActual: 100,
      historyActual: 500,
      userActual: 200,
    });
    expect(b.total).toBe(10000);
    expect(b.system).toBe(100);
    expect(b.history).toBe(500);
    expect(b.user).toBe(200);
    expect(b.rag).toBe(3000 + 6200); // 9200
  });

  it("over-ceiling actuals are clamped to the ceiling (no negative surplus)", () => {
    const b = computeElasticBudget({
      contextWindow: 10000,
      systemActual: 99999,
      historyActual: 99999,
      userActual: 99999,
    });
    expect(b.system).toBe(1000);
    expect(b.history).toBe(3000);
    expect(b.user).toBe(3000);
    expect(b.rag).toBe(3000); // ceil + 0 surplus
  });
});

describe("VISION_TOKENS_PER_IMAGE / estimateMessagesTokens", () => {
  it("VISION_TOKENS_PER_IMAGE = 768 (D5 fixed cost)", () => {
    expect(VISION_TOKENS_PER_IMAGE).toBe(768);
  });

  it("each message adds 4 role-overhead tokens + content tokens", () => {
    // estimateTokens = chars/4. Two messages with 8 chars each → 2 each.
    const n = estimateMessagesTokens([
      { role: "user", content: "12345678" } as any,
      { role: "assistant", content: "abcdefgh" } as any,
    ]);
    expect(n).toBe((4 + 2) + (4 + 2));
  });

  it("images add VISION_TOKENS_PER_IMAGE per image per message", () => {
    const n = estimateMessagesTokens([
      { role: "user", content: "", images: ["a", "b"] } as any,
    ]);
    expect(n).toBe(4 + 0 + 2 * 768);
  });
});

describe("trimTextToBudget", () => {
  it("returns unchanged when text fits", () => {
    const r = trimTextToBudget("hello", 100);
    expect(r).toEqual({ text: "hello", trimmed: false });
  });

  it("returns empty string when budgetTokens=0 and text non-empty", () => {
    const r = trimTextToBudget("abc", 0);
    expect(r).toEqual({ text: "", trimmed: true });
  });

  it("keeps the END of the string (recency preservation): 4 tokens = 16 chars", () => {
    const text = "0123456789abcdefghij"; // 20 chars
    const r = trimTextToBudget(text, 4);
    expect(r.trimmed).toBe(true);
    // 4 tokens × 4 chars/token = 16 chars; keep tail.
    expect(r.text).toBe(text.slice(-16));
  });
});

describe("truncateSummary — sentence-boundary cut", () => {
  it("returns trimmed text unchanged when within budget", () => {
    expect(truncateSummary("Short text.", 120)).toBe("Short text.");
  });

  it("default maxChars = 120", () => {
    const long = "x".repeat(150);
    const out = truncateSummary(long);
    expect(out.length).toBeLessThanOrEqual(121); // 120 + trailing …
  });

  it("prefers sentence-boundary cut when it covers >=40% of maxChars", () => {
    const text = "First sentence. Second sentence that runs on and on and on past the limit.";
    const out = truncateSummary(text, 30);
    // 'First sentence.' is 15 chars >= 12 (40% of 30) → returned as-is.
    expect(out).toBe("First sentence.");
  });

  it("falls back to last-space cut with trailing … when no sentence boundary", () => {
    const text = "one two three four five six seven eight nine ten";
    const out = truncateSummary(text, 15);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(15);
  });

  it("falls back to hard cut + … when no whitespace at all", () => {
    const out = truncateSummary("abcdefghij", 5);
    expect(out).toBe("abcde…");
  });
});

describe("summarizeToolDescriptionText", () => {
  it("returns '' for empty input", () => {
    expect(summarizeToolDescriptionText("")).toBe("");
  });

  it("strips a structured ACTIONS: block (everything after the marker)", () => {
    const text = "Manages cron jobs.\n\nACTIONS:\n- add\n- remove";
    expect(summarizeToolDescriptionText(text)).toBe("Manages cron jobs.");
  });

  it("strips JSON/list-marker structured blocks", () => {
    const text = "Reads a file.\n\n{ \"path\": \"...\" }";
    expect(summarizeToolDescriptionText(text)).toBe("Reads a file.");
  });

  it("collapses multi-line prose into a single paragraph", () => {
    const text = "Line one\nline two\nline three.";
    expect(summarizeToolDescriptionText(text)).toBe("Line one line two line three.");
  });

  it("truncates to maxChars override (default 120)", () => {
    const text = "x".repeat(200);
    expect(summarizeToolDescriptionText(text, 50).length).toBeLessThanOrEqual(51);
  });

  it("returns '' when stripping removes everything", () => {
    expect(summarizeToolDescriptionText("{ \"x\": 1 }")).toBe("");
  });
});
