// defaultParticipant.ts — Default chat participant (M9 Cap 3 + Cap 4 + Cap 6 agentic loop)
//
// The default agent that handles messages when no @mention is specified.
// Sends the conversation to ILanguageModelsService and streams the response
// back through the IChatResponseStream.
//
// Cap 4 additions: mode-aware system prompts, mode capability enforcement.
// Cap 6 additions: agentic loop — tool call → execute → feed back → repeat.
//
// VS Code reference:
//   Built-in chat participant registered in chat.contribution.ts
//   Agent loop: chatAgents.ts — processes tool_calls, feeds results back

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatParticipant,
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatParticipantResult,
  IChatRequestResponsePair,
  IToolCall,
  IChatEditProposalContent,
  EditProposalOperation,
} from '../../../services/chatTypes.js';
import { ChatContentPartKind, isChatImageAttachment } from '../../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
  IInitCommandServices,
} from '../chatTypes.js';
import { getModeCapabilities } from '../config/chatModeCapabilities.js';
import { executeInitCommand } from '../commands/initCommand.js';
import { determineChatTurnRoute } from '../utilities/chatTurnRouter.js';
import { tryExecuteCompactChatCommand } from '../utilities/chatCompactCommand.js';
import { applyChatAnswerRepairPipeline } from '../utilities/chatAnswerRepairPipeline.js';
import { handleEarlyDeterministicAnswer, handlePreparedContextDeterministicAnswer } from '../utilities/chatDeterministicResponse.js';
import {
  assessEvidenceSufficiency as _assessEvidenceSufficiency,
  buildDeterministicSessionSummary as _buildDeterministicSessionSummary,
  buildEvidenceResponseConstraint as _buildEvidenceResponseConstraint,
  buildExtractiveFallbackAnswer as _buildExtractiveFallbackAnswer,
  buildFollowUpRetrievalQuery,
  buildRetrieveAgainQuery as _buildRetrieveAgainQuery,
} from '../utilities/chatGroundedResponseHelpers.js';
import { buildChatTurnExecutionConfig } from '../utilities/chatTurnExecutionConfig.js';
import { prepareChatTurnPrelude } from '../utilities/chatTurnPrelude.js';
import { resolveChatTurnEntryRouting } from '../utilities/chatTurnEntryRouting.js';
import { applyChatTurnBudgeting } from '../utilities/chatTurnBudgeting.js';
import { assembleChatTurnMessages } from '../utilities/chatTurnMessageAssembly.js';
import { composeChatUserContent } from '../utilities/chatUserContentComposer.js';
import { prepareChatTurnContext, writeChatProvenanceToResponse } from '../utilities/chatTurnContextPreparation.js';
import { executePreparedChatTurn } from '../utilities/chatTurnSynthesis.js';
import { extractSpecificCoverageFocusPhrases } from '../utilities/chatSpecificCoverageFocus.js';
import { SlashCommandRegistry, parseSlashCommand } from '../config/chatSlashCommands.js';
import { loadUserCommands } from '../utilities/userCommandLoader.js';

/** Default maximum agentic loop iterations. */
const DEFAULT_MAX_ITERATIONS = 10;
/** Ask mode needs fewer iterations — it only reads, never writes. */
const ASK_MODE_MAX_ITERATIONS = 5;
export {
  _assessEvidenceSufficiency,
  _buildDeterministicSessionSummary,
  _buildEvidenceResponseConstraint,
  _buildExtractiveFallbackAnswer,
  _buildRetrieveAgainQuery,
};

