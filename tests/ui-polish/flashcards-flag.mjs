import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo = path.resolve(import.meta.dirname,'../..');
const prepared = JSON.parse(await fs.readFile(path.join(repo,'test-results/agent-reliability/ui-prepared.json'),'utf8'));
const codeRoot = process.env.PARALLX_FLAG_CODE_ROOT ?? prepared.codeRoot;
process.env.PARALLX_RELIABILITY_CODE_ROOT = codeRoot;
const {createRun,prepareCode,launch} = await import('../agent-reliability/isolation.mjs');
const run = await createRun('ui-flashcards-flag');
await fs.cp(path.join(codeRoot,'ext/flashcards'),path.join(run.appRoot,'data/extensions/flashcards'),{recursive:true});
await prepareCode();
const instance = await launch(run);
const {app,page} = instance;
page.setDefaultTimeout(5000);
const trace = async event => fs.appendFile(path.join(run.evidence,'clicks.jsonl'),JSON.stringify({at:Date.now(),...event})+'\n');
let fail;
const failure = new Promise((_, reject) => { fail = reject; });
page.on('crash',()=>{void trace({crash:true});fail(new Error('Electron renderer crashed'))});
page.on('pageerror',error=>{void trace({error:String(error)})});
const guard = setTimeout(()=>{void trace({watchdog:true});fail(new Error('Flag probe exceeded 180 seconds'));},180000);
const command=(id,...args)=>page.evaluate(({id,args})=>window.__parallx_workbench__._services.get({id:'ICommandService'}).executeCommand(id,...args),{id,args});
try {
  await Promise.race([failure, (async () => {
  await app.evaluate(async ({BrowserWindow}, evidence)=>{
    const fs = process.getBuiltinModule('fs');
    global.__flagFailures=[];
    const win=BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    win.webContents.on('render-process-gone',(_e,details)=>{
      global.__flagFailures.push(details);
      fs.writeFileSync(evidence,JSON.stringify({details,versions:process.versions},null,2));
    });
    win.on('unresponsive',()=>global.__flagFailures.push({unresponsive:true}));
  }, path.join(run.evidence,'renderer-crash.json'));
  await page.evaluate(()=>window.__parallx_workbench__._services.get({id:'IToolEnablementService'}).setEnablement('parallx-community.flashcards',true));
  await page.reload();
  await page.waitForFunction(()=>window.__parallx_workbench__?._services.get({id:'ICommandService'}).getCommand('flashcards.open'));
  await command('flashcards.open');await page.locator('.fc-home').waitFor();
  await page.evaluate(async()=>{
    const db=window.parallxElectron.extensionDatabase;
    await db.run('flashcards','INSERT INTO fc_decks (id,name,created_at,exam_date) VALUES (1,?,?,0)',['Flag regression fixture',Date.now()]);
    await db.run('flashcards',"INSERT INTO fc_cards (deck_id,front,back,created_at,state,due_at) VALUES (1,?,?,?,'review',?)",['Explain the principle.','A synthetic answer for the flag interaction check.',Date.now(),Date.now()-1000]);
  });
  await command('flashcards.study');
  await page.locator('.fc-study__front').waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,1000));
  // Retain the old disclosure path so saved snapshots can still reproduce
  // the original renderer crash. Current builds expose circles directly.
  const legacy = await page.locator('.fc-study__flagmenu').count() > 0;
  const trigger = legacy ? page.locator('.fc-study__flagmenu > summary') : page.locator('.fc-study__cardactions .fc-flag').first();
  for (let round=0;round<5;round++) {
    for (const region of ['above-trigger','above-swatch','left-padding','right-padding','below-popup','swatch','escape','tab']) {
      await trace({round,region,step:'open'});
      if (legacy && !await page.locator('.fc-study__flagmenu').evaluate(e=>e.open)) await trigger.click();
      const summary=await trigger.boundingBox();
      const popup=await page.locator('.fc-study__cardactions .fc-flags').boundingBox();
      const swatch=await page.locator('.fc-study__cardactions .fc-flag').first().boundingBox();
      await trace({round,region,summary,popup,swatch,step:'click'});
      if (region==='escape') await page.keyboard.press('Escape');
      else if (region==='tab') {await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Escape');}
      else {
        const [x,y]=region==='above-trigger'?[summary.x+summary.width/2,summary.y-2]
          :region==='above-swatch'?[swatch.x+swatch.width/2,swatch.y-3]
          :region==='left-padding'?[popup.x+3,popup.y+popup.height/2]
          :region==='right-padding'?[popup.x+popup.width-3,popup.y+popup.height/2]
          :region==='below-popup'?[popup.x+popup.width/2,popup.y+popup.height+3]
          :[swatch.x+swatch.width/2,swatch.y+swatch.height/2];
        await page.mouse.click(x,y);
      }
      assert(await page.locator('.fc-study__front').isVisible());
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(true))));
      await trace({round,region,step:'responsive'});
    }
  }
  await page.locator('.fc-study__main').focus();
  await page.keyboard.press('Alt+2');
  await page.waitForFunction(async()=>{
    const result=await window.parallxElectron.extensionDatabase.get('flashcards','SELECT flag FROM fc_cards WHERE id = 1',[]);
    return result.row?.flag===2;
  });
  await page.keyboard.press('Alt+2');
  await page.waitForFunction(async()=>{
    const result=await window.parallxElectron.extensionDatabase.get('flashcards','SELECT flag FROM fc_cards WHERE id = 1',[]);
    return result.row?.flag===0;
  });
  await page.getByRole('button',{name:'Show Answer',exact:true}).click();
  await page.locator('.fc-study__back').waitFor();
  assert.deepEqual(await app.evaluate(()=>global.__flagFailures),[]);
  const result={pass:true,root:run.root,codeRoot,checks:['40 pre-reveal flag interactions: padding, outside clicks, selection, Escape and Tab','keyboard flag selection and clearing persist','renderer remains responsive','answer reveal still works']};
  await fs.writeFile(path.join(run.evidence,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  })()]);
} catch(error) {
  await trace({failure:String(error.stack)});
  console.error(run.root);
  throw error;
} finally {clearTimeout(guard);await instance.close();}
