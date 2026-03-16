import { describe, expect, it } from 'vitest';

import { createChatContextPlan, createChatRuntimeTrace } from '../../src/built-in/chat/utilities/chatContextPlanner';
import { refineChatRouteAuthorityWithEvidence, resolveChatRouteAuthority } from '../../src/built-in/chat/utilities/chatRouteAuthority';
import { determineChatTurnRoute } from '../../src/built-in/chat/utilities/chatTurnRouter';

describe('chat runtime routing', () => {
  it('routes short greetings as conversational turns', () => {
    const route = determineChatTurnRoute('hello');

    expect(route.kind).toBe('conversational');
    expect(route.directAnswer).toBeUndefined();
  });

  it('routes explicit memory recall without retrieval', () => {
    const route = determineChatTurnRoute('what do you remember about our last conversation?');

    expect(route.kind).toBe('memory-recall');
  });

  it('does not route transcript-specific questions into markdown memory recall', () => {
    const route = determineChatTurnRoute('Search the previous session transcript and tell me the deployment codename I mentioned there.');

    expect(route.kind).toBe('transcript-recall');
  });

  it('marks exhaustive file-by-file review requests as exhaustive coverage turns', () => {
    const route = determineChatTurnRoute('Read each file in this folder and provide a one sentence summary of each file.');

    expect(route.kind).toBe('grounded');
    expect(route.coverageMode).toBe('exhaustive');
  });

  it('marks natural paragraph-summary phrasing as exhaustive coverage', () => {
    const route = determineChatTurnRoute('Can you provide a one paragraph summary for each of the files in the RF Guides folder?');

    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('folder-summary');
    expect(route.coverageMode).toBe('exhaustive');
  });

  it('routes product semantics as direct answers', () => {
    const route = determineChatTurnRoute('what is the difference between approve once and approve task?');

    expect(route.kind).toBe('product-semantics');
    expect(route.directAnswer).toContain('Approve once allows only the current action to run.');
  });

  it('bypasses direct-answer routing when a slash command is active', () => {
    const route = determineChatTurnRoute('/summarize what is the difference between approve once and approve task?', {
      hasActiveSlashCommand: true,
    });

    expect(route.kind).toBe('grounded');
    expect(route.directAnswer).toBeUndefined();
  });
});

describe('chat context planning', () => {
  it('disables retrieval and citations for conversational turns', () => {
    const route = determineChatTurnRoute('hello');
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: false, isRagReady: true });

    expect(plan.useRetrieval).toBe(false);
    expect(plan.useMemoryRecall).toBe(false);
    expect(plan.useCurrentPage).toBe(false);
    expect(plan.citationMode).toBe('disabled');
    expect(plan.retrievalPlan.intent).toBe('conversational');
  });

  it('uses memory without retrieval for memory recall turns', () => {
    const route = determineChatTurnRoute('what do you remember about my last chat?');
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: false, isRagReady: true });

    expect(plan.useRetrieval).toBe(false);
    expect(plan.useMemoryRecall).toBe(true);
    expect(plan.useConceptRecall).toBe(false);
    expect(plan.citationMode).toBe('disabled');
  });

  it('requires citations for grounded turns when rag is ready', () => {
    const route = determineChatTurnRoute('what does my policy say about collision coverage?');
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: false, isRagReady: true });
    const trace = createChatRuntimeTrace(route, plan, {
      sessionId: 'session-1',
      hasActiveSlashCommand: false,
      isRagReady: true,
    });

    expect(plan.useRetrieval).toBe(true);
    expect(plan.useMemoryRecall).toBe(false);
    expect(plan.useConceptRecall).toBe(false);
    expect(plan.useCurrentPage).toBe(true);
    expect(plan.citationMode).toBe('required');
    expect(trace.route.kind).toBe('grounded');
    expect(trace.contextPlan.citationMode).toBe('required');
    expect(trace.sessionId).toBe('session-1');
  });

  it('preserves semantic fallback details in the runtime trace', () => {
    const route = determineChatTurnRoute('what does my policy cover?');
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: false, isRagReady: true });
    const trace = createChatRuntimeTrace(route, plan, {
      sessionId: 'session-fallback',
      hasActiveSlashCommand: false,
      isRagReady: true,
      semanticFallback: {
        kind: 'broad-workspace-summary',
        confidence: 0.76,
        reason: 'Broad workspace-wide phrasing implies exhaustive multi-file coverage even though deterministic routing stayed generic.',
        workflowTypeHint: 'folder-summary',
        groundedCoverageModeHint: 'exhaustive',
      },
    });

    expect(trace.semanticFallback?.kind).toBe('broad-workspace-summary');
    expect(trace.semanticFallback?.groundedCoverageModeHint).toBe('exhaustive');
  });

  it('preserves route-authority details in the runtime trace', () => {
    const route = determineChatTurnRoute('what does my policy cover?');
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: false, isRagReady: true });
    const trace = createChatRuntimeTrace(route, plan, {
      sessionId: 'session-authority',
      hasActiveSlashCommand: false,
      isRagReady: true,
      routeAuthority: {
        action: 'corrected',
        reason: 'Coverage tracking reported zero covered targets for a tool-first route, so representative retrieval is now authoritative.',
      },
    });

    expect(trace.routeAuthority?.action).toBe('corrected');
    expect(trace.routeAuthority?.reason).toContain('representative retrieval');
  });

  it('switches grounded planning into exploration intent for exhaustive coverage turns', () => {
    const route = determineChatTurnRoute('Summarize each file in this directory in one sentence.');
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: false, isRagReady: true });

    expect(plan.useRetrieval).toBe(false);
    expect(plan.retrievalPlan.intent).toBe('exploration');
    expect(plan.retrievalPlan.coverageMode).toBe('exhaustive');
    expect(plan.retrievalPlan.needsRetrieval).toBe(false);
    expect(plan.citationMode).toBe('required');
  });

  it('keeps retrieval off for slash-command turns even when rag is ready', () => {
    const route = determineChatTurnRoute('/fix this file', { hasActiveSlashCommand: true });
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: true, isRagReady: true });

    expect(plan.useRetrieval).toBe(false);
    expect(plan.citationMode).toBe('required');
  });
});

