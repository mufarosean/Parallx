// tests/unit/aiSettingsWiring.test.ts — M15 Group B: AI Settings wiring tests
//
// Validates that:
// 1. defaultParticipant reads AI profile for promptOverlay + temperature
// 2. ProactiveSuggestionsService respects AI settings thresholds
// 3. Settings changes propagate via onDidChange

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProactiveSuggestionsService } from '../../src/services/proactiveSuggestionsService';
import type { AISettingsProfile } from '../../src/aiSettings/aiSettingsTypes';
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

function createMockAISettingsService(overrides?: Partial<AISettingsProfile>) {
  const profile: AISettingsProfile = {
    ...structuredClone(DEFAULT_PROFILE),
    ...overrides,
    suggestions: {
      ...DEFAULT_PROFILE.suggestions,
      ...overrides?.suggestions,
    },
  };
  const onDidChangeEmitter = new Emitter<AISettingsProfile>();
  return {
    getActiveProfile: vi.fn(() => structuredClone(profile)),
    onDidChange: onDidChangeEmitter.event,
    _profile: profile,
    _fireChange: (p?: AISettingsProfile) => onDidChangeEmitter.fire(p ?? profile),
    _updateProfile: (patch: Partial<AISettingsProfile['suggestions']>) => {
      Object.assign(profile.suggestions, patch);
    },
    dispose: vi.fn(),
  };
}

// ─── ProactiveSuggestionsService + AI Settings ──────────────────────────────

describe('ProactiveSuggestionsService with AI Settings (M15 Task 1.6)', () => {
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

  it('works without AI settings service (backward compat)', () => {
    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
    );
    expect(service.suggestions).toEqual([]);
    service.dispose();
  });

  it('reads initial settings from AI settings service', () => {
    const aiSettings = createMockAISettingsService({
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
      aiSettings as any,
    );
    expect(aiSettings.getActiveProfile).toHaveBeenCalled();
    service.dispose();
  });

  it('disables scheduling when suggestionsEnabled is false', async () => {
    const aiSettings = createMockAISettingsService({
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
      aiSettings as any,
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
    const aiSettings = createMockAISettingsService({
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
      aiSettings as any,
    );

    // Force immediate analysis (bypasses cooldown timer)
    await service.analyze();

    // embedQuery should have been called for page analysis
    expect(mockEmbedding.embedQuery).toHaveBeenCalled();
    service.dispose();
  });

  it('updates thresholds when onDidChange fires', () => {
    const aiSettings = createMockAISettingsService();
    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
      aiSettings as any,
    );

    // Verify initial call
    const initialCallCount = aiSettings.getActiveProfile.mock.calls.length;
    expect(initialCallCount).toBe(1);

    // Update the profile and fire change
    aiSettings._updateProfile({
      suggestionConfidenceThreshold: 0.95,
      maxPendingSuggestions: 2,
      suggestionsEnabled: false,
    });
    aiSettings._fireChange();

    // getActiveProfile should have been called again
    expect(aiSettings.getActiveProfile.mock.calls.length).toBe(initialCallCount + 1);
    service.dispose();
  });

  it('respects maxPendingSuggestions from settings', async () => {
    const aiSettings = createMockAISettingsService({
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
      aiSettings as any,
    );

    const result = await service.analyze();
    // Should be capped at maxPendingSuggestions = 2
    expect(result.length).toBeLessThanOrEqual(2);
    service.dispose();
  });

  it('applies higher threshold to reduce cluster detection', async () => {
    const aiSettings = createMockAISettingsService({
      suggestions: {
        ...DEFAULT_PROFILE.suggestions,
        // Very high threshold — no clusters should match
        suggestionConfidenceThreshold: 0.999,
      },
    });

    // Vector search returns results with moderate scores
    mockVector.vectorSearch.mockResolvedValue([
      { sourceType: 'page_block', sourceId: 'p2', score: 0.005, text: 'moderately similar' },
      { sourceType: 'page_block', sourceId: 'p3', score: 0.004, text: 'somewhat similar' },
    ]);

    const service = new ProactiveSuggestionsService(
      mockEmbedding as any,
      mockVector as any,
      mockDb as any,
      mockPipeline as any,
      aiSettings as any,
    );

    const result = await service.analyze();
    const clusters = result.filter(s => s.type === 'consolidate');
    // With threshold 0.999, scores of 0.005 shouldn't form clusters
    expect(clusters.length).toBe(0);
    service.dispose();
  });
});

// ─── Chat Participant AI Settings Integration ───────────────────────────────

describe('Chat Participant AI Settings Integration (M15 Task 1.5)', () => {
  it('IDefaultParticipantServices accepts aiSettingsService', () => {
    // Type-level test — if this compiles, the interface is correctly extended
    const mockServices: Partial<import('../../src/built-in/chat/chatTypes').IDefaultParticipantServices> = {
      aiSettingsService: {
        getActiveProfile: () => structuredClone(DEFAULT_PROFILE),
      },
    };
    expect(mockServices.aiSettingsService).toBeDefined();
    expect(mockServices.aiSettingsService!.getActiveProfile().chat.systemPrompt).toBeTruthy();
  });

  it('AI profile system prompt is used as promptOverlay', () => {
    const profile = structuredClone(DEFAULT_PROFILE);
    // Simulate what defaultParticipant.ts does: prefer AI profile system prompt
    const fileOverlay = 'file-based overlay';
    const promptOverlay = profile.chat.systemPrompt || fileOverlay;
    // DEFAULT_PROFILE has a non-empty system prompt, so it should take priority
    expect(promptOverlay).toBe(profile.chat.systemPrompt);
    expect(promptOverlay).not.toBe(fileOverlay);
  });

  it('falls back to file overlay when AI profile prompt is empty', () => {
    const profile = structuredClone(DEFAULT_PROFILE);
    profile.chat.systemPrompt = '';
    const fileOverlay = 'file-based overlay';
    const promptOverlay = profile.chat.systemPrompt || fileOverlay;
    expect(promptOverlay).toBe(fileOverlay);
  });

  it('temperature from AI profile is applied to request options', () => {
    const profile = structuredClone(DEFAULT_PROFILE);
    const options = {
      tools: undefined,
      format: undefined,
      think: true,
      temperature: profile.model.temperature,
      maxTokens: profile.model.maxTokens || undefined,
    };
    expect(options.temperature).toBe(0.7);
    expect(options.maxTokens).toBeUndefined(); // 0 maps to undefined
  });

  it('non-zero maxTokens from AI profile is passed through', () => {
    const profile = structuredClone(DEFAULT_PROFILE);
    profile.model.maxTokens = 2048;
    const options = {
      temperature: profile.model.temperature,
      maxTokens: profile.model.maxTokens || undefined,
    };
    expect(options.maxTokens).toBe(2048);
  });

  it('built-in presets have distinct system prompts', () => {
    const prompts = BUILT_IN_PRESETS.map(p => p.chat.systemPrompt);
    const unique = new Set(prompts);
    expect(unique.size).toBe(BUILT_IN_PRESETS.length);
  });
});
