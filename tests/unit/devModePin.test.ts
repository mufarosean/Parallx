/** @vitest-environment jsdom */
/**
 * Pin tests for src/platform/devMode.ts — IIFE invariant.
 *
 * Pins:
 *   - `isDevMode` is a boolean.
 *   - In a default vitest run (no production env set), it resolves to `true`.
 *   - The module exports nothing else (single named export).
 */
import { describe, it, expect } from "vitest";
import * as devMode from "../../src/platform/devMode";

describe("platform/devMode", () => {
  it("exports a boolean `isDevMode`", () => {
    expect(typeof devMode.isDevMode).toBe("boolean");
  });

  it("defaults to true in the test environment (NODE_ENV is not 'production')", () => {
    // vitest sets NODE_ENV=test or leaves undefined — either way the IIFE
    // resolves to !== 'production' === true.
    expect(devMode.isDevMode).toBe(true);
  });

  it("exports `isDevMode` and nothing else", () => {
    const keys = Object.keys(devMode).filter((k) => k !== "default");
    expect(keys).toEqual(["isDevMode"]);
  });
});
