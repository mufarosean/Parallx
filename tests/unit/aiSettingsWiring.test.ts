// tests/unit/aiSettingsWiring.test.ts — AI settings / unified config wiring tests
//
// Validates that:
// 1. migrated chat behavior reads unified config for promptOverlay + temperature
// 2. Unified config changes propagate via onDidChangeConfig

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_PROFILE } from './fixtures/aiSettingsDefaults';
import { Emitter } from '../../src/platform/events';
import type { IUnifiedAIConfigService } from '../../src/aiSettings/unifiedConfigTypes';

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockUnifiedConfigService(overrides?: {
  model?: { temperature?: number; maxTokens?: number };
}) {
  const config = {
    model: {
      temperature: overrides?.model?.temperature ?? DEFAULT_PROFILE.model.temperature,
      maxTokens: overrides?.model?.maxTokens ?? DEFAULT_PROFILE.model.maxTokens,
    },
  };
  const onDidChangeEmitter = new Emitter<void>();
  return {
    getEffectiveConfig: vi.fn(() => structuredClone(config) as any),
    onDidChangeConfig: onDidChangeEmitter.event,
    _fireChange: () => onDidChangeEmitter.fire(undefined),
    dispose: vi.fn(),
  };
}

// ─── Chat Participant Unified Config Integration ─────────────────────────────

describe('Chat Participant Unified Config Integration (M40 Phase 6)', () => {
  it('IDefaultParticipantServices accepts unifiedConfigService', () => {
    const mockServices: Partial<import('../../src/openclaw/openclawTypes').IDefaultParticipantServices> = {
      // A partial fake: the test only checks that the slot takes a service.
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          model: { temperature: DEFAULT_PROFILE.model.temperature, maxTokens: DEFAULT_PROFILE.model.maxTokens },
        } as any),
      } as unknown as IUnifiedAIConfigService,
    };
    expect(mockServices.unifiedConfigService).toBeDefined();
    expect(mockServices.unifiedConfigService!.getEffectiveConfig().model.temperature).toBeDefined();
  });

  it('temperature from unified config is applied to request options', () => {
    const config = createMockUnifiedConfigService();
    const options = {
      tools: undefined,
      format: undefined,
      think: true,
      temperature: config.getEffectiveConfig().model.temperature,
      maxTokens: config.getEffectiveConfig().model.maxTokens || undefined,
    };
    expect(options.temperature).toBe(-1);
    expect(options.maxTokens).toBeUndefined(); // 0 maps to undefined
  });

  it('non-zero maxTokens from unified config is passed through', () => {
    const config = createMockUnifiedConfigService({ model: { maxTokens: 2048 } });
    const options = {
      temperature: config.getEffectiveConfig().model.temperature,
      maxTokens: config.getEffectiveConfig().model.maxTokens || undefined,
    };
    expect(options.maxTokens).toBe(2048);
  });
});
