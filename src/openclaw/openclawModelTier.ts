/**
 * Model tier resolution for conditional prompt guidance.
 *
 * Upstream evidence: buildAgentSystemPrompt adjusts sections based on model
 * capabilities. Parallx local models are parameter-size-named (qwen2.5:7b,
 * llama3:70b), so pattern matching is the simplest reliable approach.
 */

export type ModelTier = 'small' | 'medium' | 'large';

/**
 * Resolve model tier from model name via parameter-size pattern matching.
 *
 * Pattern: extract the numeric parameter size from the model name string
 * (e.g. "qwen2.5:7b-instruct" → 7, "llama3:70b" → 70, "gpt-oss:20b" → 20).
 */
export function resolveModelTier(modelName: string): ModelTier {
  const match = modelName.match(/(\d+)[bB]/);
  if (!match) { return 'medium'; }
  const params = parseInt(match[1], 10);
  if (params <= 8) { return 'small'; }
  if (params <= 32) { return 'medium'; }
  return 'large';
}
