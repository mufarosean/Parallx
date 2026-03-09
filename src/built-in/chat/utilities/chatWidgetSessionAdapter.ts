import type { IChatSession } from '../../../services/chatTypes.js';
import type { IChatWidgetServices } from '../chatTypes.js';

export interface IChatWidgetSessionAdapterDeps {
  readonly getSessions: () => readonly IChatSession[];
  readonly getSession: (id: string) => IChatSession | undefined;
  readonly deleteSession: (id: string) => void;
  readonly getSystemPrompt: () => Promise<string>;
  readonly readFileRelative?: (relativePath: string) => Promise<string | null>;
  readonly writeFileRelative?: (relativePath: string, content: string) => Promise<void>;
  readonly searchSessions?: (query: string) => Promise<Array<{ sessionId: string; sessionTitle: string; matchingContent: string }>>;
}

export function buildChatWidgetSessionServices(
  deps: IChatWidgetSessionAdapterDeps,
): Pick<
  IChatWidgetServices,
  'getSessions' | 'getSession' | 'deleteSession' | 'getSystemPrompt' | 'readFileRelative' | 'writeFileRelative' | 'searchSessions'
> {
  return {
    getSessions: deps.getSessions,
    getSession: deps.getSession,
    deleteSession: deps.deleteSession,
    getSystemPrompt: deps.getSystemPrompt,
    readFileRelative: deps.readFileRelative,
    writeFileRelative: deps.writeFileRelative,
    searchSessions: deps.searchSessions,
  };
}