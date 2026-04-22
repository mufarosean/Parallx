// aiSettingsDefaults.ts — Factory defaults for AI settings (M15 Task 1.1)
//
// DEFAULT_PROFILE defines the factory state every fresh installation starts with.
// The three built-in presets (Default, Finance Focus, Creative Mode) are always
// present and cannot be deleted.

import type { AISettingsProfile } from './aiSettingsTypes.js';

// ─── Default Profile ───────────────────────────────────────────────────────

function makeDefaultProfile(): AISettingsProfile {
  const profile: AISettingsProfile = {
    id: 'default',
    presetName: 'Default',
    isBuiltIn: true,
    persona: {
      name: 'Parallx AI',
      description: 'Your intelligent workspace assistant',
      avatarEmoji: 'avatar-brain',
    },
    chat: {
      systemPrompt: '',
      systemPromptIsCustom: false,
      responseLength: 'adaptive',
    },
    model: {
      defaultModel: '', // auto-select
      temperature: 0.7,
      maxTokens: 0, // model default
      contextWindow: 0, // model default
    },
    suggestions: {
      tone: 'balanced',
      focusDomain: 'general',
      customFocusDescription: '',
      suggestionConfidenceThreshold: 0.65,
      suggestionsEnabled: true,
      maxPendingSuggestions: 5,
    },
    createdAt: 0,
    updatedAt: 0,
  };

  return profile;
}

export const DEFAULT_PROFILE: AISettingsProfile = makeDefaultProfile();

// ─── Built-in Presets ──────────────────────────────────────────────────────

function makeFinanceFocusProfile(): AISettingsProfile {
  const profile: AISettingsProfile = {
    ...structuredClone(DEFAULT_PROFILE),
    id: 'finance-focus',
    presetName: 'Finance Focus',
    isBuiltIn: true,
    persona: {
      name: 'Finance Assistant',
      description: 'Focused on transactions, budgeting, and financial insights',
      avatarEmoji: 'avatar-coins',
    },
    suggestions: {
      ...DEFAULT_PROFILE.suggestions,
      tone: 'concise',
      focusDomain: 'finance',
      suggestionConfidenceThreshold: 0.6,
    },
  };
  return profile;
}

function makeCreativeModeProfile(): AISettingsProfile {
  const profile: AISettingsProfile = {
    ...structuredClone(DEFAULT_PROFILE),
    id: 'creative-mode',
    presetName: 'Creative Mode',
    isBuiltIn: true,
    persona: {
      name: 'Creative Partner',
      description: 'Playful and exploratory — great for writing and brainstorming',
      avatarEmoji: 'avatar-pen',
    },
    model: {
      ...DEFAULT_PROFILE.model,
      temperature: 0.9,
    },
    suggestions: {
      ...DEFAULT_PROFILE.suggestions,
      tone: 'detailed',
      focusDomain: 'writing',
    },
  };
  return profile;
}

export const BUILT_IN_PRESETS: readonly AISettingsProfile[] = [
  DEFAULT_PROFILE,
  makeFinanceFocusProfile(),
  makeCreativeModeProfile(),
];
