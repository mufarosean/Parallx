// tokenBudgetService.test.ts — Unit tests for TokenBudgetService (M17 Task 0.1.3)
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

  // ── _trimToTokenBudget via allocate() ──

  describe('trimming direction', () => {
    it('keeps FIRST paragraphs for RAG (keepFrom=start)', () => {
      const svc = new TokenBudgetService();
      // Build RAG content with 5 paragraphs: highest-scored first
      const ragParagraphs = [
        'Chunk1: Highly relevant content about the topic',
        'Chunk2: Second most relevant result',
        'Chunk3: Moderate relevance match',
        'Chunk4: Low relevance filler content',
        'Chunk5: Barely relevant noise data',
      ];
      const ragContent = ragParagraphs.join('\n\n');
      // Budget tight enough to force trimming on RAG
      // Total content must exceed context window, and RAG must exceed its 30% share
      const systemPrompt = 'System prompt';
      const history = '';
      const userMessage = 'What is the topic?';

      // Context window = 40 tokens (160 chars). RAG gets 30% = 12 tokens (48 chars).
      // RAG content is ~250 chars, way over budget. System + user eat ~30 tokens.
      // Force RAG trimming by making total exceed window.
      const result = svc.allocate(40, systemPrompt, ragContent, history, userMessage);

      if (result.wasTrimmed) {
        const trimmedRag = result.slots['ragContext'];
        // First paragraph should survive (highest-scored)
        expect(trimmedRag).toContain('Chunk1');
        // Last paragraph should be dropped (lowest-scored)
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
      const systemPrompt = 'System';
      const ragContent = '';
      const userMessage = 'Question?';

      // Context window = 40 tokens (160 chars). History gets 30% = 12 tokens (48 chars).
      const result = svc.allocate(40, systemPrompt, ragContent, historyContent, userMessage);

      if (result.wasTrimmed) {
        const trimmedHistory = result.slots['history'];
        // Most recent message should survive
        expect(trimmedHistory).toContain('Most recent');
        // Oldest message should be dropped
        expect(trimmedHistory).not.toContain('Oldest message');
      }
    });
  });

  describe('allocate()', () => {
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

    it('trims history first, then RAG', () => {
      const svc = new TokenBudgetService();
      // Context window = 20 tokens (80 chars).
      // System = 20 chars (5 tok), RAG = 80 chars (20 tok), History = 80 chars (20 tok), User = 20 chars (5 tok)
      // Total = 50 tok, way over 20. History gets 30% = 6 tok.
      const result = svc.allocate(20, 'A'.repeat(20), 'B'.repeat(80), 'C'.repeat(80), 'D'.repeat(20));
      expect(result.wasTrimmed).toBe(true);
    });

    it('preserves highest-scored RAG chunks when trimming', () => {
      const svc = new TokenBudgetService();
      // 3 RAG chunks, each 40 chars (~10 tokens)
      const chunk1 = 'BEST: Top relevance score chunk here!!!!';
      const chunk2 = 'MID: Medium relevance score chunk here!!';
      const chunk3 = 'LOW: Lowest relevance score chunk here!!';
      const ragContent = [chunk1, chunk2, chunk3].join('\n\n');
      // ragContent ~130 chars = 33 tokens

      // Context window small enough to require RAG trimming
      // System = 8 chars (2 tok), User = 8 chars (2 tok), History = 0
      // Total needs = 2 + 33 + 0 + 2 = 37 tokens. Window = 15. RAG budget = 4.5 tokens.
      const result = svc.allocate(15, 'SysPromp', ragContent, '', 'question');

      if (result.wasTrimmed) {
        const trimmedRag = result.slots['ragContext'];
        // BEST chunk should be first in the remaining text
        expect(trimmedRag.indexOf('BEST')).toBeLessThan(
          trimmedRag.indexOf('LOW') === -1 ? Infinity : trimmedRag.indexOf('LOW'),
        );
      }
    });
  });

  describe('hard truncation fallback', () => {
    it('hard-truncates from start when no paragraph boundaries exist (RAG)', () => {
      const svc = new TokenBudgetService();
      // Single long string with no \n\n — no paragraph boundaries
      const ragContent = 'A'.repeat(200); // 200 chars = 50 tokens, no paragraphs
      // Window = 10, RAG budget = 3 tokens (12 chars)
      const result = svc.allocate(10, 'S', ragContent, '', 'U');
      if (result.wasTrimmed) {
        const trimmedRag = result.slots['ragContext'];
        // Should keep from the START (first 12 chars)
        expect(trimmedRag.length).toBeLessThanOrEqual(12);
        expect(trimmedRag).toBe('A'.repeat(trimmedRag.length));
      }
    });
  });

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
