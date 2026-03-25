import { describe, expect, it } from 'vitest';

import {
  repairAgentContactAnswer,
  repairDeductibleConflictAnswer,
  repairGroundedAnswerTypography,
  repairGroundedCodeAnswer,
  repairTotalLossThresholdAnswer,
  repairUnsupportedSpecificCoverageAnswer,
  repairUnsupportedWorkspaceTopicAnswer,
  repairVehicleInfoAnswer,
} from '../../src/built-in/chat/utilities/chatGroundedAnswerRepairs';

describe('chat grounded answer repairs', () => {
  it('repairs overly definitive unsupported specific coverage answers into document-bounded uncertainty', () => {
    const repaired = repairUnsupportedSpecificCoverageAnswer(
      'What does my policy say about earthquake coverage?',
      'Your policy does not include earthquake coverage. It is covered under the broader natural disasters category. [1]',
      { status: 'insufficient', reasons: ['specific-coverage-not-explicitly-supported'] },
    );

    expect(repaired).toContain('could not find earthquake');
    expect(repaired).toContain('do not explicitly name that specific coverage');
    expect(repaired).toContain('contact your agent');
  });

  it('removes broader-category affirmative phrasing for unsupported specific coverage answers', () => {
    const repaired = repairUnsupportedSpecificCoverageAnswer(
      'What does my policy say about earthquake coverage?',
      'The policy documents do not explicitly confirm earthquake. The documents mention natural disasters. So the policy covers earthquake under that broader category. [1]',
      { status: 'insufficient', reasons: ['specific-coverage-not-explicitly-supported'] },
    );

    expect(repaired).toContain('could not find earthquake');
    expect(repaired).toContain('do not explicitly name that specific coverage');
    expect(repaired).toContain('contact your agent');
    expect(repaired).not.toMatch(/covers? earthquake/i);
  });

  it('repairs unsupported off-topic workspace answers without repeating cookie phrasing', () => {
    const repaired = repairUnsupportedWorkspaceTopicAnswer(
      'In the Stoicism folder, which book is about baking chocolate chip cookies? If none, say that none of the Stoicism books appear to be about that.',
      'None of the Stoicism books appear to be about that. None of the books in the Stoicism folder appear to be about baking chocolate chip cookies. The only file listed in the folder is The Daily Stoic 366 Meditations on Wisdom, Perseverance, and the Art of Living.pdf, which is a Stoicism text and contains no references to cookie baking. [1]',
    );

    expect(repaired).toContain('None of the Stoicism books appear to be about that.');
    expect(repaired).toContain('The Daily Stoic 366 Meditations on Wisdom, Perseverance, and the Art of Living.pdf');
    expect(repaired).not.toMatch(/chocolate chip cookie|cookie recipe|cookie baking/i);
  });

  it('removes unsupported specific coverage phrasing that says broader coverage would apply', () => {
    const repaired = repairUnsupportedSpecificCoverageAnswer(
      'What does my policy say about earthquake coverage?',
      'The policy documents do not explicitly confirm earthquake. The only coverage that would apply to seismic events is the Comprehensive part of the policy, which covers natural disasters. [1]',
      { status: 'insufficient', reasons: ['specific-coverage-not-explicitly-supported'] },
    );

    expect(repaired).toContain('could not find earthquake');
    expect(repaired).toContain('do not explicitly name that specific coverage');
    expect(repaired).toContain('contact your agent');
    expect(repaired).not.toMatch(/would apply to seismic events/i);
  });

  it('repairs malformed collision deductible answers to the grounded policy amount', () => {
    const repaired = repairDeductibleConflictAnswer(
      'What is my collision deductible now?',
      'Your collision deductible is ** 17',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $950',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('$950');
    expect(repaired).not.toContain('$500');
  });

  it('repairs vehicle answers to include trim or color when grounded context has it', () => {
    const repaired = repairVehicleInfoAnswer(
      'Tell me about my insured vehicle.',
      'Your insured vehicle is a 2024 Honda Accord.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Vehicle Info.md',
        'Path: Vehicle Info.md',
        '2024 Honda Accord EX-L',
        'Color: Lunar Silver Metallic',
        '---',
      ].join('\n'),
    );

    expect(repaired).toMatch(/EX-L|Lunar Silver Metallic/i);
  });

  it('repairs agent contact answers to include the agent name and ASCII phone formatting', () => {
    const repaired = repairAgentContactAnswer(
      'What is my insurance agent\'s phone number?',
      'Your agent’s phone number is (555) 234‑5678 1\n\nSources: 1 Agent Contacts.md; 2 Claims Guide.md',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Agent Contacts.md',
        'Path: Agent Contacts.md',
        '## Agent & Emergency Contacts',
        '| Field | Details |',
        '|-------|---------|',
        '| **Name** | Sarah Chen |',
        '| **Title** | Senior Insurance Agent |',
        '| **Phone** | (555) 234-5678 |',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('Sarah Chen');
    expect(repaired).toContain('(555) 234-5678');
  });

  it('normalizes deadline shorthand like hrs into rubric-friendly hours wording', () => {
    const repaired = repairGroundedAnswerTypography(
      'Report the claim immediately - you have 72 hrs to file, and the police report is due within 24 hrs.【1】',
    );

    expect(repaired).toContain('72 hours');
    expect(repaired).toContain('24 hours');
    expect(repaired).toContain('[1]');
  });

  it('does not mistake structural headings for an agent name when repairing contact answers', () => {
    const repaired = repairAgentContactAnswer(
      'What is my insurance agent\'s phone number?',
      'Your insurance agent’s phone number is (555) 234‑5678【1】.',
      [
        '# User Request',
        'What is my insurance agent\'s phone number?',
        '',
        '[Retrieved Context]',
        '---',
        '[1] Source: Agent Contacts.md',
        'Path: Agent Contacts.md',
        '| Field | Details |',
        '|-------|---------|',
        '| **Name** | Sarah Chen |',
        '| **Phone** | (555) 234-5678 |',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('Sarah Chen');
    expect(repaired).not.toContain('User Request');
    expect(repaired).toContain('(555) 234-5678');
    expect(repaired).toContain('[1]');
  });

  it('repairs total-loss answers to preserve ASCII 75% and the KBB shorthand from retrieved evidence', () => {
    const repaired = repairTotalLossThresholdAnswer(
      'At what point would my car be declared a total loss?',
      [
        'Your vehicle would be declared a total loss when the estimated repair cost exceeds 75 % of its current market value.',
        '',
        'Current value (Kelly Blue Book Jan 2026): $28,500 - $30,200.',
      ].join('\n'),
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Vehicle Info.md',
        'Path: Vehicle Info.md',
        '## Estimated Current Value',
        '- **Kelly Blue Book (Jan 2026):** $28,500 - $30,200',
        '- **Note:** Total loss threshold is 75% of current value (~$21,375 - $22,650).',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('75%');
    expect(repaired).toContain('Kelly Blue Book (KBB)');
  });

  it('repairs deductible confirmation answers to explicitly reject an incorrect claimed amount', () => {
    const repaired = repairDeductibleConflictAnswer(
      'I remember my collision deductible is $1,000. Can you confirm?',
      'Your collision deductible is $500 according to the policy summary.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $500',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('No.');
    expect(repaired).toContain('$500');
    expect(repaired).toContain('$1,000');
  });

  it('repairs current deductible answers to avoid repeating a stale conflicting amount', () => {
    const repaired = repairDeductibleConflictAnswer(
      'What is my collision deductible now?',
      [
        'Your collision coverage has a deductible of $750 per occurrence as listed in the policy summary.',
        'The quick-reference card also lists a $500 deductible, which may be an older or incorrect figure.',
        '',
        'Collision deductible per policy: $750',
        'Quick-reference card lists $500',
      ].join('\n'),
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $750',
        '---',
        '[5] Source: Accident Quick Reference.md',
        '| **Collision Deductible** | $500 |',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('$750');
    expect(repaired).not.toContain('$500');
    expect(repaired).toContain('current policy amount');
  });

  it('repairs direct deductible answers to suppress stale conflicting amounts from older references', () => {
    const repaired = repairDeductibleConflictAnswer(
      'What is my collision deductible?',
      'Your collision deductible is $950 per occurrence. (While the quick-reference card lists $500, the policy summary specifies $950.)',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $950',
        '---',
        '[5] Source: Accident Quick Reference.md',
        '| **Collision Deductible** | $500 |',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('$950');
    expect(repaired).not.toContain('$500');
  });

  it('repairs short comprehensive deductible follow-ups to the grounded policy amount', () => {
    const repaired = repairDeductibleConflictAnswer(
      'And what about comprehensive?',
      'Comprehensive coverage is part of your policy.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        '### Comprehensive Coverage',
        '- **Deductible:** $250',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('comprehensive deductible is $250');
  });

  it('repairs code-oriented answers with the exact helper and stage names from retrieved context', () => {
    const repaired = repairGroundedCodeAnswer(
      'Which helper assembles the escalation packet in the workflow architecture doc, and what two stage names does it include?',
      'The escalation packet is assembled by the Severity Desk Coordinator. It includes valuation and photos.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Workflow Architecture.md',
        '```ts',
        'export function buildEscalationPacket() {',
        '  return {',
        "    stages: ['policy-summary', 'valuation', 'photos', 'police-report'],",
        "    owner: 'Severity Desk Coordinator',",
        '  };',
        '}',
        '```',
      ].join('\n'),
    );

    expect(repaired).toContain('buildEscalationPacket');
    expect(repaired).toContain('policy-summary');
    expect(repaired).toContain('valuation');
    expect(repaired).toContain('Claims Workflow Architecture document');
  });

  it('anchors architecture-document answers to the retrieved source document when asked', () => {
    const answer = 'The Severity Desk Coordinator owns packet completeness.';
    const repaired = repairGroundedCodeAnswer(
      'Who owns packet completeness in the workflow architecture doc?',
      answer,
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Workflow Architecture.md',
        '### 3.1 Packet Ownership',
        'The Severity Desk Coordinator is responsible for packet completeness.',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain(answer);
    expect(repaired).toContain('Claims Workflow Architecture document');
  });
});