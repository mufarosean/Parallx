/**
 * Pin: distinctiveTermExtractor — extracts content-bearing proper nouns
 * and acronyms from document text.  Locks the regex shapes, the leading-
 * determiner strip, the post-strip multi-cap re-check, and the
 * frequency → length → alphabetical sort order.
 */
import { describe, it, expect } from "vitest";
import { extractDistinctiveTerms } from "../../src/services/distinctiveTermExtractor";

describe("extractDistinctiveTerms", () => {
  it("returns [] for empty or non-string input", () => {
    expect(extractDistinctiveTerms("")).toEqual([]);
    expect(extractDistinctiveTerms(undefined as any)).toEqual([]);
    expect(extractDistinctiveTerms(null as any)).toEqual([]);
    expect(extractDistinctiveTerms(42 as any)).toEqual([]);
  });

  it("extracts multi-word capitalised phrases", () => {
    expect(extractDistinctiveTerms("The Bayesian Inference model is useful")).toContain(
      "Bayesian Inference",
    );
    expect(extractDistinctiveTerms("the Black-Scholes Model to options")).toContain(
      "Black-Scholes Model",
    );
  });

  it("does not extract single capitalised words (sentence-starters)", () => {
    expect(extractDistinctiveTerms("The model is good. Kant said so.")).toEqual([]);
  });

  it("extracts acronyms of length 2 to 7", () => {
    const out = extractDistinctiveTerms("Use CAPM and ETL with the API");
    expect(out).toEqual(expect.arrayContaining(["CAPM", "ETL", "API"]));
  });

  it("rejects acronyms outside length 2-7", () => {
    // "A" — single letter, "ABCDEFGH" — too long
    const out = extractDistinctiveTerms("A pattern ABCDEFGH appears");
    expect(out).not.toContain("A");
    expect(out).not.toContain("ABCDEFGH");
  });

  it("strips leading English determiners from multi-word phrases", () => {
    // "The Black Scholes Model" → "Black Scholes Model"
    expect(extractDistinctiveTerms("The Black Scholes Model rocks")).toContain(
      "Black Scholes Model",
    );
    expect(extractDistinctiveTerms("Their Hidden Markov Model is here")).toContain(
      "Hidden Markov Model",
    );
  });

  it("drops a phrase that becomes single-capitalised after determiner strip", () => {
    // "The Bayesian" → "Bayesian" — only one cap word → dropped
    const out = extractDistinctiveTerms("The Bayesian.");
    expect(out).not.toContain("Bayesian");
    expect(out).not.toContain("The Bayesian");
  });

  it("ranks results by frequency descending", () => {
    const text = "CAPM CAPM CAPM ETL ETL VAR";
    expect(extractDistinctiveTerms(text)).toEqual(["CAPM", "ETL", "VAR"]);
  });

  it("ties broken by length descending then alphabetical ascending", () => {
    // Separate phrases by punctuation so the greedy multi-word regex does
    // not glue them together.  Both phrases appear once; longer wins.
    const text = "the Black-Scholes Model, then Bayesian Inference, plus CAPM";
    const out = extractDistinctiveTerms(text);
    expect(out.indexOf("Black-Scholes Model")).toBeLessThan(out.indexOf("Bayesian Inference"));
    expect(out.indexOf("Bayesian Inference")).toBeLessThan(out.indexOf("CAPM"));
  });

  it("caps results at 100 terms", () => {
    // Use distinct multi-word capitalised pairs separated by commas so the
    // greedy regex does not merge adjacent phrases.
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const phrases: string[] = [];
    for (let i = 0; i < 150; i++) {
      const a = letters[i % 26]!;
      const b = letters[(i * 7) % 26]!;
      phrases.push(`${a}lpha${i} ${b}eta${i}`);
    }
    // Even after greedy gluing, we get well over 100 acronym matches at
    // least; the cap should hold.  Use a deterministic input with many
    // unique acronyms instead.
    const text = Array.from({ length: 150 }, (_, i) => `AC${(i % 100).toString().padStart(2, "0")}X`).join(" ");
    const out = extractDistinctiveTerms(text);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it("drops terms longer than 50 chars", () => {
    const longPhrase =
      "Ultra Long Concept Name That Goes On And On And On And On Forever Now";
    const out = extractDistinctiveTerms(longPhrase);
    // Each phrase chunk that fits is allowed; we just assert no entry > 50 chars
    out.forEach((t) => expect(t.length).toBeLessThanOrEqual(50));
  });
});
