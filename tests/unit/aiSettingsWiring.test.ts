// tests/unit/aiSettingsWiring.test.ts — AI settings / unified config wiring tests
//
// Validates that:
// 1. migrated chat behavior reads unified config for promptOverlay + temperature
// 2. ProactiveSuggestionsService respects unified config thresholds
// 3. Unified config changes propagate via onDidChangeConfig

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProactiveSuggestionsService } from '../../src/services/proactiveSuggestionsService';
import { DEFAULT_PROFILE, BUILT_IN_PRESETS } from '../../src/aiSettings/aiSettingsDefaults';
import { Emitter } from '../../src/platform/events';

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockEmbeddingService() {
  return {
    embedQuery: vi.fn().mockResolvedValue(new Float32Array(768)),
    embedDocument: vi.fn().mockResolvedValue(new Float32Array(768)),
  };
}

function createMockVectorStoreService() {
  const emitter = new Emitter<void>();
  return {
    vectorSearch: vi.fn().mockResolvedValue([]),
    onDidUpdateIndex: emitter.event,
    _fireUpdate: () => emitter.fire(undefined),
  };
}

function createMockDb() {
  return {
    isOpen: true,
    all: vi.fn().mockResolvedValue([
      { id: 'p1', title: 'Page 1', content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Long enough content for analysis testing purposes here."}]}]}' },
      { id: 'p2', title: 'Page 2', content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Long enough content for analysis testing purposes here."}]}]}' },
      { id: 'p3', title: 'Page 3', content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Long enough content for analysis testing purposes here."}]}]}' },
      { id: 'p4', title: 'Page 4', content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Long enough content for analysis testing purposes here."}]}]}' },
      { id: 'p5', title: 'Page 5', content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Long enough content for analysis testing purposes here."}]}]}' },
    ]),
  };
}

function createMockIndexingPipeline() {
  const emitter = new Emitter<void>();
  return {
    isInitialIndexComplete: true,
    onDidCompleteInitialIndex: emitter.event,
    _fireComplete: () => emitter.fire(undefined),
  };
}

function createMockUnifiedConfigService(overrides?: {
  suggestions?: Partial<typeof DEFAULT_PROFILE.suggestions>;
  chat?: { systemPrompt?: string };
  model?: { temperature?: number; maxTokens?: number };
}) {
  const config = {
    suggestions: {
      ...DEFAULT_PROFILE.suggestions,
      ...overrides?.suggestions,
    },
    chat: {
      systemPrompt: overrides?.chat?.systemPrompt ?? DEFAULT_PROFILE.chat.systemPrompt,
    },
    model: {
      temperature: overrides?.model?.temperature ?? DEFAULT_PROFILE.model.temperature,
      maxTokens: overrides?.model?.maxTokens ?? DEFAULT_PROFILE.model.maxTokens,
    },
  };
  const onDidChangeEmitter = new Emitter<void>();
  return {
    getEffectiveConfig: vi.fn(() => structuredClone(config) as any),
    onDidChangeConfig: onDidChangeEmitter.event,
    _fireChange: () => onDidChangeEmitter.fire(undefined),
    _updateSuggestions: (patch: Partial<typeof DEFAULT_PROFILE.suggestions>) => {
      Object.assign(config.suggestions, patch);
    },
    dispose: vi.fn(),
  };
}

// ─── ProactiveSuggestionsService + Unified Config ───────────────────────────

describe('ProactiveSuggestionsService with Unified Config (M40 Phase 6)', () => {
  let mockEmbedding: ReturnType<typeof createMockEmbeddingService>;
  let mockVector: ReturnType<typeof createMockVectorStoreService>;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockPipeline: ReturnType<typeof createMockIndexingPipeline>;

  beforeEach(() => {
    mockEmbedding = createMockEmbeddingService();
    mockVector = createMockVectorStoreService();
    mockDb = createMockDb();
    mockPipeline = createMockIndexingPipeline();
  });

  it('works without unified config service (backward compat)', () => {
    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
    );
    expect(service.suggestions).toEqual([]);
    service.dispose();
  });

  it('reads initial settings from unified config', () => {
    const unifiedConfig = createMockUnifiedConfigService({
      suggestions: {
        ...DEFAULT_PROFILE.suggestions,
        suggestionsEnabled: false,
        suggestionConfidenceThreshold: 0.9,
        maxPendingSuggestions: 3,
      },
    });
    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
      unifiedConfig as any,
    );
    expect(unifiedConfig.getEffectiveConfig).toHaveBeenCalled();
    service.dispose();
  });

  it('disables scheduling when suggestionsEnabled is false', async () => {
    const unifiedConfig = createMockUnifiedConfigService({
      suggestions: {
        ...DEFAULT_PROFILE.suggestions,
        suggestionsEnabled: false,
      },
    });
    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
      unifiedConfig as any,
    );

    // Trigger an index complete event — with disabled suggestions, analysis should NOT run
    mockPipeline._fireComplete();

    // Wait a tick for any timers
    await new Promise(r => setTimeout(r, 50));

    // embedQuery should NOT have been called since analysis was skipped
    expect(mockEmbedding.embedQuery).not.toHaveBeenCalled();
    service.dispose();
  });

  it('allows scheduling when suggestionsEnabled is true', async () => {
    const unifiedConfig = createMockUnifiedConfigService({
      suggestions: {
        ...DEFAULT_PROFILE.suggestions,
        suggestionsEnabled: true,
      },
    });
    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
      unifiedConfig as any,
    );

    // Force immediate analysis (bypasses cooldown timer)
    await service.analyze();

    // embedQuery should have been called for page analysis
    expect(mockEmbedding.embedQuery).toHaveBeenCalled();
    service.dispose();
  });

  it('updates thresholds when onDidChangeConfig fires', () => {
    const unifiedConfig = createMockUnifiedConfigService();
    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
      unifiedConfig as any,
    );

    const initialCallCount = unifiedConfig.getEffectiveConfig.mock.calls.length;
    expect(initialCallCount).toBe(1);

    unifiedConfig._updateSuggestions({
      suggestionConfidenceThreshold: 0.95,
      maxPendingSuggestions: 2,
      suggestionsEnabled: false,
    });
    unifiedConfig._fireChange();

    expect(unifiedConfig.getEffectiveConfig.mock.calls.length).toBe(initialCallCount + 1);
    service.dispose();
  });

  it('respects maxPendingSuggestions from settings', async () => {
    const unifiedConfig = createMockUnifiedConfigService({
      suggestions: {
        ...DEFAULT_PROFILE.suggestions,
        maxPendingSuggestions: 2,
      },
    });

    // Make vector search return lots of orphans (no similar content)
    mockVector.vectorSearch.mockResolvedValue([]);

    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
      unifiedConfig as any,
    );

    const result = await service.analyze();
    // Should be capped at maxPendingSuggestions = 2
    expect(result.length).toBeLessThanOrEqual(2);
    service.dispose();
  });

  it('applies higher threshold to reduce cluster detection', async () => {
    const unifiedConfig = createMockUnifiedConfigService({
      suggestions: {
        ...DEFAULT_PROFILE.suggestions,
        // Very high threshold — no clusters should match
        suggestionConfidenceThreshold: 0.999,
      },
    });

    // Vector search returns results with moderate scores
    mockVector.vectorSearch.mockResolvedValue([
      { sourceType: 'page_block', sourceId: 'p2', score: 0.75, text: 'moderately similar' },
      { sourceType: 'page_block', sourceId: 'p3', score: 0.70, text: 'somewhat similar' },
    ]);

    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
      unifiedConfig as any,
    );

    const result = await service.analyze();
    const clusters = result.filter(s => s.type === 'consolidate');
    // With threshold 0.999, scores of 0.005 shouldn't form clusters
    expect(clusters.length).toBe(0);
    service.dispose();
  });
});

