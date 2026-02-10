// toolErrorIsolation.ts — error boundary and reporting for tools
//
// Wraps all tool-originated calls (activation, command handlers, view providers)
// in try/catch. Errors are attributed to the originating tool by ID,
// logged with stack traces, and tracked per-tool. Repeated errors trigger
// warnings. Misbehaving tools can be force-deactivated.

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A recorded tool error.
 */
export interface ToolError {
  /** Tool ID that caused the error. */
  readonly toolId: string;
  /** Human-readable error message. */
  readonly message: string;
  /** Stack trace (if available). */
  readonly stack?: string;
  /** When the error occurred. */
  readonly timestamp: number;
  /** Context where the error happened (activation, command, view, etc.). */
  readonly context: string;
}

/**
 * Event fired when a tool error is recorded.
 */
export interface ToolErrorEvent extends ToolError {}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum errors per tool before triggering force-deactivation warning. */
const MAX_ERRORS_BEFORE_WARNING = 10;

/** Maximum errors per tool before force-deactivation. */
const MAX_ERRORS_BEFORE_FORCE_DEACTIVATE = 50;

/** Time window (ms) for rapid error detection. */
const RAPID_ERROR_WINDOW_MS = 5000;

/** Number of rapid errors that indicate an infinite loop. */
const RAPID_ERROR_THRESHOLD = 5;

// ─── ToolErrorService ────────────────────────────────────────────────────────

/**
 * Tracks and isolates errors from tools.
 *
 * Provides:
 * - Error recording per tool
 * - `wrap()` utility to safely wrap tool callbacks
 * - Rapid-error / infinite-loop detection
 * - Error query by tool ID
 * - Force-deactivation signalling for misbehaving tools
 */
export class ToolErrorService extends Disposable {

  /** Per-tool error logs. */
  private readonly _errors = new Map<string, ToolError[]>();

  /** Per-tool timestamps for rapid-error detection. */
  private readonly _recentTimestamps = new Map<string, number[]>();

  // ── Events ──

  private readonly _onDidRecordError = this._register(new Emitter<ToolErrorEvent>());
  /** Fires whenever a tool error is recorded. */
  readonly onDidRecordError: Event<ToolErrorEvent> = this._onDidRecordError.event;

  private readonly _onShouldForceDeactivate = this._register(new Emitter<string>());
  /** Fires when a tool has exceeded the error threshold and should be deactivated. */
  readonly onShouldForceDeactivate: Event<string> = this._onShouldForceDeactivate.event;

  constructor() {
    super();
  }

  // ── Recording ──

  /**
   * Record an error for a tool.
   */
  recordError(toolId: string, error: unknown, context: string): ToolError {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    const recorded: ToolError = {
      toolId,
      message,
      stack,
      timestamp: Date.now(),
      context,
    };

    // Store error
    let toolErrors = this._errors.get(toolId);
    if (!toolErrors) {
      toolErrors = [];
      this._errors.set(toolId, toolErrors);
    }
    toolErrors.push(recorded);

    // Log it
    console.error(`[ToolError] Tool "${toolId}" error in ${context}: ${message}`);
    if (stack) {
      console.error(stack);
    }

    // Fire event (non-blocking)
    this._onDidRecordError.fire(recorded);

    // Check thresholds
    this._checkThresholds(toolId, toolErrors);

    return recorded;
  }

  // ── Wrapping ──

  /**
   * Wrap a synchronous or async tool callback in a try/catch.
   * Returns a wrapped function that catches errors and records them.
   */
  wrap<TArgs extends unknown[], TReturn>(
    toolId: string,
    context: string,
    fn: (...args: TArgs) => TReturn,
  ): (...args: TArgs) => TReturn | undefined {
    return (...args: TArgs): TReturn | undefined => {
      try {
        const result = fn(...args);
        // Handle async results
        if (result instanceof Promise) {
          return result.catch((err: unknown) => {
            this.recordError(toolId, err, context);
            return undefined;
          }) as TReturn;
        }
        return result;
      } catch (err) {
        this.recordError(toolId, err, context);
        return undefined;
      }
    };
  }

  /**
   * Wrap an async tool function in a try/catch.
   * Returns a wrapped async function that catches errors and records them.
   */
  wrapAsync<TArgs extends unknown[], TReturn>(
    toolId: string,
    context: string,
    fn: (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn | undefined> {
    return async (...args: TArgs): Promise<TReturn | undefined> => {
      try {
        return await fn(...args);
      } catch (err) {
        this.recordError(toolId, err, context);
        return undefined;
      }
    };
  }

  // ── Queries ──

  /**
   * Get all recorded errors for a tool.
   */
  getToolErrors(toolId: string): readonly ToolError[] {
    return this._errors.get(toolId) ?? [];
  }

  /**
   * Get the total error count for a tool.
   */
  getErrorCount(toolId: string): number {
    return this._errors.get(toolId)?.length ?? 0;
  }

  /**
   * Get errors for all tools.
   */
  getAllErrors(): ReadonlyMap<string, readonly ToolError[]> {
    return this._errors;
  }

  /**
   * Clear recorded errors for a tool (e.g., after re-activation).
   */
  clearErrors(toolId: string): void {
    this._errors.delete(toolId);
    this._recentTimestamps.delete(toolId);
  }

  // ── Threshold Checks ──

  private _checkThresholds(toolId: string, errors: ToolError[]): void {
    const count = errors.length;

    // Check for rapid/repeated errors (potential infinite loop)
    this._trackRecentError(toolId);

    if (count === MAX_ERRORS_BEFORE_WARNING) {
      console.warn(
        `[ToolErrorService] Tool "${toolId}" has recorded ${count} errors. ` +
        `It may be force-deactivated after ${MAX_ERRORS_BEFORE_FORCE_DEACTIVATE} errors.`,
      );
    }

    if (count >= MAX_ERRORS_BEFORE_FORCE_DEACTIVATE) {
      console.error(
        `[ToolErrorService] Tool "${toolId}" exceeded ${MAX_ERRORS_BEFORE_FORCE_DEACTIVATE} errors. ` +
        `Signalling force-deactivation.`,
      );
      this._onShouldForceDeactivate.fire(toolId);
    }
  }

  private _trackRecentError(toolId: string): void {
    const now = Date.now();
    let timestamps = this._recentTimestamps.get(toolId);
    if (!timestamps) {
      timestamps = [];
      this._recentTimestamps.set(toolId, timestamps);
    }

    timestamps.push(now);

    // Prune timestamps outside the window
    const windowStart = now - RAPID_ERROR_WINDOW_MS;
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= RAPID_ERROR_THRESHOLD) {
      console.warn(
        `[ToolErrorService] Rapid errors detected for tool "${toolId}": ` +
        `${timestamps.length} errors in ${RAPID_ERROR_WINDOW_MS}ms. Possible infinite loop.`,
      );
    }
  }

  // ── Disposal ──

  override dispose(): void {
    this._errors.clear();
    this._recentTimestamps.clear();
    super.dispose();
  }
}
