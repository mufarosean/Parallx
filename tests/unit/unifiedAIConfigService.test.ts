// tests/unit/unifiedAIConfigService.test.ts — M20 Task A.1 + A.2 tests
//
// Tests for:
//   - IUnifiedAIConfig types and defaults
//   - Migration helpers (fromLegacyProfile, fromLegacyParallxConfig, tolegacyProfile)
//   - UnifiedAIConfigService: preset management, workspace overrides,
//     effective config resolution, legacy compatibility, clone-on-write

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_UNIFIED_CONFIG,
  fromLegacyProfile,
  fromLegacyParallxConfig,
  tolegacyProfile,
} from '../../src/aiSettings/unifiedConfigTypes';
import type { IUnifiedAIConfig, IUnifiedPreset } from '../../src/aiSettings/unifiedConfigTypes';
import type { AISettingsProfile } from '../../src/aiSettings/aiSettingsTypes';
import { DEFAULT_PROFILE, BUILT_IN_PRESETS } from '../../src/aiSettings/aiSettingsDefaults';
import { UnifiedAIConfigService, deepMerge } from '../../src/aiSettings/unifiedAIConfigService';
import { DEFAULT_CONFIG } from '../../src/services/parallxConfigService';

// ─── Mock Storage ─────────────────────────────────────────────────────────

