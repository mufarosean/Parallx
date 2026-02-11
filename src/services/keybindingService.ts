// keybindingService.ts — centralized keybinding dispatch (M3 Capability 0.3)
//
// Owns a single document-level keydown listener (capture phase) and resolves
// keyboard events to command executions via the keybinding table.
// Supports chord keybindings (e.g. Ctrl+K Ctrl+F) with a 1500ms timeout.
//
// Replaces the ad-hoc dispatch in KeybindingContributionProcessor and the
// hardcoded listeners in CommandPalette.
//
// VS Code reference: src/vs/workbench/services/keybinding/browser/keybindingService.ts

import { Disposable, IDisposable, toDisposable, DisposableStore } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { normalizeKeybinding, keyFromEvent } from '../contributions/keybindingContribution.js';
import type { IKeybindingService } from './serviceTypes.js';

// ─── Minimal shapes to avoid circular imports ────────────────────────────────

interface ICommandServiceLike {
  hasCommand(commandId: string): boolean;
  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
}

interface IContextKeyServiceLike {
  contextMatchesRules(whenClause: string | undefined): boolean;
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Internal representation of a registered keybinding entry.
 */
interface KeybindingEntry {
  /** Full normalized key string (for single-key: 'ctrl+b', for chord: 'ctrl+k ctrl+f'). */
  readonly fullKey: string;
  /** First part of the key combo (for single-key: same as fullKey, for chord: first part). */
  readonly firstPart: string;
  /** Second part of chord, or empty string for single-key bindings. */
  readonly secondPart: string;
  /** Whether this is a chord (two-key) keybinding. */
  readonly isChord: boolean;
  /** The command to execute. */
  readonly commandId: string;
  /** Optional when-clause for conditional activation. */
  readonly when?: string;
  /** Source of the keybinding (e.g. 'builtin', 'tool:my-tool'). */
  readonly source: string;
}

/** Chord timeout in milliseconds (matches VS Code). */
const CHORD_TIMEOUT_MS = 1500;

// ─── KeybindingService ───────────────────────────────────────────────────────

export class KeybindingService extends Disposable implements IKeybindingService {

  // ── State ──

  /** All registered keybinding entries. */
  private readonly _entries: KeybindingEntry[] = [];

  /**
   * Lookup table: normalized first-part key → entries.
   * For single-key bindings, firstPart === fullKey.
   * For chord bindings, firstPart is the chord prefix.
   */
  private readonly _firstPartMap = new Map<string, KeybindingEntry[]>();

  /** The chord prefix currently being waited on, or null if not in a chord. */
  private _pendingChordPrefix: string | null = null;

  /** Timeout handle for chord cancellation. */
  private _chordTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Dependencies ──

  private readonly _commandService: ICommandServiceLike;
  private _contextKeyService: IContextKeyServiceLike | undefined;

  // ── Events ──

  private readonly _onDidDispatch = this._register(new Emitter<{ key: string; commandId: string }>());
  readonly onDidDispatch: Event<{ key: string; commandId: string }> = this._onDidDispatch.event;

  private readonly _onDidEnterChordPrefix = this._register(new Emitter<string>());
  readonly onDidEnterChordPrefix: Event<string> = this._onDidEnterChordPrefix.event;

  private readonly _onDidCancelChord = this._register(new Emitter<void>());
  readonly onDidCancelChord: Event<void> = this._onDidCancelChord.event;

  // ── Constructor ──

  constructor(commandService: ICommandServiceLike) {
    super();
    this._commandService = commandService;
    this._installGlobalListener();
  }

  // ── Context Key Service (optional, set after construction) ──

  /**
   * Set the context key service for when-clause evaluation.
   * Called after construction because of DI initialization order.
   */
  setContextKeyService(service: IContextKeyServiceLike): void {
    this._contextKeyService = service;
  }

  // ── Registration ──

