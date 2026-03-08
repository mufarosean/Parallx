import type { AgentBlockReasonCode, AgentBoundaryViolationType, AgentPolicyDecision } from '../agent/agentTypes.js';

export function blockReasonFromBoundaryViolation(violationType: AgentBoundaryViolationType | undefined): AgentBlockReasonCode {
  switch (violationType) {
    case 'outside-workspace':
    case 'no-workspace':
    case 'non-file-uri':
      return 'outside-workspace-request';
    default:
      return 'policy-denial';
  }
}

export function blockReasonFromPolicyDecision(decision: AgentPolicyDecision): AgentBlockReasonCode {
  const blockedBoundary = decision.boundaryDecisions.find((entry) => !entry.allowed);
  if (blockedBoundary) {
    return blockReasonFromBoundaryViolation(blockedBoundary.violationType);
  }

  return 'policy-denial';
}