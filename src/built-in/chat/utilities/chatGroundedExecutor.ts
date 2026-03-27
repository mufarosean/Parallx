// chatGroundedExecutor.ts — M14 grounded executor with session guard
//
// Executes grounded (tool-augmented) chat turns while respecting session
// boundaries. Validates the toolGuard before each tool invocation.

import type { IChatTurnExecutionConfig } from './chatTurnExecutionConfig.js';

/**
 * Execute a grounded turn, validating toolGuard.isValid() before each tool call.
 */
export async function executeGroundedTurn(
  config: IChatTurnExecutionConfig,
  invokeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  toolCalls: readonly { name: string; arguments: Record<string, unknown> }[],
): Promise<unknown[]> {
  const { toolGuard } = config;
  const results: unknown[] = [];

  for (const call of toolCalls) {
    if (!toolGuard.isValid()) {
      break;
    }
    const result = await invokeTool(call.name, call.arguments);
    results.push(result);
  }

  return results;
}
