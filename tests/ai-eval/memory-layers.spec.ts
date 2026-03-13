import {
  test,
  expect,
  openFolderViaMenu,
  openChatPanel,
  waitForRagReady,
  startNewSession,
  sendAndWaitForResponse,
  RESPONSE_TIMEOUT,
  MEMORY_STORE_WAIT,
} from './ai-eval-fixtures';
import fs from 'fs/promises';
import path from 'path';

const MEMORY_DIR = path.join('.parallx', 'memory');
const DURABLE_MEMORY = path.join(MEMORY_DIR, 'MEMORY.md');
const DAILY_MEMORY = path.join(MEMORY_DIR, '2026-03-12.md');

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[‐‑‒–—]/g, '-');
}

function todayFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.md`;
}

async function seedCanonicalMemory(workspacePath: string): Promise<void> {
  const memoryDir = path.join(workspacePath, MEMORY_DIR);
  await fs.mkdir(memoryDir, { recursive: true });

  await fs.writeFile(
    path.join(workspacePath, DURABLE_MEMORY),
    [
      '# Durable Memory',
      '',
      '- Technical answer preference: use the phrase "structured brevity" and keep implementation guidance precise.',
      '- Durable policy: when summarizing work, prefer concrete next steps over open-ended brainstorming.',
      '',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(
    path.join(workspacePath, DAILY_MEMORY),
    [
      '# 2026-03-12',
      '',
      '- Today\'s migration spike codename is ember-rail.',
      '- This is a temporary daily note, not a durable preference.',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function readDailyMemoryWithSessionBlock(workspacePath: string): Promise<string> {
  const memoryDir = path.join(workspacePath, MEMORY_DIR);
  const entries = await fs.readdir(memoryDir, { withFileTypes: true });
  const dailyFiles = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  for (const fileName of dailyFiles) {
    const content = await fs.readFile(path.join(memoryDir, fileName), 'utf8');
    if (normalizeForMatch(content).includes('## session')) {
      return content;
    }
  }

  return fs.readFile(path.join(workspacePath, DAILY_MEMORY), 'utf8');
}

test.describe.serial('AI Memory Layer Evaluation', () => {
  test.beforeAll(async ({ window, electronApp, workspacePath }) => {
    await seedCanonicalMemory(workspacePath);

    console.log('\n  [Memory Eval] Opening workspace with canonical memory scaffold...');
    await openFolderViaMenu(electronApp, window, workspacePath);

    console.log('  [Memory Eval] Waiting 30s for indexing pipeline...');
    await window.waitForTimeout(30_000);

    console.log('  [Memory Eval] Opening chat panel...');
    await openChatPanel(window);

    console.log('  [Memory Eval] Waiting for RAG readiness...');
    await waitForRagReady(window);

    console.log('  [Memory Eval] Ready. Running canonical memory layer checks...\n');
  });

  test('uses durable memory for stable preference recall', async ({ window }) => {
    await startNewSession(window);
    await window.waitForTimeout(500);

    const result = await sendAndWaitForResponse(
      window,
      'What durable preference is recorded for technical answers?',
      RESPONSE_TIMEOUT,
    );

    const lower = normalizeForMatch(result.text);
    expect(lower).toContain('structured brevity');
    expect(lower).toContain('precise');
  });

  test('uses daily memory for recent-note recall', async ({ window }) => {
    await startNewSession(window);
    await window.waitForTimeout(500);

    const result = await sendAndWaitForResponse(
      window,
      'What was today\'s migration spike codename from memory?',
      RESPONSE_TIMEOUT,
    );

    expect(normalizeForMatch(result.text)).toContain('ember-rail');
  });

  test('distinguishes durable memory from the daily layer', async ({ window }) => {
    await startNewSession(window);
    await window.waitForTimeout(500);

    const result = await sendAndWaitForResponse(
      window,
      'Which note is a durable preference and which note is only for today?',
      RESPONSE_TIMEOUT,
    );

    const lower = normalizeForMatch(result.text);
    expect(lower.includes('structured brevity') || lower.includes('.parallx/memory/memory.md')).toBe(true);
    expect(lower.includes('ember-rail') || lower.includes('.parallx/memory/2026-03-12.md')).toBe(true);
    expect(lower).toMatch(/durable|long-term/);
    expect(lower).toMatch(/today|daily|temporary/);
  });

  test('answers explicit memory-recall questions from canonical memory layers', async ({ window }) => {
    await startNewSession(window);
    await window.waitForTimeout(500);

    const result = await sendAndWaitForResponse(
      window,
      'What do you remember about today\'s migration spike and my durable answer preference?',
      RESPONSE_TIMEOUT,
    );

    const lower = normalizeForMatch(result.text);
    expect(lower).toContain('ember-rail');
    expect(lower).toContain('structured brevity');
  });

  test('keeps a fresh-session greeting clean and does not surface unrelated memory', async ({ window }) => {
    await startNewSession(window);
    await window.waitForTimeout(500);

    const result = await sendAndWaitForResponse(
      window,
      'hi',
      RESPONSE_TIMEOUT,
    );

    const lower = normalizeForMatch(result.text);
    expect(
      lower.includes('hi')
      || lower.includes('hello')
      || lower.includes('how can i help')
      || lower.includes('what can i help')
      || lower.includes('what would you like'),
    ).toBe(true);
    expect(lower).not.toContain('ember-rail');
    expect(lower).not.toContain('structured brevity');
    expect(lower).not.toContain('daily note');
    expect(lower).not.toContain('durable preference');
    expect(lower).not.toContain('.parallx');
    expect(lower).not.toContain('memory.md');
  });

  test('writes canonical session summaries and preferences back to markdown memory', async ({ window, workspacePath }) => {
    await startNewSession(window);
    await window.waitForTimeout(500);

    await sendAndWaitForResponse(
      window,
      'I prefer structured brevity for technical answers.',
      RESPONSE_TIMEOUT,
    );
    await sendAndWaitForResponse(
      window,
      'Please confirm that preference so you can remember it later.',
      RESPONSE_TIMEOUT,
    );

    await window.waitForTimeout(MEMORY_STORE_WAIT);

    const durableMemory = await fs.readFile(path.join(workspacePath, DURABLE_MEMORY), 'utf8');
    const dailyMemory = await readDailyMemoryWithSessionBlock(workspacePath);

    expect(normalizeForMatch(durableMemory)).toContain('## preferences');
    expect(normalizeForMatch(durableMemory)).toContain('structured brevity for technical answers');
    const normalizedDaily = normalizeForMatch(dailyMemory);
    expect(normalizedDaily).toContain('## session');
    expect(
      normalizedDaily.includes('structured brevity')
      || normalizedDaily.includes('concise')
      || normalizedDaily.includes('technical information')
      || normalizedDaily.includes('structured'),
    ).toBe(true);
  });

  test('reflects direct user edits to canonical memory files after file-based reindex', async ({ window, workspacePath }) => {
    const durablePath = path.join(workspacePath, DURABLE_MEMORY);
    const dailyPath = path.join(workspacePath, MEMORY_DIR, todayFileName());

    await fs.writeFile(
      durablePath,
      [
        '# Durable Memory',
        '',
        '## Preferences',
        '',
        '- answer-style: bullet-first technical summaries',
        '',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      dailyPath,
      [
        '# 2026-03-12',
        '',
        '- Today\'s migration spike codename is amber-switch.',
        '- This is still only a daily note.',
        '',
      ].join('\n'),
      'utf8',
    );

    await window.waitForTimeout(6_000);
    await waitForRagReady(window);

    await startNewSession(window);
    await window.waitForTimeout(500);

    const result = await sendAndWaitForResponse(
      window,
      'What durable answer preference is recorded, and what migration spike codename is recorded in daily memory?',
      RESPONSE_TIMEOUT,
    );

    const lower = normalizeForMatch(result.text);
    expect(lower).toContain('bullet-first');
    expect(lower).toContain('amber-switch');
  });
});