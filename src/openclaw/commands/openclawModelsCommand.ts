// D2: /models command — List available Ollama models
// Upstream: src/commands/models.ts — model listing and selection

import type { IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';

export async function tryHandleOpenclawModelsCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'models') return false;

  const activeModel = services.getActiveModel?.() ?? 'unknown';

  if (!services.listModels) {
    // Fallback: show available model IDs if listModels delegate isn't wired
    const modelIds = await services.getAvailableModelIds?.().catch(() => []);
    if (modelIds && modelIds.length > 0) {
      const lines = ['## Available Models\n'];
      lines.push(`**Active:** ${activeModel}\n`);
      lines.push('| Model |');
      lines.push('|-------|');
      for (const id of modelIds) {
        const marker = id === activeModel ? ' ← active' : '';
        lines.push(`| ${id}${marker} |`);
      }
      response.markdown(lines.join('\n'));
    } else {
      response.markdown('No models available. Check Ollama connection with `/doctor`.');
    }
    return true;
  }

  const models = await services.listModels().catch(() => []);
  if (models.length === 0) {
    response.markdown('No models found. Make sure Ollama is running and has models pulled.');
    return true;
  }

  const lines = ['## Available Models\n'];
  lines.push(`**Active:** ${activeModel}\n`);
  lines.push('| Model | Size | Quantization | Context |');
  lines.push('|-------|------|-------------|---------|');
  for (const m of models) {
    const marker = m.id === activeModel ? ' **←**' : '';
    const size = m.parameterSize ?? '—';
    const quant = m.quantization ?? '—';
    const ctx = m.contextLength ? `${(m.contextLength / 1024).toFixed(0)}K` : '—';
    lines.push(`| ${m.name}${marker} | ${size} | ${quant} | ${ctx} |`);
  }
  lines.push(`\n*${models.length} model(s) available*`);

  response.markdown(lines.join('\n'));
  return true;
}
