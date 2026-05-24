import { describe, it, expect, beforeEach } from "vitest";
import {
  parseWhenClause,
  evaluateWhenClause,
  testWhenClause,
  clearWhenClauseCache,
} from "../../src/context/whenClause";

const ctx = (m: Record<string, unknown>) => (k: string) => m[k];

beforeEach(() => clearWhenClauseCache());

describe("testWhenClause — boolean keys + negation + and/or", () => {
  it("returns true for an undefined or empty expression", () => {
    expect(testWhenClause(undefined, ctx({}))).toBe(true);
    expect(testWhenClause("", ctx({}))).toBe(true);
    expect(testWhenClause("   ", ctx({}))).toBe(true);
  });

  it("evaluates a bare context key truthily and falsily", () => {
    expect(testWhenClause("foo", ctx({ foo: true }))).toBe(true);
    expect(testWhenClause("foo", ctx({ foo: false }))).toBe(false);
    expect(testWhenClause("foo", ctx({}))).toBe(false);
  });

  it("treats '', 0, null, undefined as falsy for context keys", () => {
    expect(testWhenClause("k", ctx({ k: "" }))).toBe(false);
    expect(testWhenClause("k", ctx({ k: 0 }))).toBe(false);
    expect(testWhenClause("k", ctx({ k: null }))).toBe(false);
    expect(testWhenClause("k", ctx({ k: "x" }))).toBe(true);
    expect(testWhenClause("k", ctx({ k: 1 }))).toBe(true);
  });

  it("negates with !", () => {
    expect(testWhenClause("!foo", ctx({ foo: true }))).toBe(false);
    expect(testWhenClause("!foo", ctx({ foo: false }))).toBe(true);
  });

  it("supports && and ||", () => {
    expect(testWhenClause("a && b", ctx({ a: true, b: true }))).toBe(true);
    expect(testWhenClause("a && b", ctx({ a: true, b: false }))).toBe(false);
    expect(testWhenClause("a || b", ctx({ a: false, b: true }))).toBe(true);
    expect(testWhenClause("a || b", ctx({ a: false, b: false }))).toBe(false);
  });

  it("supports parentheses to override precedence", () => {
    expect(testWhenClause("(a || b) && c", ctx({ a: false, b: true, c: true }))).toBe(true);
    expect(testWhenClause("(a || b) && c", ctx({ a: false, b: true, c: false }))).toBe(false);
  });
});

describe("testWhenClause — equality, comparison, in", () => {
  it("== and != compare resolved values", () => {
    expect(testWhenClause("active == 'sidebar'", ctx({ active: "sidebar" }))).toBe(true);
    expect(testWhenClause("active == 'sidebar'", ctx({ active: "panel" }))).toBe(false);
    expect(testWhenClause("active != 'sidebar'", ctx({ active: "panel" }))).toBe(true);
  });

  it("supports numeric comparisons >, >=, <, <=", () => {
    expect(testWhenClause("n > 1", ctx({ n: 2 }))).toBe(true);
    expect(testWhenClause("n > 1", ctx({ n: 1 }))).toBe(false);
    expect(testWhenClause("n >= 1", ctx({ n: 1 }))).toBe(true);
    expect(testWhenClause("n < 3", ctx({ n: 2 }))).toBe(true);
    expect(testWhenClause("n <= 3", ctx({ n: 3 }))).toBe(true);
    expect(testWhenClause("n <= 3", ctx({ n: 4 }))).toBe(false);
  });

  it("coerces string numbers and booleans for comparisons", () => {
    expect(testWhenClause("n > 1", ctx({ n: "2" }))).toBe(true);
    expect(testWhenClause("n > 0", ctx({ n: true }))).toBe(true);
    expect(testWhenClause("n > 0", ctx({ n: false }))).toBe(false);
  });

  it("supports 'in' with arrays, objects, and strings", () => {
    expect(testWhenClause("x in arr", ctx({ x: "b", arr: ["a", "b"] }))).toBe(true);
    expect(testWhenClause("x in arr", ctx({ x: "c", arr: ["a", "b"] }))).toBe(false);
    expect(testWhenClause("x in obj", ctx({ x: "k", obj: { k: 1 } }))).toBe(true);
    expect(testWhenClause("x in s", ctx({ x: "ell", s: "hello" }))).toBe(true);
    expect(testWhenClause("x in nope", ctx({ x: "a", nope: 42 }))).toBe(false);
  });

  it("supports literal true/false and numeric/string literals", () => {
    expect(testWhenClause("true", ctx({}))).toBe(true);
    expect(testWhenClause("false", ctx({}))).toBe(false);
    expect(testWhenClause("k == 42", ctx({ k: 42 }))).toBe(true);
  });
});

describe("parseWhenClause + evaluateWhenClause + cache", () => {
  it("parseWhenClause caches identical expressions", () => {
    const a = parseWhenClause("foo && bar");
    const b = parseWhenClause("foo && bar");
    expect(a).toBe(b);
  });

  it("clearWhenClauseCache invalidates the cache", () => {
    const a = parseWhenClause("x == 1");
    clearWhenClauseCache();
    const b = parseWhenClause("x == 1");
    expect(a).not.toBe(b);
  });

  it("evaluateWhenClause works with a pre-parsed node", () => {
    const node = parseWhenClause("a && !b");
    expect(evaluateWhenClause(node, ctx({ a: true, b: false }))).toBe(true);
    expect(evaluateWhenClause(node, ctx({ a: true, b: true }))).toBe(false);
  });

  it("an empty expression parses to a literal-true node", () => {
    expect(evaluateWhenClause(parseWhenClause(""), ctx({}))).toBe(true);
    expect(evaluateWhenClause(parseWhenClause(undefined), ctx({}))).toBe(true);
  });

  it("throws on invalid syntax", () => {
    expect(() => parseWhenClause("a &&")).toThrow();
    expect(() => parseWhenClause("(a")).toThrow();
  });
});
