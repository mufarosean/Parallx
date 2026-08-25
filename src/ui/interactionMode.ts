// interactionMode.ts — THE interaction-mode subsystem.
//
// SYSTEM_INTEGRITY.md, Phase A. The audit found ~30 defects that were all
// the same defect: the app had no definition of what a transient
// interaction state IS, so every menu, picker, capture and drag
// hand-rolled its own exits and got them wrong differently — modes that
// ate keystrokes after the user left them, listeners that outlived their
// UI, focus stranded on <body>, drags that never ended. Seven patches
// would have preserved the confusion; this subsystem removes the cause.
//
// THE CONTRACT — every mode entered through here:
//   - declares the elements it OWNS (pointer/focus inside them is "in");
//   - receives the COMPLETE exit set by default: Escape, pointer press
//     outside, window blur — plus opt-in focus-loss and anchored-scroll
//     exits. Opting OUT of an exit is an exception; the option doc says
//     when that is legitimate;
//   - has exactly ONE exit path (onExit, called once, with the reason),
//     however the mode ends;
//   - never owns a document listener: the subsystem installs ONE shared
//     set while any mode is active and removes it when the stack empties;
//   - participates in a STACK: Escape and outside-presses resolve
//     topmost-first, so a menu over a palette cannot grab the palette's
//     keys;
//   - restores focus on exit when it stranded it (the quickAccess
//     pattern, generalized): if focus ends up on <body> or inside a
//     root the mode is tearing down, it returns to where it was when the
//     mode began.
//
// `beginPointerDrag` is the same contract for the drag family: pointer
// capture with pointerup / pointercancel / lostpointercapture / Escape /
// window blur all routing to one cleanup that always restores the
// body-level cursor and user-select it set.

import { toDisposable, type IDisposable } from '../platform/lifecycle.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModeExitReason =
  | 'escape'
  | 'outside-pointer'
  | 'focus-loss'
  | 'window-blur'
  | 'scroll'
  | 'resize'
  | 'selection'
  | 'programmatic';

export interface InteractionModeOptions {
  /** Stable identifier for debugging and the compliance harness. */
  readonly id: string;
  /**
   * The elements that count as "inside" this mode. A function so modes
   * with dynamic parts (submenus) always answer with their CURRENT roots.
   */
  readonly ownedRoots: () => readonly HTMLElement[];
  /** Called exactly once when the mode ends, whatever the path. */
  readonly onExit: (reason: ModeExitReason) => void;
  /**
   * Handle a keydown while this mode is TOPMOST. Return true to consume
   * the event (the subsystem preventDefaults + stops propagation).
   * Escape never reaches this — it is the subsystem's own exit key.
   */
  readonly onKeydown?: (e: KeyboardEvent) => boolean;
  /** Default true. Opt out only for modes with their own Escape meaning. */
  readonly exitOnEscape?: boolean;
  /** Default true. Opt out only for full-screen modals with backdrops. */
  readonly exitOnOutsidePointer?: boolean;
  /**
   * Default true — no mode survives Alt-Tab armed. Opt out only for
   * states that genuinely represent persisted UI (none known today).
   */
  readonly exitOnWindowBlur?: boolean;
  /** Default false. Opt IN for modes that must die when DOM focus moves
   *  outside their roots (capture modes, inline editors). */
  readonly exitOnFocusLoss?: boolean;
  /** Default false. Opt IN for popups anchored to scrollable content. */
  readonly exitOnScroll?: boolean;
  /** Default true: restore focus on exit if the mode stranded it. */
  readonly restoreFocus?: boolean;
}

export interface ModeHandle {
  readonly id: string;
  readonly isActive: boolean;
  readonly isTopmost: boolean;
  /** End the mode. Idempotent; onExit fires at most once. */
  exit(reason?: ModeExitReason): void;
}

// ─── The stack ───────────────────────────────────────────────────────────────

