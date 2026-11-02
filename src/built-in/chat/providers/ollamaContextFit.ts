// ollamaContextFit.ts — the context size that fits a model on the card, from
// Ollama's own numbers, never from a guess or a number typed in.
//
// Ollama's /api/ps reports, for a loaded model, the memory it takes at the
// size it was loaded at (`size`) and how much of that sits in graphics
// memory (`size_vram`); /api/tags reports the weights on disk. A model
// loaded with less on the card than it takes has spilled into system
// memory, and a turn then takes minutes. From those three numbers the
// largest context that fits follows: the weights do not shrink, the
// context cache grows in proportion to the context, and the card holds
// what it held. A size the user names is never changed by this; only a
// size the app chose on its own (Auto) is measured and corrected.

export interface IContextFitInput {
  /** The context the model was loaded at. */
  readonly contextLength: number;
  /** Memory the loaded model takes at that context (/api/ps size). */
  readonly totalBytes: number;
  /** Of that, what sits in graphics memory (/api/ps size_vram). */
  readonly onCardBytes: number;
  /** The weights on disk (/api/tags size), when known. */
  readonly weightBytes?: number;
}

/** A load with at least this share on the card counts as fitting. */
export const ON_CARD_FIT_SHARE = 0.99;
/** The fit keeps this share of what the card held, as room for the batch and the draft. */
const FIT_SAFETY = 0.9;
/** Context sizes are rounded down to this. */
const FIT_STEP = 1024;
/** No fit goes below this. */
export const FIT_FLOOR = 2048;

/**
 * The largest context that fits on the card, from one load's numbers. The
 * loaded size itself when the load sat on the card.
 */
export function fitContext(input: IContextFitInput): number {
  const { contextLength, totalBytes, onCardBytes } = input;
  if (!(contextLength > 0) || !(totalBytes > 0)) return contextLength;
  if (onCardBytes >= totalBytes * ON_CARD_FIT_SHARE) return contextLength;
  const weights = input.weightBytes && input.weightBytes > 0 && input.weightBytes < totalBytes ? input.weightBytes : 0;
  // Bytes per token of context: everything that is not weights, over the context.
  const perToken = (totalBytes - weights) / contextLength;
  const room = onCardBytes * FIT_SAFETY - weights;
  const raw = perToken > 0 ? Math.floor(room / perToken) : 0;
  return Math.max(FIT_FLOOR, Math.floor(raw / FIT_STEP) * FIT_STEP);
}

export interface IContextFitWatch {
  /** The size that fits, once a spilled load was seen; 0 until then. */
  readonly refit: number;
  /** Aborts the attempt that spilled, so it can be sent again at `refit`. */
  readonly signal: AbortSignal;
  stop(): void;
}

export interface IPsModel { readonly name: string; readonly size: number; readonly size_vram?: number; readonly context_length?: number }

export interface IContextFitWatchOptions {
  readonly modelId: string;
  /** The size the attempt was sent at. */
  readonly contextLength: number;
  readonly weightBytes?: number;
  /** Reads /api/ps. */
  readonly ps: () => Promise<{ readonly models: readonly IPsModel[] }>;
  readonly pollMs: number;
  readonly maxMs: number;
  /** The size that fits, learned: the loaded size itself when it sat on the card, or the computed fit. */
  readonly onFit: (numCtx: number) => void;
}

/**
 * Watches a load the app sized on its own. When /api/ps shows the model
 * loaded at that size and spilled off the card, it works out the size that
 * fits, reports it, and aborts the attempt so the caller sends it again at
 * that size. A load that sits on the card is reported as fitting at its
 * size. Stops on its own after `maxMs`, or when stopped (first output came).
 */
export function watchContextFit(opts: IContextFitWatchOptions): IContextFitWatch {
  const controller = new AbortController();
  let refit = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  const stop = (): void => { stopped = true; if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
  const look = async (): Promise<void> => {
    if (stopped) return;
    try {
      const { models } = await opts.ps();
      const m = models.find((x) => x.name === opts.modelId);
      if (m && (!(m.context_length && m.context_length > 0) || m.context_length === opts.contextLength)) {
        const onCard = typeof m.size_vram === 'number' ? m.size_vram : m.size;
        const fit = fitContext({ contextLength: opts.contextLength, totalBytes: m.size, onCardBytes: onCard, weightBytes: opts.weightBytes });
        opts.onFit(fit);
        if (fit < opts.contextLength) { refit = fit; stop(); controller.abort(); return; }
        stop();
        return;
      }
    } catch { /* Ollama not answering: look again */ }
    if (stopped || Date.now() - startedAt >= opts.maxMs) { stop(); return; }
    timer = setTimeout(() => { void look(); }, opts.pollMs);
  };
  timer = setTimeout(() => { void look(); }, opts.pollMs);
  return { get refit() { return refit; }, signal: controller.signal, stop };
}