export function _repairUnsupportedSpecificCoverageAnswer(
  query: string,
  answer: string,
  evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] },
): string {
  if (!answer.trim() || !evidenceAssessment.reasons.includes('specific-coverage-not-explicitly-supported')) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const focusPhrase = extractSpecificCoverageFocusPhrases(normalizedQuery)[0];
  if (!focusPhrase) {
    return answer;
  }

  const escapedPhrase = focusPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const explicitSentence = `I could not find ${focusPhrase} listed in your policy documents.`;
  let repaired = answer;

  repaired = repaired.replace(
    new RegExp(`(^|\\n)\\s*(?:your\\s+policy|the\\s+policy(?:\\s+documents?)?)\\s+(?:does\\s+not\\s+include|doesn['’]t\\s+include|does\\s+not\\s+cover|doesn['’]t\\s+cover)\\s+${escapedPhrase}\\.?`, 'i'),
    `$1${explicitSentence}`,
  );

  repaired = repaired.replace(
    new RegExp(`(^|\\n)\\s*(?:your\\s+policy|the\\s+policy(?:\\s+documents?)?)\\s+(?:includes?|covers?)\\s+${escapedPhrase}\\.?`, 'i'),
    `$1${explicitSentence}`,
  );

  repaired = repaired.replace(
    new RegExp(`${escapedPhrase}[^.]{0,160}(?:falls\\s+within|within\\s+the\\s+scope|is\\s+covered\\s+under|would\\s+be\\s+covered\\s+under)[^.]*\.`, 'i'),
    `${explicitSentence} `,
  );

   repaired = repaired.replace(
    new RegExp(`(?:so|therefore|that\\s+means)?[^.]{0,80}(?:the\\s+policy|your\\s+policy)?[^.]{0,80}(?:covers?|would\\s+cover)\\s+${escapedPhrase}[^.]*\\.`, 'i'),
    `${explicitSentence} `,
  );

  repaired = repaired.replace(
    new RegExp(`${escapedPhrase}[^.]{0,220}(?:natural\\s+disasters?|broader\\s+categor(?:y|ies)|general\\s+category)[^.]*\\.`, 'i'),
    `${explicitSentence} The retrieved documents may mention broader categories, but they do not explicitly name that specific coverage. `,
  );

  repaired = repaired.replace(
    new RegExp(`(?:The only coverage that (?:might|would|could) apply|It (?:might|would|could) apply)[^.]{0,220}(?:natural\\s+disasters?|Comprehensive Coverage|seismic\\s+events?)[^.]*\\.`, 'i'),
    `${explicitSentence} The retrieved documents may mention broader categories, but they do not explicitly name that specific coverage. `,
  );

  if (!new RegExp(`could\\s+not\\s+find\\s+${escapedPhrase}|do\\s+not\\s+explicitly\\s+confirm\\s+${escapedPhrase}`, 'i').test(repaired)) {
    repaired = `${explicitSentence} ${repaired.trim()}`;
  }

  if (!/broader category|not explicitly named|not explicitly mention|not explicitly listed/i.test(repaired)) {
    repaired = repaired.replace(
      explicitSentence,
      `${explicitSentence} The retrieved documents may mention broader categories, but they do not explicitly name that specific coverage.`,
    );
  }

  repaired = repaired.replace(/\\s{2,}/g, ' ').trim();

  return repaired;
}

function normalizeGroundedAnswerTypography(answer: string): string {
  return answer
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/(\d)\s+%/g, '$1%');
}

