// autonomyFlagDescriptions.test.ts — a setting's description tells the truth
// about its default. "Default off" on a flag that defaults to on sends the
// user looking for a switch that is already on.

import { describe, it, expect } from 'vitest';
import { AUTONOMY_FLAG_DEFAULTS, type AutonomyFlagId } from '../../src/services/autonomyFeatureFlags';
import { FLAG_DESCRIPTIONS } from '../../src/services/autonomySettingsSchemas';

describe('autonomy flag descriptions', () => {
  it('every flag has a description', () => {
    for (const id of Object.keys(AUTONOMY_FLAG_DEFAULTS) as AutonomyFlagId[]) {
      expect(FLAG_DESCRIPTIONS[id], id).toBeTruthy();
    }
  });

  it('a description that names its default names the real one', () => {
    for (const id of Object.keys(AUTONOMY_FLAG_DEFAULTS) as AutonomyFlagId[]) {
      const claim = /default (on|off)\b/i.exec(FLAG_DESCRIPTIONS[id]);
      if (!claim) continue;
      const claimedOn = claim[1].toLowerCase() === 'on';
      expect(claimedOn, `${id}: "${FLAG_DESCRIPTIONS[id]}"`).toBe(AUTONOMY_FLAG_DEFAULTS[id]);
    }
  });
});
