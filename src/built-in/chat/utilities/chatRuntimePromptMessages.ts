import { isChatImageAttachment } from '../../../services/chatTypes.js';
import type {
  IChatAttachment,
  IChatMessage,
  IChatRequestResponsePair,
} from '../../../services/chatTypes.js';

function getHistoryResponseText(pair: IChatRequestResponsePair): string {
  return pair.response.parts
    .map((part) => {
      if ('content' in part && typeof part.content === 'string') {
        return part.content;
      }
      if ('code' in part && typeof part.code === 'string') {
        return '```\n' + part.code + '\n```';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function buildRuntimePromptSeedMessages(options: {
  systemPrompt: string;
  history?: readonly IChatRequestResponsePair[];
}): IChatMessage[] {
  const messages: IChatMessage[] = [{
    role: 'system',
    content: options.systemPrompt,
  }];

  for (const pair of options.history ?? []) {
    messages.push({
      role: 'user',
      content: pair.request.text,
    });

    const responseText = getHistoryResponseText(pair);
    if (!responseText) {
      continue;
    }

    messages.push({
      role: 'assistant',
      content: responseText,
    });
  }

  return messages;
}

export function buildRuntimePromptEnvelopeMessages(options: {
  seedMessages: readonly IChatMessage[];
  userContent: string;
  attachments?: readonly IChatAttachment[];
}): IChatMessage[] {
  return [
    ...options.seedMessages,
    {
      role: 'user',
      content: options.userContent,
      images: options.attachments?.filter(isChatImageAttachment),
    },
  ];
}