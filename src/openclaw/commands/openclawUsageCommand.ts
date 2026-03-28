// D2+D7: /usage command — Show token usage statistics for this session
// Upstream: src/commands/usage.ts — usage/cost reporting
// D7: Extends with timing, model performance, observability service data

import type { IChatParticipantContext, IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';

export async function tryHandleOpenclawUsageCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  context: IChatParticipantContext,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'usage') return false;

  const model = services.getActiveModel?.() ?? 'unknown';
  const contextLength = services.getModelContextLength?.() ?? 0;

  // D7: Prefer observability service data when available
  const obsSvc = services.observabilityService;
  if (obsSvc) {
    const session = obsSvc.getSessionMetrics();
    const modelMetrics = obsSvc.getModelMetrics();
    return renderObservabilityUsage(model, contextLength, session, modelMetrics, response);
  }

  // Fallback: aggregate from history (pre-D7 path)
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let turnCount = 0;

  if (context.history) {
    for (const entry of context.history) {
      if ('response' in entry && entry.response) {
        const resp = entry.response as { promptTokens?: number; completionTokens?: number };
        if (resp.promptTokens != null) totalPromptTokens += resp.promptTokens;
        if (resp.completionTokens != null) totalCompletionTokens += resp.completionTokens;
        turnCount++;
      }
    }
  }

  const totalTokens = totalPromptTokens + totalCompletionTokens;

  const lines: string[] = ['## Session Token Usage\n'];
  lines.push(`**Model:** ${model}`);
  if (contextLength > 0) {
    lines.push(`**Context Window:** ${(contextLength / 1024).toFixed(0)}K tokens\n`);
  }

  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Turns | ${turnCount} |`);
  lines.push(`| Prompt Tokens | ${totalPromptTokens.toLocaleString()} |`);
  lines.push(`| Completion Tokens | ${totalCompletionTokens.toLocaleString()} |`);
  lines.push(`| **Total Tokens** | **${totalTokens.toLocaleString()}** |`);

  if (contextLength > 0 && totalTokens > 0) {
    const usage = (totalTokens / contextLength * 100).toFixed(1);
    lines.push(`| Context Usage | ${usage}% of ${(contextLength / 1024).toFixed(0)}K |`);
  }

  if (turnCount > 0) {
    lines.push(`\n*Average: ${Math.round(totalPromptTokens / turnCount)} prompt + ${Math.round(totalCompletionTokens / turnCount)} completion per turn*`);
  } else {
    lines.push('\n*No turns completed yet in this session.*');
  }

  response.markdown(lines.join('\n'));
  return true;
}

function renderObservabilityUsage(
  model: string,
  contextLength: number,
  session: import('../../services/serviceTypes.js').ISessionMetrics,
  modelMetrics: readonly import('../../services/serviceTypes.js').IModelMetrics[],
  response: IChatResponseStream,
): boolean {
  const lines: string[] = ['## Session Token Usage\n'];
  lines.push(`**Model:** ${model}`);
  if (contextLength > 0) {
    lines.push(`**Context Window:** ${(contextLength / 1024).toFixed(0)}K tokens\n`);
  }

  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Turns | ${session.turnCount} |`);
  lines.push(`| Prompt Tokens | ${session.totalPromptTokens.toLocaleString()} |`);
  lines.push(`| Completion Tokens | ${session.totalCompletionTokens.toLocaleString()} |`);
  lines.push(`| **Total Tokens** | **${session.totalTokens.toLocaleString()}** |`);
  lines.push(`| Total Duration | ${formatDuration(session.totalDurationMs)} |`);
  lines.push(`| Avg Turn Duration | ${formatDuration(session.avgDurationMs)} |`);

  if (contextLength > 0 && session.totalTokens > 0) {
    const usage = (session.totalTokens / contextLength * 100).toFixed(1);
    lines.push(`| Context Usage | ${usage}% of ${(contextLength / 1024).toFixed(0)}K |`);
  }

  if (session.turnCount > 0) {
    lines.push(`\n*Average: ${Math.round(session.avgPromptTokens)} prompt + ${Math.round(session.avgCompletionTokens)} completion per turn*`);
  } else {
    lines.push('\n*No turns completed yet in this session.*');
  }

  // D7: Model performance breakdown (when multiple models used)
  if (modelMetrics.length > 1) {
    lines.push('\n### Model Performance\n');
    lines.push('| Model | Turns | Tokens | Avg Duration |');
    lines.push('|-------|-------|--------|-------------|');
    for (const m of modelMetrics) {
      lines.push(`| ${m.model} | ${m.turnCount} | ${m.totalTokens.toLocaleString()} | ${formatDuration(m.avgDurationMs)} |`);
    }
  }

  response.markdown(lines.join('\n'));
  return true;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
