import { describe, expect, it } from 'vitest';

import { createChatContextPlan, createChatRuntimeTrace } from '../../src/built-in/chat/utilities/chatContextPlanner';
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

    expect(route.kind).toBe('grounded');
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

  it('keeps retrieval off for slash-command turns even when rag is ready', () => {
    const route = determineChatTurnRoute('/fix this file', { hasActiveSlashCommand: true });
    const plan = createChatContextPlan(route, { hasActiveSlashCommand: true, isRagReady: true });

    expect(plan.useRetrieval).toBe(false);
    expect(plan.citationMode).toBe('disabled');
  });
});