// aiSettingsTypes.ts — AI Settings types and service interface (M15 Task 1.1)
//
// All types for the AI Personality & Behavior Settings system.
// Consumer code imports types only from this file.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

// ─── Tone / Style Enums ────────────────────────────────────────────────────

export type AITone = 'concise' | 'balanced' | 'detailed';

export type AIFocusDomain =
  | 'general'
  | 'finance'
  | 'writing'
  | 'coding'
  | 'research'
  | 'custom';

export type AIResponseLength = 'short' | 'medium' | 'long' | 'adaptive';

// ─── The Full Settings Profile ─────────────────────────────────────────────

export interface AIPersonaSettings {
  /** Display name shown in the UI and in suggestion cards (e.g. "Parallx AI") */
  name: string;
  /** One-sentence description shown under the name */
  description: string;
  /** Emoji or icon key used as the avatar (e.g. "🧠", "💼", "✍️") */
  avatarEmoji: string;
}

export interface AIChatSettings {
  /**
   * The system prompt injected at the top of every chat conversation.
   * The friendly UI controls (tone, focus, length) generate this string,
   * but the user can also override it directly in the raw editor.
   */
  systemPrompt: string;
  /** Whether the user has manually overridden the generated system prompt */
  systemPromptIsCustom: boolean;
  /** Controls response length preference */
  responseLength: AIResponseLength;
}

export interface AIModelSettings {
  /**
   * Preferred model ID for new chat sessions (empty = auto-select).
   * When set, new sessions start with this model and the fallback chain
   * uses it when the last-used model becomes unavailable.
   */
  defaultModel: string;
  /**
   * 0.0 = fully deterministic (precise)
   * 1.0 = fully creative (variable)
   * Maps directly to Ollama's `temperature` parameter.
   * Passed through OllamaProvider.sendChatRequest() options.
   */
  temperature: number;
  /** Max tokens per response (0 = model default). Passed as num_predict. */
  maxTokens: number;
  /** Context window size override (0 = model default). Passed as num_ctx. */
  contextWindow: number;
}

export interface AISuggestionSettings {
  /** Friendly tone for the proactive suggestions system */
  tone: AITone;
  /** Domain the AI pays extra attention to */
  focusDomain: AIFocusDomain;
  /** If focusDomain === 'custom', this free-text field describes it */
  customFocusDescription: string;
  /**
   * Minimum confidence 0–1 to surface a suggestion.
   * Wires into ProactiveSuggestionsService threshold.
   */
  suggestionConfidenceThreshold: number;
  /** Whether proactive suggestion cards are shown */
  suggestionsEnabled: boolean;
  /** Max suggestion cards visible at once */
  maxPendingSuggestions: number;
}

export interface AISettingsProfile {
  /** Unique ID — used as the preset key */
  id: string;
  /** Human-readable name shown in the Preset Switcher */
  presetName: string;
  /** Whether this is a built-in read-only preset */
  isBuiltIn: boolean;
  persona: AIPersonaSettings;
  chat: AIChatSettings;
  model: AIModelSettings;
  suggestions: AISuggestionSettings;
  createdAt: number;
  updatedAt: number;
}

// ─── Service Interface ─────────────────────────────────────────────────────

export interface IAISettingsService extends IDisposable {
  /** Get the currently active profile (effective = global merged with workspace override) */
  getActiveProfile(): AISettingsProfile;

  /** List all saved profiles */
  getAllProfiles(): AISettingsProfile[];

  /** Switch the active profile — fires onDidChange */
  setActiveProfile(id: string): Promise<void>;

  /** Update fields on the currently active profile and save */
  updateActiveProfile(patch: DeepPartial<AISettingsProfile>): Promise<void>;

  /** Create a new profile (cloned from active, or from base if baseId provided) */
  createProfile(name: string, baseId?: string): Promise<AISettingsProfile>;

  /** Delete a profile (cannot delete built-in presets) */
  deleteProfile(id: string): Promise<void>;

  /** Rename a profile */
  renameProfile(id: string, newName: string): Promise<void>;

  /** Reset a specific section of the active profile to factory defaults */
  resetSection(section: 'persona' | 'chat' | 'model' | 'suggestions'): Promise<void>;

  /** Reset the entire active profile to factory defaults */
  resetAll(): Promise<void>;

  /** Test: send a single message using the active profile settings and return the response */
  runPreviewTest(userMessage: string): Promise<string>;

  /** Subscribe to settings changes. Uses Emitter<T>/Event<T> pattern. */
  readonly onDidChange: Event<AISettingsProfile>;
}

// ─── Utility ───────────────────────────────────────────────────────────────

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ─── Workspace Override (Capability 6 — deferred) ──────────────────────────

/**
 * A sparse patch of AISettingsProfile fields.
 * Only the fields present here override the global active profile.
 * Stored in .parallx/ai-settings.json inside the workspace root.
 */
export type WorkspaceAIOverride = DeepPartial<
  Pick<AISettingsProfile, 'chat' | 'model' | 'suggestions'>
> & {
  /** Human label shown in the status bar when override is active */
  label?: string;
};

// ─── Prompt Builder Answers (Capability 8 — deferred) ──────────────────────

export interface PromptBuilderAnswers {
  role: string;
  audience: string;
  audienceDetails: string;
  expertiseAreas: string[];
  constraints: string;
}
