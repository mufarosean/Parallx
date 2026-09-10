import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const repo = path.resolve(import.meta.dirname,'../..');
const artifacts = path.join(repo,'test-results/ui-polish');
await fs.mkdir(artifacts,{recursive:true});
const root = await fs.mkdtemp(path.join(artifacts,'timer-budget-'));
await build({stdin:{resolveDir:repo,contents:`
import {TIMER_WIDGET} from './src/built-in/dashboard/widgets/timerWidget.ts';
window.saved=null;window.eventReads=0;
window.handle=TIMER_WIDGET.createWidget(document.querySelector('main'),{
  config:{...TIMER_WIDGET.defaultConfig,alarm:'none'},
  cachedOutput:JSON.stringify({tasks:[{id:'a',title:'Study Friedland',est:1,act:0,done:false,createdAt:0,budgetMinutes:120,spentMinutes:0},{id:'b',title:'Review flashcards',est:1,act:0,done:false,createdAt:0,budgetMinutes:30,spentMinutes:0}],activeTaskId:'a'}),
  api:{commands:{executeCommand:async()=>({data:{
    listTasks:async()=>[{id:'clark',title:'Read Clark: development curves',status:'planned',dueAt:null},{id:'brosius',title:'Study Brosius',status:'planned',dueAt:Date.now()}],
    listEvents:async()=>{window.eventReads++;return[{id:'meeting',title:'Unrelated calendar meeting'}]},updateTask:async()=>{}
  }})}},
  setCachedOutput:value=>{window.saved=value;window.handle?.refreshFromCache(value)},
  onDidChangeConfig:()=>({dispose(){}})
});`},bundle:true,format:'iife',platform:'browser',outfile:path.join(root,'timer.js')});
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext({viewport:{width:500,height:332}});
  await context.route('**/*',route=>route.abort());
  const page = await context.newPage();
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><main></main></body></html>');
  for (const file of ['src/theme/px-tokens.css','src/built-in/dashboard/dashboard.css']) await page.addStyleTag({content:await fs.readFile(path.join(repo,file),'utf8')});
  await page.addStyleTag({content:'body{margin:0;padding:16px;background:var(--px-bg);color:var(--px-text);font-family:var(--px-font-ui);font-size:var(--px-text-base)}main{width:468px;height:300px}'});
  await page.addScriptTag({path:path.join(root,'timer.js')});
  assert(await page.locator('.dtimer__budget').isHidden());
  await page.screenshot({path:path.join(root,'task-budget.png')});
  await page.getByRole('button',{name:'Start',exact:true}).click();
  assert(await page.locator('.dtimer__budget').isHidden());
  await page.screenshot({path:path.join(root,'running.png')});
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.getByRole('button',{name:'Choose tasks',exact:true}).click();
  await page.getByRole('searchbox').fill('clark');
  assert.equal(await page.locator('.dtimer__pickrow:visible').count(),1);
  await page.getByRole('searchbox').fill('no match');
  assert(await page.getByText('No matching tasks.').isVisible());
  await page.getByRole('searchbox').fill('');
  await page.screenshot({path:path.join(root,'planner-tasks.png')});
  assert.equal(await page.evaluate(()=>window.eventReads),0);
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button',{name:'Add Selected',exact:true}).click();
  await page.getByRole('button',{name:'Read Clark: development curves',exact:true}).click();
  await page.getByRole('button',{name:'Time budget for Read Clark: development curves',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Task time budget in minutes',exact:true}).fill('45');
  await page.screenshot({path:path.join(root,'edit-budget.png')});
  await page.getByRole('button',{name:'Set',exact:true}).click();
  assert(await page.locator('.dtimer__budget').isHidden());
  assert.equal(await page.evaluate(()=>JSON.parse(window.saved).tasks.find(t=>t.sourceId==='clark').budgetMinutes),45);
  await page.setViewportSize({width:352,height:332});
  await page.locator('main').evaluate(e=>{e.style.width='320px';e.style.height='300px'});
  assert(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth),'Narrow widget overflows horizontally');
  await page.screenshot({path:path.join(root,'narrow.png')});
  await page.evaluate(()=>document.documentElement.setAttribute('data-px-mode','light'));
  await page.screenshot({path:path.join(root,'light.png')});
  console.log(JSON.stringify({pass:true,root}));
} finally {await browser.close();}
