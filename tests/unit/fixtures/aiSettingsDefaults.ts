// aiSettingsDefaults.ts — Factory defaults for AI settings (M15 Task 1.1)
//
// DEFAULT_PROFILE defines the factory state every fresh installation starts with.
// The three built-in presets (Default, Finance Focus, Creative Mode) are always
// present and cannot be deleted.

import type { AISettingsProfile } from '../../../src/aiSettings/aiSettingsTypes.js';

// ─── Default Profile ───────────────────────────────────────────────────────

function makeDefaultProfile(): AISettingsProfile {
  const profile: AISettingsProfile = {
    id: 'default',
    presetName: 'Default',
    isBuiltIn: true,
    chat: {
      systemPrompt: '',
      systemPromptIsCustom: false,
      timeZone: '',               // this computer's zone
    },
    model: {
      defaultModel: '', // auto-select
      temperature: -1,            // model default
      maxTokens: 0, // model default
      contextWindow: 0, // model default
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
  };
  return profile;
}

function makeCreativeModeProfile(): AISettingsProfile {
  const profile: AISettingsProfile = {
    ...structuredClone(DEFAULT_PROFILE),
    id: 'creative-mode',
    presetName: 'Creative Mode',
    isBuiltIn: true,
    model: {
      ...DEFAULT_PROFILE.model,
      temperature: 0.9,
    },
  };
  return profile;
}

export const BUILT_IN_PRESETS: readonly AISettingsProfile[] = [
  DEFAULT_PROFILE,
  makeFinanceFocusProfile(),
  makeCreativeModeProfile(),
];
