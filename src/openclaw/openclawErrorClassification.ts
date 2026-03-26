/**
 * Error classification for the OpenClaw execution pipeline.
 *
 * Upstream evidence:
 *   - agent-runner-execution.ts — isContextOverflowError used in retry logic
 *   - agent-runner-execution.ts — transient HTTP detection (ECONNREFUSED, etc.)
 *   - Ollama API docs — error response patterns for context overflow, timeout
 *
 * These classifiers drive the retry loop in the turn runner:
 *   - Context overflow → compact → re-assemble → retry (max 3)
 *   - Timeout → force compact → retry (max 2)
 *   - Transient → delay 2500ms → retry
 *   - All other errors → propagate immediately
 */

// ---------------------------------------------------------------------------
// Error message extraction
// ---------------------------------------------------------------------------

/**
 * Extract a string error message from any thrown value.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

// ---------------------------------------------------------------------------
// Error classifiers
// ---------------------------------------------------------------------------

/**
 * Detect context overflow errors from Ollama.
 *
 * Upstream: agent-runner-execution.ts — isContextOverflowError
 * Ollama returns HTTP 400 with "context length exceeded" or similar.
 */
export function isContextOverflow(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return (
    msg.includes('context length') ||
    msg.includes('too many tokens') ||
    msg.includes('context window') ||
    msg.includes('maximum context')
  );
}

/**
 * Detect transient network/server errors from Ollama.
 *
 * Upstream: agent-runner-execution.ts — transient retry with 2500ms delay
 * Covers: Ollama restart, connection drop, temporary overload.
 */
export function isTransientError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return /econnrefused|etimedout|econnreset|enotfound|503|502|epipe/.test(msg);
}

/**
 * Detect timeout errors.
 *
 * Upstream: run.ts — MAX_TIMEOUT_COMPACTION_ATTEMPTS = 2
 * Ollama can timeout on large context or slow models.
 */
export function isTimeoutError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return msg.includes('timeout') || msg.includes('deadline') || msg.includes('aborted');
}
