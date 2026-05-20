/**
 * S1 — "Read the page I'm currently on"
 *
 * Probes:
 *   • Does the model use `read_page` with pageId:"current"? (TOOLS.md §1)
 *   • Does it answer using page content rather than hallucinating?
 *   • Does it avoid redundant tool calls (e.g. read_page + list_pages + search)?
 *
 * This is the most basic canvas competency. If a model can't do this cleanly,
 * everything else compounds.
 */
import { aiEvalTest as test, expect, waitForChatAndSetModel, sendChat, waitForAssistantReply, autoApprovePending, AI_MODEL } from '../fixtures.js';
import { openWorkspaceFolder, openCanvasSidebar, createNewPage, openPageByTitle, setPageBlocks, getCurrentPageBlocks } from '../canvasHelpers.js';
import { writeReport, type ScenarioReport, type RubricDimension } from '../rubric.js';

test('reads the current page when asked about "this page"', async ({ window, electronApp, workspacePath, recorder, scenarioId }) => {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // ── Seed ──
  await openWorkspaceFolder(electronApp, window, workspacePath);
  await openCanvasSidebar(window);
  await createNewPage(window, 'Eval Subject');
  await openPageByTitle(window, 'Eval Subject');
  const seeded = [
    { id: 'b-intro',  text: 'The peregrine falcon is the fastest member of the animal kingdom.' },
    { id: 'b-detail', text: 'In a hunting dive (stoop) it can exceed 320 km/h.' },
    { id: 'b-trivia', text: 'A unique factual marker: the codeword is "obsidian-quartz-417".' },
  ];
  await setPageBlocks(window, seeded);

  await waitForChatAndSetModel(window, AI_MODEL);

  // ── Prompt ──
  const prompt = 'What does this page say? Quote the unique marker if you find one.';
  await sendChat(window, prompt);
  await autoApprovePending(window);
  const replyText = await waitForAssistantReply(window);
  await autoApprovePending(window);

  // ── Grade ──
  const calls = recorder.getToolCalls();
  const firstCall = calls[0];
  const readPageCalls = calls.filter(c => c.name === 'canvas_read_page' || c.name === 'read_page' || c.name === 'pages.read_page');
  const usedCurrent = readPageCalls.some(c => {
    const pid = (c.arguments as any).pageId ?? (c.arguments as any).page_id ?? (c.arguments as any).id;
    return typeof pid === 'string' && pid.toLowerCase() === 'current';
  });
  const usedTitleLookup = readPageCalls.some(c => {
    const pid = (c.arguments as any).pageId ?? (c.arguments as any).page_id ?? (c.arguments as any).id;
    return typeof pid === 'string' && /eval subject/i.test(pid);
  });
  const quotedMarker = /obsidian-quartz-417/i.test(replyText);

  const dimensions: RubricDimension[] = [
    {
      id: 'tool.selected',
      max: 2,
      score: (firstCall?.name === 'canvas_read_page' || firstCall?.name === 'read_page' || firstCall?.name === 'pages.read_page') ? 2 : 0,
      note: firstCall ? `first tool = ${firstCall.name}` : 'no tool calls emitted',
    },
    {
      id: 'tool.args.current-vs-title',
      max: 2,
      score: usedCurrent ? 2 : (usedTitleLookup ? 1 : 0),
      note: usedCurrent ? 'pageId="current"' : usedTitleLookup ? 'looked up by title (works, but loses "this page" semantics)' : 'neither current nor title',
    },
    {
      id: 'efficiency.no-redundancy',
      max: 2,
      score: calls.length <= 1 ? 2 : calls.length <= 2 ? 1 : 0,
      note: `${calls.length} total tool calls`,
    },
    {
      id: 'answer.grounded',
      max: 2,
      score: quotedMarker ? 2 : (/falcon|peregrine|320/i.test(replyText) ? 1 : 0),
      note: quotedMarker ? 'quoted unique marker' : 'did not surface unique marker',
    },
  ];

  const totalScore = dimensions.reduce((a, d) => a + d.score, 0);
  const maxScore = dimensions.reduce((a, d) => a + d.max, 0);

  const confusion: string[] = [];
  if (!firstCall) confusion.push('Model answered with NO tool call — likely hallucinated. Either tool descriptions are unclear, or model lacks tool-use training for this task.');
  if (firstCall && firstCall.name !== 'canvas_read_page' && firstCall.name !== 'read_page' && firstCall.name !== 'pages.read_page') confusion.push(`Wrong first tool: ${firstCall.name}. Expected canvas_read_page. Check TOOLS.md §Canvas Skills phrasing.`);
  if (firstCall && !usedCurrent && usedTitleLookup) confusion.push('Model looked up the page by title instead of using pageId="current". The "this page" → current mapping in TOOLS.md may not be salient.');
  if (calls.length > 2) confusion.push(`Used ${calls.length} tool calls for a one-shot read. Likely a confusion between read_page / list_pages / search_workspace.`);

  const finalState = { blocks: await getCurrentPageBlocks(window) };

  const report: ScenarioReport = {
    scenarioId, scenarioTitle: 'S1 — read the current page',
    model: AI_MODEL,
    startedAt, durationMs: Date.now() - startMs,
    prompt, dimensions, totalScore, maxScore, confusion,
    toolSequence: calls,
    turns: recorder.getTurns(),
    finalState,
  };
  const out = writeReport(report);
  console.log(`[ai-eval] wrote ${out.mdPath} (${totalScore}/${maxScore})`);

  // Soft expectations — we record everything, even on partial scores.
  expect(replyText.length, 'assistant emitted some reply').toBeGreaterThan(0);
});
