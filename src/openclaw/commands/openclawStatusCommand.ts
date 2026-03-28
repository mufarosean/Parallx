// D2: /status command — Show AI runtime status (model, connection, budget)
// Upstream: src/commands/status.ts — runtime status reporting

import type { IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';

export async function tryHandleOpenclawStatusCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'status') return false;

  const model = services.getActiveModel?.() ?? 'unknown';
  const contextLength = services.getModelContextLength?.() ?? 0;
  const ragAvailable = services.isRAGAvailable?.() ?? false;
  const indexing = services.isIndexing?.() ?? false;
  const providerStatus = await services.checkProviderStatus?.().catch(() => ({ available: false, error: 'Check failed' } as const));
  const config = services.unifiedConfigService?.getEffectiveConfig();

  const lines: string[] = ['## AI Runtime Status\n'];

  // Connection
  lines.push('### Connection');
  if (providerStatus) {
    lines.push(`- **Provider:** Ollama ${providerStatus.available ? '✅ Connected' : '❌ Disconnected'}`);
    if ('version' in providerStatus && providerStatus.version) lines.push(`- **Version:** ${providerStatus.version}`);
    if ('error' in providerStatus && providerStatus.error) lines.push(`- **Error:** ${providerStatus.error}`);
  } else {
    lines.push('- **Provider:** Ollama (status check unavailable)');
  }

  // Model
  lines.push('\n### Model');
  lines.push(`- **Active Model:** ${model}`);
  if (contextLength > 0) {
    lines.push(`- **Context Window:** ${(contextLength / 1024).toFixed(1)}K tokens`);
  }
  if (config?.model) {
    lines.push(`- **Temperature:** ${config.model.temperature}`);
    if (config.model.maxTokens > 0) lines.push(`- **Max Tokens:** ${config.model.maxTokens}`);
  }

  // RAG & Indexing
  lines.push('\n### Retrieval');
  lines.push(`- **RAG:** ${ragAvailable ? '✅ Available' : '❌ Not available'}`);
  lines.push(`- **Indexing:** ${indexing ? '🔄 In progress' : '✅ Idle'}`);
  const fileCount = await services.getFileCount?.().catch(() => 0) ?? 0;
  if (fileCount > 0) lines.push(`- **Indexed Files:** ${fileCount}`);

  // Agent Config
  if (config?.agent) {
    lines.push('\n### Agent');
    lines.push(`- **Max Iterations:** ${config.agent.maxIterations}`);
  }

  response.markdown(lines.join('\n'));
  return true;
}
