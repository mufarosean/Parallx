// chatSessions.ts — read a workspace's chats the way the app does.
//
// The app restores the list with loadSessionMetas and loads a chat's
// messages with loadSessionMessages when it is opened, saving it back when
// the load healed its replay chains (ChatService.ensureSessionHydrated).
// Tests that want every chat fully loaded run both, in that order.

import {
  loadSessionMessages,
  loadSessionMetas,
  saveSession,
  type IChatPersistenceDatabase,
} from '../../../src/services/chatSessionPersistence';
import type { IChatSession } from '../../../src/services/chatTypes';

export async function loadSessions(db: IChatPersistenceDatabase, workspaceId = ''): Promise<IChatSession[]> {
  const sessions = await loadSessionMetas(db, workspaceId);
  for (const session of sessions) {
    const { messages, changed } = await loadSessionMessages(db, session.id);
    session.messages.splice(0, session.messages.length, ...messages);
    session.messagesPendingLoad = false;
    if (changed) await saveSession(db, session, workspaceId);
  }
  return sessions;
}
