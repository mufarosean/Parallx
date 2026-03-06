// aiSettingsService.ts — AI Settings Service implementation (M15 Task 1.3)
//
// Persistence backbone for AI personality & behavior settings.
// Reads/writes profiles using IStorage, emits change events so all consumers
// (chat prompt builder, proactive suggestions) react immediately.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';
import type {
  AISettingsProfile,
  AISuggestionSettings,
  AIChatSettings,
  IAISettingsService,
  DeepPartial,
} from './aiSettingsTypes.js';
import { DEFAULT_PROFILE, BUILT_IN_PRESETS } from './aiSettingsDefaults.js';
import { generateChatSystemPrompt, buildGenInputFromProfile } from './systemPromptGenerator.js';
import type { ILanguageModelsService, IChatResponseChunk } from '../services/chatTypes.js';

// ─── Storage Keys ──────────────────────────────────────────────────────────

const STORAGE_KEY_PROFILES = 'ai-settings.profiles';
const STORAGE_KEY_ACTIVE_ID = 'ai-settings.activeProfileId';

// ─── Deep Merge Utility ────────────────────────────────────────────────────

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  patch: DeepPartial<T>
): T {
  const result = { ...target };
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const patchVal = patch[key];
    if (
      patchVal !== undefined &&
      typeof patchVal === 'object' &&
      patchVal !== null &&
      !Array.isArray(patchVal) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        patchVal as DeepPartial<Record<string, unknown>>
      ) as T[keyof T];
    } else if (patchVal !== undefined) {
      result[key] = patchVal as T[keyof T];
    }
  }
  return result;
}

// ─── Stream Collector ──────────────────────────────────────────────────────

async function collectStreamedResponse(
  stream: AsyncIterable<IChatResponseChunk>
): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of stream) {
    if (chunk.content) {
      parts.push(chunk.content);
    }
  }
  return parts.join('');
}

// ─── Service Implementation ────────────────────────────────────────────────

export class AISettingsService extends Disposable implements IAISettingsService {
  private _profiles: AISettingsProfile[] = [];
  private _activeProfileId: string = 'default';

  private readonly _onDidChange: Emitter<AISettingsProfile>;
  readonly onDidChange: Event<AISettingsProfile>;

  constructor(
    private readonly _storage: IStorage,
    private readonly _languageModelsService: ILanguageModelsService | undefined,
  ) {
    super();
    this._onDidChange = this._register(new Emitter<AISettingsProfile>());
    this.onDidChange = this._onDidChange.event;
  }

  /**
   * Initialize: load profiles from storage or seed with built-in presets.
   * Must be called after construction (async init pattern).
   */
  async initialize(): Promise<void> {
    await this._loadFromStorage();
    console.log(`[AISettingsService] Loaded ${this._profiles.length} profiles`);
  }

  // ── Profile Accessors ──

  getActiveProfile(): AISettingsProfile {
    const profile = this._profiles.find(p => p.id === this._activeProfileId);
    return profile ?? this._profiles[0] ?? structuredClone(DEFAULT_PROFILE);
  }

  getGlobalProfile(): AISettingsProfile {
    return this.getActiveProfile();
  }

  getProfile(id: string): AISettingsProfile | undefined {
    return this._profiles.find(p => p.id === id);
  }

  getAllProfiles(): AISettingsProfile[] {
    return [...this._profiles];
  }

  // ── Profile Mutation ──

  async setActiveProfile(id: string): Promise<void> {
    const profile = this._profiles.find(p => p.id === id);
    if (!profile) {
      throw new Error(`[AISettingsService] Profile not found: ${id}`);
    }
    this._activeProfileId = id;
    await this._persist();
    this._onDidChange.fire(profile);
  }

