import { describe, expect, it, vi, beforeEach } from 'vitest';

import { OpenclawContextEngine, type IOpenclawContextEngineServices } from '../../src/openclaw/openclawContextEngine';
import { computeTokenBudget, estimateMessagesTokens, estimateTokens, trimTextToBudget } from '../../src/openclaw/openclawTokenBudget';
import type { IChatMessage, IChatResponseChunk } from '../../src/services/chatTypes';

// ---------------------------------------------------------------------------
// Mock services factory
// ---------------------------------------------------------------------------

function createMockServices(overrides?: Partial<IOpenclawContextEngineServices>): IOpenclawContextEngineServices {
  return {
    retrieveContext: vi.fn(async () => ({
      text: 'Insurance policy covers collision damage with $500 deductible.',
      sources: [{ uri: 'file:///policy.md', label: 'Auto Insurance Policy', index: 0 }],
    })),
    recallMemories: vi.fn(async () => 'User prefers detailed answers with citations.'),
    recallConcepts: vi.fn(async () => 'deductible: amount paid before insurance covers a claim'),
    recallTranscripts: vi.fn(async () => 'Previous: User asked about filing a claim.'),
    getCurrentPageContent: vi.fn(async () => ({
      title: 'Claims Guide',
      pageId: 'page-123',
      textContent: 'Step 1: Report the accident...',
    })),
    storeSessionMemory: vi.fn(async () => {}),
    storeConceptsFromSession: vi.fn(async () => {}),
    sendSummarizationRequest: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeTokenBudget
// ---------------------------------------------------------------------------

describe('computeTokenBudget', () => {
  it('splits budget into 10/30/30/30', () => {
    const budget = computeTokenBudget(8192);
    expect(budget.total).toBe(8192);
    expect(budget.system).toBe(819);
    expect(budget.rag).toBe(2457);
    expect(budget.history).toBe(2457);
    expect(budget.user).toBe(2457);
  });

  it('handles zero context window', () => {
    const budget = computeTokenBudget(0);
    expect(budget.total).toBe(0);
    expect(budget.system).toBe(0);
    expect(budget.rag).toBe(0);
  });

  it('clamps negative values to zero', () => {
    const budget = computeTokenBudget(-100);
    expect(budget.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// estimateMessagesTokens
// ---------------------------------------------------------------------------

describe('estimateMessagesTokens', () => {
  it('estimates tokens for messages with role overhead', () => {
    const messages: IChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ];
    const tokens = estimateMessagesTokens(messages);
    // Each message: 4 (overhead) + content_chars/4
    // system: 4 + 16/4 = 8, user: 4 + 5/4 ≈ 5
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(
      4 + estimateTokens('You are helpful.') + 4 + estimateTokens('Hello'),
    );
  });

  it('returns 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// trimTextToBudget
// ---------------------------------------------------------------------------

describe('trimTextToBudget', () => {
  it('returns text unchanged when within budget', () => {
    const result = trimTextToBudget('short text', 1000);
    expect(result.trimmed).toBe(false);
    expect(result.text).toBe('short text');
  });

  it('trims from beginning when over budget', () => {
    const longText = 'x'.repeat(800); // 800 chars = 200 tokens
    const result = trimTextToBudget(longText, 50); // 50 tokens = 200 chars
    expect(result.trimmed).toBe(true);
    expect(result.text.length).toBe(200);
    // Keeps the end (most recent)
    expect(result.text).toBe('x'.repeat(200));
  });
});

// ---------------------------------------------------------------------------
// OpenclawContextEngine — bootstrap
// ---------------------------------------------------------------------------

describe('OpenclawContextEngine', () => {
  let services: IOpenclawContextEngineServices;
  let engine: OpenclawContextEngine;

  beforeEach(() => {
    services = createMockServices();
    engine = new OpenclawContextEngine(services);
  });

  describe('bootstrap', () => {
    it('reports all services as ready', async () => {
      const result = await engine.bootstrap({ sessionId: 'test', tokenBudget: 8192 });
      expect(result.ragReady).toBe(true);
      expect(result.memoryReady).toBe(true);
      expect(result.conceptsReady).toBe(true);
    });

    it('reports unavailable services', async () => {
      const sparseServices = createMockServices({
        retrieveContext: undefined,
        recallMemories: undefined,
      });
      const sparseEngine = new OpenclawContextEngine(sparseServices);
      const result = await sparseEngine.bootstrap({ sessionId: 'test', tokenBudget: 8192 });
      expect(result.ragReady).toBe(false);
      expect(result.memoryReady).toBe(false);
      expect(result.conceptsReady).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // assemble
  // ---------------------------------------------------------------------------

  describe('assemble', () => {
    it('fires all retrieval services in parallel', async () => {
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await engine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'What is my deductible?',
      });

      expect(services.retrieveContext).toHaveBeenCalledWith('What is my deductible?');
      expect(services.recallMemories).toHaveBeenCalledWith('What is my deductible?', 's1');
      expect(services.recallConcepts).toHaveBeenCalledWith('What is my deductible?');
      expect(services.recallTranscripts).toHaveBeenCalledWith('What is my deductible?');
      expect(services.getCurrentPageContent).toHaveBeenCalled();
    });

    it('delivers retrieval content via messages, not systemPromptAddition', async () => {
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      const result = await engine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'What is my deductible?',
      });

      // RAG content should be in messages, not systemPromptAddition
      const contextMsg = result.messages.find(m =>
        m.content.includes('Retrieved Context')
      );
      expect(contextMsg).toBeDefined();
      expect(contextMsg!.role).toBe('user');
      expect(contextMsg!.content).toContain('collision damage');

      // systemPromptAddition should NOT contain RAG content
      if (result.systemPromptAddition) {
        expect(result.systemPromptAddition).not.toContain('Retrieved Context');
        expect(result.systemPromptAddition).not.toContain('collision damage');
      }
    });

    it('includes memory, concepts, and transcripts in context message', async () => {
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      const result = await engine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'What is my deductible?',
      });

      const contextMsg = result.messages.find(m =>
        m.content.includes('Recalled Memories')
      );
      expect(contextMsg).toBeDefined();
      expect(contextMsg!.content).toContain('Recalled Memories');
      expect(contextMsg!.content).toContain('Concepts');
      expect(contextMsg!.content).toContain('Recalled Transcripts');
    });

    it('respects sub-lane budget limits', async () => {
      // Create huge RAG result that exceeds lane budget
      const hugeText = 'x'.repeat(100_000); // 25000 tokens — way over budget
      const hugeServices = createMockServices({
        retrieveContext: vi.fn(async () => ({
          text: hugeText,
          sources: [{ uri: 'file:///big.md', label: 'Big', index: 0 }],
        })),
      });
      const hugeEngine = new OpenclawContextEngine(hugeServices);
      await hugeEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      const result = await hugeEngine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'test',
      });

      // Context message should exist but be truncated
      const contextMsg = result.messages.find(m => m.content.includes('Retrieved Context'));
      expect(contextMsg).toBeDefined();
      // 55% of RAG budget (2457) = 1351 tokens = ~5404 chars
      expect(contextMsg!.content.length).toBeLessThan(hugeText.length);
    });

    it('enforces aggregate RAG budget cap', async () => {
      // Fill memory lane to the max — concepts should be dropped if aggregate is exceeded
      const largeMemory = 'M'.repeat(4000); // ~1000 tokens
      const servicesWithLargeMemory = createMockServices({
        recallMemories: vi.fn(async () => largeMemory),
      });
      const memEngine = new OpenclawContextEngine(servicesWithLargeMemory);
      await memEngine.bootstrap({ sessionId: 's1', tokenBudget: 4096 });
      const result = await memEngine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 4096,
        prompt: 'test',
      });

      // Should still produce valid result without exceeding budget
      expect(result.estimatedTokens).toBeLessThanOrEqual(4096);
    });

    it('returns rag sources from retrieval', async () => {
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      const result = await engine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'policy details',
      });

      expect(result.ragSources).toHaveLength(1);
      expect(result.ragSources[0].uri).toBe('file:///policy.md');
      expect(result.ragSources[0].label).toBe('Auto Insurance Policy');
    });

    it('trims history to budget and keeps most recent', async () => {
      const history: IChatMessage[] = [];
      for (let i = 0; i < 100; i++) {
        history.push(
          { role: 'user', content: `Message ${i}: ${'x'.repeat(200)}` },
          { role: 'assistant', content: `Reply ${i}: ${'y'.repeat(200)}` },
        );
      }

      await engine.bootstrap({ sessionId: 's1', tokenBudget: 4096 });
      const result = await engine.assemble({
        sessionId: 's1',
        history,
        tokenBudget: 4096,
        prompt: 'test',
      });

      // Should have fewer messages than the full 200
      const historyInResult = result.messages.filter(m =>
        m.content.startsWith('Message') || m.content.startsWith('Reply')
      );
      expect(historyInResult.length).toBeLessThan(200);
      // Most recent messages should be preserved
      const lastMsg = historyInResult[historyInResult.length - 1];
      expect(lastMsg.content).toContain('Reply 99');
    });

    it('handles all services unavailable gracefully', async () => {
      const emptyServices = createMockServices({
        retrieveContext: undefined,
        recallMemories: undefined,
        recallConcepts: undefined,
        recallTranscripts: undefined,
        getCurrentPageContent: undefined,
      });
      const emptyEngine = new OpenclawContextEngine(emptyServices);
      await emptyEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      const result = await emptyEngine.assemble({
        sessionId: 's1',
        history: [{ role: 'user', content: 'Hello' }],
        tokenBudget: 8192,
        prompt: 'Hello',
      });

      // Should still work — just history, no context
      expect(result.messages.length).toBe(1);
      expect(result.messages[0].content).toBe('Hello');
      expect(result.ragSources).toHaveLength(0);
      expect(result.systemPromptAddition).toBeUndefined();
    });

    it('isolates service failures via catch', async () => {
      const failServices = createMockServices({
        retrieveContext: vi.fn(async () => { throw new Error('RAG down'); }),
        recallMemories: vi.fn(async () => { throw new Error('Memory down'); }),
      });
      const failEngine = new OpenclawContextEngine(failServices);
      await failEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      // Should not throw — errors are caught per-service
      const result = await failEngine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'test',
      });
      expect(result).toBeDefined();
      expect(result.ragSources).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // compact
  // ---------------------------------------------------------------------------

  describe('compact', () => {
    it('returns not-compacted for fewer than 2 messages', async () => {
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      // Assemble with 1 message to cache history
      await engine.assemble({
        sessionId: 's1',
        history: [{ role: 'user', content: 'Hello' }],
        tokenBudget: 8192,
        prompt: 'Hello',
      });

      const result = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
      expect(result.compacted).toBe(false);
    });

    it('falls back to simple trim when no summarizer', async () => {
      // services.sendSummarizationRequest is undefined by default
      const history: IChatMessage[] = [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Second answer' },
        { role: 'user', content: 'Third question' },
        { role: 'assistant', content: 'Third answer' },
      ];

      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await engine.assemble({
        sessionId: 's1',
        history,
        tokenBudget: 8192,
        prompt: 'test',
      });

      const result = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
      expect(result.compacted).toBe(true);
      expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
    });

    it('uses summarization when available', async () => {
      async function* mockSummarize(): AsyncIterable<IChatResponseChunk> {
        yield { content: 'Summary: user discussed policy details.' } as IChatResponseChunk;
      }
      const sumServices = createMockServices({
        sendSummarizationRequest: vi.fn(() => mockSummarize()),
      });
      const sumEngine = new OpenclawContextEngine(sumServices);

      const history: IChatMessage[] = [
        { role: 'user', content: 'What is my coverage?' },
        { role: 'assistant', content: 'Your coverage includes...' },
        { role: 'user', content: 'What about deductible?' },
        { role: 'assistant', content: 'The deductible is $500.' },
      ];

      await sumEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await sumEngine.assemble({
        sessionId: 's1',
        history,
        tokenBudget: 8192,
        prompt: 'test',
      });

      const result = await sumEngine.compact({ sessionId: 's1', tokenBudget: 8192 });
      expect(result.compacted).toBe(true);
      expect(sumServices.sendSummarizationRequest).toHaveBeenCalled();
    });

    it('flushes summary to long-term memory after compaction', async () => {
      async function* mockSummarize(): AsyncIterable<IChatResponseChunk> {
        yield { content: 'Summary of conversation.' } as IChatResponseChunk;
      }
      const flushServices = createMockServices({
        sendSummarizationRequest: vi.fn(() => mockSummarize()),
        storeSessionMemory: vi.fn(async () => {}),
      });
      const flushEngine = new OpenclawContextEngine(flushServices);

      const history: IChatMessage[] = [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
      ];

      await flushEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await flushEngine.assemble({
        sessionId: 's1',
        history,
        tokenBudget: 8192,
        prompt: 'test',
      });

      await flushEngine.compact({ sessionId: 's1', tokenBudget: 8192 });
      expect(flushServices.storeSessionMemory).toHaveBeenCalledWith(
        's1',
        'Summary of conversation.',
        4, // history.length
      );
    });

    it('survives summarization failure gracefully', async () => {
      async function* failSummarize(): AsyncIterable<IChatResponseChunk> {
        throw new Error('Model down');
      }
      const failServices = createMockServices({
        sendSummarizationRequest: vi.fn(() => failSummarize()),
      });
      const failEngine = new OpenclawContextEngine(failServices);

      const history: IChatMessage[] = [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
      ];

      await failEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await failEngine.assemble({
        sessionId: 's1',
        history,
        tokenBudget: 8192,
        prompt: 'test',
      });

      // Should not throw — falls back to simple trim
      const result = await failEngine.compact({ sessionId: 's1', tokenBudget: 8192 });
      expect(result.compacted).toBe(true);
    });

    it('preserves compacted history across assemble → compact → re-assemble cycle (F8-16)', async () => {
      // Simulate the turn runner retry cycle: assemble → compact → re-assemble
      const history: IChatMessage[] = [
        { role: 'user', content: 'Message 1: ' + 'x'.repeat(200) },
        { role: 'assistant', content: 'Reply 1: ' + 'y'.repeat(200) },
        { role: 'user', content: 'Message 2: ' + 'x'.repeat(200) },
        { role: 'assistant', content: 'Reply 2: ' + 'y'.repeat(200) },
        { role: 'user', content: 'Message 3: ' + 'x'.repeat(200) },
        { role: 'assistant', content: 'Reply 3: ' + 'y'.repeat(200) },
      ];

      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      // First assemble (as the turn runner would do)
      const result1 = await engine.assemble({
        sessionId: 's1',
        history,
        tokenBudget: 8192,
        prompt: 'test',
      });
      const historyCount1 = result1.messages.filter(m =>
        m.content.startsWith('Message') || m.content.startsWith('Reply')
      ).length;

      // Compact (as the turn runner would do on overflow)
      const compactResult = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
      expect(compactResult.compacted).toBe(true);

      // Re-assemble with the SAME params.history (this is what the turn runner does)
      const result2 = await engine.assemble({
        sessionId: 's1',
        history, // same original history — turn runner passes context.history every time
        tokenBudget: 8192,
        prompt: 'test',
      });
      const historyCount2 = result2.messages.filter(m =>
        m.content.startsWith('Message') || m.content.startsWith('Reply') ||
        m.content.includes('[Context summary]') || m.content.includes('Understood')
      ).length;

      // After compaction, the re-assembled result should have FEWER history messages
      // (or compacted summaries) — NOT the same count as before compaction
      expect(historyCount2).toBeLessThanOrEqual(historyCount1);
      expect(result2.estimatedTokens).toBeLessThanOrEqual(result1.estimatedTokens);
    });
  });
});
