export interface IChatToolLoopSafetyDecision {
  readonly blocked: boolean;
  readonly note?: string;
}

const HISTORY_LIMIT = 30;
const CRITICAL_REPEAT_THRESHOLD = 8;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export class ChatToolLoopSafety {
  private readonly _history: string[] = [];

  record(toolName: string, args: Record<string, unknown>): IChatToolLoopSafetyDecision {
    const signature = `${toolName}:${stableStringify(args)}`;
    this._history.push(signature);
    if (this._history.length > HISTORY_LIMIT) {
      this._history.shift();
    }

    let repeatCount = 0;
    for (let index = this._history.length - 1; index >= 0; index -= 1) {
      if (this._history[index] !== signature) {
        break;
      }
      repeatCount += 1;
    }

    if (repeatCount >= CRITICAL_REPEAT_THRESHOLD) {
      return {
        blocked: true,
        note: `Blocked repeated ${toolName} calls after ${repeatCount} identical attempts with no visible progress.`,
      };
    }

    return { blocked: false };
  }
}