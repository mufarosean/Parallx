/**
 * M38 Planned Evidence Engine — AI Evaluation Rubric
 *
 * Defines evaluation test cases for each M38 workflow type against the
 * demo-workspace auto insurance knowledge base.
 *
 * These validate that the planned evidence pipeline produces high-quality
 * grounded answers for each workflow classification.
 */
import type { Assertion, Dimension } from './scoring';
import {
  containsAny,
  containsAll,
  containsNone,
  lengthBetween,
  hasCitationMarkers,
} from './scoring';

export interface M38TestCaseTurn {
  prompt: string;
  expectedWorkflow: string;
  assertions: Assertion[];
}

export interface M38TestCase {
  id: string;
  name: string;
  dimension: Dimension;
  workflowType: string;
  description: string;
  turns: M38TestCaseTurn[];
}

// ── M38 Rubric ──────────────────────────────────────────────────────────────

export const M38_RUBRIC: M38TestCase[] = [

  // ── M38-T01: Scoped Topic — Filing deadlines from Claims Guide ────────────
  {
    id: 'M38-T01',
    name: 'Scoped topic — filing deadlines from Claims Guide',
    dimension: 'factual-recall',
    workflowType: 'scoped-topic',
    description: 'Scoped retrieval narrows to Claims Guide and returns filing deadline facts.',
    turns: [{
      prompt: 'What does Claims Guide.md say about filing deadlines?',
      expectedWorkflow: 'scoped-topic',
      assertions: [
        {
          name: 'Mentions 72 hours or deadline',
          weight: 3,
          check: containsAny(['72 hours', '72-hour', 'three days', 'deadline']),
        },
        {
          name: 'Cites Claims Guide',
          weight: 2,
          check: containsAny(['Claims Guide', '[1]', '[2]']),
        },
        {
          name: 'No hallucinated filing info',
          weight: 2,
          check: containsNone(['30 days filing', '90 days to file']),
        },
      ],
    }],
  },

  // ── M38-T02: Document Summary — Claims Guide ─────────────────────────────
  {
    id: 'M38-T02',
    name: 'Document summary — Claims Guide overview',
    dimension: 'synthesis',
    workflowType: 'document-summary',
    description: 'Summarize a single document, capturing key sections.',
    turns: [{
      prompt: 'Summarize Claims Guide.md',
      expectedWorkflow: 'document-summary',
      assertions: [
        {
          name: 'Covers filing deadlines',
          weight: 2,
          check: containsAny(['deadline', 'filing', '72 hours']),
        },
        {
          name: 'Covers required documents',
          weight: 2,
          check: containsAny(['document', 'report', 'evidence', 'photo']),
        },
        {
          name: 'Reasonable length',
          weight: 1,
          check: lengthBetween(100, 2000),
        },
      ],
    }],
  },

  // ── M38-T03: Comparative — Two documents ──────────────────────────────────
  {
    id: 'M38-T03',
    name: 'Comparative analysis — Claims Guide vs Accident Quick Reference',
    dimension: 'synthesis',
    workflowType: 'comparative',
    description: 'Compare two documents, highlighting differences and overlaps.',
    turns: [{
      prompt: 'Compare Claims Guide.md and Accident Quick Reference.md',
      expectedWorkflow: 'comparative',
      assertions: [
        {
          name: 'References both documents',
          weight: 3,
          check: containsAll(['Claims Guide', 'Accident']),
        },
        {
          name: 'Identifies differences or similarities',
          weight: 2,
          check: containsAny(['differ', 'similar', 'both', 'overlap', 'while', 'whereas', 'compare']),
        },
        {
          name: 'No hallucinated content',
          weight: 2,
          check: containsNone(['earthquake', 'flood insurance', 'life insurance']),
        },
      ],
    }],
  },

  // ── M38-T04: Folder Summary — Root workspace ─────────────────────────────
  {
    id: 'M38-T04',
    name: 'Folder summary — workspace overview',
    dimension: 'synthesis',
    workflowType: 'folder-summary',
    description: 'Summarize all files in the workspace root.',
    turns: [{
      prompt: 'Summarize all the files in my workspace',
      expectedWorkflow: 'folder-summary',
      assertions: [
        {
          name: 'Mentions multiple files',
          weight: 2,
          check: containsAny(['Claims Guide', 'Vehicle Info', 'Auto Insurance', 'Agent Contacts']),
        },
        {
          name: 'Covers at least 3 files',
          weight: 2,
          check: (text: string) => {
            const fileNames = ['Claims Guide', 'Vehicle Info', 'Auto Insurance', 'Agent Contacts', 'Accident Quick Reference'];
            return fileNames.filter(f => text.includes(f)).length >= 3;
          },
        },
        {
          name: 'Has citation markers',
          weight: 1,
          check: hasCitationMarkers(),
        },
      ],
    }],
  },

  // ── M38-T05: Exhaustive Extraction — All coverage limits ─────────────────
  {
    id: 'M38-T05',
    name: 'Exhaustive extraction — coverage limits from policy',
    dimension: 'coverage-extraction',
    workflowType: 'exhaustive-extraction',
    description: 'Extract every coverage limit and deductible from the policy.',
    turns: [{
      prompt: 'List every coverage limit and deductible in Auto Insurance Policy.md',
      expectedWorkflow: 'exhaustive-extraction',
      assertions: [
        {
          name: 'Contains collision deductible',
          weight: 2,
          check: containsAny(['$500', 'collision deductible']),
        },
        {
          name: 'Contains comprehensive deductible',
          weight: 2,
          check: containsAny(['$250', 'comprehensive']),
        },
        {
          name: 'Uses list or table format',
          weight: 1,
          check: containsAny(['-', '|', '•', '*', '1.']),
        },
      ],
    }],
  },

  // ── M38-T06: Scope Resolution — Named entity ────────────────────────────
  {
    id: 'M38-T06',
    name: 'Scope resolution — Vehicle Info query',
    dimension: 'factual-recall',
    workflowType: 'scoped-topic',
    description: 'Scope resolver narrows to Vehicle Info.md for vehicle-specific question.',
    turns: [{
      prompt: 'What is the VIN in Vehicle Info.md?',
      expectedWorkflow: 'scoped-topic',
      assertions: [
        {
          name: 'Contains VIN number',
          weight: 3,
          check: containsAny(['1HGCV2F34RA012345', 'HGCV2F34RA']),
        },
        {
          name: 'Mentions Honda Accord',
          weight: 1,
          check: containsAny(['Honda', 'Accord']),
        },
      ],
    }],
  },

  // ── M38-T07: Generic Grounded — Ordinary Q&A unchanged ──────────────────
  {
    id: 'M38-T07',
    name: 'Generic grounded — ordinary workspace Q&A',
    dimension: 'factual-recall',
    workflowType: 'generic-grounded',
    description: 'Standard grounded question should work identically to pre-M38.',
    turns: [{
      prompt: 'How do I file a claim?',
      expectedWorkflow: 'generic-grounded',
      assertions: [
        {
          name: 'Contains filing steps',
          weight: 2,
          check: containsAny(['contact', 'call', 'report', 'file', 'steps']),
        },
        {
          name: 'Has citation markers',
          weight: 1,
          check: hasCitationMarkers(),
        },
        {
          name: 'Reasonable length',
          weight: 1,
          check: lengthBetween(50, 2000),
        },
      ],
    }],
  },
];