interface ActiveMode {
  readonly options: Required<Pick<InteractionModeOptions,
    'id' | 'ownedRoots' | 'onExit' | 'exitOnEscape' | 'exitOnOutsidePointer'
    | 'exitOnWindowBlur' | 'exitOnFocusLoss' | 'exitOnScroll' | 'restoreFocus'>>
    & Pick<InteractionModeOptions, 'onKeydown'>;
  /** Where focus was when the mode began, for the restore contract. */
  readonly previousFocus: HTMLElement | null;
  /** Outside-pointer arming is deferred one tick past the opening press. */
  armed: boolean;
  exited: boolean;
}

const _stack: ActiveMode[] = [];
let _docListeners: IDisposable | null = null;

function _contains(mode: ActiveMode, target: Node | null): boolean {
  if (!target) return false;
  for (const root of mode.options.ownedRoots()) {
    if (root.contains(target)) return true;
  }
  return false;
}

function _exitMode(mode: ActiveMode, reason: ModeExitReason): void {
  if (mode.exited) return;
  mode.exited = true;
  const idx = _stack.indexOf(mode);
  if (idx >= 0) _stack.splice(idx, 1);

  try {
    mode.options.onExit(reason);
  } finally {
    // Focus-return contract: if the mode leaves focus stranded on <body>
    // (or inside a root it just tore down), give it back. Stranded body
    // focus is not inert here — it arms bare-key surfaces elsewhere.
    if (mode.options.restoreFocus) {
      const active = document.activeElement;
      const stranded = !active || active === document.body || _contains(mode, active);
      if (stranded && mode.previousFocus && mode.previousFocus.isConnected) {
        mode.previousFocus.focus();
      }
    }
    if (_stack.length === 0) {
      _docListeners?.dispose();
      _docListeners = null;
    }
  }
}

function _topmost(): ActiveMode | undefined {
  return _stack[_stack.length - 1];
}

