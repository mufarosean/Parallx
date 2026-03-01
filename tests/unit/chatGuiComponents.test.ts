// @vitest-environment jsdom

// tests/unit/chatGuiComponents.test.ts — Chat GUI component tests
//
// Tests for ChatHeaderPart, ChatSessionHistory, ChatContextIndicator,
// and the enhanced empty state with feature hints.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── ChatHeaderPart ──

describe('ChatHeaderPart', () => {

  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders header with title and action buttons', async () => {
    const { ChatHeaderPart } = await import('../../src/built-in/chat/chatHeaderPart');
    const header = new ChatHeaderPart(container);

    const root = container.querySelector('.parallx-chat-header');
    expect(root).toBeTruthy();

    const title = root!.querySelector('.parallx-chat-header-title');
    expect(title).toBeTruthy();
    expect(title!.textContent).toBe('Chat');

    const buttons = root!.querySelectorAll('.parallx-chat-header-btn');
    expect(buttons.length).toBe(3); // new, history, clear

    header.dispose();
  });

  it('setTitle updates the title text', async () => {
    const { ChatHeaderPart } = await import('../../src/built-in/chat/chatHeaderPart');
    const header = new ChatHeaderPart(container);

    header.setTitle('My Chat');
    const title = container.querySelector('.parallx-chat-header-title');
    expect(title!.textContent).toBe('My Chat');

    header.setTitle('');
    expect(title!.textContent).toBe('Chat');

    header.dispose();
  });

  it('setSessionInfo updates the info text', async () => {
    const { ChatHeaderPart } = await import('../../src/built-in/chat/chatHeaderPart');
    const header = new ChatHeaderPart(container);

    header.setSessionInfo('3 messages · Ask');
    const info = container.querySelector('.parallx-chat-header-session-info');
    expect(info!.textContent).toBe('3 messages · Ask');

    header.dispose();
  });

  it('fires onNewChat when new button is clicked', async () => {
    const { ChatHeaderPart } = await import('../../src/built-in/chat/chatHeaderPart');
    const header = new ChatHeaderPart(container);

    const spy = vi.fn();
    header.onNewChat(spy);

    const newBtn = container.querySelector('.parallx-chat-header-btn--new') as HTMLButtonElement;
    newBtn.click();
    expect(spy).toHaveBeenCalledTimes(1);

    header.dispose();
  });

  it('fires onToggleHistory when history button is clicked', async () => {
    const { ChatHeaderPart } = await import('../../src/built-in/chat/chatHeaderPart');
    const header = new ChatHeaderPart(container);

    const spy = vi.fn();
    header.onToggleHistory(spy);

    const historyBtn = container.querySelector('.parallx-chat-header-btn--history') as HTMLButtonElement;
    historyBtn.click();
    expect(spy).toHaveBeenCalledTimes(1);

    header.dispose();
  });

  it('fires onClearSession when clear button is clicked', async () => {
    const { ChatHeaderPart } = await import('../../src/built-in/chat/chatHeaderPart');
    const header = new ChatHeaderPart(container);

    const spy = vi.fn();
    header.onClearSession(spy);

    const clearBtn = container.querySelector('.parallx-chat-header-btn--clear') as HTMLButtonElement;
    clearBtn.click();
    expect(spy).toHaveBeenCalledTimes(1);

    header.dispose();
  });

  it('cleans up DOM on dispose', async () => {
    const { ChatHeaderPart } = await import('../../src/built-in/chat/chatHeaderPart');
    const header = new ChatHeaderPart(container);

    expect(container.querySelector('.parallx-chat-header')).toBeTruthy();
    header.dispose();
    expect(container.querySelector('.parallx-chat-header')).toBeNull();
  });
});

// ── ChatSessionHistory ──

