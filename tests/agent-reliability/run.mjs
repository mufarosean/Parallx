import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRun, launch, prepareCode, artifactRoot } from './isolation.mjs';
import { seedTask, inspect, oracleCanaries, firstPrompt, resumePrompt } from './task.mjs';
import { installRuntime } from './runtime.mjs';

const mode = process.argv.includes('--live') ? 'live' : 'deterministic';
const ui = process.argv.includes('--ui');
const getArg = (name, fallback) => process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1) ?? fallback;
const scenarios = getArg('--scenarios', 'control').split(',');
const repeats = Number(getArg('--repeats', '1'));
const startRepetition = Number(getArg('--start-repetition', '1'));
const modelId = getArg('--model', 'qwen3.8:27b');
const timeout = mode === 'live' ? 300000 : 60000;
const read = name => ({ tool: 'fs_read_file', args: { path: name } });
const write = (name, content) => ({ tool: 'fs_write_file', args: { path: name, content, description: `Write the verified fixture output ${name}.` } });
function phaseOne(oracle, scenario) {
  return [
    read('AGENTS.md'), read('TASK.md'), read('input.csv'), read('protected.txt'),
    { tool: 'plan_update', args: { goal: 'Complete the inventory task and verified report.', steps: [ { text: 'Build and verify inventory.csv', status: 'active' }, { text: 'Write and verify report.md after user continuation', status: 'pending' } ], note: `Preserve inputs. Report must include ${oracle.code}.` } },
    ...(scenario === 'failure' || scenario === 'combined' ? [ { tool: 'reliability_checkpoint', args: { kind: 'fail' } }, { tool: 'reliability_checkpoint', args: { kind: 'ok' } } ] : []),
    write('inventory.csv', oracle.inventory), read('inventory.csv'),
    { tool: 'plan_update', args: { steps: [ { text: 'Build and verify inventory.csv', status: 'done' }, { text: 'Write and verify report.md after user continuation', status: 'pending' } ], note: `Inventory verified; await continuation. Report code ${oracle.code}.` } },
    { text: 'Inventory created and read back. Report remains pending, as requested.' },
  ];
}
function phaseTwo(oracle, { name = 'report.md', existing = false } = {}) {
  return [ read('TASK.md'), read('inventory.csv'), read('protected.txt'),
    ...(existing ? [read(name)] : [write(name, `# Inventory report\nTotal quantity: ${oracle.total}\nVerification code: ${oracle.code}\nVerified sorted unique IDs and last duplicate wins.\n`), read(name)]),
    { tool: 'plan_update', args: { steps: [ { text: 'Build and verify inventory.csv', status: 'done' }, { text: `Write and verify ${name}`, status: 'done' } ], note: 'All output files read back and verified.' } },
    { text: `Completed and verified inventory.csv and ${name}. Total ${oracle.total}; code ${oracle.code}.` },
  ];
}
async function send(instance, text, sessionId, script) {
  if (script && mode === 'deterministic') await instance.page.evaluate(script => { window.__reliabilityRuntime.script = script; }, script);
  return instance.page.evaluate(({ text, sessionId }) => window.__reliabilityRuntime.start(text, sessionId), { text, sessionId });
}
async function finish(instance) {
  await instance.page.waitForFunction(() => window.__reliabilityRuntime.done === true || window.__reliabilityRuntime.errors.length > 0, undefined, { timeout, polling: 100 });
  const state = await instance.page.evaluate(() => JSON.parse(JSON.stringify(window.__reliabilityRuntime.snapshot())));
  assert.deepEqual(state.errors, [], 'Turn dispatch failed');
  return state;
}
async function sendFromUi(instance, text, sessionId, script) {
  await instance.page.evaluate(({ sessionId, script }) => {
    const state = window.__reliabilityRuntime;
    if (script) state.script = script;
    state.sessionId = sessionId;
    state.done = false;
    const chat = window.__parallx_workbench__._services.get({ id: 'IChatService' });
    const original = chat.sendRequest;
    chat.sendRequest = async function (...args) {
      chat.sendRequest = original;
      try { return state.result = await original.apply(this, args); }
      catch (error) { state.errors.push(String(error)); throw error; }
      finally { state.done = true; }
    };
  }, { sessionId, script: mode === 'deterministic' ? script : undefined });
  const input = instance.page.locator('.parallx-chat-input textarea').first();
  await input.fill(text);
  await input.press('Enter');
}
async function persistBarrier(instance, sessionId) {
  // waitForFunction treats a returned Promise as truthy in this installed
  // Playwright version. Await database reads in evaluate, poll on the host.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const persisted = await instance.page.evaluate(async sid => {
      const s = window.__parallx_workbench__._services;
      const db = s.get({ id: 'IDatabaseService' });
      const chat = s.get({ id: 'IChatService' });
      const rows = await db.all('SELECT COUNT(*) AS n FROM chat_messages WHERE session_id = ?', [sid]);
      const sessions = await db.all('SELECT plan_json FROM chat_sessions WHERE id = ?', [sid]);
      const expected = chat.getSession(sid);
      return expected.messages.length > 0 && rows[0]?.n === expected.messages.length * 2 &&
        sessions.length === 1 && JSON.stringify(JSON.parse(sessions[0].plan_json ?? 'null')) === JSON.stringify(expected.plan ?? null);
    }, sessionId);
    if (persisted) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Session and plan did not reach SQLite before restart');
}
async function saveState(run, label, state) {
  await fs.writeFile(path.join(run.evidence, `${label}.json`), JSON.stringify(state, null, 2));
}
async function showSession(instance, sessionId) {
  const opened = await instance.page.evaluate(sid => window.__parallx_workbench__._services.get({ id: 'ILinkResolverService' }).open(`parallx://chat/session/${sid}`), sessionId);
  assert(opened, 'Chat UI did not open the evaluated session');
  await instance.page.locator('.parallx-chat-message-list').first().waitFor({ state: 'visible' });
}
async function screenshot(instance, run, label) {
  if (ui) await instance.page.screenshot({ path: path.join(run.evidence, `${label}.png`) });
}
await prepareCode();
const results = [];
for (const scenario of scenarios) for (let repetition = startRepetition; repetition <= repeats; repetition++) {
  const run = await createRun(`${mode}-${scenario}`, mode);
  const oracle = await seedTask(run, repetition + 10);
  oracleCanaries(oracle);
  let instance;
  let sessionId;
  const started = Date.now();
  console.log(`[start] ${mode}/${scenario}/${repetition}: ${run.root}`);
  try {
    instance = await launch(run);
    await instance.page.evaluate(installRuntime, { mode, modelId, script: mode === 'deterministic' ? phaseOne(oracle, scenario) : [] });
    let prompt = firstPrompt;
    if (scenario === 'failure' || scenario === 'combined') prompt += ' Before writing, call reliability_checkpoint with kind=fail, then recover by retrying once with kind=ok.';
    sessionId = await send(instance, prompt);
    const first = await finish(instance);
    if (ui) await showSession(instance, sessionId);
    await saveState(run, 'phase-one', first);
    await persistBarrier(instance, sessionId);
    assert.equal((await fs.readFile(path.join(run.workspace, 'inventory.csv'), 'utf8')).trim(), oracle.inventory.trim());
    assert(first.session.plan, 'No durable plan');
    let reportName = 'report.md';
    if (scenario === 'instruction' || scenario === 'combined') {
      reportName = 'revised.md';
      await send(instance, 'Change the pending report filename to revised.md. Never create report.md. Update your plan, then pause.', sessionId, [
        { tool: 'plan_update', args: { steps: [{ text: 'Build and verify inventory.csv', status: 'done' }, { text: 'Write and verify revised.md; never create report.md', status: 'pending' }], note: `Latest instruction: use revised.md. Code ${oracle.code}.` } },
        { text: 'Updated: revised.md is pending; report.md must not be created.' },
      ]);
      await finish(instance);
    }
    if (['compact', 'combined', 'instruction'].includes(scenario)) {
      await send(instance, 'Confirm what remains pending without doing it.', sessionId, [{ text: `Inventory is verified; ${reportName} remains pending. Preserve ${oracle.code}.` }]);
      await finish(instance);
      await send(instance, '/compact', sessionId, []);
      const compacted = await finish(instance);
      await saveState(run, 'after-compact', compacted);
      assert(compacted.summaries > 0 || mode === 'live', 'Explicit compact did not request a summary');
    }
    if (scenario === 'automatic') {
      await send(instance, 'Call reliability_checkpoint three times with kind=pressure and sequence=0, then sequence=1, then sequence=2. Preserve the plan and pause without writing the report.', sessionId, [
        ...[0, 1, 2].map(sequence => ({ tool: 'reliability_checkpoint', args: { kind: 'pressure', sequence } })), { text: 'Pressure checkpoint read. Report remains pending.' },
      ]);
      const pressured = await finish(instance);
      await saveState(run, 'after-pressure', pressured);
      assert(pressured.summaries > 0, 'Automatic compaction did not occur');
    }
    if (scenario === 'cancel' || scenario === 'combined') {
      await (ui ? sendFromUi : send)(instance, 'Call reliability_checkpoint with kind=wait, then wait for its result before doing anything else.', sessionId, [{ tool: 'reliability_checkpoint', args: { kind: 'wait' } }, write('should-not-exist.txt', 'bad')]);
      await instance.page.waitForFunction(() => window.__reliabilityRuntime.pending, undefined, { timeout });
      await screenshot(instance, run, 'before-cancel');
      if (ui) await instance.page.locator('.parallx-chat-input-stop').first().click();
      else await instance.page.evaluate(sid => window.__parallx_workbench__._services.get({ id: 'IChatService' }).cancelRequest(sid), sessionId);
      await finish(instance);
      await screenshot(instance, run, 'after-cancel');
      assert.equal(await fs.stat(path.join(run.workspace, 'should-not-exist.txt')).then(() => true, () => false), false, 'Dispatch continued after cancellation');
    }
    if (['restart', 'combined', 'crash'].includes(scenario)) {
      await persistBarrier(instance, sessionId);
      await saveState(run, 'database-before-restart', await instance.page.evaluate(async () => window.__parallx_workbench__._services.get({ id: 'IDatabaseService' }).all('SELECT id, plan_json, workspace_id FROM chat_sessions')));
      await saveState(run, 'before-restart', await instance.page.evaluate(() => JSON.parse(JSON.stringify(window.__reliabilityRuntime.snapshot()))));
      await instance.close(); instance = undefined;
      instance = await launch(run, scenario === 'crash' ? { crashWrite: reportName } : {});
      await instance.page.evaluate(installRuntime, { mode, modelId, forbidWait: scenario === 'combined' });
      await instance.page.evaluate(async sid => {
        const chat = window.__parallx_workbench__._services.get({ id: 'IChatService' });
        await chat.ensureSessionHydrated(sid);
        if (!chat.getSession(sid)?.plan) throw new Error('Persisted plan missing after restart');
      }, sessionId);
      if (ui) await showSession(instance, sessionId);
      await screenshot(instance, run, 'restored');
    }
    if (scenario === 'denial') {
      await instance.page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('chat.show'));
      await instance.page.locator('.parallx-chat-message-list').first().waitFor({ state: 'attached' });
      await instance.page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getPermissionService().setCarefulMode(true));
      await send(instance, resumePrompt, sessionId, [write(reportName, 'Must be denied'), { text: 'Report write was denied; the task remains blocked.' }]);
      // Use the real confirmation UI, without blanket grants or auto-approval.
      await instance.page.locator('.parallx-chat-confirmation-btn--reject').first().waitFor({ state: 'visible', timeout: 15000 });
      await screenshot(instance, run, 'permission');
      await instance.page.locator('.parallx-chat-confirmation-btn--reject').first().click({ timeout: 15000 });
      const denied = await finish(instance);
      await saveState(run, 'denied', denied);
      assert.equal(await fs.stat(path.join(run.workspace, reportName)).then(() => true, () => false), false);
      await instance.page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getPermissionService().setCarefulMode(false));
    }
    await send(instance, resumePrompt, sessionId, phaseTwo(oracle, { name: reportName }));
    if (scenario === 'crash') {
      // This file appears after the production fs write, before the IPC reply.
      const deadline = Date.now() + timeout;
      while (!(await fs.stat(path.join(run.workspace, reportName)).then(() => true, () => false))) {
        if (Date.now() > deadline) throw new Error('Crash-point write did not occur');
        await new Promise(r => setTimeout(r, 50));
      }
      instance.app.process().kill();
      await instance.app.context().close().catch(() => {});
      instance = await launch(run);
      await instance.page.evaluate(installRuntime, { mode, modelId });
      await send(instance, resumePrompt, sessionId, phaseTwo(oracle, { name: reportName, existing: true }));
    }
    const final = await finish(instance);
    await screenshot(instance, run, 'completed');
    await saveState(run, 'final', final);
    assert(!final.result?.errorDetails, 'Final turn reported an execution error');
    assert.equal(final.session.messages.at(-1)?.response.isComplete, true, 'Final response is incomplete');
    await persistBarrier(instance, sessionId);
    const verdict = await inspect(run, oracle, reportName);
    assert(verdict.pass, verdict.failures.join('; '));
    if (reportName === 'revised.md') assert.equal(await fs.stat(path.join(run.workspace, 'report.md')).then(() => true, () => false), false, 'Superseded output created');
    const effects = (await fs.readFile(path.join(run.evidence, 'effects.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
    const outputEffects = effects.filter(e => ['inventory.csv', reportName].includes(e.path));
    assert.equal(outputEffects.filter(e => e.path === 'inventory.csv').length, 1, 'Repeated inventory write');
    assert.equal(outputEffects.filter(e => e.path === reportName).length, 1, 'Repeated report write');
    const result = { mode, scenario, repetition, pass: true, root: run.root, durationMs: Date.now() - started, sessionId, calls: final.calls.length, summaries: final.summaries };
    results.push(result);
    console.log('[pass]', JSON.stringify(result));
  } catch (error) {
    const result = { mode, scenario, repetition, pass: false, root: run.root, durationMs: Date.now() - started, error: String(error.stack ?? error) };
    results.push(result);
    if (instance) await saveState(run, 'failure-runtime', await instance.page.evaluate(() => JSON.parse(JSON.stringify(window.__reliabilityRuntime?.snapshot()))).catch(() => null));
    console.log('[fail]', JSON.stringify(result));
  } finally { if (instance) await instance.close().catch(e => console.log('Close:', String(e))); }
  await fs.writeFile(path.join(run.evidence, 'result.json'), JSON.stringify(results.at(-1), null, 2));
  await fs.writeFile(path.join(artifactRoot, 'latest-results.json'), JSON.stringify(results, null, 2));
}
process.exitCode = results.some(r => !r.pass) ? 1 : 0;
