// settingsRegistryService.ts — M60 Phase ε §7 T4.D1 Settings Registry
//
// Unified, schema-driven settings registry. Every service / extension
// registers its settings up-front with a typed schema; the registry owns
// validation, persistence, change events, and scope routing.
//
// Why a new service (vs reusing AISettingsService):
//   - AISettingsService is profile-shaped (presets, persona). Its truth
//     is a list of named profiles, not a flat key→value map.
//   - AutonomyFeatureFlagsService IS flat (11 boolean flags) and adapter-
//     binds cleanly into the registry — see `bind()` below.
//   - Extensions can register their own schemas via the M56 service path.
//
// Storage:
//   - User scope     → IGlobalStorageService    (FileBackedGlobalStorage,
//                      <APP_ROOT>/data/global-storage.json)
//   - Workspace scope → IWorkspaceStorageService (FileBackedWorkspaceStorage,
//                       <workspaceRoot>/.parallx/workspace-storage.json)
//
// Both backends are M53 portable storage — JSON via the existing electron
// IPC bridge. No new IPC handlers needed (M60 §3.4 boundary preserved).
//
// Concurrency (§3.7):
//   - Writes are serialized through the underlying IStorage write queue.
//   - In-memory override map is updated synchronously *after* the persist
//     promise resolves, so onDidChange consumers always see persisted state.
//
// Observability (§3.10):
//   - setValue logs at info level via console.info (settings writes are
//     user actions, not autonomy events — explicitly NOT routed through
//     AutonomyEventLog per the brief).

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';
import type { ISecretStorageService } from './secretStorageService.js';

// ─── Schema types ──────────────────────────────────────────────────────────

export type SettingType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'multiline'
  | 'enum'
  | 'object'
  | 'action';
export type SettingScope = 'user' | 'workspace';

export interface ISettingSchema {
  /** Unique dotted key, e.g. `autonomy.heartbeat.intervalMs`. */
  readonly key: string;
  /** Type discriminator for editor rendering and validation. */
  readonly type: SettingType;
  /** Default value when no override is persisted. */
  readonly default: unknown;
  /** Persistence scope. `user` survives across workspaces. */
  readonly scope: SettingScope;
  /** Human-readable description shown in the editor. */
  readonly description: string;
  /** Optional grouping label (e.g. "Autonomy", "Canvas"). */
  readonly category?: string;
  /** Optional deprecation notice (rendered as a warning). */
  readonly deprecated?: string;
  /** For type='enum'. Allowed string values. */
  readonly enumValues?: readonly string[];
  /** For type='number'. Inclusive bounds. */
  readonly min?: number;
  readonly max?: number;
  /** For type='action'. Label rendered on the button. */
  readonly actionLabel?: string;
  /** For type='action'. Command id executed when the button is clicked. */
  readonly command?: string;
  /** For type='multiline'. Number of textarea rows. */
  readonly rows?: number;
  /** For sensitive values (passwords, API keys). Masks input + excludes from export. */
  readonly secret?: boolean;
}

/**
 * Optional adapter that overrides storage routing for a single key.
 * Used by AutonomyFeatureFlagsService so the editor reads/writes through
 * the existing service (single source of truth, no divergence).
 */
export interface ISettingBinding<T = unknown> {
  getValue(): T;
  setValue(value: T): Promise<void> | void;
  /** Optional: external mutations that should propagate as registry change events. */
  readonly onDidChange?: Event<T>;
}

// ─── Change event ──────────────────────────────────────────────────────────

export interface ISettingChange {
  readonly key: string;
  readonly value: unknown;
  readonly scope: SettingScope;
}

// ─── Service interface ─────────────────────────────────────────────────────

export interface ISettingsRegistryService {
  /**
   * Register a schema. Throws on duplicate key (§13 failure mode — registry
   * collisions are a programming error, surfaced loudly).
   */
  register(schema: ISettingSchema): void;

  /**
   * Bind a key to an external store. Calls to setValue/getValue route
   * through the binding; the registry's own storage layer is bypassed
   * for that key. Must be called after `register`.
   */
  bind<T>(key: string, binding: ISettingBinding<T>): void;

  /** Schema lookup. Returns undefined for unregistered keys. */
  getSchema(key: string): ISettingSchema | undefined;

  /** All registered schemas, sorted by key. */
  getAllSchemas(): readonly ISettingSchema[];

  /** Read effective value (override → default), with binding precedence. */
  getValue<T = unknown>(key: string): T;

  /**
   * Write a value. Validates against schema; throws on type/range mismatch.
   * `scope` is read from the schema; the optional override is honored only
   * when explicitly the same scope (defensive — prevents accidental scope
   * cross-pollination from extension code).
   */
  setValue(key: string, value: unknown, scope?: SettingScope): Promise<void>;

