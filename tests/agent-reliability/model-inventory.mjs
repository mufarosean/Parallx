import fs from 'node:fs/promises';
import path from 'node:path';
import { createRun, launch, prepareCode } from './isolation.mjs';
await prepareCode();
const run = await createRun('model-inventory', 'metadata-only');
const instance = await launch(run);
try {
  // Observe the existing provider's metadata request to retain the digest that
  // ILanguageModelInfo deliberately omits. All discovery uses its public API.
  const response = instance.page.waitForResponse(r => new URL(r.url()).pathname === '/api/tags', { timeout: 15000 });
  const models = await instance.page.evaluate(async () => {
    const lm = window.__parallx_workbench__._services.get({ id: 'ILanguageModelsService' });
    return lm.getProviders().find(p => p.id === 'ollama').listModels();
  });
  const tags = await (await response).json();
  await fs.writeFile(path.join(run.evidence, 'ollama-models.json'), JSON.stringify({ models, tags }, null, 2));
  console.log(run.root);
  console.log(tags.models.map(m => ({ name: m.name, digest: m.digest })));
} finally { await instance.close(); }
