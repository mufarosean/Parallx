// @vitest-environment jsdom

// tests/unit/chatGuiComponents.test.ts — Chat GUI component tests
//
// Tests for ChatHeaderPart, ChatSessionSidebar, ChatContextIndicator,
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
    expect(title!.textContent).toBe('CHAT');

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
    expect(title!.textContent).toBe('CHAT');

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

// ── ChatSessionSidebar (VS Code-style date-grouped panel) ──

describe('ChatSessionSidebar', () => {

  let container: HTMLElement;

  // Spread sessions across date groups for comprehensive tests
  const NOW = Date.now();
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  const mockSessions = [
    {
      id: 'session-today',
      sessionResource: { scheme: 'parallx-chat-session', path: '/session-today' },
      createdAt: NOW - HOUR,           // 1 hour ago → Today
      title: 'Today Chat',
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
      id: 'session-week',
      sessionResource: { scheme: 'parallx-chat-session', path: '/session-week' },
      createdAt: NOW - 3 * DAY,        // 3 days ago → Last 7 Days
      title: 'Week Chat',
      mode: 'agent' as const,
      modelId: 'llama3.1:8b',
      messages: [
        {
          request: { text: 'Help me build something', participantId: undefined, commandId: undefined, variables: [] },
          response: { parts: [], isComplete: true },
        },
        {
          request: { text: 'Follow up', participantId: undefined, commandId: undefined, variables: [] },
          response: { parts: [], isComplete: true },
        },
      ],
      requestInProgress: false,
    },
    {
      id: 'session-old',
      sessionResource: { scheme: 'parallx-chat-session', path: '/session-old' },
      createdAt: NOW - 60 * DAY,       // 60 days ago → Older
      title: 'Old Chat',
      mode: 'ask' as const,
      modelId: 'llama3.1:8b',
      messages: [],
      requestInProgress: false,
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders visible by default with sessions', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    const root = container.querySelector('.parallx-chat-session-sidebar');
    expect(root).toBeTruthy();

    // Should be visible by default
    expect(sidebar.isVisible).toBe(true);
    expect(sidebar.isExpanded).toBe(true); // alias
    expect(root!.classList.contains('parallx-chat-session-sidebar--visible')).toBe(true);

    // Sessions should already be rendered
    const items = container.querySelectorAll('.parallx-chat-session-sidebar-item');
    expect(items.length).toBe(3);

    sidebar.dispose();
  });

  it('toggle() hides panel when visible by default', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    // Starts visible
    expect(sidebar.isVisible).toBe(true);

    // First toggle hides it
    sidebar.toggle();
    expect(sidebar.isVisible).toBe(false);

    const root = container.querySelector('.parallx-chat-session-sidebar');
    expect(root!.classList.contains('parallx-chat-session-sidebar--visible')).toBe(false);

    sidebar.dispose();
  });

  it('groups sessions by date with section headers', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    const sectionHeaders = container.querySelectorAll('.parallx-chat-session-sidebar-section-header');
    // Should have 3 groups: Today, Last 7 Days, Older
    expect(sectionHeaders.length).toBe(3);

    const labels = [...sectionHeaders].map(
      (h) => h.querySelector('.parallx-chat-session-sidebar-section-label')!.textContent,
    );
    expect(labels).toEqual(['Today', 'Last 7 Days', 'Older']);

    // Each header shows its count
    const counts = [...sectionHeaders].map(
      (h) => h.querySelector('.parallx-chat-session-sidebar-section-count')!.textContent,
    );
    expect(counts).toEqual(['1', '1', '1']);

    sidebar.dispose();
  });

  it('collapses a section when its header is clicked', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    // Initially 3 items (visible by default)
    expect(container.querySelectorAll('.parallx-chat-session-sidebar-item').length).toBe(3);

    // Click the "Today" section header to collapse it
    const firstHeader = container.querySelector('.parallx-chat-session-sidebar-section-header') as HTMLElement;
    firstHeader.click();

    // Now only 2 items (Today's item is hidden)
    expect(container.querySelectorAll('.parallx-chat-session-sidebar-item').length).toBe(2);

    // Re-query after re-render — the chevron on the first header should be collapsed (SVG right arrow)
    const newFirstHeader = container.querySelector('.parallx-chat-session-sidebar-section-header') as HTMLElement;
    const chevron = newFirstHeader.querySelector('.parallx-chat-session-sidebar-chevron');
    expect(chevron!.querySelector('svg')).toBeTruthy();

    sidebar.dispose();
  });

  it('displays titles, metadata, and preview', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    const titles = container.querySelectorAll('.parallx-chat-session-sidebar-item-title');
    expect(titles[0]!.textContent).toBe('Today Chat');

    const metas = container.querySelectorAll('.parallx-chat-session-sidebar-item-meta');
    expect(metas[0]!.textContent).toContain('1 msg');

    // First session has a message preview
    const previews = container.querySelectorAll('.parallx-chat-session-sidebar-item-preview');
    expect(previews.length).toBeGreaterThan(0);
    expect(previews[0]!.textContent).toBe('Hello world');

    sidebar.dispose();
  });

  it('fires onDidSelectSession when a session info area is clicked', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    const spy = vi.fn();
    sidebar.onDidSelectSession(spy);

    const infoEl = container.querySelector('.parallx-chat-session-sidebar-item-info') as HTMLElement;
    infoEl.click();
    expect(spy).toHaveBeenCalledWith('session-today');

    sidebar.dispose();
  });

  it('double toggle() restores panel to visible', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    // Starts visible → toggle hides → toggle shows again
    sidebar.toggle();
    expect(sidebar.isVisible).toBe(false);

    sidebar.toggle();
    expect(sidebar.isVisible).toBe(true);

    sidebar.dispose();
  });

  it('shows empty state when no sessions exist', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => [],
      deleteSession: vi.fn(),
    });

    // Visible by default — empty state should already be rendered
    const empty = container.querySelector('.parallx-chat-session-sidebar-empty');
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain('No sessions yet');

    sidebar.dispose();
  });

  it('highlights the active session with --active class', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    sidebar.setActiveSession('session-today');

    const activeItem = container.querySelector('.parallx-chat-session-sidebar-item--active');
    expect(activeItem).toBeTruthy();
    const title = activeItem!.querySelector('.parallx-chat-session-sidebar-item-title');
    expect(title!.textContent).toBe('Today Chat');

    sidebar.dispose();
  });

  it('calls deleteSession and re-renders on delete button click', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const deleteSpy = vi.fn();
    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: deleteSpy,
    });

    const deleteBtn = container.querySelector('.parallx-chat-session-sidebar-item-delete') as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    deleteBtn.click();
    expect(deleteSpy).toHaveBeenCalledWith('session-today');

    sidebar.dispose();
  });

  it('fires onDidRequestNewSession from header new button', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    const spy = vi.fn();
    sidebar.onDidRequestNewSession(spy);

    const newBtn = container.querySelector('.parallx-chat-sidebar-btn--new') as HTMLButtonElement;
    expect(newBtn).toBeTruthy();
    newBtn.click();
    expect(spy).toHaveBeenCalledTimes(1);

    sidebar.dispose();
  });

  it('fires onDidToggle with boolean visibility state', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    const spy = vi.fn();
    sidebar.onDidToggle(spy);

    // Starts visible, first toggle hides
    sidebar.toggle();
    expect(spy).toHaveBeenCalledWith(false);

    sidebar.toggle();
    expect(spy).toHaveBeenCalledWith(true);

    sidebar.dispose();
  });

  it('filter input filters sessions by title and preview', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    // Initially 3 sessions (visible by default)
    expect(container.querySelectorAll('.parallx-chat-session-sidebar-item').length).toBe(3);

    // Toggle filter visible by clicking search button
    const searchBtn = container.querySelectorAll('.parallx-chat-sidebar-btn')[1] as HTMLButtonElement;
    searchBtn.click();

    const filterInput = container.querySelector('.parallx-chat-session-sidebar-filter-input') as HTMLInputElement;
    expect(filterInput).toBeTruthy();
    expect(filterInput.parentElement!.style.display).not.toBe('none');

    // Type a filter query
    filterInput.value = 'today';
    filterInput.dispatchEvent(new Event('input'));

    // Only Today Chat matches
    const items = container.querySelectorAll('.parallx-chat-session-sidebar-item');
    expect(items.length).toBe(1);
    expect(items[0]!.querySelector('.parallx-chat-session-sidebar-item-title')!.textContent).toBe('Today Chat');

    sidebar.dispose();
  });

  it('shows "No matching sessions" when filter matches nothing', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    // Toggle filter visible (sidebar already visible by default)
    const searchBtn = container.querySelectorAll('.parallx-chat-sidebar-btn')[1] as HTMLButtonElement;
    searchBtn.click();

    const filterInput = container.querySelector('.parallx-chat-session-sidebar-filter-input') as HTMLInputElement;
    filterInput.value = 'zzz_nonexistent_zzz';
    filterInput.dispatchEvent(new Event('input'));

    const empty = container.querySelector('.parallx-chat-session-sidebar-empty');
    expect(empty!.style.display).not.toBe('none');
    expect(empty!.textContent).toBe('No matching sessions');

    sidebar.dispose();
  });

  it('cleans up DOM on dispose', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    expect(container.querySelector('.parallx-chat-session-sidebar')).toBeTruthy();
    sidebar.dispose();
    expect(container.querySelector('.parallx-chat-session-sidebar')).toBeNull();
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
