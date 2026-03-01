// Unit tests for chatModeCapabilities — M9 Cap 4 Task 4.1

import { describe, it, expect } from 'vitest';
import { ChatMode } from '../../src/services/chatTypes';
import {
  getModeCapabilities,
  shouldIncludeTools,
  shouldUseStructuredOutput,
} from '../../src/built-in/chat/chatModeCapabilities';
import type { IChatModeCapabilities } from '../../src/built-in/chat/chatModeCapabilities';

// ── getModeCapabilities ──

describe('getModeCapabilities', () => {
  it('returns capabilities for Ask mode', () => {
    const caps = getModeCapabilities(ChatMode.Ask);
    expect(caps).toEqual({
      canReadContext: true,
      canInvokeTools: false,
      canProposeEdits: false,
      canAutonomous: false,
    });
  });

  it('returns capabilities for Edit mode', () => {
    const caps = getModeCapabilities(ChatMode.Edit);
    expect(caps).toEqual({
      canReadContext: true,
      canInvokeTools: false,
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
    const caps = getModeCapabilities(ChatMode.Ask);
    expect(Object.isFrozen(caps)).toBe(true);
  });

  it('returns the same object reference for repeated calls', () => {
    const a = getModeCapabilities(ChatMode.Agent);
    const b = getModeCapabilities(ChatMode.Agent);
    expect(a).toBe(b);
  });

  it('all modes have canReadContext = true', () => {
    for (const mode of [ChatMode.Ask, ChatMode.Edit, ChatMode.Agent]) {
      expect(getModeCapabilities(mode).canReadContext).toBe(true);
    }
  });
});

// ── shouldIncludeTools ──

describe('shouldIncludeTools', () => {
  it('returns false for Ask mode', () => {
    expect(shouldIncludeTools(ChatMode.Ask)).toBe(false);
  });

  it('returns false for Edit mode', () => {
    expect(shouldIncludeTools(ChatMode.Edit)).toBe(false);
  });

  it('returns true for Agent mode', () => {
    expect(shouldIncludeTools(ChatMode.Agent)).toBe(true);
  });
});

// ── shouldUseStructuredOutput ──

describe('shouldUseStructuredOutput', () => {
  it('returns false for Ask mode (no edits, no structured output)', () => {
    expect(shouldUseStructuredOutput(ChatMode.Ask)).toBe(false);
  });

  it('returns true for Edit mode (edits with structured JSON)', () => {
    expect(shouldUseStructuredOutput(ChatMode.Edit)).toBe(true);
  });

  it('returns false for Agent mode (tools + free-form, not structured)', () => {
    // Agent can propose edits but uses tools, not structured output
    expect(shouldUseStructuredOutput(ChatMode.Agent)).toBe(false);
  });
});