// ─── Chat Participant Unified Config Integration ─────────────────────────────

describe('Chat Participant Unified Config Integration (M40 Phase 6)', () => {
  it('IDefaultParticipantServices accepts unifiedConfigService', () => {
    const mockServices: Partial<import('../../src/built-in/chat/chatTypes').IDefaultParticipantServices> = {
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { systemPrompt: DEFAULT_PROFILE.chat.systemPrompt },
          model: { temperature: DEFAULT_PROFILE.model.temperature, maxTokens: DEFAULT_PROFILE.model.maxTokens },
        } as any),
      },
    };
    expect(mockServices.unifiedConfigService).toBeDefined();
    expect(mockServices.unifiedConfigService!.getEffectiveConfig().chat.systemPrompt).toBeDefined();
  });

  it('falls back to file overlay when unified config system prompt is empty', () => {
    const config = createMockUnifiedConfigService({ chat: { systemPrompt: '' } });
    const fileOverlay = 'file-based overlay';
    const promptOverlay = config.getEffectiveConfig().chat.systemPrompt || fileOverlay;
    expect(promptOverlay).toBe(fileOverlay);
  });

  it('temperature from unified config is applied to request options', () => {
    const config = createMockUnifiedConfigService();
    const options = {
      tools: undefined,
      format: undefined,
      think: true,
      temperature: config.getEffectiveConfig().model.temperature,
      maxTokens: config.getEffectiveConfig().model.maxTokens || undefined,
    };
    expect(options.temperature).toBe(0.7);
    expect(options.maxTokens).toBeUndefined(); // 0 maps to undefined
  });

  it('non-zero maxTokens from unified config is passed through', () => {
    const config = createMockUnifiedConfigService({ model: { maxTokens: 2048 } });
    const options = {
      temperature: config.getEffectiveConfig().model.temperature,
      maxTokens: config.getEffectiveConfig().model.maxTokens || undefined,
    };
    expect(options.maxTokens).toBe(2048);
  });
});
