import { describe, expect, it, vi } from 'vitest';

import { buildChatWidgetSessionServices } from '../../src/built-in/chat/utilities/chatWidgetSessionAdapter';

describe('chat widget session adapter', () => {
  it('delegates session lifecycle operations', () => {
    const sessions = [{ id: 'session-1' }, { id: 'session-2' }] as any;
    const getSessions = vi.fn(() => sessions);
    const getSession = vi.fn((id: string) => sessions.find((session: any) => session.id === id));
    const deleteSession = vi.fn();

    const services = buildChatWidgetSessionServices({
      getSessions,
      getSession,
      deleteSession,
      getSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
    });

    expect(services.getSessions()).toBe(sessions);
    expect(services.getSession?.('session-2')).toEqual({ id: 'session-2' });
    services.deleteSession?.('session-1');
    expect(deleteSession).toHaveBeenCalledWith('session-1');
  });

  it('delegates prompt, file, and session search operations', async () => {
    const getSystemPrompt = vi.fn().mockResolvedValue('prompt');
    const readFileRelative = vi.fn().mockResolvedValue('content');
    const writeFileRelative = vi.fn().mockResolvedValue(undefined);
    const searchSessions = vi.fn().mockResolvedValue([
      { sessionId: 'session-1', sessionTitle: 'Claim', matchingContent: 'claim details' },
    ]);

    const services = buildChatWidgetSessionServices({
      getSessions: vi.fn(() => []),
      getSession: vi.fn(),
      deleteSession: vi.fn(),
      getSystemPrompt,
      readFileRelative,
      writeFileRelative,
      searchSessions,
    });

    await expect(services.getSystemPrompt?.()).resolves.toBe('prompt');
    await expect(services.readFileRelative?.('Claims Guide.md')).resolves.toBe('content');
    await services.writeFileRelative?.('Claims Guide.md', 'updated');
    await expect(services.searchSessions?.('claim')).resolves.toEqual([
      { sessionId: 'session-1', sessionTitle: 'Claim', matchingContent: 'claim details' },
    ]);

    expect(readFileRelative).toHaveBeenCalledWith('Claims Guide.md');
    expect(writeFileRelative).toHaveBeenCalledWith('Claims Guide.md', 'updated');
    expect(searchSessions).toHaveBeenCalledWith('claim');
  });
});