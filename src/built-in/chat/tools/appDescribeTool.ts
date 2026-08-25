// appDescribeTool.ts — the system diagnosing itself.
//
// Phase C of SYSTEM_INTEGRITY.md: the model could read the user's
// activity but could not ask the app about the app — the tool roster,
// the layout, the settings, the live context, the health of the runtime
// were all invisible to it. This tool is the AI-facing door onto the
// IntrospectionService join: strictly read-only, always allowed, modeled
// on activity_log.
//
// The default topic is 'summary' — counts and the layout narration —
// because the full snapshot of a working app (hundreds of commands and
// settings) does not belong in a context window uninvited. Specific
// topics return the full lists.

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';
import type { IIntrospectionService } from '../../../services/introspectionService.js';

const TOPICS = [
  'summary', 'tools', 'commands', 'keybindings', 'key-conflicts',
  'layout', 'editors', 'settings', 'context', 'services',
] as const;
type Topic = typeof TOPICS[number];

export function createAppDescribeTool(
  getIntrospection: () => IIntrospectionService | undefined,
): IChatTool {
  return {
    name: 'app__describe',
    displaySummary: 'Describe the running app.',
    description: 'Ask the app about itself: which tools are running (with activation timing and errors), what commands and keybindings exist, how the layout is arranged, which editors are open, what every setting is, the live context keys, and the registered services. Default topic "summary" returns compact counts plus the layout; pass a specific topic for the full list.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: [...TOPICS],
          description: 'What to describe (default "summary").',
        },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    category: 'autonomy',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      const introspection = getIntrospection();
      if (!introspection) {
        return { content: JSON.stringify({ ok: false, error: 'introspection unavailable' }), isError: true };
      }
      const topic: Topic = TOPICS.includes(args.topic as Topic) ? args.topic as Topic : 'summary';

      const body = ((): unknown => {
        switch (topic) {
          case 'tools': return introspection.describeTools();
          case 'commands': return introspection.describeCommands();
          case 'keybindings': return introspection.describeKeybindings();
          case 'key-conflicts': return introspection.findKeyConflicts();
          case 'layout': return introspection.describeLayout();
          case 'editors': return introspection.describeEditors();
          case 'settings': return introspection.describeSettings();
          case 'context': return introspection.describeContext();
          case 'services': return introspection.describeServices();
          case 'summary': {
            const tools = introspection.describeTools();
            const failing = tools.filter((t) => t.errorCount > 0);
            return {
              tools: {
                total: tools.length,
                activated: tools.filter((t) => t.state === 'activated').length,
                disabled: tools.filter((t) => !t.enabled).map((t) => t.id),
                withErrors: failing.map((t) => ({ id: t.id, errorCount: t.errorCount, lastError: t.lastError?.message })),
              },
              commands: introspection.describeCommands().length,
              keybindings: introspection.describeKeybindings().length,
              keyConflicts: introspection.findKeyConflicts().map((c) => c.key),
              layout: introspection.describeLayout().prose,
              editors: introspection.describeEditors().map((e) => e.name),
              settings: introspection.describeSettings().length,
              context: introspection.describeContext(),
              services: introspection.describeServices().length,
            };
          }
        }
      })();

      return { content: JSON.stringify({ ok: true, topic, [topic]: body }) };
    },
  };
}
