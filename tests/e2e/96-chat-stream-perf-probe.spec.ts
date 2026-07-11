// Diagnostic perf probe — streams a long, paced, math-heavy response through
// the REAL provider path (hermetic local ndjson server; no real Ollama is
// ever touched) while CPU-profiling the renderer, and reports main-thread
// health: rAF gap distribution, long-task time, and top functions by self
// time. Guards against "the whole app freezes while AI streams" regressions.
//
// Read PERF-GAPS in the output: maxGap is the longest main-thread stall in ms
// during the stream; gapsOver200 > 0 means user-visible freezes came back.
import { test, createTestWorkspace, cleanupTestWorkspace, openFolderViaMenu } from './fixtures';
import type { Page } from '@playwright/test';
import http from 'http';
import type { AddressInfo } from 'net';

const MOCK_CHAT_MODEL = 'gpt-oss:20b';
const MOCK_CHAT_FAMILY = 'gptoss';

// ── Math-heavy content, streamed in small chunks like a fast cloud model ──
const SECTION = [
  '## Mack variance, maturity $k$',
  '',
  'The factor $\\hat{f}_k = \\frac{\\sum_i C_{i,k+1}}{\\sum_i C_{i,k}}$ with variance:',
  '',
  '$$\\hat{\\sigma}_k^2 = \\frac{1}{n-k-1} \\sum_{i=1}^{n-k} C_{i,k} \\left( \\frac{C_{i,k+1}}{C_{i,k}} - \\hat{f}_k \\right)^2$$',
  '',
  '- The **process variance** term grows with $\\hat{C}_{i,n}$',
  '- The estimation error uses $\\frac{1}{\\hat{C}_{i,k}} + \\frac{1}{\\sum_j C_{j,k}}$',
  '',
].join('\n');
const FULL_TEXT = Array(14).fill(SECTION).join('\n');

function startStreamServer(chunkSize: number, delayMs: number): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': '*',
          'Access-Control-Allow-Headers': '*',
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Access-Control-Allow-Origin': '*',
      });
      let offset = 0;
      const timer = setInterval(() => {
        if (offset >= FULL_TEXT.length) {
          clearInterval(timer);
          res.write(JSON.stringify({
            message: { role: 'assistant', content: '' },
            done: true, prompt_eval_count: 500, eval_count: 2000, eval_duration: 1_000_000_000,
          }) + '\n');
          res.end();
          return;
        }
        const chunk = FULL_TEXT.slice(offset, offset + chunkSize);
        offset += chunkSize;
        res.write(JSON.stringify({ message: { role: 'assistant', content: chunk }, done: false }) + '\n');
      }, delayMs);
      req.on('close', () => clearInterval(timer));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function routeOllama(page: Page, streamUrl: string): Promise<void> {
  // Redirect the provider's chat request to the paced local server. The
  // server must send CORS headers — this is a real cross-origin fetch from
  // the renderer, unlike route.fulfill which bypasses CORS.
  await page.route('**/api/chat', (route) => route.continue({ url: `${streamUrl}/api/chat` }));
  await page.route('**/api/tags', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ models: [{ name: MOCK_CHAT_MODEL, model: MOCK_CHAT_MODEL, modified_at: '2026-01-01T00:00:00Z', size: 1_000_000_000, digest: 'abc123', details: { family: MOCK_CHAT_FAMILY, parameter_size: '20B', quantization_level: 'Q4_K_M' } }] }),
  }));
  await page.route('**/api/version', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '0.5.0' }) }));
  await page.route('**/api/show', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ model_info: { 'mock.context_length': 32768 } }) }));
  await page.route('**/api/ps', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) }));
}

