// autonomousRunArchive.test.ts — M91 S1: the autonomous-run archive layer.
//
// Uses a small FUNCTIONAL in-memory engine (not a call-recorder) so the
// round-trip / retention semantics are actually exercised. It implements
// only the handful of statements the archive functions issue.

import { describe, expect, it } from 'vitest';
import { URI } from '../../src/platform/uri';
import { ChatMode } from '../../src/services/chatTypes';
import type { IChatSession } from '../../src/services/chatTypes';
import {
  archiveSession,
  loadArchivedRunSummaries,
  loadArchivedRun,
  loadSessions,
  saveSession,
  pruneArchivedRuns,
  type IChatPersistenceDatabase,
} from '../../src/services/chatSessionPersistence';

interface SessionRow { id: string; workspace_id: string; title: string; mode: string; model_id: string; context_window_override: number | null; plan_json: string | null; created_at: number; updated_at: number; origin: string | null }
interface MsgRow { session_id: string; role: string; content: string; parts_json: string; model_id: string; is_complete: number; timestamp: number; sort_order: number }

function makeDb(): IChatPersistenceDatabase {
  const sessions = new Map<string, SessionRow>();
  const messages: MsgRow[] = [];
  const cols = ['id', 'workspace_id', 'title', 'mode', 'model_id', 'context_window_override', 'plan_json', 'created_at', 'updated_at', 'origin'];

  const run = async (sql: string, params: unknown[] = []): Promise<{ changes: number }> => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT OR REPLACE INTO chat_sessions')) {
      const row = {} as SessionRow;
      cols.forEach((c, i) => { (row as Record<string, unknown>)[c] = params[i]; });
      sessions.set(row.id, row);
    } else if (s.startsWith('INSERT INTO chat_messages')) {
      const [session_id, role, content, parts_json, model_id, is_complete, timestamp, sort_order] = params as [string, string, string, string, string, number, number, number];
      messages.push({ session_id, role, content, parts_json, model_id, is_complete, timestamp, sort_order });
    } else if (s.startsWith('DELETE FROM chat_messages')) {
      const id = params[0];
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].session_id === id) messages.splice(i, 1);
    } else if (s.startsWith('DELETE FROM chat_sessions')) {
      sessions.delete(params[0] as string);
    } else if (s.startsWith('CREATE') || s.startsWith('ALTER') || s.startsWith('BEGIN') || s.startsWith('COMMIT') || s.startsWith('ROLLBACK') || s.startsWith('PRAGMA')) {
      /* schema/no-op */
    }
    return { changes: 0 };
  };

  return {
    isOpen: true,
    run,
    async runTransaction(ops) { for (const op of ops) await run(op.sql, op.params); return ops.map(() => ({})); },
    async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('FROM chat_sessions') && s.includes('origin IS NOT NULL') && s.includes('WHERE id = ?')) {
        const row = sessions.get(params[0] as string);
        return row && row.origin != null ? (row as unknown as T) : null;
      }
      return null;
    },
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('FROM chat_messages WHERE session_id = ?')) {
        return messages.filter((m) => m.session_id === params[0]).sort((a, b) => a.sort_order - b.sort_order) as unknown as T[];
      }
      if (s.includes('FROM chat_sessions s') && s.includes('origin IS NOT NULL')) {
        const wsId = params[0]; const limit = params[1] as number;
        const rows = [...sessions.values()].filter((r) => r.workspace_id === wsId && r.origin != null)
          .sort((a, b) => b.updated_at - a.updated_at).slice(0, limit)
          .map((r) => ({ id: r.id, origin: r.origin, title: r.title, created_at: r.created_at, updated_at: r.updated_at, n: messages.filter((m) => m.session_id === r.id).length }));
        return rows as unknown as T[];
      }
      if (s.includes('SELECT id FROM chat_sessions') && s.includes('OFFSET ?')) {
        const wsId = params[0]; const offset = params[1] as number;
        const ordered = [...sessions.values()].filter((r) => r.workspace_id === wsId && r.origin != null)
          .sort((a, b) => b.updated_at - a.updated_at);
        return ordered.slice(offset).map((r) => ({ id: r.id })) as unknown as T[];
      }
      if (s.includes('FROM chat_sessions WHERE workspace_id = ? AND origin IS NULL')) {
        const wsId = params[0];
        return [...sessions.values()].filter((r) => r.workspace_id === wsId && r.origin == null)
          .sort((a, b) => b.updated_at - a.updated_at) as unknown as T[];
      }
      return [];
    },
  };
}

