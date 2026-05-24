import { describe, it, expect } from "vitest";
import { isCompatible } from "../../src/api/apiVersionValidation";

const SHELL = "1.5.2";

describe("apiVersionValidation.isCompatible", () => {
  it("wildcard '*' is always compatible", () => {
    expect(isCompatible("*", SHELL).compatible).toBe(true);
  });

  it("caret ^ — same major, current >= required is compatible", () => {
    expect(isCompatible("^1.0.0", SHELL).compatible).toBe(true);
    expect(isCompatible("^1.5.2", SHELL).compatible).toBe(true);
    expect(isCompatible("^1.4.9", SHELL).compatible).toBe(true);
  });

  it("caret ^ — fails on major mismatch", () => {
    const r = isCompatible("^2.0.0", SHELL);
    expect(r.compatible).toBe(false);
    expect(r.reason).toContain("major mismatch");
  });

  it("caret ^ — fails when current < required within same major", () => {
    const r = isCompatible("^1.9.0", SHELL);
    expect(r.compatible).toBe(false);
    expect(r.reason).toMatch(/Requires Parallx \^1\.9\.0/);
  });

  it("tilde ~ — same major.minor, current >= required is compatible", () => {
    expect(isCompatible("~1.5.0", SHELL).compatible).toBe(true);
    expect(isCompatible("~1.5.2", SHELL).compatible).toBe(true);
  });

  it("tilde ~ — fails on minor mismatch", () => {
    const r = isCompatible("~1.4.0", SHELL);
    expect(r.compatible).toBe(false);
    expect(r.reason).toContain("minor mismatch");
  });

  it("tilde ~ — fails when current < required within same minor", () => {
    expect(isCompatible("~1.5.9", SHELL).compatible).toBe(false);
  });

  it(">= — accepts when current >= required across majors", () => {
    expect(isCompatible(">=1.0.0", SHELL).compatible).toBe(true);
    expect(isCompatible(">=0.9.0", SHELL).compatible).toBe(true);
  });

  it(">= — rejects when current < required", () => {
    const r = isCompatible(">=2.0.0", SHELL);
    expect(r.compatible).toBe(false);
    expect(r.reason).toMatch(/Requires Parallx >=2\.0\.0/);
  });

  it("exact form (no prefix) requires current >= required", () => {
    expect(isCompatible("1.0.0", SHELL).compatible).toBe(true);
    expect(isCompatible("1.5.2", SHELL).compatible).toBe(true);
    expect(isCompatible("1.5.3", SHELL).compatible).toBe(false);
    expect(isCompatible("2.0.0", SHELL).compatible).toBe(false);
  });

  it("returns a structured failure when the shell version is unparseable", () => {
    const r = isCompatible("^1.0.0", "not-a-version");
    expect(r.compatible).toBe(false);
    expect(r.reason).toContain("Cannot parse shell version");
  });

  it("returns a structured failure when the requirement is unparseable", () => {
    const r = isCompatible("^bogus", SHELL);
    expect(r.compatible).toBe(false);
    expect(r.reason).toContain("Cannot parse required version");
  });
});
