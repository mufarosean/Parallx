import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TEST_CHAT_MODEL = 'gpt-oss:20b';

function sanitizeEnv(sourceEnv) {
  const env = {};

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  return env;
}

function buildSuiteEnv(options = {}) {
  const env = sanitizeEnv(process.env);

  for (const key of options.clearKeys ?? []) {
    delete env[key];
  }

  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value;
    } else {
      delete env[key];
    }
  }

  if (!env.PARALLX_TEST_CHAT_MODEL) {
    env.PARALLX_TEST_CHAT_MODEL = DEFAULT_TEST_CHAT_MODEL;
  }

  return env;
}

export function resolveWorkspaceOrThrow(workspacePath) {
  const normalizedWorkspace = path.resolve(workspacePath);

  if (!fs.existsSync(normalizedWorkspace)) {
    throw new Error(`AI eval workspace not found: ${normalizedWorkspace}`);
  }

  return normalizedWorkspace;
}

export async function runCommand(command, args, options = {}) {
  const env = buildSuiteEnv({
    clearKeys: options.clearKeys,
    overrides: options.env,
  });

  const spawnCommand = process.platform === 'win32' && !command.endsWith('.cmd')
    ? `${command}.cmd`
    : command;

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, args, {
      stdio: 'inherit',
      cwd: options.cwd ?? process.cwd(),
      env,
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${spawnCommand} exited with signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });
}

export async function runPlaywrightSuite(options) {
  const env = { ...options.env };

  if (options.workspacePath) {
    const normalizedWorkspace = resolveWorkspaceOrThrow(options.workspacePath);
    env.PARALLX_AI_EVAL_WORKSPACE = normalizedWorkspace;
    env.PARALLX_AI_EVAL_WORKSPACE_NAME = options.workspaceName || path.basename(normalizedWorkspace) || normalizedWorkspace;
  }

  return runCommand(
    'npx',
    ['playwright', 'test', '--config=playwright.ai-eval.config.ts', ...options.tests],
    {
      cwd: options.cwd,
      env,
      clearKeys: options.clearWorkspaceOverride
        ? ['PARALLX_AI_EVAL_WORKSPACE', 'PARALLX_AI_EVAL_WORKSPACE_NAME']
        : undefined,
    },
  );
}