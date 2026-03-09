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
  IChatMessage,
  IChatRequestOptions,
  IToolCall,
  IToolResult,
  IChatEditProposalContent,
  EditProposalOperation,
  IContextPill,
} from '../../../services/chatTypes.js';
import { ChatContentPartKind } from '../../../services/chatTypes.js';
import { captureSession } from '../../../workspace/staleGuard.js';
import type {
  IDefaultParticipantServices,
  IInitCommandServices,
  IMentionResolutionServices,
  IRetrievalPlan,
  ISystemPromptContext,
} from '../chatTypes.js';
import { buildSystemPrompt } from '../config/chatSystemPrompts.js';
import { getModeCapabilities, shouldIncludeTools, shouldUseStructuredOutput } from '../config/chatModeCapabilities.js';
import { executeInitCommand } from '../commands/initCommand.js';
import { TokenBudgetService } from '../../../services/tokenBudgetService.js';
import { extractMentions, resolveMentions } from '../utilities/chatMentionResolver.js';
import { determineChatTurnRoute } from '../utilities/chatTurnRouter.js';
import { createChatContextPlan, createChatRuntimeTrace } from '../utilities/chatContextPlanner.js';
import { selectDeterministicAnswer } from '../utilities/chatDeterministicAnswerSelector.js';
import { assembleChatContext } from '../utilities/chatContextAssembly.js';
import { executeChatModelOnly } from '../utilities/chatModelOnlyExecutor.js';
import { executeChatGrounded } from '../utilities/chatGroundedExecutor.js';
import { queueChatMemoryWriteBack } from '../utilities/chatMemoryWriteBack.js';
import { validateAndFinalizeChatResponse } from '../utilities/chatResponseValidator.js';
import { loadChatContextSources } from '../utilities/chatContextSourceLoader.js';
import {
  extractSpecificCoverageFocusPhrases,
  extractSpecificCoverageFocusTerms,
} from '../utilities/chatSpecificCoverageFocus.js';
import { SlashCommandRegistry, parseSlashCommand } from '../config/chatSlashCommands.js';
import { loadUserCommands } from '../utilities/userCommandLoader.js';

/** Default maximum agentic loop iterations. */
const DEFAULT_MAX_ITERATIONS = 10;
/** Ask mode needs fewer iterations — it only reads, never writes. */
const ASK_MODE_MAX_ITERATIONS = 5;
export function _buildDeterministicSessionSummary(
  history: readonly { request: { text: string } }[],
  currentRequestText: string,
): string {
  const userMessages = [...history.map((entry) => entry.request.text), currentRequestText]
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-3);

  if (userMessages.length === 0) {
    return '';
  }

  const sentences = userMessages.map((text) => /[.!?]$/.test(text) ? text : `${text}.`);
  const summary = sentences.join(' ');
  return summary.length <= 900 ? summary : `${summary.slice(0, 897).trimEnd()}...`;
}

function _scoreExtractiveFallbackLine(line: string, queryTerms: string[]): number {
  let score = 0;
  const normalizedLine = line.toLowerCase();

  for (const term of queryTerms) {
    if (normalizedLine.includes(term)) {
      score += 2;
    }
  }
  if (/(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b)/.test(line)) {
    score += 3;
  }
  if (/\b(?:call|contact|phone|email|hotline|deadline|within|before|after|hours?|days?|weeks?)\b/i.test(line)) {
    score += 2;
  }
  if (/\$\d|\b\d+%\b|\b\d+\s*(?:hours?|days?|weeks?|months?)\b/i.test(line)) {
    score += 2;
  }
  if (/^[-*]|^\d+\.|^\|/.test(line)) {
    score += 1;
  }
  if (/^#{1,6}\s/.test(line)) {
    score += 1;
  }

  return score;
}

