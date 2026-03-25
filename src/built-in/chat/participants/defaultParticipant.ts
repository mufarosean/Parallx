import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatParticipant,
  IChatParticipantHandler,
} from '../../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../chatTypes.js';
import { createDefaultChatParticipantRuntime } from '../utilities/chatDefaultParticipantRuntime.js';

export type { IDefaultParticipantServices } from '../chatTypes.js';

const DEFAULT_PARTICIPANT_ID = 'parallx.chat.default';

export function createDefaultParticipant(services: IDefaultParticipantServices): IChatParticipant & IDisposable {
  const runtime = createDefaultChatParticipantRuntime(services);

  const handler: IChatParticipantHandler = (request, context, response, token) => runtime.handleTurn(
    request,
    context,
    response,
    token,
  );

  return {
    id: DEFAULT_PARTICIPANT_ID,
    surface: 'default',
    displayName: 'Chat',
    description: 'Default chat participant — sends messages to the active language model.',
    commands: [
      { name: 'init', description: 'Scan workspace and generate AGENTS.md' },
      { name: 'context', description: 'Show the runtime context breakdown' },
      { name: 'explain', description: 'Explain how code or a concept works' },
      { name: 'fix', description: 'Find and fix problems in the code' },
      { name: 'test', description: 'Generate tests for the code' },
      { name: 'doc', description: 'Generate documentation or comments' },
      { name: 'review', description: 'Code review — suggest improvements' },
      { name: 'compact', description: 'Summarize conversation to free token budget' },
    ],
    runtime,
    handler,
    dispose: () => {
      // No-op cleanup — the participant is just a descriptor.
    },
  };
}