  registerKeybinding(key: string, commandId: string, when?: string, source?: string): IDisposable {
    const entry = this._createEntry(key, commandId, when, source);
    this._entries.push(entry);
    this._addToFirstPartMap(entry);

    return toDisposable(() => {
      const idx = this._entries.indexOf(entry);
      if (idx >= 0) {
        this._entries.splice(idx, 1);
        this._removeFromFirstPartMap(entry);
      }
    });
  }

  registerKeybindings(bindings: readonly { key: string; commandId: string; when?: string; source?: string }[]): IDisposable {
    const store = new DisposableStore();
    for (const b of bindings) {
      store.add(this.registerKeybinding(b.key, b.commandId, b.when, b.source));
    }
    return store;
  }

  removeKeybindingsBySource(source: string): void {
    // Iterate backwards to safely splice while iterating
    for (let i = this._entries.length - 1; i >= 0; i--) {
      if (this._entries[i].source === source) {
        const entry = this._entries[i];
        this._entries.splice(i, 1);
        this._removeFromFirstPartMap(entry);
      }
    }
  }

  lookupKeybinding(commandId: string): string | undefined {
    for (const entry of this._entries) {
      if (entry.commandId === commandId) {
        return entry.fullKey;
      }
    }
    return undefined;
  }

  getAllKeybindings(): readonly { key: string; commandId: string; when?: string; source?: string }[] {
    return this._entries.map(e => ({
      key: e.fullKey,
      commandId: e.commandId,
      when: e.when,
      source: e.source,
    }));
  }

  // ── Entry creation ──

  private _createEntry(key: string, commandId: string, when?: string, source?: string): KeybindingEntry {
    const trimmedKey = key.trim();

    // Check for chord: "Ctrl+K Ctrl+F" → two space-separated parts
    const parts = trimmedKey.split(/\s+/);
    if (parts.length === 2) {
      const first = normalizeKeybinding(parts[0]);
      const second = normalizeKeybinding(parts[1]);
      return {
        fullKey: `${first} ${second}`,
        firstPart: first,
        secondPart: second,
        isChord: true,
        commandId,
        when,
        source: source ?? 'unknown',
      };
    }

    const normalized = normalizeKeybinding(trimmedKey);
    return {
      fullKey: normalized,
      firstPart: normalized,
      secondPart: '',
      isChord: false,
      commandId,
      when,
      source: source ?? 'unknown',
    };
  }

  // ── First-part map management ──

  private _addToFirstPartMap(entry: KeybindingEntry): void {
    let bucket = this._firstPartMap.get(entry.firstPart);
    if (!bucket) {
      bucket = [];
      this._firstPartMap.set(entry.firstPart, bucket);
    }
    bucket.push(entry);
  }

  private _removeFromFirstPartMap(entry: KeybindingEntry): void {
    const bucket = this._firstPartMap.get(entry.firstPart);
    if (bucket) {
      const idx = bucket.indexOf(entry);
      if (idx >= 0) {
        bucket.splice(idx, 1);
        if (bucket.length === 0) {
          this._firstPartMap.delete(entry.firstPart);
        }
      }
    }
  }

  // ── Global listener ──

  private _installGlobalListener(): void {
    const handler = (e: KeyboardEvent) => {
      this._handleKeydown(e);
    };
    document.addEventListener('keydown', handler, true);
    this._register(toDisposable(() => {
      document.removeEventListener('keydown', handler, true);
    }));
  }

  // ── Keydown dispatch ──

