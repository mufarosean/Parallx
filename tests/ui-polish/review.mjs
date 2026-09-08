import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../test-results/agent-reliability');
const candidates = [];
for (const entry of await fs.readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('ui-panel-flashcards-')) continue;
  const result = await fs.readFile(path.join(root, entry.name, 'evidence/result.json'), 'utf8').then(JSON.parse, () => null);
  if (result?.pass) candidates.push({ name: entry.name, modified: (await fs.stat(path.join(root, entry.name))).mtimeMs });
}
candidates.sort((a,b) => b.modified-a.modified);
if (!candidates.length) throw new Error('Run the UI probe successfully first.');
const after = candidates[0].name;
const before = 'ui-panel-flashcards-1oMLeC';
await fs.access(path.join(root,before,'evidence/decks-dark.png'));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Panel and Flashcards — visual review</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#f4f3ef;color:#252726;font:15px/1.5 system-ui,sans-serif}
main{max-width:1280px;margin:auto}h1{font-size:24px;font-weight:600;margin:0}p{color:#585c59;margin:8px 0 20px}
nav{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:18px 0}button,select{font:inherit;padding:7px 14px;border:1px solid #a4aaa5;background:transparent;border-radius:3px;color:inherit;cursor:pointer}button[aria-pressed=true]{background:#252726;color:white}select{margin-right:auto}img{display:block;width:100%;height:auto;border:1px solid #c4c7c2}a{color:inherit}small{display:block;margin-top:12px;color:#585c59}
</style><main><h1>Panel and Flashcards</h1><p>Actual application captures from fresh test workspaces. Switch between the original and revised screens.</p>
<nav aria-label="Screenshot comparison"><select id="surface" aria-label="Screen"><option value="decks-dark">Deck library</option><option value="panel-output">Output panel</option><option value="study-answer">Revealed answer</option></select><button id="old" aria-pressed="false">Before</button><button id="new" aria-pressed="true">After</button></nav>
<a id="full" target="_blank"><img id="capture" alt="Revised deck library"></a>
<small>The original answer capture is mid-reveal; its off-screen rating controls were also verified in the DOM. Revised captures wait for animations to finish.</small>
<p>Revised sidebar: <a href="${after}/evidence/sidebar-compact.png">compact</a> · <a href="${after}/evidence/sidebar-wide.png">wide</a> · <a href="${after}/evidence/sidebar-light.png">light theme</a>. The original baseline did not capture the sidebar.</p>
<p>Additional checks: <a href="${after}/evidence/decks-light.png">light library</a> · <a href="${after}/evidence/decks-narrow.png">narrow library</a> · <a href="${after}/evidence/study-narrow-scrolled.png">narrow answer and ratings</a> · <a href="${after}/evidence/panel-empty.png">empty output</a></p>
<script>
const surface=document.getElementById('surface'),old=document.getElementById('old'),next=document.getElementById('new'),capture=document.getElementById('capture'),full=document.getElementById('full');let revised=true;
function paint(){const url=(revised?'${after}':'${before}')+'/evidence/'+surface.value+'.png';capture.src=url;capture.alt=(revised?'After: ':'Before: ')+surface.selectedOptions[0].textContent;full.href=url;old.setAttribute('aria-pressed',String(!revised));next.setAttribute('aria-pressed',String(revised));}
old.onclick=()=>{revised=false;paint()};next.onclick=()=>{revised=true;paint()};surface.onchange=paint;paint();
</script></main></html>`;
await fs.writeFile(path.join(root,'ui-review.html'),html);
console.log(JSON.stringify({review:path.join(root,'ui-review.html'),before,after}));