describe('chat route authority', () => {
  it('corrects empty tool-first exhaustive coverage back to representative retrieval', () => {
    const route = determineChatTurnRoute('Summarize each file in this directory in one sentence.');

    const result = resolveChatRouteAuthority(route, {
      level: 'none',
      totalTargets: 4,
      coveredTargets: 0,
      gaps: ['a.md', 'b.md', 'c.md', 'd.md'],
    }, {
      hasActiveSlashCommand: false,
      isRagReady: true,
    });

    expect(result.turnRoute.workflowType).toBe('generic-grounded');
    expect(result.turnRoute.coverageMode).toBe('representative');
    expect(result.authority.action).toBe('corrected');
  });

  it('preserves the route when exhaustive coverage produced usable evidence', () => {
    const route = determineChatTurnRoute('Summarize each file in this directory in one sentence.');

    const result = resolveChatRouteAuthority(route, {
      level: 'partial',
      totalTargets: 4,
      coveredTargets: 3,
      gaps: ['d.md'],
    }, {
      hasActiveSlashCommand: false,
      isRagReady: true,
    });

    expect(result.turnRoute.workflowType).toBe(route.workflowType);
    expect(result.authority.action).toBe('preserved');
  });

  it('corrects incomplete exhaustive coverage when evidence remains insufficient', () => {
    const route = determineChatTurnRoute('Summarize each file in this directory in one sentence.');

    const result = refineChatRouteAuthorityWithEvidence(route, {
      level: 'minimal',
      totalTargets: 4,
      coveredTargets: 1,
      gaps: ['b.md', 'c.md', 'd.md'],
    }, 'insufficient', {
      hasActiveSlashCommand: false,
      isRagReady: true,
    });

    expect(result.turnRoute.workflowType).toBe('generic-grounded');
    expect(result.turnRoute.coverageMode).toBe('representative');
    expect(result.authority.action).toBe('corrected');
  });

  it('preserves incomplete exhaustive coverage when evidence is still sufficient', () => {
    const route = determineChatTurnRoute('Summarize each file in this directory in one sentence.');

    const result = refineChatRouteAuthorityWithEvidence(route, {
      level: 'partial',
      totalTargets: 4,
      coveredTargets: 3,
      gaps: ['d.md'],
    }, 'sufficient', {
      hasActiveSlashCommand: false,
      isRagReady: true,
    });

    expect(result.turnRoute.workflowType).toBe(route.workflowType);
    expect(result.authority.action).toBe('preserved');
  });
});