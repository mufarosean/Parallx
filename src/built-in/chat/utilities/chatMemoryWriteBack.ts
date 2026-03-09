import type {
  IChatMessage,
  IChatRequestResponsePair,
  IChatResponseChunk,
} from '../../../services/chatTypes.js';

export interface IChatMemoryWriteBackConcept {
  readonly concept: string;
  readonly category: string;
  readonly summary: string;
  readonly struggled: boolean;
}

export interface IChatMemoryWriteBackDeps {
  readonly extractPreferences?: (text: string) => Promise<void>;
  readonly storeSessionMemory?: (sessionId: string, summary: string, messageCount: number) => Promise<void>;
  readonly storeConceptsFromSession?: (
    concepts: IChatMemoryWriteBackConcept[],
    sessionId: string,
  ) => Promise<void>;
  readonly isSessionEligibleForSummary?: (messageCount: number) => boolean;
  readonly getSessionMemoryMessageCount?: (sessionId: string) => Promise<number | null>;
  readonly sendSummarizationRequest?: (
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  readonly buildDeterministicSessionSummary: (
    history: readonly IChatRequestResponsePair[],
    currentRequestText: string,
  ) => string;
}

export interface IChatMemoryWriteBackOptions {
  readonly memoryEnabled: boolean;
  readonly requestText: string;
  readonly sessionId?: string;
  readonly history: readonly IChatRequestResponsePair[];
}

export function queueChatMemoryWriteBack(
  deps: IChatMemoryWriteBackDeps,
  options: IChatMemoryWriteBackOptions,
): void {
  if (!options.memoryEnabled) {
    return;
  }

  if (deps.extractPreferences && options.requestText) {
    deps.extractPreferences(options.requestText).catch(() => {});
  }

  if (
    !deps.storeSessionMemory
    || !deps.isSessionEligibleForSummary
    || !deps.getSessionMemoryMessageCount
    || options.history.length === 0
  ) {
    return;
  }

  const sessionId = options.sessionId ?? '';
  const messageCount = options.history.length + 1;
  if (!sessionId || !deps.isSessionEligibleForSummary(messageCount)) {
    return;
  }

  const storeSessionMemory = deps.storeSessionMemory;

  deps.getSessionMemoryMessageCount(sessionId).then(async (storedCount) => {
    const shouldSummarize = storedCount === null
      || messageCount >= storedCount * 2
      || messageCount >= storedCount + 10;
    if (!shouldSummarize) {
      return;
    }

    try {
      const transcript = options.history.map((entry) => {
        const responseText = entry.response.parts
          .map((part) => ('content' in part && typeof part.content === 'string') ? part.content : '')
          .filter(Boolean)
          .join(' ');
        return `User: ${entry.request.text}\nAssistant: ${responseText}`;
      }).join('\n\n');
      const fullTranscript = `${transcript}\n\nUser: ${options.requestText}`;
      const fallbackSummary = deps.buildDeterministicSessionSummary(options.history, options.requestText);

      if (fallbackSummary) {
        await storeSessionMemory(sessionId, fallbackSummary, messageCount);
      }

      if (!deps.sendSummarizationRequest) {
        return;
      }

      const hasConcepts = !!deps.storeConceptsFromSession;
      const summaryPrompt: IChatMessage[] = [
        {
          role: 'system',
          content: hasConcepts
            ? 'Analyse this conversation and produce JSON with two keys:\n' +
              '1. "summary": 2-4 sentence summary of key topics, decisions, and context. Prefer user-specific facts over general advice. Preserve concrete facts like names, locations, dates, numbers, report IDs, and anything the user may ask you to remember later.\n' +
              '2. "concepts": array of objects with fields: "concept" (topic name, 2-5 words), ' +
              '"category" (subject area), "summary" (user\'s current understanding), ' +
              '"struggled" (boolean — true if user showed confusion or needed rephrasing).\n' +
              'If the conversation includes both a specific incident and general reference guidance, summarize the specific incident first.\n' +
              'Only include concepts the user actively engaged with.\n' +
              'Output ONLY valid JSON, no markdown fences.'
            : 'Summarise this conversation in 2-4 sentences. Focus on the key topics discussed, ' +
              'decisions made, and any important context. Prefer user-specific facts over general advice. Preserve concrete facts like names, locations, dates, numbers, report IDs, and anything the user may ask you to remember later. If the conversation includes both a specific incident and general reference guidance, summarize the specific incident first. Output ONLY the summary.',
        },
        { role: 'user', content: fullTranscript },
      ];

      let rawText = '';
      for await (const chunk of deps.sendSummarizationRequest(summaryPrompt)) {
        if (chunk.content) {
          rawText += chunk.content;
        }
      }

      if (!rawText.trim()) {
        return;
      }

      let summaryText = rawText.trim();
      let extractedConcepts: IChatMemoryWriteBackConcept[] = [];

      if (hasConcepts) {
        try {
          let jsonText = summaryText;
          const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fenceMatch) {
            jsonText = fenceMatch[1].trim();
          }

          const parsed = JSON.parse(jsonText);
          if (parsed && typeof parsed.summary === 'string') {
            summaryText = parsed.summary.trim();
          }
          if (Array.isArray(parsed.concepts)) {
            extractedConcepts = parsed.concepts
              .filter((concept: unknown) =>
                concept && typeof concept === 'object'
                && typeof (concept as Record<string, unknown>).concept === 'string'
                && (concept as Record<string, unknown>).concept,
              )
              .map((concept: Record<string, unknown>) => ({
                concept: String(concept.concept),
                category: String(concept.category || 'general'),
                summary: String(concept.summary || ''),
                struggled: Boolean(concept.struggled),
              }));
          }
        } catch {
        }
      }

      if (summaryText) {
        await storeSessionMemory(sessionId, summaryText, messageCount);
      }

      if (extractedConcepts.length > 0 && deps.storeConceptsFromSession) {
        deps.storeConceptsFromSession(extractedConcepts, sessionId).catch(() => {});
      }
    } catch {
    }
  }).catch(() => {});
}