// Read-only audit: run the current extension's actual page scripts against
// synthetic pages in a fresh Chromium context. No app profile is opened.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const source = (await fs.readFile(path.join(repo, 'ext/browser/main.js'), 'utf8')).replace(/\r\n/g, '\n');
const literal = (start, end) => {
  const at = source.indexOf(start);
  assert(at >= 0, start);
  const until = source.indexOf(end, at + start.length);
  assert(until >= 0, end);
  return source.slice(at + start.length, until);
};
const extract = Function(`return ${literal('const AGENT_EXTRACT_JS = ', ';\n/** Read the agent page:')}`)();
const clickCode = Function('i', `return ${literal('clicked = await viewExec(pane, ', ', true);')}`);
const typeCode = Function('i', 'value', 'submit', `return ${literal('label = await viewExec(pane, ', ', true);')}`);
const base = path.join(repo, 'test-results/browser-audit');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'agent-'));
const browser = await chromium.launch({ headless: true });
const findings = {};
try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  await page.setContent('<button id="old">Old action</button><button id="next">Current action</button>');
  await page.evaluate(extract);
  await page.evaluate(() => {
    document.querySelector('#old').style.display = 'none';
    document.querySelectorAll('button').forEach(b => b.onclick = () => { window.clicked = b.id; });
  });
  const current = await page.evaluate(extract);
  await page.evaluate(clickCode(current.buttons[0].i));
  findings.staleReference = { reported: current.buttons[0].text, clicked: await page.evaluate(() => window.clicked) };
  assert.equal(findings.staleReference.clicked, 'old');

  await page.setContent('<a href="#" role="button">Continue</a>');
  const duplicate = await page.evaluate(extract);
  findings.duplicateCategory = { link: duplicate.links[0].i, button: duplicate.buttons[0].i, actual: await page.locator('a').getAttribute('data-px-i') };
  assert.equal(await page.evaluate(clickCode(duplicate.links[0].i)), null);

  await page.setContent('<button>Action</button>');
  await page.evaluate(extract);
  await page.evaluate(() => { window.events = []; for (const type of ['pointerdown', 'mousedown', 'click']) document.querySelector('button').addEventListener(type, e => window.events.push({ type, trusted: e.isTrusted })); });
  await page.evaluate(clickCode(0));
  findings.syntheticClick = await page.evaluate(() => window.events);
  await page.evaluate(() => { window.events = []; });
  await page.getByRole('button').click();
  findings.playwrightClick = await page.evaluate(() => window.events);
  assert.deepEqual(findings.syntheticClick, [{ type: 'click', trusted: false }]);

  await page.setContent('<input type="checkbox" aria-label="Accept"><input type="password" aria-label="Password"><select aria-label="Choice"><option>A</option><option>B</option></select>');
  await page.evaluate(extract);
  await page.evaluate(typeCode(0, JSON.stringify('true'), false));
  await page.evaluate(typeCode(1, JSON.stringify('synthetic-test-value'), false));
  const selectResult = await page.evaluate(typeCode(2, JSON.stringify('Not an option'), false));
  findings.inputSemantics = await page.evaluate(() => ({ checkboxChecked: document.querySelector('[type=checkbox]').checked, passwordAccepted: document.querySelector('[type=password]').value.length > 0, selected: document.querySelector('select').value }));
  findings.inputSemantics.selectReportedSuccess = selectResult !== null;
  assert.equal(findings.inputSemantics.checkboxChecked, false);
  assert.equal(findings.inputSemantics.passwordAccepted, true);

  await page.setContent('<div id="shadow"></div><div contenteditable="true" role="textbox">Rich editor</div><iframe srcdoc="<button>Inside frame</button>"></iframe>');
  await page.evaluate(() => { document.querySelector('#shadow').attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow action</button>'; });
  const scoped = await page.evaluate(extract);
  findings.missingTargets = { buttons: scoped.buttons.length, inputs: scoped.inputs.length };
  assert.deepEqual(findings.missingTargets, { buttons: 0, inputs: 0 });

  await page.setContent('<div style="position:fixed;inset:0;z-index:10;background:white">Blocking overlay</div><button style="position:absolute;top:4000px">Offscreen action</button>');
  findings.offscreenConsideredVisible = (await page.evaluate(extract)).buttons.length === 1;
  assert.equal(findings.offscreenConsideredVisible, true);

  const waitBody = literal('  function waitLoad(timeoutMs) {', '\n  function settleLoad');
  const pane = { _loadWaiters: [] };
  findings.timeoutReportsSuccess = await Function('pane', `return function(timeoutMs) {${waitBody}`)(pane)(10);
  assert.equal(findings.timeoutReportsSuccess, true);
  const popupBody = literal("else if (type === 'open-url') {", "\n    else if (type === 'permission-request')");
  const routePopup = Function('payload', '_panesByWc', 'openTab', `{${popupBody}`);
  routePopup({ url: 'https://fixture.invalid', openerId: 9 }, new Map([[9, { disposed: false, isPrivate: false }]]), (_url, options) => { findings.agentPopupOptions = options; });
  assert.deepEqual(findings.agentPopupOptions, { private: false });
  const result = { verified: true, root, findings, scope: 'Synthetic Chromium pages; actual extension extraction/click/type/wait code. No Electron integration claim.' };
  await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
