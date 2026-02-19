// lifecycle.ts — startup / teardown sequencing

import { Emitter, Event } from '../platform/events.js';
import { Disposable, IDisposable } from '../platform/lifecycle.js';

/**
 * Workbench lifecycle phases, executed in order during startup
 * and in reverse order during teardown.
 */
export enum LifecyclePhase {
  /** Phase 1: Core services are wired and ready */
  Services = 1,
  /** Phase 2: Layout system is initialized */
  Layout = 2,
  /** Phase 3: Structural parts are created and mounted */
  Parts = 3,
  /** Phase 4: Workspace state is restored */
  WorkspaceRestore = 4,
  /** Phase 5: Everything is ready for interaction */
  Ready = 5,
}

/**
 * Information about a lifecycle phase transition.
 */
export interface LifecyclePhaseEvent {
  readonly phase: LifecyclePhase;
}

/**
 * A function registered for a specific lifecycle phase.
 * May be async — the lifecycle waits for it to settle.
 */
export type LifecycleHook = () => void | Promise<void>;

/**
 * Error that occurred during a lifecycle phase.
 */
export interface LifecyclePhaseError {
  readonly phase: LifecyclePhase;
  readonly error: Error;
}

/**
 * Manages workbench startup and teardown sequencing.
 *
 * Startup: executes phases 1→5 in order, awaiting async hooks.
 * Teardown: executes phases 5→1 in reverse, awaiting async hooks.
 * Errors in one phase are captured and reported but do not prevent
 * subsequent phases from executing.
 */
export class LifecycleService extends Disposable {
  private _currentPhase: LifecyclePhase | undefined;
  private _phaseReached = new Map<LifecyclePhase, boolean>();

  // Hooks registered per phase
  private readonly _startupHooks = new Map<LifecyclePhase, LifecycleHook[]>();
  private readonly _teardownHooks = new Map<LifecyclePhase, LifecycleHook[]>();

  // Errors accumulated during lifecycle execution
  private readonly _errors: LifecyclePhaseError[] = [];

  // Events
  private readonly _onDidPhaseStart = this._register(new Emitter<LifecyclePhaseEvent>());
  readonly onDidPhaseStart: Event<LifecyclePhaseEvent> = this._onDidPhaseStart.event;

  private readonly _onDidPhaseComplete = this._register(new Emitter<LifecyclePhaseEvent>());
  readonly onDidPhaseComplete: Event<LifecyclePhaseEvent> = this._onDidPhaseComplete.event;

  private readonly _onDidPhaseError = this._register(new Emitter<LifecyclePhaseError>());
  readonly onDidPhaseError: Event<LifecyclePhaseError> = this._onDidPhaseError.event;

  /**
   * Current lifecycle phase, or undefined if not yet started.
   */
  get phase(): LifecyclePhase | undefined {
    return this._currentPhase;
  }

  /**
   * Whether a given phase has been reached (started or completed).
   */
  hasReachedPhase(phase: LifecyclePhase): boolean {
    return this._phaseReached.get(phase) ?? false;
  }

  /**
   * All errors that occurred during lifecycle phases.
   */
  get errors(): readonly LifecyclePhaseError[] {
    return this._errors;
  }

  /**
   * Register a hook to run during a specific startup phase.
   * If the phase has already been reached, the hook is executed immediately.
   */
  onStartup(phase: LifecyclePhase, hook: LifecycleHook): IDisposable {
    // If phase already reached, execute immediately (fire-and-forget)
    if (this._phaseReached.get(phase)) {
      try {
        const result = hook();
        if (result instanceof Promise) {
          result.catch((err) => this._captureError(phase, err));
        }
      } catch (err) {
        this._captureError(phase, err);
      }
      return { dispose() {} };
    }

    const hooks = this._startupHooks.get(phase) ?? [];
    hooks.push(hook);
    this._startupHooks.set(phase, hooks);

    return {
      dispose: () => {
        const current = this._startupHooks.get(phase);
        if (current) {
          const idx = current.indexOf(hook);
          if (idx >= 0) {
            current.splice(idx, 1);
          }
        }
      },
    };
  }

  /**
   * Register a hook to run during teardown of a specific phase.
   */
  onTeardown(phase: LifecyclePhase, hook: LifecycleHook): IDisposable {
    const hooks = this._teardownHooks.get(phase) ?? [];
    hooks.push(hook);
    this._teardownHooks.set(phase, hooks);

    return {
      dispose: () => {
        const current = this._teardownHooks.get(phase);
        if (current) {
          const idx = current.indexOf(hook);
          if (idx >= 0) {
            current.splice(idx, 1);
          }
        }
      },
    };
  }

  /**
   * Execute startup: phases 1→5 in order.
   * Each phase waits for all its hooks to complete before moving on.
   * Errors in one phase do not prevent subsequent phases.
   */
  async startup(): Promise<void> {
    const phases = [
      LifecyclePhase.Services,
      LifecyclePhase.Layout,
      LifecyclePhase.Parts,
      LifecyclePhase.WorkspaceRestore,
      LifecyclePhase.Ready,
    ];

    for (const phase of phases) {
      await this._executePhase(phase, this._startupHooks);
    }
  }

  /**
   * Execute teardown: phases 5→1 in reverse order.
   * Each phase waits for all its hooks to complete before moving on.
   * Errors in one phase do not prevent subsequent phases.
   */
  async teardown(): Promise<void> {
    const phases = [
      LifecyclePhase.Ready,
      LifecyclePhase.WorkspaceRestore,
      LifecyclePhase.Parts,
      LifecyclePhase.Layout,
      LifecyclePhase.Services,
    ];

    for (const phase of phases) {
      await this._executePhase(phase, this._teardownHooks);
    }
  }

  /**
   * Execute all hooks for a single phase, catching errors.
   */
  private async _executePhase(
    phase: LifecyclePhase,
    hookMap: Map<LifecyclePhase, LifecycleHook[]>
  ): Promise<void> {
    this._currentPhase = phase;
    this._phaseReached.set(phase, true);
    this._onDidPhaseStart.fire({ phase });

    const hooks = hookMap.get(phase) ?? [];
    for (const hook of hooks) {
      try {
        const result = hook();
        if (result instanceof Promise) {
          await result;
        }
      } catch (err) {
        this._captureError(phase, err);
      }
    }

    this._onDidPhaseComplete.fire({ phase });
  }

  /**
   * Capture and report a lifecycle error without interrupting execution.
   */
  private _captureError(phase: LifecyclePhase, err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    const phaseError: LifecyclePhaseError = { phase, error };
    this._errors.push(phaseError);
    this._onDidPhaseError.fire(phaseError);
  }
}
