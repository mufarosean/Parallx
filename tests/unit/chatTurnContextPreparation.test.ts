import { describe, expect, it, vi } from 'vitest';

import { prepareChatTurnContext, writeChatProvenanceToResponse } from '../../src/built-in/chat/utilities/chatTurnContextPreparation';

describe('chat turn context preparation', () => {
  it('prepares assembled context and preserves mention blocks ahead of assembled sources', async () => {
    const result = await prepareChatTurnContext(
      {
        retrieveContext: vi.fn().mockResolvedValue({
          text: '[Retrieved Context]\n[1] Source: Policy.md\nPath: Policy.md\nDeductible is $500',
          sources: [{ uri: 'Policy.md', label: 'Policy.md', index: 1 }],
        }),
        recallMemories: vi.fn().mockResolvedValue('remembered session details'),
        recallConcepts: vi.fn().mockResolvedValue('concept recall details'),
        readFileContent: vi.fn().mockResolvedValue('attachment body'),
        assessEvidenceSufficiency: () => ({ status: 'sufficient', reasons: [] }),
        buildRetrieveAgainQuery: () => '',
      },
      {
        contextQueryText: 'what is my deductible',
        sessionId: 'session-1',
        attachments: [{ kind: 'file', id: 'C:/policy.txt', name: 'policy.txt', fullPath: 'C:/policy.txt', isImplicit: false } as any],
        messages: [{ role: 'system', content: 'system prompt text' } as any],
        mentionPills: [],
        mentionContextBlocks: ['Mention block'],
        contextPlan: {
          route: 'grounded',
          intent: 'question',
          useRetrieval: true,
          useMemoryRecall: true,
          useTranscriptRecall: false,
          useConceptRecall: true,
          useCurrentPage: false,
          citationMode: 'required',
          reasoning: 'test',
          retrievalPlan: { intent: 'question', reasoning: 'test', needsRetrieval: true, queries: [] },
        },
        hasActiveSlashCommand: false,
        isRagReady: true,
      },
    );

    expect(result.contextParts[0]).toBe('Mention block');
    expect(result.contextParts.some((part) => part.includes('Deductible is $500'))).toBe(true);
    expect(result.contextParts.some((part) => part.includes('remembered session details'))).toBe(true);
    expect(result.contextParts.some((part) => part.includes('concept recall details'))).toBe(true);
    expect(result.provenance.map((entry) => entry.kind)).toEqual(['rag', 'memory', 'concept', 'attachment']);
  });

  it('writes provenance through the stream provenance method when available', () => {
    const provenance = [
      { id: 'Policy.md', label: 'Policy.md', kind: 'rag', uri: 'Policy.md', index: 1, tokens: 0, removable: true },
    ] as const;
    const stream = {
      provenance: vi.fn(),
      reference: vi.fn(),
    } as any;

    writeChatProvenanceToResponse(stream, provenance);

    expect(stream.provenance).toHaveBeenCalledWith(provenance[0]);
    expect(stream.reference).not.toHaveBeenCalled();
  });

  it('falls back to response.reference when provenance is unavailable', () => {
    const provenance = [
      { id: 'Policy.md', label: 'Policy.md', kind: 'rag', uri: 'Policy.md', index: 1, tokens: 0, removable: true },
    ] as const;
    const stream = {
      reference: vi.fn(),
    } as any;

    writeChatProvenanceToResponse(stream, provenance);

    expect(stream.reference).toHaveBeenCalledWith('Policy.md', 'Policy.md', 1);
  });
});