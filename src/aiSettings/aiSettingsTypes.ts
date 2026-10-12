// aiSettingsTypes.ts — AI Settings types and service interface
//
// All types for the AI Personality & Behavior Settings system.
// Consumer code imports types only from this file.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

// ─── Tone / Style Enums ────────────────────────────────────────────────────

// ─── The Full Settings Profile ─────────────────────────────────────────────

export interface AIChatSettings {
  /** IANA zone every time the assistant reads or writes is in; '' = this computer's zone */
  timeZone?: string;
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

export interface AISettingsProfile {
  chat: AIChatSettings;
  model: AIModelSettings;
}

// ─── Service Interface ─────────────────────────────────────────────────────

export interface IAISettingsService extends IDisposable {
  /** The global AI settings in the profile shape (workspace overrides not applied) */
  getActiveProfile(): AISettingsProfile;

  /** Reset a specific section of the global settings to factory defaults */
  resetSection(section: 'chat' | 'model'): Promise<void>;

  /** Reset all global settings to factory defaults */
  resetAll(): Promise<void>;

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
  Pick<AISettingsProfile, 'chat' | 'model'>
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
