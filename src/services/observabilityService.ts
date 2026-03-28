// D7: Observability service — centralized turn metrics aggregation
// Upstream pattern: runtime metrics collection + per-model performance tracking

import { Emitter } from '../platform/events.js';
import type { ITurnMetrics, ISessionMetrics, IModelMetrics } from './serviceTypes.js';

export class ObservabilityService {
  private readonly _onDidRecordTurn = new Emitter<ITurnMetrics>();
  readonly onDidRecordTurn = this._onDidRecordTurn.event;

  private readonly _turnHistory: ITurnMetrics[] = [];

  recordTurn(metrics: ITurnMetrics): void {
    this._turnHistory.push(metrics);
    this._onDidRecordTurn.fire(metrics);
  }

  getSessionMetrics(): ISessionMetrics {
    const turns = this._turnHistory;
    const turnCount = turns.length;
    const totalPromptTokens = turns.reduce((s, t) => s + t.promptTokens, 0);
    const totalCompletionTokens = turns.reduce((s, t) => s + t.completionTokens, 0);
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const totalDurationMs = turns.reduce((s, t) => s + t.durationMs, 0);
    return {
      turnCount,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalDurationMs,
      avgDurationMs: turnCount > 0 ? totalDurationMs / turnCount : 0,
      avgPromptTokens: turnCount > 0 ? totalPromptTokens / turnCount : 0,
      avgCompletionTokens: turnCount > 0 ? totalCompletionTokens / turnCount : 0,
    };
  }

  getModelMetrics(model?: string): readonly IModelMetrics[] {
    const byModel = new Map<string, ITurnMetrics[]>();
    for (const turn of this._turnHistory) {
      if (model && turn.model !== model) continue;
      const arr = byModel.get(turn.model) ?? [];
      arr.push(turn);
      byModel.set(turn.model, arr);
    }
    const result: IModelMetrics[] = [];
    for (const [m, turns] of byModel) {
      const count = turns.length;
      const totalTokens = turns.reduce((s, t) => s + t.totalTokens, 0);
      const totalDuration = turns.reduce((s, t) => s + t.durationMs, 0);
      const totalPrompt = turns.reduce((s, t) => s + t.promptTokens, 0);
      const totalCompletion = turns.reduce((s, t) => s + t.completionTokens, 0);
      result.push({
        model: m,
        turnCount: count,
        totalTokens,
        avgDurationMs: totalDuration / count,
        avgPromptTokens: totalPrompt / count,
        avgCompletionTokens: totalCompletion / count,
      });
    }
    return result;
  }

  getTurnHistory(): readonly ITurnMetrics[] {
    return this._turnHistory;
  }

  dispose(): void {
    this._onDidRecordTurn.dispose();
  }
}
