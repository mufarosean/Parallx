import type {
  IChatMessage,
  IChatRequestResponsePair,
  IChatResponseChunk,
  IChatResponseStream,
} from '../../../services/chatTypes.js';

export interface IChatCompactCommandDeps {
  readonly sendSummarizationRequest?: (
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  readonly compactSession?: (sessionId: string, summaryText: string) => void;
}

export interface ITryExecuteCompactChatCommandInput {
  readonly isCompactCommand: boolean;
  readonly sessionId: string;
  readonly history: readonly IChatRequestResponsePair[];
  readonly response: IChatResponseStream;
}

function buildCompactHistoryText(history: readonly IChatRequestResponsePair[]): string {
  return history.map((pair) => {
    const responseText = pair.response.parts
      .map((part) => {
        const candidate = part as unknown as Record<string, unknown>;
        if ('text' in candidate && typeof candidate.text === 'string') {
          return candidate.text;
        }
        if ('code' in candidate && typeof candidate.code === 'string') {
          return '```\n' + candidate.code + '\n```';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    return `User: ${pair.request.text}\nAssistant: ${responseText}`;
  }).join('\n\n---\n\n');
}

export async function tryExecuteCompactChatCommand(
  deps: IChatCompactCommandDeps,
  input: ITryExecuteCompactChatCommandInput,
): Promise<boolean> {
  if (!input.isCompactCommand) {
    return false;
  }

  if (!deps.sendSummarizationRequest) {
    input.response.markdown('`/compact` requires a summarization model. No summarization service available.');
    return true;
  }
  if (input.history.length < 2) {
    input.response.markdown('Nothing to compact — conversation history is too short.');
    return true;
  }

  input.response.progress('Compacting conversation history…');

  const historyText = buildCompactHistoryText(input.history);
  const beforeTokens = Math.ceil(historyText.length / 4);
  const summaryPrompt: IChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a conversation summarizer. Condense the following conversation history into a concise context summary. '
        + 'Preserve all key facts, decisions, code references, and action items. Output ONLY the summary.',
    },
    { role: 'user', content: historyText },
  ];

  let summaryText = '';
  for await (const chunk of deps.sendSummarizationRequest(summaryPrompt)) {
    if (chunk.content) {
      summaryText += chunk.content;
    }
  }

  if (!summaryText) {
    input.response.markdown('Could not generate a summary. The conversation was not modified.');
    return true;
  }

  const afterTokens = Math.ceil(summaryText.length / 4);
  const saved = beforeTokens - afterTokens;

  deps.compactSession?.(input.sessionId, summaryText);
  input.response.markdown(
    `**Conversation compacted.**\n\n`
    + `- Before: ~${beforeTokens.toLocaleString()} tokens (${input.history.length} turns)\n`
    + `- After: ~${afterTokens.toLocaleString()} tokens (summary)\n`
    + `- Saved: ~${saved.toLocaleString()} tokens (${Math.round((saved / beforeTokens) * 100)}%)\n\n`
    + 'The summarized context will be used for future messages in this session.',
  );
  return true;
}