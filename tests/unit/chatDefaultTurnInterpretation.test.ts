import { describe, expect, it, vi } from 'vitest';

import { resolveDefaultChatTurnInterpretation } from '../../src/built-in/chat/utilities/chatDefaultTurnInterpretation';

describe('resolveDefaultChatTurnInterpretation', () => {
  it('refreshes low-confidence workspace scope from the live workspace listing', async () => {
    const result = await resolveDefaultChatTurnInterpretation({
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === '') {
          return [
            { name: 'Broken Docs', type: 'directory' as const },
            { name: 'Claims Guide.md', type: 'file' as const },
          ];
        }
        if (relativePath === 'Broken Docs') {
          return [
            { name: 'policy-scan.pdf', type: 'file' as const },
            { name: 'claims-scan.pdf', type: 'file' as const },
          ];
        }
        return [];
      }),
      isRAGAvailable: () => true,
    }, {
      request: {
        text: 'Please summarize each file in the Broken Docs folder.',
        requestId: 'req-1',
        mode: 0 as any,
        modelId: 'test-model',
        turnState: {
          rawText: 'Please summarize each file in the Broken Docs folder.',
          effectiveText: 'Please summarize each file in the Broken Docs folder.',
          userText: 'Please summarize each file in the Broken Docs folder.',
          contextQueryText: 'Please summarize each file in the Broken Docs folder.',
          mentions: [],
          semantics: {
            category: 'folder-summary',
            isComparative: false,
            exhaustiveSignal: 'strong',
            groundedCoverageModeHint: 'exhaustive',
          },
          queryScope: {
            level: 'workspace',
            derivedFrom: 'contextual',
            confidence: 0.3,
          },
          turnRoute: {
            kind: 'grounded',
            reason: 'This request needs exhaustive file-by-file coverage rather than representative retrieval.',
            coverageMode: 'exhaustive',
          },
          semanticFallback: undefined,
          hasActiveSlashCommand: false,
          isConversationalTurn: false,
          isRagReady: true,
        },
      } as any,
      context: {
        sessionId: 'session-1',
        history: [],
      },
      response: {} as any,
      token: { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: vi.fn() } as any,
      parseSlashCommand: () => ({ userText: '', effectiveText: '', commandName: undefined, command: undefined }),
    });

    expect(result.queryScope.level).toBe('folder');
    expect(result.queryScope.derivedFrom).toBe('inferred');
    expect(result.queryScope.pathPrefixes).toEqual(['Broken Docs/']);
  });
});