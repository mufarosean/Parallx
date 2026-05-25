/**
 * Pin: openclawErrorClassification — error classifiers driving the
 * OpenClaw retry loop (context overflow → compact, timeout → force
 * compact, transient → 2500ms delay).  These messages are hard-coded
 * pattern matches against Ollama error strings.
 */
import { describe, it, expect } from "vitest";
import {
  isContextOverflow,
  isTransientError,
  isTimeoutError,
  isModelError,
} from "../../src/openclaw/openclawErrorClassification";

describe("isContextOverflow", () => {
  it.each([
    "context length exceeded",
    "the input has too many tokens",
    "model context window is full",
    "Maximum context reached for llama3:8b",
    "CONTEXT LENGTH",
  ])("matches: %s", (msg) => {
    expect(isContextOverflow(new Error(msg))).toBe(true);
  });

  it.each([
    "ECONNREFUSED",
    "model failed",
    "out of memory",
    "",
  ])("rejects: %s", (msg) => {
    expect(isContextOverflow(new Error(msg))).toBe(false);
  });

  it("extracts from string, plain object, and unknown", () => {
    expect(isContextOverflow("context window full")).toBe(true);
    expect(isContextOverflow({ message: "context length" })).toBe(true);
    expect(isContextOverflow(42)).toBe(false);
    expect(isContextOverflow(null)).toBe(false);
    expect(isContextOverflow(undefined)).toBe(false);
  });
});

describe("isTransientError", () => {
  it.each([
    "ECONNREFUSED 127.0.0.1:11434",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENOTFOUND",
    "HTTP 503 Service Unavailable",
    "HTTP 502 Bad Gateway",
    "HTTP 500 Internal Server Error",
    "EPIPE write error",
    "unexpected EOF on stream",
    "socket hang up",
    "fetch failed",
  ])("matches: %s", (msg) => {
    expect(isTransientError(new Error(msg))).toBe(true);
  });

  it.each([
    "context length",
    "model not found",
    "request aborted",
    "out of memory",
    "",
  ])("rejects: %s", (msg) => {
    expect(isTransientError(new Error(msg))).toBe(false);
  });
});

describe("isTimeoutError", () => {
  it.each([
    "Request timeout after 30s",
    "deadline exceeded",
    "operation was aborted",
    "TIMEOUT",
  ])("matches: %s", (msg) => {
    expect(isTimeoutError(new Error(msg))).toBe(true);
  });

  it.each([
    "context length",
    "ECONNREFUSED",
    "model not found",
    "",
  ])("rejects: %s", (msg) => {
    expect(isTimeoutError(new Error(msg))).toBe(false);
  });
});

describe("isModelError", () => {
  it.each([
    "out of memory while loading",
    "model not found: llama3:8b",
    "failed to load model",
    "insufficient VRAM",
    "CUDA out of memory",
    "ggml_metal_init failed",
  ])("matches: %s", (msg) => {
    expect(isModelError(new Error(msg))).toBe(true);
  });

  it.each([
    "ECONNREFUSED",
    "context length",
    "timeout",
    "",
  ])("rejects: %s", (msg) => {
    expect(isModelError(new Error(msg))).toBe(false);
  });
});

describe("classifier orthogonality", () => {
  it("ECONNREFUSED is transient but not overflow/timeout/model", () => {
    const e = new Error("ECONNREFUSED");
    expect(isTransientError(e)).toBe(true);
    expect(isContextOverflow(e)).toBe(false);
    expect(isTimeoutError(e)).toBe(false);
    expect(isModelError(e)).toBe(false);
  });

  it("'aborted' is timeout-only, not transient", () => {
    // Important: retry loop dispatches to force-compact on timeout but
    // 2500ms-delay on transient; mis-classification would break flow.
    const e = new Error("operation aborted");
    expect(isTimeoutError(e)).toBe(true);
    expect(isTransientError(e)).toBe(false);
  });
});
