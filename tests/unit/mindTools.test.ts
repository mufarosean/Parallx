import { describe, expect, it } from 'vitest';

import { createMindRememberTool, type IMindWriter } from '../../src/built-in/chat/tools/mindTools';
import type { ICancellationToken } from '../../src/services/chatTypes';

const TOKEN = {} as ICancellationToken;

function fakeMind() {
  const calls: { kind: string; content: string; confidence: number; provenance: readonly string[] }[] = [];
  const mind: IMindWriter = {
    async remember(kind, content, confidence, provenance) {
      calls.push({ kind, content, confidence, provenance });
      return content.trim().length > 0 && provenance.length > 0;
    },
  };
  return { mind, calls };
}

describe('mind_remember tool', () => {
  it('records a belief with provenance', async () => {
    const { mind, calls } = fakeMind();
    const tool = createMindRememberTool(mind);
    const res = await tool.handler({ content: 'User ships on Fridays', reason: 'three Friday releases in a row', confidence: 0.8 }, TOKEN);
    expect(res.isError).toBeFalsy();
    expect(calls[0]).toMatchObject({ kind: 'belief', content: 'User ships on Fridays', confidence: 0.8 });
    expect(calls[0].provenance).toEqual(['three Friday releases in a row']);
  });

  it('defaults kind=belief and confidence=0.6', async () => {
    const { mind, calls } = fakeMind();
    const res = await createMindRememberTool(mind).handler({ content: 'x', reason: 'y' }, TOKEN);
    expect(res.isError).toBeFalsy();
    expect(calls[0].kind).toBe('belief');
    expect(calls[0].confidence).toBe(0.6);
  });

  it('supports kind=thread', async () => {
    const { mind, calls } = fakeMind();
    await createMindRememberTool(mind).handler({ content: 'tracking migration', reason: 'in progress', kind: 'thread' }, TOKEN);
    expect(calls[0].kind).toBe('thread');
  });

  it('rejects a write with no reason (provenance required)', async () => {
    const { mind, calls } = fakeMind();
    const res = await createMindRememberTool(mind).handler({ content: 'unsourced' }, TOKEN);
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('rejects empty content', async () => {
    const { mind } = fakeMind();
    const res = await createMindRememberTool(mind).handler({ content: '   ', reason: 'r' }, TOKEN);
    expect(res.isError).toBe(true);
  });

  it('clamps confidence to 0..1', async () => {
    const { mind, calls } = fakeMind();
    await createMindRememberTool(mind).handler({ content: 'x', reason: 'r', confidence: 5 }, TOKEN);
    expect(calls[0].confidence).toBe(1);
  });

  it('is always-allowed (the agent curates its own model autonomously)', () => {
    expect(createMindRememberTool(fakeMind().mind).permissionLevel).toBe('always-allowed');
  });
});
