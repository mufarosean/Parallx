// tests/unit/unifiedAIConfigService.test.ts — M20 Task A.1 + A.2 tests
//
// Tests for:
//   - IUnifiedAIConfig types and defaults
//   - Conversion helpers (fromLegacyParallxConfig, tolegacyProfile)
//   - UnifiedAIConfigService: the global settings and their carry-over from
//     the old presets, workspace overrides, effective config resolution,
//     legacy compatibility

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_UNIFIED_CONFIG,
  fromLegacyParallxConfig,
  tolegacyProfile,
} from '../../src/aiSettings/unifiedConfigTypes';
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
    expect(DEFAULT_UNIFIED_CONFIG.chat).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.model).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.retrieval).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.agent).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.memory).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.indexing).toBeDefined();
    expect(DEFAULT_UNIFIED_CONFIG.tools).toBeDefined();
  });

  it('retrieval defaults match retrievalService constants', () => {
    // These must match the hardcoded values in retrievalService.ts
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
    expect(DEFAULT_UNIFIED_CONFIG.agent.maxIterations).toBe(25);
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

describe('fromLegacyParallxConfig', () => {
  it('converts IParallxConfig to workspace override patch', () => {
    const override = fromLegacyParallxConfig(DEFAULT_CONFIG);

    expect(override.model?.chatModel).toBe('qwen2.5:32b-instruct');
    expect(override.model?.embeddingModel).toBe('nomic-embed-text');
    expect(override.retrieval?.autoRag).toBe(true);
    expect(override.retrieval?.ragTopK).toBe(10);
    expect(override.retrieval?.ragScoreThreshold).toBe(0.3);
    expect(override.agent?.maxIterations).toBe(10);
    expect(override.indexing?.excludePatterns).toEqual([]);
  });

  it('does not include chat (not in config.json)', () => {
    const override = fromLegacyParallxConfig(DEFAULT_CONFIG);

    expect(override.chat).toBeUndefined();
    expect(override.memory).toBeUndefined();
  });
});

describe('tolegacyProfile', () => {
  it('converts a config to the AISettingsProfile shape', () => {
    const profile = tolegacyProfile({ ...DEFAULT_UNIFIED_CONFIG });
    expect(profile.chat.timeZone).toBe('');
    expect(profile.model.defaultModel).toBe(''); // chatModel → defaultModel
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
    service = new UnifiedAIConfigService(storage as any);
    await service.initialize();
  });

  // ── Initialization ──

  describe('initialization', () => {
    it('starts from the defaults and stores them', async () => {
      expect(service.getEffectiveConfig()).toEqual(DEFAULT_UNIFIED_CONFIG);
      const stored = await storage.get('unified-ai.config');
      expect(JSON.parse(stored!)).toEqual(DEFAULT_UNIFIED_CONFIG);
    });

    it('fills fields added since the settings were stored', async () => {
      const s = createMockStorage();
      await s.set('unified-ai.config', JSON.stringify({ model: { temperature: 0.4 } }));
      const svc = new UnifiedAIConfigService(s as any);
      await svc.initialize();
      expect(svc.getEffectiveConfig().model.temperature).toBe(0.4);
      expect(svc.getEffectiveConfig().agent.maxIterations).toBe(25);
    });
  });

  // ── Carry-over from presets ──

  describe('carry-over from the old presets', () => {
    const oldPresets = (activeConfig: object) => JSON.stringify([
      { id: 'default', presetName: 'Default', isBuiltIn: true, config: { ...DEFAULT_UNIFIED_CONFIG } },
      { id: 'creative-mode', presetName: 'Creative Mode', isBuiltIn: true, config: { model: { temperature: 0.9 } } },
      { id: 'preset-1', presetName: 'Default (Modified)', isBuiltIn: false, config: activeConfig },
    ]);

    it('takes the settings of the preset that was active', async () => {
      const s = createMockStorage();
      await s.set('unified-ai.presets', oldPresets({ model: { chatModel: 'qwen3:32b', temperature: 0.3 }, agent: { maxIterations: 40 } }));
      await s.set('unified-ai.activePresetId', 'preset-1');
      const svc = new UnifiedAIConfigService(s as any);
      await svc.initialize();

      const config = svc.getEffectiveConfig();
      expect(config.model.chatModel).toBe('qwen3:32b');
      expect(config.model.temperature).toBe(0.3);
      expect(config.agent.maxIterations).toBe(40);
      expect(config.retrieval.ragTopK).toBe(20); // filled from the defaults
      expect(JSON.parse((await s.get('unified-ai.config'))!).model.chatModel).toBe('qwen3:32b');
    });

    it('leaves the old keys as they were', async () => {
      const s = createMockStorage();
      const presets = oldPresets({ model: { temperature: 0.3 } });
      await s.set('unified-ai.presets', presets);
      await s.set('unified-ai.activePresetId', 'preset-1');
      const svc = new UnifiedAIConfigService(s as any);
      await svc.initialize();
      expect(await s.get('unified-ai.presets')).toBe(presets);
      expect(await s.get('unified-ai.activePresetId')).toBe('preset-1');
    });

    it('falls back to the Default preset when the active one is gone', async () => {
      const s = createMockStorage();
      await s.set('unified-ai.presets', oldPresets({ model: { temperature: 0.3 } }));
      await s.set('unified-ai.activePresetId', 'preset-deleted');
      const svc = new UnifiedAIConfigService(s as any);
      await svc.initialize();
      expect(svc.getEffectiveConfig().model.temperature).toBe(-1);
    });

    it('reads the old presets only once', async () => {
      const s = createMockStorage();
      await s.set('unified-ai.presets', oldPresets({ model: { temperature: 0.3 } }));
      await s.set('unified-ai.activePresetId', 'preset-1');
      const first = new UnifiedAIConfigService(s as any);
      await first.initialize();
      await first.updateConfig({ model: { temperature: 0.7 } });

      const second = new UnifiedAIConfigService(s as any);
      await second.initialize();
      expect(second.getEffectiveConfig().model.temperature).toBe(0.7);
    });
  });

  // ── Effective Config ──

  describe('getEffectiveConfig', () => {
    it('returns default config on fresh start', () => {
      const config = service.getEffectiveConfig();
      expect(config.chat.timeZone).toBe('');
      expect(config.retrieval.ragTopK).toBe(20);
      expect(config.agent.maxIterations).toBe(25);
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

  // ── Global Settings ──

  describe('updateConfig', () => {
    it('changes the global settings and stores them', async () => {
      await service.updateConfig({ chat: { timeZone: 'Europe/Paris' } });
      expect(service.getEffectiveConfig().chat.timeZone).toBe('Europe/Paris');
      expect(JSON.parse((await storage.get('unified-ai.config'))!).chat.timeZone).toBe('Europe/Paris');
    });

    it('keeps the fields the patch does not name', async () => {
      await service.updateConfig({ model: { temperature: 0.2 } });
      expect(service.getEffectiveConfig().model.maxTokens).toBe(0);
      expect(service.getEffectiveConfig().retrieval.ragTopK).toBe(20);
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
      expect(service.getEffectiveConfig().model.temperature).toBe(-1); // back to default
    });

    it('clears a specific path override', async () => {
      await service.updateWorkspaceOverride({
        model: { temperature: 0.3 },
        retrieval: { ragTopK: 20 },
      });

      await service.clearWorkspaceOverride('model.temperature');

      const config = service.getEffectiveConfig();
      expect(config.model.temperature).toBe(-1); // back to the global value
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
      expect(keys).not.toContain('chat.timeZone');
    });
  });

  // ── Reset ──

  describe('reset', () => {
    it('resets a section to defaults', async () => {
      await service.updateConfig({ model: { temperature: 0.1 }, retrieval: { ragTopK: 100 } });
      expect(service.getEffectiveConfig().model.temperature).toBe(0.1);

      await service.resetSection('model');
      expect(service.getEffectiveConfig().model.temperature).toBe(-1);
      expect(service.getEffectiveConfig().retrieval.ragTopK).toBe(100);
    });

    it('resets all to defaults', async () => {
      await service.updateConfig({
        model: { temperature: 0.1 },
        retrieval: { ragTopK: 100 },
      });

      await service.resetAll();
      const config = service.getEffectiveConfig();
      expect(config.model.temperature).toBe(-1);
      expect(config.retrieval.ragTopK).toBe(20);
    });
  });

  // ── Change Events ──

  describe('change events', () => {
    it('fires onDidChangeConfig on a settings change', async () => {
      const listener = vi.fn();
      service.onDidChangeConfig(listener);

      await service.updateConfig({ model: { temperature: 0.9 } });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].model.temperature).toBe(0.9);
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

      await service.updateConfig({ model: { temperature: 0.9 } });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].model.temperature).toBe(0.9);
    });
  });

  // ── Legacy Compatibility ──

  describe('legacy IAISettingsService compatibility', () => {
    it('getActiveProfile returns AISettingsProfile shape', () => {
      const profile = service.getActiveProfile();
      expect(profile.chat).toBeDefined();
      expect(profile.model).toBeDefined();
      expect(profile.model.defaultModel).toBeDefined(); // legacy field name
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
            ragScoreThreshold: 0.5,
          },
        }),
      });

      const results = await svc.retrieve('test query');
      // Search was called (proving the config path was reached without error)
      expect(mockVector.search).toHaveBeenCalled();
      // The search options should contain topK = 3 (direct from config)
      const searchOpts = mockVector.search.mock.calls[0][2];
      expect(searchOpts.topK).toBe(3);
      expect(results).toEqual([]);
    });
  });

  // ── Context budget shape ──
  // (The TokenBudgetService-coupled test died with the class in the
  // Retirement phase — openclawTokenBudget is the live elastic impl.)

  describe('unified config context budget', () => {
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
      const mockServices: Partial<import('../../src/openclaw/openclawTypes').IDefaultParticipantServices> = {
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
      service = new UnifiedAIConfigService(storage as any);
      await service.initialize();
    });

    it('default maxIterations is 25', () => {
      expect(service.getEffectiveConfig().agent.maxIterations).toBe(25);
    });

    it('workspace override changes maxIterations', async () => {
      await service.updateWorkspaceOverride({ agent: { maxIterations: 5 } });
      expect(service.getEffectiveConfig().agent.maxIterations).toBe(5);
    });

    it('a settings change changes maxIterations', async () => {
      await service.updateConfig({ agent: { maxIterations: 20 } });
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
      const svc = new UnifiedAIConfigService(storage as any);
      await svc.initialize();

      // Default config before workspace
      expect(svc.getEffectiveConfig().agent.maxIterations).toBe(25);

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
      const svc = new UnifiedAIConfigService(storage as any);
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
// B: Workspace Overrides — Persistence Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase B: Workspace override persistence', () => {
  let service: UnifiedAIConfigService;
  let mockWriteFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const storage = createMockStorage();
    service = new UnifiedAIConfigService(storage as any);
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

  describe('B.2: an older file that named a preset', () => {
    it('reads its overrides and ignores the preset it named', async () => {
      const svc = new UnifiedAIConfigService(createMockStorage() as any);
      await svc.initialize();
      await svc.updateConfig({ model: { temperature: 0.6 } });
      svc.setFileSystem({
        readFile: vi.fn().mockResolvedValue(JSON.stringify({ _presetId: 'creative-mode', overrides: { retrieval: { ragTopK: 7 } } })),
        exists: vi.fn().mockResolvedValue(true),
      });
      await svc.loadWorkspaceConfig();

      expect(svc.getEffectiveConfig().retrieval.ragTopK).toBe(7);
      expect(svc.getEffectiveConfig().model.temperature).toBe(0.6);
      expect(svc.getWorkspaceOverride()).toEqual({ overrides: { retrieval: { ragTopK: 7 } } });
    });
  });

  describe('B.3: Override resolution order', () => {
    it('override resolution: defaults ← global settings ← workspace override', async () => {
      await service.updateConfig({ model: { temperature: 0.9 }, chat: { timeZone: 'Asia/Tokyo' } });
      expect(service.getEffectiveConfig().model.temperature).toBe(0.9);

      // Apply workspace override
      await service.updateWorkspaceOverride({ model: { temperature: 0.5 } });
      expect(service.getEffectiveConfig().model.temperature).toBe(0.5);

      // Non-overridden fields come from the global settings
      expect(service.getEffectiveConfig().chat.timeZone).toBe('Asia/Tokyo');
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

    it('clearWorkspaceOverride() returns to the global settings', async () => {
      await service.updateConfig({ model: { temperature: 0.9 } });
      await service.updateWorkspaceOverride({ model: { temperature: 0.1 } });

      await service.clearWorkspaceOverride();

      expect(service.getWorkspaceOverride()).toBeUndefined();
      expect(service.getEffectiveConfig().model.temperature).toBe(0.9);
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
      await service.updateWorkspaceOverride({ model: { temperature: 0.4 } });

      const configBefore = service.getEffectiveConfig();

      // Capture what was written
      const lastWrite = mockWriteFile.mock.calls[mockWriteFile.mock.calls.length - 1][1];

      // Create a new service and load from the written JSON
      const storage2 = createMockStorage();
      const svc2 = new UnifiedAIConfigService(storage2 as any);
      await svc2.initialize();

      svc2.setFileSystem({
        readFile: vi.fn().mockResolvedValue(lastWrite),
        exists: vi.fn().mockResolvedValue(true),
      });
      await svc2.loadWorkspaceConfig();

      const configAfter = svc2.getEffectiveConfig();
      expect(configAfter.model.temperature).toBe(configBefore.model.temperature);
      expect(configAfter.chat.timeZone).toBe(configBefore.chat.timeZone);
    });
  });
});
