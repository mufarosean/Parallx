// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { ChatContextPills } from '../../src/built-in/chat/input/chatContextPills';
import type { IContextPill } from '../../src/services/chatTypes';

function createPill(overrides: Partial<IContextPill> = {}): IContextPill {
  return {
    id: 'Claims Guide.md',
    label: 'Claims Guide.md',
    type: 'rag',
    tokens: 120,
    removable: true,
    ...overrides,
  };
}

describe('ChatContextPills', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders as a hidden toolbar control until pills exist', () => {
    const container = document.createElement('div');
    const pills = new ChatContextPills(container);

    expect(container.querySelector('.parallx-chat-context-menu')).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).style.display).toBe('none');

    pills.setPills([createPill()]);
    expect((container.firstElementChild as HTMLElement).style.display).toBe('');
    expect(container.querySelector('.parallx-chat-context-menu-trigger')?.textContent).toContain('Context 1');
  });

  it('opens as a menu and keeps exclusions functional', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const pills = new ChatContextPills(container);
    pills.setPills([createPill(), createPill({ id: 'memory:session-recall', label: 'Session memory', type: 'memory' })]);

    const trigger = container.querySelector('.parallx-chat-context-menu-trigger') as HTMLButtonElement;
    trigger.click();

    const menu = document.body.querySelector('.parallx-chat-context-menu-panel') as HTMLElement;
    expect(menu.style.display).toBe('');
    expect(menu.textContent).toContain('Sources For Next Turn');

    const removeBtn = menu.querySelector('button[aria-label="Remove Claims Guide.md"]') as HTMLButtonElement;
    removeBtn.click();

    expect(pills.getExcluded().has('Claims Guide.md')).toBe(true);
    expect(trigger.textContent).toContain('1 excluded');
  });

  it('groups menu pills by source type in a stable order', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const pills = new ChatContextPills(container);
    pills.setPills([
      createPill({ id: 'system-prompt', label: 'System prompt', type: 'system', removable: false }),
      createPill({ id: 'notes.txt', label: 'notes.txt', type: 'attachment' }),
      createPill({ id: 'memory:session-recall', label: 'Session memory', type: 'memory' }),
      createPill({ id: 'rule:claims', label: 'Claims rule', type: 'rule' }),
      createPill({ id: 'concept:recall', label: 'Concept recall', type: 'concept' }),
      createPill({ id: 'Claims Guide.md', label: 'Claims Guide.md', type: 'rag' }),
    ]);

    const trigger = container.querySelector('.parallx-chat-context-menu-trigger') as HTMLButtonElement;
    trigger.click();

    const headers = [...document.body.querySelectorAll('.parallx-chat-context-group-title-text')].map((el) => el.textContent);
    expect(headers).toEqual([
      'Attachments',
      'Retrieved Sources',
      'Session Memory',
      'Concept Recall',
      'Rules',
      'System',
    ]);
  });

  it('supports zoom controls for larger menu readability', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const pills = new ChatContextPills(container);
    pills.setPills([createPill(), createPill({ id: 'notes.txt', label: 'notes.txt', type: 'attachment' })]);

    const trigger = container.querySelector('.parallx-chat-context-menu-trigger') as HTMLButtonElement;
    trigger.click();

    const zoomInBtn = document.body.querySelector('button[aria-label="Zoom in context menu"]') as HTMLButtonElement;
    const menu = document.body.querySelector('.parallx-chat-context-menu-panel') as HTMLElement;
    zoomInBtn.click();

    expect(menu.classList.contains('parallx-chat-context-menu-panel--zoom-2')).toBe(true);
    expect(document.body.textContent).toContain('115%');
  });
});