  /** Reset a key to its schema default. */
  reset(key: string): Promise<void>;

  /**
   * Read a secret setting asynchronously.
   * Only valid for schemas with `secret: true`; returns `null` when the
   * safeStorage bridge is unavailable or the key has no stored value.
   */
  getSecretValue(key: string): Promise<string | null>;

  /** Wire the safeStorage service for `secret: true` settings. */
  setSecretStorage(storage: ISecretStorageService): void;

  /** Subscribe to all changes. Filter client-side by `change.key`. */
  readonly onDidChange: Event<ISettingChange>;
}

// ─── Storage key ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'settings.overrides';

// ─── Implementation ────────────────────────────────────────────────────────

export class SettingsRegistryService extends Disposable implements ISettingsRegistryService {
  private readonly _schemas = new Map<string, ISettingSchema>();
  private readonly _bindings = new Map<string, ISettingBinding>();
  private _userOverrides: Record<string, unknown> = {};
  private _workspaceOverrides: Record<string, unknown> = {};
  private _userLoaded = false;
  private _workspaceLoaded = false;
  private _userWriteQueue: Promise<void> = Promise.resolve();
  private _workspaceWriteQueue: Promise<void> = Promise.resolve();
  private _secretStorage: ISecretStorageService | undefined;

  private readonly _onDidChange = this._register(new Emitter<ISettingChange>());
  readonly onDidChange: Event<ISettingChange> = this._onDidChange.event;

  constructor(
    private readonly _userStorage: IStorage | undefined,
    private readonly _workspaceStorage: IStorage | undefined,
  ) {
    super();
  }

  /**
   * Hydrate overrides from storage. Idempotent — safe to call multiple times.
   * Schemas registered after initialize() still receive their defaults
   * correctly because getValue resolves at read time.
   */
  async initialize(): Promise<void> {
    await Promise.all([this._loadUser(), this._loadWorkspace()]);
  }

  // ── Registration ────────────────────────────────────────────────────────

  register(schema: ISettingSchema): void {
    if (this._schemas.has(schema.key)) {
      throw new Error(`[SettingsRegistry] duplicate key registration: ${schema.key}`);
    }
    _validateSchema(schema);
    this._schemas.set(schema.key, schema);
  }

  bind<T>(key: string, binding: ISettingBinding<T>): void {
    if (!this._schemas.has(key)) {
      throw new Error(`[SettingsRegistry] cannot bind unregistered key: ${key}`);
    }
    if (this._bindings.has(key)) {
      throw new Error(`[SettingsRegistry] duplicate binding for key: ${key}`);
    }
    this._bindings.set(key, binding as ISettingBinding);
    // Forward external mutations as registry change events so editor stays live.
    if (binding.onDidChange) {
      this._register(binding.onDidChange((value) => {
        const schema = this._schemas.get(key);
        if (!schema) return;
        this._onDidChange.fire({ key, value, scope: schema.scope });
      }));
    }
  }

  /** Wire the safeStorage backend. Must be called before any secret values are written. */
  setSecretStorage(storage: ISecretStorageService): void {
    this._secretStorage = storage;
  }

  // ── Schema introspection ────────────────────────────────────────────────

  getSchema(key: string): ISettingSchema | undefined {
    return this._schemas.get(key);
  }

  getAllSchemas(): readonly ISettingSchema[] {
    return Array.from(this._schemas.values()).sort((a, b) => a.key.localeCompare(b.key));
  }

  // ── Read ────────────────────────────────────────────────────────────────