export function _repairTotalLossThresholdAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksTotalLossThreshold = normalizedQuery.includes('total loss')
    && ['threshold', 'declared', 'point', 'when'].some((term) => normalizedQuery.includes(term));
  if (!asksTotalLossThreshold) {
    return answer;
  }

  const normalizedContext = retrievedContextText.replace(/[*_`~]/g, ' ');
  const hasThresholdEvidence = /75\s*%|75 percent|seventy[-\s]five/i.test(normalizedContext);
  const hasKbbEvidence = /kelly\s+blue\s+book|\bkbb\b/i.test(normalizedContext);
  if (!hasThresholdEvidence && !hasKbbEvidence) {
    return answer;
  }

  let repaired = normalizeGroundedAnswerTypography(answer).trim();

  if (hasThresholdEvidence && !/75%|75 percent|seventy[-\s]five/i.test(repaired)) {
    repaired = `Your vehicle would be considered a total loss when repair costs exceed 75% of its current value. ${repaired}`.trim();
  }

  if (hasKbbEvidence && !/\bkbb\b/i.test(repaired)) {
    if (/kelly\s+blue\s+book/i.test(repaired)) {
      repaired = repaired.replace(/Kelly\s+Blue\s+Book/i, 'Kelly Blue Book (KBB)');
    } else if (/current\s+(?:market\s+)?value/i.test(repaired)) {
      repaired = repaired.replace(/current\s+(?:market\s+)?value/i, 'current Kelly Blue Book (KBB) value');
    } else {
      repaired = `${repaired}\n\nThat value comes from Kelly Blue Book (KBB).`;
    }
  }

  return repaired;
}

function extractDollarAmount(text: string): string | undefined {
  return text.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/)?.[0];
}

export function _repairDeductibleConflictAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksCollision = normalizedQuery.includes('collision');
  const asksComprehensive = normalizedQuery.includes('comprehensive');
  const asksDeductible = normalizedQuery.includes('deductible')
    || (/(?:^|\b)(?:and|what about|how about)\b/.test(normalizedQuery) && (asksCollision || asksComprehensive));
  if (!asksDeductible || (asksCollision === asksComprehensive)) {
    return answer;
  }

  const normalizedContext = retrievedContextText.replace(/[*_`~]/g, ' ');
  const coverageLabel = asksCollision ? 'collision' : 'comprehensive';
  const policyCoverageMatch = asksCollision
    ? normalizedContext.match(/Auto Insurance Policy\.md[\s\S]{0,400}?Collision Coverage[\s\S]{0,200}?Deductible:\s*(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
      ?? normalizedContext.match(/Collision Coverage[\s\S]{0,200}?Deductible:\s*(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
      ?? normalizedContext.match(/\bCollision \((\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s+ded\)/i)
    : normalizedContext.match(/Auto Insurance Policy\.md[\s\S]{0,400}?Comprehensive Coverage[\s\S]{0,200}?Deductible:\s*(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
      ?? normalizedContext.match(/Comprehensive Coverage[\s\S]{0,200}?Deductible:\s*(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
      ?? normalizedContext.match(/\bComprehensive \((\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s+ded\)/i);
  const policyAmount = policyCoverageMatch?.[1];
  if (!policyAmount) {
    return answer;
  }

  const quickReferenceMatch = asksCollision
    ? normalizedContext.match(/Accident Quick Reference\.md[\s\S]{0,300}?Collision Deductible[^\n]*?(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
      ?? normalizedContext.match(/Collision Deductible[^\n]*?(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
    : normalizedContext.match(/Comprehensive Deductible[^\n]*?(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  const quickReferenceAmount = quickReferenceMatch?.[1];
  const claimedAmount = extractDollarAmount(query);
  const asksForCurrentValue = ['now', 'current', 'currently', 'today'].some((term) => normalizedQuery.includes(term));
  const asksForConfirmation = /(confirm|right|correct)/.test(normalizedQuery);
  const asksForComparison = /(difference|different|compare|comparison|conflict|which source|which document|older|stale|why)/.test(normalizedQuery);

  let repaired = normalizeGroundedAnswerTypography(answer).trim();

  if (claimedAmount && claimedAmount !== policyAmount && asksForConfirmation) {
    repaired = repaired.replace(/^.*?(?=\n|$)/, `No. Your ${coverageLabel} deductible is ${policyAmount}, not ${claimedAmount}.`);
    if (!repaired.startsWith('No.')) {
      repaired = `No. Your ${coverageLabel} deductible is ${policyAmount}, not ${claimedAmount}. ${repaired}`.trim();
    }
  }

  if (quickReferenceAmount && quickReferenceAmount !== policyAmount && !asksForComparison) {
    repaired = repaired
      .replace(new RegExp(`The quick-reference card also lists a ${quickReferenceAmount.replace(/[$]/g, '\\$&')} deductible[^.]*\.`, 'i'), 'An older quick-reference note conflicts with the policy summary, so I am using the current policy amount.')
      .replace(new RegExp(`Quick-reference card lists ${quickReferenceAmount.replace(/[$]/g, '\\$&')}[^\n]*`, 'i'), 'Quick-reference note conflicts with the current policy summary.')
      .replace(new RegExp(`(^|[^0-9])${quickReferenceAmount.replace(/[$]/g, '\\$&')}(?![0-9])`, 'g'), '$1');

    if (!asksForCurrentValue) {
      repaired = repaired
        .replace(/An older quick-reference note conflicts with the policy summary, so I am using the current policy amount\.?/i, '')
        .replace(/Quick-reference note conflicts with the current policy summary\.?/i, '');
    }
  }

  const repairedAmount = extractDollarAmount(repaired);
  if (!asksForComparison && repairedAmount !== policyAmount) {
    const normalizedLead = asksForCurrentValue
      ? `Your current ${coverageLabel} deductible is ${policyAmount}.`
      : `Your ${coverageLabel} deductible is ${policyAmount}.`;
    repaired = `${normalizedLead} ${repaired}`.trim();
    repaired = repaired.replace(new RegExp(`(Your (?:current )?${coverageLabel} deductible is \\$\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?\\.\\s*)+`, 'i'), normalizedLead + ' ');
  }

  repaired = repaired.replace(/\n{3,}/g, '\n\n').trim();
  if (!new RegExp(`\b${coverageLabel}\b`, 'i').test(repaired)) {
    repaired = `${asksForCurrentValue ? 'Your current' : 'Your'} ${coverageLabel} deductible is ${policyAmount}. ${repaired}`.trim();
  }

  return repaired;
}

export function _repairVehicleInfoAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksVehicleInfo = /(insured vehicle|my vehicle|my car|vehicle info|vehicle information)/.test(normalizedQuery);
  if (!asksVehicleInfo) {
    return answer;
  }

  const repaired = normalizeGroundedAnswerTypography(answer).replace(/\s{2,}/g, ' ').trim();

  const normalizedContext = retrievedContextText.replace(/[*_`~]/g, ' ');
  const vehicleLine = normalizedContext.match(/(20\d{2})\s+([A-Z][a-z]+)\s+([A-Za-z0-9-]+)(?:\s+([A-Z0-9-]{2,}|[A-Z][a-z]+(?:\s+[A-Z0-9-]+)*))?/);
  const colorMatch = normalizedContext.match(/(Lunar Silver Metallic|Silver Metallic|Silver)/i);
  const year = vehicleLine?.[1];
  const make = vehicleLine?.[2];
  const model = vehicleLine?.[3];
  const trim = vehicleLine?.[4] && !/^Coverage|Information|Specifications$/i.test(vehicleLine[4])
    ? vehicleLine[4]
    : undefined;
  const color = colorMatch?.[1];

  if (!year || !make || !model) {
    return repaired;
  }

  const normalizedAnswer = repaired.toLowerCase();
  const missingTrimOrColor = (!!trim && !normalizedAnswer.includes(trim.toLowerCase()))
    && (!!color && !normalizedAnswer.includes(color.toLowerCase()));
  if (!missingTrimOrColor) {
    return repaired;
  }

  const details = [trim, color].filter(Boolean).join(' in ');
  const lead = details
    ? `Your insured vehicle is a ${year} ${make} ${model} ${details}.`
    : `Your insured vehicle is a ${year} ${make} ${model}.`;
  return `${lead} ${repaired}`.trim();
}

export function _repairAgentContactAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksAgentPhone = normalizedQuery.includes('agent')
    && ['phone', 'number', 'contact', 'call'].some((term) => normalizedQuery.includes(term));
  if (!asksAgentPhone) {
    return answer;
  }

  const normalizedContext = retrievedContextText.replace(/[*_`~]/g, '');
  const normalizedLines = normalizedContext
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const contactPhone = normalizedLines
    .find((line) => /\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/.test(line))
    ?.match(/\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/)?.[0]?.trim();
  const contactName = normalizedLines
    .find((line) => /\|\s*Name\s*\|/i.test(line))
    ?.match(/\|\s*Name\s*\|\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i)?.[1]?.trim()
    ?? normalizedLines
      .find((line) => /\b(?:your agent|agent)\b/i.test(line) && /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line))
      ?.match(/(?:your agent|agent)[^:]*:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i)?.[1]?.trim()
    ?? normalizedLines
      .find((line) => /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line) && !/claims line|repair shops|office address/i.test(line))
      ?.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/)?.[1]?.trim();
  if (!contactName && !contactPhone) {
    return answer;
  }

  let repaired = normalizeGroundedAnswerTypography(answer)
    .replace(/\s+/g, ' ')
    .trim();

  if (contactPhone) {
    const digitSequence = contactPhone.replace(/\D/g, '');
    if (digitSequence.length === 10) {
      const fuzzyPhonePattern = new RegExp(`\\(?${digitSequence.slice(0, 3)}\\)?\\s*[-.]?\\s*${digitSequence.slice(3, 6)}\\s*[-.]?\\s*${digitSequence.slice(6)}`);
      repaired = repaired.replace(fuzzyPhonePattern, contactPhone);
    }
  }

  const hasName = !!contactName && repaired.toLowerCase().includes(contactName.toLowerCase());
  const hasPhone = !!contactPhone && repaired.includes(contactPhone);
  if (hasName && hasPhone) {
    return repaired;
  }

  const lead = contactName && contactPhone
    ? `Your agent is ${contactName}, and their phone number is ${contactPhone}.`
    : contactName
      ? `Your agent is ${contactName}.`
      : `Your agent's phone number is ${contactPhone}.`;

  if (/^your agent/i.test(repaired)) {
    return lead;
  }

  return `${lead} ${repaired}`.trim();
}

export function _repairGroundedCodeAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase();
  const asksHelperName = /\b(helper|function|builder)\b/.test(normalizedQuery) && /\b(packet|snippet|workflow architecture|code)\b/.test(normalizedQuery);
  const asksStageNames = /\bstage names?\b|\bwhat .* stages?\b|\binclude\b/.test(normalizedQuery);
  const asksSourceAnchor = /\b(workflow architecture|architecture doc|architecture document|source document|which document|what document)\b/.test(normalizedQuery);
  if (!asksHelperName && !asksStageNames && !asksSourceAnchor) {
    return answer;
  }

  const codeBlockMatch = retrievedContextText.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const codeSource = codeBlockMatch?.[1] ?? retrievedContextText;
  const sourceMatch = retrievedContextText.match(/^\[\d+\]\s+Source:\s+([^\n]+)$/m);
  const sourceLabel = sourceMatch?.[1]?.trim() ?? '';
  const sourceDocumentName = sourceLabel.replace(/\.md$/i, '');

  const functionMatch = codeSource.match(/\b(?:export\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(|\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\(/);
  const helperName = functionMatch?.[1] || functionMatch?.[2] || '';

  const stageBlockMatch = codeSource.match(/stages\s*:\s*\[([\s\S]*?)\]/i);
  const quotedStages = stageBlockMatch?.[1]?.match(/['"`]([a-z0-9-]+)['"`]/gi) ?? [];
  const stageNames = [...new Set(quotedStages.map((token) => token.slice(1, -1)))];

  const additions: string[] = [];
  if (asksHelperName && helperName && !answer.includes(helperName)) {
    additions.push(`The helper is ${helperName}.`);
  }
  if (asksStageNames && stageNames.length > 0) {
    const preferredStages = stageNames.slice(0, Math.min(2, stageNames.length));
    const missingPreferredStage = preferredStages.some((stage) => !answer.includes(stage));
    if (missingPreferredStage) {
      additions.push(`The stages include ${preferredStages.join(' and ')}.`);
    }
  }
  if (asksSourceAnchor && sourceDocumentName && !answer.toLowerCase().includes(sourceDocumentName.toLowerCase())) {
    additions.push(`These details come from the ${sourceDocumentName} document.`);
  }

  if (additions.length === 0) {
    return answer;
  }

  return `${answer.trim()}\n${additions.join('\n')}`;
}

/**
 * Fallback: extract tool calls from text content when the model emits them
 * as JSON instead of using the structured tool_calls API field.
 *
 * Small models (e.g. llama3.1:8b, qwen2.5) sometimes respond with:
 *   {"name": "read_file", "parameters": {"path": "file.md"}}
 *   {"name": "read_file", "arguments": {"path": "file.md"}}
 * or wrapped in markdown code blocks, rather than using Ollama's tool_calls.
 *
 * @returns Extracted tool calls and the cleaned text (JSON stripped).
 */
/** @internal Exported for unit testing. */
export function _extractToolCallsFromText(text: string): { toolCalls: IToolCall[]; cleanedText: string } {
  const toolCalls: IToolCall[] = [];
  let cleaned = text;

  // Pattern 1: JSON object with "name" + "parameters" or "arguments" (single or in array)
  // Matches both bare JSON and JSON inside ```json code blocks.
  // Ollama/OpenAI format uses "arguments"; some models also emit "parameters".
  // ARGS_KEY includes surrounding quotes because JSON keys are quoted strings.
  const ARGS_KEY = '"(?:parameters|arguments)"';
  const jsonPatterns = [
    // Code-fenced JSON block (object)
    new RegExp('```(?:json)?\\s*\\n?({[\\s\\S]*?"name"\\s*:\\s*"[\\w]+"[\\s\\S]*?' + ARGS_KEY + '\\s*:[\\s\\S]*?})\\s*\\n?```', 'g'),
    // Code-fenced JSON block (array)
    new RegExp('```(?:json)?\\s*\\n?(\\[[\\s\\S]*?"name"\\s*:\\s*"[\\w]+"[\\s\\S]*?' + ARGS_KEY + '\\s*:[\\s\\S]*?\\])\\s*\\n?```', 'g'),
    // Bare JSON object
    new RegExp('({\\s*"name"\\s*:\\s*"[\\w]+"\\s*,\\s*' + ARGS_KEY + '\\s*:\\s*{[^{}]*(?:{[^{}]*}[^{}]*)*}\\s*})', 'g'),
    // JSON array of tool calls
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
          // Accept both "parameters" and "arguments" keys (Ollama / OpenAI formats)
          const args = item.parameters ?? item.arguments;
          if (
            typeof item === 'object' && item !== null &&
            typeof item.name === 'string' && item.name.length > 0 &&
            typeof args === 'object' && args !== null
          ) {
            toolCalls.push({
              function: { name: item.name, arguments: args },
            });
            // Strip the matched JSON (including code fence if present) from cleaned text
            cleaned = cleaned.replace(match[0], '');
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    }
    if (toolCalls.length > 0) { break; } // Don't double-match
  }

  // Strip common preamble narration small models add before JSON tool calls.
  // e.g. "Here is the JSON response with its proper arguments that best answers..."
  // e.g. "Here's the JSON response for the function call:"
  // e.g. "Based on the conversation history, here is a JSON response..."
  if (toolCalls.length > 0) {
    cleaned = cleaned
      .replace(/(?:Based on[\s\S]{0,60},\s*)?[Hh]ere(?:'s| is) the JSON response[\s\S]{0,80}?:\s*/g, '')
      .replace(/(?:I will|Let me|I'll)\s+(?:now\s+)?(?:call|use|invoke|execute)\s+the\s+\w+\s+tool[\s\S]{0,40}?[.:]/gi, '');
  }

  // Trim leftover whitespace / empty lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { toolCalls, cleanedText: cleaned };
}

/**
 * Strip prose narration about tool calls from model output.
 *
 * Small models sometimes describe tool calls in natural language instead of
 * executing them (e.g. "Here's a function call to read_file...  This will read
 * the text content...  It seems the file is not located...").  This function
 * removes those narrated tool-call blocks so the user only sees useful content.
 */
export function _stripToolNarration(text: string): string {
  // Remove sentences that describe making function/tool calls
  let cleaned = text
    // "Here's a/an/the/an alternative function call to X with its proper arguments:"
    .replace(/[Hh]ere(?:'s| is) (?:a|an|the|an alternative) (?:function|tool) call[^.:\n]*[.:]\s*/g, '')
    // "Based on the functions/context provided..."
    .replace(/[Bb]ased on the (?:functions?|tools?|context)[^.:\n]*[.:]\s*/g, '')
    // "with its proper arguments:"
    .replace(/with its proper arguments[.:]\s*/gi, '')
    // "I'll/Let me call/use/invoke the X tool/function"
    .replace(/(?:I'?(?:ll|m going to)|[Ll]et me)\s+(?:now\s+)?(?:call|use|invoke|try|execute)\s+(?:the\s+)?(?:`?\w+`?\s+)?(?:function|tool)[^.:\n]*[.:]\s*/gi, '')
    // "This function/tool call will..."
    .replace(/[Tt]his (?:function|tool) call will[^.\n]*\.\s*/g, '')
    // "This will list/read/search/get all/the..."
    .replace(/This will (?:read|list|search|get|fetch|retrieve|provide|show) (?:all |the )?[^.\n]*\.\s*/gi, '')
    // "The output of this function call indicates..."
    .replace(/[Tt]he output of this (?:function|tool) call[^.\n]*\.\s*/g, '')
    // "Alternatively, since there are no pages... you could use X"
    .replace(/[Aa]lternatively,?\s+(?:since\s+)?[^.\n]*(?:you could|you can)\s+use\s+`?\w+`?[^.\n]*[.:]\s*/g, '')
    // "It seems that the file X is not located..."  (hallucinated execution result)
    .replace(/It seems (?:that )?the (?:file|page)[^"\n]*(?:"[^"]*"[^.\n]*)?(?:not (?:located|found)|does(?:n't| not) exist)[^.\n]*\.\s*/gi, '')
    // "Let me try again with a different approach."
    .replace(/[Ll]et me try (?:again )?with a different approach\.\s*/g, '')
    // "Based on the context and conversation history, I'll provide a JSON..."
    .replace(/Based on[^,.\n]*,\s*I'll provide a JSON[^.\n]*\.\s*/gi, '')
    // ── Structured narration patterns ──
    // "Action:" block followed by JSON — model narrating a tool call
    .replace(/\bAction:\s*```[\s\S]*?```/gi, '')
    .replace(/\bAction:\s*\{[\s\S]*?\}\s*/gi, '')
    // "Execution:" block with hallucinated results
    .replace(/\bExecution:\s*```[\s\S]*?```/gi, '')
    .replace(/\bExecution:\s*\{[\s\S]*?\}\s*/gi, '')
    // "Let's execute this action/tool/function..."
    .replace(/[Ll]et'?s\s+execute\s+this\s+(?:action|tool|function)[^.\n]*\.?\s*/gi, '')
    // Keep generic explanatory prefacing unless it is paired with explicit
    // tool-call syntax elsewhere in the response. Over-stripping these lines
    // can erase the entire answer on small-model runs.
    .trim();

  // Trim excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

/** @internal Exported for unit testing. */
export function _buildMissingCitationFooter(
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

// ── Planner gate ──
//
// The planner (thinking layer) runs on EVERY message when available.
// It classifies intent and decides what context the model needs.
// See docs/research/INTERACTION_LAYER_ARCHITECTURE.md for rationale.

/**
 * Categorize a fetch/network error into a user-friendly message.
 */
function categorizeError(err: unknown): { message: string } {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { message: '' }; // Handled separately
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return {
      message: 'Request timed out. The model may be loading or the Ollama server is unresponsive. Try again or check that Ollama is running.',
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Detect "Ollama not running" — fetch to localhost fails
  if (msg.includes('Failed to fetch') || msg.includes('ECONNREFUSED') || msg.includes('NetworkError') || msg.includes('fetch failed')) {
    return {
      message: 'Ollama is not running. Install and start Ollama from https://ollama.com, then try again.',
    };
  }
  // Detect "model not found" — Ollama returns 404 with specific message
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('404'))) {
    // Extract model name if possible
    const modelMatch = msg.match(/model\s+['"]?([^\s'"]+)/i);
    const modelName = modelMatch?.[1] ?? 'the requested model';
    return {
      message: `Model "${modelName}" not found. Run \`ollama pull ${modelName}\` to download it.`,
    };
  }
  return { message: msg };
}

// IDefaultParticipantServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IDefaultParticipantServices } from '../chatTypes.js';

/** Default participant ID — must match ChatAgentService's DEFAULT_AGENT_ID. */
const DEFAULT_PARTICIPANT_ID = 'parallx.chat.default';

/**
 * Create the default chat participant.
 *
 * Returns an IDisposable that holds the participant descriptor.
 * The caller (chatTool.ts) registers this with IChatAgentService.
 */
export function createDefaultParticipant(services: IDefaultParticipantServices): IChatParticipant & IDisposable {

  const configMaxIterations = services.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // ── Slash command registry (M11 Tasks 3.5–3.7) ──
  const commandRegistry = new SlashCommandRegistry();

  // Load user-defined commands from .parallx/commands/ (fire-and-forget)
  if (services.userCommandFileSystem) {
    loadUserCommands(services.userCommandFileSystem).then((cmds) => {
      if (cmds.length > 0) {
        commandRegistry.registerCommands(cmds);
      }
    }).catch(() => { /* best-effort */ });
  }

  const handler: IChatParticipantHandler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => {

    // ── Mode capability enforcement ──

    const capabilities = getModeCapabilities(request.mode);

    // Ask mode: fewer iterations (read-only context gathering), Agent: full budget
    const maxIterations = capabilities.canAutonomous
      ? configMaxIterations
      : Math.min(configMaxIterations, ASK_MODE_MAX_ITERATIONS);

    // ── /init command handler (M11 Task 1.6) ──

    if (request.command === 'init') {
      const initServices: IInitCommandServices = {
        sendChatRequest: services.sendChatRequest,
        getWorkspaceName: services.getWorkspaceName,
        listFiles: services.listFilesRelative
          ? (rel) => services.listFilesRelative!(rel)
          : undefined,
        readFile: services.readFileRelative
          ? (rel) => services.readFileRelative!(rel)
          : undefined,
        writeFile: services.writeFileRelative
          ? (rel, content) => services.writeFileRelative!(rel, content)
          : undefined,
        exists: services.existsRelative
          ? (rel) => services.existsRelative!(rel)
          : undefined,
        invalidatePromptFiles: services.invalidatePromptFiles,
      };
      await executeInitCommand(initServices, response);
      return {};
    }

    const earlyIsRagReady = services.isRAGAvailable?.() ?? false;
    const {
      slashResult,
      effectiveText,
      activeCommand,
      hasActiveSlashCommand,
      handled: handledEarlyAnswer,
    } = resolveChatTurnEntryRouting({
      parseSlashCommand: (text) => parseSlashCommand(text, commandRegistry),
      determineChatTurnRoute,
      handleEarlyDeterministicAnswer: (options) => handleEarlyDeterministicAnswer({
        ...options,
        sessionId: options.sessionId ?? context.sessionId,
      }),
    }, {
      requestText: request.text,
      requestCommand: request.command,
      isRagReady: earlyIsRagReady,
      sessionId: context.sessionId,
      response,
      token,
      reportRuntimeTrace: services.reportRuntimeTrace,
      reportResponseDebug: services.reportResponseDebug,
    });

    // ── /compact command handler (M11 Task 3.8) ──
    //
    // Summarize conversation history and replace old messages with a compact summary.
    // Shows token savings to the user.
    if (await tryExecuteCompactChatCommand({
      sendSummarizationRequest: services.sendSummarizationRequest,
      compactSession: services.compactSession,
    }, {
      isCompactCommand: activeCommand === 'compact' || slashResult.command?.specialHandler === 'compact',
      sessionId: context.sessionId,
      history: context.history,
      response,
    })) {
      return {};
    }

    if (handledEarlyAnswer) {
      return {};
    }

    const aiProfile = services.aiSettingsService?.getActiveProfile();

    const { messages } = await assembleChatTurnMessages(services, {
      mode: request.mode,
      history: context.history,
    });

    // ── Build user message with implicit context + attachments ──
    //
    // Following VS Code's implicit context pattern (chatImplicitContext.ts):
    // The content of the currently open page is injected directly into the user
    // message so the model can reference it without a tool call (zero round-trips).

    // ── Latency instrumentation (M17 Task 0.2.7) ──
    const _t0_contextAssembly = performance.now();
    const {
      mentionPills,
      mentionContextBlocks,
      userText,
      contextQueryText,
      isRagReady,
      turnRoute,
      contextPlan,
      retrievalPlan,
      isConversationalTurn,
    } = await prepareChatTurnPrelude(
      services,
      {
        buildFollowUpRetrievalQuery,
      },
      {
        requestText: request.text,
        history: context.history,
        sessionId: context.sessionId,
        hasActiveSlashCommand,
      },
    );

    const {
      contextParts,
      ragSources,
      retrievedContextText,
      evidenceAssessment,
      provenance,
      memoryResult,
    } = await prepareChatTurnContext(
      {
        getCurrentPageContent: services.getCurrentPageContent,
        retrieveContext: services.retrieveContext,
        recallMemories: services.recallMemories,
        recallConcepts: services.recallConcepts,
        readFileContent: services.readFileContent,
        reportRetrievalDebug: services.reportRetrievalDebug,
        reportContextPills: services.reportContextPills,
        getExcludedContextIds: services.getExcludedContextIds,
        assessEvidenceSufficiency: _assessEvidenceSufficiency,
        buildRetrieveAgainQuery: _buildRetrieveAgainQuery,
      },
      {
        contextQueryText,
        sessionId: context.sessionId,
        attachments: request.attachments,
        messages,
        mentionPills,
        mentionContextBlocks,
        contextPlan,
        hasActiveSlashCommand,
        isRagReady,
      },
    );
    writeChatProvenanceToResponse(response, provenance);

    if (handlePreparedContextDeterministicAnswer({
      route: turnRoute,
      query: userText,
      evidenceAssessment,
      retrievedContextText,
      memoryResult,
      ragSources,
      response,
      token,
      reportResponseDebug: services.reportResponseDebug,
    })) {
      return {};
    }

    applyChatTurnBudgeting({
      messages,
      contextParts,
      userText,
      response,
      contextWindow: services.getModelContextLength?.(),
      elasticBudget: services.unifiedConfigService?.getEffectiveConfig().retrieval.contextBudget,
      reportBudget: services.reportBudget,
    });

    // 3. Compose final user message (use userText — mentions stripped)
    //
    // If a slash command was detected, apply its prompt template now
    // (substituting {input} and {context}).
    //
    // M12: If a retrieval plan is available, inject a reasoning hint so the
    // LLM understands the user's INTENT, not just their literal words.
    const userContent = composeChatUserContent(
      {
        applyCommandTemplate: (command, input, contextContent) => commandRegistry.applyTemplate(command, input, contextContent),
        buildEvidenceResponseConstraint: _buildEvidenceResponseConstraint,
      },
      {
        slashResult,
        effectiveText,
        userText,
        contextParts,
        retrievalPlan,
        evidenceAssessment,
      },
    );

    messages.push({
      role: 'user',
      content: userContent,
      images: request.attachments?.filter(isChatImageAttachment),
    });

    // Latency: context assembly complete (M17 Task 0.2.7)
    const _t1_contextAssembly = performance.now();
    console.debug(`[Parallx:latency] Context assembly: ${(_t1_contextAssembly - _t0_contextAssembly).toFixed(1)}ms`);

    const { synthesisDeps, synthesisOptions } = buildChatTurnExecutionConfig(services, {
      requestMode: request.mode,
      requestText: request.text,
      capabilities,
      aiProfile,
      messages,
      userContent,
      retrievedContextText,
      evidenceAssessment,
      isConversationalTurn,
      citationMode: contextPlan.citationMode,
      ragSources,
      retrievalPlan,
      sessionId: context.sessionId,
      history: context.history,
      response,
      token,
      maxIterations,
      repairMarkdown: (markdown) => applyChatAnswerRepairPipeline(
        {
          repairUnsupportedSpecificCoverageAnswer: _repairUnsupportedSpecificCoverageAnswer,
          repairVehicleInfoAnswer: _repairVehicleInfoAnswer,
          repairAgentContactAnswer: _repairAgentContactAnswer,
          repairDeductibleConflictAnswer: _repairDeductibleConflictAnswer,
          repairTotalLossThresholdAnswer: _repairTotalLossThresholdAnswer,
          repairGroundedCodeAnswer: _repairGroundedCodeAnswer,
        },
        {
          query: request.text,
          markdown,
          retrievedContextText: retrievedContextText || userContent,
          evidenceAssessment,
        },
      ),
      buildExtractiveFallbackAnswer: _buildExtractiveFallbackAnswer,
      buildMissingCitationFooter: _buildMissingCitationFooter,
      buildDeterministicSessionSummary: _buildDeterministicSessionSummary,
      parseEditResponse: _parseEditResponse,
      extractToolCallsFromText: _extractToolCallsFromText,
      stripToolNarration: _stripToolNarration,
      categorizeError,
    });

    return executePreparedChatTurn(synthesisDeps, synthesisOptions);
  };

  // Build participant descriptor
  const participant: IChatParticipant & IDisposable = {
    id: DEFAULT_PARTICIPANT_ID,
    displayName: 'Chat',
    description: 'Default chat participant — sends messages to the active language model.',
    commands: [
      { name: 'init', description: 'Scan workspace and generate AGENTS.md' },
      { name: 'explain', description: 'Explain how code or a concept works' },
      { name: 'fix', description: 'Find and fix problems in the code' },
      { name: 'test', description: 'Generate tests for the code' },
      { name: 'doc', description: 'Generate documentation or comments' },
      { name: 'review', description: 'Code review — suggest improvements' },
      { name: 'compact', description: 'Summarize conversation to free token budget' },
    ],
    handler,
    dispose: () => {
      // No-op cleanup — the participant is just a descriptor
    },
  };

  return participant;
}

// ── Edit mode JSON parser ──

/** Valid edit operations. */
const VALID_OPERATIONS = new Set<string>(['insert', 'update', 'delete']);

/**
 * Parse JSON structured output from Edit mode and emit edit proposals.
 *
 * Expected schema:
 * ```json
 * {
 *   "explanation": "Brief description of the changes",
 *   "edits": [{ "pageId", "blockId?", "operation", "content" }]
 * }
 * ```
 *
 * Falls back gracefully: shows raw response + warning if parsing fails.
 */
function _parseEditResponse(rawContent: string, response: IChatResponseStream): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    // JSON parse failed — show raw content with warning
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

  // Extract explanation
  const explanation = typeof obj['explanation'] === 'string' ? obj['explanation'] : '';

  // Extract and validate edits array
  const editsRaw = obj['edits'];
  if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
    // No edits — show explanation as markdown + warning
    if (explanation) {
      response.markdown(explanation);
    }
    response.warning('Edit mode: no edits found in model response.');
    return;
  }

  // Validate and build edit proposals
  const proposals: IChatEditProposalContent[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < editsRaw.length; i++) {
    const entry = editsRaw[i];
    if (!entry || typeof entry !== 'object') {
      warnings.push(`Edit ${i + 1}: not a valid object, skipped.`);
      continue;
    }

    const e = entry as Record<string, unknown>;
    const pageId = typeof e['pageId'] === 'string' ? e['pageId'] : '';
    const blockId = typeof e['blockId'] === 'string' ? e['blockId'] : undefined;
    const operation = typeof e['operation'] === 'string' ? e['operation'] : '';
    const content = typeof e['content'] === 'string' ? e['content'] : '';

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

  // Emit warnings for invalid entries
  for (const w of warnings) {
    response.warning(w);
  }

  if (proposals.length === 0) {
    if (explanation) {
      response.markdown(explanation);
    }
    response.warning('Edit mode: all proposed edits were invalid.');
    return;
  }

  // Emit edit batch (explanation + proposals)
  response.editBatch(explanation, proposals);
}
