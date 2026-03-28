// D2: /doctor command — Run diagnostic checks on AI runtime
// Upstream: src/commands/doctor.ts — runtime health diagnostics
// Cross-domain: D3 (Doctor/Diagnostics) will extend these checks

import type { IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';

interface IDiagnosticCheck {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn';
  readonly detail: string;
}

export async function tryHandleOpenclawDoctorCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'doctor') return false;

  response.progress('Running diagnostics...');
  const checks: IDiagnosticCheck[] = [];

  // 1. Provider connection
  const providerStatus = await services.checkProviderStatus?.().catch(() => ({ available: false, error: 'Check failed' } as const));
  const provVersion = providerStatus && 'version' in providerStatus ? providerStatus.version : undefined;
  const provError = providerStatus && 'error' in providerStatus ? providerStatus.error : undefined;
  checks.push({
    name: 'Ollama Connection',
    status: providerStatus?.available ? 'pass' : 'fail',
    detail: providerStatus?.available
      ? `Connected${provVersion ? ` (v${provVersion})` : ''}`
      : provError ?? 'Cannot reach Ollama at localhost:11434',
  });

  // 2. Active model
  const model = services.getActiveModel?.();
  checks.push({
    name: 'Active Model',
    status: model ? 'pass' : 'fail',
    detail: model ?? 'No model selected',
  });

  // 3. Model availability
  if (model && services.listModels) {
    const models = await services.listModels().catch(() => []);
    const found = models.some(m => m.id === model || m.name === model);
    checks.push({
      name: 'Model Available',
      status: found ? 'pass' : 'fail',
      detail: found ? `${model} is installed` : `${model} not found in Ollama (run: ollama pull ${model})`,
    });
  }

  // 4. RAG / Indexing
  const ragAvailable = services.isRAGAvailable?.() ?? false;
  const indexing = services.isIndexing?.() ?? false;
  checks.push({
    name: 'RAG Engine',
    status: ragAvailable ? 'pass' : 'warn',
    detail: ragAvailable
      ? indexing ? 'Available (indexing in progress)' : 'Available and idle'
      : 'Not available — workspace retrieval will be limited',
  });

  // 5. File index
  const fileCount = await services.getFileCount?.().catch(() => 0) ?? 0;
  checks.push({
    name: 'File Index',
    status: fileCount > 0 ? 'pass' : 'warn',
    detail: fileCount > 0 ? `${fileCount} files indexed` : 'No files indexed yet',
  });

  // 6. Bootstrap files
  const workspaceName = services.getWorkspaceName();
  checks.push({
    name: 'Workspace',
    status: workspaceName ? 'pass' : 'warn',
    detail: workspaceName ? `Workspace: ${workspaceName}` : 'No workspace open',
  });

  if (services.existsRelative) {
    const agentsMd = await services.existsRelative('.parallx/AGENTS.md').catch(() => false);
    checks.push({
      name: 'Bootstrap (AGENTS.md)',
      status: agentsMd ? 'pass' : 'warn',
      detail: agentsMd ? 'Found' : 'Missing — run /init to generate',
    });
  }

  // 7. Context window
  const contextLength = services.getModelContextLength?.() ?? 0;
  checks.push({
    name: 'Context Window',
    status: contextLength > 0 ? 'pass' : 'warn',
    detail: contextLength > 0
      ? `${(contextLength / 1024).toFixed(0)}K tokens`
      : 'Unknown (model info unavailable)',
  });

  // 8. Config
  const config = services.unifiedConfigService?.getEffectiveConfig();
  checks.push({
    name: 'Configuration',
    status: config ? 'pass' : 'warn',
    detail: config ? 'Unified config loaded' : 'Using defaults',
  });

  // Render
  const passCount = checks.filter(c => c.status === 'pass').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;

  const lines: string[] = ['## Diagnostic Report\n'];
  const statusIcon = failCount > 0 ? '❌' : warnCount > 0 ? '⚠️' : '✅';
  lines.push(`${statusIcon} **${passCount}** pass, **${failCount}** fail, **${warnCount}** warn\n`);

  lines.push('| Check | Status | Detail |');
  lines.push('|-------|--------|--------|');
  for (const c of checks) {
    const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '⚠️';
    lines.push(`| ${c.name} | ${icon} | ${c.detail} |`);
  }

  if (failCount > 0) {
    lines.push('\n### Recommended Actions');
    for (const c of checks.filter(c => c.status === 'fail')) {
      lines.push(`- **${c.name}:** ${c.detail}`);
    }
  }

  response.markdown(lines.join('\n'));
  return true;
}
