import fs from 'node:fs/promises';
import path from 'node:path';
import { createRun, launch, prepareCode } from './isolation.mjs';
await prepareCode();
const run = await createRun('boot');
console.log('Owned run:', run.root);
const instance = await launch(run);
try {
  const state = await instance.page.evaluate(async () => {
    const s = window.__parallx_workbench__._services;
    const lm = s.get({ id: 'ILanguageModelsService' });
    const tools = s.get({ id: 'ILanguageModelToolsService' });
    const models = await lm.getModels();
    return { models, providers: lm.getProviders().map(p => p.id), tools: tools.getTools().map(t => ({ name: t.name, parameters: t.parameters })), config: window.__parallx_chat_debug__.getEffectiveConfig() };
  });
  await fs.writeFile(path.join(run.evidence, 'inventory.json'), JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ models: state.models, providers: state.providers, toolCount: state.tools.length }));
} finally { await instance.close(); }
console.log('Isolation boot passed.');