function _installDocListeners(): void {
  if (_docListeners) return;

  const onKeydown = (e: KeyboardEvent): void => {
    const top = _topmost();
    if (!top) return;
    if (e.key === 'Escape') {
      if (top.options.exitOnEscape) {
        e.preventDefault();
        e.stopPropagation();
        _exitMode(top, 'escape');
      }
      return;
    }
    if (top.options.onKeydown && top.options.onKeydown(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    // Topmost-first: a press inside the topmost mode touches nothing; a
    // press outside it exits it AND any lower modes it is also outside
    // of (clicking the editor under a submenu chain closes the chain).
    const target = e.target as Node | null;
    for (let i = _stack.length - 1; i >= 0; i--) {
      const mode = _stack[i];
      if (!mode.armed || !mode.options.exitOnOutsidePointer) continue;
      if (_contains(mode, target)) break; // inside this one — lower modes keep their state
      _exitMode(mode, 'outside-pointer');
    }
  };

  const onFocusIn = (e: FocusEvent): void => {
    const target = e.target as Node | null;
    for (let i = _stack.length - 1; i >= 0; i--) {
      const mode = _stack[i];
      if (!mode.options.exitOnFocusLoss) continue;
      if (_contains(mode, target)) break;
      _exitMode(mode, 'focus-loss');
    }
  };

  const onWindowBlur = (): void => {
    for (const mode of [..._stack].reverse()) {
      if (mode.options.exitOnWindowBlur) _exitMode(mode, 'window-blur');
    }
  };

  const onScroll = (e: Event): void => {
    const target = e.target as Node | null;
    for (const mode of [..._stack].reverse()) {
      if (!mode.options.exitOnScroll) continue;
      // Self-containment guard (the Dropdown lesson): scrolling INSIDE
      // the popup's own scroller must not dismiss it.
      if (target && _contains(mode, target)) continue;
      _exitMode(mode, 'scroll');
    }
  };

  const onResize = (): void => {
    for (const mode of [..._stack].reverse()) {
      if (mode.options.exitOnScroll) _exitMode(mode, 'resize');
    }
  };

  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('focusin', onFocusIn);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);

  _docListeners = toDisposable(() => {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('focusin', onFocusIn);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  });
}

/** Enter an interaction mode. See the file header for the contract. */
export function enterMode(options: InteractionModeOptions): ModeHandle {
  const mode: ActiveMode = {
    options: {
      id: options.id,
      ownedRoots: options.ownedRoots,
      onExit: options.onExit,
      onKeydown: options.onKeydown,
      exitOnEscape: options.exitOnEscape ?? true,
      exitOnOutsidePointer: options.exitOnOutsidePointer ?? true,
      exitOnWindowBlur: options.exitOnWindowBlur ?? true,
      exitOnFocusLoss: options.exitOnFocusLoss ?? false,
      exitOnScroll: options.exitOnScroll ?? false,
      restoreFocus: options.restoreFocus ?? true,
    },
    previousFocus: document.activeElement instanceof HTMLElement
      ? document.activeElement : null,
    armed: false,
    exited: false,
  };
  _stack.push(mode);
  _installDocListeners();

  // Skip the press that opened the mode; arm on the next tick.
  setTimeout(() => { mode.armed = true; }, 0);

  return {
    id: mode.options.id,
    get isActive() { return !mode.exited; },
    get isTopmost() { return _topmost() === mode; },
    exit: (reason: ModeExitReason = 'programmatic') => _exitMode(mode, reason),
  };
}

/** The compliance harness looks here; production code should not. */
export function activeModeIds(): readonly string[] {
  return _stack.map((m) => m.options.id);
}

// ─── Guarded pointer drags ───────────────────────────────────────────────────

export interface PointerDragOptions {
  /** Stable identifier for debugging. */
  readonly id: string;
  readonly onMove: (e: PointerEvent) => void;
  /** Called exactly once, whatever ends the drag. `canceled` is true for
   *  Escape / pointercancel / lost capture / window blur. */
  readonly onEnd: (canceled: boolean) => void;
  /** Element to pointer-capture (recommended: the handle). */
  readonly captureTarget?: HTMLElement;
  /** Body cursor for the drag's duration; always restored. */
  readonly cursor?: string;
  /** Default true; always restored. */
  readonly disableUserSelect?: boolean;
}

export interface PointerDragHandle {
  readonly isActive: boolean;
  cancel(): void;
}

/**
 * The drag half of the contract. Four hand-rolled sash drags each set
 * body user-select:none with only a mouseup to undo it — a lost mouseup
 * (release outside the window, OS focus steal) left the app resizing
 * with no button held and text selection dead. Every end path here
 * routes through one cleanup.
 */
export function beginPointerDrag(start: PointerEvent, options: PointerDragOptions): PointerDragHandle {
  let ended = false;
  const body = document.body;
  const prevCursor = body.style.cursor;
  const prevUserSelect = body.style.userSelect;

  if (options.cursor) body.style.cursor = options.cursor;
  if (options.disableUserSelect ?? true) body.style.userSelect = 'none';

  if (options.captureTarget && start.pointerId !== undefined) {
    try { options.captureTarget.setPointerCapture(start.pointerId); } catch { /* capture unsupported */ }
  }

  const end = (canceled: boolean): void => {
    if (ended) return;
    ended = true;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    options.captureTarget?.removeEventListener('lostpointercapture', onCancel);
    body.style.cursor = prevCursor;
    body.style.userSelect = prevUserSelect;
    if (options.captureTarget && start.pointerId !== undefined) {
      try { options.captureTarget.releasePointerCapture(start.pointerId); } catch { /* already released */ }
    }
    options.onEnd(canceled);
  };

  const onMove = (e: PointerEvent): void => options.onMove(e);
  const onUp = (): void => end(false);
  const onCancel = (): void => end(true);
  const onBlur = (): void => end(true);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      end(true);
    }
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  options.captureTarget?.addEventListener('lostpointercapture', onCancel);

  return {
    get isActive() { return !ended; },
    cancel: () => end(true),
  };
}
