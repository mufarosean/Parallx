// @vitest-environment jsdom

// tests/unit/chatGuiComponents.test.ts — Chat GUI component tests
//
// Tests for ChatSessionSidebar and the enhanced empty state with feature hints.

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
      mode: 'agent' as const,
      modelId: 'llama3.1:8b',
      contextWindowOverride: 0,
      messages: [
        {
          request: { text: 'Hello world', requestId: 'req-1', participantId: undefined, variables: [], attempt: 0, timestamp: NOW - HOUR },
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
      contextWindowOverride: 0,
      messages: [
        {
          request: { text: 'Help me build something', requestId: 'req-2', participantId: undefined, variables: [], attempt: 0, timestamp: NOW - 3 * DAY },
          response: { parts: [], isComplete: true },
        },
        {
          request: { text: 'Follow up', requestId: 'req-3', participantId: undefined, variables: [], attempt: 0, timestamp: NOW - 3 * DAY + 1000 },
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
      mode: 'agent' as const,
      modelId: 'llama3.1:8b',
      contextWindowOverride: 0,
      messages: [],
      requestInProgress: false,
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders visible by default with sessions', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

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

    const items = container.querySelectorAll('.parallx-chat-session-sidebar-item');
    expect(items.length).toBe(3);

    sidebar.dispose();
  });

  it('toggle() hides panel when visible by default', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

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
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    sidebar.show();
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
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    sidebar.show();
    // Initially 3 items
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

  it('displays titles and relative time', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    sidebar.show();
    const titles = container.querySelectorAll('.parallx-chat-session-sidebar-item-title');
    expect(titles[0]!.textContent).toBe('Today Chat');

    const times = container.querySelectorAll('.parallx-chat-session-sidebar-item-time');
    expect(times.length).toBeGreaterThan(0);
    expect(times[0]!.textContent).toBeTruthy();

    // Meta and preview rows no longer rendered
    expect(container.querySelectorAll('.parallx-chat-session-sidebar-item-meta').length).toBe(0);
    expect(container.querySelectorAll('.parallx-chat-session-sidebar-item-preview').length).toBe(0);

    sidebar.dispose();
  });

  it('fires onDidSelectSession when a session info area is clicked', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    sidebar.show();
    const spy = vi.fn();
    sidebar.onDidSelectSession(spy);

    const infoEl = container.querySelector('.parallx-chat-session-sidebar-item-info') as HTMLElement;
    infoEl.click();
    expect(spy).toHaveBeenCalledWith('session-today');

    sidebar.dispose();
  });

  it('double toggle() restores panel to visible', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

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
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => [],
      deleteSession: vi.fn(),
    });

    sidebar.show();
    const empty = container.querySelector('.parallx-chat-session-sidebar-empty');
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain('No sessions yet');

    sidebar.dispose();
  });

  it('highlights the active session with --active class', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    sidebar.show();
    sidebar.setActiveSession('session-today');

    const activeItem = container.querySelector('.parallx-chat-session-sidebar-item--active');
    expect(activeItem).toBeTruthy();
    const title = activeItem!.querySelector('.parallx-chat-session-sidebar-item-title');
    expect(title!.textContent).toBe('Today Chat');

    sidebar.dispose();
  });

  it('calls deleteSession and re-renders on delete button click', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const deleteSpy = vi.fn();
    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: deleteSpy,
    });

    sidebar.show();
    const deleteBtn = container.querySelector('.parallx-chat-session-sidebar-item-delete') as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    deleteBtn.click();
    expect(deleteSpy).toHaveBeenCalledWith('session-today');

    sidebar.dispose();
  });

  it('fires onDidToggle with boolean visibility state', async () => {
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

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
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    sidebar.show();
    // Initially 3 sessions
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
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    // Show sidebar first, then toggle filter visible
    sidebar.show();
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
    const { ChatSessionSidebar } = await import('../../src/built-in/chat/widgets/chatSessionSidebar');

    const sidebar = new ChatSessionSidebar(container, {
      getSessions: () => mockSessions as any,
      deleteSession: vi.fn(),
    });

    expect(container.querySelector('.parallx-chat-session-sidebar')).toBeTruthy();
    sidebar.dispose();
    expect(container.querySelector('.parallx-chat-session-sidebar')).toBeNull();
  });
});
