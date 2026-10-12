// inlineAIChatModule.test.ts — the inline AI chat controller is importable with its interface.

import { describe, it, expect } from 'vitest';

describe('InlineAIChatController', () => {
  it('module exports the controller class', async () => {
    const mod = await import('../../src/built-in/canvas/menus/inlineAIChat');
    expect(mod.InlineAIChatController).toBeDefined();
    expect(typeof mod.InlineAIChatController).toBe('function');
  });

  it('defines expected interface methods', async () => {
    const mod = await import('../../src/built-in/canvas/menus/inlineAIChat');
    const ctrl = Object.getOwnPropertyNames(mod.InlineAIChatController.prototype);
    expect(ctrl).toContain('create');
    expect(ctrl).toContain('hide');
    expect(ctrl).toContain('dispose');
    expect(ctrl).toContain('toggle');
    expect(ctrl).toContain('containsTarget');
  });
});
