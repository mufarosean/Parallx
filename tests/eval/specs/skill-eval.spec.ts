/**
 * Skill chain eval spec — drives the AI chat through every SKILL_CHAIN_CASE
 * with gemma4:26b and scores whether the model uses the expected tools in
 * the expected order.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { launchEvalSession, EVAL_MODEL_ID } from '../harness/launcher.js';
import { openChatPanel, startNewChat, sendChatTurn, runInitOnce } from '../harness/chat.js';
import { scoreChain, summarize } from '../harness/scorer.js';
import { SKILL_CHAIN_CASES } from '../harness/skillCases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.resolve(__dirname, '..', 'results');
const MANIFEST_PATH = path.resolve(__dirname, '..', 'tool-skill-manifest.json');

async function loadKnownToolNames(): Promise<Set<string>> {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw) as { tools: { id: string }[] };
  return new Set(manifest.tools.map((t) => t.id));
}

async function makeWorkspace(): Promise<string> {
  const dir = path.join(os.tmpdir(), `parallx-skill-eval-${Date.now()}`);
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'README.md'), '# Demo\n\nProject for skill eval.\n');
  await fs.writeFile(path.join(dir, 'src', 'a.ts'), '// TODO: refactor\nconst x = 1;\n');
  await fs.writeFile(path.join(dir, 'src', 'b.ts'), '// TODO: docs\nconst y = 2;\n');
  await fs.writeFile(path.join(dir, 'docs', 'guide.md'), '# Guide\n\nLonger doc with sections.\n');
  return dir;
}

test.describe('Skill chain eval — gemma4:26b', () => {
  test.setTimeout(15 * 60_000);

  test('every skill chain scored', async ({}, testInfo) => {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    const knownTools = await loadKnownToolNames();
    const workspace = await makeWorkspace();

    const session = await launchEvalSession({ workspacePath: workspace });
    const { page } = session;
    const results = [];

    try {
      await openChatPanel(page);
      await runInitOnce(page);
      for (const c of SKILL_CHAIN_CASES) {
        console.log(`\n[skill-eval] ${c.id} — ${c.prompt}`);
        await startNewChat(page);
        const turn = await sendChatTurn(page, c.prompt, 180_000);
        const result = scoreChain(
          c,
          turn.toolInvocations,
          knownTools,
          turn.assistantText,
          turn.durationMs,
        );
        console.log(`  verdict=${result.verdict} observed=[${result.observed.join(' -> ')}]`);
        results.push(result);

        await page.screenshot({
          path: path.join(RESULTS_DIR, `skill-${c.id}.png`),
          fullPage: false,
        }).catch(() => {});
      }
    } finally {
      await session.close().catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }

    const summary = summarize(results);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(RESULTS_DIR, `skill-eval-${stamp}.json`);
    await fs.writeFile(jsonPath, JSON.stringify({ model: EVAL_MODEL_ID, summary }, null, 2));

    console.log('\n[skill-eval] SUMMARY');
    console.log(`  total=${summary.total}`);
    console.log(`  correct=${summary.correct}  partial=${summary.partial}  wrong_tool=${summary.wrong_tool}  no_tool=${summary.no_tool}  hallucinated=${summary.hallucinated}`);
    console.log(`  pass-rate=${(summary.passRate * 100).toFixed(1)}%`);

    await testInfo.attach('skill-eval', { path: jsonPath, contentType: 'application/json' });
    expect(summary.total).toBe(SKILL_CHAIN_CASES.length);
  });
});
