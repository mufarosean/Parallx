// aiSettingsService.test.ts — Unit tests for M15 AISettingsService (Task 1.3)

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

function findProfile(service: { getAllProfiles(): AISettingsProfile[] }, id: string): AISettingsProfile | undefined {
  return service.getAllProfiles().find(profile => profile.id === id);
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('AISettingsService', () => {
  let storage: IStorage;
  let service: AISettingsService;

  beforeEach(async () => {
    storage = createMockStorage();
    service = new AISettingsService(storage, undefined);
    await service.initialize();
  });

  // ── Initialization ──

  describe('initialization', () => {
    it('seeds with 3 built-in presets on first launch', () => {
      const profiles = service.getAllProfiles();
      expect(profiles).toHaveLength(3);
      expect(profiles.every(p => p.isBuiltIn)).toBe(true);
    });

    it('sets Default as the active profile', () => {
      const active = service.getActiveProfile();
      expect(active.id).toBe('default');
      expect(active.presetName).toBe('Default');
    });

    it('persists profiles to storage on first initialize', () => {
      expect(storage.set).toHaveBeenCalledWith(
        'ai-settings.profiles',
        expect.any(String)
      );
    });

    it('loads previously persisted profiles', async () => {
      // Persist a custom profile via the first service
      const created = await service.createProfile('My Custom');
      expect(service.getAllProfiles()).toHaveLength(4);

      // Create a new service reading from the same storage
      const service2 = new AISettingsService(storage, undefined);
      await service2.initialize();

      expect(service2.getAllProfiles()).toHaveLength(4);
      const found = findProfile(service2, created.id);
      expect(found).toBeDefined();
      expect(found!.presetName).toBe('My Custom');

      service2.dispose();
    });
  });

  // ── Profile Switching ──

  describe('setActiveProfile', () => {
    it('switches the active profile and fires onDidChange', async () => {
      const changeHandler = vi.fn();
      service.onDidChange(changeHandler);

      await service.setActiveProfile('finance-focus');
      expect(service.getActiveProfile().id).toBe('finance-focus');
      expect(changeHandler).toHaveBeenCalledTimes(1);
      expect(changeHandler.mock.calls[0][0].id).toBe('finance-focus');
    });

    it('throws on unknown profile ID', async () => {
      await expect(service.setActiveProfile('nonexistent')).rejects.toThrow(
        'Profile not found: nonexistent'
      );
    });
  });

  // ── Profile Update ──

  describe('updateActiveProfile', () => {
    it('deep-merges a patch without erasing other fields', async () => {
      // First create a custom profile so we can edit it
      const custom = await service.createProfile('Editable');
      const originalTemp = custom.model.temperature;

      await service.updateActiveProfile({
        suggestions: { tone: 'concise' },
      });

      const updated = service.getActiveProfile();
      expect(updated.suggestions.tone).toBe('concise');
      // Other suggestion fields should survive
      expect(updated.suggestions.suggestionsEnabled).toBe(true);
      expect(updated.suggestions.maxPendingSuggestions).toBe(5);
      // Model should be untouched
      expect(updated.model.temperature).toBe(originalTemp);
    });

    it('fires onDidChange after update', async () => {
      await service.createProfile('Evented');
      const changeHandler = vi.fn();
      service.onDidChange(changeHandler);

      await service.updateActiveProfile({
        persona: { name: 'Updated Name' },
      });

      expect(changeHandler).toHaveBeenCalledTimes(1);
      expect(changeHandler.mock.calls[0][0].persona.name).toBe('Updated Name');
    });

    it('clones built-in preset on write', async () => {
      // Active is Default (built-in)
      expect(service.getActiveProfile().isBuiltIn).toBe(true);

      await service.updateActiveProfile({
        suggestions: { tone: 'concise' },
      });

      // Should have been cloned
      const active = service.getActiveProfile();
      expect(active.isBuiltIn).toBe(false);
      expect(active.presetName).toBe('Default (Modified)');
      expect(active.suggestions.tone).toBe('concise');

      // Original built-in should be untouched
      const original = findProfile(service, 'default')!;
      expect(original.isBuiltIn).toBe(true);
      expect(original.suggestions.tone).toBe('balanced');
    });
  });

  // ── Profile Creation ──

  describe('createProfile', () => {
    it('creates a clone of the active profile', async () => {
      const created = await service.createProfile('My Copy');
      expect(created.presetName).toBe('My Copy');
      expect(created.isBuiltIn).toBe(false);
      expect(created.id).not.toBe('default');
      expect(created.persona.name).toBe(DEFAULT_PROFILE.persona.name);
    });

    it('switches active to the new profile', async () => {
      const created = await service.createProfile('New Active');
      expect(service.getActiveProfile().id).toBe(created.id);
    });

    it('creates from a specific base profile', async () => {
      const created = await service.createProfile('Finance Clone', 'finance-focus');
      expect(created.persona.name).toBe('Finance Assistant');
      expect(created.suggestions.focusDomain).toBe('finance');
    });
  });

  // ── Profile Deletion ──

  describe('deleteProfile', () => {
    it('deletes a custom profile and reverts to default', async () => {
      const custom = await service.createProfile('Deleteable');
      expect(service.getAllProfiles()).toHaveLength(4);

      await service.deleteProfile(custom.id);
      expect(service.getAllProfiles()).toHaveLength(3);
      expect(service.getActiveProfile().id).toBe('default');
    });

    it('throws when deleting a built-in preset', async () => {
      await expect(service.deleteProfile('default')).rejects.toThrow(
        'Cannot delete built-in preset'
      );
    });

    it('fires onDidChange after deletion', async () => {
      const custom = await service.createProfile('ToDelete');
      const changeHandler = vi.fn();
      service.onDidChange(changeHandler);

      await service.deleteProfile(custom.id);
      expect(changeHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Profile Renaming ──

  describe('renameProfile', () => {
    it('renames a custom profile', async () => {
      const custom = await service.createProfile('Old Name');
      await service.renameProfile(custom.id, 'New Name');

      const renamed = findProfile(service, custom.id)!;
      expect(renamed.presetName).toBe('New Name');
    });

    it('throws when renaming a built-in preset', async () => {
      await expect(service.renameProfile('default', 'Nope')).rejects.toThrow(
        'Cannot rename built-in preset'
      );
    });
  });

  // ── Reset ──

  describe('resetSection', () => {
    it('resets a specific section to defaults', async () => {
      const custom = await service.createProfile('Resettable');
      await service.updateActiveProfile({
        model: { temperature: 0.1 },
      });
      expect(service.getActiveProfile().model.temperature).toBe(0.1);

      await service.resetSection('model');
      expect(service.getActiveProfile().model.temperature).toBe(DEFAULT_PROFILE.model.temperature);
    });

    it('is a no-op for built-in presets', async () => {
      const changeHandler = vi.fn();
      service.onDidChange(changeHandler);

      await service.resetSection('model');
      // Should not fire — no change
      expect(changeHandler).not.toHaveBeenCalled();
    });
  });

  describe('resetAll', () => {
    it('resets all sections to defaults while preserving id and name', async () => {
      const custom = await service.createProfile('Full Reset');
      await service.updateActiveProfile({
        model: { temperature: 0.1 },
        suggestions: { tone: 'detailed' },
        persona: { name: 'Changed' },
      });

      await service.resetAll();

      const reset = service.getActiveProfile();
      expect(reset.id).toBe(custom.id);
      expect(reset.presetName).toBe('Full Reset');
      expect(reset.model.temperature).toBe(DEFAULT_PROFILE.model.temperature);
      expect(reset.suggestions.tone).toBe(DEFAULT_PROFILE.suggestions.tone);
      expect(reset.persona.name).toBe(DEFAULT_PROFILE.persona.name);
    });
  });

  // ── Health Check ──

  describe('health check on startup', () => {
    it('fills missing fields from DEFAULT_PROFILE', async () => {
      // Simulate an old stored profile missing the suggestions.maxPendingSuggestions field
      const oldProfile = {
        id: 'custom-old',
        presetName: 'Old Format',
        isBuiltIn: false,
        persona: { name: 'Old', description: 'test', avatarEmoji: '🧠' },
        chat: { systemPrompt: 'hi', systemPromptIsCustom: true, responseLength: 'short' },
        model: { temperature: 0.5, maxTokens: 0, contextWindow: 0 },
        suggestions: { tone: 'concise', focusDomain: 'general', customFocusDescription: '' },
        // missing: suggestionConfidenceThreshold, suggestionsEnabled, maxPendingSuggestions
        createdAt: 1000,
        updatedAt: 1000,
      };

      const storageWithOld = createMockStorage({
        'ai-settings.profiles': JSON.stringify([...BUILT_IN_PRESETS, oldProfile]),
        'ai-settings.activeProfileId': 'custom-old',
      });

      const svc = new AISettingsService(storageWithOld, undefined);
      await svc.initialize();

      const loaded = findProfile(svc, 'custom-old')!;
      expect(loaded).toBeDefined();
      expect(loaded.presetName).toBe('Old Format');
      // Missing fields should be filled from defaults
      expect(loaded.suggestions.suggestionsEnabled).toBe(DEFAULT_PROFILE.suggestions.suggestionsEnabled);
      expect(loaded.suggestions.maxPendingSuggestions).toBe(DEFAULT_PROFILE.suggestions.maxPendingSuggestions);

      svc.dispose();
    });

    it('resets to defaults on unparseable JSON', async () => {
      const corruptStorage = createMockStorage({
        'ai-settings.profiles': '{{{CORRUPT',
        'ai-settings.activeProfileId': 'default',
      });

      const svc = new AISettingsService(corruptStorage, undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await svc.initialize();

      expect(svc.getAllProfiles()).toHaveLength(3);
      expect(svc.getActiveProfile().id).toBe('default');
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
      svc.dispose();
    });
  });

  // ── Cleanup ──

  it('disposes without error', () => {
    expect(() => service.dispose()).not.toThrow();
  });
});
