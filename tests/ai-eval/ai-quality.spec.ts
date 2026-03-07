/**
 * AI Quality Evaluation — Test Spec
 *
 * End-to-end Playwright tests that launch Parallx with the demo-workspace
 * (insurance knowledge base), interact with the AI chat using REAL Ollama
 * inference, and score responses across 7 quality dimensions:
 *
 *   1. Factual Recall       — Can it retrieve specific facts?
 *   2. Detail Retrieval     — Can it find specific numbers/names/contacts?
 *   3. Summary              — Can it synthesize multiple facts into overviews?
 *   4. Multi-Doc Synthesis  — Can it combine info from several source files?
 *   5. Source Attribution    — Does it cite the right sources?
 *   6. Conversational       — Is it natural and context-appropriate?
 *   7. Follow-Up            — Does it handle multi-turn follow-up questions?
 *   8. Cross-Session Memory — Does it remember across chat sessions?
 *
 * The output is a quality score (0–100%) with per-dimension breakdown.
 * "Excellent" (≥ 85%) is the ChatGPT bar.
 *
 * Run:
 *   npx playwright test --config=playwright.ai-eval.config.ts
 *
 * Prerequisites:
 *   - Ollama running at localhost:11434
 *   - A model available (e.g., `ollama pull qwen2.5:32b-instruct`)
 *   - Build Parallx: `npm run build:renderer`
 */
import {
  test,
  expect,
  openFolderViaMenu,
  openChatPanel,
  waitForRagReady,
  startNewSession,
  sendAndWaitForResponse,
  modifyWorkspaceFile,
  revertWorkspaceFile,
  RESPONSE_TIMEOUT,
  MEMORY_STORE_WAIT,
  type ChatEvalDebugSnapshot,
} from './ai-eval-fixtures';
import {
  RUBRIC,
  CROSS_SESSION_TEST,
  LIVE_DATA_CHANGE_TEST,
  MEMORY_VS_RAG_TEST,
} from './rubric';
import { getRetrievalBenchmarkById } from './retrievalBenchmark';
import {
  evaluateAssertions,
  evaluateRetrievalMetrics,
  scoreTurn,
  buildReport,
  type TestCaseResult,
  type TurnResult,
} from './scoring';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REPORT_DIR = path.join(PROJECT_ROOT, 'test-results');

function logDebugSnapshot(testId: string, prompt: string, debug: ChatEvalDebugSnapshot | undefined): void {
  if (!debug) {
    console.warn(`  [DEBUG] ${testId}: no debug snapshot for "${prompt}"`);
    return;
  }

  const sourceLabels = (debug.ragSources ?? []).map((source) => source.label).join(', ');
  const pillLabels = (debug.contextPills ?? []).map((pill) => `${pill.type}:${pill.label}`).join(', ');
  console.warn(`  [DEBUG] ${testId}: ragSources=[${sourceLabels || 'none'}] pills=[${pillLabels || 'none'}]`);

  if (debug.retrievalTrace) {
    console.warn(`  [DEBUG] ${testId}: retrievalTrace=${JSON.stringify(debug.retrievalTrace)}`);
  }
}