describe('ChatSessionHistory', () => {

  let container: HTMLElement;
  const mockSessions = [
    {
      id: 'session-1',
      sessionResource: { scheme: 'parallx-chat-session', path: '/session-1' },
      createdAt: Date.now() - 3600_000, // 1 hour ago
      title: 'First Chat',
      mode: 'ask' as const,
      modelId: 'llama3.1:8b',
      messages: [
        {
          request: { text: 'Hello world', participantId: undefined, commandId: undefined, variables: [] },
          response: { parts: [], isComplete: true },
        },
      ],
      requestInProgress: false,
    },
    {
      id: 'session-2',
      sessionResource: { scheme: 'parallx-chat-session', path: '/session-2' },
      createdAt: Date.now() - 86400_000, // 1 day ago
      title: 'Second Chat',
      mode: 'agent' as const,
      modelId: 'llama3.1:8b',
      messages: [],
      requestInProgress: false,
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    container.style.position = 'relative';
    document.body.appendChild(container);
  });

  it('creates and shows session history overlay', async () => {
    const { ChatSessionHistory } = await import('../../src/built-in/chat/chatSessionHistory');

    const history = new ChatSessionHistory(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    history.show();
    expect(history.isVisible).toBe(true);

    const overlay = container.querySelector('.parallx-chat-history-overlay');
    expect(overlay).toBeTruthy();

    const items = overlay!.querySelectorAll('.parallx-chat-history-item');
    expect(items.length).toBe(2);

    history.dispose();
  });

  it('displays session titles and metadata', async () => {
    const { ChatSessionHistory } = await import('../../src/built-in/chat/chatSessionHistory');

    const history = new ChatSessionHistory(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    history.show();

    const titles = container.querySelectorAll('.parallx-chat-history-item-title');
    expect(titles[0]!.textContent).toBe('First Chat');
    expect(titles[1]!.textContent).toBe('Second Chat');

    const metas = container.querySelectorAll('.parallx-chat-history-item-meta');
    expect(metas[0]!.textContent).toContain('1 message');
    expect(metas[1]!.textContent).toContain('0 messages');

    history.dispose();
  });

  it('fires onDidSelectSession when a session is clicked', async () => {
    const { ChatSessionHistory } = await import('../../src/built-in/chat/chatSessionHistory');

    const history = new ChatSessionHistory(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    const spy = vi.fn();
    history.onDidSelectSession(spy);

    history.show();

    const infoEl = container.querySelector('.parallx-chat-history-item-info') as HTMLElement;
    infoEl.click();
    expect(spy).toHaveBeenCalledWith('session-1');

    history.dispose();
  });

  it('hides overlay on hide()', async () => {
    const { ChatSessionHistory } = await import('../../src/built-in/chat/chatSessionHistory');

    const history = new ChatSessionHistory(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    history.show();
    expect(history.isVisible).toBe(true);

    history.hide();
    expect(history.isVisible).toBe(false);
    expect(container.querySelector('.parallx-chat-history-overlay')).toBeNull();

    history.dispose();
  });

  it('toggles visibility', async () => {
    const { ChatSessionHistory } = await import('../../src/built-in/chat/chatSessionHistory');

    const history = new ChatSessionHistory(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    history.toggle();
    expect(history.isVisible).toBe(true);

    history.toggle();
    expect(history.isVisible).toBe(false);

    history.dispose();
  });

  it('shows empty state when no sessions', async () => {
    const { ChatSessionHistory } = await import('../../src/built-in/chat/chatSessionHistory');

    const history = new ChatSessionHistory(container, {
      getSessions: () => [],
      deleteSession: vi.fn(),
    });

    history.show();

    const empty = container.querySelector('.parallx-chat-history-empty');
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain('No chat sessions');

    history.dispose();
  });

  it('highlights the active session', async () => {
    const { ChatSessionHistory } = await import('../../src/built-in/chat/chatSessionHistory');

    const history = new ChatSessionHistory(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    history.toggle('session-1');

    const activeItem = container.querySelector('.parallx-chat-history-item--active');
    expect(activeItem).toBeTruthy();
    const title = activeItem!.querySelector('.parallx-chat-history-item-title');
    expect(title!.textContent).toBe('First Chat');

    history.dispose();
  });

  it('calls deleteSession when delete button is clicked', async () => {
    const { ChatSessionHistory } = await import('../../src/built-in/chat/chatSessionHistory');

    const deleteSpy = vi.fn();
    const history = new ChatSessionHistory(container, {
      getSessions: () => mockSessions as any,
      deleteSession: deleteSpy,
    });

    history.toggle('session-1');

    // session-2 is not active, so it should have a delete button
    const deleteBtn = container.querySelector('.parallx-chat-history-item-delete') as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    deleteBtn.click();
    expect(deleteSpy).toHaveBeenCalledWith('session-2');

    history.dispose();
  });
});

// ── ChatContextIndicator ──

describe('ChatContextIndicator', () => {

  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders context indicator elements', async () => {
    const { ChatContextIndicator } = await import('../../src/built-in/chat/chatContextIndicator');
    const indicator = new ChatContextIndicator(container, { getContextLength: () => 8192 });

    const root = container.querySelector('.parallx-chat-context-indicator');
    expect(root).toBeTruthy();

    const bar = container.querySelector('.parallx-chat-context-bar');
    expect(bar).toBeTruthy();

    const label = container.querySelector('.parallx-chat-context-label');
    expect(label).toBeTruthy();

    indicator.dispose();
  });

  it('hides initially', async () => {
    const { ChatContextIndicator } = await import('../../src/built-in/chat/chatContextIndicator');
    const indicator = new ChatContextIndicator(container, { getContextLength: () => 8192 });

    const root = container.querySelector('.parallx-chat-context-indicator') as HTMLElement;
    expect(root.style.display).toBe('none');

    indicator.dispose();
  });

  it('shows and updates when update() is called', async () => {
    const { ChatContextIndicator } = await import('../../src/built-in/chat/chatContextIndicator');
    const indicator = new ChatContextIndicator(container, { getContextLength: () => 8192 });

    indicator.update(4000); // ~1000 tokens out of 8192

    const root = container.querySelector('.parallx-chat-context-indicator') as HTMLElement;
    expect(root.style.display).not.toBe('none');

    const label = container.querySelector('.parallx-chat-context-label');
    expect(label!.textContent).toContain('1.0k');
    expect(label!.textContent).toContain('8k');

    indicator.dispose();
  });

  it('shows warning color at 70%+ usage', async () => {
    const { ChatContextIndicator } = await import('../../src/built-in/chat/chatContextIndicator');
    const indicator = new ChatContextIndicator(container, { getContextLength: () => 1000 });

    // 75% usage: 3000 chars = 750 tokens out of 1000
    indicator.update(3000);

    const fill = container.querySelector('.parallx-chat-context-bar-fill');
    expect(fill!.classList.contains('parallx-chat-context-bar-fill--warning')).toBe(true);
    expect(fill!.classList.contains('parallx-chat-context-bar-fill--danger')).toBe(false);

    indicator.dispose();
  });

  it('shows danger color at 90%+ usage', async () => {
    const { ChatContextIndicator } = await import('../../src/built-in/chat/chatContextIndicator');
    const indicator = new ChatContextIndicator(container, { getContextLength: () => 1000 });

    // 95% usage: 3800 chars = 950 tokens out of 1000
    indicator.update(3800);

    const fill = container.querySelector('.parallx-chat-context-bar-fill');
    expect(fill!.classList.contains('parallx-chat-context-bar-fill--danger')).toBe(true);

    indicator.dispose();
  });

  it('hides when context length is 0', async () => {
    const { ChatContextIndicator } = await import('../../src/built-in/chat/chatContextIndicator');
    const indicator = new ChatContextIndicator(container, { getContextLength: () => 0 });

    indicator.update(1000);

    const root = container.querySelector('.parallx-chat-context-indicator') as HTMLElement;
    expect(root.style.display).toBe('none');

    indicator.dispose();
  });

  it('hide() explicitly hides the indicator', async () => {
    const { ChatContextIndicator } = await import('../../src/built-in/chat/chatContextIndicator');
    const indicator = new ChatContextIndicator(container, { getContextLength: () => 8192 });

    indicator.update(4000); // show it
    const root = container.querySelector('.parallx-chat-context-indicator') as HTMLElement;
    expect(root.style.display).not.toBe('none');

    indicator.hide();
    expect(root.style.display).toBe('none');

    indicator.dispose();
  });

  it('cleans up DOM on dispose', async () => {
    const { ChatContextIndicator } = await import('../../src/built-in/chat/chatContextIndicator');
    const indicator = new ChatContextIndicator(container, { getContextLength: () => 8192 });

    expect(container.querySelector('.parallx-chat-context-indicator')).toBeTruthy();
    indicator.dispose();
    expect(container.querySelector('.parallx-chat-context-indicator')).toBeNull();
  });
});
