// tokenBudgetService.test.ts — Unit tests for TokenBudgetService (M17 Task 0.1.3, M20 Phase G)
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { TokenBudgetService } from '../../src/services/tokenBudgetService';

describe('TokenBudgetService', () => {
  // ── estimateTokens ──

  it('estimates tokens as chars/4', () => {
    const svc = new TokenBudgetService();
    expect(svc.estimateTokens('1234')).toBe(1);
    expect(svc.estimateTokens('12345')).toBe(2); // ceil(5/4)
    expect(svc.estimateTokens('')).toBe(0);
  });

  // ── Elastic allocation ──

  describe('elastic allocate()', () => {
    it('returns untrimmed content when under budget', () => {
      const svc = new TokenBudgetService();
      const result = svc.allocate(10000, 'sys', 'rag', 'hist', 'user');
      expect(result.wasTrimmed).toBe(false);
      expect(result.slots['systemPrompt']).toBe('sys');
      expect(result.slots['ragContext']).toBe('rag');
      expect(result.slots['history']).toBe('hist');
      expect(result.slots['userMessage']).toBe('user');
    });

    it('returns untrimmed content when context window is 0 (no limit)', () => {
      const svc = new TokenBudgetService();
      const longText = 'x'.repeat(100_000);
      const result = svc.allocate(0, longText, longText, longText, longText);
      expect(result.wasTrimmed).toBe(false);
      expect(result.contextWindow).toBe(0);
    });

    it('trims history first (lowest default priority)', () => {
      const svc = new TokenBudgetService();
      // Context window = 20 tokens (80 chars).
      // System = 20 chars (5 tok), RAG = 80 chars (20 tok), History = 80 chars (20 tok), User = 20 chars (5 tok)
      // Total demand = 50 tok, over 20. History (priority 1) trims first.
      const result = svc.allocate(20, 'A'.repeat(20), 'B'.repeat(80), 'C'.repeat(80), 'D'.repeat(20));
      expect(result.wasTrimmed).toBe(true);
      // History should be shorter than original
      expect(result.slots['history'].length).toBeLessThan(80);
    });

    it('trims RAG after history if still over budget', () => {
      const svc = new TokenBudgetService();
      // Window tiny enough that history alone can't fix it
      const result = svc.allocate(10, 'A'.repeat(8), 'B'.repeat(80), 'C'.repeat(80), 'D'.repeat(8));
      expect(result.wasTrimmed).toBe(true);
      // Both history and RAG should be trimmed
      expect(result.slots['history'].length).toBeLessThan(80);
      expect(result.slots['ragContext'].length).toBeLessThan(80);
    });

    it('never trims user message', () => {
      const svc = new TokenBudgetService();
      const userMsg = 'U'.repeat(100);
      // Window is tiny, user message alone exceeds it, but it should be preserved
      const result = svc.allocate(5, 'S', '', '', userMsg);
      expect(result.slots['userMessage']).toBe(userMsg);
    });
  });

  // ── Trim direction ──

  describe('trimming direction', () => {
    it('keeps FIRST paragraphs for RAG (keepFrom=start)', () => {
      const svc = new TokenBudgetService();
      const ragParagraphs = [
        'Chunk1: Highly relevant content about the topic',
        'Chunk2: Second most relevant result',
        'Chunk3: Moderate relevance match',
        'Chunk4: Low relevance filler content',
        'Chunk5: Barely relevant noise data',
      ];
      const ragContent = ragParagraphs.join('\n\n');
      const result = svc.allocate(40, 'System prompt', ragContent, '', 'What is the topic?');

      if (result.wasTrimmed) {
        const trimmedRag = result.slots['ragContext'];
        expect(trimmedRag).toContain('Chunk1');
        expect(trimmedRag).not.toContain('Chunk5');
      }
    });

    it('keeps LAST paragraphs for history (keepFrom=end)', () => {
      const svc = new TokenBudgetService();
      const historyParagraphs = [
        'Oldest message from an hour ago',
        'Second oldest conversation turn',
        'Third message in the conversation',
        'Recent discussion about current work',
        'Most recent message just sent',
      ];
      const historyContent = historyParagraphs.join('\n\n');
      const result = svc.allocate(40, 'System', '', historyContent, 'Question?');

      if (result.wasTrimmed) {
        const trimmedHistory = result.slots['history'];
        expect(trimmedHistory).toContain('Most recent');
        expect(trimmedHistory).not.toContain('Oldest message');
      }
    });
  });

  // ── Elastic config ──

  describe('setElasticConfig()', () => {
    it('overrides default trim priorities', () => {
      const svc = new TokenBudgetService();
      svc.setElasticConfig({
        trimPriority: { systemPrompt: 1, ragContext: 2, history: 3, userMessage: 4 },
        minPercent: { systemPrompt: 0, ragContext: 0, history: 0, userMessage: 0 },
      });
      const cfg = svc.getElasticConfig();
      expect(cfg.trimPriority.systemPrompt).toBe(1);
      expect(cfg.trimPriority.history).toBe(3);
    });

    it('respects minPercent floor during trimming', () => {
      const svc = new TokenBudgetService();
      svc.setElasticConfig({
        trimPriority: { systemPrompt: 3, ragContext: 2, history: 1, userMessage: 4 },
        minPercent: { systemPrompt: 0, ragContext: 0, history: 20, userMessage: 0 },
      });
      // Window = 20 tokens (80 chars). History has 20% floor = 4 tokens (16 chars).
      const result = svc.allocate(20, 'A'.repeat(20), 'B'.repeat(80), 'C'.repeat(80), 'D'.repeat(20));
      expect(result.wasTrimmed).toBe(true);
      // History should keep at least 20% of 20 tokens = 4 tokens = 16 chars
      expect(result.slots['history'].length).toBeGreaterThanOrEqual(16);
    });
  });

  // ── Legacy setConfig() backward compat ──

  describe('setConfig() backward compatibility', () => {
    it('accepts legacy percentage config without errors', () => {
      const svc = new TokenBudgetService();
      expect(() => {
        svc.setConfig({ systemPrompt: 15, ragContext: 25, history: 35, userMessage: 25 });
      }).not.toThrow();
      const cfg = svc.getConfig();
      expect(cfg.systemPrompt).toBe(15);
    });
  });

  // ── Hard truncation fallback ──

  describe('hard truncation fallback', () => {
    it('hard-truncates from start when no paragraph boundaries exist (RAG)', () => {
      const svc = new TokenBudgetService();
      const ragContent = 'A'.repeat(200);
      const result = svc.allocate(10, 'S', ragContent, '', 'U');
      if (result.wasTrimmed) {
        const trimmedRag = result.slots['ragContext'];
        expect(trimmedRag.length).toBeLessThanOrEqual(200);
        expect(trimmedRag).toBe('A'.repeat(trimmedRag.length));
      }
    });
  });

  // ── getBreakdown ──

  describe('getBreakdown()', () => {
    it('returns percentage breakdown', () => {
      const svc = new TokenBudgetService();
      const result = svc.allocate(10000, 'sys', 'rag', 'hist', 'user');
      const breakdown = svc.getBreakdown(result);
      expect(breakdown).toHaveLength(4);
      expect(breakdown[0].name).toBe('System Prompt');
      expect(breakdown.every((b) => b.percentage >= 0)).toBe(true);
    });
  });
});
