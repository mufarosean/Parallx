import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHAT_PARTICIPANT_ID,
  OPENCLAW_DEFAULT_PARTICIPANT_ID,
  resolveChatRuntimeParticipantId,
} from '../../src/services/chatRuntimeSelector';

describe('chat runtime selector', () => {
  it('keeps non-default participants unchanged', () => {
    expect(resolveChatRuntimeParticipantId('parallx.chat.workspace')).toBe('parallx.chat.workspace');
  });

  it('always routes the default participant to OpenClaw', () => {
    expect(resolveChatRuntimeParticipantId(DEFAULT_CHAT_PARTICIPANT_ID, () => ({
      runtime: { implementation: 'openclaw' },
    } as any))).toBe(OPENCLAW_DEFAULT_PARTICIPANT_ID);
  });

  it('routes the default participant to OpenClaw even with other config', () => {
    expect(resolveChatRuntimeParticipantId(DEFAULT_CHAT_PARTICIPANT_ID, () => ({
      runtime: { implementation: 'legacy-claw' },
    } as any))).toBe(OPENCLAW_DEFAULT_PARTICIPANT_ID);
  });
});