let counter = 0;
function runSession(nMsgs: number, title = 'Run'): IChatSession {
  const id = `ephemeral-${++counter}`;
  const messages = Array.from({ length: nMsgs }, (_, i) => ({
    request: { text: `q${i}`, timestamp: 1000 + i, id: `u${i}` } as never,
    response: { parts: [{ kind: 'text', text: `a${i}` }], modelId: 'llama3', isComplete: true, timestamp: 1001 + i } as never,
  }));
  return {
    id, title, mode: ChatMode.Agent, modelId: 'llama3', createdAt: 500, updatedAt: 500,
    messages, requestInProgress: false, sessionResource: URI.parse(`parallx-chat-session:///${id}`),
  } as IChatSession;
}

describe('autonomous run archive (M91 S1)', () => {
  it('archives an ephemeral run and reloads its FULL transcript', async () => {
    const db = makeDb();
    const run = runSession(3, 'Morning brief');
    await archiveSession(db, run, 'dashboard', 'ws1');

    const reloaded = await loadArchivedRun(db, run.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.messages).toHaveLength(3);
    expect(reloaded!.messages[0].request.text).toBe('q0');
    expect(reloaded!.messages[2].response.parts[0]).toMatchObject({ text: 'a2' });
  });

  it('archived runs NEVER appear in the chat session list', async () => {
    const db = makeDb();
    await archiveSession(db, runSession(2), 'heartbeat', 'ws1');
    await saveSession(db, { ...runSession(1), id: 'real-chat-1' } as IChatSession, 'ws1');

    const chats = await loadSessions(db, 'ws1');
    expect(chats.map((c) => c.id)).toEqual(['real-chat-1']); // no archived run
  });

  it('summaries list archived runs newest-first with counts + origin', async () => {
    const db = makeDb();
    const a = runSession(2, 'A');
    const b = runSession(4, 'B');
    await archiveSession(db, a, 'cron', 'ws1', 100, 1);
    await archiveSession(db, b, 'heartbeat', 'ws1', 100, 2);

    const list = await loadArchivedRunSummaries(db, 'ws1');
    expect(list.map((r) => r.title)).toEqual(['B', 'A']);
    expect(list[0]).toMatchObject({ origin: 'heartbeat', messageCount: 8 });
  });

  it('retention keeps the newest N and prunes the rest', async () => {
    const db = makeDb();
    for (let i = 0; i < 5; i++) {
      const r = runSession(1, `R${i}`);
      await archiveSession(db, r, 'heartbeat', 'ws1', 3, i); // keep 3, archivedAt=i
    }
    const list = await loadArchivedRunSummaries(db, 'ws1');
    expect(list).toHaveLength(3);
    expect(list.map((r) => r.title)).toEqual(['R4', 'R3', 'R2']);
  });

  it('an empty run is not archived (nothing to review)', async () => {
    const db = makeDb();
    await archiveSession(db, runSession(0), 'heartbeat', 'ws1');
    expect(await loadArchivedRunSummaries(db, 'ws1')).toHaveLength(0);
  });

  it('loadArchivedRun refuses a non-archived (origin NULL) id', async () => {
    const db = makeDb();
    await saveSession(db, { ...runSession(1), id: 'real-chat-2' } as IChatSession, 'ws1');
    expect(await loadArchivedRun(db, 'real-chat-2')).toBeNull();
  });
});
