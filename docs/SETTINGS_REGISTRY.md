# Settings Registry — M60 §7

The settings registry is Parallx's unified, schema-driven configuration
surface. It owns validation, persistence, change events, and scope routing
for any setting an extension or service wants exposed to the user.

> **Status:** Implemented in M60 Phase ε (T4.D1, T4.D2, T4.D3).
> **DI token:** `ISettingsRegistryService` (registered by the Chat extension on activation).
> **Persistence:** M53 portable storage — `data/global-storage.json` for user scope, `<workspaceRoot>/.parallx/workspace-storage.json` for workspace scope.

---

## Why a new service

`AISettingsService` is profile-shaped (named presets + persona) and is
not a flat key→value map. `AutonomyFeatureFlagsService` IS flat (eleven
boolean flags) and adapter-binds cleanly into the registry. The registry
sits as a peer of both: it does **not** replace either, but it provides
a single editor surface and a uniform schema so any setting (autonomy
flags, substrate intervals, canvas UI prefs, indexing toggles, etc.)
can be rendered, validated, and persisted the same way.

## Schema

```ts
interface ISettingSchema {
  key: string;                    // dotted path, e.g. 'autonomy.heartbeat.intervalMs'
  type: 'boolean' | 'number' | 'string' | 'enum' | 'object';
  default: unknown;
  scope: 'user' | 'workspace';
  description: string;
  category?: string;              // grouping label in editor (e.g. 'Autonomy')
  deprecated?: string;            // shows a warning row in editor
  enumValues?: readonly string[]; // required for type='enum'
  min?: number;                   // type='number' inclusive lower bound
  max?: number;                   // type='number' inclusive upper bound
}
```

## API

```ts
interface ISettingsRegistryService {
  register(schema: ISettingSchema): void;
  bind<T>(key: string, binding: ISettingBinding<T>): void;
  getSchema(key: string): ISettingSchema | undefined;
  getAllSchemas(): readonly ISettingSchema[];
  getValue<T>(key: string): T;
  setValue(key: string, value: unknown, scope?: SettingScope): Promise<void>;
  reset(key: string): Promise<void>;
  readonly onDidChange: Event<ISettingChange>;
}
```

- `register` — throws on duplicate key (programming error, surfaced loudly).
- `bind` — opt-in adapter when an external service owns the canonical
  store (e.g. `AutonomyFeatureFlagsService`). Reads/writes route through
  the binding, bypassing the registry's own JSON persistence. The
  optional `onDidChange` event lets external mutations propagate as
  registry change events so the editor stays in sync.
- `getValue` — resolves binding → override → schema default.
- `setValue` — validates type and bounds, persists serialized through a
  per-scope write queue (§3.7), then fires `onDidChange`.
- `reset` — removes the override (or rewrites the binding to the schema
  default) and fires `onDidChange`.

## Scope semantics

| Scope       | Storage                                                | Survives… |
| ----------- | ------------------------------------------------------ | --------- |
| `user`      | `<APP_ROOT>/data/global-storage.json` (M53)            | workspace switch, app restart |
| `workspace` | `<workspaceRoot>/.parallx/workspace-storage.json` (M53) | app restart only |

A `setValue` call with an explicit `scope` mismatch throws — defensive
guard against accidental scope cross-pollination from extension code.

## Registering a setting

```ts
const reg: ISettingsRegistryService = api.services.get(ISettingsRegistryService);

reg.register({
  key: 'myExt.feature.enabled',
  type: 'boolean',
  default: true,
  scope: 'user',
  description: 'Enables the experimental feature.',
  category: 'My Extension',
});

const enabled = reg.getValue<boolean>('myExt.feature.enabled');
```

## Binding to an existing service (no double-store)

```ts
// AutonomyFeatureFlagsService owns the truth — adapter-bind so the
// editor reads/writes through the existing service.
reg.register({
  key: 'autonomy.heartbeat',
  type: 'boolean',
  default: false,
  scope: 'user',
  description: 'Periodic background autonomy heartbeat.',
  category: 'Autonomy',
});

const onChange = new Emitter<boolean>();
flags.onDidChange((evt) => {
  if (evt.id === 'autonomy.heartbeat') onChange.fire(evt.value);
});
reg.bind<boolean>('autonomy.heartbeat', {
  getValue: () => flags.isEnabled('autonomy.heartbeat'),
  setValue: (v) => flags.setEnabled('autonomy.heartbeat', v),
  onDidChange: onChange.event,
});
```

## Editor UI

The Settings extension contributes the `settings.open` command
(`Ctrl+,`). The editor renders an Overlay with a search box, a
scope segmented control (All / User / Workspace), and one row per
schema grouped by category. Controls are type-driven:

- `boolean` → `Toggle` (snaps back on validation failure)
- `number` / `string` → `InputBox` (commits on Enter / blur)
- `enum` → `Dropdown`
- `object` → `<textarea>` with JSON parse + status indicator

Each row has a Reset (↺) button that calls `registry.reset(key)`.

## Observability (§3.10)

`setValue` and `reset` emit `console.info('[settings] write key=… scope=…')`
log lines. Settings writes are user actions, not autonomy events —
they are explicitly **not** routed through `AutonomyEventLog`.

## Concurrency (§3.7)

Per-scope writes are serialized through a `Promise` chain
(`_userWriteQueue`, `_workspaceWriteQueue`). Concurrent `setValue`
calls are queued so the on-disk JSON is never written from two
overlapping callers.

## Failure modes (§13)

| Failure | Behaviour |
| ------- | --------- |
| Duplicate `register(key)` | Throws synchronously. |
| Type mismatch in `setValue` | Throws synchronously, no write. |
| Number out of range | Throws synchronously, no write. |
| Enum value not in allowlist | Throws synchronously, no write. |
| Storage write rejection | Logged via `console.warn`; in-memory override is preserved so the user sees their value (until restart). |
| Corrupt persisted JSON | `initialize()` falls back to defaults; corrupt blob is overwritten on next write. |

## Feature flag

`settings.editor.enabled` (boolean, user scope, default `true`).
When `false`, the `settings.open` command logs and returns without
opening the overlay — used for emergency rollback (§3.8).

## Boundary confirmation (§3.4)

Phase ε is contained:

- No edits to `src/main.ts`, `electron/main.cjs`, or any new IPC handler.
- No new core schema fields or workspace layout slots.
- Only existing extension boundaries: `built-in/chat/main.ts` (registry
  construction), `built-in/settings/` (new extension), and
  `built-in/canvas/properties/propertyBar.ts` (D3 migration consumer).
- The single `src/workbench/workbench.ts` builtins-array entry follows
  the same pattern as `THEME_EDITOR_MANIFEST`.
