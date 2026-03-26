// Unit tests for chatModeCapabilities

import { describe, it, expect } from 'vitest';
import { ChatMode } from '../../src/services/chatTypes';
import {
  getModeCapabilities,
  shouldIncludeTools,
  shouldUseStructuredOutput,
} from '../../src/built-in/chat/config/chatModeCapabilities';
import type { IChatModeCapabilities } from '../../src/built-in/chat/config/chatModeCapabilities';

// ── getModeCapabilities ──

describe('getModeCapabilities', () => {
  it('returns capabilities for Edit mode', () => {
    const caps = getModeCapabilities(ChatMode.Edit);
    expect(caps).toEqual({
      canReadContext: true,
      canInvokeTools: true,
      canProposeEdits: true,
      canAutonomous: false,
    });
  });

  it('returns capabilities for Agent mode', () => {
    const caps = getModeCapabilities(ChatMode.Agent);
    expect(caps).toEqual({
      canReadContext: true,
      canInvokeTools: true,
      canProposeEdits: true,
      canAutonomous: true,
    });
  });

  it('returns frozen (immutable) objects', () => {
    const caps = getModeCapabilities(ChatMode.Agent);
    expect(Object.isFrozen(caps)).toBe(true);
  });

  it('returns the same object reference for repeated calls', () => {
    const a = getModeCapabilities(ChatMode.Agent);
    const b = getModeCapabilities(ChatMode.Agent);
    expect(a).toBe(b);
  });

  it('all modes have canReadContext = true', () => {
    for (const mode of [ChatMode.Edit, ChatMode.Agent]) {
      expect(getModeCapabilities(mode).canReadContext).toBe(true);
    }
  });

  it('falls back to Agent capabilities for unknown/legacy modes', () => {
    const caps = getModeCapabilities('ask' as ChatMode);
    expect(caps).toEqual(getModeCapabilities(ChatMode.Agent));
  });
});

// ── shouldIncludeTools ──

describe('shouldIncludeTools', () => {
  it('returns true for Edit mode (read-only tools)', () => {
    expect(shouldIncludeTools(ChatMode.Edit)).toBe(true);
  });

  it('returns true for Agent mode', () => {
    expect(shouldIncludeTools(ChatMode.Agent)).toBe(true);
  });
});

// ── shouldUseStructuredOutput ──

describe('shouldUseStructuredOutput', () => {
  it('returns true for Edit mode (edits with structured JSON)', () => {
    expect(shouldUseStructuredOutput(ChatMode.Edit)).toBe(true);
  });

  it('returns false for Agent mode (tools + free-form, not structured)', () => {
    expect(shouldUseStructuredOutput(ChatMode.Agent)).toBe(false);
  });
});
