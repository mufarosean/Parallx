#!/usr/bin/env node
// scripts/check-slice-closure.mjs
//
// Refuses to print "OK to commit" unless every gate required by
// PARALLX_MANIFEST.md §14, §20, §22 and /memories/repo/orchestrator-discipline.md
// is satisfied.
//
// Checks (in order):
//   1. Staged diff exists.
//   2. If any staged file is a preservation surface, a slice-closure receipt
//      exists (.slice-closure-ok) AND its recorded HEAD matches the current
//      HEAD (i.e., preserve-slice was run on this exact tree).
//   3. For preservation slices, an agent card and a review artifact exist
//      under docs/research/agents/ or are passed via env variables
//      SLICE_AGENT_CARD / SLICE_REVIEW_ARTIFACT pointing at existing files.
//   4. The active milestone doc is referenced (env SLICE_MILESTONE or argv).
//
// Usage:
//   node scripts/check-slice-closure.mjs
//   node scripts/check-slice-closure.mjs --milestone docs/Parallx_Milestone_84.md
//
// Exit code 0 = OK to commit. Anything else = blocked.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(join(__dirname, '..'));

// Preservation surfaces. Sourced from /memories/repo/orchestrator-discipline.md.
// Patterns are tested as path prefixes or exact path matches.
const PRESERVATION_PREFIXES = [
  'electron/',
  'src/openclaw/',
  'src/contributions/',
  'src/built-in/canvas/canvasDataService.ts',
  'src/built-in/canvas/canvasPersistence.ts',
  'src/built-in/canvas/blockRegistry.ts',
  'src/services/chatAgentService.ts',
  'src/links/linkResolverService.ts',
];
const PRESERVATION_REGEXES = [
  /^src\/built-in\/[^/]+\/main\.ts$/, // any built-in activate()
];

function isPreservationPath(p) {
  const norm = p.replace(/\\/g, '/');
  for (const pref of PRESERVATION_PREFIXES) {
    if (norm === pref || norm.startsWith(pref)) return true;
  }
  for (const re of PRESERVATION_REGEXES) {
    if (re.test(norm)) return true;
  }
  return false;
}

function git(args) {
  const res = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { code: res.status, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}

function fail(msg) {
  console.error(`BLOCKED: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`WARN: ${msg}`);
}

// 1. Staged diff
const staged = git(['diff', '--cached', '--name-only']);
if (staged.code !== 0) fail(`git diff failed: ${staged.err}`);
const stagedFiles = staged.out.split('\n').filter(Boolean);
if (stagedFiles.length === 0) fail('no staged files; nothing to close.');

const preservationFiles = stagedFiles.filter(isPreservationPath);

console.log(`Staged files: ${stagedFiles.length}`);
console.log(`Preservation surface files: ${preservationFiles.length}`);
for (const f of preservationFiles) console.log(`  - ${f}`);

// 2. Preservation gate receipt
if (preservationFiles.length > 0) {
  const markerPath = join(repoRoot, '.slice-closure-ok');
  if (!existsSync(markerPath)) {
    fail(
      'preservation surface staged but .slice-closure-ok is missing. Run `npm run preserve:slice` first.',
    );
  }
  const receiptPath = join(repoRoot, '.slice-closure', 'last-run.json');
  if (!existsSync(receiptPath)) fail('missing .slice-closure/last-run.json receipt.');
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch (e) {
    fail(`could not parse slice-closure receipt: ${e.message}`);
  }
  const head = git(['rev-parse', 'HEAD']).out;
  if (receipt.head !== head) {
    fail(
      `slice-closure receipt is stale: receipt HEAD ${receipt.head} != current HEAD ${head}. Re-run preserve:slice.`,
    );
  }
  // 3. Agent card + review artifact
  const card = process.env.SLICE_AGENT_CARD;
  const review = process.env.SLICE_REVIEW_ARTIFACT;
  if (!card || !existsSync(resolve(repoRoot, card))) {
    fail(
      'preservation slice requires SLICE_AGENT_CARD env pointing to an existing agent card (e.g. docs/research/agents/surgical-executor-agent.md).',
    );
  }
  if (!review || !existsSync(resolve(repoRoot, review))) {
    fail(
      'preservation slice requires SLICE_REVIEW_ARTIFACT env pointing to an existing Fitness and Review Agent artifact.',
    );
  }
  console.log(`Agent card:      ${card}`);
  console.log(`Review artifact: ${review}`);
}

// 4. Milestone reference (advisory unless preservation)
const milestoneArg = process.argv.includes('--milestone')
  ? process.argv[process.argv.indexOf('--milestone') + 1]
  : process.env.SLICE_MILESTONE;
if (milestoneArg) {
  if (!existsSync(resolve(repoRoot, milestoneArg))) {
    fail(`milestone doc not found: ${milestoneArg}`);
  }
  console.log(`Milestone:       ${milestoneArg}`);
} else if (preservationFiles.length > 0) {
  fail(
    'preservation slice requires --milestone <path> or SLICE_MILESTONE env pointing to the active milestone doc.',
  );
} else {
  warn('no milestone reference provided (non-preservation slice; allowed).');
}

console.log('\nOK TO COMMIT');
