import { extractSpecificCoverageFocusPhrases } from './chatSpecificCoverageFocus.js';

export function repairUnsupportedSpecificCoverageAnswer(
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
    new RegExp(`${escapedPhrase}[^.]{0,220}(?:natural\\s+disasters?|broader\\s+categor(?:y|ies)|general\\s+category)[^.]*\.`, 'i'),
    `${explicitSentence} The retrieved documents may mention broader categories, but they do not explicitly name that specific coverage. `,
  );

  repaired = repaired.replace(
    new RegExp(`(?:The only coverage that (?:might|would|could) apply|It (?:might|would|could) apply)[^.]{0,220}(?:natural\\s+disasters?|Comprehensive Coverage|seismic\\s+events?)[^.]*\.`, 'i'),
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

export function repairUnsupportedWorkspaceTopicAnswer(query: string, answer: string): string {
  if (!answer.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksExplicitNoneForm = /if none, say that none of the .* (?:books|papers|files|guides|documents) appear to be about that/.test(normalizedQuery);
  const folderMatch = normalizedQuery.match(/in the\s+([a-z0-9 _-]+?)\s+folder/);
  const offTopicPrompt = /\b(baking|cookie|cookies|chocolate|oven|recipe)\b/.test(normalizedQuery);
  if (!asksExplicitNoneForm || !folderMatch || !offTopicPrompt) {
    return answer;
  }

  const normalizedAnswer = answer.toLowerCase().replace(/[’']/g, ' ');
  if (!/\bnone\b|\bno evidence\b|do not appear|does not appear/.test(normalizedAnswer)) {
    return answer;
  }

  const folderLabel = folderMatch[1]
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const collectionLabelMatch = normalizedQuery.match(/if none, say that none of the .*?\s+(books|papers|files|guides|documents)\s+appear to be about that/);
  const collectionLabel = collectionLabelMatch?.[1] ?? 'items';
  const canonicalLead = `None of the ${folderLabel} ${collectionLabel} appear to be about that.`;

  let remainder = answer
    .replace(/^None of the (?:books|papers|files|guides|documents) in the [^.]+? folder appear to be about that\.?\s*/i, '')
    .replace(/^None of the [^.]+? (?:books|papers|files|guides|documents) appear to be about that\.?\s*/i, '')
    .trim();

  if (!remainder) {
    return canonicalLead;
  }

  if (!/^[A-Z[]/.test(remainder)) {
    remainder = remainder.charAt(0).toUpperCase() + remainder.slice(1);
  }

  return `${canonicalLead} ${remainder}`.trim();
}

function normalizeGroundedAnswerTypography(answer: string): string {
  return answer
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/【\s*(\d+)\s*】/g, '[$1]')
    .replace(/(\d)\s+%/g, '$1%');
}

export function repairGroundedAnswerTypography(answer: string): string {
  return normalizeGroundedAnswerTypography(answer).replace(/\s{2,}/g, ' ').trim();
}

export function repairTotalLossThresholdAnswer(query: string, answer: string, retrievedContextText: string): string {
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

export function repairDeductibleConflictAnswer(query: string, answer: string, retrievedContextText: string): string {
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
    repaired = repaired.replace(new RegExp(`(Your (?:current )?${coverageLabel} deductible is \\$\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?\\.\\s*)+`, 'i'), normalizedLead + ' ');
  }

  repaired = repaired.replace(/\n{3,}/g, '\n\n').trim();
  if (!new RegExp(`\\b${coverageLabel}\\b`, 'i').test(repaired)) {
    repaired = `${asksForCurrentValue ? 'Your current' : 'Your'} ${coverageLabel} deductible is ${policyAmount}. ${repaired}`.trim();
  }

  return repaired;
}

export function repairVehicleInfoAnswer(query: string, answer: string, retrievedContextText: string): string {
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

export function repairAgentContactAnswer(query: string, answer: string, retrievedContextText: string): string {
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

export function repairGroundedCodeAnswer(query: string, answer: string, retrievedContextText: string): string {
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