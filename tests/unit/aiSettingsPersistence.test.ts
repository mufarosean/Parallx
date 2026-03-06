// tests/unit/aiSettingsPersistence.test.ts — M15 Group E: Persistence & Validation
//
// Task 3.1 — Storage key design audit (round-trip persistence)
// Task 3.2 — Live change propagation (every write path fires onDidChange)
// Task 3.3 — Settings health check on startup (schema migration, corrupt data)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AISettingsService } from '../../src/aiSettings/aiSettingsService';
import { DEFAULT_PROFILE, BUILT_IN_PRESETS } from '../../src/aiSettings/aiSettingsDefaults';
import type { AISettingsProfile } from '../../src/aiSettings/aiSettingsTypes';
import type { IStorage } from '../../src/platform/storage';

// ─── Mock IStorage ─────────────────────────────────────────────────────────

function createMockStorage(initial?: Record<string, string>): IStorage {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    has: vi.fn(async (key: string) => store.has(key)),
    keys: vi.fn(async (prefix?: string) => {
      const all = [...store.keys()];
      return prefix ? all.filter(k => k.startsWith(prefix)) : all;
    }),
    clear: vi.fn(async () => { store.clear(); }),
  };
}

// ─── Helper: read persisted JSON directly from storage ──────────────────────

async function getPersistedProfiles(storage: IStorage): Promise<AISettingsProfile[]> {
  const json = await storage.get('ai-settings.profiles');
  return json ? JSON.parse(json) : [];
}

async function getPersistedActiveId(storage: IStorage): Promise<string | undefined> {
  return storage.get('ai-settings.activeProfileId');
}

// ═════════════════════════════════════════════════════════════════════════════
// Task 3.1 — Storage Key Design Audit
// ═════════════════════════════════════════════════════════════════════════════

