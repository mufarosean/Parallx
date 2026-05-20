/**
 * M70 App Command Control — policy unit tests.
 *
 * Verifies:
 *  - Denylist enforcement (excluded ids refused regardless of `aiInvocable`)
 *  - Opt-in registry (only commands with `aiInvocable: true` surfaced)
 *  - Text search ranking and stable ordering
 *  - "All query tokens must hit" filter
 */

import { describe, it, expect } from 'vitest';
import type { CommandDescriptor, ICommandRegistry } from '../../src/commands/commandTypes';
import {
  M70_EXCLUDED_COMMANDS,
  findAIInvocableCommands,
  isCommandAIInvocable,
  isCommandExcludedForAI,
  listAIInvocableCommands,
} from '../../src/commands/m70CommandPolicy';

function mockDescriptor(partial: Partial<CommandDescriptor>): CommandDescriptor {
  return {
    id: 'noop',
    title: 'Noop',
    handler: () => undefined,
    ...partial,
  };
}

function mockRegistry(descriptors: CommandDescriptor[]): Pick<ICommandRegistry, 'getCommands'> {
  const map = new Map<string, CommandDescriptor>();
  for (const d of descriptors) map.set(d.id, d);
  return { getCommands: () => map };
}

describe('M70 command policy', () => {
  describe('isCommandExcludedForAI', () => {
    it('returns true for every entry in the denylist', () => {
      for (const id of M70_EXCLUDED_COMMANDS) {
        expect(isCommandExcludedForAI(id)).toBe(true);
      }
    });

    it('returns false for opt-in-ready ids', () => {
      expect(isCommandExcludedForAI('workbench.action.toggleSidebar')).toBe(false);
      expect(isCommandExcludedForAI('layout.reset')).toBe(false);
    });

    it('always excludes AI-settings mutation surfaces', () => {
      expect(isCommandExcludedForAI('chat.selectModel')).toBe(true);
      expect(isCommandExcludedForAI('aiSettings.manageTools')).toBe(true);
      expect(isCommandExcludedForAI('ai-settings.open')).toBe(true);
    });

    it('always excludes destructive workspace lifecycle commands', () => {
      expect(isCommandExcludedForAI('workspace.resetConfig')).toBe(true);
      expect(isCommandExcludedForAI('workspace.closeWindow')).toBe(true);
      expect(isCommandExcludedForAI('workspace.switch')).toBe(true);
    });
  });

  describe('isCommandAIInvocable', () => {
    it('returns false when the descriptor is undefined', () => {
      expect(isCommandAIInvocable(undefined)).toBe(false);
    });

    it('returns false when aiInvocable is omitted or false', () => {
      expect(isCommandAIInvocable(mockDescriptor({ id: 'plain' }))).toBe(false);
      expect(isCommandAIInvocable(mockDescriptor({ id: 'plain', aiInvocable: false }))).toBe(false);
    });

    it('returns true when aiInvocable is true and id is not denylisted', () => {
      const d = mockDescriptor({
        id: 'workbench.action.toggleSidebar',
        aiInvocable: true,
        aiDescription: 'Toggle the sidebar.',
      });
      expect(isCommandAIInvocable(d)).toBe(true);
    });

    it('Gate 2: denylist wins over aiInvocable: true', () => {
      const sneaky = mockDescriptor({
        id: 'workspace.resetConfig',
        aiInvocable: true,
        aiDescription: 'Wipe everything (would be a disaster).',
      });
      expect(isCommandAIInvocable(sneaky)).toBe(false);
    });
  });

  describe('listAIInvocableCommands', () => {
    it('returns only opt-in, non-denylisted commands as summaries', () => {
      const registry = mockRegistry([
        mockDescriptor({
          id: 'workbench.action.toggleSidebar',
          title: 'Toggle Sidebar',
          category: 'View',
          aiInvocable: true,
          aiDescription: 'Show or hide the sidebar.',
        }),
        mockDescriptor({ id: 'plain.command', title: 'Not opted in' }),
        mockDescriptor({
          id: 'workspace.resetConfig',
          title: 'Reset',
          aiInvocable: true, // sneaky
          aiDescription: 'Reset workspace config.',
        }),
      ]);

      const list = listAIInvocableCommands(registry);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe('workbench.action.toggleSidebar');
      expect(list[0]?.aiDescription).toBe('Show or hide the sidebar.');
      expect(list[0]?.category).toBe('View');
    });

    it('falls back to title when aiDescription is missing', () => {
      const registry = mockRegistry([
        mockDescriptor({
          id: 'foo.bar',
          title: 'Foo Bar',
          aiInvocable: true,
          // aiDescription intentionally omitted
        }),
      ]);
      const list = listAIInvocableCommands(registry);
      expect(list[0]?.aiDescription).toBe('Foo Bar');
    });
  });

  describe('findAIInvocableCommands', () => {
    const registry = mockRegistry([
      mockDescriptor({
        id: 'workbench.action.toggleSidebar',
        title: 'Toggle Primary Sidebar',
        aiInvocable: true,
        aiDescription: 'Show or hide the primary sidebar.',
      }),
      mockDescriptor({
        id: 'workbench.action.togglePanel',
        title: 'Toggle Panel',
        aiInvocable: true,
        aiDescription: 'Show or hide the bottom panel.',
      }),
      mockDescriptor({
        id: 'workspaceGraph.open',
        title: 'Workspace Graph: Open',
        aiInvocable: true,
        aiDescription: 'Open the workspace graph visualization.',
      }),
      mockDescriptor({
        id: 'workbench.action.selectTheme',
        title: 'Color Theme',
        aiInvocable: true,
        aiDescription: 'Open the color theme picker.',
      }),
      mockDescriptor({ id: 'private.command', title: 'Hidden' }),
    ]);

    it('ranks id matches highest, then title, then description', () => {
      const results = findAIInvocableCommands(registry, 'sidebar', 5);
      expect(results[0]?.id).toBe('workbench.action.toggleSidebar');
    });

    it('requires every query token to match somewhere (AND semantics)', () => {
      const results = findAIInvocableCommands(registry, 'toggle nonsense', 5);
      expect(results).toEqual([]);
    });

    it('does not surface non-aiInvocable commands even if they match', () => {
      const results = findAIInvocableCommands(registry, 'hidden', 5);
      expect(results).toEqual([]);
    });

    it('finds across word boundaries via tokenizer (hyphens/underscores/case)', () => {
      const results = findAIInvocableCommands(registry, 'workspace graph', 5);
      expect(results[0]?.id).toBe('workspaceGraph.open');
    });

    it('respects the limit parameter', () => {
      const results = findAIInvocableCommands(registry, 'toggle', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('returns a stable order: by score desc then id asc', () => {
      // Two entries tied on score for "toggle" — id ordering decides.
      const results = findAIInvocableCommands(registry, 'toggle', 5);
      const ids = results.map(r => r.id);
      // Both should appear and be sorted alphabetically when tied.
      expect(ids).toContain('workbench.action.togglePanel');
      expect(ids).toContain('workbench.action.toggleSidebar');
      const panelIdx = ids.indexOf('workbench.action.togglePanel');
      const sidebarIdx = ids.indexOf('workbench.action.toggleSidebar');
      expect(panelIdx).toBeLessThan(sidebarIdx); // panel < sidebar alphabetically
    });

    it('empty query returns the first N opt-in commands (so "what can you do" returns something)', () => {
      const results = findAIInvocableCommands(registry, '', 3);
      expect(results.length).toBe(3);
      // None should be the hidden one
      expect(results.every(r => r.id !== 'private.command')).toBe(true);
    });
  });
});
