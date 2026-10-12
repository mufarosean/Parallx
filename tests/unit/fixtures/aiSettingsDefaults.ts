// aiSettingsDefaults.ts — Factory defaults for AI settings (M15 Task 1.1)
//
// DEFAULT_PROFILE defines the factory state every fresh installation starts with.

import type { AISettingsProfile } from '../../../src/aiSettings/aiSettingsTypes.js';

// ─── Default Profile ───────────────────────────────────────────────────────

function makeDefaultProfile(): AISettingsProfile {
  const profile: AISettingsProfile = {
    chat: {
      timeZone: '',               // this computer's zone
    },
    model: {
      defaultModel: '', // auto-select
      temperature: -1,            // model default
      maxTokens: 0, // model default
      contextWindow: 0, // model default
    },
  };

  return profile;
}

export const DEFAULT_PROFILE: AISettingsProfile = makeDefaultProfile();