  async updateActiveProfile(patch: DeepPartial<AISettingsProfile>): Promise<void> {
    let profile = this.getActiveProfile();

    // Built-in presets are immutable — clone on write
    if (profile.isBuiltIn) {
      profile = await this._cloneBuiltIn(profile);
    }

    // Deep-merge the patch
    const updated = deepMerge(profile as unknown as Record<string, unknown>, patch as DeepPartial<Record<string, unknown>>) as unknown as AISettingsProfile;
    updated.updatedAt = Date.now();

    // Regenerate system prompt if not custom
    if (!updated.chat.systemPromptIsCustom) {
      updated.chat.systemPrompt = generateChatSystemPrompt(
        buildGenInputFromProfile(updated)
      );
    }

    // Replace in profiles array
    const idx = this._profiles.findIndex(p => p.id === updated.id);
    if (idx >= 0) {
      this._profiles[idx] = updated;
    }

    await this._persist();
    this._onDidChange.fire(updated);
  }

  async createProfile(name: string, baseId?: string): Promise<AISettingsProfile> {
    const base = baseId
      ? this._profiles.find(p => p.id === baseId)
      : this.getActiveProfile();
    if (!base) {
      throw new Error(`[AISettingsService] Base profile not found: ${baseId}`);
    }

    const newProfile: AISettingsProfile = {
      ...structuredClone(base),
      id: this._generateId(),
      presetName: name,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this._profiles.push(newProfile);
    this._activeProfileId = newProfile.id;
    await this._persist();
    this._onDidChange.fire(newProfile);
    return newProfile;
  }

  async deleteProfile(id: string): Promise<void> {
    const profile = this._profiles.find(p => p.id === id);
    if (!profile) {
      throw new Error(`[AISettingsService] Profile not found: ${id}`);
    }
    if (profile.isBuiltIn) {
      throw new Error(`[AISettingsService] Cannot delete built-in preset: ${profile.presetName}`);
    }

    this._profiles = this._profiles.filter(p => p.id !== id);

    // If we deleted the active profile, revert to default
    if (this._activeProfileId === id) {
      this._activeProfileId = 'default';
    }

    await this._persist();
    this._onDidChange.fire(this.getActiveProfile());
  }

  async renameProfile(id: string, newName: string): Promise<void> {
    const profile = this._profiles.find(p => p.id === id);
    if (!profile) {
      throw new Error(`[AISettingsService] Profile not found: ${id}`);
    }
    if (profile.isBuiltIn) {
      throw new Error(`[AISettingsService] Cannot rename built-in preset: ${profile.presetName}`);
    }

    profile.presetName = newName;
    profile.updatedAt = Date.now();
    await this._persist();

    if (this._activeProfileId === id) {
      this._onDidChange.fire(profile);
    }
  }

  // ── Reset ──

  async resetSection(section: 'persona' | 'chat' | 'model' | 'suggestions'): Promise<void> {
    const profile = this.getActiveProfile();

    if (profile.isBuiltIn) {
      // For built-in presets, resetting is a no-op (they're already at defaults)
      return;
    }

    const defaultSection = DEFAULT_PROFILE[section];
    (profile as any)[section] = structuredClone(defaultSection);
    profile.updatedAt = Date.now();

    // Regenerate system prompt if resetting chat or suggestions and not custom
    if ((section === 'chat' || section === 'suggestions') && !profile.chat.systemPromptIsCustom) {
      profile.chat.systemPrompt = generateChatSystemPrompt(
        buildGenInputFromProfile(profile)
      );
    }

    const idx = this._profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      this._profiles[idx] = profile;
    }

    await this._persist();
    this._onDidChange.fire(profile);
  }

  async resetAll(): Promise<void> {
    const profile = this.getActiveProfile();

    if (profile.isBuiltIn) {
      return;
    }

    const reset: AISettingsProfile = {
      ...structuredClone(DEFAULT_PROFILE),
      id: profile.id,
      presetName: profile.presetName,
      isBuiltIn: false,
      createdAt: profile.createdAt,
      updatedAt: Date.now(),
    };

    const idx = this._profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      this._profiles[idx] = reset;
    }

