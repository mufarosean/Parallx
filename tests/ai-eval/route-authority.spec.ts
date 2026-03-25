import {
  test,
  expect,
  openFolderViaMenu,
  openChatPanel,
  waitForRagReady,
  startNewSession,
  sendAndWaitForResponse,
  RESPONSE_TIMEOUT,
} from './ai-eval-fixtures';
import fs from 'fs/promises';
import path from 'path';

test.describe.serial('Route Authority Correction Evaluation', () => {
  let workspaceDisplayName = process.env.PARALLX_AI_EVAL_WORKSPACE_NAME || 'demo-workspace';

  test.beforeAll(async ({ window, electronApp, workspacePath, workspaceLabel }) => {
    const brokenDocsDir = path.join(workspacePath, 'Broken Docs');
    const invalidRichDocBytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f, 0x01, 0x02, 0x03]);
    await fs.mkdir(brokenDocsDir, { recursive: true });
    await fs.writeFile(path.join(brokenDocsDir, 'policy-scan.pdf'), invalidRichDocBytes);
    await fs.writeFile(path.join(brokenDocsDir, 'claims-scan.pdf'), invalidRichDocBytes);

    workspaceDisplayName = process.env.PARALLX_AI_EVAL_WORKSPACE_NAME || workspaceLabel || path.basename(workspacePath) || 'demo-workspace';
    console.log(`\n  [Route Authority] Opening ${workspaceDisplayName}...`);
    await openFolderViaMenu(electronApp, window, workspacePath);

    console.log('  [Route Authority] Waiting 30s for indexing pipeline...');
    await window.waitForTimeout(30_000);

    console.log('  [Route Authority] Opening chat panel...');
    await openChatPanel(window);

    console.log('  [Route Authority] Waiting for RAG readiness...');
    await waitForRagReady(window);
  });

  test('corrects empty exhaustive coverage back to representative retrieval', async ({ window }) => {
    await startNewSession(window);
    await window.waitForTimeout(500);

    const result = await sendAndWaitForResponse(
      window,
      'Please summarize each file in the Broken Docs folder.',
      RESPONSE_TIMEOUT,
    );

    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.debug?.runtimeTrace?.routeAuthority?.action).toBe('corrected');
    expect(result.debug?.runtimeTrace?.routeAuthority?.reason).toContain('representative retrieval');
    expect(result.debug?.runtimeTrace?.route?.workflowType).toBeUndefined();
    expect(result.debug?.runtimeTrace?.route?.coverageMode).toBe('representative');
    expect(result.debug?.runtimeTrace?.contextPlan?.useRetrieval).toBe(true);
    expect(result.debug?.runtimeTrace?.route?.reason).toContain('Evidence authority correction');
  });

  test('preserves exhaustive coverage without a front-door summary workflow label for summary-like workspace prompts', async ({ window }) => {
    await startNewSession(window);
    await window.waitForTimeout(500);

    const result = await sendAndWaitForResponse(
      window,
      'Give me a bulleted list with a short summary of each file in my workspace.',
      RESPONSE_TIMEOUT,
    );

    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.debug?.runtimeTrace?.routeAuthority?.action ?? 'preserved').toBe('preserved');
    expect(result.debug?.runtimeTrace?.route?.workflowType).toBeUndefined();
    expect(result.debug?.runtimeTrace?.route?.coverageMode).toBe('exhaustive');
    expect(result.debug?.runtimeTrace?.contextPlan?.useRetrieval).toBe(false);
    expect(result.debug?.responseDebug?.phase).not.toBe('deterministic-workflow-direct-answer');
    expect(result.text).not.toContain('Deductible amounts found across the policy documents');
  });
});