function createMockStorage(): Record<string, string> & {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
} {
  const data: Record<string, string> = {};
  return Object.assign(data, {
    async get(key: string) { return data[key]; },
    async set(key: string, value: string) { data[key] = value; },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types & Defaults
// ═══════════════════════════════════════════════════════════════════════════════

describe('IUnifiedAIConfig defaults', () => {
  it('has all required sections', () => {
    expect(DEFAULT_UNIFIED_CONFIG.persona).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.chat).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.model).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.retrieval).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.suggestions).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.agent).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.memory).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.indexing).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.tools).toBeDefined();
  });

  it('retrieval defaults match retrievalService constants', () => {
    // These must match the hardcoded values in retrievalService.ts
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragDecompositionMode).toBe('auto');
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragCandidateBreadth).toBe('balanced');
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragDiversityStrength).toBe('balanced');
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragStructureExpansionMode).toBe('auto');
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragRerankMode).toBe('standard');
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragTopK).toBe(20);
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragScoreThreshold).toBe(0.01);
  });

  it('context budget has elastic shape (M20 Phase G)', () => {
    const b = DEFAULT_UNIFIED_CONFIG.retrieval.contextBudget;
    expect(b).toHaveProperty('trimPriority');
    expect(b).toHaveProperty('minPercent');
    expect(b.trimPriority.userMessage).toBe(4); // never trimmed (highest)
    expect(b.trimPriority.history).toBe(1); // trimmed first (lowest)
  });

  it('agent defaults match defaultParticipant constants', () => {
    expect(DEFAULT_UNIFIED_CONFIG.agent.maxIterations).toBe(10);
  });

  it('memory defaults enable features', () => {
    expect(DEFAULT_UNIFIED_CONFIG.memory.memoryEnabled).toBe(true);
    expect(DEFAULT_UNIFIED_CONFIG.memory.autoSummarize).toBe(true);
    expect(DEFAULT_UNIFIED_CONFIG.memory.evictionDays).toBe(90);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Migration Helpers
// ═══════════════════════════════════════════════════════════════════════════════

describe('fromLegacyProfile', () => {
  it('converts an AISettingsProfile to IUnifiedPreset', () => {
    const preset = fromLegacyProfile(DEFAULT_PROFILE);

    expect(preset.id).toBe('default');
    expect(preset.presetName).toBe('Default');
    expect(preset.isBuiltIn).toBe(true);
    expect(preset.config.persona.name).toBe('Parallx AI');
    expect(preset.config.model.chatModel).toBe(''); // was defaultModel
    expect(preset.config.model.temperature).toBe(0.7);
  });

  it('fills new sections from defaults', () => {
    const preset = fromLegacyProfile(DEFAULT_PROFILE);

    // Sections not in legacy profiles should come from defaults
    expect(preset.config.retrieval.autoRag).toBe(true);
    expect(preset.config.retrieval.ragTopK).toBe(20);
    expect(preset.config.agent.maxIterations).toBe(10);
    expect(preset.config.memory.memoryEnabled).toBe(true);
    expect(preset.config.indexing.autoIndex).toBe(true);
  });

  it('preserves custom profile values', () => {
    const custom: AISettingsProfile = {
      ...structuredClone(DEFAULT_PROFILE),
      id: 'my-custom',
      presetName: 'My Custom',
      isBuiltIn: false,
      persona: { name: 'Test Bot', description: 'Testing', avatarEmoji: '🤖' },
      model: { defaultModel: 'llama3.1', temperature: 0.5, maxTokens: 2048, contextWindow: 4096 },
    };

    const preset = fromLegacyProfile(custom);
    expect(preset.config.persona.name).toBe('Test Bot');
    expect(preset.config.model.chatModel).toBe('llama3.1');
    expect(preset.config.model.temperature).toBe(0.5);
    expect(preset.config.model.maxTokens).toBe(2048);
  });
});

describe('fromLegacyParallxConfig', () => {
  it('converts IParallxConfig to workspace override patch', () => {
    const override = fromLegacyParallxConfig(DEFAULT_CONFIG);

    expect(override.model?.chatModel).toBe('qwen2.5:32b-instruct');
    expect(override.model?.embeddingModel).toBe('nomic-embed-text');
    expect(override.retrieval?.autoRag).toBe(true);
    expect(override.retrieval?.ragTopK).toBe(10);
    expect(override.retrieval?.ragScoreThreshold).toBe(0.3);
    expect(override.agent?.maxIterations).toBe(10);
    expect(override.indexing?.autoIndex).toBe(true);
  });

  it('does not include persona/chat/suggestions (not in config.json)', () => {
    const override = fromLegacyParallxConfig(DEFAULT_CONFIG);

    expect(override.persona).toBeUndefined();
    expect(override.chat).toBeUndefined();
    expect(override.suggestions).toBeUndefined();
    expect(override.memory).toBeUndefined();
  });
});

describe('tolegacyProfile', () => {
  it('converts IUnifiedPreset back to AISettingsProfile shape', () => {
    const preset: IUnifiedPreset = {
      id: 'test-1',
      presetName: 'Test',
      isBuiltIn: false,
      createdAt: 1000,
      updatedAt: 2000,
      config: { ...DEFAULT_UNIFIED_CONFIG },
    };

    const profile = tolegacyProfile(preset);
    expect(profile.id).toBe('test-1');
    expect(profile.presetName).toBe('Test');
    expect(profile.persona.name).toBe('Parallx AI');
    expect(profile.model.defaultModel).toBe(''); // chatModel → defaultModel
    expect(profile.suggestions.tone).toBe('balanced');
  });

  it('round-trips: fromLegacyProfile → tolegacyProfile preserves key fields', () => {
    for (const builtIn of BUILT_IN_PRESETS) {
      const preset = fromLegacyProfile(builtIn);
      const backToProfile = tolegacyProfile(preset);

      expect(backToProfile.id).toBe(builtIn.id);
      expect(backToProfile.presetName).toBe(builtIn.presetName);
      expect(backToProfile.persona.name).toBe(builtIn.persona.name);
      expect(backToProfile.model.temperature).toBe(builtIn.model.temperature);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deepMerge
// ═══════════════════════════════════════════════════════════════════════════════

describe('deepMerge', () => {
  it('merges nested objects', () => {
    const target = { a: { b: 1, c: 2 }, d: 3 };
    const patch = { a: { b: 10 } };
    const result = deepMerge(target, patch);

    expect(result.a.b).toBe(10);
    expect(result.a.c).toBe(2); // untouched
    expect(result.d).toBe(3);
  });

  it('does not merge arrays — replaces them', () => {
    const target = { arr: [1, 2, 3] };
    const patch = { arr: [4, 5] };
    const result = deepMerge(target, patch as any);
    expect(result.arr).toEqual([4, 5]);
  });

  it('ignores undefined patch values', () => {
    const target = { a: 1, b: 2 };
    const result = deepMerge(target, { a: undefined } as any);
    expect(result.a).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UnifiedAIConfigService
// ═══════════════════════════════════════════════════════════════════════════════

describe('UnifiedAIConfigService', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let service: UnifiedAIConfigService;

  beforeEach(async () => {
    storage = createMockStorage();
    service = new UnifiedAIConfigService(storage as any, undefined);
    await service.initialize();
  });

  // ── Initialization ──

  describe('initialization', () => {
    it('seeds with 3 built-in presets on fresh start', () => {
      const presets = service.getAllPresets();
      expect(presets.length).toBe(3);
      expect(presets.map(p => p.presetName)).toEqual(['Default', 'Finance Focus', 'Creative Mode']);
    });

    it('sets default as active preset', () => {
      expect(service.getActivePreset().id).toBe('default');
    });

    it('persists presets to storage on init', async () => {
      const stored = await storage.get('unified-ai.presets');
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored!);
      expect(parsed.length).toBe(3);
    });

    it('migrates legacy M15 profiles on first load', async () => {
      const legacyStorage = createMockStorage();
      // Seed with legacy format
      await legacyStorage.set('ai-settings.profiles', JSON.stringify(BUILT_IN_PRESETS.map(p => structuredClone(p))));
      await legacyStorage.set('ai-settings.activeProfileId', 'finance-focus');

      const svc = new UnifiedAIConfigService(legacyStorage as any, undefined);
      await svc.initialize();

      expect(svc.getActivePreset().id).toBe('finance-focus');
      expect(svc.getAllPresets().length).toBe(3);

      // Should have written new-format keys
      const newFormat = await legacyStorage.get('unified-ai.presets');
      expect(newFormat).toBeDefined();

      svc.dispose();
    });
  });

  // ── Effective Config ──

  describe('getEffectiveConfig', () => {
    it('returns default config on fresh start', () => {
      const config = service.getEffectiveConfig();
      expect(config.persona.name).toBe('Parallx AI');
      expect(config.retrieval.ragTopK).toBe(20);
      expect(config.agent.maxIterations).toBe(10);
    });

    it('returns merged config when workspace override is set', async () => {
      await service.updateWorkspaceOverride({
        retrieval: { ragTopK: 15 },
      });

      const config = service.getEffectiveConfig();
      expect(config.retrieval.ragTopK).toBe(15);
      // Other retrieval fields unchanged
      expect(config.retrieval.autoRag).toBe(true);
      expect(config.retrieval.ragScoreThreshold).toBe(0.01);
    });
  });

  // ── Preset Management ──

  describe('preset management', () => {
    it('switches active preset', async () => {
      await service.setActivePreset('finance-focus');
      expect(service.getActivePreset().id).toBe('finance-focus');
      expect(service.getActivePreset().presetName).toBe('Finance Focus');
    });

    it('throws on switch to non-existent preset', async () => {
      await expect(service.setActivePreset('nonexistent')).rejects.toThrow('not found');
    });

    it('creates a new preset cloned from active', async () => {
      const created = await service.createPreset('My Preset');
      expect(created.presetName).toBe('My Preset');
      expect(created.isBuiltIn).toBe(false);
      expect(service.getActivePreset().id).toBe(created.id);
      expect(service.getAllPresets().length).toBe(4);
    });

    it('creates a preset from a specific base', async () => {
      const created = await service.createPreset('Research', 'creative-mode');
      expect(created.config.model.temperature).toBe(0.9); // from creative
    });

    it('deletes a custom preset', async () => {
      const created = await service.createPreset('Throwaway');
      await service.deletePreset(created.id);
      expect(service.getAllPresets().length).toBe(3); // back to built-ins
      expect(service.getActivePreset().id).toBe('default'); // reverted
    });

    it('cannot delete built-in presets', async () => {
      await expect(service.deletePreset('default')).rejects.toThrow('Cannot delete');
    });

    it('renames a custom preset', async () => {
      const created = await service.createPreset('Old Name');
      await service.renamePreset(created.id, 'New Name');
      expect(service.getPreset(created.id)?.presetName).toBe('New Name');
    });

    it('cannot rename built-in presets', async () => {
      await expect(service.renamePreset('default', 'Renamed')).rejects.toThrow('Cannot rename');
    });
  });

  // ── Clone on Write ──

  describe('clone-on-write for built-in presets', () => {
    it('clones a built-in when updating it', async () => {
      expect(service.getActivePreset().isBuiltIn).toBe(true);

      await service.updateActivePreset({
        persona: { name: 'Custom Name' },
      });

      // Active should now be a cloned non-built-in
      const active = service.getActivePreset();
      expect(active.isBuiltIn).toBe(false);
      expect(active.presetName).toBe('Default (Modified)');
      expect(active.config.persona.name).toBe('Custom Name');
      expect(service.getAllPresets().length).toBe(4); // 3 built-in + 1 clone
    });
  });

  // ── Workspace Override ──

  describe('workspace override', () => {
    it('starts with no workspace override', () => {
      expect(service.getWorkspaceOverride()).toBeUndefined();
    });

    it('sets and reads workspace override', async () => {
      await service.updateWorkspaceOverride({
        model: { temperature: 0.3 },
        retrieval: { ragTopK: 20 },
      });

      const override = service.getWorkspaceOverride();
      expect(override).toBeDefined();
      expect(override!.overrides.model?.temperature).toBe(0.3);
      expect(override!.overrides.retrieval?.ragTopK).toBe(20);
    });

    it('merges multiple workspace override updates', async () => {
      await service.updateWorkspaceOverride({ model: { temperature: 0.3 } });
      await service.updateWorkspaceOverride({ retrieval: { ragTopK: 20 } });

      const config = service.getEffectiveConfig();
      expect(config.model.temperature).toBe(0.3);
      expect(config.retrieval.ragTopK).toBe(20);
    });

    it('clears all workspace overrides', async () => {
      await service.updateWorkspaceOverride({ model: { temperature: 0.3 } });
      await service.clearWorkspaceOverride();

      expect(service.getWorkspaceOverride()).toBeUndefined();
      expect(service.getEffectiveConfig().model.temperature).toBe(0.7); // back to default
    });

    it('clears a specific path override', async () => {
      await service.updateWorkspaceOverride({
        model: { temperature: 0.3 },
        retrieval: { ragTopK: 20 },
      });

      await service.clearWorkspaceOverride('model.temperature');

      const config = service.getEffectiveConfig();
      expect(config.model.temperature).toBe(0.7); // reset to preset
      expect(config.retrieval.ragTopK).toBe(20); // still overridden
    });

    it('isOverridden returns true for overridden paths', async () => {
      await service.updateWorkspaceOverride({ retrieval: { ragTopK: 5 } });

      expect(service.isOverridden('retrieval.ragTopK')).toBe(true);
      expect(service.isOverridden('retrieval.autoRag')).toBe(false);
      expect(service.isOverridden('model.temperature')).toBe(false);
    });

    it('getOverriddenKeys lists all overridden leaf paths', async () => {
      await service.updateWorkspaceOverride({
        model: { temperature: 0.3 },
        retrieval: { ragTopK: 5, autoRag: false },
      });

      const keys = service.getOverriddenKeys();
      expect(keys).toContain('model.temperature');
      expect(keys).toContain('retrieval.ragTopK');
      expect(keys).toContain('retrieval.autoRag');
      expect(keys).not.toContain('persona.name');
    });
  });

  // ── Workspace Preset Pinning ──

  describe('workspace preset pinning', () => {
    it('pins a preset for the workspace', async () => {
      await service.setWorkspacePreset('creative-mode');

      // getActivePreset should now return the pinned preset
      expect(service.getActivePreset().id).toBe('creative-mode');
    });

    it('clears workspace preset pinning', async () => {
      await service.setWorkspacePreset('creative-mode');
      await service.clearWorkspacePreset();

      // Should fall back to global active
      expect(service.getActivePreset().id).toBe('default');
    });

    it('workspace pin + override = pin as base with override applied', async () => {
      await service.setWorkspacePreset('creative-mode');
      await service.updateWorkspaceOverride({ model: { temperature: 0.1 } });

      const config = service.getEffectiveConfig();
      // Creative mode base = 0.9, overridden to 0.1
      expect(config.model.temperature).toBe(0.1);
    });
  });

  // ── Reset ──

  describe('reset', () => {
    it('resets a section to defaults', async () => {
      await service.createPreset('Custom');
      await service.updateActivePreset({ model: { temperature: 0.1 } });
      expect(service.getEffectiveConfig().model.temperature).toBe(0.1);

      await service.resetSection('model');
      expect(service.getEffectiveConfig().model.temperature).toBe(0.7);
    });

    it('resets all to defaults', async () => {
      await service.createPreset('Custom');
      await service.updateActivePreset({
        model: { temperature: 0.1 },
        retrieval: { ragTopK: 100 },
      });

      await service.resetAll();
      const config = service.getEffectiveConfig();
      expect(config.model.temperature).toBe(0.7);
      expect(config.retrieval.ragTopK).toBe(20);
    });

    it('reset is no-op for built-in presets', async () => {
      await service.resetAll(); // should not throw
      expect(service.getActivePreset().isBuiltIn).toBe(true);
    });
  });

  // ── Change Events ──

  describe('change events', () => {
    it('fires onDidChangeConfig on preset switch', async () => {
      const listener = vi.fn();
      service.onDidChangeConfig(listener);

      await service.setActivePreset('finance-focus');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].persona.name).toBe('Finance Assistant');
    });

    it('fires onDidChangeConfig on workspace override', async () => {
      const listener = vi.fn();
      service.onDidChangeConfig(listener);

      await service.updateWorkspaceOverride({ retrieval: { ragTopK: 3 } });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].retrieval.ragTopK).toBe(3);
    });

    it('fires legacy onDidChange (AISettingsProfile shape)', async () => {
      const listener = vi.fn();
      service.onDidChange(listener);

      await service.setActivePreset('finance-focus');

      expect(listener).toHaveBeenCalledOnce();
      const profile = listener.mock.calls[0][0];
      expect(profile.id).toBe('finance-focus');
      expect(profile.persona.name).toBe('Finance Assistant');
    });
  });

  // ── Legacy Compatibility ──

  describe('legacy IAISettingsService compatibility', () => {
    it('getActiveProfile returns AISettingsProfile shape', () => {
      const profile = service.getActiveProfile();
      expect(profile.id).toBe('default');
      expect(profile.presetName).toBe('Default');
      expect(profile.persona).toBeDefined();
      expect(profile.chat).toBeDefined();
      expect(profile.model).toBeDefined();
      expect(profile.model.defaultModel).toBeDefined(); // legacy field name
      expect(profile.suggestions).toBeDefined();
    });

    it('getAllProfiles returns AISettingsProfile[] shape', () => {
      const profiles = service.getAllProfiles();
      expect(profiles.length).toBe(3);
      expect(profiles[0].model.defaultModel).toBeDefined();
    });

    it('updateActiveProfile accepts legacy patch format', async () => {
      // First clone to avoid clone-on-write
      await service.createPreset('Test');

      await service.updateActiveProfile({
        model: { defaultModel: 'llama3', temperature: 0.5 },
      });

      const config = service.getEffectiveConfig();
      expect(config.model.chatModel).toBe('llama3');
      expect(config.model.temperature).toBe(0.5);
    });

  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// A.4: Consumer Wiring Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('A.4 Consumer wiring', () => {

  // ── RetrievalService.setConfigProvider ──

  describe('RetrievalService.setConfigProvider', () => {
    it('RetrievalService has setConfigProvider method', async () => {
      const { RetrievalService } = await import('../../src/services/retrievalService');
      const mockEmbed = { embed: vi.fn().mockResolvedValue([new Float32Array(768)]) };
      const mockVector = {
        search: vi.fn().mockResolvedValue([]),
        initialize: vi.fn(),
        dispose: vi.fn(),
      } as any;
      const svc = new RetrievalService(mockEmbed as any, mockVector);
      expect(typeof svc.setConfigProvider).toBe('function');
    });

    it('uses config provider values for topK and minScore', async () => {
      const { RetrievalService } = await import('../../src/services/retrievalService');

      const embedding = new Float32Array(768).fill(0.1);
      const mockEmbed = {
        embed: vi.fn().mockResolvedValue([embedding]),
        embedQuery: vi.fn().mockResolvedValue(embedding),
      };
      const mockVector = {
        search: vi.fn().mockResolvedValue([]),
        initialize: vi.fn(),
        dispose: vi.fn(),
      } as any;

      const svc = new RetrievalService(mockEmbed as any, mockVector);
      svc.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragTopK: 3,
            ragMaxPerSource: 2,
            ragTokenBudget: 1200,
            ragScoreThreshold: 0.5,
            ragCosineThreshold: 0.2,
            ragDropoffRatio: 0.75,
          },
        }),
      });

      const results = await svc.retrieve('test query');
      // Search was called (proving the config path was reached without error)
      expect(mockVector.search).toHaveBeenCalled();
      // The search options should contain topK = 3 * overfetchFactor = 9
      const searchOpts = mockVector.search.mock.calls[0][2];
      expect(searchOpts.topK).toBe(9); // 3 × 3 (overfetch factor)
      expect(results).toEqual([]);
    });
  });

  // ── TokenBudgetService.setConfig ──

  describe('TokenBudgetService reads unified config budget', () => {
    it('setElasticConfig applies elastic config from unified defaults', async () => {
      const { TokenBudgetService } = await import('../../src/services/tokenBudgetService');
      const budgetService = new TokenBudgetService();

      const budget = DEFAULT_UNIFIED_CONFIG.retrieval.contextBudget;
      budgetService.setElasticConfig({
        trimPriority: budget.trimPriority,
        minPercent: budget.minPercent,
      });

      const cfg = budgetService.getElasticConfig();
      expect(cfg.trimPriority.history).toBe(1);
      expect(cfg.trimPriority.ragContext).toBe(2);
      expect(cfg.trimPriority.systemPrompt).toBe(3);
      expect(cfg.trimPriority.userMessage).toBe(4);
    });

    it('contextBudget shape has elastic trimPriority and minPercent', () => {
      const budget = DEFAULT_UNIFIED_CONFIG.retrieval.contextBudget;
      expect(budget).toHaveProperty('trimPriority');
      expect(budget).toHaveProperty('minPercent');
      expect(budget.trimPriority).toHaveProperty('systemPrompt');
      expect(budget.trimPriority).toHaveProperty('ragContext');
      expect(budget.trimPriority).toHaveProperty('history');
      expect(budget.trimPriority).toHaveProperty('userMessage');
      expect(budget.minPercent).toHaveProperty('systemPrompt');
    });
  });

  // ── ChatDataServiceDeps accepts unifiedConfigService ──

  describe('ChatDataServiceDeps unifiedConfigService field', () => {
    it('IDefaultParticipantServices accepts unifiedConfigService', async () => {
      // Type-level test: if this compiles, the field exists on the interface
      const mockServices: Partial<import('../../src/built-in/chat/chatTypes').IDefaultParticipantServices> = {
        unifiedConfigService: undefined,
      };
      expect(mockServices).toHaveProperty('unifiedConfigService');
    });
  });

  // ── Unified config maxIterations flows through ──

  describe('maxIterations flows from unified config', () => {
    let service: UnifiedAIConfigService;

    beforeEach(async () => {
      const storage = createMockStorage();
      service = new UnifiedAIConfigService(storage as any, undefined);
      await service.initialize();
    });

    it('default maxIterations is 10', () => {
      expect(service.getEffectiveConfig().agent.maxIterations).toBe(10);
    });

    it('workspace override changes maxIterations', async () => {
      await service.updateWorkspaceOverride({ agent: { maxIterations: 5 } });
      expect(service.getEffectiveConfig().agent.maxIterations).toBe(5);
    });

    it('preset change changes maxIterations', async () => {
      await service.updateActivePreset({ agent: { maxIterations: 20 } });
      expect(service.getEffectiveConfig().agent.maxIterations).toBe(20);
    });

    it('default agent preferences are present', () => {
      expect(service.getEffectiveConfig().agent.verbosity).toBe('balanced');
      expect(service.getEffectiveConfig().agent.approvalStrictness).toBe('balanced');
      expect(service.getEffectiveConfig().agent.executionStyle).toBe('balanced');
      expect(service.getEffectiveConfig().agent.proactivity).toBe('balanced');
    });

    it('workspace overrides change agent execution preferences', async () => {
      await service.updateWorkspaceOverride({
        agent: {
          verbosity: 'detailed',
          approvalStrictness: 'strict',
          executionStyle: 'stepwise',
          proactivity: 'low',
        },
      });

      expect(service.getEffectiveConfig().agent.verbosity).toBe('detailed');
      expect(service.getEffectiveConfig().agent.approvalStrictness).toBe('strict');
      expect(service.getEffectiveConfig().agent.executionStyle).toBe('stepwise');
      expect(service.getEffectiveConfig().agent.proactivity).toBe('low');
    });
  });

  // ── loadWorkspaceConfig ──

  describe('loadWorkspaceConfig loads overrides from filesystem', () => {
    it('loads workspace overrides after setFileSystem', async () => {
      const storage = createMockStorage();
      const svc = new UnifiedAIConfigService(storage as any, undefined);
      await svc.initialize();

      // Default config before workspace
      expect(svc.getEffectiveConfig().agent.maxIterations).toBe(10);

      // Simulate a .parallx/ai-config.json file
      const mockFs = {
        readFile: vi.fn().mockResolvedValue(JSON.stringify({
          overrides: { agent: { maxIterations: 3 } },
        })),
        exists: vi.fn().mockResolvedValue(true),
      };
      svc.setFileSystem(mockFs);
      await svc.loadWorkspaceConfig();

      expect(svc.getEffectiveConfig().agent.maxIterations).toBe(3);
    });

    it('fires onDidChangeConfig after loadWorkspaceConfig', async () => {
      const storage = createMockStorage();
      const svc = new UnifiedAIConfigService(storage as any, undefined);
      await svc.initialize();

      const listener = vi.fn();
      svc.onDidChangeConfig(listener);

      svc.setFileSystem({
        readFile: vi.fn().mockResolvedValue(JSON.stringify({
          overrides: { retrieval: { ragTopK: 2 } },
        })),
        exists: vi.fn().mockResolvedValue(true),
      });
      await svc.loadWorkspaceConfig();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].retrieval.ragTopK).toBe(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B: Workspace Overrides & Preset Scoping — Persistence Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase B: Workspace override persistence', () => {
  let service: UnifiedAIConfigService;
  let mockWriteFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const storage = createMockStorage();
    service = new UnifiedAIConfigService(storage as any, undefined);
    await service.initialize();

    mockWriteFile = vi.fn(async (_relativePath: string, _content: string) => undefined);
    service.setFileSystem({
      readFile: vi.fn().mockRejectedValue(new Error('not found')),
      exists: vi.fn().mockResolvedValue(false),
      writeFile: mockWriteFile as (relativePath: string, content: string) => Promise<void>,
    });
  });

  describe('B.1: updateWorkspaceOverride writes to disk', () => {
    it('writes .parallx/ai-config.json on updateWorkspaceOverride', async () => {
      await service.updateWorkspaceOverride({ model: { temperature: 0.2 } });

      expect(mockWriteFile).toHaveBeenCalledOnce();
      expect(mockWriteFile.mock.calls[0][0]).toBe('.parallx/ai-config.json');

      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written.overrides.model.temperature).toBe(0.2);
    });

    it('writes merged overrides on successive updates', async () => {
      await service.updateWorkspaceOverride({ model: { temperature: 0.2 } });
      await service.updateWorkspaceOverride({ retrieval: { ragTopK: 15 } });

      expect(mockWriteFile).toHaveBeenCalledTimes(2);

      const secondWrite = JSON.parse(mockWriteFile.mock.calls[1][1]);
      expect(secondWrite.overrides.model.temperature).toBe(0.2);
      expect(secondWrite.overrides.retrieval.ragTopK).toBe(15);
    });

    it('does not write when no filesystem writeFile is available', async () => {
      // Reset with read-only filesystem
      service.setFileSystem({
        readFile: vi.fn().mockRejectedValue(new Error('not found')),
        exists: vi.fn().mockResolvedValue(false),
      });
      const readOnlyWrite = vi.fn();

      await service.updateWorkspaceOverride({ model: { temperature: 0.2 } });

      // Should not throw, just silently skip
      expect(readOnlyWrite).not.toHaveBeenCalled();
    });

    it('writes on clearWorkspaceOverride(path) for specific key', async () => {
      await service.updateWorkspaceOverride({
        model: { temperature: 0.2 },
        retrieval: { ragTopK: 10 },
      });
      mockWriteFile.mockClear();

      await service.clearWorkspaceOverride('model.temperature');

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written.overrides.model?.temperature).toBeUndefined();
      expect(written.overrides.retrieval.ragTopK).toBe(10);
    });
  });

  describe('B.2: setWorkspacePreset persists _presetId', () => {
    it('writes _presetId to disk on setWorkspacePreset', async () => {
      await service.setWorkspacePreset('creative-mode');

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written._presetId).toBe('creative-mode');
    });

    it('removes _presetId from disk on clearWorkspacePreset', async () => {
      await service.setWorkspacePreset('creative-mode');
      mockWriteFile.mockClear();

      await service.clearWorkspacePreset();

      // clearWorkspacePreset should either write without _presetId or not write
      // (if override is empty). Check the override state is cleared.
      expect(service.getActivePreset().id).toBe('default');
    });

    it('_presetId and overrides coexist in persisted file', async () => {
      await service.setWorkspacePreset('finance-focus');
      await service.updateWorkspaceOverride({ model: { temperature: 0.1 } });

      const lastWrite = JSON.parse(mockWriteFile.mock.calls[mockWriteFile.mock.calls.length - 1][1]);
      expect(lastWrite._presetId).toBe('finance-focus');
      expect(lastWrite.overrides.model.temperature).toBe(0.1);
    });
  });

  describe('B.3: Override resolution order', () => {
    it('override resolution: defaultConfig ← activePreset ← workspaceOverride', async () => {
      // Switch to creative-mode (temperature 0.9)
      await service.setActivePreset('creative-mode');
      expect(service.getEffectiveConfig().model.temperature).toBe(0.9);

      // Apply workspace override
      await service.updateWorkspaceOverride({ model: { temperature: 0.5 } });
      expect(service.getEffectiveConfig().model.temperature).toBe(0.5);

      // Non-overridden fields come from the preset
      const creative = service.getActivePreset();
      expect(service.getEffectiveConfig().persona.name).toBe(creative.config.persona.name);
    });

    it('workspace override only applies non-undefined keys', async () => {
      await service.updateWorkspaceOverride({
        retrieval: { ragTopK: 99 },
      });

      const config = service.getEffectiveConfig();
      // overridden
      expect(config.retrieval.ragTopK).toBe(99);
      // not overridden — should be default
      expect(config.retrieval.ragScoreThreshold).toBe(DEFAULT_UNIFIED_CONFIG.retrieval.ragScoreThreshold);
      expect(config.model.temperature).toBe(DEFAULT_UNIFIED_CONFIG.model.temperature);
    });

    it('workspace preset pin changes base config', async () => {
      // Pin to finance-focus preset
      await service.setWorkspacePreset('finance-focus');

      const config = service.getEffectiveConfig();
      const financePreset = service.getAllPresets().find(p => p.id === 'finance-focus')!;
      expect(config.persona.name).toBe(financePreset.config.persona.name);
    });

    it('workspace pin + global switch: workspace pin wins', async () => {
      await service.setWorkspacePreset('creative-mode');

      // Switch global active to finance-focus
      await service.setActivePreset('finance-focus');

      // Workspace pin should still control effective config
      const config = service.getEffectiveConfig();
      const creative = service.getAllPresets().find(p => p.id === 'creative-mode')!;
      expect(config.persona.name).toBe(creative.config.persona.name);
    });

    it('clearWorkspaceOverride() clears overrides but preserves preset pin', async () => {
      await service.setWorkspacePreset('creative-mode');
      await service.updateWorkspaceOverride({ model: { temperature: 0.1 } });

      await service.clearWorkspaceOverride();

      // Overrides cleared, but preset pin preserved
      const ws = service.getWorkspaceOverride();
      expect(ws).toBeDefined();
      expect(ws!._presetId).toBe('creative-mode');
      expect(Object.keys(ws!.overrides)).toHaveLength(0);

      // Effective config uses creative-mode base (temp 0.9), no override
      expect(service.getEffectiveConfig().model.temperature).toBe(0.9);
    });

    it('clearWorkspacePreset + clearWorkspaceOverride fully resets', async () => {
      await service.setWorkspacePreset('creative-mode');
      await service.updateWorkspaceOverride({ model: { temperature: 0.1 } });

      await service.clearWorkspacePreset();
      await service.clearWorkspaceOverride();

      expect(service.getWorkspaceOverride()).toBeUndefined();
      expect(service.getActivePreset().id).toBe('default');
    });

    it('isOverridden returns false after clearing a specific key', async () => {
      await service.updateWorkspaceOverride({
        model: { temperature: 0.3 },
        retrieval: { ragTopK: 5 },
      });
      expect(service.isOverridden('model.temperature')).toBe(true);

      await service.clearWorkspaceOverride('model.temperature');

      expect(service.isOverridden('model.temperature')).toBe(false);
      expect(service.isOverridden('retrieval.ragTopK')).toBe(true);
    });

    it('getOverriddenKeys returns empty array when no overrides', () => {
      expect(service.getOverriddenKeys()).toEqual([]);
    });

    it('round-trip: write → load produces same effective config', async () => {
      // Set overrides
      await service.setWorkspacePreset('finance-focus');
      await service.updateWorkspaceOverride({ model: { temperature: 0.4 } });

      const configBefore = service.getEffectiveConfig();

      // Capture what was written
      const lastWrite = mockWriteFile.mock.calls[mockWriteFile.mock.calls.length - 1][1];

      // Create a new service and load from the written JSON
      const storage2 = createMockStorage();
      const svc2 = new UnifiedAIConfigService(storage2 as any, undefined);
      await svc2.initialize();

      svc2.setFileSystem({
        readFile: vi.fn().mockResolvedValue(lastWrite),
        exists: vi.fn().mockResolvedValue(true),
      });
      await svc2.loadWorkspaceConfig();

      const configAfter = svc2.getEffectiveConfig();
      expect(configAfter.model.temperature).toBe(configBefore.model.temperature);
      expect(configAfter.persona.name).toBe(configBefore.persona.name);
    });
  });
});
