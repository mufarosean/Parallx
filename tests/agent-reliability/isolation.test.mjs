import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRun, preflight, contained } from './isolation.mjs';
import { seedTask, oracleCanaries } from './task.mjs';

test('owned roots pass, missing or mismatched roots fail before launch', async () => {
  const run = await createRun('isolation-canary');
  await preflight(run);
  await assert.rejects(preflight({ ...run, appRoot: undefined }));
  await assert.rejects(preflight({ ...run, workspace: run.appRoot }));
  assert.equal(contained(run.root, run.root + '-sibling'), false);
  await fs.writeFile(path.join(run.appRoot, 'data/last-workspace.json'), JSON.stringify({ path: run.appRoot }));
  await assert.rejects(preflight(run));
});

test('junction to a separate synthetic run cannot escape the owned workspace', async () => {
  const run = await createRun('junction-canary');
  const outside = await createRun('outside-sentinel');
  const link = path.join(run.root, 'escaped');
  await fs.symlink(outside.workspace, link, 'junction');
  await assert.rejects(preflight({ ...run, workspace: link }));
  // Retain both owned directories and sentinel; no recursive cleanup.
});

test('answer key rejects missing, duplicate, changed-input and fake-success artifacts', async () => {
  const run = await createRun('oracle-canary');
  oracleCanaries(await seedTask(run, 31));
});
