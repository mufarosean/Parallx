import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Real chat renderer + stylesheet in a fresh browser context; no app profile,
// workspace database, model, or network access is needed for layout checks.
const repo = path.resolve(import.meta.dirname, '../..');
const artifacts = path.join(repo, 'test-results/ui-polish');
await fs.mkdir(artifacts, {recursive:true});
const root = await fs.mkdtemp(path.join(artifacts, 'chat-tables-'));
const cssPath = 'src/built-in/chat/widgets/chatWidget.css';
const css = await fs.readFile(path.join(repo, cssPath), 'utf8');
const baseline = execFileSync('git', ['show', `HEAD:${cssPath}`], {cwd:repo, encoding:'utf8', windowsHide:true});
await build({
  stdin: {contents: `import {renderContentPart} from './src/built-in/chat/rendering/chatContentParts.ts'; window.renderChatFixture = content => document.querySelector('main').replaceChildren(renderContentPart({kind:'markdown',content}));`, resolveDir:repo},
  outfile:path.join(root,'renderer.js'), bundle:true, format:'iife', platform:'browser',
  loader:{'.css':'empty'},
});
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext({viewport:{width:1000,height:740}});
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#151618;font:13px "Segoe UI",sans-serif}main{width:920px;min-width:0}</style><style id="chat-css"></style></head><body><main></main></body></html>');
  await page.addScriptTag({path:path.join(root,'renderer.js')});
  const comparison = [
    '**Primary insurer vs. reinsurer**', '',
    '| | Primary insurer | Reinsurer |',
    '| --- | --- | --- |',
    '| Splits by | Personal vs. commercial; jurisdiction; sub-coverage (BI/PD, PIP/AB, collision/comprehensive) | Personal vs. commercial; treaty vs. facultative; pro rata vs. excess |',
    '| Does NOT split by | — | Sub-coverage, jurisdiction |',
    '| Excess layer split | By policy limit (e.g. ≤1M, ≤2.5M) | By attachment point and contract structure |', '',
    'The complete comparison should be readable without moving the table sideways.',
  ].join('\n');
  const render = content => page.evaluate(content => window.renderChatFixture(content), content);
  const setCss = value => page.locator('#chat-css').evaluate((e,value) => {e.textContent=value},value);
  const dimensions = () => page.locator('table').evaluate(e => ({width:e.clientWidth, scroll:e.scrollWidth, documentOverflow:document.documentElement.scrollWidth > innerWidth}));
  const fits = async label => {
    const size = await dimensions();
    assert(size.scroll <= size.width + 1, `${label}: table overflows ${JSON.stringify(size)}`);
    assert(!size.documentOverflow, `${label}: conversation overflows`);
  };
  await setCss(baseline);
  await render(comparison);
  const before = await dimensions();
  await page.screenshot({path:path.join(root,'before.png')});
  await setCss(css);
  await fits('wide comparison');
  await page.screenshot({path:path.join(root,'after-wide.png')});
  await page.setViewportSize({width:368,height:800});
  await page.locator('main').evaluate(e => {e.style.width='320px'});
  await fits('narrow comparison');
  await page.screenshot({path:path.join(root,'after-narrow.png'),fullPage:true});

  await render('| Identifier | Meaning |\n| --- | --- |\n| `a_very_long_unbroken_identifier_' + 'x'.repeat(120) + '` | This identifier must wrap without losing any characters. |');
  await fits('unbroken inline code');
  assert((await page.locator('code').innerText()).endsWith('x'.repeat(120)));
  await render('| Year | Loss | Share |\n| :--- | ---: | :---: |\n| 2024 | 1,234.56 | 25% |\n| 2025 | 987.65 | 75% |');
  await fits('numeric table');
  const alignment = await page.locator('tbody tr').first().locator('td').evaluateAll(cells => cells.map(e => getComputedStyle(e).textAlign));
  assert.deepEqual(alignment,['left','right','center']);

  const cols = Array.from({length:12},(_,i) => `Period ${i+1}`);
  await render(`| ${cols.join(' | ')} |\n| ${cols.map(()=>'---:').join(' | ')} |\n| ${cols.map(()=> '1,234.56').join(' | ')} |`);
  const wide = await dimensions();
  assert(wide.scroll > wide.width && !wide.documentOverflow, 'Many columns should scroll inside the table');
  await page.locator('table').evaluate(e => {e.scrollLeft=e.scrollWidth});
  assert(await page.locator('table').evaluate(e => e.querySelector('tr').lastElementChild.getBoundingClientRect().right <= e.getBoundingClientRect().right + 1), 'Final column is unreachable');
  const result = {pass:true, root, baselineOverflow:before.scroll > before.width, checks:['wide and narrow prose tables fit', 'long inline code wraps without loss', 'explicit numeric alignment preserved', 'many columns remain locally scrollable']};
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close();}
