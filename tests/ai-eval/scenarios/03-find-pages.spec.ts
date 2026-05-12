/**
 * S3 — "Find the page about X"
 *
 * Probes:
 *   • Does the model use `search_workspace` (semantic) vs `list_pages` (catalog)?
 *   • Can it disambiguate when two pages share keywords?
 *   • Does it follow up with `read_page` to confirm the right hit?
 *
 * Confusion patterns we expect to surface:
 *   - Defaulting to list_pages and pattern-matching titles in the model rather
 *     than letting search do the work.
 *   - Reading EVERY listed page instead of picking one.
 *   - Confusing "find" (discovery) with "read" (retrieval).
 */
import { aiEvalTest as test, expect, waitForChatAndSetModel, sendChat, waitForAssistantReply, autoApprovePending, AI_MODEL } from '../fixtures.js';
import { openWorkspaceFolder, openCanvasSidebar, createNewPage, openPageByTitle, setPageBlocks } from '../canvasHelpers.js';
import { writeReport, type ScenarioReport, type RubricDimension } from '../rubric.js';

test('finds the right page among several candidates', async ({ window, electronApp, workspacePath, recorder, scenarioId }) => {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  await openWorkspaceFolder(electronApp, window, workspacePath);
  await openCanvasSidebar(window);

  // Seed three pages where only one is actually about espresso brewing.
  // The other two share keywords ("coffee", "morning") to force semantic
  // discrimination instead of naive title matching.
  await createNewPage(window, 'Morning Routine');
  await openPageByTitle(window, 'Morning Routine');
  await setPageBlocks(window, [
    { id: 'mr-1', text: 'Wake up at 6am.' },
    { id: 'mr-2', text: 'Stretch for ten minutes.' },
    { id: 'mr-3', text: 'Cold shower.' },
  ]);

  await createNewPage(window, 'Coffee Shopping List');
  await openPageByTitle(window, 'Coffee Shopping List');
  await setPageBlocks(window, [
    { id: 'cs-1', text: 'Buy filters, paper, size 4.' },
    { id: 'cs-2', text: 'Beans: any single-origin.' },
    { id: 'cs-3', text: 'Milk frother batteries.' },
  ]);

  await createNewPage(window, 'Espresso Notes');
  await openPageByTitle(window, 'Espresso Notes');
  await setPageBlocks(window, [
    { id: 'en-1', text: 'Grind size: fine, like table salt.' },
    { id: 'en-2', text: 'Tamp pressure 30 lb.' },
    { id: 'en-3', text: 'Target shot: 36 g out in 28 seconds. Secret marker: "saffron-mosaic-911".' },
  ]);

  await waitForChatAndSetModel(window, AI_MODEL);

  const prompt = 'Find the page in my workspace that explains how to pull an espresso shot, and tell me the target weight and time.';
  await sendChat(window, prompt);
  await autoApprovePending(window);
  const replyText = await waitForAssistantReply(window);
  await autoApprovePending(window);

  const calls = recorder.getToolCalls();
  const searchCalls = calls.filter(c => c.name === 'search_workspace' || c.name === 'pages.search_workspace');
  const listCalls = calls.filter(c => c.name === 'list_pages' || c.name === 'pages.list_pages');
  const readCalls = calls.filter(c => c.name === 'read_page' || c.name === 'pages.read_page');
  const readEspresso = readCalls.some(c => {
    const pid = (c.arguments as any).pageId ?? (c.arguments as any).page_id ?? (c.arguments as any).id;
    return typeof pid === 'string' && /espresso/i.test(pid);
  });
  const mentionedTargets = /36\s*g/i.test(replyText) && /28\s*s/i.test(replyText);

  const dimensions: RubricDimension[] = [
    {
      id: 'discovery.tool',
      max: 2,
      score: searchCalls.length > 0 ? 2 : listCalls.length > 0 ? 1 : 0,
      note: `search=${searchCalls.length}, list=${listCalls.length}`,
    },
    {
      id: 'discovery.followed-up-with-read',
      max: 2,
      score: readEspresso ? 2 : readCalls.length > 0 ? 1 : 0,
      note: readEspresso ? 'read the espresso page' : `read ${readCalls.length} page(s), none espresso`,
    },
    {
      id: 'efficiency.didnt-read-everything',
      max: 2,
      score: readCalls.length <= 1 ? 2 : readCalls.length === 2 ? 1 : 0,
      note: `${readCalls.length} read_page calls`,
    },
    {
      id: 'answer.grounded',
      max: 2,
      score: mentionedTargets ? 2 : (/espresso/i.test(replyText) ? 1 : 0),
      note: mentionedTargets ? 'cited 36g / 28s' : 'did not cite both metrics',
    },
  ];

  const totalScore = dimensions.reduce((a, d) => a + d.score, 0);
  const maxScore = dimensions.reduce((a, d) => a + d.max, 0);

  const confusion: string[] = [];
  if (searchCalls.length === 0 && listCalls.length === 0) {
    confusion.push('Model attempted to answer without any discovery tool. Either it ignored the tool catalog or assumed the answer.');
  }
  if (searchCalls.length === 0 && listCalls.length > 0) {
    confusion.push('Model used list_pages instead of search_workspace. For "find the page about X" queries, search is the better tool. TOOLS.md should make this preference explicit.');
  }
  if (readCalls.length > 2) {
    confusion.push(`Model read ${readCalls.length} pages — likely scanning everything rather than trusting the search/list result. Tool descriptions may not communicate that search is already ranked.`);
  }
  if (readEspresso && !mentionedTargets) {
    confusion.push('Model read the right page but failed to extract specific numbers. Could be a context-truncation issue or a generation-quality issue rather than a tool issue.');
  }

  const report: ScenarioReport = {
    scenarioId, scenarioTitle: 'S3 — find the right page among candidates',
    model: AI_MODEL,
    startedAt, durationMs: Date.now() - startMs,
    prompt, dimensions, totalScore, maxScore, confusion,
    toolSequence: calls,
    turns: recorder.getTurns(),
  };
  const out = writeReport(report);
  console.log(`[ai-eval] wrote ${out.mdPath} (${totalScore}/${maxScore})`);

  expect(replyText.length).toBeGreaterThan(0);
});
