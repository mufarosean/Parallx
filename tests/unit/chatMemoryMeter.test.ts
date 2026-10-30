// chatMemoryMeter.test.ts — the context meter's "Memory in the last turn"
// rows: what of the window remembering costs, in tokens (chars ÷ 4).
import { describe, it, expect } from 'vitest';
import { memoryRows } from '../../src/built-in/chat/widgets/chatTokenStatusBar';

describe('memory in the context meter', () => {
  it('lists USER.md, continuity notes and recalled memories that rode in', () => {
    expect(memoryRows({ userChars: 400, continuityChars: 0, recalledChars: 1001 })).toEqual([
      { label: 'About you (USER.md)', tokens: 100 },
      { label: 'Recalled memories', tokens: 251 },
    ]);
  });
  it('shows nothing before a turn has reported', () => {
    expect(memoryRows(undefined)).toEqual([]);
    expect(memoryRows({ userChars: 0, continuityChars: 0, recalledChars: 0 })).toEqual([]);
  });
});
