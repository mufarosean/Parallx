import { describe, expect, it } from 'vitest';

import {
  assessEvidenceSufficiency,
  buildDeterministicSessionSummary,
  buildExtractiveFallbackAnswer,
  buildRetrieveAgainQuery,
} from '../../src/built-in/chat/utilities/chatGroundedResponseHelpers';

describe('chat grounded response helpers', () => {
  it('falls back to extractive retrieved-context lines when the retry is also empty', () => {
    const fallback = buildExtractiveFallbackAnswer(
      'How do I file a claim and who do I call?',
      '[Retrieved Context]\n---\n[1] Source: Claims Guide.md\nPath: Claims Guide.md\n### Step 1: Report the Claim\n- Your agent: Sarah Chen — (555) 234-5678\n- 24/7 Claims Line: 1-800-555-CLAIM (2524)\n- File within 72 hours of the incident\n---',
    );

    expect(fallback).toContain('Sarah Chen');
    expect(fallback).toContain('1-800-555-CLAIM');
    expect(fallback).toContain('72 hours');
  });

  it('classifies missing grounded evidence as insufficient', () => {
    const assessment = assessEvidenceSufficiency('What is my collision deductible?', '', []);
    expect(assessment.status).toBe('insufficient');
    expect(assessment.reasons).toContain('no-grounded-sources');
  });

  it('classifies a focused single-source fact answer as sufficient', () => {
    const assessment = assessEvidenceSufficiency(
      'What is my collision deductible?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $500',
        '---',
      ].join('\n'),
      [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
    );

    expect(assessment.status).toBe('sufficient');
    expect(assessment.reasons).toEqual([]);
  });

  it('classifies partial hard-query evidence as weak', () => {
    const assessment = assessEvidenceSufficiency(
      'I was rear-ended by an uninsured driver. What should I do and what does my policy cover?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Accident Quick Reference.md',
        'Path: Accident Quick Reference.md',
        '## Uninsured Driver Filing Deadlines',
        '- After an uninsured driver accident, report the claim to your insurer.',
        '- Report to insurer: Within 72 hours',
        '---',
      ].join('\n'),
      [{ uri: 'Accident Quick Reference.md', label: 'Accident Quick Reference.md', index: 1 }],
    );

    expect(assessment.status).toBe('weak');
    expect(assessment.reasons).toEqual(expect.arrayContaining([
      'hard-query-low-source-coverage',
      'hard-query-low-section-coverage',
    ]));
  });

  it('classifies specific coverage claims as insufficient when the evidence only supports a broader category', () => {
    const assessment = assessEvidenceSufficiency(
      'What does my policy say about earthquake coverage?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Comprehensive Coverage',
        'Covers damage to your vehicle from non-collision events: theft, vandalism, natural disasters, falling objects, animal strikes.',
        '---',
      ].join('\n'),
      [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
    );

    expect(assessment.status).toBe('insufficient');
    expect(assessment.reasons).toContain('specific-coverage-not-explicitly-supported');
  });

  it('builds a deterministic session summary from recent user-provided facts', () => {
    const summary = buildDeterministicSessionSummary(
      [{ request: { text: 'I was in a car accident yesterday at the Riverside Mall parking lot on Elm Street.' } }],
      'The other driver ran a red light, hit my passenger door, and the police report number is 2026-0305-1147.',
    );

    expect(summary).toContain('Riverside Mall parking lot');
    expect(summary).toContain('Elm Street');
    expect(summary).toContain('red light');
    expect(summary).toContain('passenger door');
    expect(summary).toContain('2026-0305-1147');
  });

  it('builds a keyword-focused retrieve-again query from unresolved terms', () => {
    const query = buildRetrieveAgainQuery(
      'At what point would my car be declared a total loss?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Accident Quick Reference.md',
        'Path: Accident Quick Reference.md',
        '## Filing Deadlines',
        '- Report to insurer: Within 72 hours',
        '---',
      ].join('\n'),
    );

    expect(query).toContain('declared');
    expect(query).toContain('total');
    expect(query).toContain('loss');
  });

  it('keeps extractive fallback anchored to the matching repair-shop section', () => {
    const fallback = buildExtractiveFallbackAnswer(
      'Which repair shops are recommended under my policy? Please cite your sources.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Agent Contacts.md',
        'Path: Agent Contacts.md',
        '## Preferred Repair Shops',
        '1. **AutoCraft Collision Center**',
        '2. **Precision Auto Body**',
        '3. **Riverside Honda Service Center**',
        '---',
        '[2] Source: Vehicle Info.md',
        'Path: Vehicle Info.md',
        '## Estimated Current Value',
        '- **Note:** Total loss threshold is 75% of current value',
        '---',
      ].join('\n'),
    );

    expect(fallback).toContain('AutoCraft Collision Center');
    expect(fallback).toContain('Precision Auto Body');
    expect(fallback).not.toContain('Total loss threshold');
  });

  it('combines the strongest retrieved sections when a query needs contact and deadline details', () => {
    const fallback = buildExtractiveFallbackAnswer(
      'OK I want to file a claim. How do I do that and who do I call?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '### Step 1: Report the Claim',
        '**Who to contact:**',
        '- **Your agent:** Sarah Chen — (555) 234-5678 (Mon-Fri 8am-6pm)',
        '- **24/7 Claims Line:** 1-800-555-CLAIM (2524)',
        '- Policy number: PLX-2026-4481',
        '- Police report number',
        '---',
        '[2] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '## How to File a Claim',
        '1. Call your agent or the 24/7 claims line: **1-800-555-CLAIM (2524)**',
        '2. File within **72 hours** of the incident',
        '---',
        '[3] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '## Uninsured Motorist (UM) Claim Procedure',
        '1. **File a police report within 24 hours** (mandatory for UM claims)',
        '---',
      ].join('\n'),
    );

    expect(fallback).toContain('Sarah Chen');
    expect(fallback).toContain('1-800-555-CLAIM');
    expect(fallback).toContain('72 hours');
    expect(fallback).not.toContain('mandatory for UM claims');
  });

  it('combines primary and backup coverage sections when the query asks what coverage applies', () => {
    const fallback = buildExtractiveFallbackAnswer(
      'They said they have insurance but I am not sure. What coverage do I have for this?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '## Uninsured Motorist (UM) Claim Procedure',
        '3. Your UM coverage applies: up to $100,000/$300,000 bodily injury, $25,000 property damage',
        '---',
        '[2] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Coverage Limit:** $50,000 per occurrence',
        '- **Deductible:** $500',
        '---',
      ].join('\n'),
    );

    expect(fallback).toContain('Collision Coverage');
    expect(fallback).toContain('$500');
    expect(fallback).toContain('UM coverage applies');
  });
});