describe('Task 3.1 — Storage Key Design', () => {
  let storage: IStorage;
  let service: AISettingsService;

  beforeEach(async () => {
    storage = createMockStorage();
    service = new AISettingsService(storage, undefined);
    await service.initialize();
  });

  it('uses ai-settings.profiles key for profile array', async () => {
    expect(storage.set).toHaveBeenCalledWith(
      'ai-settings.profiles',
      expect.any(String),
    );
  });

  it('uses ai-settings.activeProfileId key for active profile', async () => {
    expect(storage.set).toHaveBeenCalledWith(
      'ai-settings.activeProfileId',
      expect.any(String),
    );
  });

  it('does not use any other ai-settings.* keys', async () => {
    const setCalls = (storage.set as ReturnType<typeof vi.fn>).mock.calls;
    const keys = setCalls.map((c: string[]) => c[0]);
    const aiSettingsKeys = keys.filter((k: string) => k.startsWith('ai-settings.'));
    const allowedKeys = new Set(['ai-settings.profiles', 'ai-settings.activeProfileId']);
    for (const key of aiSettingsKeys) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  // ── Round-trip persistence (simulates app restart) ──

  it('round-trips tone change across restart', async () => {
    // Create a custom profile and change tone
    await service.createProfile('RoundTrip');
    await service.updateActiveProfile({ suggestions: { tone: 'concise' } });

    const activeId = service.getActiveProfile().id;
    expect(service.getActiveProfile().suggestions.tone).toBe('concise');

    // "Restart" — create new service from same storage
    const service2 = new AISettingsService(storage, undefined);
    await service2.initialize();

    expect(service2.getActiveProfile().id).toBe(activeId);
    expect(service2.getActiveProfile().suggestions.tone).toBe('concise');
    expect(service2.getAllProfiles().length).toBe(4); // 3 built-in + 1 custom
    service2.dispose();
  });

  it('round-trips temperature change across restart', async () => {
    await service.createProfile('TempTest');
    await service.updateActiveProfile({ model: { temperature: 0.2 } });

    const service2 = new AISettingsService(storage, undefined);
    await service2.initialize();

    expect(service2.getActiveProfile().model.temperature).toBe(0.2);
    service2.dispose();
  });

  it('round-trips persona changes across restart', async () => {
    await service.createProfile('PersonaTest');
    await service.updateActiveProfile({
      persona: { name: 'Friday', description: 'My AI', avatarEmoji: '🦊' },
    });

    const service2 = new AISettingsService(storage, undefined);
    await service2.initialize();

    const p = service2.getActiveProfile();
    expect(p.persona.name).toBe('Friday');
    expect(p.persona.description).toBe('My AI');
    expect(p.persona.avatarEmoji).toBe('🦊');
    service2.dispose();
  });

  it('round-trips active profile ID across restart', async () => {
    await service.setActiveProfile('creative-mode');

    const service2 = new AISettingsService(storage, undefined);
    await service2.initialize();

    expect(service2.getActiveProfile().id).toBe('creative-mode');
    service2.dispose();
  });

  it('round-trips profile count across restart', async () => {
    await service.createProfile('Extra 1');
    await service.createProfile('Extra 2');
    expect(service.getAllProfiles()).toHaveLength(5);

    const service2 = new AISettingsService(storage, undefined);
    await service2.initialize();

    expect(service2.getAllProfiles()).toHaveLength(5);
    service2.dispose();
  });

  it('persists custom system prompt text across restart', async () => {
    await service.createProfile('CustomPrompt');
    await service.updateActiveProfile({
      chat: { systemPrompt: 'Be a pirate.', systemPromptIsCustom: true },
    });

    const service2 = new AISettingsService(storage, undefined);
    await service2.initialize();

    expect(service2.getActiveProfile().chat.systemPrompt).toBe('Be a pirate.');
    expect(service2.getActiveProfile().chat.systemPromptIsCustom).toBe(true);
    service2.dispose();
  });

  it('persists deletion across restart', async () => {
    const c = await service.createProfile('WillBeDeleted');
    await service.deleteProfile(c.id);

    const service2 = new AISettingsService(storage, undefined);
    await service2.initialize();

    expect(service2.getProfile(c.id)).toBeUndefined();
    expect(service2.getAllProfiles()).toHaveLength(3);
    service2.dispose();
  });

  it('persists rename across restart', async () => {
    const custom = await service.createProfile('OldName');
    await service.renameProfile(custom.id, 'NewName');

    const service2 = new AISettingsService(storage, undefined);
    await service2.initialize();

    expect(service2.getProfile(custom.id)!.presetName).toBe('NewName');
    service2.dispose();
  });

  afterEach(() => { service.dispose(); });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 3.2 — Live Change Propagation
// ═════════════════════════════════════════════════════════════════════════════

describe('Task 3.2 — Live Change Propagation', () => {
  let storage: IStorage;
  let service: AISettingsService;

  beforeEach(async () => {
    storage = createMockStorage();
    service = new AISettingsService(storage, undefined);
    await service.initialize();
  });

  afterEach(() => { service.dispose(); });

  it('setActiveProfile fires onDidChange', async () => {
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.setActiveProfile('finance-focus');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].id).toBe('finance-focus');
  });

  it('updateActiveProfile fires onDidChange', async () => {
    await service.createProfile('Test');
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.updateActiveProfile({ suggestions: { tone: 'detailed' } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].suggestions.tone).toBe('detailed');
  });

  it('createProfile fires onDidChange', async () => {
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.createProfile('PropagationTest');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].presetName).toBe('PropagationTest');
  });

  it('deleteProfile fires onDidChange', async () => {
    const custom = await service.createProfile('ToDelete');
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.deleteProfile(custom.id);

    expect(handler).toHaveBeenCalledTimes(1);
    // After deleting active, should fall back to default
    expect(handler.mock.calls[0][0].id).toBe('default');
  });

  it('renameProfile fires onDidChange when profile is active', async () => {
    const custom = await service.createProfile('WillRename');
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.renameProfile(custom.id, 'Renamed');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].presetName).toBe('Renamed');
  });

  it('renameProfile does NOT fire onDidChange when profile is not active', async () => {
    const c1 = await service.createProfile('ProfileA');
    const c2 = await service.createProfile('ProfileB');
    // c2 is now active, c1 is not
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.renameProfile(c1.id, 'RenamedA');

    expect(handler).not.toHaveBeenCalled();
  });

  it('resetSection fires onDidChange for custom profile', async () => {
    const custom = await service.createProfile('Resettable');
    await service.updateActiveProfile({ model: { temperature: 0.1 } });
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.resetSection('model');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].model.temperature).toBe(DEFAULT_PROFILE.model.temperature);
  });

  it('resetSection does NOT fire for built-in profile (no-op)', async () => {
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.resetSection('model');

    expect(handler).not.toHaveBeenCalled();
  });

  it('resetAll fires onDidChange for custom profile', async () => {
    const custom = await service.createProfile('FullReset');
    await service.updateActiveProfile({
      persona: { name: 'Changed' },
      model: { temperature: 0.1 },
    });
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.resetAll();

    expect(handler).toHaveBeenCalledTimes(1);
    const result = handler.mock.calls[0][0];
    expect(result.persona.name).toBe(DEFAULT_PROFILE.persona.name);
    expect(result.model.temperature).toBe(DEFAULT_PROFILE.model.temperature);
  });

  it('resetAll does NOT fire for built-in profile (no-op)', async () => {
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.resetAll();

    expect(handler).not.toHaveBeenCalled();
  });

  it('updateActiveProfile on built-in profile fires onDidChange (clone-on-write)', async () => {
    // Default is built-in
    expect(service.getActiveProfile().isBuiltIn).toBe(true);
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.updateActiveProfile({ persona: { name: 'Modified' } });

    expect(handler).toHaveBeenCalledTimes(1);
    // The clone should not be built-in
    expect(handler.mock.calls[0][0].isBuiltIn).toBe(false);
    expect(handler.mock.calls[0][0].persona.name).toBe('Modified');
  });

  it('multiple rapid changes each fire separate events', async () => {
    await service.createProfile('Rapid');
    const handler = vi.fn();
    service.onDidChange(handler);

    await service.updateActiveProfile({ suggestions: { tone: 'concise' } });
    await service.updateActiveProfile({ suggestions: { tone: 'detailed' } });
    await service.updateActiveProfile({ suggestions: { tone: 'balanced' } });

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls[0][0].suggestions.tone).toBe('concise');
    expect(handler.mock.calls[1][0].suggestions.tone).toBe('detailed');
    expect(handler.mock.calls[2][0].suggestions.tone).toBe('balanced');
  });

  it('change propagates updated system prompt to listeners', async () => {
    await service.createProfile('PromptWatch');
    const prompts: string[] = [];
    service.onDidChange((profile) => {
      prompts.push(profile.chat.systemPrompt);
    });

    await service.updateActiveProfile({ suggestions: { tone: 'concise' } });
    await service.updateActiveProfile({ suggestions: { tone: 'detailed' } });

    expect(prompts).toHaveLength(2);
    // concise and detailed tones produce different prompts
    expect(prompts[0]).not.toBe(prompts[1]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 3.3 — Settings Health Check on Startup
// ═════════════════════════════════════════════════════════════════════════════

describe('Task 3.3 — Settings Health Check', () => {

  it('fills missing suggestions fields from DEFAULT_PROFILE', async () => {
    const oldProfile = {
      id: 'custom-legacy',
      presetName: 'Legacy',
      isBuiltIn: false,
      persona: DEFAULT_PROFILE.persona,
      chat: DEFAULT_PROFILE.chat,
      model: DEFAULT_PROFILE.model,
      suggestions: {
        tone: 'concise',
        focusDomain: 'finance',
        // Missing: customFocusDescription, suggestionConfidenceThreshold,
        //          suggestionsEnabled, maxPendingSuggestions
      },
      createdAt: 1000,
      updatedAt: 1000,
    };

    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([...BUILT_IN_PRESETS, oldProfile]),
      'ai-settings.activeProfileId': 'custom-legacy',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    const loaded = svc.getProfile('custom-legacy')!;
    expect(loaded.suggestions.tone).toBe('concise'); // preserved
    expect(loaded.suggestions.focusDomain).toBe('finance'); // preserved
    expect(loaded.suggestions.suggestionsEnabled).toBe(DEFAULT_PROFILE.suggestions.suggestionsEnabled);
    expect(loaded.suggestions.maxPendingSuggestions).toBe(DEFAULT_PROFILE.suggestions.maxPendingSuggestions);
    expect(loaded.suggestions.suggestionConfidenceThreshold).toBe(DEFAULT_PROFILE.suggestions.suggestionConfidenceThreshold);
    svc.dispose();
  });

  it('fills missing persona section entirely', async () => {
    const partial = {
      id: 'no-persona',
      presetName: 'No Persona',
      isBuiltIn: false,
      // persona section missing entirely
      chat: DEFAULT_PROFILE.chat,
      model: DEFAULT_PROFILE.model,
      suggestions: DEFAULT_PROFILE.suggestions,
      createdAt: 1,
      updatedAt: 1,
    };

    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([...BUILT_IN_PRESETS, partial]),
      'ai-settings.activeProfileId': 'no-persona',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    const loaded = svc.getProfile('no-persona')!;
    expect(loaded.persona.name).toBe(DEFAULT_PROFILE.persona.name);
    expect(loaded.persona.avatarEmoji).toBe(DEFAULT_PROFILE.persona.avatarEmoji);
    svc.dispose();
  });

  it('fills missing model section from defaults', async () => {
    const partial = {
      id: 'no-model',
      presetName: 'No Model',
      isBuiltIn: false,
      persona: DEFAULT_PROFILE.persona,
      chat: DEFAULT_PROFILE.chat,
      // model section missing
      suggestions: DEFAULT_PROFILE.suggestions,
      createdAt: 1,
      updatedAt: 1,
    };

    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([...BUILT_IN_PRESETS, partial]),
      'ai-settings.activeProfileId': 'no-model',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    const loaded = svc.getProfile('no-model')!;
    expect(loaded.model.temperature).toBe(DEFAULT_PROFILE.model.temperature);
    expect(loaded.model.maxTokens).toBe(DEFAULT_PROFILE.model.maxTokens);
    svc.dispose();
  });

  it('resets to defaults on corrupt JSON and logs warning', async () => {
    const storage = createMockStorage({
      'ai-settings.profiles': '<<<NOT VALID JSON>>>',
      'ai-settings.activeProfileId': 'default',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    expect(svc.getAllProfiles()).toHaveLength(3);
    expect(svc.getActiveProfile().id).toBe('default');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse stored profiles'),
      expect.anything(),
    );
    warnSpy.mockRestore();
    svc.dispose();
  });

  it('resets to defaults on empty array in storage', async () => {
    const storage = createMockStorage({
      'ai-settings.profiles': '[]',
      'ai-settings.activeProfileId': 'default',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    expect(svc.getAllProfiles()).toHaveLength(3);
    svc.dispose();
  });

  it('restores deleted built-in presets', async () => {
    // Only Finance Focus stored — Default and Creative Mode were deleted
    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([BUILT_IN_PRESETS[1]]),
      'ai-settings.activeProfileId': 'finance-focus',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    // All 3 built-ins should be restored
    expect(svc.getAllProfiles()).toHaveLength(3);
    expect(svc.getProfile('default')).toBeDefined();
    expect(svc.getProfile('finance-focus')).toBeDefined();
    expect(svc.getProfile('creative-mode')).toBeDefined();
    svc.dispose();
  });

  it('preserves custom profiles alongside restored built-ins', async () => {
    const custom = {
      id: 'my-custom',
      presetName: 'My Custom',
      isBuiltIn: false,
      persona: DEFAULT_PROFILE.persona,
      chat: DEFAULT_PROFILE.chat,
      model: DEFAULT_PROFILE.model,
      suggestions: DEFAULT_PROFILE.suggestions,
      createdAt: 100,
      updatedAt: 100,
    };
    // Only Default built-in + custom stored
    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([BUILT_IN_PRESETS[0], custom]),
      'ai-settings.activeProfileId': 'my-custom',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    expect(svc.getAllProfiles()).toHaveLength(4); // 3 built-in + 1 custom
    expect(svc.getProfile('my-custom')).toBeDefined();
    expect(svc.getActiveProfile().id).toBe('my-custom');
    svc.dispose();
  });

  it('ignores profiles without an id field', async () => {
    const noId = {
      presetName: 'No Id',
      persona: DEFAULT_PROFILE.persona,
      chat: DEFAULT_PROFILE.chat,
      model: DEFAULT_PROFILE.model,
      suggestions: DEFAULT_PROFILE.suggestions,
    };
    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([...BUILT_IN_PRESETS, noId]),
      'ai-settings.activeProfileId': 'default',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    // noId profile should be silently skipped
    expect(svc.getAllProfiles()).toHaveLength(3);
    svc.dispose();
  });

  it('preserves extra fields from stored profiles (forward compat)', async () => {
    const withExtra = {
      ...structuredClone(DEFAULT_PROFILE),
      id: 'custom-extra',
      presetName: 'Extra Fields',
      isBuiltIn: false,
      futureField: 'hello from the future',
    };
    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([...BUILT_IN_PRESETS, withExtra]),
      'ai-settings.activeProfileId': 'custom-extra',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    const loaded = svc.getProfile('custom-extra')!;
    expect(loaded.presetName).toBe('Extra Fields');
    // The extra field should survive deep merge
    expect((loaded as any).futureField).toBe('hello from the future');
    svc.dispose();
  });

  it('custom profiles stored as isBuiltIn=true are forced to false', async () => {
    const tricky = {
      id: 'fake-builtin',
      presetName: 'Fake Built-in',
      isBuiltIn: true, // This ID is not in BUILT_IN_PRESETS
      persona: DEFAULT_PROFILE.persona,
      chat: DEFAULT_PROFILE.chat,
      model: DEFAULT_PROFILE.model,
      suggestions: DEFAULT_PROFILE.suggestions,
      createdAt: 100,
      updatedAt: 100,
    };
    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([...BUILT_IN_PRESETS, tricky]),
      'ai-settings.activeProfileId': 'default',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    const loaded = svc.getProfile('fake-builtin')!;
    expect(loaded).toBeDefined();
    expect(loaded.isBuiltIn).toBe(false); // forced to false by health check
    svc.dispose();
  });

  it('built-in presets receive new fields added in code updates', async () => {
    // Simulate a stored built-in that is missing fields the current DEFAULT_PROFILE has
    const oldDefault = {
      id: 'default',
      presetName: 'Default',
      isBuiltIn: true,
      persona: { name: 'Old AI', description: 'old desc', avatarEmoji: '🧠' },
      chat: { systemPrompt: 'old prompt', systemPromptIsCustom: false, responseLength: 'short' },
      model: { temperature: 0.5 },
      // suggestions section is completely different shape
      suggestions: {},
      createdAt: 0,
      updatedAt: 0,
    };

    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify([oldDefault]),
      'ai-settings.activeProfileId': 'default',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    const loaded = svc.getProfile('default')!;
    expect(loaded.isBuiltIn).toBe(true);
    // New fields from current BUILT_IN_PRESETS should be merged in
    expect(loaded.suggestions.suggestionsEnabled).toBeDefined();
    expect(loaded.model.maxTokens).toBeDefined();
    svc.dispose();
  });

  it('active profile defaults to "default" when stored ID not found', async () => {
    const storage = createMockStorage({
      'ai-settings.profiles': JSON.stringify(BUILT_IN_PRESETS),
      'ai-settings.activeProfileId': 'nonexistent-id',
    });
    const svc = new AISettingsService(storage, undefined);
    await svc.initialize();

    // getActiveProfile should fallback gracefully
    const active = svc.getActiveProfile();
    expect(active).toBeDefined();
    // Falls back to first profile in array
    expect(active.id).toBe('default');
    svc.dispose();
  });
});
