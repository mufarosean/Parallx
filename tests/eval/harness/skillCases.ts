/**
 * Skill chain eval cases — each case targets a skill, drives the model with
 * a vague prompt that should make it activate that skill, and asserts the
 * model called the chain of tools the skill prescribes.
 *
 * Built from the skills inventory (tests/eval/tool-skill-manifest.json):
 *   - document-comparison
 *   - exhaustive-summary
 *   - folder-overview
 *   - scoped-extraction
 *   - research-topic   (web-research)
 *
 * Each expectedChain is a *minimal* set of tool calls — anything beyond is
 * extra credit, anything less is partial.
 */
import type { ChainEvalCase } from '../harness/scorer.js';

export const SKILL_CHAIN_CASES: ChainEvalCase[] = [
  {
    id: 'skill-folder-overview',
    prompt: 'Give me a quick overview of what is in this workspace.',
    expectedChain: ['fs_list_files', 'fs_read_file'],
    unordered: false,
  },
  {
    id: 'skill-exhaustive-summary',
    prompt: 'Summarise the README in detail — exhaustively, no missing sections.',
    expectedChain: ['fs_read_file'],
    unordered: false,
  },
  {
    id: 'skill-document-comparison',
    prompt: 'Compare README.md and docs/guide.md side by side.',
    expectedChain: ['fs_read_file', 'fs_read_file'],
    unordered: false,
  },
  {
    id: 'skill-scoped-extraction',
    prompt: 'Pull out every TODO comment from the src folder.',
    expectedChain: ['fs_grep_search'],
    unordered: true,
  },
  {
    id: 'skill-research-topic',
    prompt: 'Research the current state of small-LM tool calling and give me a writeup.',
    expectedChain: ['webSearch', 'webFetch'],
    unordered: false,
  },
];
