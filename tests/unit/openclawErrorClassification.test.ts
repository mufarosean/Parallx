import { describe, expect, it } from 'vitest';

import {
  isContextOverflow,
  isTransientError,
  isTimeoutError,
  isModelError,
} from '../../src/openclaw/openclawErrorClassification';

// ---------------------------------------------------------------------------
// Helper: wraps a message in all supported input types
// ---------------------------------------------------------------------------

function allInputTypes(msg: string): [string, unknown][] {
  return [
    ['Error object', new Error(msg)],
    ['bare string', msg],
    ['{ message }', { message: msg }],
  ];
}

// ---------------------------------------------------------------------------
// isContextOverflow
// ---------------------------------------------------------------------------

describe('isContextOverflow', () => {
  const positives = [
    'context length exceeded',
    'too many tokens for this model',
    'context window is full',
    'maximum context capacity reached',
  ];

  it.each(positives)('detects "%s"', (msg) => {
    for (const [, input] of allInputTypes(msg)) {
      expect(isContextOverflow(input)).toBe(true);
    }
  });

  const negatives = ['timeout', 'ECONNREFUSED', 'generic error', 'model not found'];

  it.each(negatives)('rejects "%s"', (msg) => {
    expect(isContextOverflow(new Error(msg))).toBe(false);
  });

  it('handles non-standard values', () => {
    expect(isContextOverflow(42)).toBe(false);
    expect(isContextOverflow(null)).toBe(false);
    expect(isContextOverflow(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTransientError
// ---------------------------------------------------------------------------

describe('isTransientError', () => {
  const positives = [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'HTTP 503 Service Unavailable',
    'HTTP 502 Bad Gateway',
    'EPIPE broken pipe',
    'unexpected EOF',
    'socket hang up',
    'fetch failed',
    'HTTP 500 Internal Server Error',
  ];

  it.each(positives)('detects "%s"', (msg) => {
    for (const [, input] of allInputTypes(msg)) {
      expect(isTransientError(input)).toBe(true);
    }
  });

  const negatives = ['context length exceeded', 'timeout', 'generic error', 'out of memory'];

  it.each(negatives)('rejects "%s"', (msg) => {
    expect(isTransientError(new Error(msg))).toBe(false);
  });

  it('handles non-standard values', () => {
    expect(isTransientError(42)).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTimeoutError
// ---------------------------------------------------------------------------

describe('isTimeoutError', () => {
  const positives = [
    'request timeout after 30s',
    'deadline exceeded',
    'request aborted by client',
  ];

  it.each(positives)('detects "%s"', (msg) => {
    for (const [, input] of allInputTypes(msg)) {
      expect(isTimeoutError(input)).toBe(true);
    }
  });

  const negatives = ['ECONNREFUSED', 'context length exceeded', 'generic error'];

  it.each(negatives)('rejects "%s"', (msg) => {
    expect(isTimeoutError(new Error(msg))).toBe(false);
  });

  it('handles non-standard values', () => {
    expect(isTimeoutError(42)).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isModelError
// ---------------------------------------------------------------------------

describe('isModelError', () => {
  const positives = [
    'out of memory allocating tensor',
    'model not found: llama3:70b',
    'failed to load model weights',
    'insufficient VRAM for model',
    'CUDA out of memory',
    'ggml_metal: error allocating buffer',
  ];

  it.each(positives)('detects "%s"', (msg) => {
    for (const [, input] of allInputTypes(msg)) {
      expect(isModelError(input)).toBe(true);
    }
  });

  const negatives = ['ECONNREFUSED', 'context length exceeded', 'timeout', 'generic error'];

  it.each(negatives)('rejects "%s"', (msg) => {
    expect(isModelError(new Error(msg))).toBe(false);
  });

  it('handles non-standard values', () => {
    expect(isModelError(42)).toBe(false);
    expect(isModelError(null)).toBe(false);
  });

  it('is not classified as transient', () => {
    // Model errors should NOT be transient — retrying same model won't help
    for (const msg of positives) {
      expect(isTransientError(new Error(msg))).toBe(false);
    }
  });
});
