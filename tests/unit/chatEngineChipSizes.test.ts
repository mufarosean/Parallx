import { describe, it, expect } from 'vitest';
import { contextSizesFor } from '../../src/built-in/chat/widgets/chatEngineChip';

describe('engine chip context sizes', () => {
  it('offers 160K for a model that holds 256K', () => {
    expect(contextSizesFor(262_144)).toEqual([4_096, 8_192, 16_384, 32_768, 65_536, 131_072, 163_840, 262_144]);
  });
  it("adds the model's own maximum when it is not a standard size", () => {
    expect(contextSizesFor(40_960)).toEqual([4_096, 8_192, 16_384, 32_768, 40_960]);
  });
  it('falls back to every size when the maximum is unknown', () => {
    expect(contextSizesFor(0).at(-1)).toBe(262_144);
  });
});