test('profile renderer main thread during a paced stream', async ({ electronApp, window }) => {
  test.setTimeout(240_000);
  const ws = await createTestWorkspace();
  const server = await startStreamServer(48, 6); // ~8 chunks/frame worth of text at ~166 chunks/s

  try {
    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log('APP-ERROR', msg.text().slice(0, 300));
      }
    });

    // Route ALL Ollama endpoints FIRST — before the workspace opens and the
    // provider probes /api/tags — so no request from the app ever reaches a
    // real local Ollama instance.
    await routeOllama(window, server.url);

    await openFolderViaMenu(electronApp, window, ws, { force: true });

    const chatWidget = window.locator('.parallx-chat-widget');
    if (!await chatWidget.isVisible().catch(() => false)) {
      await window.keyboard.press('Control+Shift+I');
      await chatWidget.waitFor({ state: 'visible', timeout: 10_000 });
    }

    // Give the provider connection time to come up before prompting —
    // sending while the connection is still warming just fails.
    await window.waitForTimeout(4000);
    const newChatBtn = window.locator('.parallx-chat-title-action--new');
    if (await newChatBtn.isVisible().catch(() => false)) {
      await newChatBtn.click();
      await window.waitForTimeout(800);
    }

    // rAF-gap + longtask watchdog
    await window.evaluate(() => {
      const w = window as any;
      w.__perfGaps = { maxGap: 0, gapsOver50: 0, gapsOver200: 0, longTaskMs: 0, longTasks: 0 };
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        const gap = now - last;
        last = now;
        if (gap > w.__perfGaps.maxGap) w.__perfGaps.maxGap = gap;
        if (gap > 50) w.__perfGaps.gapsOver50++;
        if (gap > 200) w.__perfGaps.gapsOver200++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__perfGaps.longTaskMs += e.duration;
            w.__perfGaps.longTasks++;
          }
        }).observe({ entryTypes: ['longtask'] });
      } catch { /* longtask unsupported */ }
    });

    // CPU profile via CDP
    const cdp = await electronApp.context().newCDPSession(window);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');

    // Send the message through the real input
    const textarea = window.locator('.parallx-chat-input-textarea');
    await textarea.waitFor({ state: 'visible', timeout: 5_000 });
    await textarea.click({ force: true });
    await textarea.fill('explain mack variance');
    await window.keyboard.press('Enter');

    // The user bubble must appear or the send itself failed — fail fast.
    await window.locator('.parallx-chat-message--user').last().waitFor({ state: 'visible', timeout: 8_000 });

    // Wait for stream completion (content arrived, then cursor gone)
    try {
      await window.waitForFunction(
        () => !document.querySelector('.parallx-chat-streaming-cursor')
          && (document.querySelector('.parallx-chat-message--assistant .parallx-chat-markdown')?.textContent?.length ?? 0) > 500,
        undefined,
        { timeout: 60_000 },
      );
    } catch (err) {
      const state = await window.evaluate(() => {
        const body = document.querySelector('.parallx-chat-message--assistant .parallx-chat-message-body');
        return {
          partClasses: body ? [...body.children].map((c) => c.className).slice(0, 12) : null,
          text: (body?.textContent ?? '').slice(0, 400),
        };
      });
      console.log('TIMEOUT-STATE ' + JSON.stringify(state, null, 1));
      throw err;
    }

    const { profile } = await cdp.send('Profiler.stop');
    const gaps = await window.evaluate(() => (window as any).__perfGaps);
    console.log('PERF-GAPS ' + JSON.stringify(gaps));

    // Aggregate self time per function
    const nodeById = new Map<number, any>();
    for (const n of profile.nodes) nodeById.set(n.id, n);
    const selfMs = new Map<number, number>();
    const samples = profile.samples ?? [];
    const deltas = profile.timeDeltas ?? [];
    for (let i = 0; i < samples.length; i++) {
      const dt = (deltas[i] ?? 0) / 1000;
      selfMs.set(samples[i], (selfMs.get(samples[i]) ?? 0) + dt);
    }
    const rows = [...selfMs.entries()]
      .map(([id, ms]) => {
        const cf = nodeById.get(id)?.callFrame;
        return { ms: Math.round(ms), fn: cf?.functionName || '(anon)', url: (cf?.url || '').split('/').slice(-2).join('/'), line: cf?.lineNumber };
      })
      .filter((r) => r.ms >= 5 && r.fn !== '(idle)' && r.fn !== '(program)' && r.fn !== '(root)' && r.fn !== '(garbage collector)')
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 25);
    console.log('PERF-TOP ' + JSON.stringify(rows, null, 1));
  } finally {
    server.close();
    await cleanupTestWorkspace(ws);
  }
});
