// openclawWorkingTimeLimit.ts — a background turn with a limit on its working time.
//
// A background turn (heartbeat, scheduled job) must not run forever: a stuck
// turn would block every later beat. But time spent waiting for the model
// behind your chat is not work, so it does not count
// (docs/AGENT_RUNTIME_DESIGN.md, "three clocks").

/** Default working-time limit for a heartbeat or scheduled-job turn. */
export const BACKGROUND_TURN_LIMIT_MS = 10 * 60_000;

export interface IWorkingLimitChat {
  sendRequest(sessionId: string, message: string): Promise<unknown>;
  /** Cancel the turn (closes its model request). */
  cancelRequest?(sessionId: string): void;
  /** Time the session spent waiting for the model (engine broker). */
  getWaitingMs?(sessionId: string): number;
}

/**
 * Run one turn; when its working time passes `limitMs`, cancel it, give it a
 * moment to unwind, and throw. Resolves with the turn's own result otherwise.
 */
export async function sendTurnWithWorkingLimit(
  chat: IWorkingLimitChat,
  sessionId: string,
  message: string,
  limitMs: number = BACKGROUND_TURN_LIMIT_MS,
): Promise<unknown> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    const check = () => {
      const used = Date.now() - startedAt - (chat.getWaitingMs?.(sessionId) ?? 0);
      if (used >= limitMs) { resolve('timeout'); return; }
      timer = setTimeout(check, Math.max(250, limitMs - used));
    };
    timer = setTimeout(check, limitMs);
  });
  const turn = chat.sendRequest(sessionId, message);
  try {
    const outcome = await Promise.race([turn.then((r) => ({ r })), timedOut]);
    if (outcome !== 'timeout') return outcome.r;
  } finally {
    if (timer) clearTimeout(timer);
  }
  try { chat.cancelRequest?.(sessionId); } catch { /* best-effort */ }
  await Promise.race([turn.catch(() => undefined), new Promise((r) => setTimeout(r, 5_000))]);
  throw new Error(`The turn ran for ${Math.round(limitMs / 60_000)} minutes of work without finishing and was stopped.`);
}