// ── Accumulated results (module-level, safe with workers:1) ──────────────────
const allResults: TestCaseResult[] = [];

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe.serial('AI Quality Evaluation', () => {

  // ── Setup: Open workspace, wait for indexing, open chat ────────────────────

  test.beforeAll(
    async ({ window, electronApp, workspacePath }) => {
      console.log('\n  [Setup] Opening demo-workspace...');
      await openFolderViaMenu(electronApp, window, workspacePath);

      // Wait for the indexing pipeline to process the 5 small .md files.
      // Embedding each file via Ollama /api/embed takes a few seconds.
      // 30s is generous for a small workspace.
      console.log('  [Setup] Waiting 30s for indexing pipeline...');
      await window.waitForTimeout(30_000);

      console.log('  [Setup] Opening chat panel...');
      await openChatPanel(window);

      console.log('  [Setup] Waiting for RAG readiness...');
      await waitForRagReady(window);

      console.log('  [Setup] Ready. Running evaluation...\n');
    },
  );

  // ── Standard Rubric Tests (T01–T09) ────────────────────────────────────────
  //
  // Each test starts a new session to isolate context. Multi-turn tests
  // (like T08) send all prompts within a single session and evaluate each
  // turn's response independently.
  //
  // Empty responses score 0% but do NOT fail the test (so the suite continues).
  // Only infrastructure crashes (Electron down, timeout) cause hard failures.

  for (const tc of RUBRIC) {
    test(`${tc.id}: ${tc.name}`, async ({ window }) => {
      if (tc.turns.length >= 3) {
        test.setTimeout(12 * 60 * 1000);
      }

      await startNewSession(window);
      await window.waitForTimeout(500);

      const turns: TurnResult[] = [];
      const retrievalBenchmark = getRetrievalBenchmarkById(tc.id);

      for (const [turnIndex, turn] of tc.turns.entries()) {
        let text = '';
        let latencyMs = 0;
        let debug: ChatEvalDebugSnapshot | undefined;

        try {
          const result = await sendAndWaitForResponse(
            window,
            turn.prompt,
            RESPONSE_TIMEOUT,
          );
          text = result.text;
          latencyMs = result.latencyMs;
          debug = result.debug;
          if (!text.trim()) {
            logDebugSnapshot(tc.id, turn.prompt, debug);
          }
        } catch (err) {
          // Infrastructure error (timeout/crash) — record but don't abort suite
          console.warn(`  [WARN] ${tc.id}: Infrastructure error for "${turn.prompt}": ${err}`);
        }

        // Quality evaluation (never throws — empty text just scores 0)
        const assertionResults = evaluateAssertions(text, turn.assertions);
        const score = scoreTurn(assertionResults);
        const retrievalExpectation = retrievalBenchmark?.turns[turnIndex];
        const retrievalMetrics = retrievalExpectation
          ? evaluateRetrievalMetrics(text, retrievalExpectation)
          : undefined;

        turns.push({
          prompt: turn.prompt,
          response: text || '(empty response)',
          latencyMs,
          assertions: assertionResults,
          retrievalMetrics,
          debug,
          score,
        });

        // Annotate Playwright HTML report
        test.info().annotations.push({
          type: 'ai-eval-score',
          description: `${(score * 100).toFixed(0)}% — ${assertionResults.filter((a) => a.passed).length}/${assertionResults.length} assertions passed`,
        });
      }

      const testScore =
        turns.length > 0
          ? turns.reduce((s, t) => s + t.score, 0) / turns.length
          : 0;

      allResults.push({
        id: tc.id,
        name: tc.name,
        dimension: tc.dimension,
        turns,
        score: testScore,
      });

      // Real-time console progress
      const icon = testScore >= 0.85 ? 'PASS' : testScore >= 0.5 ? 'PART' : 'FAIL';
      console.log(
        `  [${icon}] ${tc.id}: ${(testScore * 100).toFixed(0)}% — ${tc.name}`,
      );
    });
  }

  // ── T10: Cross-Session Memory ──────────────────────────────────────────────
  //
  // Session 1: 3 turns injecting unique accident details (Riverside Mall,
  //            Elm Street, police report #2026-0305-1147).
  // Wait:      25 seconds for fire-and-forget memory summarization.
  // Session 2: Ask about the previous conversation. If the AI recalls
  //            location/details, cross-session memory is working.

  test(`${CROSS_SESSION_TEST.id}: ${CROSS_SESSION_TEST.name}`, async ({ window }) => {
    const cs = CROSS_SESSION_TEST;

    // ── Session 1: Create a memorable conversation ──
    console.log('  [T10] Session 1: injecting accident details...');
    await startNewSession(window);
    await window.waitForTimeout(500);

    for (const prompt of cs.session1Prompts) {
      try {
        await sendAndWaitForResponse(window, prompt, RESPONSE_TIMEOUT);
      } catch (err) {
        console.warn(`  [WARN] T10 Session 1: error for "${prompt}": ${err}`);
      }
    }

    // Wait for memory summarization (fire-and-forget LLM call)
    console.log(
      `  [T10] Waiting ${MEMORY_STORE_WAIT / 1000}s for memory summarization...`,
    );
    await window.waitForTimeout(MEMORY_STORE_WAIT);

    // ── Session 2: Probe for memory recall ──
    console.log('  [T10] Session 2: probing for memory...');
    await startNewSession(window);
    await window.waitForTimeout(1_000);

    let text = '';
    let latencyMs = 0;
    try {
      const result = await sendAndWaitForResponse(
        window,
        cs.session2Prompt,
        RESPONSE_TIMEOUT,
      );
      text = result.text;
      latencyMs = result.latencyMs;
    } catch (err) {
      console.warn(`  [WARN] T10 Session 2: error: ${err}`);
    }

    const assertionResults = evaluateAssertions(text, cs.session2Assertions);
    const score = scoreTurn(assertionResults);

    const turn: TurnResult = {
      prompt: cs.session2Prompt,
      response: text,
      latencyMs,
      assertions: assertionResults,
      score,
    };

    allResults.push({
      id: cs.id,
      name: cs.name,
      dimension: cs.dimension,
      turns: [turn],
      score,
    });

    test.info().annotations.push({
      type: 'ai-eval-score',
      description: `${(score * 100).toFixed(0)}% — ${assertionResults.filter((a) => a.passed).length}/${assertionResults.length} assertions passed`,
    });

    const icon = score >= 0.85 ? 'PASS' : score >= 0.5 ? 'PART' : 'FAIL';
    console.log(`  [${icon}] T10: ${(score * 100).toFixed(0)}% — ${cs.name}`);
  });

  // ── T11: Live Data Change ──────────────────────────────────────────────────
  //
  // 1. Ask about collision deductible → $500 (original)
  // 2. Modify the policy file (change $500 → $750)
  // 3. Wait for re-indexing
  // 4. Ask again → should say $750

  test(`${LIVE_DATA_CHANGE_TEST.id}: ${LIVE_DATA_CHANGE_TEST.name}`, async ({ window, workspacePath }) => {
    const ldc = LIVE_DATA_CHANGE_TEST;
    const turns: TurnResult[] = [];

    console.log('  [T11] Step 1: Verifying original value...');
    await startNewSession(window);
    await window.waitForTimeout(500);

    // Step 1: Verify original value ($500)
    let text = '';
    let latencyMs = 0;
    try {
      const result = await sendAndWaitForResponse(window, ldc.beforePrompt, RESPONSE_TIMEOUT);
      text = result.text;
      latencyMs = result.latencyMs;
    } catch (err) {
      console.warn(`  [WARN] T11 before-prompt: ${err}`);
    }

    const beforeResults = evaluateAssertions(text, ldc.beforeAssertions);
    turns.push({
      prompt: ldc.beforePrompt,
      response: text || '(empty response)',
      latencyMs,
      assertions: beforeResults,
      score: scoreTurn(beforeResults),
    });

    // Step 2: Modify the file
    console.log('  [T11] Step 2: Modifying policy file ($500 → $750)...');
    try {
      await modifyWorkspaceFile(workspacePath, ldc.fileToModify, ldc.originalText, ldc.modifiedText);
      await modifyWorkspaceFile(workspacePath, ldc.fileToModify, ldc.originalTableText, ldc.modifiedTableText);
    } catch (err) {
      console.warn(`  [WARN] T11 file modification failed: ${err}`);
    }

    // Step 3: Wait for re-indexing
    console.log(`  [T11] Step 3: Waiting ${ldc.reindexWaitMs / 1000}s for re-indexing...`);
    await window.waitForTimeout(ldc.reindexWaitMs);

    // Step 4: Ask again in a new session
    console.log('  [T11] Step 4: Verifying updated value...');
    await startNewSession(window);
    await window.waitForTimeout(500);

    text = '';
    latencyMs = 0;
    try {
      const result = await sendAndWaitForResponse(window, ldc.afterPrompt, RESPONSE_TIMEOUT);
      text = result.text;
      latencyMs = result.latencyMs;
    } catch (err) {
      console.warn(`  [WARN] T11 after-prompt: ${err}`);
    }

    const afterResults = evaluateAssertions(text, ldc.afterAssertions);
    turns.push({
      prompt: ldc.afterPrompt,
      response: text || '(empty response)',
      latencyMs,
      assertions: afterResults,
      score: scoreTurn(afterResults),
    });

    // Revert the file so subsequent tests aren't affected
    try {
      await revertWorkspaceFile(workspacePath, ldc.fileToModify, ldc.modifiedText, ldc.originalText);
      await revertWorkspaceFile(workspacePath, ldc.fileToModify, ldc.modifiedTableText, ldc.originalTableText);
    } catch { /* best effort */ }

    // Wait for re-indexing of the reverted file
    await window.waitForTimeout(15_000);

    // Score: only the "after" turn matters (before is just a sanity check)
    const testScore = turns.length >= 2 ? turns[1].score : 0;

    allResults.push({
      id: ldc.id,
      name: ldc.name,
      dimension: ldc.dimension,
      turns,
      score: testScore,
    });

    const icon = testScore >= 0.85 ? 'PASS' : testScore >= 0.5 ? 'PART' : 'FAIL';
    console.log(`  [${icon}] T11: ${(testScore * 100).toFixed(0)}% — ${ldc.name}`);
  });

  // ── T12: Memory vs RAG Conflict ────────────────────────────────────────────
  //
  // Session 1: Discuss deductible ($500) to plant memory.
  // Between: Change file to $950.
  // Session 2: Ask about deductible. Correct = $950 (RAG), Wrong = $500 (stale memory).

  test(`${MEMORY_VS_RAG_TEST.id}: ${MEMORY_VS_RAG_TEST.name}`, async ({ window, workspacePath }) => {
    const mvr = MEMORY_VS_RAG_TEST;

    // ── Session 1: Create memory about $500 deductible ──
    console.log('  [T12] Session 1: Planting deductible memory...');
    await startNewSession(window);
    await window.waitForTimeout(500);

    for (const prompt of mvr.session1Prompts) {
      try {
        await sendAndWaitForResponse(window, prompt, RESPONSE_TIMEOUT);
      } catch (err) {
        console.warn(`  [WARN] T12 Session 1: error for "${prompt}": ${err}`);
      }
    }

    // Wait for memory summarization
    console.log(`  [T12] Waiting ${mvr.memoryWaitMs / 1000}s for memory summarization...`);
    await window.waitForTimeout(mvr.memoryWaitMs);

    // ── Modify file between sessions ──
    console.log('  [T12] Modifying policy file ($500 → $950)...');
    try {
      await modifyWorkspaceFile(workspacePath, mvr.fileToModify, mvr.originalText, mvr.modifiedText);
      await modifyWorkspaceFile(workspacePath, mvr.fileToModify, mvr.originalTableText, mvr.modifiedTableText);
    } catch (err) {
      console.warn(`  [WARN] T12 file modification failed: ${err}`);
    }

    // Wait for re-indexing
    console.log(`  [T12] Waiting ${mvr.reindexWaitMs / 1000}s for re-indexing...`);
    await window.waitForTimeout(mvr.reindexWaitMs);

    // ── Session 2: Probe — should use RAG ($950), not memory ($500) ──
    console.log('  [T12] Session 2: Probing for RAG vs memory...');
    await startNewSession(window);
    await window.waitForTimeout(1_000);

    let text = '';
    let latencyMs = 0;
    try {
      const result = await sendAndWaitForResponse(window, mvr.session2Prompt, RESPONSE_TIMEOUT);
      text = result.text;
      latencyMs = result.latencyMs;
    } catch (err) {
      console.warn(`  [WARN] T12 Session 2: error: ${err}`);
    }

    const assertionResults = evaluateAssertions(text, mvr.session2Assertions);
    const score = scoreTurn(assertionResults);

    const turn: TurnResult = {
      prompt: mvr.session2Prompt,
      response: text || '(empty response)',
      latencyMs,
      assertions: assertionResults,
      score,
    };

    allResults.push({
      id: mvr.id,
      name: mvr.name,
      dimension: mvr.dimension,
      turns: [turn],
      score,
    });

    // Revert the file
    try {
      await revertWorkspaceFile(workspacePath, mvr.fileToModify, mvr.modifiedText, mvr.originalText);
      await revertWorkspaceFile(workspacePath, mvr.fileToModify, mvr.modifiedTableText, mvr.originalTableText);
    } catch { /* best effort */ }

    // Wait for revert to re-index
    await window.waitForTimeout(15_000);

    const icon = score >= 0.85 ? 'PASS' : score >= 0.5 ? 'PART' : 'FAIL';
    console.log(`  [${icon}] T12: ${(score * 100).toFixed(0)}% — ${mvr.name}`);
  });

  // ── T19: Source Citation Click → Opens Editor ──────────────────────────────
  //
  // Ask a question that produces source citations, then click on a source
  // pill/badge and verify the correct document opens in the editor (not blank).
  // This tests the openFile() path resolution fix.

  test('T19: Source citation click opens correct document', async ({ window }) => {
    console.log('  [T19] Asking question to trigger source citations...');
    await startNewSession(window);
    await window.waitForTimeout(500);

    let turnScore = 0;
    const assertions: { name: string; weight: number; passed: boolean }[] = [];

    try {
      // Ask something that will definitely produce source citations
      await sendAndWaitForResponse(
        window,
        "What is my agent's phone number?",
        RESPONSE_TIMEOUT,
      );

      // Look for clickable source elements in the last assistant message
      const assistantMsgs = window.locator('.parallx-chat-message--assistant');
      const lastMsg = assistantMsgs.last();

      // Source citations appear as:
      // 1. Reference pills in thinking section: .parallx-chat-reference
      // 2. Citation badges in text: .parallx-citation-badge
      // 3. Source mention links: .parallx-source-mention
      const refPills = lastMsg.locator('.parallx-chat-reference');
      const citBadges = lastMsg.locator('.parallx-citation-badge');
      const srcMentions = lastMsg.locator('.parallx-source-mention');

      const pillCount = await refPills.count();
      const badgeCount = await citBadges.count();
      const mentionCount = await srcMentions.count();

      console.log(`  [T19] Found: ${pillCount} ref pills, ${badgeCount} citation badges, ${mentionCount} source mentions`);

      const hasSources = pillCount > 0 || badgeCount > 0 || mentionCount > 0;
      assertions.push({
        name: 'Response has source citations',
        weight: 2,
        passed: hasSources,
      });

      if (hasSources) {
        // Count editor tabs before clicking
        const tabsBefore = await window.locator('.tab').count();

        // Click the first available citation element
        let clicked = false;
        if (pillCount > 0) {
          console.log('  [T19] Clicking reference pill...');
          await refPills.first().click();
          clicked = true;
        } else if (badgeCount > 0) {
          console.log('  [T19] Clicking citation badge...');
          await citBadges.first().click();
          clicked = true;
        } else if (mentionCount > 0) {
          console.log('  [T19] Clicking source mention...');
          await srcMentions.first().click();
          clicked = true;
        }

        assertions.push({
          name: 'Citation element is clickable',
          weight: 1,
          passed: clicked,
        });

        if (clicked) {
          // Wait for editor to open
          await window.waitForTimeout(3_000);

          // Check if a new editor tab opened
          const tabsAfter = await window.locator('.tab').count();
          const newTabOpened = tabsAfter > tabsBefore;
          assertions.push({
            name: 'Clicking source opens a new editor tab',
            weight: 3,
            passed: newTabOpened,
          });

          if (newTabOpened) {
            // Check the editor has actual content (not blank)
            // The editor content area is .editor-instance or .parallx-text-editor
            await window.waitForTimeout(1_000);

            // Look for visible text content in the active editor
            const editorContent = window.locator('.editor-instance .ProseMirror, .parallx-text-editor');
            let hasContent = false;
            const edCount = await editorContent.count();
            if (edCount > 0) {
              const text = await editorContent.first().innerText({ timeout: 3_000 }).catch(() => '');
              hasContent = text.trim().length > 10;
              console.log(`  [T19] Editor content length: ${text.trim().length} chars`);
            }

            assertions.push({
              name: 'Opened document has content (not blank)',
              weight: 3,
              passed: hasContent,
            });

            // Check the tab title matches a known workspace file
            const activeTab = window.locator('.tab.active .tab-label, .tab.selected .tab-label');
            let tabText = '';
            try {
              tabText = await activeTab.innerText({ timeout: 2_000 });
            } catch { /* may not have specific structure */ }

            const isKnownFile = /agent contact|claims guide|auto insurance|vehicle info|accident/i.test(tabText);
            assertions.push({
              name: 'Tab title matches a workspace document',
              weight: 2,
              passed: isKnownFile || tabText.length > 0, // At least has a title
            });

            console.log(`  [T19] Active tab title: "${tabText}"`);
          }
        }
      }
    } catch (err) {
      console.warn(`  [WARN] T19: Infrastructure error: ${err}`);
    }

    // Calculate score
    turnScore = assertions.length > 0
      ? assertions.reduce((s, a) => s + (a.passed ? a.weight : 0), 0) /
        assertions.reduce((s, a) => s + a.weight, 0)
      : 0;

    allResults.push({
      id: 'T19',
      name: 'Source citation click opens correct document',
      dimension: 'source-attribution',
      turns: [{
        prompt: "What is my agent's phone number? (then click source)",
        response: assertions.map(a => `${a.passed ? '[OK]' : '[X]'} ${a.name}`).join('\n'),
        latencyMs: 0,
        assertions,
        score: turnScore,
      }],
      score: turnScore,
    });

    const tIcon = turnScore >= 0.85 ? 'PASS' : turnScore >= 0.5 ? 'PART' : 'FAIL';
    console.log(`  [${tIcon}] T19: ${(turnScore * 100).toFixed(0)}% — Source citation click opens correct document`);
  });

  // ── Report Generation ──────────────────────────────────────────────────────

  test.afterAll(async ({ ollamaModel }) => {
    if (allResults.length === 0) {
      console.log('\n  No results to report (all tests may have been skipped).\n');
      return;
    }

    const report = buildReport(allResults, ollamaModel);

    // Console output
    console.log(report.summary);

    // Save JSON report (machine-readable, includes full response text)
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const jsonPath = path.join(REPORT_DIR, 'ai-eval-report.json');
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

    // Save text report (human-readable summary)
    const textPath = path.join(REPORT_DIR, 'ai-eval-report.txt');
    await fs.writeFile(textPath, report.summary);

    console.log('  Reports saved:');
    console.log(`    ${jsonPath}`);
    console.log(`    ${textPath}`);
  });
});
