// run-forge-test.mjs — behavioral test for the Character Forge.
//
// Drives the real Characters surface in jsdom: opens the forge, rolls the
// dice (with a locked control), generates a character, rerolls one field,
// and saves to the roster. Mock mode validates the mechanics with a canned
// JSON card; live mode has the local model actually forge a character and
// writes it into last-forge-report.md for human review.
//
// Usage:
//   node ext/text-generator/test/run-forge-test.mjs --mock
//   node ext/text-generator/test/run-forge-test.mjs [--model <tag>]

import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setupDom, makeFakeParallx, waitFor } from './live-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const MOCK = args.includes('--mock');
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'qwen3.5-uncensored:latest';
const OLLAMA = 'http://localhost:11434';
const REPORT = path.join(__dirname, 'last-forge-report.md');

const results = [];
function record(id, name, ok, detail = '') {
  results.push({ id, name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' — ' + String(detail).split('\n')[0].slice(0, 120) : ''}`);
}

const MOCK_CARD = {
  name: 'Testa Vane',
  description: 'You are Testa Vane, a rain-soaked noir detective who trusts arithmetic more than people. Your pride is your fatal flaw: you would rather bleed than admit a mistake.',
  voiceAnchor: 'Tone: clipped, dry. Signature phrases: "Save it." / "Numbers don\'t lie, people do." Never says: "I\'m sorry" / "I don\'t know."',
  exampleDialogue: '[USER]: Can you help me?\n[AI]: "Depends. Can you pay, or can you only need?"',
  firstMessage: 'The office smells of rain and old case files. "Sit. Talk fast."',
  reminder: 'Testa never apologizes and never admits uncertainty out loud.',
};

function mockReplyFn(messages) {
  const sys = messages.find((m) => m.role === 'system')?.content || '';
  const single = sys.match(/exactly one string key: "(\w+)"/);
  if (single) return JSON.stringify({ [single[1]]: `REROLLED ${single[1]} — a fresh take on the same character.` });
  return JSON.stringify(MOCK_CARD);
}

async function main() {
  const wsDir = path.join(__dirname, `.forge-ws-${Date.now()}`).replace(/\\/g, '/');
  await fsp.mkdir(wsDir, { recursive: true });
  setupDom();
  const { parallx, captured, editorProviders } = makeFakeParallx({
    workspaceDir: wsDir, ollamaUrl: OLLAMA, model: MODEL, mock: MOCK, mockReplyFn, log: console.log,
  });
  const ext = await import(pathToFileURL(path.join(__dirname, '..', 'main.js')));
  ext.activate(parallx, { subscriptions: [] });

  const charDir = path.join(wsDir, '.parallx', 'extensions', 'text-generator', 'characters');
  await waitFor(() => fsp.access(path.join(charDir, 'ada-lovelace.json')).then(() => true, () => false), 10000, 'scaffold');
  await fsp.writeFile(
    path.join(wsDir, '.parallx', 'extensions', 'text-generator', 'settings.json'),
    JSON.stringify({ defaultContextWindow: 8192, userName: 'Anon' }, null, 2),
  );

  const container = document.createElement('div');
  document.body.appendChild(container);
  editorProviders.get('text-generator-characters').createEditorPane(container, { instanceId: 'characters' });
  await waitFor(() => container.querySelector('.tg-cc-row'), 10000, 'rail loaded');
  record('F1', 'characters surface mounts with rail', true);

  container.querySelector('button[title^="Forge"]').click();
  await waitFor(() => container.querySelector('.tg-forge'), 5000, 'forge pane');
  const sliders = [...container.querySelectorAll('.tg-forge-slider')];
  record('F2', 'forge opens with 6 personality dials', sliders.length === 6, `${sliders.length} sliders`);

  // Lock warmth at 77, roll the dice, warmth must survive.
  sliders[0].value = '77';
  sliders[0].dispatchEvent(new window.Event('input'));
  container.querySelector('.tg-forge-lock').click(); // first lock = warmth
  container.querySelector('.tg-forge-dice').click();
  const othersChanged = sliders.slice(1).some((s) => s.value !== '50');
  record('F3', 'dice randomizes unlocked dials', othersChanged, sliders.map((s) => s.value).join(','));
  record('F4', 'locked dial survives the dice', sliders[0].value === '77', `warmth=${sliders[0].value}`);

  // Generate.
  const before = captured.length;
  container.querySelector('.tg-forge-generate').click();
  await waitFor(() => container.querySelectorAll('.tg-forge-field textarea').length >= 6 || container.querySelector('.tg-forge-status--error'), 420000, 'generation result');
  const errEl = container.querySelector('.tg-forge-status--error');
  record('F5', 'generation produced a parsed card', !errEl, errEl ? errEl.textContent : '');
  const genReq = captured[before];
  record('F6', 'request used JSON format + no thinking', genReq?.options?.format === 'json' && genReq?.options?.think === false);
  record('F7', 'prompt carries the dial descriptors', (genReq?.messages?.[1]?.content || '').includes('Personality dials') && (genReq?.messages?.[1]?.content || '').includes('warmth'));

  const fieldAreas = [...container.querySelectorAll('.tg-forge-field textarea')];
  const fieldByLabel = {};
  for (const wrap of container.querySelectorAll('.tg-forge-field')) {
    fieldByLabel[wrap.querySelector('.tg-forge-field-label').textContent] = wrap;
  }
  const values = fieldAreas.map((a) => a.value.trim());
  record('F8', 'all six fields populated', fieldAreas.length === 6 && values.every((v) => v.length > 0));
  const dialogueWrap = [...container.querySelectorAll('.tg-forge-field')].find((w) => w.querySelector('.tg-forge-field-label').textContent.startsWith('Example dialogue'));
  const dialogueVal = dialogueWrap?.querySelector('textarea')?.value || '';
  record('F9', 'example dialogue uses [USER]/[AI] format', dialogueVal.includes('[USER]:') && dialogueVal.includes('[AI]:'), dialogueVal.slice(0, 80));

  // Reroll the voice anchor.
  const anchorWrap = [...container.querySelectorAll('.tg-forge-field')].find((w) => w.querySelector('.tg-forge-field-label').textContent === 'Voice anchor');
  const anchorArea = anchorWrap.querySelector('textarea');
  const anchorBefore = anchorArea.value;
  const beforeReroll = captured.length;
  anchorWrap.querySelector('.tg-forge-reroll').click();
  await waitFor(() => captured.length > beforeReroll && captured[captured.length - 1].endedAt !== null, 420000, 'reroll request');
  await waitFor(() => anchorArea.value !== anchorBefore || MOCK === false, 15000, 'anchor updated').catch(() => {});
  record('F10', 'field reroll issues a single-key request', (captured[beforeReroll]?.messages?.[0]?.content || '').includes('"voiceAnchor"'));
  if (MOCK) record('F11', 'rerolled value replaces the field', anchorArea.value.startsWith('REROLLED voiceAnchor'));

  // Save to roster.
  const saveBtn = [...container.querySelectorAll('.tg-forge-generate')].find((b) => b.textContent.includes('Save to roster'));
  saveBtn.click();
  await waitFor(() => container.querySelector('.tg-ce'), 30000, 'editor opens on saved character');
  const files = (await fsp.readdir(charDir)).filter((f) => f.startsWith('character-') && f.endsWith('.json'));
  record('F12', 'character file saved to roster', files.length === 1, files.join(','));
  const saved = JSON.parse(await fsp.readFile(path.join(charDir, files[0]), 'utf8'));
  record('F13', 'saved card carries voice-first fields', !!saved.name && !!saved.exampleDialogue && !!saved.voiceAnchor && !!saved.initialMessages && saved.initialMessages.startsWith('[AI]:'));
  const railNames = [...container.querySelectorAll('.tg-cc-row-name')].map((e) => e.textContent);
  record('F14', 'new character appears in rail + editor selected', railNames.includes(saved.name));

  // Report (live mode: include the forged character for human review).
  const lines = [
    `# Character Forge — test report`,
    ``,
    `- Date: ${new Date().toISOString()}`,
    `- Mode: ${MOCK ? 'MOCK' : 'LIVE'}  |  Model: ${MODEL}`,
    ``,
    `| # | Check | Result | Detail |`,
    `|---|-------|--------|--------|`,
    ...results.map((r) => `| ${r.id} | ${r.name} | ${r.status} | ${String(r.detail).replace(/\n/g, ' ').replace(/\|/g, '\\|').slice(0, 160)} |`),
    ``,
    `## Forged character`,
    ``,
    `**${saved.name}**`,
    ``,
    `### Description`, '', saved.roleInstruction || '(empty)', '',
    `### Voice anchor`, '', '```', saved.voiceAnchor || '(empty)', '```', '',
    `### Example dialogue`, '', '```', saved.exampleDialogue || '(empty)', '```', '',
    `### First message`, '', '> ' + (saved.initialMessages || '(empty)').replace(/\n/g, '\n> '), '',
    `### Reminder`, '', saved.reminder || '(empty)', '',
  ];
  await fsp.writeFile(REPORT, lines.join('\n'));

  if (!MOCK) {
    try { await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: MODEL, prompt: '', keep_alive: 0 }) }); } catch { /* best effort */ }
  }
  const fails = results.filter((r) => r.status === 'FAIL').length;
  if (fails === 0) { try { await fsp.rm(wsDir, { recursive: true, force: true }); } catch { /* locked */ } }
  console.log(`\nDONE: ${results.filter((r) => r.status === 'PASS').length} pass, ${fails} fail — report: ${REPORT}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
