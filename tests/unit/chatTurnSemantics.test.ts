import { describe, expect, it } from 'vitest';

import { analyzeChatTurnSemantics } from '../../src/built-in/chat/utilities/chatTurnSemantics';

describe('chat turn semantics', () => {
  it('treats durable preference prompts as explicit memory recall', () => {
    const semantics = analyzeChatTurnSemantics('What durable preference is recorded for technical answers?');
    expect(semantics.isExplicitMemoryRecall).toBe(true);
  });

  it('treats daily-memory prompts as explicit memory recall', () => {
    const semantics = analyzeChatTurnSemantics('What migration spike codename is recorded in daily memory?');
    expect(semantics.isExplicitMemoryRecall).toBe(true);
  });

  it('keeps summary-style exhaustive reviews on the folder-summary path even when list wording appears', () => {
    const semantics = analyzeChatTurnSemantics('Give me a bulleted list with a short summary of each file in the RF Guides folder.');

    expect(semantics.isExhaustiveWorkspaceReview).toBe(true);
    expect(semantics.workflowTypeHint).toBe('folder-summary');
    expect(semantics.groundedCoverageModeHint).toBe('exhaustive');
  });

  it('marks explicit extraction requests as exhaustive extraction', () => {
    const semantics = analyzeChatTurnSemantics('List every deductible amount from all policy documents.');

    expect(semantics.isExhaustiveWorkspaceReview).toBe(true);
    expect(semantics.workflowTypeHint).toBe('exhaustive-extraction');
    expect(semantics.groundedCoverageModeHint).toBe('exhaustive');
  });
});