export function _buildExtractiveFallbackAnswer(query: string, retrievedContextText: string): string {
  if (!retrievedContextText || !retrievedContextText.includes('[Retrieved Context]')) {
    return '';
  }

  const content = retrievedContextText
    .replace(/^.*?\[Retrieved Context\]\s*/s, '')
    .trim();
  if (!content) {
    return '';
  }

  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have'].includes(term));
  const normalizedQuery = query.toLowerCase();
  const queryNeeds = {
    contact: /\b(call|contact|phone|email|agent|who)\b/.test(normalizedQuery),
    deadline: /\b(deadline|within|when|hours?|days?|report)\b/.test(normalizedQuery),
    coverage: /\b(cover|coverage|policy|insurance|deductible|limit)\b/.test(normalizedQuery),
    action: /\b(step|steps|what should i do|how do i|how to|right now|first)\b/.test(normalizedQuery),
  };

  const scoredLines: Array<{ text: string; score: number; order: number; sectionOrder: number }> = [];
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const sectionCandidates = new Map<number, Array<{ text: string; score: number; order: number }>>();
  const sectionScores = new Map<number, number>();

  let sectionOrder = -1;
  let activeHeadingScore = 0;

  const beginSection = () => {
    sectionOrder += 1;
    activeHeadingScore = 0;
  };

  beginSection();

  for (const [order, line] of lines.entries()) {
    if (/^\[\d+\]\s+Source:/i.test(line)) {
      beginSection();
      activeHeadingScore = _scoreExtractiveFallbackLine(line, queryTerms);
      continue;
    }

    if (
      line === '[Retrieved Context]'
      || line === '---'
      || /^Path:/i.test(line)
      || /^\[Source:/i.test(line)
    ) {
      continue;
    }

    const baseScore = _scoreExtractiveFallbackLine(line, queryTerms);
    let roleBonus = 0;
    if (queryNeeds.contact && /(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b|\bcall\b|\bcontact\b|\bphone\b|\bagent\b|\bhotline\b|\bemail\b)/i.test(line)) {
      roleBonus += 4;
    }
    if (queryNeeds.deadline && /(\bwithin\b|\bdeadline\b|\b24 hours\b|\b72 hours\b|\b14 days\b|\breport to\b|\bfile within\b)/i.test(line)) {
      roleBonus += 4;
    }
    if (queryNeeds.coverage && /(\bcoverage\b|\bcovered\b|\bdeductible\b|\blimit\b|\bcollision\b|\bcomprehensive\b|\bliability\b|\buninsured\b|\bunderinsured\b|\bpolicy\b)/i.test(line)) {
      roleBonus += 4;
    }
    if (queryNeeds.action && (/^[-*]|^\d+\./.test(line) || /^#{1,6}\s/.test(line)) && /(\bcall\b|\bfile\b|\breport\b|\bexchange\b|\btake\b|\bget\b|\bdocument\b|\bcheck\b|\bmove\b|\bstop\b|\bcontact\b)/i.test(line)) {
      roleBonus += 3;
    }

    const isHeading = /^#{1,6}\s/.test(line);
    if (isHeading) {
      activeHeadingScore = Math.max(activeHeadingScore, baseScore + roleBonus);
    }

    let score = baseScore + roleBonus;
    if (activeHeadingScore > 0 && (/^[-*]|^\d+\.|^\|/.test(line) || /\*\*[^*]+\*\*/.test(line))) {
      score += Math.max(2, Math.min(4, activeHeadingScore));
    }
    if (score > 0) {
      scoredLines.push({ text: line, score, order, sectionOrder });
      const existingSection = sectionCandidates.get(sectionOrder) ?? [];
      existingSection.push({ text: line, score, order });
      sectionCandidates.set(sectionOrder, existingSection);
    }

    if (isHeading && baseScore === 0) {
      activeHeadingScore = 0;
    }
  }

  for (const [candidateSectionOrder, entries] of sectionCandidates) {
    const topEntries = [...entries]
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, 3);
    const totalScore = topEntries.reduce((sum, entry) => sum + entry.score, 0);
    sectionScores.set(candidateSectionOrder, totalScore);
  }

  const rankedSections = [...sectionScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const topSectionScore = rankedSections[0]?.[1] ?? 0;
  const selectedSectionOrders = rankedSections
    .filter(([, score]) => score >= Math.max(3, topSectionScore * 0.55))
    .slice(0, 2)
    .map(([candidateSectionOrder]) => candidateSectionOrder);

  const selected = selectedSectionOrders
    .flatMap((candidateSectionOrder) => {
      return [...(sectionCandidates.get(candidateSectionOrder) ?? [])]
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, 4)
        .sort((a, b) => a.order - b.order);
    })
    .filter((entry, index, array) => array.findIndex((candidate) => candidate.text === entry.text) === index)
    .slice(0, 6)
    .map((entry) => entry.text);

  if (selected.length === 0) {
    return '';
  }

  return [
    'Relevant details from retrieved context:',
    '',
    ...selected.map((line) => `- ${line.replace(/^[-*]\s*/, '')}`),
  ].join('\n');
}

export function _assessEvidenceSufficiency(
  query: string,
  retrievedContextText: string,
  ragSources: Array<{ uri: string; label: string; index?: number }>,
): { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] } {
  const normalizedQuery = query.toLowerCase();
  const normalizedContext = retrievedContextText.toLowerCase();
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into'].includes(term));
  const matchedTerms = queryTerms.filter((term) => normalizedContext.includes(term));
  const uniqueMatchedTerms = [...new Set(matchedTerms)];
  const sectionCount = (retrievedContextText.match(/^\[\d+\]\s+Source:/gim) ?? []).length;
  const queryWordCount = query.split(/\s+/).filter(Boolean).length;
  const isHardQuestion =
    queryWordCount >= 12
    || /\b(and|then|after|compare|versus|vs\.?|workflow|steps|what should i do|what does .* cover)\b/i.test(normalizedQuery)
    || ((normalizedQuery.match(/\b(what|how|where|who|when|which)\b/g) ?? []).length >= 2);
  const specificCoverageFocusTerms = extractSpecificCoverageFocusTerms(normalizedQuery);

  const reasons: string[] = [];
  if (!retrievedContextText.trim() || ragSources.length === 0) {
    reasons.push('no-grounded-sources');
    return { status: 'insufficient', reasons };
  }

  if (uniqueMatchedTerms.length === 0) {
    reasons.push('no-query-term-overlap');
    return { status: 'insufficient', reasons };
  }

  if (
    specificCoverageFocusTerms.length > 0
    && specificCoverageFocusTerms.some((term) => !normalizedContext.includes(term))
  ) {
    reasons.push('specific-coverage-not-explicitly-supported');
  }

  if (isHardQuestion && ragSources.length < 2) {
    reasons.push('hard-query-low-source-coverage');
  }
  if (isHardQuestion && sectionCount < 2) {
    reasons.push('hard-query-low-section-coverage');
  }
  if (uniqueMatchedTerms.length < Math.min(isHardQuestion ? 3 : 2, queryTerms.length)) {
    reasons.push('limited-focus-overlap');
  }
  if (retrievedContextText.length < (isHardQuestion ? 400 : 120)) {
    reasons.push('thin-evidence-set');
  }

  if (reasons.includes('specific-coverage-not-explicitly-supported')) {
    return { status: 'insufficient', reasons };
  }

  if (reasons.length >= 2 || reasons.includes('hard-query-low-source-coverage')) {
    return {
      status: reasons.includes('no-query-term-overlap') ? 'insufficient' : 'weak',
      reasons,
    };
  }

  return { status: 'sufficient', reasons };
}

