import { describe, expect, it, vi } from 'vitest';

import { createChatContextPlan } from '../../src/built-in/chat/utilities/chatContextPlanner';
import { resolveDefaultPreparedTurnContext } from '../../src/built-in/chat/utilities/chatDefaultPreparedTurnContext';
import type { IChatTurnRoute, IQueryScope } from '../../src/built-in/chat/chatTypes';

describe('resolveDefaultPreparedTurnContext', () => {
  it('corrects an empty exhaustive route back to representative retrieval when rag is available', async () => {
    const initialRoute: IChatTurnRoute = {
      kind: 'grounded',
      reason: 'This request needs exhaustive file-by-file coverage rather than representative retrieval.',
      coverageMode: 'exhaustive',
      workflowType: 'folder-summary',
    };
    const queryScope: IQueryScope = {
      level: 'folder',
      pathPrefixes: ['docs/'],
      derivedFrom: 'explicit-mention',
      confidence: 1,
    };
    const initialContextPlan = createChatContextPlan(initialRoute, {
      hasActiveSlashCommand: false,
      isRagReady: true,
    });

    const retrieveContext = vi.fn(async () => ({
      text: 'Retrieved fallback context',
      sources: [{ uri: 'docs/overview.md', label: 'overview.md', index: 1 }],
    }));
    const reportRuntimeTrace = vi.fn();

    const result = await resolveDefaultPreparedTurnContext({
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === 'docs/' || relativePath === 'docs') {
          return [
            { name: 'a.md', type: 'file' as const },
            { name: 'b.md', type: 'file' as const },
          ];
        }
        return [];
      }),
      readFileRelative: vi.fn(async () => null),
      retrieveContext,
      reportRuntimeTrace,
    }, {
      mentionPills: [],
      mentionContextBlocks: [],
      userText: 'Summarize each file in docs.',
      contextQueryText: 'Summarize each file in docs.',
      isRagReady: true,
      turnRoute: initialRoute,
      contextPlan: initialContextPlan,
      retrievalPlan: initialContextPlan.retrievalPlan,
      isConversationalTurn: false,
      queryScope,
      sessionId: 'session-correction',
      messages: [{ role: 'system', content: 'System prompt' }],
      hasActiveSlashCommand: false,
      assessEvidenceSufficiency: (_query, retrievedContextText) => ({
        status: retrievedContextText.includes('Retrieved fallback context') ? 'sufficient' : 'insufficient',
        reasons: retrievedContextText.includes('Retrieved fallback context') ? [] : ['missing-context'],
      }),
      buildRetrieveAgainQuery: () => undefined,
    });

    expect(result.coverageRecord).toEqual({
      level: 'none',
      totalTargets: 2,
      coveredTargets: 0,
      gaps: ['docs/a.md', 'docs/b.md'],
    });
    expect(result.turnRoute.workflowType).toBe('generic-grounded');
    expect(result.turnRoute.coverageMode).toBe('representative');
    expect(result.contextPlan.useRetrieval).toBe(true);
    expect(result.retrievedContextText).toContain('Retrieved fallback context');
    expect(retrieveContext).toHaveBeenCalledWith('Summarize each file in docs.');
    expect(reportRuntimeTrace).toHaveBeenCalled();
    expect(reportRuntimeTrace.mock.calls.at(-1)?.[0]?.routeAuthority).toEqual({
      action: 'corrected',
      reason: 'Coverage tracking reported zero covered targets for a tool-first route, so representative retrieval is now authoritative.',
    });
  });

  it('corrects minimally covered exhaustive evidence when the first pass remains insufficient', async () => {
    const initialRoute: IChatTurnRoute = {
      kind: 'grounded',
      reason: 'This request needs exhaustive file-by-file coverage rather than representative retrieval.',
      coverageMode: 'exhaustive',
      workflowType: 'folder-summary',
    };
    const queryScope: IQueryScope = {
      level: 'folder',
      pathPrefixes: ['docs/'],
      derivedFrom: 'explicit-mention',
      confidence: 1,
    };
    const initialContextPlan = createChatContextPlan(initialRoute, {
      hasActiveSlashCommand: false,
      isRagReady: true,
    });

    const retrieveContext = vi.fn(async () => ({
      text: 'Retrieved representative fallback context',
      sources: [{ uri: 'docs/overview.md', label: 'overview.md', index: 1 }],
    }));
    const reportRuntimeTrace = vi.fn();
    let assessmentCallCount = 0;

    const result = await resolveDefaultPreparedTurnContext({
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === 'docs/' || relativePath === 'docs') {
          return [
            { name: 'a.md', type: 'file' as const },
            { name: 'b.md', type: 'file' as const },
            { name: 'c.md', type: 'file' as const },
          ];
        }
        return [];
      }),
      readFileRelative: vi.fn(async (relativePath: string) => relativePath === 'docs/a.md' ? 'Only one file read' : null),
      retrieveContext,
      reportRuntimeTrace,
    }, {
      mentionPills: [],
      mentionContextBlocks: [],
      userText: 'Summarize each file in docs.',
      contextQueryText: 'Summarize each file in docs.',
      isRagReady: true,
      turnRoute: initialRoute,
      contextPlan: initialContextPlan,
      retrievalPlan: initialContextPlan.retrievalPlan,
      isConversationalTurn: false,
      queryScope,
      sessionId: 'session-minimal-correction',
      messages: [{ role: 'system', content: 'System prompt' }],
      hasActiveSlashCommand: false,
      assessEvidenceSufficiency: (_query, retrievedContextText) => {
        assessmentCallCount += 1;
        return {
          status: retrievedContextText.includes('Retrieved representative fallback context') ? 'sufficient' : 'insufficient',
          reasons: retrievedContextText.includes('Retrieved representative fallback context') ? [] : ['thin-evidence'],
        };
      },
      buildRetrieveAgainQuery: () => undefined,
    });

    expect(result.coverageRecord).toEqual({
      level: 'minimal',
      totalTargets: 3,
      coveredTargets: 1,
      gaps: ['docs/b.md', 'docs/c.md'],
    });
    expect(result.turnRoute.workflowType).toBe('generic-grounded');
    expect(result.turnRoute.coverageMode).toBe('representative');
    expect(result.contextPlan.useRetrieval).toBe(true);
    expect(result.retrievedContextText).toContain('Retrieved representative fallback context');
    expect(retrieveContext).toHaveBeenCalledWith('Summarize each file in docs.');
    expect(assessmentCallCount).toBeGreaterThanOrEqual(2);
    expect(reportRuntimeTrace.mock.calls.at(-1)?.[0]?.routeAuthority).toEqual({
      action: 'corrected',
      reason: 'Coverage was incomplete and the resulting evidence remained weak or insufficient, so representative retrieval is now authoritative.',
    });
  });
});