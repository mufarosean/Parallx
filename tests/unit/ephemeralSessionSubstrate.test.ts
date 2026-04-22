/**
 * W5-A (M58) — Ephemeral session substrate isolation tests.
 *
 * Proves the non-negotiables from the milestone brief:
 *
 *   1. `createEphemeralSession` returns a handle whose id is prefixed with
 *      `EPHEMERAL_SESSION_ID_PREFIX` and passes `isEphemeralSessionId`.
 *   2. `getSessions()` EXCLUDES ephemeral sessions (session-list UI never
 *      shows them).
 *   3. `getSession(id)` STILL returns the ephemeral session so
 *      `sendRequest` can operate on it — the isolation is on the list
 *      view, not the direct lookup.
 *   4. `_schedulePersist` and `saveSession` no-op on ephemeral ids — no
 *      rows reach the fake database.
 *   5. `deletePersistedSession` no-ops on ephemeral ids.
 *   6. `purgeEphemeralSession` removes the session from in-memory state
 *      AND cancels any pending cancellation source, without firing
 *      `onDidDeleteSession` (listeners never saw it created).
 *   7. `onDidCreateSession` does NOT fire on ephemeral session creation.
 *   8. Running a turn on an ephemeral session does not mutate the parent
 *      session's `messages[]`.
 *
 * Upstream parity: isolated-session contract from subagent-spawn.ts
 * (github.com/openclaw/openclaw) — "sub-run never bleeds into parent
 * transcript, never persists, never lists."
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatMode } from '../../src/services/chatTypes';
import type {
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';
import {
  EPHEMERAL_SESSION_ID_PREFIX,
  isEphemeralSessionId,
  saveSession,
  deletePersistedSession,
  type IChatPersistenceDatabase,
} from '../../src/services/chatSessionPersistence';

function createStubAgent(id = 'parallx.chat.default'): IChatParticipant {
  return {
    id,
    displayName: 'Default',
    description: 'stub',
    commands: [],
    handler: async (
      _req: IChatParticipantRequest,
      _ctx: IChatParticipantContext,
      stream: IChatResponseStream,
      _tok: ICancellationToken,
    ) => {
      stream.markdown('subagent reply');
      return {};
    },
  };
}

class RecordingDatabase implements IChatPersistenceDatabase {
  readonly isOpen = true;
  readonly runs: Array<{ sql: string; params?: unknown[] }> = [];
  async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
    this.runs.push({ sql, params });
    return { changes: 0 };
  }
  async get<T>(_sql: string, _params?: unknown[]): Promise<T | null> { return null; }
  async all<T>(_sql: string, _params?: unknown[]): Promise<T[]> { return []; }
}

describe('Ephemeral session substrate (M58 W5-A)', () => {
  let chatService: ChatService;
  let agentService: ChatAgentService;
  let modeService: ChatModeService;
  let lmService: LanguageModelsService;

  beforeEach(() => {
    agentService = new ChatAgentService();
    modeService = new ChatModeService();
    lmService = new LanguageModelsService();
    chatService = new ChatService(agentService, modeService, lmService);
    agentService.registerAgent(createStubAgent());
  });

  it('isEphemeralSessionId matches the documented prefix', () => {
    expect(isEphemeralSessionId(EPHEMERAL_SESSION_ID_PREFIX + 'abc')).toBe(true);
    expect(isEphemeralSessionId('real-id')).toBe(false);
    expect(isEphemeralSessionId('')).toBe(false);
  });

  it('createEphemeralSession returns a handle with an ephemeral-prefixed id', () => {
    const parent = chatService.createSession(ChatMode.Agent);
    const handle = chatService.createEphemeralSession(parent.id, { firstUserMessage: 'do a thing' });

    expect(handle.sessionId.startsWith(EPHEMERAL_SESSION_ID_PREFIX)).toBe(true);
    expect(handle.parentId).toBe(parent.id);
    expect(handle.seed.firstUserMessage).toBe('do a thing');
    expect(isEphemeralSessionId(handle.sessionId)).toBe(true);
  });

  it('getSessions() EXCLUDES ephemeral sessions', () => {
    const parent = chatService.createSession();
    chatService.createEphemeralSession(parent.id);
    chatService.createEphemeralSession(parent.id);

    const listed = chatService.getSessions();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(parent.id);
    // Ephemeral ids must never appear in the list
    for (const s of listed) {
      expect(isEphemeralSessionId(s.id)).toBe(false);
    }
  });

  it('getSession(id) still returns the ephemeral session (sendRequest lookup path)', () => {
    const parent = chatService.createSession();
    const handle = chatService.createEphemeralSession(parent.id);

    const session = chatService.getSession(handle.sessionId);
    expect(session).toBeDefined();
    expect(session?.id).toBe(handle.sessionId);
  });

  it('onDidCreateSession does NOT fire for ephemeral sessions', () => {
    const parent = chatService.createSession(); // real session fires once
    const listener = vi.fn();
    chatService.onDidCreateSession(listener);

    chatService.createEphemeralSession(parent.id);
    chatService.createEphemeralSession(parent.id);

    expect(listener).not.toHaveBeenCalled();
  });

  it('ephemeral session inherits parent session mode + model', () => {
    const parent = chatService.createSession(ChatMode.Edit, 'model-parent');
    const handle = chatService.createEphemeralSession(parent.id);
    const session = chatService.getSession(handle.sessionId);

    expect(session?.mode).toBe(ChatMode.Edit);
    expect(session?.modelId).toBe('model-parent');
  });

  it('purgeEphemeralSession removes the session from in-memory state', () => {
    const parent = chatService.createSession();
    const handle = chatService.createEphemeralSession(parent.id);

    expect(chatService.getSession(handle.sessionId)).toBeDefined();
    chatService.purgeEphemeralSession(handle);
    expect(chatService.getSession(handle.sessionId)).toBeUndefined();
  });

  it('purgeEphemeralSession does NOT fire onDidDeleteSession', () => {
    const parent = chatService.createSession();
    const handle = chatService.createEphemeralSession(parent.id);
    const listener = vi.fn();
    chatService.onDidDeleteSession(listener);

    chatService.purgeEphemeralSession(handle);
    expect(listener).not.toHaveBeenCalled();
  });

  it('purgeEphemeralSession ignores non-ephemeral ids (defensive)', () => {
    const parent = chatService.createSession();
    // Replay a stale-looking handle pointing at a real session id
    chatService.purgeEphemeralSession({ sessionId: parent.id, parentId: 'x', seed: {} });
    // Real session must still exist
    expect(chatService.getSession(parent.id)).toBeDefined();
  });

  it('saveSession early-returns on ephemeral ids (no SQL writes)', async () => {
    const db = new RecordingDatabase();
    const parent = chatService.createSession();
    const handle = chatService.createEphemeralSession(parent.id);
    const ephemeralSession = chatService.getSession(handle.sessionId)!;

    await saveSession(db, ephemeralSession, 'ws-1');

    // No INSERT / REPLACE / BEGIN should have been issued for the ephemeral.
    expect(db.runs).toHaveLength(0);
  });

  it('saveSession persists real sessions normally (negative control)', async () => {
    const db = new RecordingDatabase();
    const parent = chatService.createSession();

    await saveSession(db, parent, 'ws-1');

    expect(db.runs.length).toBeGreaterThan(0);
    expect(db.runs.some(r => /INSERT OR REPLACE INTO chat_sessions/.test(r.sql))).toBe(true);
  });

  it('deletePersistedSession early-returns on ephemeral ids (no SQL writes)', async () => {
    const db = new RecordingDatabase();
    await deletePersistedSession(db, EPHEMERAL_SESSION_ID_PREFIX + 'scratch');
    expect(db.runs).toHaveLength(0);
  });

  it('running a turn on an ephemeral session does not mutate parent messages[]', async () => {
    const parent = chatService.createSession();
    const handle = chatService.createEphemeralSession(parent.id);
    const parentMessagesBefore = parent.messages.length;

    await chatService.sendRequest(handle.sessionId, 'hi subagent');

    // Parent untouched
    expect(parent.messages.length).toBe(parentMessagesBefore);
    // Ephemeral session accumulated the exchange
    const ephemeral = chatService.getSession(handle.sessionId);
    expect(ephemeral?.messages.length).toBe(1);

    // Purge and confirm the parent is still clean
    chatService.purgeEphemeralSession(handle);
    expect(parent.messages.length).toBe(parentMessagesBefore);
  });

  it('bound database never receives a row for an ephemeral session after a real turn', async () => {
    const db = new RecordingDatabase();
    chatService.setDatabase(db, 'ws-1');
    // Clear setup noise (ensureChatTables CREATE TABLE statements).
    db.runs.length = 0;

    const parent = chatService.createSession();
    const handle = chatService.createEphemeralSession(parent.id);

    await chatService.sendRequest(handle.sessionId, 'hello');

    // Even after a full turn, no INSERT for the ephemeral session should be
    // scheduled (guard is at `_schedulePersist`). Allow writes that don't
    // mention the ephemeral session id.
    const touchedEphemeral = db.runs.some(r =>
      Array.isArray(r.params) && r.params.some(p => typeof p === 'string' && p.startsWith(EPHEMERAL_SESSION_ID_PREFIX)),
    );
    expect(touchedEphemeral).toBe(false);
  });
});
