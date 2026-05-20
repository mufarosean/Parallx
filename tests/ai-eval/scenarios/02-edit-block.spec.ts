/**
 * S2 — "Edit block X to say Y"
 *
 * Probes (M60 §6.3 C3):
 *   • Does the model use `edit_block` rather than read_page + write_page?
 *   • Does it discover the block id by reading the page first?
 *   • Does it preserve sibling blocks (no clobber)?
 *   • Does the resulting page have the new text in the right block?
 *
 * Confusion patterns we expect to surface:
 *   - Reaching for write_page (whole-page rewrite, destructive).
 *   - Guessing block ids without reading.
 *   - Calling edit_block multiple times for one logical edit.
 */
import { aiEvalTest as test, expect, waitForChatAndSetModel, sendChat, waitForAssistantReply, autoApprovePending, AI_MODEL } from '../fixtures.js';
import { openWorkspaceFolder, openCanvasSidebar, createNewPage, openPageByTitle, setPageBlocks, getCurrentPageBlocks } from '../canvasHelpers.js';
import { writeReport, type ScenarioReport, type RubricDimension } from '../rubric.js';

test('edits a single block by id without clobbering siblings', async ({ window, electronApp, workspacePath, recorder, scenarioId }) => {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  await openWorkspaceFolder(electronApp, window, workspacePath);
  await openCanvasSidebar(window);
  await createNewPage(window, 'Project Plan');
  await openPageByTitle(window, 'Project Plan');
  const seeded = [
    { id: 'b-intro',   text: 'Intro section — keep as is.' },
    { id: 'b-summary', text: 'Original summary: ship Tier 3 by end of week.' },
    { id: 'b-actions', text: 'Actions: tbd — keep as is.' },
  ];
  await setPageBlocks(window, seeded);

  await waitForChatAndSetModel(window, AI_MODEL);

  const prompt = "On the page 'Project Plan', rewrite the summary block to say exactly: \"Tier 3 ships Friday.\" Leave the other blocks alone.";
  await sendChat(window, prompt);
  await autoApprovePending(window);
  const replyText = await waitForAssistantReply(window);
  await autoApprovePending(window);

  const calls = recorder.getToolCalls();
  const editBlockCalls = calls.filter(c => c.name === 'canvas_edit_block' || c.name === 'edit_block' || c.name === 'pages.edit_block');
  const writePageCalls = calls.filter(c => c.name === 'write_page' || c.name === 'pages.write_page');
  const readPageBefore = calls.findIndex(c => c.name === 'canvas_read_page' || c.name === 'read_page' || c.name === 'pages.read_page');
  const firstEditAt = calls.findIndex(c => c.name === 'canvas_edit_block' || c.name === 'edit_block' || c.name === 'pages.edit_block');
  const readBeforeEdit = readPageBefore >= 0 && (firstEditAt < 0 || readPageBefore < firstEditAt);

  const finalBlocks = await getCurrentPageBlocks(window);
  const summary = finalBlocks.find(b => b.id === 'b-summary');
  const intro = finalBlocks.find(b => b.id === 'b-intro');
  const actions = finalBlocks.find(b => b.id === 'b-actions');
  const summaryMatches = !!summary && /tier 3 ships friday/i.test(summary.text);
  const introIntact = intro?.text === seeded[0].text;
  const actionsIntact = actions?.text === seeded[2].text;
  const idsPreserved = !!summary && !!intro && !!actions;

  const dimensions: RubricDimension[] = [
    {
      id: 'tool.preferred',
      max: 2,
      score: editBlockCalls.length > 0 && writePageCalls.length === 0 ? 2
           : editBlockCalls.length > 0 ? 1
           : 0,
      note: `edit_block=${editBlockCalls.length}, write_page=${writePageCalls.length}`,
    },
    {
      id: 'discovery.read-before-edit',
      max: 2,
      score: readBeforeEdit ? 2 : 0,
      note: readBeforeEdit ? 'read_page preceded edit_block' : 'edited without reading (likely guessed id)',
    },
    {
      id: 'state.summary-updated',
      max: 2,
      score: summaryMatches ? 2 : 0,
      note: summary ? `final summary text = "${summary.text.slice(0, 80)}"` : 'b-summary missing',
    },
    {
      id: 'state.siblings-intact',
      max: 2,
      score: introIntact && actionsIntact ? 2 : (introIntact || actionsIntact ? 1 : 0),
      note: `intro=${introIntact}, actions=${actionsIntact}`,
    },
    {
      id: 'state.ids-preserved',
      max: 2,
      score: idsPreserved ? 2 : 0,
      note: idsPreserved ? 'all three ids still present' : 'block ids changed',
    },
    {
      id: 'efficiency.one-edit',
      max: 2,
      score: editBlockCalls.length === 1 ? 2 : editBlockCalls.length === 2 ? 1 : 0,
      note: `${editBlockCalls.length} edit_block calls (expected 1)`,
    },
  ];

  const totalScore = dimensions.reduce((a, d) => a + d.score, 0);
  const maxScore = dimensions.reduce((a, d) => a + d.max, 0);

  const confusion: string[] = [];
  if (writePageCalls.length > 0) confusion.push('Model used write_page — likely defaulting to whole-page rewrite because edit_block is unfamiliar or its description is unclear. Strengthen TOOLS.md to prefer edit_block.');
  if (editBlockCalls.length === 0) confusion.push('Model never called edit_block. Possible causes: (a) tool not surfaced in the prompt, (b) tool description too abstract, (c) model lacks structural editing concept.');
  if (firstEditAt >= 0 && !readBeforeEdit) confusion.push('Model edited a block without first reading the page. It is guessing ids — likely will hit "block not found" failures in production.');
  if (editBlockCalls.length > 1) confusion.push('Multiple edit_block calls for one logical edit. Could indicate: (a) idempotency key not stable, (b) model retrying after an error, (c) misreading its own previous output.');
  if (!summaryMatches && editBlockCalls.length > 0) {
    const argsStr = JSON.stringify(editBlockCalls.map(c => c.arguments));
    confusion.push(`edit_block was called but final text doesn't match. Args: ${argsStr}`);
  }

  const finalState = { blocks: finalBlocks, expected: { 'b-summary': 'Tier 3 ships Friday.' } };

  const report: ScenarioReport = {
    scenarioId, scenarioTitle: 'S2 — edit block by id',
    model: AI_MODEL,
    startedAt, durationMs: Date.now() - startMs,
    prompt, dimensions, totalScore, maxScore, confusion,
    toolSequence: calls,
    turns: recorder.getTurns(),
    finalState,
  };
  const out = writeReport(report);
  console.log(`[ai-eval] wrote ${out.mdPath} (${totalScore}/${maxScore})`);

  expect(replyText.length).toBeGreaterThan(0);
});
