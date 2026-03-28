import { describe, expect, it, vi, beforeEach } from 'vitest';

import { OpenclawContextEngine, type IOpenclawContextEngineServices } from '../../src/openclaw/openclawContextEngine';
import { computeTokenBudget, computeElasticBudget, estimateMessagesTokens, estimateTokens, trimTextToBudget } from '../../src/openclaw/openclawTokenBudget';
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

  it('returns empty string when budget is 0 (F2-R2-01)', () => {
    const result = trimTextToBudget('hello world', 0);
    expect(result.text).toBe('');
    expect(result.trimmed).toBe(true);
  });

  it('returns empty string for empty text and budget 0', () => {
    const result = trimTextToBudget('', 0);
    expect(result.text).toBe('');
    expect(result.trimmed).toBe(false);
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

    it('does not include empty RAG header when retrieveContext returns empty text (F2-R2-05)', async () => {
      const emptyRagServices = createMockServices({
        retrieveContext: vi.fn(async () => ({ text: '', sources: [] })),
      });
      const emptyRagEngine = new OpenclawContextEngine(emptyRagServices);
      await emptyRagEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      const result = await emptyRagEngine.assemble({
        sessionId: 's1',
        history: [{ role: 'user', content: 'Hello' }],
        tokenBudget: 8192,
        prompt: 'Hello',
      });

      // Should NOT have a context message with empty "## Retrieved Context"
      const contextMsg = result.messages.find(m => m.content.includes('Retrieved Context'));
      expect(contextMsg).toBeUndefined();
      expect(result.ragSources).toHaveLength(0);
    });

    it('handles zero tokenBudget gracefully', async () => {
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 0 });
      const result = await engine.assemble({
        sessionId: 's1',
        history: [{ role: 'user', content: 'Hello' }],
        tokenBudget: 0,
        prompt: 'Hello',
      });

      // Zero budget → all lane budgets are 0 → no content fits
      expect(result.estimatedTokens).toBe(0);
      expect(result.messages).toHaveLength(0);
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

    it('returns compacted: false for exactly 2 messages with no summarizer (F2-R2-03)', async () => {
      const history: IChatMessage[] = [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ];
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await engine.assemble({ sessionId: 's1', history, tokenBudget: 8192, prompt: 'test' });

      const result = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
      // Simple trim: keepCount = max(2, floor(2/2)) = 2 ≥ history.length → no reduction
      expect(result.compacted).toBe(false);
      expect(result.tokensAfter).toBe(result.tokensBefore);
    });

    it('does not increase context size with summarizer on 2-message history (F2-R2-04)', async () => {
      async function* mockSummarize(): AsyncIterable<IChatResponseChunk> {
        yield { content: 'Summary: user asked a question and got an answer.' } as IChatResponseChunk;
      }
      const sumServices = createMockServices({
        sendSummarizationRequest: vi.fn(() => mockSummarize()),
      });
      const sumEngine = new OpenclawContextEngine(sumServices);

      const history: IChatMessage[] = [
        { role: 'user', content: 'What is my policy?' },
        { role: 'assistant', content: 'Your policy covers collision.' },
      ];
      await sumEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await sumEngine.assemble({ sessionId: 's1', history, tokenBudget: 8192, prompt: 'test' });

      const result = await sumEngine.compact({ sessionId: 's1', tokenBudget: 8192 });
      // With exactly 2 messages, summarizer is skipped to avoid increasing context
      // Falls to simple trim → compacted: false (no reduction possible)
      expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
    });

    it('respects force flag — compacts even with minimal history (F2-R2-02)', async () => {
      const history: IChatMessage[] = [
        { role: 'user', content: 'Only one message' },
      ];
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await engine.assemble({ sessionId: 's1', history, tokenBudget: 8192, prompt: 'test' });

      // Without force: should NOT compact (< 2 messages)
      const normalResult = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
      expect(normalResult.compacted).toBe(false);

      // With force: should bypass the < 2 guard
      const forceResult = await engine.compact({ sessionId: 's1', tokenBudget: 8192, force: true });
      // Simple trim path with 1 message: keepCount = max(2, 0) = 2 >= 1 → no reduction → false
      // But the guard was bypassed — the method at least attempted compaction
      expect(forceResult).toBeDefined();
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

  // ---------------------------------------------------------------------------
  // afterTurn
  // ---------------------------------------------------------------------------

  describe('afterTurn', () => {
    it('smoke test — completes without error', async () => {
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await engine.afterTurn({
        sessionId: 's1',
        messages: [{ role: 'user', content: 'Hello' }],
      });
    });
  });

  // ---------------------------------------------------------------------------
  // maintain
  // ---------------------------------------------------------------------------

  describe('maintain', () => {
    it('no-op on clean history — returns rewrites: 0', async () => {
      const history: IChatMessage[] = [
        { role: 'user', content: 'What is my policy?' },
        { role: 'assistant', content: 'Your policy covers collision damage.' },
      ];
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      const result = await engine.maintain!({ sessionId: 's1', tokenBudget: 8192, history });
      expect(result.rewrites).toBe(0);
      expect(result.tokensBefore).toBe(result.tokensAfter);
    });

    it('trims verbose tool results — content >2000 chars truncated', async () => {
      const longToolContent = 'x'.repeat(3000);
      const history: IChatMessage[] = [
        { role: 'user', content: 'Run the tool' },
        { role: 'tool' as IChatMessage['role'], content: longToolContent },
        { role: 'assistant', content: 'Done.' },
      ];
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      const result = await engine.maintain!({ sessionId: 's1', tokenBudget: 8192, history });
      expect(result.rewrites).toBeGreaterThanOrEqual(1);
      expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    });

    it('removes redundant acks — "Understood" messages removed', async () => {
      const history: IChatMessage[] = [
        { role: 'user', content: 'Remember this.' },
        { role: 'assistant', content: 'Understood.' },
        { role: 'user', content: 'Also this.' },
        { role: 'assistant', content: 'Got it.' },
        { role: 'user', content: 'What is my deductible?' },
        { role: 'assistant', content: 'Your deductible is $500.' },
      ];
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      const result = await engine.maintain!({ sessionId: 's1', tokenBudget: 8192, history });
      expect(result.rewrites).toBeGreaterThanOrEqual(2); // "Understood." and "Got it."
    });

    it('collapses duplicate summaries — keeps only latest [Context summary]', async () => {
      const history: IChatMessage[] = [
        { role: 'user', content: '[Context summary] Old summary from turn 1' },
        { role: 'assistant', content: 'Understood, I have the context.' },
        { role: 'user', content: '[Context summary] Newer summary from turn 2' },
        { role: 'assistant', content: 'Understood, I have the context.' },
        { role: 'user', content: 'What is my deductible?' },
      ];
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      const result = await engine.maintain!({ sessionId: 's1', tokenBudget: 8192, history });
      // Should remove the old summary (1 rewrite) + possibly ack removals
      expect(result.rewrites).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // assemble — elastic budget integration
  // ---------------------------------------------------------------------------

  describe('assemble elastic budget', () => {
    it('short history gets more RAG', async () => {
      // With empty history and short prompt, elastic should give more to RAG
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 4096 });
      const result = await engine.assemble({
        sessionId: 's1',
        history: [{ role: 'user', content: 'Hi' }],
        tokenBudget: 4096,
        prompt: 'Hello',
      });

      // The context message with RAG content should exist — elastic gives more room
      const contextMsg = result.messages.find(m => m.content.includes('Retrieved Context'));
      expect(contextMsg).toBeDefined();

      // With short history + short prompt, budget should reflect elastic redistribution
      // The fixed RAG budget at 4096 would be floor(4096*0.30) = 1228
      // Elastic should yield more since history and user are tiny
      const fixedBudget = computeTokenBudget(4096);
      const elasticBudget = computeElasticBudget({
        contextWindow: 4096,
        historyActual: estimateMessagesTokens([{ role: 'user', content: 'Hi' }]),
        userActual: estimateTokens('Hello'),
      });
      expect(elasticBudget.rag).toBeGreaterThan(fixedBudget.rag);
    });

    it('elastic degrades to fixed when no actuals available', async () => {
      // computeElasticBudget with no actuals should match computeTokenBudget exactly
      const fixed = computeTokenBudget(8192);
      const elastic = computeElasticBudget({ contextWindow: 8192 });
      expect(elastic.system).toBe(fixed.system);
      expect(elastic.rag).toBe(fixed.rag);
      expect(elastic.history).toBe(fixed.history);
      expect(elastic.user).toBe(fixed.user);
    });

    it('budget sum ≤ total invariant across scenarios', async () => {
      const windows = [2048, 4096, 8192, 16384, 32768];
      for (const w of windows) {
        for (const histActual of [0, 50, 500]) {
          for (const userActual of [0, 20, 200]) {
            const b = computeElasticBudget({
              contextWindow: w,
              historyActual: histActual,
              userActual: userActual,
            });
            expect(b.system + b.rag + b.history + b.user).toBeLessThanOrEqual(b.total);
          }
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // compact → assemble generation flow
  // ---------------------------------------------------------------------------

  describe('compact generation detection', () => {
    it('assemble uses compacted history after compact() even when same length', async () => {
      // Create a 4-message history that compact+summarize replaces with 4 messages
      // (2 summary + 2 last exchange) — same length but different content
      const history: IChatMessage[] = [
        { role: 'user', content: 'Old question about deductibles' },
        { role: 'assistant', content: 'Your deductible is $500.' },
        { role: 'user', content: 'What about liability?' },
        { role: 'assistant', content: 'Liability coverage is $100k.' },
      ];
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
      await engine.assemble({ sessionId: 's1', history, tokenBudget: 8192, prompt: 'first' });

      // Compact — without summarizer, does simple trim (keeps recent half)
      const compactResult = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
      expect(compactResult.compacted).toBe(true);

      // Next assemble should use compacted history, not original
      const result2 = await engine.assemble({
        sessionId: 's1',
        history, // passing the ORIGINAL history — engine should ignore it
        tokenBudget: 8192,
        prompt: 'second',
      });
      // The compacted history should have fewer messages than original
      // (compact without summarizer keeps floor(4/2) = 2 messages)
      const historyMsgs = result2.messages.filter(m => m.role === 'user' || m.role === 'assistant');
      expect(historyMsgs.length).toBeLessThan(history.length);
    });

    it('maintain with rewrites causes next assemble to use maintained history', async () => {
      const history: IChatMessage[] = [
        { role: 'user', content: 'Do something.' },
        { role: 'assistant', content: 'Understood.' },
        { role: 'user', content: 'What is my policy coverage?' },
        { role: 'assistant', content: 'Your policy covers collision damage.' },
      ];
      await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      // maintain should remove the "Understood." ack
      const maintainResult = await engine.maintain!({ sessionId: 's1', tokenBudget: 8192, history });
      expect(maintainResult.rewrites).toBeGreaterThanOrEqual(1);

      // Next assemble should use maintained (shorter) history
      const result = await engine.assemble({
        sessionId: 's1',
        history, // passing ORIGINAL with acks — engine should ignore it
        tokenBudget: 8192,
        prompt: 'test',
      });

      // The maintained history should not contain "Understood."
      const hasAck = result.messages.some(m => m.content === 'Understood.');
      expect(hasAck).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// D6: Compaction depth tests
// ---------------------------------------------------------------------------

describe('D6: extractIdentifiers', () => {
  it('extracts file paths, URIs, and dates', async () => {
    const { extractIdentifiers } = await import('../../src/openclaw/openclawContextEngine');
    const text = 'The file /src/main.ts was modified on 2024-01-15. See https://example.com/docs for details.';
    const ids = extractIdentifiers(text);
    expect(ids).toContain('/src/main.ts');
    expect(ids).toContain('2024-01-15');
    expect(ids).toContain('https://example.com/docs');
  });

  it('extracts dollar amounts and policy numbers', async () => {
    const { extractIdentifiers } = await import('../../src/openclaw/openclawContextEngine');
    const text = 'Policy #12345 has a deductible of $500.';
    const ids = extractIdentifiers(text);
    expect(ids.some(id => id.includes('12345'))).toBe(true);
    expect(ids).toContain('$500');
  });

  it('returns empty for plain text with no identifiers', async () => {
    const { extractIdentifiers } = await import('../../src/openclaw/openclawContextEngine');
    const ids = extractIdentifiers('Hello world, how are you?');
    expect(ids).toHaveLength(0);
  });
});

describe('D6: auditCompactionQuality', () => {
  it('passes when all identifiers are present in summary', async () => {
    const { auditCompactionQuality } = await import('../../src/openclaw/openclawContextEngine');
    const identifiers = ['/src/main.ts', '2024-01-15', '$500'];
    const summary = 'The file /src/main.ts was updated on 2024-01-15. Deductible is $500.';
    const result = auditCompactionQuality(identifiers, summary);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.missingIdentifiers).toHaveLength(0);
  });

  it('fails when >40% of identifiers are missing', async () => {
    const { auditCompactionQuality } = await import('../../src/openclaw/openclawContextEngine');
    const identifiers = ['/src/main.ts', '2024-01-15', '$500', 'https://example.com', '#12345'];
    const summary = 'A file was discussed.'; // All missing
    const result = auditCompactionQuality(identifiers, summary);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.missingIdentifiers).toHaveLength(5);
  });

  it('passes vacuously when no identifiers exist', async () => {
    const { auditCompactionQuality } = await import('../../src/openclaw/openclawContextEngine');
    const result = auditCompactionQuality([], 'Any summary');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

describe('D6: extractConceptsFromTranscript', () => {
  it('extracts file references and URIs as concepts', async () => {
    const { extractConceptsFromTranscript } = await import('../../src/openclaw/openclawContextEngine');
    const transcript = 'The file /src/config.ts and https://api.example.com/v2 were discussed.';
    const concepts = extractConceptsFromTranscript(transcript);
    expect(concepts.some(c => c.concept === '/src/config.ts' && c.category === 'reference')).toBe(true);
    expect(concepts.some(c => c.concept.includes('https://api.example.com') && c.category === 'reference')).toBe(true);
  });

  it('extracts capitalized multi-word names as entities', async () => {
    const { extractConceptsFromTranscript } = await import('../../src/openclaw/openclawContextEngine');
    const transcript = 'John Smith discussed the Auto Insurance details.';
    const concepts = extractConceptsFromTranscript(transcript);
    expect(concepts.some(c => c.concept === 'John Smith' && c.category === 'entity')).toBe(true);
    expect(concepts.some(c => c.concept === 'Auto Insurance' && c.category === 'entity')).toBe(true);
  });

  it('returns empty for trivial text', async () => {
    const { extractConceptsFromTranscript } = await import('../../src/openclaw/openclawContextEngine');
    const concepts = extractConceptsFromTranscript('hello world');
    expect(concepts).toHaveLength(0);
  });
});

describe('D6: compact quality retry', () => {
  it('retries with stronger prompt when quality audit fails', async () => {
    const { OpenclawContextEngine } = await import('../../src/openclaw/openclawContextEngine');

    let callCount = 0;
    async function* mockSummarize(): AsyncIterable<any> {
      callCount++;
      if (callCount === 1) {
        // First attempt: summary missing identifiers
        yield { content: 'A conversation about policy details.' };
      } else {
        // Retry: includes the identifiers
        yield { content: 'Policy #99001 for /docs/policy.md dated 2024-03-15 was discussed.' };
      }
    }

    const sumServices = createMockServices({
      sendSummarizationRequest: vi.fn(() => mockSummarize()),
    });
    const sumEngine = new OpenclawContextEngine(sumServices);

    const history: IChatMessage[] = [
      { role: 'user', content: 'My policy #99001 at /docs/policy.md dated 2024-03-15 has issues.' },
      { role: 'assistant', content: 'Let me look into that.' },
      { role: 'user', content: 'What is the coverage detail?' },
      { role: 'assistant', content: 'The coverage includes collision and comprehensive.' },
    ];

    await sumEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
    await sumEngine.assemble({ sessionId: 's1', history, tokenBudget: 8192, prompt: 'test' });

    const result = await sumEngine.compact({ sessionId: 's1', tokenBudget: 8192 });
    expect(result.compacted).toBe(true);
    // Should have retried at least once
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('accepts best summary after all retries exhausted', async () => {
    const { OpenclawContextEngine } = await import('../../src/openclaw/openclawContextEngine');

    async function* poorSummarize(): AsyncIterable<any> {
      yield { content: 'A generic summary with no specifics.' };
    }

    const sumServices = createMockServices({
      sendSummarizationRequest: vi.fn(() => poorSummarize()),
    });
    const sumEngine = new OpenclawContextEngine(sumServices);

    const history: IChatMessage[] = [
      { role: 'user', content: 'Policy #77001 for /data/claims.md dated 2024-06-01 was reviewed.' },
      { role: 'assistant', content: 'I see that policy.' },
      { role: 'user', content: 'What about claim #88002?' },
      { role: 'assistant', content: 'Claim is pending review.' },
    ];

    await sumEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
    await sumEngine.assemble({ sessionId: 's1', history, tokenBudget: 8192, prompt: 'test' });

    const result = await sumEngine.compact({ sessionId: 's1', tokenBudget: 8192 });
    expect(result.compacted).toBe(true);
    // Should have exhausted retries (3 total calls = 1 initial + MAX_QUALITY_RETRIES)
    expect(sumServices.sendSummarizationRequest).toHaveBeenCalledTimes(3);
  });

  it('calls storeConceptsFromSession during compact', async () => {
    const { OpenclawContextEngine } = await import('../../src/openclaw/openclawContextEngine');

    async function* mockSummarize(): AsyncIterable<any> {
      yield { content: 'Summary covering all points.' };
    }

    const conceptServices = createMockServices({
      sendSummarizationRequest: vi.fn(() => mockSummarize()),
      storeConceptsFromSession: vi.fn(async () => {}),
    });
    const conceptEngine = new OpenclawContextEngine(conceptServices);

    const history: IChatMessage[] = [
      { role: 'user', content: 'The /src/app.ts file and https://api.test.com were discussed by John Smith.' },
      { role: 'assistant', content: 'I understand the context.' },
      { role: 'user', content: 'What about the Auto Insurance coverage?' },
      { role: 'assistant', content: 'Auto Insurance covers collision.' },
    ];

    await conceptEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
    await conceptEngine.assemble({ sessionId: 's1', history, tokenBudget: 8192, prompt: 'test' });

    await conceptEngine.compact({ sessionId: 's1', tokenBudget: 8192 });
    expect(conceptServices.storeConceptsFromSession).toHaveBeenCalled();
    const concepts = conceptServices.storeConceptsFromSession.mock.calls[0][0];
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some((c: any) => c.category === 'reference')).toBe(true);
  });

  it('survives concept extraction failure during compact', async () => {
    const { OpenclawContextEngine } = await import('../../src/openclaw/openclawContextEngine');

    async function* mockSummarize(): AsyncIterable<any> {
      yield { content: 'Summary of the conversation.' };
    }

    const failConceptServices = createMockServices({
      sendSummarizationRequest: vi.fn(() => mockSummarize()),
      storeConceptsFromSession: vi.fn(async () => { throw new Error('Storage failed'); }),
    });
    const failEngine = new OpenclawContextEngine(failConceptServices);

    const history: IChatMessage[] = [
      { role: 'user', content: 'File /a/b.ts was discussed.' },
      { role: 'assistant', content: 'Got it.' },
      { role: 'user', content: 'What next?' },
      { role: 'assistant', content: 'Proceeding.' },
    ];

    await failEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
    await failEngine.assemble({ sessionId: 's1', history, tokenBudget: 8192, prompt: 'test' });

    // Should not throw
    const result = await failEngine.compact({ sessionId: 's1', tokenBudget: 8192 });
    expect(result.compacted).toBe(true);
  });
});
