// activationEventService.ts — activation event system
//
// Monitors activation triggers and signals when a tool should be activated.
// Supports: *, onStartupFinished, onCommand:<id>, onView:<id>.
// Events that fire before a tool is registered are queued and replayed.

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Activation event kinds supported in M2.
 */
export enum ActivationEventKind {
  /** Eager — activates immediately on startup. */
  Star = '*',
  /** After shell init completes. */
  OnStartupFinished = 'onStartupFinished',
  /** When a specific command is first invoked. */
  OnCommand = 'onCommand',
  /** When a specific view is first shown. */
  OnView = 'onView',
}

/**
 * A parsed activation event.
 */
export interface ParsedActivationEvent {
  readonly kind: ActivationEventKind;
  /** The qualifier after the colon, e.g., the commandId in `onCommand:myTool.doSomething`. */
  readonly qualifier?: string;
  /** Original event string. */
  readonly raw: string;
}

/**
 * Fired when the system determines a tool should be activated.
 */
export interface ActivationRequest {
  readonly toolId: string;
  readonly event: ParsedActivationEvent;
  readonly timestamp: number;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse a raw activation event string into a structured object.
 * Returns undefined if the event is unrecognized.
 */
export function parseActivationEvent(raw: string): ParsedActivationEvent | undefined {
  if (raw === '*') {
    return { kind: ActivationEventKind.Star, raw };
  }
  if (raw === 'onStartupFinished') {
    return { kind: ActivationEventKind.OnStartupFinished, raw };
  }
  if (raw.startsWith('onCommand:')) {
    const qualifier = raw.slice('onCommand:'.length);
    if (!qualifier) return undefined;
    return { kind: ActivationEventKind.OnCommand, qualifier, raw };
  }
  if (raw.startsWith('onView:')) {
    const qualifier = raw.slice('onView:'.length);
    if (!qualifier) return undefined;
    return { kind: ActivationEventKind.OnView, qualifier, raw };
  }
  return undefined;
}

// ─── ActivationEventService ──────────────────────────────────────────────────

/**
 * Listens for activation triggers and dispatches activation requests.
 *
 * The service maintains a mapping of activation events → tool IDs.
 * When an event fires (command invoked, view shown, etc.), it looks up
 * which tools need activation and fires `onActivationRequested`.
 *
 * Events that fire before any tools subscribe are queued and replayed
 * when tools register their activation events.
 */
export class ActivationEventService extends Disposable {

  // ── Tool → events mapping ──

  /** Map from raw activation event string → set of tool IDs that listen for it. */
  private readonly _eventToTools = new Map<string, Set<string>>();

  /** Set of tools already activated (to deduplicate). */
  private readonly _activatedTools = new Set<string>();

  /** Queued events that fired before any tool was listening. */
  private readonly _pendingEvents = new Set<string>();

  /** Whether `onStartupFinished` has been signalled. */
  private _startupFinished = false;

  // ── Events ──

  private readonly _onActivationRequested = this._register(new Emitter<ActivationRequest>());
  /** Fires when the system determines a tool should be activated. */
  readonly onActivationRequested: Event<ActivationRequest> = this._onActivationRequested.event;

  private readonly _onDidFireEvent = this._register(new Emitter<ParsedActivationEvent>());
  /** Fires whenever an activation event fires (for observability/diagnostics). */
  readonly onDidFireEvent: Event<ParsedActivationEvent> = this._onDidFireEvent.event;

  constructor() {
    super();
  }

  // ── Registration ──

  /**
   * Register a tool's activation events.
   * The tool will be activated when any of these events fire.
   * If the event has already fired, the tool is immediately queued for activation.
   */
  registerToolEvents(toolId: string, activationEvents: readonly string[]): IDisposable {
    const parsedEvents: ParsedActivationEvent[] = [];

    for (const raw of activationEvents) {
      const parsed = parseActivationEvent(raw);
      if (!parsed) {
        console.warn(`[ActivationEventService] Ignoring unrecognized activation event: "${raw}" for tool "${toolId}"`);
        continue;
      }
      parsedEvents.push(parsed);

      // Add to event → tools mapping
      let toolSet = this._eventToTools.get(raw);
      if (!toolSet) {
        toolSet = new Set();
        this._eventToTools.set(raw, toolSet);
      }
      toolSet.add(toolId);
    }

    // Check if any registered events have already fired (replay)
    for (const parsed of parsedEvents) {
      if (this._shouldActivateImmediately(parsed)) {
        this._requestActivation(toolId, parsed);
      }
    }

    return toDisposable(() => {
      for (const raw of activationEvents) {
        const toolSet = this._eventToTools.get(raw);
        if (toolSet) {
          toolSet.delete(toolId);
          if (toolSet.size === 0) {
            this._eventToTools.delete(raw);
          }
        }
      }
    });
  }

