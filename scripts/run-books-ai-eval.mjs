import fs from 'node:fs';
import path from 'node:path';

import { runPlaywrightSuite } from './ai-eval-runner.mjs';

const DEFAULT_WORKSPACE = 'C:/Users/mchit/OneDrive/Documents/Books';
const workspace = process.env.PARALLX_AI_EVAL_WORKSPACE || DEFAULT_WORKSPACE;
const normalizedWorkspace = path.resolve(workspace);

if (!fs.existsSync(normalizedWorkspace)) {
  console.error(`Books workspace not found: ${normalizedWorkspace}`);
  process.exit(1);
}

const exitCode = await runPlaywrightSuite({
  tests: ['tests/ai-eval/books-quality.spec.ts'],
  workspacePath: normalizedWorkspace,
  workspaceName: process.env.PARALLX_AI_EVAL_WORKSPACE_NAME || 'Books',
});

process.exit(exitCode);