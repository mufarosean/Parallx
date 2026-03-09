import type { ICancellationToken, IChatResponseStream } from '../../../services/chatTypes.js';

export interface IChatResponseValidatorEvidenceAssessment {
  readonly status: 'sufficient' | 'weak' | 'insufficient';
  readonly reasons: string[];
}

export interface IChatResponseValidatorCitation {
  readonly index: number;
  readonly uri: string;
  readonly label: string;
}

export interface IChatResponseValidatorDeps {
  readonly repairMarkdown: (markdown: string) => string;
  readonly buildMissingCitationFooter: (
    markdown: string,
    citations: Array<{ index: number; label: string }>,
  ) => string;
  readonly applyFallbackAnswer: (phase: string, note: string) => void;
  readonly reportResponseDebug?: (debug: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
    note?: string;
  }) => void;
}

export interface IChatResponseValidatorOptions {
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly isEditMode: boolean;
  readonly isConversational: boolean;
  readonly citationMode: 'required' | 'optional' | 'none';
  readonly ragSources: Array<{ uri: string; label: string; index?: number }>;
  readonly retrievedContextLength: number;
}

export function validateAndFinalizeChatResponse(
  deps: IChatResponseValidatorDeps,
  options: IChatResponseValidatorOptions,
): void {
  if (options.citationMode === 'required' && options.ragSources.length > 0) {
    const responseParts = (options.response as any)._response?.parts;
    if (Array.isArray(responseParts)) {
      const lastMarkdownPart = [...responseParts]
        .reverse()
        .find((part) => part.kind === 'markdown' && typeof part.content === 'string');
      if (lastMarkdownPart) {
        lastMarkdownPart.content = deps.repairMarkdown(lastMarkdownPart.content);
      }
    }

    const citations = options.ragSources
      .filter((source): source is IChatResponseValidatorCitation => source.index != null)
      .map((source) => ({ index: source.index, uri: source.uri, label: source.label }));

    if (!options.isConversational && citations.length > 0) {
      const responseText = options.response.getMarkdownText();
      const validIndices = new Set(citations.map((citation) => citation.index));
      const referencedIndices = new Set<number>();
      const refPattern = /\[(\d+)\]/g;
      let match: RegExpExecArray | null;
      while ((match = refPattern.exec(responseText)) !== null) {
        referencedIndices.add(parseInt(match[1], 10));
      }

      const unmatchedRefs = [...referencedIndices].filter((index) => !validIndices.has(index));
      if (unmatchedRefs.length > 0) {
        const firstAppearance: number[] = [];
        const seenInResponse = new Set<number>();
        const orderPattern = /\[(\d+)\]/g;
        let orderedMatch: RegExpExecArray | null;
        while ((orderedMatch = orderPattern.exec(responseText)) !== null) {
          const index = parseInt(orderedMatch[1], 10);
          if (!seenInResponse.has(index)) {
            seenInResponse.add(index);
            firstAppearance.push(index);
          }
        }

        if (firstAppearance.length === citations.length) {
          const sortedCitations = [...citations].sort((a, b) => a.index - b.index);
          const remap = new Map<number, number>();
          for (let index = 0; index < firstAppearance.length; index += 1) {
            remap.set(firstAppearance[index], sortedCitations[index].index);
          }

          const parts = (options.response as any)._response?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part.kind === 'markdown' && typeof part.content === 'string') {
                part.content = part.content.replace(/\[(\d+)\]/g, (_: string, num: string) => {
                  const mapped = remap.get(parseInt(num, 10));
                  return mapped != null ? `[${mapped}]` : `[${num}]`;
                });
              }
            }
          }
        } else {
          console.warn(
            `[Citations] LLM used ${firstAppearance.length} unique citations but ${citations.length} sources were provided. ` +
            `Unmatched: [${unmatchedRefs.join(', ')}]`,
          );
        }
      }

      const finalParts = (options.response as any)._response?.parts;
      const lastMarkdownContent = Array.isArray(finalParts)
        ? [...finalParts]
          .reverse()
          .find((part) => part.kind === 'markdown' && typeof part.content === 'string')?.content ?? ''
        : options.response.getMarkdownText();
      const citationFooter = deps.buildMissingCitationFooter(
        lastMarkdownContent,
        citations.map(({ index, label }) => ({ index, label })),
      );
      if (citationFooter) {
        options.response.markdown(citationFooter);
      }

      options.response.setCitations(citations);
    }
  }

  if (!options.isEditMode && !options.token.isCancellationRequested && options.response.getMarkdownText().trim().length === 0) {
    deps.applyFallbackAnswer('final', 'extractive');
    return;
  }

  deps.reportResponseDebug?.({
    phase: 'final-no-fallback-needed',
    markdownLength: options.response.getMarkdownText().trim().length,
    yielded: !!options.token.isYieldRequested,
    cancelled: options.token.isCancellationRequested,
    retrievedContextLength: options.retrievedContextLength,
  });
}