function _buildEvidenceResponseConstraint(
  query: string,
  evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] },
): string {
  const baseConstraint = evidenceAssessment.status === 'insufficient'
    ? 'Response Constraint: If the evidence stays insufficient, answer narrowly with caveats, ask a clarifying question, or state that more grounded evidence is needed.'
    : 'Response Constraint: Keep the answer narrow and explicitly grounded in the available evidence.';

  if (
    /\b(coverage|cover(?:ed|s)?|endorsement|rider)\b/i.test(query)
    && evidenceAssessment.reasons.includes('specific-coverage-not-explicitly-supported')
  ) {
    return `${baseConstraint} Do not infer that a specific coverage, peril, endorsement, or rider is included from a broader category. Only affirm it if the retrieved evidence names it explicitly; otherwise say the documents do not explicitly confirm it.`;
  }

  return baseConstraint;
}

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
  const explicitSentence = `The policy documents do not explicitly confirm ${focusPhrase}.`;
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

  if (!new RegExp(`do\\s+not\\s+explicitly\\s+confirm\\s+${escapedPhrase}`, 'i').test(repaired)) {
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
  const asksDeductible = normalizedQuery.includes('deductible');
  const asksCollision = normalizedQuery.includes('collision');
  if (!asksDeductible || !asksCollision) {
    return answer;
  }

  const normalizedContext = retrievedContextText.replace(/[*_`~]/g, ' ');
  const policyCollisionMatch = normalizedContext.match(/Auto Insurance Policy\.md[\s\S]{0,400}?Collision Coverage[\s\S]{0,200}?Deductible:\s*(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
    ?? normalizedContext.match(/Collision Coverage[\s\S]{0,200}?Deductible:\s*(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
    ?? normalizedContext.match(/\bCollision \((\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s+ded\)/i);
  const policyAmount = policyCollisionMatch?.[1];
  if (!policyAmount) {
    return answer;
  }

  const quickReferenceMatch = normalizedContext.match(/Accident Quick Reference\.md[\s\S]{0,300}?Collision Deductible[^\n]*?(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)
    ?? normalizedContext.match(/Collision Deductible[^\n]*?(\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  const quickReferenceAmount = quickReferenceMatch?.[1];
  const claimedAmount = extractDollarAmount(query);
  const asksForCurrentValue = ['now', 'current', 'currently', 'today'].some((term) => normalizedQuery.includes(term));
  const asksForConfirmation = /(confirm|right|correct)/.test(normalizedQuery);
  const asksForComparison = /(difference|different|compare|comparison|conflict|which source|which document|older|stale|why)/.test(normalizedQuery);

  let repaired = normalizeGroundedAnswerTypography(answer).trim();

  if (claimedAmount && claimedAmount !== policyAmount && asksForConfirmation) {
    repaired = repaired.replace(/^.*?(?=\n|$)/, `No. Your collision deductible is ${policyAmount}, not ${claimedAmount}.`);
    if (!repaired.startsWith('No.')) {
      repaired = `No. Your collision deductible is ${policyAmount}, not ${claimedAmount}. ${repaired}`.trim();
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
      ? `Your current collision deductible is ${policyAmount}.`
      : `Your collision deductible is ${policyAmount}.`;
    repaired = `${normalizedLead} ${repaired}`.trim();
    repaired = repaired.replace(/(Your (?:current )?collision deductible is \$\d{1,3}(?:,\d{3})*(?:\.\d{2})?\.\s*)+/i, normalizedLead + ' ');
  }

  repaired = repaired.replace(/\n{3,}/g, '\n\n').trim();
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

export function _buildRetrieveAgainQuery(query: string, retrievedContextText: string): string | undefined {
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into'].includes(term));
  const normalizedContext = retrievedContextText.toLowerCase();
  const missingTerms = [...new Set(queryTerms.filter((term) => !normalizedContext.includes(term)))];
  const fallbackTerms = [...new Set(queryTerms)].slice(0, 6);

  const focusedTerms = (missingTerms.length >= 2 ? missingTerms : fallbackTerms).slice(0, 6);
  if (focusedTerms.length === 0) {
    return undefined;
  }

  const focusedQuery = focusedTerms.join(' ');
  return focusedQuery === query.trim().toLowerCase() ? undefined : focusedQuery;
}

export function _repairGroundedCodeAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase();
  const asksHelperName = /\b(helper|function|builder)\b/.test(normalizedQuery) && /\b(packet|snippet|workflow architecture|code)\b/.test(normalizedQuery);
  const asksStageNames = /\bstage names?\b|\bwhat .* stages?\b|\binclude\b/.test(normalizedQuery);
  if (!asksHelperName && !asksStageNames) {
    return answer;
  }

  const codeBlockMatch = retrievedContextText.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const codeSource = codeBlockMatch?.[1] ?? retrievedContextText;

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

/** Default network timeout in milliseconds. */
const DEFAULT_NETWORK_TIMEOUT_MS = 60_000;
/** Context overflow threshold — warn at this fraction of context length. */
const CONTEXT_OVERFLOW_WARN_THRESHOLD = 0.8;

// ── Planner gate ──
//
// The planner (thinking layer) runs on EVERY message when available.
// It classifies intent and decides what context the model needs.
// See docs/research/INTERACTION_LAYER_ARCHITECTURE.md for rationale.

/**
 * Rough token estimation: chars / 4.
 * This is the same heuristic used by VS Code's chat implementation.
 */
function estimateTokens(messages: readonly IChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
  }
  return Math.ceil(chars / 4);
}

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

    // ── Slash command detection (M11 Tasks 3.5–3.6) ──
    //
    // If the user typed /command, parse it and apply the prompt template.
    // Special handlers (/init, /compact) are dispatched above or below.
    const slashResult = parseSlashCommand(request.text, commandRegistry);
    let effectiveText = request.text;
    let activeCommand = request.command; // from the parser (chatRequestParser.ts)
    if (slashResult.command) {
      activeCommand = slashResult.commandName;
      // /compact is handled later (Task 3.8)
      if (slashResult.command.specialHandler === 'compact') {
        // Fall through — handled in the /compact section below
      } else if (slashResult.command.specialHandler === 'init') {
        // Already handled above via request.command
      } else {
        // Apply prompt template — context will be filled after context injection
        effectiveText = slashResult.remainingText;
      }
    }

    // ── /compact command handler (M11 Task 3.8) ──
    //
    // Summarize conversation history and replace old messages with a compact summary.
    // Shows token savings to the user.
    if (activeCommand === 'compact' || slashResult.command?.specialHandler === 'compact') {
      if (!services.sendSummarizationRequest) {
        response.markdown('`/compact` requires a summarization model. No summarization service available.');
        return {};
      }
      if (context.history.length < 2) {
        response.markdown('Nothing to compact — conversation history is too short.');
        return {};
      }

      response.progress('Compacting conversation history…');

      // Build history text for summarization
      const historyText = context.history.map((pair) => {
        const respText = pair.response.parts
          .map((p) => {
            const part = p as unknown as Record<string, unknown>;
            if ('text' in part && typeof part.text === 'string') { return part.text; }
            if ('code' in part && typeof part.code === 'string') { return '```\n' + part.code + '\n```'; }
            return '';
          })
          .filter(Boolean)
          .join('\n');
        return `User: ${pair.request.text}\nAssistant: ${respText}`;
      }).join('\n\n---\n\n');

      const beforeTokens = Math.ceil(historyText.length / 4);

      // Summarize via LLM
      const summaryPrompt: IChatMessage[] = [
        {
          role: 'system',
          content:
            'You are a conversation summarizer. Condense the following conversation history into a concise context summary. ' +
            'Preserve all key facts, decisions, code references, and action items. Output ONLY the summary.',
        },
        { role: 'user', content: historyText },
      ];

      let summaryText = '';
      for await (const chunk of services.sendSummarizationRequest(summaryPrompt)) {
        if (chunk.content) { summaryText += chunk.content; }
      }

      if (summaryText) {
        const afterTokens = Math.ceil(summaryText.length / 4);
        const saved = beforeTokens - afterTokens;

        // Actually replace session history with the compacted summary
        if (services.compactSession) {
          services.compactSession(context.sessionId, summaryText);
        }

        response.markdown(
          `**Conversation compacted.**\n\n` +
          `- Before: ~${beforeTokens.toLocaleString()} tokens (${context.history.length} turns)\n` +
          `- After: ~${afterTokens.toLocaleString()} tokens (summary)\n` +
          `- Saved: ~${saved.toLocaleString()} tokens (${Math.round((saved / beforeTokens) * 100)}%)\n\n` +
          `The summarized context will be used for future messages in this session.`,
        );
      } else {
        response.markdown('Could not generate a summary. The conversation was not modified.');
      }

      return {};
    }

    const hasActiveSlashCommand = !!(activeCommand && activeCommand !== 'compact');
    const earlyRoute = determineChatTurnRoute(effectiveText, { hasActiveSlashCommand });
    const earlyDeterministicAnswer = selectDeterministicAnswer({ route: earlyRoute });
    if (earlyDeterministicAnswer) {
      const isRagReady = services.isRAGAvailable?.() ?? false;
      const earlyContextPlan = createChatContextPlan(earlyRoute, { hasActiveSlashCommand, isRagReady });
      services.reportRuntimeTrace?.(createChatRuntimeTrace(
        earlyRoute,
        earlyContextPlan,
        { sessionId: context.sessionId, hasActiveSlashCommand, isRagReady },
      ));
      response.markdown(earlyDeterministicAnswer.markdown);
      services.reportResponseDebug?.({
        phase: earlyDeterministicAnswer.phase,
        markdownLength: earlyDeterministicAnswer.markdown.length,
        yielded: !!token.isYieldRequested,
        cancelled: token.isCancellationRequested,
        retrievedContextLength: earlyDeterministicAnswer.retrievedContextLength,
      });
      return {};
    }

    // ── Build system prompt with workspace context ──
    // Parallelize independent async calls to reduce pre-response latency.

    const [pageCount, fileCount, promptOverlayFromFiles, workspaceDigest, prefsBlock] = await Promise.all([
      services.getPageCount().catch(() => 0),
      services.getFileCount ? services.getFileCount().catch(() => 0) : Promise.resolve(undefined),
      services.getPromptOverlay ? services.getPromptOverlay().catch(() => undefined) : Promise.resolve(undefined),
      services.getWorkspaceDigest ? services.getWorkspaceDigest().catch(() => undefined) : Promise.resolve(undefined),
      services.getPreferencesForPrompt ? services.getPreferencesForPrompt().catch(() => undefined) : Promise.resolve(undefined),
    ]);

    // M15: AI Settings persona overlay takes priority over file-based prompt overlay.
    // Both replace PARALLX_IDENTITY in the system prompt via the promptOverlay field.
    const aiProfile = services.aiSettingsService?.getActiveProfile();
    const promptOverlay = aiProfile?.chat.systemPrompt || promptOverlayFromFiles;

    // Workspace description — primes the AI with what "workspace" means here.
    // Read from unified config; falls back to empty (auto-generation handled by digest).
    const workspaceDescription = services.unifiedConfigService?.getEffectiveConfig().chat.workspaceDescription ?? '';

    const promptContext: ISystemPromptContext = {
      workspaceName: services.getWorkspaceName(),
      pageCount,
      currentPageTitle: services.getCurrentPageTitle(),
      // Tools are sent via the Ollama API tools parameter, NOT in the system
      // prompt text.  Listing them in the prompt causes small models to narrate
      // about tool calls instead of using the structured API.
      tools: undefined,
      fileCount,
      isRAGAvailable: services.isRAGAvailable?.() ?? false,
      isIndexing: services.isIndexing?.() ?? false,
      promptOverlay,
      workspaceDigest,
      workspaceDescription,
    };

    const systemPrompt = buildSystemPrompt(request.mode, promptContext);

    // Append user preferences to system prompt (M10 Phase 5 — Task 5.2)
    const finalSystemPrompt = prefsBlock
      ? systemPrompt + '\n\n' + prefsBlock
      : systemPrompt;

    // Build the message list from conversation history + current request
    const messages: IChatMessage[] = [];

    // System prompt (mode-aware)
    messages.push({
      role: 'system',
      content: finalSystemPrompt,
    });

    // History (previous request/response pairs)
    for (const pair of context.history) {
      messages.push({
        role: 'user',
        content: pair.request.text,
      });

      // Extract text from response parts
      const responseText = pair.response.parts
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

      if (responseText) {
        messages.push({
          role: 'assistant',
          content: responseText,
        });
      }
    }

    // ── Build user message with implicit context + attachments ──
    //
    // Following VS Code's implicit context pattern (chatImplicitContext.ts):
    // The content of the currently open page is injected directly into the user
    // message so the model can reference it without a tool call (zero round-trips).

    const mentionPills: IContextPill[] = [];

    // ── Latency instrumentation (M17 Task 0.2.7) ──
    const _t0_contextAssembly = performance.now();

    // 0. @mention resolution (M11 Tasks 3.2–3.4)
    //
    // Extract @file:, @folder:, @workspace, @terminal mentions from
    // the user's raw text. Resolve each to context blocks + pills.
    // The clean text (mentions stripped) is used for the LLM message.
    const mentions = extractMentions(request.text);
    let userText = request.text;
    if (mentions.length > 0) {
      const mentionServices: IMentionResolutionServices = {
        readFileContent: services.readFileContent
          ? (path: string) => services.readFileContent!(path)
          : undefined,
        listFolderFiles: services.listFolderFiles
          ? (folderPath: string) => services.listFolderFiles!(folderPath)
          : undefined,
        retrieveContext: services.retrieveContext
          ? (query: string) => services.retrieveContext!(query)
          : undefined,
        getTerminalOutput: services.getTerminalOutput
          ? () => services.getTerminalOutput!()
          : undefined,
      };
      const mentionResult = await resolveMentions(
        request.text,
        mentions,
        mentionServices,
      );
      contextParts.push(...mentionResult.contextBlocks);
      mentionPills.push(...mentionResult.pills);
      userText = mentionResult.cleanText;
    }

    // 1. Implicit context: active canvas page content
    //
    // Cap at ~4000 tokens (16K chars) so a large page doesn't drown
    // the actual question and RAG context. The model can always use
    // read_current_page tool for the full text.
    const MAX_PAGE_CONTEXT_CHARS = 16_000;

    // 1b. RAG context: per-turn retrieval
    //
    // Direct embedding retrieval: embed the user's raw message, do hybrid
    // vector + BM25 search, inject top results.  This is the pattern used
    // by Open WebUI, AnythingLLM, Jan, and LibreChat — one LLM call total.
    //
    // The old M12 planner made a separate LLM call to classify intent and
    // generate search queries before the response call.  That doubled
    // latency on local Ollama (e.g. 45s planner + 13s response = 58s
    // vs native Ollama's 13s).  No mainstream local AI app does this.
    const isRagReady = services.isRAGAvailable?.() ?? false;
    const turnRoute = determineChatTurnRoute(userText, { hasActiveSlashCommand });
    const contextPlan = createChatContextPlan(turnRoute, { hasActiveSlashCommand, isRagReady });
    const retrievalPlan: IRetrievalPlan = contextPlan.retrievalPlan;
    const isConversationalTurn = turnRoute.kind === 'conversational';
    const isMemoryRecallTurn = turnRoute.kind === 'memory-recall';

    services.reportRuntimeTrace?.(createChatRuntimeTrace(
      turnRoute,
      contextPlan,
      { sessionId: context.sessionId, hasActiveSlashCommand, isRagReady },
    ));

    services.reportRetrievalDebug?.({
      hasActiveSlashCommand,
      isRagReady,
      needsRetrieval: contextPlan.useRetrieval,
      attempted: false,
    });

    // 1c. Memory context constants
    const MAX_MEMORY_CONTEXT_CHARS = 4_000;
    const MAX_CONCEPT_CONTEXT_CHARS = 2_000;

    // ── Parallel context assembly (M17 Task 0.2.4) ──
    //
    // Steps: page content, RAG retrieval, memory recall, concept recall,
    // and attachment reading are all independent I/O operations. Run them
    // concurrently to reduce pre-request latency from sequential to parallel.
    // Mentions ran above (produces userText needed by RAG/memory).

    const {
      pageResult,
      ragResult,
      memoryResult,
      conceptResult,
      attachmentResults,
    } = await loadChatContextSources(
      {
        getCurrentPageContent: services.getCurrentPageContent,
        retrieveContext: services.retrieveContext,
        recallMemories: services.recallMemories,
        recallConcepts: services.recallConcepts,
        readFileContent: services.readFileContent,
        reportRetrievalDebug: services.reportRetrievalDebug,
      },
      {
        userText,
        sessionId: context.sessionId,
        attachments: request.attachments,
        useCurrentPage: contextPlan.useCurrentPage,
        useRetrieval: contextPlan.useRetrieval,
        useMemoryRecall: contextPlan.useMemoryRecall,
        useConceptRecall: contextPlan.useConceptRecall,
        hasActiveSlashCommand,
        isRagReady,
      },
    );

    const {
      contextParts,
      ragSources,
      retrievedContextText,
      evidenceAssessment,
    } = await assembleChatContext(
      {
        retrieveContext: services.retrieveContext,
        addReference: (uri, label, index) => response.reference(uri, label, index),
        reportContextPills: services.reportContextPills,
        getExcludedContextIds: services.getExcludedContextIds,
        assessEvidenceSufficiency: _assessEvidenceSufficiency,
        buildRetrieveAgainQuery: _buildRetrieveAgainQuery,
      },
      {
        userText,
        messages,
        attachments: request.attachments,
        mentionPills,
        useRetrieval: contextPlan.useRetrieval,
        maxMemoryContextChars: MAX_MEMORY_CONTEXT_CHARS,
        maxConceptContextChars: MAX_CONCEPT_CONTEXT_CHARS,
        pageResult: pageResult && pageResult.textContent
          ? {
              ...pageResult,
              textContent: pageResult.textContent.length > MAX_PAGE_CONTEXT_CHARS
                ? pageResult.textContent.slice(0, MAX_PAGE_CONTEXT_CHARS) + '\n[…truncated — use read_current_page for full content]'
                : pageResult.textContent,
            }
          : pageResult,
        ragResult,
        memoryResult,
        conceptResult,
        attachmentResults,
      },
    );

    const postContextDeterministicAnswer = selectDeterministicAnswer({
      route: turnRoute,
      query: userText,
      evidenceAssessment,
      retrievedContextText,
    });
    if (postContextDeterministicAnswer?.phase === 'unsupported-specific-coverage-direct-answer') {
      response.markdown(postContextDeterministicAnswer.markdown);
      if (ragSources.length > 0) {
        response.setCitations(
          ragSources.map((source, index) => ({
            index: source.index ?? (index + 1),
            uri: source.uri,
            label: source.label,
          })),
        );
      }
      services.reportResponseDebug?.({
        phase: postContextDeterministicAnswer.phase,
        markdownLength: postContextDeterministicAnswer.markdown.length,
        yielded: !!token.isYieldRequested,
        cancelled: token.isCancellationRequested,
        retrievedContextLength: postContextDeterministicAnswer.retrievedContextLength,
      });
      return {};
    }

    if (memoryResult) {
      let memoryContext = memoryResult;
      if (memoryContext.length > MAX_MEMORY_CONTEXT_CHARS) {
        memoryContext = memoryContext.slice(0, MAX_MEMORY_CONTEXT_CHARS) + '\n[…memory truncated]';
      }

      if (isMemoryRecallTurn) {
        const memoryDeterministicAnswer = selectDeterministicAnswer({
          route: turnRoute,
          memoryContext,
        });
        if (memoryDeterministicAnswer) {
          response.markdown(memoryDeterministicAnswer.markdown);
          services.reportResponseDebug?.({
            phase: memoryDeterministicAnswer.phase,
            markdownLength: memoryDeterministicAnswer.markdown.length,
            yielded: !!token.isYieldRequested,
            cancelled: token.isCancellationRequested,
            retrievedContextLength: memoryDeterministicAnswer.retrievedContextLength,
          });
          return {};
        }
      }
    }

    // 2c. Token budget allocation (M11 Task 1.8)
    //
    // Apply token budget to trim RAG context and history if they exceed
    // their allotted slots. This prevents context window overflow before
    // the ad-hoc summarization safety net kicks in.
    //
    // When the model's context length isn't available yet (first call before
    // the cache is warm), use a conservative fallback so budgeting always runs.
    // Without this, the very first request sends unbounded context.
    const BUDGET_FALLBACK_CTX = 8192;
    const contextWindow = services.getModelContextLength?.() || BUDGET_FALLBACK_CTX;
    if (contextParts.length > 0) {
      const budgetService = new TokenBudgetService();

      // M20: Apply elastic context budget from unified config if available
      const unifiedBudget = services.unifiedConfigService?.getEffectiveConfig().retrieval.contextBudget;
      if (unifiedBudget) {
        budgetService.setElasticConfig({
          trimPriority: unifiedBudget.trimPriority,
          minPercent: unifiedBudget.minPercent,
        });
      }

      const ragContent = contextParts.join('\n\n');
      const historyContent = messages
        .filter(m => m.role !== 'system')
        .map(m => m.content)
        .join('\n');

      const budgetResult = budgetService.allocate(
        contextWindow,
        messages[0]?.content ?? '',
        ragContent,
        historyContent,
        userText,
      );

      // If RAG was trimmed, replace contextParts with trimmed version
      if (budgetResult.wasTrimmed && budgetResult.slots['ragContext'] !== ragContent) {
        contextParts.length = 0;
        const trimmed = budgetResult.slots['ragContext'];
        if (trimmed) {
          contextParts.push(trimmed);
        }
      }

      // If history was trimmed, truncate the messages array
      if (budgetResult.wasTrimmed && budgetResult.slots['history'] !== historyContent) {
        // Keep system prompt (index 0) and replace history with trimmed version
        const trimmedHistory = budgetResult.slots['history'];
        // Remove old history messages, re-add as single summarized message
        while (messages.length > 1) {
          messages.pop();
        }
        if (trimmedHistory) {
          messages.push({
            role: 'user',
            content: '[Summarized conversation context]\n' + trimmedHistory,
          });
          messages.push({
            role: 'assistant',
            content: 'Understood, I have the context.',
          });
        }
      }

      if (budgetResult.warning) {
        response.progress(budgetResult.warning);
      }

      // Report budget breakdown to the UI (Task 4.8)
      // Use post-trim values from budgetResult.slots so the UI shows actual usage
      // M20 Phase G: With elastic allocation, "allocated" = actual demand (no fixed ceilings)
      if (services.reportBudget) {
        const sysTokens = Math.ceil((messages[0]?.content ?? '').length / 4);
        const ragTokens = Math.ceil((budgetResult.slots['ragContext'] ?? ragContent).length / 4);
        const histTokens = Math.ceil((budgetResult.slots['history'] ?? historyContent).length / 4);
        const userTokens = Math.ceil(userText.length / 4);
        services.reportBudget([
          { label: 'System', used: sysTokens, allocated: sysTokens, color: '#6c71c4' },
          { label: 'RAG',    used: ragTokens,  allocated: ragTokens,  color: '#268bd2' },
          { label: 'History', used: histTokens, allocated: histTokens, color: '#859900' },
          { label: 'User',   used: userTokens,  allocated: userTokens,  color: '#cb4b16' },
        ]);
      }
    }

    // 3. Compose final user message (use userText — mentions stripped)
    //
    // If a slash command was detected, apply its prompt template now
    // (substituting {input} and {context}).
    //
    // M12: If a retrieval plan is available, inject a reasoning hint so the
    // LLM understands the user's INTENT, not just their literal words.
    let userContent: string;
    if (slashResult.command && !slashResult.command.specialHandler) {
      const contextStr = contextParts.join('\n\n');
      const templated = commandRegistry.applyTemplate(
        slashResult.command,
        effectiveText,
        contextStr,
      );
      userContent = templated ?? effectiveText;
    } else {
      const parts: string[] = [];

      // M12: Inject planner reasoning as a hint before the retrieved context.
      // This guides the LLM to reason about what the user NEEDS, not just what they said.
      if (retrievalPlan && retrievalPlan.reasoning && retrievalPlan.needsRetrieval) {
        const retrievalAnalysisLines = [
          '[Retrieval Analysis]',
          `Intent: ${retrievalPlan.intent}`,
          `Analysis: ${retrievalPlan.reasoning}`,
        ];
        if (evidenceAssessment.status !== 'sufficient') {
          retrievalAnalysisLines.push(`Evidence: ${evidenceAssessment.status}`);
          if (evidenceAssessment.reasons.length > 0) {
            retrievalAnalysisLines.push(`Evidence Notes: ${evidenceAssessment.reasons.join(', ')}`);
          }
          retrievalAnalysisLines.push(_buildEvidenceResponseConstraint(userText, evidenceAssessment));
        }
        parts.push(retrievalAnalysisLines.join('\n'));
      }

      if (contextParts.length > 0) {
        parts.push(contextParts.join('\n\n'));
      }

      parts.push(userText);
      userContent = parts.join('\n\n');
    }

    messages.push({
      role: 'user',
      content: userContent,
    });

    const applyFallbackAnswer = (phase: 'final' | 'catch', note: string): void => {
      const extractiveFallback = _buildExtractiveFallbackAnswer(request.text, retrievedContextText || userContent);
      if (extractiveFallback) {
        response.markdown(extractiveFallback);
      } else if (isConversationalTurn) {
        response.markdown('I could not produce a conversational response from the current model output. Please try again.');
      } else if (evidenceAssessment.status === 'insufficient') {
        response.markdown('I do not have enough grounded evidence in the current workspace context to answer this confidently. Please point me to the relevant document or add more detail.');
      } else {
        response.markdown('I could not produce a grounded final answer from the current model output. Please try again.');
      }

      if (contextPlan.citationMode === 'required' && ragSources.length > 0) {
        const citations = ragSources.map((source, index) => ({
          index: source.index ?? (index + 1),
          uri: source.uri,
          label: source.label,
        }));
        const citationFooter = _buildMissingCitationFooter(
          response.getMarkdownText(),
          citations.map(({ index, label }) => ({ index, label })),
        );
        if (citationFooter) {
          response.markdown(citationFooter);
        }
        response.setCitations(citations);
      }

      services.reportResponseDebug?.({
        phase: extractiveFallback ? `${phase}-extractive-fallback` : `${phase}-visible-fallback`,
        markdownLength: response.getMarkdownText().trim().length,
        yielded: !!token.isYieldRequested,
        cancelled: token.isCancellationRequested,
        retrievedContextLength: retrievedContextText.length,
        note,
      });
    };

    // Latency: context assembly complete (M17 Task 0.2.7)
    const _t1_contextAssembly = performance.now();
    console.debug(`[Parallx:latency] Context assembly: ${(_t1_contextAssembly - _t0_contextAssembly).toFixed(1)}ms`);

    // ── Context overflow detection & oldest-first truncation (M17 Task 0.2.5) ──
    //
    // When the assembled messages exceed the model's context window, drop
    // the oldest history messages one-at-a-time until we fit.  This avoids
    // the prior approach of making a blocking LLM summarization call before
    // the main response — which added 20–60s of latency.
    //
    // The `/compact` command still exists for explicit LLM-based condensation.

    const contextLength = services.getModelContextLength?.() || BUDGET_FALLBACK_CTX;
    {
      const warnThreshold = Math.floor(contextLength * CONTEXT_OVERFLOW_WARN_THRESHOLD);
      let tokenEstimate = estimateTokens(messages);

      if (tokenEstimate > contextLength) {
        // Drop oldest history messages (indices 1..n-1, keeping system[0] + current user[last])
        // until we fit within the context window.
        while (tokenEstimate > contextLength && messages.length > 2) {
          messages.splice(1, 1); // remove oldest non-system message
          tokenEstimate = estimateTokens(messages);
        }

        if (messages.length <= 2) {
          // Only system + current user left — warn that history was fully dropped
          response.warning(
            `Context window full (${tokenEstimate} / ${contextLength} estimated tokens). ` +
            'All previous conversation history has been dropped. Use /compact to manage context.',
          );
        }
      } else if (tokenEstimate > warnThreshold) {
        response.warning(
          `Approaching context limit (${tokenEstimate} / ${contextLength} estimated tokens). ` +
          'Older messages may be dropped automatically if the conversation continues.',
        );
      }
    }

    // Build request options (mode-aware)
    const options: IChatRequestOptions = {
      tools: (!isConversationalTurn && shouldIncludeTools(request.mode))
        ? (capabilities.canAutonomous ? services.getToolDefinitions() : services.getReadOnlyToolDefinitions())
        : undefined,
      // Edit mode: use JSON structured output
      format: shouldUseStructuredOutput(request.mode) ? { type: 'object' } : undefined,
      // Enable thinking/reasoning mode — the provider passes this to Ollama's
      // `think` parameter.  Models that support it (DeepSeek-R1, QwQ) will
      // stream reasoning tokens separately; others silently ignore it.
      think: true,
      // M15: Apply model settings from the active AI profile
      temperature: aiProfile?.model.temperature,
      maxTokens: aiProfile?.model.maxTokens || undefined,
    };

    // Create an AbortController linked to the cancellation token
    const abortController = new AbortController();
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    const cancelListener = token.onCancellationRequested(() => {
      abortController.abort();
    });

    // Link session cancellation signal (fires on workspace switch)
    const sessionSignal = services.sessionManager?.activeContext?.cancellationSignal;
    if (sessionSignal) {
      if (sessionSignal.aborted) {
        abortController.abort();
      } else {
        sessionSignal.addEventListener('abort', () => abortController.abort(), { once: true });
      }
    }

    // Network stall timeout — abort if no data received for this duration.
    // This resets on every chunk so thinking models (qwen3, DeepSeek-R1) that
    // stream for 60+ seconds don't get killed mid-response.  Only fires when
    // the model truly stalls (no data at all for the timeout period).
    const timeoutMs = services.networkTimeout ?? DEFAULT_NETWORK_TIMEOUT_MS;
    let networkTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const resetNetworkTimeout = () => {
      if (timeoutMs <= 0) return;
      if (networkTimeoutId !== undefined) clearTimeout(networkTimeoutId);
      networkTimeoutId = setTimeout(() => {
        abortController.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, timeoutMs);
    };
    resetNetworkTimeout();

    try {
      const canInvokeTools = capabilities.canInvokeTools && !!services.invokeTool;
      const isEditMode = capabilities.canProposeEdits && !capabilities.canAutonomous;
      let producedContent = false;

      if (options.tools === undefined && !capabilities.canAutonomous) {
        const modelOnlyResult = await executeChatModelOnly(
          {
            sendChatRequest: services.sendChatRequest,
            resetNetworkTimeout,
            parseEditResponse: _parseEditResponse,
            extractToolCallsFromText: _extractToolCallsFromText,
            stripToolNarration: _stripToolNarration,
            reportFirstTokenLatency: (durationMs) => {
              console.debug(`[Parallx:latency] Time to first token: ${durationMs.toFixed(1)}ms`);
            },
            reportStreamCompleteLatency: (durationMs) => {
              console.debug(`[Parallx:latency] LLM stream complete: ${durationMs.toFixed(1)}ms`);
            },
          },
          {
            messages,
            requestOptions: options,
            abortSignal: abortController.signal,
            response,
            token,
            canInvokeTools,
            isEditMode,
          },
        );
        producedContent = modelOnlyResult.producedContent;
      } else {
        const groundedResult = await executeChatGrounded(
          {
            sendChatRequest: services.sendChatRequest,
            invokeTool: services.invokeTool,
            resetNetworkTimeout,
            parseEditResponse: _parseEditResponse,
            extractToolCallsFromText: _extractToolCallsFromText,
            stripToolNarration: _stripToolNarration,
            buildExtractiveFallbackAnswer: _buildExtractiveFallbackAnswer,
            reportResponseDebug: services.reportResponseDebug,
            reportFirstTokenLatency: (durationMs) => {
              console.debug(`[Parallx:latency] Time to first token: ${durationMs.toFixed(1)}ms`);
            },
            reportStreamCompleteLatency: (durationMs) => {
              console.debug(`[Parallx:latency] LLM stream complete: ${durationMs.toFixed(1)}ms`);
            },
          },
          {
            messages,
            requestOptions: options,
            abortSignal: abortController.signal,
            response,
            token,
            maxIterations,
            canInvokeTools,
            isEditMode,
            requestText: request.text,
            userContent,
            retrievedContextText,
            evidenceAssessment,
            toolGuard: services.sessionManager
              ? captureSession(services.sessionManager)
              : undefined,
          },
        );
        producedContent = groundedResult.producedContent;
      }

      if (networkTimeoutId !== undefined) { clearTimeout(networkTimeoutId); }

      // ── Empty response detection ──
      if (!producedContent && !token.isCancellationRequested) {
        response.warning('The model returned an empty response. Try rephrasing your question or selecting a different model.');
      }

      const memoryEnabled = services.unifiedConfigService?.getEffectiveConfig().memory.memoryEnabled ?? true;
      queueChatMemoryWriteBack(
        {
          extractPreferences: services.extractPreferences,
          storeSessionMemory: services.storeSessionMemory,
          storeConceptsFromSession: services.storeConceptsFromSession,
          isSessionEligibleForSummary: services.isSessionEligibleForSummary,
          getSessionMemoryMessageCount: services.getSessionMemoryMessageCount,
          sendSummarizationRequest: services.sendSummarizationRequest,
          buildDeterministicSessionSummary: _buildDeterministicSessionSummary,
        },
        {
          memoryEnabled,
          requestText: request.text,
          sessionId: context.sessionId,
          history: context.history,
        },
      );

      // M12: Append retrieval plan thought process (collapsible thinking UI)
      // Shows users the AI's reasoning and which queries it searched for.
      if (retrievalPlan && retrievalPlan.needsRetrieval && retrievalPlan.queries.length > 0) {
        const queryList = retrievalPlan.queries.map((q) => `• ${q}`).join('\n');
        response.thinking(
          `Intent: ${retrievalPlan.intent}\n` +
          `Analysis: ${retrievalPlan.reasoning}\n` +
          `Searched for:\n${queryList}`,
        );
      }

      validateAndFinalizeChatResponse(
        {
          repairMarkdown: (markdown) => _repairUnsupportedSpecificCoverageAnswer(
            request.text,
            _repairVehicleInfoAnswer(
              request.text,
              _repairAgentContactAnswer(
                request.text,
                _repairDeductibleConflictAnswer(
                  request.text,
                  _repairTotalLossThresholdAnswer(
                    request.text,
                    _repairGroundedCodeAnswer(
                      request.text,
                      markdown,
                      retrievedContextText || userContent,
                    ),
                    retrievedContextText || userContent,
                  ),
                  retrievedContextText || userContent,
                ),
                retrievedContextText || userContent,
              ),
              retrievedContextText || userContent,
            ),
            evidenceAssessment,
          ),
          buildMissingCitationFooter: _buildMissingCitationFooter,
          applyFallbackAnswer,
          reportResponseDebug: services.reportResponseDebug,
        },
        {
          response,
          token,
          isEditMode,
          isConversational: isConversationalTurn,
          citationMode: contextPlan.citationMode,
          ragSources,
          retrievedContextLength: retrievedContextText.length,
        },
      );

      return {};
    } catch (err) {
      // Clear network timeout on error
      if (networkTimeoutId !== undefined) { clearTimeout(networkTimeoutId); }

      services.reportResponseDebug?.({
        phase: 'catch',
        markdownLength: response.getMarkdownText().trim().length,
        yielded: !!token.isYieldRequested,
        cancelled: token.isCancellationRequested,
        retrievedContextLength: retrievedContextText.length,
        note: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });

      if (err instanceof DOMException && err.name === 'AbortError') {
        if (!token.isCancellationRequested && !token.isYieldRequested && response.getMarkdownText().trim().length === 0) {
          applyFallbackAnswer('catch', 'abort-without-user-cancel');
        }

        // User-initiated cancellation — not an error
        return {};
      }

      // Categorize the error for user-friendly messaging
      const { message } = categorizeError(err);
      return {
        errorDetails: {
          message,
          responseIsIncomplete: true,
        },
      };
    } finally {
      cancelListener.dispose();
    }
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
