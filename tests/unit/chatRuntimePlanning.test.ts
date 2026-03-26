import { describe, expect, it } from 'vitest';

import { createChatContextPlan, createChatRuntimeTrace } from '../../src/built-in/chat/utilities/chatContextPlanner';
import { determineChatTurnRoute } from '../../src/built-in/chat/utilities/chatTurnRouter';

describe('chat runtime routing', () => {
  it('routes short greetings as conversational turns', () => {
    const route = determineChatTurnRoute('hello');

    expect(route.kind).toBe('conversational');
  });

  it('routes explicit memory recall without retrieval', () => {
    const route = determineChatTurnRoute('what do you remember about our last conversation?');

    expect(route.kind).toBe('memory-recall');
  });

  it('does not route transcript-specific questions into markdown memory recall', () => {
    const route = determineChatTurnRoute('Search the previous session transcript and tell me the deployment codename I mentioned there.');

    expect(route.kind).toBe('transcript-recall');
  });

  it('routes exhaustive file-by-file review requests as grounded turns', () => {
    const route = determineChatTurnRoute('Read each file in this folder and provide a one sentence summary of each file.');

    expect(route.kind).toBe('grounded');
  });

  it('routes natural paragraph-summary phrasing as grounded turns', () => {
    const route = determineChatTurnRoute('Can you provide a one paragraph summary for each of the files in the RF Guides folder?');

    expect(route.kind).toBe('grounded');
  });

  it('bypasses direct-answer routing when a slash command is active', () => {
    const route = determineChatTurnRoute('/summarize what is the difference between approve once and approve task?', {
      hasActiveSlashCommand: true,
    });

    expect(route.kind).toBe('grounded');
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
      },
    });

    expect(trace.semanticFallback?.kind).toBe('broad-workspace-summary');
  });

  it('keeps broad ambiguous workspace-summary phrasing as standard grounded retrieval', () => {
    const route = determineChatTurnRoute('Tell me about everything in here.');
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: false, isRagReady: true });
    const trace = createChatRuntimeTrace(route, plan, {
      sessionId: 'session-generic',
      hasActiveSlashCommand: false,
      isRagReady: true,
    });

    expect(route.kind).toBe('grounded');
    expect(plan.useRetrieval).toBe(true);
    expect(trace.semanticFallback).toBeUndefined();
  });

  it('uses standard retrieval for exhaustive-phrased grounded turns', () => {
    const route = determineChatTurnRoute('Summarize each file in this directory in one sentence.');
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: false, isRagReady: true });

    expect(plan.useRetrieval).toBe(true);
    expect(plan.retrievalPlan.intent).toBe('question');
    expect(plan.retrievalPlan.needsRetrieval).toBe(true);
    expect(plan.citationMode).toBe('required');
  });

  it('keeps retrieval off for slash-command turns even when rag is ready', () => {
    const route = determineChatTurnRoute('/fix this file', { hasActiveSlashCommand: true });
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: true, isRagReady: true });

    expect(plan.useRetrieval).toBe(false);
    expect(plan.citationMode).toBe('required');
  });
});