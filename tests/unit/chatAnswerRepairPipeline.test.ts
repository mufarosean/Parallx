import { describe, expect, it, vi } from 'vitest';

import { applyChatAnswerRepairPipeline } from '../../src/built-in/chat/utilities/chatAnswerRepairPipeline';

describe('chat answer repair pipeline', () => {
  it('applies the repair stages in the expected order against grounded context', () => {
    const calls: string[] = [];

    const repaired = applyChatAnswerRepairPipeline({
      repairGroundedAnswerTypography: vi.fn((answer) => {
        calls.push('typography');
        return `${answer}|typography`;
      }),
      repairUnsupportedWorkspaceTopicAnswer: vi.fn((query, answer) => {
        calls.push(`workspace-topic:${query}`);
        return `${answer}|workspace-topic`;
      }),
      repairGroundedCodeAnswer: vi.fn((query, answer, context) => {
        calls.push(`grounded:${query}:${context}`);
        return `${answer}|grounded`;
      }),
      repairTotalLossThresholdAnswer: vi.fn((query, answer, context) => {
        calls.push(`total-loss:${query}:${context}`);
        return `${answer}|total-loss`;
      }),
      repairDeductibleConflictAnswer: vi.fn((query, answer, context) => {
        calls.push(`deductible:${query}:${context}`);
        return `${answer}|deductible`;
      }),
      repairAgentContactAnswer: vi.fn((query, answer, context) => {
        calls.push(`agent:${query}:${context}`);
        return `${answer}|agent`;
      }),
      repairVehicleInfoAnswer: vi.fn((query, answer, context) => {
        calls.push(`vehicle:${query}:${context}`);
        return `${answer}|vehicle`;
      }),
      repairUnsupportedSpecificCoverageAnswer: vi.fn((query, answer, assessment) => {
        calls.push(`specific:${query}:${assessment.status}`);
        return `${answer}|specific`;
      }),
    }, {
      query: 'What is my agent phone number?',
      markdown: 'answer',
      retrievedContextText: '[Retrieved Context]\nAgent Contacts',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
    });

    expect(repaired).toBe('answer|grounded|total-loss|deductible|agent|vehicle|specific|workspace-topic|typography');
    expect(calls).toEqual([
      'grounded:What is my agent phone number?:[Retrieved Context]\nAgent Contacts',
      'total-loss:What is my agent phone number?:[Retrieved Context]\nAgent Contacts',
      'deductible:What is my agent phone number?:[Retrieved Context]\nAgent Contacts',
      'agent:What is my agent phone number?:[Retrieved Context]\nAgent Contacts',
      'vehicle:What is my agent phone number?:[Retrieved Context]\nAgent Contacts',
      'specific:What is my agent phone number?:sufficient',
      'workspace-topic:What is my agent phone number?',
      'typography',
    ]);
  });

  it('falls back to the markdown when retrieved context is empty', () => {
    const repairGroundedCodeAnswer = vi.fn((_, answer, context) => `${answer}|${context}`);

    const repaired = applyChatAnswerRepairPipeline({
      repairGroundedAnswerTypography: vi.fn((answer) => answer),
      repairUnsupportedWorkspaceTopicAnswer: vi.fn((_, answer) => answer),
      repairGroundedCodeAnswer,
      repairTotalLossThresholdAnswer: vi.fn((_, answer) => answer),
      repairDeductibleConflictAnswer: vi.fn((_, answer) => answer),
      repairAgentContactAnswer: vi.fn((_, answer) => answer),
      repairVehicleInfoAnswer: vi.fn((_, answer) => answer),
      repairUnsupportedSpecificCoverageAnswer: vi.fn((_, answer) => answer),
    }, {
      query: 'question',
      markdown: 'raw-markdown',
      retrievedContextText: '',
      evidenceAssessment: { status: 'weak', reasons: [] },
    });

    expect(repaired).toBe('raw-markdown|raw-markdown');
    expect(repairGroundedCodeAnswer).toHaveBeenCalledWith('question', 'raw-markdown', 'raw-markdown');
  });
});