    await this._persist();
    this._onDidChange.fire(reset);
  }

  // ── System Prompt Generation ──

  generateSystemPrompt(settings: AISuggestionSettings & AIChatSettings): string {
    return generateChatSystemPrompt({
      systemPrompt: settings.systemPrompt,
      systemPromptIsCustom: settings.systemPromptIsCustom,
      responseLength: settings.responseLength,
      tone: settings.tone,
      focusDomain: settings.focusDomain,
      customFocusDescription: settings.customFocusDescription,
    });
  }

  // ── Preview Test ──

  async runPreviewTest(userMessage: string): Promise<string> {
    if (!this._languageModelsService) {
      throw new Error('[AISettingsService] Language models service not available');
    }

    const profile = this.getActiveProfile();
    const modelId = this._languageModelsService.getActiveModel();
    if (!modelId) {
      throw new Error('[AISettingsService] No active model available');
    }

    const stream = this._languageModelsService.sendChatRequest(
      [
        { role: 'system', content: profile.chat.systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        temperature: profile.model.temperature,
        maxTokens: profile.model.maxTokens || undefined,
      },
    );

    return collectStreamedResponse(stream);
  }

  // ── Private: Storage ──

  private async _loadFromStorage(): Promise<void> {
    try {
      const profilesJson = await this._storage.get(STORAGE_KEY_PROFILES);
      const activeId = await this._storage.get(STORAGE_KEY_ACTIVE_ID);

      if (profilesJson) {
        const parsed = JSON.parse(profilesJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._profiles = this._healthCheck(parsed);
          this._activeProfileId = activeId ?? 'default';
          return;
        }
      }
    } catch (e) {
      console.warn('[AISettingsService] Failed to parse stored profiles, resetting to defaults:', e);
    }

    // Seed with built-in presets
    this._profiles = BUILT_IN_PRESETS.map(p => structuredClone(p));
    this._activeProfileId = 'default';
    await this._persist();
  }

  private async _persist(): Promise<void> {
    await this._storage.set(STORAGE_KEY_PROFILES, JSON.stringify(this._profiles));
    await this._storage.set(STORAGE_KEY_ACTIVE_ID, this._activeProfileId);
  }

  /**
   * Health check: validate loaded profiles against current schema.
   * Missing fields are filled from DEFAULT_PROFILE via deep merge.
   */
  private _healthCheck(profiles: unknown[]): AISettingsProfile[] {
    const result: AISettingsProfile[] = [];
    const builtInIds = new Set(BUILT_IN_PRESETS.map(p => p.id));

    // Ensure all built-in presets are present
    for (const builtIn of BUILT_IN_PRESETS) {
      const existing = profiles.find(
        (p: any) => typeof p === 'object' && p !== null && p.id === builtIn.id
      );
      if (existing && typeof existing === 'object') {
        // Merge stored values with current defaults to fill new fields
        result.push(
          deepMerge(
            structuredClone(builtIn) as unknown as Record<string, unknown>,
            existing as DeepPartial<Record<string, unknown>>
          ) as unknown as AISettingsProfile
        );
      } else {
        result.push(structuredClone(builtIn));
      }
    }

    // Add custom profiles
    for (const raw of profiles) {
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'id' in raw &&
        typeof (raw as any).id === 'string' &&
        !builtInIds.has((raw as any).id)
      ) {
        // Fill missing fields from DEFAULT_PROFILE
        const filled = deepMerge(
          structuredClone(DEFAULT_PROFILE) as unknown as Record<string, unknown>,
          raw as DeepPartial<Record<string, unknown>>
        ) as unknown as AISettingsProfile;
        filled.isBuiltIn = false; // custom profiles are never built-in
        result.push(filled);
      }
    }

    return result;
  }

  // ── Private: Helpers ──

  private async _cloneBuiltIn(profile: AISettingsProfile): Promise<AISettingsProfile> {
    const clone: AISettingsProfile = {
      ...structuredClone(profile),
      id: this._generateId(),
      presetName: `${profile.presetName} (Modified)`,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this._profiles.push(clone);
    this._activeProfileId = clone.id;
    return clone;
  }

  private _generateId(): string {
    return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
