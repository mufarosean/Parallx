import {
  ChatContentPartKind,
} from '../../../services/chatTypes.js';
import type {
  EditProposalOperation,
  IChatEditProposalContent,
  IChatResponseStream,
  IToolCall,
} from '../../../services/chatTypes.js';

/** @internal Exported for unit testing. */
export function extractToolCallsFromText(text: string): { toolCalls: IToolCall[]; cleanedText: string } {
  const toolCalls: IToolCall[] = [];
  let cleaned = text;

  const ARGS_KEY = '"(?:parameters|arguments)"';
  const jsonPatterns = [
    new RegExp('```(?:json)?\\s*\\n?({[\\s\\S]*?"name"\\s*:\\s*"[\\w]+"[\\s\\S]*?' + ARGS_KEY + '\\s*:[\\s\\S]*?})\\s*\\n?```', 'g'),
    new RegExp('```(?:json)?\\s*\\n?(\\[[\\s\\S]*?"name"\\s*:\\s*"[\\w]+"[\\s\\S]*?' + ARGS_KEY + '\\s*:[\\s\\S]*?\\])\\s*\\n?```', 'g'),
    new RegExp('({\\s*"name"\\s*:\\s*"[\\w]+"\\s*,\\s*' + ARGS_KEY + '\\s*:\\s*{[^{}]*(?:{[^{}]*}[^{}]*)*}\\s*})', 'g'),
    new RegExp('(\\[\\s*{\\s*"name"\\s*:\\s*"[\\w]+"\\s*,\\s*' + ARGS_KEY + '\\s*:[\\s\\S]*?}\\s*\\])', 'g'),
  ];

  for (const pattern of jsonPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const jsonStr = match[1] || match[0];
      try {
        const parsed = JSON.parse(jsonStr);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          const args = item.parameters ?? item.arguments;
          if (
            typeof item === 'object' && item !== null &&
            typeof item.name === 'string' && item.name.length > 0 &&
            typeof args === 'object' && args !== null
          ) {
            toolCalls.push({
              function: { name: item.name, arguments: args },
            });
            cleaned = cleaned.replace(match[0], '');
          }
        }
      } catch {
        // Not valid JSON.
      }
    }
    if (toolCalls.length > 0) {
      break;
    }
  }

  if (toolCalls.length > 0) {
    cleaned = cleaned
      .replace(/(?:Based on[\s\S]{0,60},\s*)?[Hh]ere(?:'s| is) the JSON response[\s\S]{0,80}?:\s*/g, '')
      .replace(/(?:I will|Let me|I'll)\s+(?:now\s+)?(?:call|use|invoke|execute)\s+the\s+\w+\s+tool[\s\S]{0,40}?[.:]/gi, '');
  }

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { toolCalls, cleanedText: cleaned };
}

export function stripToolNarration(text: string): string {
  let cleaned = text
    .replace(/[Hh]ere(?:'s| is) (?:a|an|the|an alternative) (?:function|tool) call[^.:\n]*[.:]\s*/g, '')
    .replace(/[Bb]ased on the (?:functions?|tools?|context)[^.:\n]*[.:]\s*/g, '')
    .replace(/with its proper arguments[.:]\s*/gi, '')
    .replace(/(?:I'?(?:ll|m going to)|[Ll]et me)\s+(?:now\s+)?(?:call|use|invoke|try|execute)\s+(?:the\s+)?(?:`?\w+`?\s+)?(?:function|tool)[^.:\n]*[.:]\s*/gi, '')
    .replace(/[Tt]his (?:function|tool) call will[^.\n]*\.\s*/g, '')
    .replace(/This will (?:read|list|search|get|fetch|retrieve|provide|show) (?:all |the )?[^.\n]*\.\s*/gi, '')
    .replace(/[Tt]he output of this (?:function|tool) call[^.\n]*\.\s*/g, '')
    .replace(/[Aa]lternatively,?\s+(?:since\s+)?[^.\n]*(?:you could|you can)\s+use\s+`?\w+`?[^.\n]*[.:]\s*/g, '')
    .replace(/It seems (?:that )?the (?:file|page)[^"\n]*(?:"[^"]*"[^.\n]*)?(?:not (?:located|found)|does(?:n't| not) exist)[^.\n]*\.\s*/gi, '')
    .replace(/[Ll]et me try (?:again )?with a different approach\.\s*/g, '')
    .replace(/Based on[^,.\n]*,\s*I'll provide a JSON[^.\n]*\.\s*/gi, '')
    .replace(/\bAction:\s*```[\s\S]*?```/gi, '')
    .replace(/\bAction:\s*\{[\s\S]*?\}\s*/gi, '')
    .replace(/\bExecution:\s*```[\s\S]*?```/gi, '')
    .replace(/\bExecution:\s*\{[\s\S]*?\}\s*/gi, '')
    .replace(/[Ll]et'?s\s+execute\s+this\s+(?:action|tool|function)[^.\n]*\.?\s*/gi, '')
    .trim();

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

/** @internal Exported for unit testing. */
export function buildMissingCitationFooter(
  text: string,
  citations: Array<{ index: number; label: string }>,
  maxVisibleSources = 3,
): string {
  if (citations.length === 0) {
    return '';
  }

  const normalizedText = text.toLowerCase();
  const hasVisibleSourceReference = /(^|\n)\s*Sources:\s*/i.test(text) || citations.some(({ label }) => {
    const normalizedLabel = label.toLowerCase();
    return normalizedText.includes(normalizedLabel);
  });
  if (hasVisibleSourceReference) {
    return '';
  }

  const visibleSources = [...citations]
    .sort((a, b) => a.index - b.index)
    .slice(0, Math.max(1, maxVisibleSources));

  if (visibleSources.length === 0) {
    return '';
  }

  return `\n\nSources: ${visibleSources.map((source) => `[${source.index}] ${source.label}`).join('; ')}`;
}

function normalizeCitationSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCitationLabelVariants(label: string): string[] {
  const variants = new Set<string>();
  const normalizedLabel = normalizeCitationSearchText(label);
  if (normalizedLabel) {
    variants.add(normalizedLabel);
  }

  const withoutExtension = label.replace(/\.[a-z0-9]{1,6}$/i, '');
  const normalizedStem = normalizeCitationSearchText(withoutExtension);
  if (
    normalizedStem
    && normalizedStem !== normalizedLabel
    && normalizedStem.split(' ').length >= 2
  ) {
    variants.add(normalizedStem);
  }

  return [...variants].filter((variant) => variant.length >= 4);
}

/** @internal Exported for unit testing. */
export function selectAttributableCitations<T extends { index: number; label: string }>(
  text: string,
  citations: T[],
): T[] {
  if (citations.length === 0) {
    return [];
  }

  const citationByIndex = new Map(citations.map((citation) => [citation.index, citation]));
  const selected: T[] = [];
  const selectedIndices = new Set<number>();

  const explicitPattern = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = explicitPattern.exec(text)) !== null) {
    const index = parseInt(match[1], 10);
    const citation = citationByIndex.get(index);
    if (citation && !selectedIndices.has(index)) {
      selectedIndices.add(index);
      selected.push(citation);
    }
  }

  const normalizedText = normalizeCitationSearchText(text);
  if (normalizedText.length > 0) {
    const labelMatches = citations
      .filter((citation) => !selectedIndices.has(citation.index))
      .map((citation) => {
        const positions = getCitationLabelVariants(citation.label)
          .map((variant) => normalizedText.indexOf(variant))
          .filter((position) => position >= 0);
        return {
          citation,
          position: positions.length > 0 ? Math.min(...positions) : -1,
        };
      })
      .filter((entry) => entry.position >= 0)
      .sort((a, b) => a.position - b.position || a.citation.index - b.citation.index);

    for (const entry of labelMatches) {
      if (!selectedIndices.has(entry.citation.index)) {
        selectedIndices.add(entry.citation.index);
        selected.push(entry.citation);
      }
    }
  }

  if (selected.length === 0 && citations.length === 1) {
    return [citations[0]];
  }

  return selected;
}

const VALID_OPERATIONS = new Set<string>(['insert', 'update', 'delete']);

export function parseEditResponse(rawContent: string, response: IChatResponseStream): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    response.warning('Edit mode: failed to parse model response as JSON. Showing raw output.');
    response.markdown(rawContent);
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    response.warning('Edit mode: model response is not a JSON object. Showing raw output.');
    response.markdown(rawContent);
    return;
  }

  const obj = parsed as Record<string, unknown>;
  const explanation = typeof obj['explanation'] === 'string' ? obj['explanation'] : '';
  const editsRaw = obj['edits'];
  if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
    if (explanation) {
      response.markdown(explanation);
    }
    response.warning('Edit mode: no edits found in model response.');
    return;
  }

  const proposals: IChatEditProposalContent[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < editsRaw.length; i++) {
    const entry = editsRaw[i];
    if (!entry || typeof entry !== 'object') {
      warnings.push(`Edit ${i + 1}: not a valid object, skipped.`);
      continue;
    }

    const edit = entry as Record<string, unknown>;
    const pageId = typeof edit['pageId'] === 'string' ? edit['pageId'] : '';
    const blockId = typeof edit['blockId'] === 'string' ? edit['blockId'] : undefined;
    const operation = typeof edit['operation'] === 'string' ? edit['operation'] : '';
    const content = typeof edit['content'] === 'string' ? edit['content'] : '';

    if (!pageId) {
      warnings.push(`Edit ${i + 1}: missing pageId, skipped.`);
      continue;
    }
    if (!VALID_OPERATIONS.has(operation)) {
      warnings.push(`Edit ${i + 1}: invalid operation "${operation}", skipped.`);
      continue;
    }

    proposals.push({
      kind: ChatContentPartKind.EditProposal,
      pageId,
      blockId,
      operation: operation as EditProposalOperation,
      after: content,
      status: 'pending',
    });
  }

  for (const warning of warnings) {
    response.warning(warning);
  }

  if (proposals.length === 0) {
    if (explanation) {
      response.markdown(explanation);
    }
    response.warning('Edit mode: all proposed edits were invalid.');
    return;
  }

  response.editBatch(explanation, proposals);
}