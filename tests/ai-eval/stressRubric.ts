/**
 * M39 Stress Workspace — AI Evaluation Rubric
 *
 * Defines evaluation test cases for built-in workflow skills against the
 * stress-test workspace (20 messy files, contradictions, stubs, noise).
 *
 * These validate that skill-activated workflows produce high-quality
 * grounded answers with exhaustive coverage.
 */
import type { Assertion, Dimension } from './scoring';
import {
  containsAny,
  containsAll,
  containsNone,
  lengthBetween,
  matchesPattern,
} from './scoring';
import {
  ALL_FILE_PATHS,
  FOLDER_FILE_COUNTS,
  CONTRADICTIONS,
  DUPLICATE_FILENAMES,
  NOISE_FILE_PATHS,
  STUB_FILE_PATHS,
} from './stressGroundTruth';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the filename (without extension) from a path. */
function baseName(filePath: string): string {
  return filePath.split('/').pop()!.replace(/\.md$/, '');
}

/** Build an assertion that checks for filename mentions against a file list. */
function filenameCoverageAssertion(
  filePaths: readonly string[],
  label: string,
  weight: number,
): Assertion {
  // Check that every filename (without extension) is mentioned somewhere in response
  const fileNames = filePaths.map(baseName);
  return {
    name: label,
    weight,
    check: (r: string) => {
      const lower = r.toLowerCase().replace(/[‐‑‒–—]/g, '-');
      let hits = 0;
      for (const name of fileNames) {
        if (lower.includes(name.toLowerCase())) { hits++; }
      }
      // Pass if ≥80% of files mentioned (allows minor LLM paraphrasing)
      return hits / fileNames.length >= 0.8;
    },
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface StressTestCaseTurn {
  prompt: string;
  assertions: Assertion[];
}

export interface StressTestCase {
  id: string;
  name: string;
  dimension: Dimension;
  description: string;
  turns: StressTestCaseTurn[];
}

// ── Rubric ──────────────────────────────────────────────────────────────────

export const STRESS_RUBRIC: StressTestCase[] = [

  // ── E.6: Exhaustive summary of full workspace ─────────────────────────────
  {
    id: 'S-T01',
    name: 'Exhaustive summary — full workspace (20 files)',
    dimension: 'summary',
    description: 'Summarize each file in the workspace. Every file must be mentioned.',
    turns: [{
      prompt: 'Summarize each file in this workspace.',
      assertions: [
        filenameCoverageAssertion(ALL_FILE_PATHS, 'Mentions ≥80% of workspace files', 3),
        {
          name: 'Response has substantial length (multi-file summary)',
          weight: 2,
          check: lengthBetween(500, 20000),
        },
        {
          name: 'No hallucinated file names',
          weight: 2,
          check: containsNone(['billing.md', 'payments.md', 'invoice.md', 'account.md']),
        },
      ],
    }],
  },

  // ── E.7: Exhaustive summary — policies/ subfolder ─────────────────────────
  {
    id: 'S-T02',
    name: 'Exhaustive summary — policies/ subfolder (5 files)',
    dimension: 'summary',
    description: 'Summarize each file in policies/, including umbrella/ subfolder.',
    turns: [{
      prompt: 'Summarize each file in the policies folder.',
      assertions: [
        {
          name: 'Mentions all 5 policy files',
          weight: 3,
          check: containsAll([
            'auto-policy-2024',
            'auto-policy-2023',
            'homeowners',
            'overview',
            'umbrella-coverage',
          ]),
        },
        {
          name: 'Covers umbrella subfolder content',
          weight: 2,
          check: containsAny(['umbrella', 'liability']),
        },
        {
          name: 'Does not include non-policy files',
          weight: 1,
          check: containsNone(['meeting-2024', 'random-thoughts']),
        },
      ],
    }],
  },

  // ── E.8: Folder overview — notes/ ─────────────────────────────────────────
  {
    id: 'S-T03',
    name: 'Folder overview — notes/ folder (4 files)',
    dimension: 'summary',
    description: 'Overview of notes/ folder: correct count, all files, noise flagged.',
    turns: [{
      prompt: 'Give me an overview of the notes folder.',
      assertions: [
        {
          name: 'Mentions all 4 notes files',
          weight: 3,
          check: containsAll([
            'how-to-file',
            'meeting-2024',
            'random-thoughts',
            'policy-comparison',
          ]),
        },
        {
          name: 'Notes random-thoughts is irrelevant or personal',
          weight: 2,
          check: containsAny(['irrelevant', 'personal', 'unrelated', 'not insurance', 'non-insurance', 'weekend', 'recipe']),
        },
        {
          name: 'Reports approximately 4 files',
          weight: 1,
          check: containsAny(['4 files', 'four files', '4 documents', 'four documents']),
        },
      ],
    }],
  },

  // ── E.9: Document comparison — contradictory policy files ─────────────────
  {
    id: 'S-T04',
    name: 'Document comparison — 2024 vs 2023 deductible contradiction',
    dimension: 'multi-doc-synthesis',
    description: 'Compare auto policies and identify deductible difference ($500 vs $750).',
    turns: [{
      prompt: 'Compare auto-policy-2024.md and auto-policy-2023.md.',
      assertions: [
        {
          name: 'Identifies $500 deductible (2024)',
          weight: 3,
          check: containsAny(['$500', '500']),
        },
        {
          name: 'Identifies $750 deductible (2023)',
          weight: 3,
          check: containsAny(['$750', '750']),
        },
        {
          name: 'Mentions deductible difference',
          weight: 2,
          check: containsAny(['deductible', 'collision', 'difference', 'changed', 'differs']),
        },
        {
          name: 'Does not hallucinate deductible values',
          weight: 1,
          check: containsNone(['$1000 deductible', '$1500 deductible']),
        },
      ],
    }],
  },

  // ── E.10: Document comparison — same-name files in different folders ──────
  {
    id: 'S-T05',
    name: 'Document comparison — two how-to-file.md files',
    dimension: 'multi-doc-synthesis',
    description: 'Compare same-name files from claims/ vs notes/, surface step count difference.',
    turns: [{
      prompt: 'Compare the two how-to-file documents.',
      assertions: [
        {
          name: 'Identifies two files with same name',
          weight: 2,
          check: containsAny([
            'claims/how-to-file', 'notes/how-to-file',
            'claims folder', 'notes folder',
            'two versions', 'two files',
          ]),
        },
        {
          name: 'Mentions 5-step official guide',
          weight: 3,
          check: containsAny(['5 steps', 'five steps', '5-step', 'five-step']),
        },
        {
          name: 'Mentions 3-step informal notes',
          weight: 3,
          check: containsAny(['3 steps', 'three steps', '3-step', 'three-step']),
        },
        {
          name: 'Highlights difference (official vs informal)',
          weight: 2,
          check: containsAny(['official', 'informal', 'personal', 'different order', 'discrepancy', 'contradicts']),
        },
      ],
    }],
  },

  // ── E.11: Scoped extraction — deductible amounts across policies ──────────
  {
    id: 'S-T06',
    name: 'Scoped extraction — deductible amounts across policies',
    dimension: 'detail-retrieval',
    description: 'Extract all deductible values from policy documents.',
    turns: [{
      prompt: 'Extract all deductible amounts from every policy document.',
      assertions: [
        {
          name: 'Finds $500 (2024 collision deductible)',
          weight: 3,
          check: containsAny(['$500', '500']),
        },
        {
          name: 'Finds $250 (comprehensive deductible)',
          weight: 2,
          check: containsAny(['$250', '250']),
        },
        {
          name: 'Finds $750 (2023 collision deductible)',
          weight: 3,
          check: containsAny(['$750', '750']),
        },
        {
          name: 'Associates values with correct source files',
          weight: 2,
          check: containsAny(['2024', '2023', 'auto-policy']),
        },
      ],
    }],
  },

  // ── E.12: Near-empty file handling ────────────────────────────────────────
  {
    id: 'S-T07',
    name: 'Near-empty file — umbrella/overview.md (2 sentences)',
    dimension: 'hallucination-guard',
    description: 'Summarize stub file without hallucinating content.',
    turns: [{
      prompt: 'Summarize umbrella/overview.md.',
      assertions: [
        {
          name: 'Acknowledges limited content',
          weight: 3,
          check: containsAny([
            'brief', 'short', 'minimal', 'limited', 'few sentences',
            'stub', 'overview', 'placeholder', 'not much content',
            'two sentences', '2 sentences', 'only',
          ]),
        },
        {
          name: 'Does not hallucinate detailed coverage limits',
          weight: 3,
          check: containsNone([
            '$5,000,000',
            'excess liability of $2 million',
            'annual premium of $1,200',
          ]),
        },
        {
          name: 'Response is appropriately short (not padded)',
          weight: 1,
          check: lengthBetween(20, 1500),
        },
      ],
    }],
  },

  // ── E.13: Irrelevant file handling ────────────────────────────────────────
  {
    id: 'S-T08',
    name: 'Irrelevant file acknowledged — random-thoughts.md in notes/',
    dimension: 'summary',
    description: 'Summarize notes/ folder; include random-thoughts without treating it as insurance content.',
    turns: [{
      prompt: 'Summarize the notes folder.',
      assertions: [
        {
          name: 'Mentions random-thoughts.md',
          weight: 3,
          check: containsAny(['random-thoughts', 'random thoughts']),
        },
        {
          name: 'Notes it is not insurance-related',
          weight: 2,
          check: containsAny([
            'not insurance', 'non-insurance', 'irrelevant', 'personal',
            'unrelated', 'weekend', 'recipe', 'not related',
          ]),
        },
        {
          name: 'Still covers the other 3 notes files',
          weight: 2,
          check: containsAll(['how-to-file', 'meeting', 'policy-comparison']),
        },
      ],
    }],
  },

  // ── F.6: Ambiguous phrasing stress test ───────────────────────────────────
  {
    id: 'S-T09',
    name: 'Ambiguous phrasing triggers skill activation',
    dimension: 'summary',
    description: 'Vague prompts should still activate a workflow skill and produce substantive output.',
    turns: [
      {
        prompt: 'Tell me about everything in here.',
        assertions: [
          {
            name: 'Produces a substantive multi-file response',
            weight: 3,
            check: lengthBetween(300, 20000),
          },
          {
            name: 'Mentions multiple files from the workspace',
            weight: 2,
            check: (r: string) => {
              const lower = r.toLowerCase();
              const fileNames = ALL_FILE_PATHS.map(baseName);
              let hits = 0;
              for (const name of fileNames) {
                if (lower.includes(name.toLowerCase())) { hits++; }
              }
              return hits >= 3;
            },
          },
        ],
      },
      {
        prompt: "What's in my files?",
        assertions: [
          {
            name: 'Produces a substantive response listing file content',
            weight: 3,
            check: lengthBetween(200, 20000),
          },
        ],
      },
      {
        prompt: 'Go through all my stuff.',
        assertions: [
          {
            name: 'Produces a substantive overview',
            weight: 3,
            check: lengthBetween(200, 20000),
          },
        ],
      },
    ],
  },

  // ── F.7: Multi-turn skill re-activation ───────────────────────────────────
  {
    id: 'S-T10',
    name: 'Multi-turn — skill re-activation across folders',
    dimension: 'summary',
    description: 'Sequential folder summaries should each activate the skill.',
    turns: [
      {
        prompt: 'Summarize each file in policies/.',
        assertions: [
          {
            name: 'Covers policy files',
            weight: 3,
            check: containsAll(['auto-policy-2024', 'auto-policy-2023']),
          },
        ],
      },
      {
        prompt: 'Now do the same for claims/.',
        assertions: [
          {
            name: 'Covers claim files',
            weight: 3,
            check: containsAll(['how-to-file', 'settlement']),
          },
          {
            name: 'Covers archived claims',
            weight: 2,
            check: containsAny(['johnson', 'martinez', 'archived']),
          },
        ],
      },
    ],
  },
];
