/**
 * Per-tool eval spec — drives the AI chat through every TOOL_EVAL_CASE with
 * gemma4:26b and scores the tool calls. One assistant turn per case.
 *
 * Use:
 *   npx playwright test tests/eval/specs/tool-eval.spec.ts --headed
 *
 * Output: tests/eval/results/tool-eval-{timestamp}.json + a markdown report.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { launchEvalSession, EVAL_MODEL_ID } from '../harness/launcher.js';
import { openChatPanel, startNewChat, sendChatTurn, runInitOnce } from '../harness/chat.js';
import { scoreSingleTool, summarize } from '../harness/scorer.js';
import { TOOL_EVAL_CASES } from '../harness/toolCases.js';

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
  const dir = path.join(os.tmpdir(), `parallx-tool-eval-${Date.now()}`);
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'README.md'), '# Demo\n\nA tiny project used for tool-eval.\n');
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), 'console.log("hello");\n// TODO: implement\n');
  await fs.writeFile(path.join(dir, 'src', 'utils.ts'), 'export const add = (a:number,b:number)=>a+b;\n// TODO: cover negatives\n');
  await fs.writeFile(path.join(dir, 'docs', 'guide.md'), '# Guide\n\nDocs for the project.\n');
  return dir;
}

test.describe('Tool eval — gemma4:26b', () => {
  test.setTimeout(60 * 60_000); // up to 1 hour for full sweep on 26B

  test('every tool case scored', async ({}, testInfo) => {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    const knownTools = await loadKnownToolNames();
    const workspace = await makeWorkspace();

    const session = await launchEvalSession({ workspacePath: workspace });
    const { page } = session;

    const results = [];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const partialPath = path.join(RESULTS_DIR, `tool-eval-${stamp}.partial.json`);
    try {
      await openChatPanel(page);
      // Init the workspace the way a real user would, before any cases run.
      await runInitOnce(page);

      for (const c of TOOL_EVAL_CASES) {
        console.log(`\n[tool-eval] ${c.id} — ${c.prompt}`);
        await startNewChat(page);
        const turn = await sendChatTurn(page, c.prompt, 120_000);
        const result = scoreSingleTool(
          c,
          turn.toolInvocations,
          knownTools,
          turn.assistantText,
          turn.durationMs,
        );
        console.log(`  verdict=${result.verdict} observed=[${result.observed.join(', ')}]`);
        results.push(result);

        // Checkpoint after every case so a timeout never loses everything.
        await fs.writeFile(
          partialPath,
          JSON.stringify({ model: EVAL_MODEL_ID, completed: results.length, total: TOOL_EVAL_CASES.length, results }, null, 2),
        ).catch(() => {});

        // Per-case screenshot for the report.
        await page.screenshot({
          path: path.join(RESULTS_DIR, `tool-${c.id}.png`),
          fullPage: false,
        }).catch(() => {});
      }
    } finally {
      await session.close().catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }

    const summary = summarize(results);
    const jsonPath = path.join(RESULTS_DIR, `tool-eval-${stamp}.json`);
    await fs.writeFile(jsonPath, JSON.stringify({ model: EVAL_MODEL_ID, summary, results }, null, 2));

    console.log('\n[tool-eval] SUMMARY');
    console.log(`  total=${summary.total}`);
    console.log(`  correct=${summary.correct}  wrong_tool=${summary.wrong_tool}  no_tool=${summary.no_tool}  hallucinated=${summary.hallucinated}`);
    console.log(`  pass-rate=${(summary.passRate * 100).toFixed(1)}%`);
    console.log(`  results -> ${jsonPath}`);

    await testInfo.attach('tool-eval', { path: jsonPath, contentType: 'application/json' });

    // Don't hard-fail the test on poor pass-rate — this is an eval, not a
    // regression. We only fail if zero cases ran (harness broken).
    expect(summary.total).toBe(TOOL_EVAL_CASES.length);
  });
});
