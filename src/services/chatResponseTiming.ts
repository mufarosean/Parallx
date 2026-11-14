// chatResponseTiming.ts — what an answer cost in time, and how fast the model wrote it.
//
// Two sources, kept apart so neither is passed off as the other:
//
// - The app's own clock: when the first word arrived and when the answer was
//   finished. True for every model, local or cloud.
// - What the engine reports at the end of each model call: how many tokens it
//   wrote and how long writing them took, how much prompt it read and how
//   long that took, and how long it spent loading the model first. Ollama
//   reports all of it; a provider that reports no durations gives no speed,
//   and none is made up from the app's clock.
//
// An answer can take several model calls (one, plus one for each round of
// tool use), so the engine's figures are summed over the answer's calls.

/** What an engine reports on the final chunk of one call. Durations are nanoseconds, as Ollama gives them. */
export interface IModelCallTiming {
  /** Tokens in the prompt the engine read. */
  readonly promptEvalCount?: number;
  /** Time it spent reading them. */
  readonly promptEvalDuration?: number;
  /** Tokens it wrote, reasoning included. */
  readonly evalCount?: number;
  /** Time it spent writing them. */
  readonly evalDuration?: number;
  /** Time it spent loading the model before it could start. */
  readonly loadDuration?: number;
}

/** An answer's times (epoch ms) and its calls' engine figures, summed (ms and tokens). */
export interface IChatResponseTiming {
  /** When the first word of the answer or of its reasoning arrived. */
  firstWordAt?: number;
  /** When the answer was finished. */
  completedAt?: number;
  /** Model calls that reported anything. */
  calls?: number;
  /** Tokens written, reasoning included. */
  writtenTokens?: number;
  /** The written tokens whose writing time is known, and that time: the two the speed is made of. */
  timedTokens?: number;
  writingMs?: number;
  /** Prompt tokens read, and the time reading took. */
  readTokens?: number;
  readingMs?: number;
  /** Time spent loading the model. */
  loadingMs?: number;
}

interface ITimed { timing?: IChatResponseTiming; }

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const ms = (nanoseconds: number): number => Math.round(nanoseconds / 1e6);

function timingOf(response: ITimed): IChatResponseTiming {
  if (!response.timing) response.timing = {};
  return response.timing;
}

/** The first word has arrived: stamped once, the first time it is called. */
export function noteFirstWord(response: ITimed, now: number = Date.now()): void {
  if (response.timing?.firstWordAt === undefined) timingOf(response).firstWordAt = now;
}

/** The answer is finished. */
export function noteCompleted(response: ITimed, now: number = Date.now()): void {
  timingOf(response).completedAt = now;
}

/** Add what the engine reported for one model call. A call that reported nothing adds nothing. */
export function noteModelCall(response: ITimed, call: IModelCallTiming): void {
  const wrote = positive(call.evalCount), read = positive(call.promptEvalCount), loaded = positive(call.loadDuration);
  if (!wrote && !read && !loaded) return;
  const t = timingOf(response);
  t.calls = (t.calls ?? 0) + 1;
  if (positive(call.evalCount)) {
    t.writtenTokens = (t.writtenTokens ?? 0) + call.evalCount;
    if (positive(call.evalDuration)) {
      t.timedTokens = (t.timedTokens ?? 0) + call.evalCount;
      t.writingMs = (t.writingMs ?? 0) + ms(call.evalDuration);
    }
  }
  if (positive(call.promptEvalCount)) {
    t.readTokens = (t.readTokens ?? 0) + call.promptEvalCount;
    if (positive(call.promptEvalDuration)) t.readingMs = (t.readingMs ?? 0) + ms(call.promptEvalDuration);
  }
  if (positive(call.loadDuration)) t.loadingMs = (t.loadingMs ?? 0) + ms(call.loadDuration);
}

/** Tokens a second over the answer's calls, from the engine's own figures; undefined when it reported no writing time. */
export function tokensPerSecond(timing: IChatResponseTiming | undefined): number | undefined {
  if (!timing || !positive(timing.timedTokens) || !positive(timing.writingMs)) return undefined;
  return timing.timedTokens / (timing.writingMs / 1000);
}

const FIELDS: readonly (keyof IChatResponseTiming)[] = ['firstWordAt', 'completedAt', 'calls', 'writtenTokens', 'timedTokens', 'writingMs', 'readTokens', 'readingMs', 'loadingMs'];

/** A timing as it is kept with its answer; undefined when there is nothing to keep. */
export function serializeTiming(timing: IChatResponseTiming | undefined): string | null {
  if (!timing) return null;
  const out: Record<string, number> = {};
  for (const key of FIELDS) { const v = timing[key]; if (positive(v)) out[key] = v; }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** A kept timing read back. Anything that is not a positive number is dropped; nothing left is undefined. */
export function parseTiming(stored: unknown): IChatResponseTiming | undefined {
  if (typeof stored !== 'string' || !stored) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(stored); } catch { return undefined; }
  if (!raw || typeof raw !== 'object') return undefined;
  const out: IChatResponseTiming = {};
  for (const key of FIELDS) { const v = (raw as Record<string, unknown>)[key]; if (positive(v)) out[key] = v; }
  return Object.keys(out).length ? out : undefined;
}
