import { describe, expect, it } from 'vitest';

import { resolveModelTier } from '../../src/openclaw/openclawModelTier';

describe('resolveModelTier', () => {
  // Small models: parameter count ≤ 8
  it.each([
    ['qwen2.5:7b-instruct', 'small'],
    ['qwen2.5:3b', 'small'],
    ['phi3:8b', 'small'],
  ] as const)('classifies "%s" as %s', (model, expected) => {
    expect(resolveModelTier(model)).toBe(expected);
  });

  // Medium models: 8 < parameter count ≤ 32
  it.each([
    ['gpt-oss:20b', 'medium'],
    ['llama3:32b', 'medium'],
    ['qwen2.5:14b', 'medium'],
  ] as const)('classifies "%s" as %s', (model, expected) => {
    expect(resolveModelTier(model)).toBe(expected);
  });

  // Large models: parameter count > 32
  it.each([
    ['llama3:70b', 'large'],
    ['qwen3.5:110b', 'large'],
  ] as const)('classifies "%s" as %s', (model, expected) => {
    expect(resolveModelTier(model)).toBe(expected);
  });

  // Default: no parameter-size match → medium
  it.each([
    ['custom-model', 'medium'],
    ['', 'medium'],
    ['my-finetuned-model', 'medium'],
  ] as const)('defaults "%s" to %s', (model, expected) => {
    expect(resolveModelTier(model)).toBe(expected);
  });
});
