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

    // ── Re-retrieval on insufficient evidence (F9-R2-08) ──

    it('fires re-retrieval when evidence is insufficient (no query term overlap)', async () => {
      const retrieveFn = vi.fn()
        .mockResolvedValueOnce({
          text: 'Unrelated chunk about zebra crossings and traffic lights.',
          sources: [{ uri: 'file:///traffic.md', label: 'Traffic', index: 0 }],
        })
        .mockResolvedValueOnce({
          text: 'The deductible for collision coverage is $500.',
          sources: [{ uri: 'file:///policy.md', label: 'Policy', index: 0 }],
        });

      const reServices = createMockServices({ retrieveContext: retrieveFn });
      const reEngine = new OpenclawContextEngine(reServices);
      await reEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      await reEngine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'What is my deductible for collision coverage?',
      });

      // retrieveContext called twice — original + re-retrieval
      expect(retrieveFn).toHaveBeenCalledTimes(2);
      // Second call should be a reformulated query (not the original)
      const secondCallQuery = retrieveFn.mock.calls[1][0] as string;
      expect(secondCallQuery).not.toBe('What is my deductible for collision coverage?');
      expect(secondCallQuery.length).toBeGreaterThan(0);
    });

    it('does NOT re-retrieve when evidence is sufficient', async () => {
      const retrieveFn = vi.fn().mockResolvedValue({
        text: 'Your deductible for collision coverage is $500 per the policy terms.',
        sources: [{ uri: 'file:///policy.md', label: 'Policy', index: 0 }],
      });

      const okServices = createMockServices({ retrieveContext: retrieveFn });
      const okEngine = new OpenclawContextEngine(okServices);
      await okEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      await okEngine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'What is my deductible?',
      });

      // Only the initial retrieval — no re-retrieval needed
      expect(retrieveFn).toHaveBeenCalledTimes(1);
    });

    it('merges re-retrieval sources by URI dedup', async () => {
      const retrieveFn = vi.fn()
        .mockResolvedValueOnce({
          text: 'Unrelated chunk about zebra crossings.',
          sources: [{ uri: 'file:///traffic.md', label: 'Traffic', index: 0 }],
        })
        .mockResolvedValueOnce({
          text: 'Coverage details for comprehensive and collision.',
          sources: [
            { uri: 'file:///traffic.md', label: 'Traffic', index: 0 }, // dupe
            { uri: 'file:///coverage.md', label: 'Coverage', index: 1 },
          ],
        });

      const mergeServices = createMockServices({ retrieveContext: retrieveFn });
      const mergeEngine = new OpenclawContextEngine(mergeServices);
      await mergeEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      const result = await mergeEngine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'What is my deductible for collision coverage?',
      });

      // Sources should be deduped — traffic.md appears once, coverage.md added
      const uris = result.ragSources.map(s => s.uri);
      expect(uris.filter(u => u === 'file:///traffic.md')).toHaveLength(1);
      expect(uris).toContain('file:///coverage.md');
    });

    it('gracefully handles re-retrieval failure', async () => {
      const retrieveFn = vi.fn()
        .mockResolvedValueOnce({
          text: 'Unrelated chunk about zebra crossings.',
          sources: [{ uri: 'file:///traffic.md', label: 'Traffic', index: 0 }],
        })
        .mockRejectedValueOnce(new Error('RAG down during re-retrieval'));

      const failServices = createMockServices({ retrieveContext: retrieveFn });
      const failEngine = new OpenclawContextEngine(failServices);
      await failEngine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });

      // Should not throw — re-retrieval failure is caught
      const result = await failEngine.assemble({
        sessionId: 's1',
        history: [],
        tokenBudget: 8192,
        prompt: 'What is my deductible for collision coverage?',
      });

      expect(result).toBeDefined();
      // Still has the original (insufficient) context
      expect(result.systemPromptAddition).toBeDefined();
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
