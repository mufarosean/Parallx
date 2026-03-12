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