  /**
   * Mark a tool as activated (prevents duplicate activation requests).
   */
  markActivated(toolId: string): void {
    this._activatedTools.add(toolId);
  }

  /**
   * Clear a tool's activated status (e.g. after deactivation, for re-activation).
   */
  clearActivated(toolId: string): void {
    this._activatedTools.delete(toolId);
  }

  // ── Event Triggers ──

  /**
   * Signal that shell startup has finished.
   * Triggers `onStartupFinished` and `*` events.
   */
  fireStartupFinished(): void {
    if (this._startupFinished) return;
    this._startupFinished = true;

    // Fire `*` events
    const starParsed: ParsedActivationEvent = { kind: ActivationEventKind.Star, raw: '*' };
    this._fireEvent(starParsed);

    // Fire `onStartupFinished` events
    const startupParsed: ParsedActivationEvent = { kind: ActivationEventKind.OnStartupFinished, raw: 'onStartupFinished' };
    this._fireEvent(startupParsed);
  }

  /**
   * Signal that a command was invoked.
   * Triggers `onCommand:<commandId>` events.
   */
  fireCommand(commandId: string): void {
    const raw = `onCommand:${commandId}`;
    const parsed: ParsedActivationEvent = { kind: ActivationEventKind.OnCommand, qualifier: commandId, raw };
    this._fireEvent(parsed);
  }

  /**
   * Signal that a view was shown.
   * Triggers `onView:<viewId>` events.
   */
  fireView(viewId: string): void {
    const raw = `onView:${viewId}`;
    const parsed: ParsedActivationEvent = { kind: ActivationEventKind.OnView, qualifier: viewId, raw };
    this._fireEvent(parsed);
  }

  // ── Queries ──

  /**
   * Get all tool IDs listening for a specific raw event string.
   */
  getToolsForEvent(rawEvent: string): readonly string[] {
    const toolSet = this._eventToTools.get(rawEvent);
    return toolSet ? [...toolSet] : [];
  }

  /**
   * Check if a tool has been marked as activated.
   */
  isActivated(toolId: string): boolean {
    return this._activatedTools.has(toolId);
  }

  /**
   * Check if startup has finished.
   */
  get startupFinished(): boolean {
    return this._startupFinished;
  }

  // ── Internal ──

  /**
   * Fire an activation event: notify listeners, queue if no tools are subscribed.
   */
  private _fireEvent(parsed: ParsedActivationEvent): void {
    this._pendingEvents.add(parsed.raw);

    // Notify observability listeners
    this._onDidFireEvent.fire(parsed);

    // Find tools listening for this event
    const toolSet = this._eventToTools.get(parsed.raw);
    if (!toolSet || toolSet.size === 0) {
      // No tools listening yet — the event is queued in _pendingEvents
      // and will be replayed when tools register.
      return;
    }

    for (const toolId of toolSet) {
      this._requestActivation(toolId, parsed);
    }
  }

  /**
   * Request activation of a tool (if not already activated).
   */
  private _requestActivation(toolId: string, event: ParsedActivationEvent): void {
    if (this._activatedTools.has(toolId)) return;

    this._onActivationRequested.fire({
      toolId,
      event,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if an event should cause immediate activation
   * (because it already fired or startup is done).
   */
  private _shouldActivateImmediately(parsed: ParsedActivationEvent): boolean {
    // `*` events activate immediately if startup has happened
    if (parsed.kind === ActivationEventKind.Star && this._startupFinished) {
      return true;
    }
    // `onStartupFinished` activates if startup is done
    if (parsed.kind === ActivationEventKind.OnStartupFinished && this._startupFinished) {
      return true;
    }
    // Other events replay if they've already fired
    return this._pendingEvents.has(parsed.raw);
  }
}