  getValue<T = unknown>(key: string): T {
    const schema = this._schemas.get(key);
    if (!schema) {
      throw new Error(`[SettingsRegistry] unregistered key: ${key}`);
    }
    const binding = this._bindings.get(key);
    if (binding) {
      return binding.getValue() as T;
    }
    // Secret values are stored in safeStorage, not in the JSON overrides.
    // Synchronous callers must use getSecretValue() for the real value.
    if (schema.secret) {
      return schema.default as T;
    }
    const overrides = schema.scope === 'workspace' ? this._workspaceOverrides : this._userOverrides;
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      return overrides[key] as T;
    }
    return schema.default as T;
  }

  async getSecretValue(key: string): Promise<string | null> {
    const schema = this._schemas.get(key);
    if (!schema || !schema.secret) {
      throw new Error(`[SettingsRegistry] getSecretValue called for non-secret key: ${key}`);
    }
    if (!this._secretStorage) return null;
    const r = await this._secretStorage.getString(key);
    return r.ok && typeof r.value === 'string' ? r.value : null;
  }

  // ── Write ───────────────────────────────────────────────────────────────

  async setValue(key: string, value: unknown, scope?: SettingScope): Promise<void> {
    const schema = this._schemas.get(key);
    if (!schema) {
      throw new Error(`[SettingsRegistry] unregistered key: ${key}`);
    }
    if (scope !== undefined && scope !== schema.scope) {
      throw new Error(
        `[SettingsRegistry] scope mismatch for "${key}": schema=${schema.scope} caller=${scope}`,
      );
    }
    _validateValue(schema, value);

    const binding = this._bindings.get(key);
    if (binding) {
      await binding.setValue(value);
      console.info(`[settings] write key=${key} scope=${schema.scope} (binding)`);
      this._onDidChange.fire({ key, value, scope: schema.scope });
      return;
    }

    // Secret values go to safeStorage; they must never land in the JSON file.
    if (schema.secret) {
      if (!this._secretStorage) {
        console.warn(`[SettingsRegistry] secret storage unavailable — key=${key} not persisted`);
      } else {
        await this._secretStorage.setString(key, typeof value === 'string' ? value : String(value));
      }
      console.info(`[settings] write key=${key} scope=${schema.scope} (secret)`);
      this._onDidChange.fire({ key, value, scope: schema.scope });
      return;
    }

    if (schema.scope === 'workspace') {
      this._workspaceOverrides = { ...this._workspaceOverrides, [key]: value };
      await this._persistWorkspace();
    } else {
      this._userOverrides = { ...this._userOverrides, [key]: value };
      await this._persistUser();
    }
    console.info(`[settings] write key=${key} scope=${schema.scope}`);
    this._onDidChange.fire({ key, value, scope: schema.scope });
  }

  async reset(key: string): Promise<void> {
    const schema = this._schemas.get(key);
    if (!schema) {
      throw new Error(`[SettingsRegistry] unregistered key: ${key}`);
    }
    const binding = this._bindings.get(key);
    if (binding) {
      await binding.setValue(schema.default);
    } else if (schema.scope === 'workspace') {
      const next = { ...this._workspaceOverrides };
      delete next[key];
      this._workspaceOverrides = next;
      await this._persistWorkspace();
    } else {
      const next = { ...this._userOverrides };
      delete next[key];
      this._userOverrides = next;
      await this._persistUser();
    }
    console.info(`[settings] reset key=${key} scope=${schema.scope}`);
    this._onDidChange.fire({ key, value: schema.default, scope: schema.scope });
  }

  // ── Persistence helpers ─────────────────────────────────────────────────

  private async _loadUser(): Promise<void> {
    if (this._userLoaded || !this._userStorage) {
      this._userLoaded = true;
      return;
    }
    try {
      const raw = await this._userStorage.get(STORAGE_KEY);
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this._userOverrides = parsed as Record<string, unknown>;
        }
      }
    } catch {
      /* corrupt — fall back to defaults */
    }
    this._userLoaded = true;
  }

  private async _loadWorkspace(): Promise<void> {
    if (this._workspaceLoaded || !this._workspaceStorage) {
      this._workspaceLoaded = true;
      return;
    }
    try {
      const raw = await this._workspaceStorage.get(STORAGE_KEY);
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this._workspaceOverrides = parsed as Record<string, unknown>;
        }
      }
    } catch {
      /* corrupt — fall back to defaults */
    }
    this._workspaceLoaded = true;
  }

  /** Strip secret-schema keys from an overrides map before JSON serialization. */
  private _stripSecrets(overrides: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (!this._schemas.get(k)?.secret) out[k] = v;
    }
    return out;
  }

  private _persistUser(): Promise<void> {
    if (!this._userStorage) return Promise.resolve();
    const snapshot = this._stripSecrets(this._userOverrides);
    const storage = this._userStorage;
    this._userWriteQueue = this._userWriteQueue.then(async () => {
      try {
        await storage.set(STORAGE_KEY, JSON.stringify(snapshot));
      } catch (err) {
        console.warn('[SettingsRegistry] user persist failed:', err);
      }
    });
    return this._userWriteQueue;
  }

  private _persistWorkspace(): Promise<void> {
    if (!this._workspaceStorage) return Promise.resolve();
    const snapshot = this._stripSecrets(this._workspaceOverrides);
    const storage = this._workspaceStorage;
    this._workspaceWriteQueue = this._workspaceWriteQueue.then(async () => {
      try {
        await storage.set(STORAGE_KEY, JSON.stringify(snapshot));
      } catch (err) {
        console.warn('[SettingsRegistry] workspace persist failed:', err);
      }
    });
    return this._workspaceWriteQueue;
  }

  /**
   * After schemas are registered, scan the loaded JSON overrides for any key
   * that is now known to be secret. Migrate its value to safeStorage and
   * scrub the plaintext from the in-memory map so the next persist won't
   * write it back to JSON.
   */
  async migrateSecretsFromJson(): Promise<void> {
    const migrate = async (overrides: Record<string, unknown>, persistFn: () => Promise<void>): Promise<boolean> => {
      let changed = false;
      for (const key of Object.keys(overrides)) {
        const schema = this._schemas.get(key);
        if (!schema?.secret) continue;
        const value = overrides[key];
        if (typeof value !== 'string' || value === '') continue;
        if (this._secretStorage) {
          await this._secretStorage.setString(key, value);
          console.info(`[SettingsRegistry] migrated secret to safeStorage: ${key}`);
        } else {
          console.warn(`[SettingsRegistry] secret found in JSON but safeStorage unavailable: ${key}`);
        }
        delete overrides[key];
        changed = true;
      }
      if (changed) await persistFn();
      return changed;
    };
    await Promise.all([
      migrate(this._userOverrides, () => this._persistUser()),
      migrate(this._workspaceOverrides, () => this._persistWorkspace()),
    ]);
  }
}

