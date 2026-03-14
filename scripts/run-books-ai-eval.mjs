import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_WORKSPACE = 'C:/Users/mchit/OneDrive/Documents/Books';
const workspace = process.env.PARALLX_AI_EVAL_WORKSPACE || DEFAULT_WORKSPACE;
const normalizedWorkspace = path.resolve(workspace);

if (!fs.existsSync(normalizedWorkspace)) {
  console.error(`Books workspace not found: ${normalizedWorkspace}`);
  process.exit(1);
}

const env = {
  ...process.env,
  PARALLX_AI_EVAL_WORKSPACE: normalizedWorkspace,
  PARALLX_AI_EVAL_WORKSPACE_NAME: process.env.PARALLX_AI_EVAL_WORKSPACE_NAME || 'Books',
  PARALLX_TEST_CHAT_MODEL: process.env.PARALLX_TEST_CHAT_MODEL || 'gpt-oss:20b',
};

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', '--config=playwright.ai-eval.config.ts', 'tests/ai-eval/books-quality.spec.ts'],
  {
    stdio: 'inherit',
    env,
    cwd: process.cwd(),
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});