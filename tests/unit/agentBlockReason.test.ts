import { describe, expect, it } from 'vitest';
import { blockReasonFromBoundaryViolation, blockReasonFromPolicyDecision } from '../../src/services/agentBlockReason';

describe('agentBlockReason', () => {
  it('maps workspace boundary violations to outside-workspace-request', () => {
    expect(blockReasonFromBoundaryViolation('outside-workspace')).toBe('outside-workspace-request');
    expect(blockReasonFromBoundaryViolation('no-workspace')).toBe('outside-workspace-request');
  });

  it('maps generic denied decisions to policy-denial', () => {
    expect(blockReasonFromPolicyDecision({
      actionClass: 'command',
      policy: 'deny',
      reason: 'Commands are denied.',
      boundaryDecisions: [],
    })).toBe('policy-denial');
  });
});