  private _handleKeydown(e: KeyboardEvent): void {
    const normalizedKey = keyFromEvent(e);
    if (!normalizedKey) return;

    // ── Chord: waiting for second key ──
    if (this._pendingChordPrefix) {
      this._clearChordTimer();
      const prefix = this._pendingChordPrefix;
      this._pendingChordPrefix = null;

      // Look for chord entries where firstPart === prefix && secondPart === normalizedKey
      const bucket = this._firstPartMap.get(prefix);
      if (bucket) {
        const match = this._findMatch(bucket, entry =>
          entry.isChord && entry.secondPart === normalizedKey,
        );
        if (match) {
          e.preventDefault();
          e.stopPropagation();
          this._executeBinding(match);
          return;
        }
      }

      // No chord completion found — cancel and fire event
      this._onDidCancelChord.fire();
      // Fall through to try the key as a standalone binding
    }

    // ── Normal dispatch ──
    const bucket = this._firstPartMap.get(normalizedKey);
    if (!bucket || bucket.length === 0) return;

    // Check if any of the matching entries are chord prefixes
    const hasChordEntries = bucket.some(e => e.isChord);
    const hasSingleEntries = bucket.some(e => !e.isChord);

    // If there are chord entries, check for a single-key match first
    if (hasSingleEntries) {
      const singleMatch = this._findMatch(bucket, entry => !entry.isChord);
      if (singleMatch) {
        // If there are also chord entries with the same prefix, we need to decide:
        // VS Code gives priority to chords — enter chord mode.
        // But only if no single-key binding exists that also matches.
        // Actually, VS Code behavior: if a chord prefix matches AND a single-key
        // binding matches, the chord wins — user enters chord mode.
        // But if the chord prefix is the *only* match, enter chord mode.
        if (hasChordEntries) {
          // Enter chord mode — chord takes priority over single-key
          e.preventDefault();
          e.stopPropagation();
          this._enterChordMode(normalizedKey);
          return;
        }

        // Only single-key bindings — execute immediately
        e.preventDefault();
        e.stopPropagation();
        this._executeBinding(singleMatch);
        return;
      }
    }

    // Only chord entries — enter chord mode
    if (hasChordEntries) {
      e.preventDefault();
      e.stopPropagation();
      this._enterChordMode(normalizedKey);
      return;
    }
  }

  // ── Chord mode ──

  private _enterChordMode(prefix: string): void {
    this._pendingChordPrefix = prefix;
    this._onDidEnterChordPrefix.fire(prefix);

    this._chordTimer = setTimeout(() => {
      this._pendingChordPrefix = null;
      this._chordTimer = null;
      this._onDidCancelChord.fire();
    }, CHORD_TIMEOUT_MS);
  }

  private _clearChordTimer(): void {
    if (this._chordTimer !== null) {
      clearTimeout(this._chordTimer);
      this._chordTimer = null;
    }
  }

  // ── Match resolution ──

  /**
   * Find the last matching entry whose when-clause is satisfied.
   * Last-registered wins (higher index = higher priority).
   */
  private _findMatch(
    bucket: KeybindingEntry[],
    filter: (entry: KeybindingEntry) => boolean,
  ): KeybindingEntry | undefined {
    for (let i = bucket.length - 1; i >= 0; i--) {
      const entry = bucket[i];
      if (!filter(entry)) continue;
      if (!this._evaluateWhen(entry.when)) continue;
      if (!this._commandService.hasCommand(entry.commandId)) continue;
      return entry;
    }
    return undefined;
  }

  private _evaluateWhen(when: string | undefined): boolean {
    if (!when) return true;
    if (!this._contextKeyService) return true; // no context service → skip when-clause
    return this._contextKeyService.contextMatchesRules(when);
  }

  // ── Command execution ──

  private _executeBinding(entry: KeybindingEntry): void {
    this._commandService.executeCommand(entry.commandId).then(
      () => {
        this._onDidDispatch.fire({ key: entry.fullKey, commandId: entry.commandId });
      },
      (err) => {
        console.error(
          `[KeybindingService] Error executing command "${entry.commandId}" ` +
          `via keybinding "${entry.fullKey}":`,
          err,
        );
      },
    );
  }

  // ── Disposal ──

  override dispose(): void {
    this._clearChordTimer();
    this._entries.length = 0;
    this._firstPartMap.clear();
    this._pendingChordPrefix = null;
    super.dispose();
  }
}