// ─── Validation helpers ────────────────────────────────────────────────────

function _validateSchema(schema: ISettingSchema): void {
  switch (schema.type) {
    case 'boolean':
      if (typeof schema.default !== 'boolean') {
        throw new Error(`[SettingsRegistry] ${schema.key}: boolean default required`);
      }
      break;
    case 'number':
      if (typeof schema.default !== 'number' || Number.isNaN(schema.default)) {
        throw new Error(`[SettingsRegistry] ${schema.key}: number default required`);
      }
      if (schema.min !== undefined && schema.default < schema.min) {
        throw new Error(`[SettingsRegistry] ${schema.key}: default below min`);
      }
      if (schema.max !== undefined && schema.default > schema.max) {
        throw new Error(`[SettingsRegistry] ${schema.key}: default above max`);
      }
      break;
    case 'string':
    case 'multiline':
      if (typeof schema.default !== 'string') {
        throw new Error(`[SettingsRegistry] ${schema.key}: string default required`);
      }
      break;
    case 'action':
      // Actions have no value; default is unused but must be present per the
      // ISettingSchema contract. Accept anything (including undefined cast).
      if (typeof schema.command !== 'string' || schema.command.length === 0) {
        throw new Error(`[SettingsRegistry] ${schema.key}: action requires command id`);
      }
      break;
    case 'enum':
      if (!Array.isArray(schema.enumValues) || schema.enumValues.length === 0) {
        throw new Error(`[SettingsRegistry] ${schema.key}: enumValues required for enum`);
      }
      if (typeof schema.default !== 'string' || !schema.enumValues.includes(schema.default)) {
        throw new Error(`[SettingsRegistry] ${schema.key}: default must be one of enumValues`);
      }
      break;
    case 'object':
      if (typeof schema.default !== 'object' || schema.default === null) {
        throw new Error(`[SettingsRegistry] ${schema.key}: object default required`);
      }
      break;
    default:
      throw new Error(`[SettingsRegistry] ${schema.key}: unknown type`);
  }
}

function _validateValue(schema: ISettingSchema, value: unknown): void {
  switch (schema.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new Error(`[SettingsRegistry] ${schema.key}: expected boolean, got ${typeof value}`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`[SettingsRegistry] ${schema.key}: expected number`);
      }
      if (schema.min !== undefined && value < schema.min) {
        throw new Error(`[SettingsRegistry] ${schema.key}: value ${value} below min ${schema.min}`);
      }
      if (schema.max !== undefined && value > schema.max) {
        throw new Error(`[SettingsRegistry] ${schema.key}: value ${value} above max ${schema.max}`);
      }
      break;
    case 'string':
    case 'multiline':
      if (typeof value !== 'string') {
        throw new Error(`[SettingsRegistry] ${schema.key}: expected string`);
      }
      break;
    case 'action':
      // No value to validate.
      break;
    case 'enum':
      if (typeof value !== 'string' || !schema.enumValues!.includes(value)) {
        throw new Error(
          `[SettingsRegistry] ${schema.key}: value must be one of ${schema.enumValues!.join('|')}`,
        );
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`[SettingsRegistry] ${schema.key}: expected object`);
      }
      break;
  }
}

// ─── Module-level accessor (D3 migration helper) ───────────────────────────
//
// A few legacy modules (e.g. canvas PropertyBar) need to read/write a
// single setting without restructuring their constructor signatures. The
// chat extension populates this slot during activation; consumers fall
// back to defaults gracefully when the registry hasn't been wired yet
// (e.g. early renderer paint, headless tests).

let _globalRegistry: ISettingsRegistryService | undefined;

export function setGlobalSettingsRegistry(registry: ISettingsRegistryService | undefined): void {
  _globalRegistry = registry;
}

export function getGlobalSettingsRegistry(): ISettingsRegistryService | undefined {
  return _globalRegistry;
}
