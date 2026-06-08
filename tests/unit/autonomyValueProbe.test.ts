/**
 * LIVE value probe — bypasses the flaky UI entirely. Builds the REAL heartbeat
 * seed (using the production context builders) for a realistic scenario, sends it
 * to the REAL local model (Ollama), and prints what the agent actually says.
 *
 * This isolates the only open question — "given real workspace context, does the
 * model produce something useful?" — from all the e2e UI-automation noise.
 *
 * Run: npx vitest run tests/integration/autonomyValueProbe.test.ts
 * Skips automatically if Ollama isn't reachable.
 */
import { describe, it, expect } from 'vitest';
import { buildWorkspaceContext, buildTasksContext } from '../../src/openclaw/openclawHeartbeatContext';

const OLLAMA = 'http://localhost:11434';
const MODEL = process.env.PROBE_MODEL || 'qwen3.6:latest';

async function ollamaUp(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

// The exact system message the executor sends for a system-event review (verbatim
// from buildSeedSystemMessage), so the model sees the real framing.
const SYSTEM = [
  'You were woken by a heartbeat event (reason: system-event).',
  'This is NOT a user message. It is an internal trigger. The user did not address you and is not waiting for a reply.',
  'The user just did something in the app (see the event below). Decide whether you can genuinely HELP with what they did — connect it to related work, offer an obvious next step, or surface something useful. The goal is to help with their action, NOT to report it back to them.',
  'Event kind: extension-signal.',
  'You have exactly three response modes. Default is IGNORE. Choose only one:',
  '  1. IGNORE — the event is routine and warrants no action. Respond with exactly `NOOP` on its own line and nothing else.',
  '  2. NOTE — the event is mildly noteworthy but does not warrant action. Respond with one line beginning with `NOTE: ` followed by a single short sentence.',
  '  3. ACT — the event clearly warrants investigation or action. Use your tools, then summarize what you did concisely.',
].join('\n');

describe('Autonomy live value probe (real model, real context)', () => {
  it('shows what the agent actually does when a real page is created in a real workspace', async () => {
    if (!(await ollamaUp())) {
      console.log('\n[probe] Ollama not reachable — skipping live probe.\n');
      return;
    }

    // A realistic scenario, built with the PRODUCTION context functions.
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const pages = [
      { title: 'Q3 Planning', updatedAt: new Date(now).toISOString() },
      { title: 'Q3 Budget', updatedAt: new Date(now - DAY).toISOString() },
      { title: 'Q3 Goals', updatedAt: new Date(now - 3 * DAY).toISOString() },
    ];
    const tasks = [
      { title: 'Finalize Q3 budget numbers', dueAt: now + 6 * 60 * 60 * 1000 },
      { title: 'Email the board deck', dueAt: now + 20 * 60 * 60 * 1000 },
      { title: 'Review hiring plan', dueAt: now + 5 * DAY },
      { title: 'Book the team offsite venue', dueAt: null },
    ];

    const userMessage = [
      '[heartbeat system-event]',
      '1 event:',
      '- signal from canvas: created page "Q3 Planning"',
      '',
      'Recent activity: 1 extension-signal.',
      '',
      buildWorkspaceContext(pages),
      '',
      buildTasksContext(tasks, now),
    ].join('\n');

    console.log('\n================ SEED SENT TO THE MODEL ================\n');
    console.log('--- system ---\n' + SYSTEM);
    console.log('\n--- user ---\n' + userMessage);

    let reply: string;
    try {
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          options: { temperature: 0.4 },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: AbortSignal.timeout(110_000),
      });
      const json = await res.json();
      reply = json?.message?.content ?? '(no content)';
    } catch (e) {
      // The model can be slow/busy — this is a diagnostic probe, not a gate, so a
      // timeout or hiccup skips rather than fails. (It does say something honest
      // about a background loop: latency is a real cost.)
      console.log(`\n[probe] model call failed/timed out (${(e as Error).message}) — skipping.\n`);
      return;
    }

    console.log('\n================ THE AGENT\'S ACTUAL RESPONSE ================\n');
    console.log(reply);
    console.log('\n=============================================================\n');

    expect(reply.length).toBeGreaterThan(0);
  }, 130_000);
});
