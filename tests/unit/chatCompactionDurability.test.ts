import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ChatDataService } from '../../src/built-in/chat/data/chatDataService';
import { ChatMode, type IChatSession } from '../../src/services/chatTypes';
import { ensureChatTables, saveSession, loadSessions, type IChatPersistenceDatabase } from '../../src/services/chatSessionPersistence';
import { WorkspaceTranscriptService } from '../../src/services/workspaceTranscriptService';
import { URI } from '../../src/platform/uri';

function compactedSession() {
  const session: IChatSession = {
    id: 'compacted-session', sessionResource: URI.parse('parallx-chat-session:///compacted-session'),
    title: 'Inventory task', createdAt: 1788880000000, mode: ChatMode.Agent, modelId: 'fixture-model',
    messages: [], messagesPendingLoad: true, requestInProgress: false, pendingRequests: [],
    plan: { goal: 'Inventory task', steps: [{ text: 'Write revised.md', status: 'pending' }], updatedAt: 1788880000000 },
  };
  new ChatDataService({ chatService: { getSession: () => session } } as any)
    .compactSession(session.id, 'Inventory exists. Next: revised.md. Preserve NEBULA-11.');
  return session;
}

describe('compacted conversation durability', () => {
  it('saves and reloads the compacted pair and latest plan through actual SQLite constraints', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys=ON');
    const db: IChatPersistenceDatabase = {
      isOpen: true,
      run: async (sql, params = []) => ({ changes: Number(sqlite.prepare(sql).run(...params as any[]).changes) }),
      get: async (sql, params = []) => sqlite.prepare(sql).get(...params as any[]) as any,
      all: async (sql, params = []) => sqlite.prepare(sql).all(...params as any[]) as any,
    };
    try {
      await ensureChatTables(db);
      const session = compactedSession();
      await saveSession(db, session, 'fixture-workspace');
      const [restored] = await loadSessions(db, 'fixture-workspace');
      expect(restored.plan).toEqual(session.plan);
      expect(restored.messages[0].response.modelId).toBe('fixture-model');
      expect(restored.messages[0].response.timestamp).toBeGreaterThan(0);
      expect(restored.messages[0].response.parts).toEqual(session.messages[0].response.parts);
    } finally { sqlite.close(); }
  });

  it('writes the compacted transcript with valid request and response timestamps', async () => {
    const fileService = { exists: vi.fn(async () => true), writeFile: vi.fn(async () => {}) };
    const workspaceService = { folders: [{ uri: URI.file('D:/synthetic-fixture') }] };
    const transcript = new WorkspaceTranscriptService(fileService as any, workspaceService as any);
    try {
      await transcript.writeSessionTranscript(compactedSession());
      expect(fileService.writeFile).toHaveBeenCalledOnce();
      const content = (fileService.writeFile.mock.calls[0] as unknown as [URI, string])[1];
      const lines = content.trim().split('\n').map(line => JSON.parse(line));
      expect(lines.filter(line => line.type === 'message').every(line => Number.isFinite(Date.parse(line.timestamp)))).toBe(true);
      expect(content).toContain('NEBULA-11');
    } finally { transcript.dispose(); }
  });
});
