# F11 R3 Gap Map: AI Configuration Surface

**Date:** 2026-03-27
**Source audit:** `docs/F11_AI_CONFIGURATION_SURFACE_AUDIT_R3.md`
**Upstream:** `github.com/openclaw/openclaw` commit e635cedb
**Scope:** 6 change plans covering all non-ALIGNED settings from the R3 audit (S3–S15).

---

## Change Plan Overview

| Gap | Description | Files | Risk |
|-----|-------------|-------|------|
| G01 | Remove dead Model settings (S11, S12) | `modelSection.ts` | MEDIUM |
| G02 | Remove Indexing section (S14) | `aiSettingsPanel.ts` | LOW |
| G03 | Document INVENTION settings (S3–S10, S15) | `unifiedConfigTypes.ts` | LOW |
| G04 | Harden Max Iterations floor (S10) | `openclawDefaultParticipant.ts` | MEDIUM |
| G05 | Update tests for G01 + G02 | `aiSettingsPanel.test.ts` | LOW |
| G06 | Mark dead config fields @deprecated (S11, S12, S13) | `unifiedConfigTypes.ts` | LOW |

---

## G01: Remove Dead Settings from Model Section (S11, S12)

- **Status:** DEAD → REMOVED
- **Audit findings:** S11 (Default Model dropdown) and S12 (Context Window input) are dead UI controls. Runtime reads model from `chatConfig.get('defaultModel')` not unified config (S11). Runtime reads context window from Ollama API `getModelContextLength()` not unified config (S12).
- **Upstream:** No configuration surface for these in upstream. Upstream resolves model from `agents.defaults.models` YAML and context window from provider API — neither is a user-facing dropdown.
- **Parallx file:** [src/aiSettings/ui/sections/modelSection.ts](src/aiSettings/ui/sections/modelSection.ts)

### What to change

**Remove from class fields (lines 28–33):**
- Delete `_defaultModelDropdown!: Dropdown`
- Delete `_contextWindowInput!: InputBox`
- Delete `_languageModelsService` field
- Delete `_isLoadingModels` flag

**Remove from imports (lines 14–17):**
- Delete `import { Dropdown }` and `import type { IDropdownItem }`
- Delete `import type { ILanguageModelsService }`

**Remove from constructor (line 38):**
- Remove `languageModelsService?: ILanguageModelsService` parameter

**Remove from `build()` method:**
- Delete the entire `// ── Default Model ──` block (lines 42–71): `createSettingRow` for `model.defaultModel`, `Dropdown` instantiation, `onDidChange` handler, `_addRow`, `_loadModelOptions()` call, and `onDidChangeModels` listener.
- Delete the entire `// ── Context Window ──` block (lines 131–152): `createSettingRow` for `model.contextWindow`, `InputBox` instantiation, `onDidChange` handler, `_addRow`.

**Remove from `update()` method:**
- Delete the `// Default model` block (lines 157–159): `_defaultModelDropdown.value` sync.
- Delete the `// Context window` block (lines 172–175): `_contextWindowInput.value` sync.

**Remove `_loadModelOptions()` method entirely (lines 180–201).**

**Keep:** Temperature slider + Max Response Tokens input + reset section link. These are the 2 surviving ALIGNED rows (S1, S2).

### Verification
- `ModelSection.build()` produces exactly 2 rows: `model.temperature` and `model.maxTokens`.
- `ModelSection` constructor takes only `(service: IAISettingsService)` — no `languageModelsService`.
- No remaining references to `Dropdown`, `IDropdownItem`, `ILanguageModelsService`, `_isLoadingModels`, `_loadModelOptions` in this file.

### Risk: MEDIUM
- **Impact:** Any caller passing `languageModelsService` to `ModelSection` will get a TS error. The panel constructor in `aiSettingsPanel.ts` passes it on [line 89](src/aiSettings/ui/aiSettingsPanel.ts#L89): `new ModelSection(this._service, this._languageModelsService)` — must be updated to `new ModelSection(this._service)`.
- **Cross-file:** `aiSettingsPanel.ts` line 89 — remove second argument from `ModelSection` constructor call.
- **Cross-file:** If `ILanguageModelsService` is no longer used anywhere in `aiSettingsPanel.ts` after G02 (IndexingSection also doesn't use it), check if the import + constructor parameter can be removed from the panel itself. Keep if other sections or the panel body still reference it.

---

## G02: Remove Indexing Section from Panel (S14)

- **Status:** DEAD → REMOVED
- **Audit findings:** S14 — Indexing section exposes 4 UI controls (`autoIndex`, `watchFiles`, `maxFileSize`, `excludePatterns`) with zero runtime consumers. The indexing pipeline reads hardcoded defaults, not unified config.
- **Upstream:** No user-facing indexing configuration in upstream. Upstream indexing is fully server-managed.
- **Parallx file:** [src/aiSettings/ui/aiSettingsPanel.ts](src/aiSettings/ui/aiSettingsPanel.ts)

### What to change

**Remove from imports (line 26):**
```ts
// DELETE:
import { IndexingSection } from './sections/indexingSection.js';
```

**Remove from `_sections` array (line 90):**
```ts
// DELETE this line from the array:
this._register(new IndexingSection(this._service, this._unifiedConfigService)),
```
Sections go from 8 → 7: Chat, Model, Retrieval, Agent, Tools, Advanced, Preview.

**Remove from `_buildNav()` — `navSections` array (line 118):**
```ts
// DELETE this entry:
{ id: 'indexing', label: 'Indexing' },
```
Nav items go from 8 → 7.

### Verification
- Panel renders 7 sections, 7 nav items.
- No remaining reference to `IndexingSection` in `aiSettingsPanel.ts`.
- The `indexingSection.ts` file itself is NOT deleted — it's dead code but deletion is out of scope for a config surface audit. (A separate cleanup pass can remove it.)

### Risk: LOW
- No runtime consumer reads indexing config, so removing the UI surface has zero functional impact.
- The `IndexingSection` class file remains importable for any future use.

---

## G03: Document INVENTION Settings (S3–S10, S15)

- **Status:** INVENTION → INVENTION (documented)
- **Audit findings:** 9 settings have no upstream OpenClaw equivalent. They are legitimate Parallx-specific desktop adaptations but must be explicitly documented as such to prevent future parity confusion.
- **Parallx file:** [src/aiSettings/unifiedConfigTypes.ts](src/aiSettings/unifiedConfigTypes.ts)

### What to change

Add `@parallx-specific` JSDoc annotations to each INVENTION field. Changes by interface:

**`IUnifiedRetrievalConfig` (line 103–118):**

| Field | Annotation to add |
|-------|-------------------|
| `autoRag` | `@parallx-specific No upstream equivalent. Upstream context engine always runs if configured. Desktop toggle to disable RAG when workspace is empty.` |
| `ragDecompositionMode` | `@parallx-specific No upstream equivalent. Decomposes user query into sub-queries for broader recall.` |
| `ragCandidateBreadth` | `@parallx-specific Loosely inspired by upstream candidateMultiplier (numeric), but remapped to balanced/broad enum.` |
| `ragTopK` | `@parallx-specific Upstream has memorySearch.query.maxResults (YAML) but configures a different retrieval system.` |
| `ragMaxPerSource` | `@parallx-specific No upstream equivalent. Caps chunks from a single source to prevent context monopolization.` |
| `ragTokenBudget` | `@parallx-specific No upstream equivalent. Upstream memory search has no token budget concept.` |
| `ragScoreThreshold` | `@parallx-specific Upstream has memorySearch.query.minScore (YAML) but configures a different retrieval system.` |

**`IUnifiedAgentConfig` (line 148):**

| Field | Annotation to add |
|-------|-------------------|
| `maxIterations` | `@parallx-specific Upstream hardcodes MAX_RUN_LOOP_ITERATIONS = 24 + 8/profile. Parallx exposes as user setting with floor guard (see G04).` |

**`IUnifiedChatConfig` (line 53–63):**

| Field | Annotation to add |
|-------|-------------------|
| `workspaceDescription` | `@parallx-specific No upstream equivalent. Upstream uses bootstrap files only. Desktop adaptation for workspace semantic grounding.` |

### Verification
- Every field classified INVENTION in the R3 audit has a `@parallx-specific` JSDoc tag.
- No behavioral change — documentation only.

### Risk: LOW
- Pure documentation. Zero runtime impact.

---

## G04: Harden Max Iterations Floor (S10)

- **Status:** INVENTION → INVENTION (hardened)
- **Audit findings:** S10 — `maxIterations` is a user-facing setting with no minimum floor. A user setting it to 1 would make the agent effectively useless (one tool call then stop). Upstream hardcodes 24+8 iterations, never allowing user to go below that.
- **Upstream:** `MAX_RUN_LOOP_ITERATIONS = 24` + `8` per profile in `agent-runner-execution.ts`. Not user-configurable.
- **Parallx file:** [src/openclaw/participants/openclawDefaultParticipant.ts](src/openclaw/participants/openclawDefaultParticipant.ts)

### What to change

**Add floor constant (after line 221):**
```ts
const OPENCLAW_MAX_AGENT_ITERATIONS = 6;
const OPENCLAW_MIN_AGENT_ITERATIONS = 4; // ← ADD
const OPENCLAW_MAX_READONLY_ITERATIONS = 3;
```

**Modify maxIterations calculation (line 263):**
```ts
// BEFORE:
const maxToolIterations = request.mode === ChatMode.Agent
  ? Math.min(services.maxIterations ?? OPENCLAW_MAX_AGENT_ITERATIONS, OPENCLAW_MAX_AGENT_ITERATIONS)
  : OPENCLAW_MAX_READONLY_ITERATIONS;

// AFTER:
const maxToolIterations = request.mode === ChatMode.Agent
  ? Math.max(OPENCLAW_MIN_AGENT_ITERATIONS, Math.min(services.maxIterations ?? OPENCLAW_MAX_AGENT_ITERATIONS, OPENCLAW_MAX_AGENT_ITERATIONS))
  : OPENCLAW_MAX_READONLY_ITERATIONS;
```

Logic: `Math.max(4, Math.min(userValue ?? 6, 6))` — user value is clamped to [4, 6]. If the user sets `maxIterations` to 1, runtime uses 4. If they set it to 100, runtime uses 6.

### Verification
- With `maxIterations = 1` in config, runtime `maxToolIterations` should be 4.
- With `maxIterations = 6`, runtime `maxToolIterations` should be 6.
- With `maxIterations = undefined`, runtime `maxToolIterations` should be 6 (default).
- Readonly modes are unaffected (always 3).

### Risk: MEDIUM
- **Behavioral change:** Users who previously set `maxIterations` below 4 will now get 4 iterations instead. This is intentional — the floor prevents a broken agent experience.
- **No API surface change** — the setting itself remains; only the runtime clamping changes.

---

## G05: Update Tests for Model Section + Panel Changes (G01 + G02)

- **Status:** Tests must reflect G01 and G02 changes.
- **Parallx file:** [tests/unit/aiSettingsPanel.test.ts](tests/unit/aiSettingsPanel.test.ts)

### What to change

**ModelSection tests (lines 381–412):**

1. **Row count assertion (line 387):** Change `expect(rows.length).toBe(4)` → `expect(rows.length).toBe(2)`.

2. **Remove setting key expectations (lines 390, 393):**
   - Delete: `expect(keys).toContain('model.defaultModel');`
   - Delete: `expect(keys).toContain('model.contextWindow');`
   - Keep: `expect(keys).toContain('model.temperature');` and `expect(keys).toContain('model.maxTokens');`

3. **Constructor call (implicit):** `ModelSection` tests already use `new ModelSection(service as any)` without `languageModelsService`, so no change needed there.

**SettingsSection base tests (lines 151–169):**

4. **`applySearch` row count assertion (line 159):** Change `expect(matches).toBeGreaterThanOrEqual(4)` → `expect(matches).toBeGreaterThanOrEqual(2)` (only 2 rows now: temperature, maxTokens).

**AISettingsPanel tests (lines 216–253):**

5. **Nav count assertion (line 220):** Change `expect(navItems.length).toBe(8)` → `expect(navItems.length).toBe(7)`.

6. **Nav label assertions (lines 225–228):** Remove the `Indexing` entry and shift remaining indices:
   ```ts
   expect(navItems[0].textContent).toBe('Chat');
   expect(navItems[1].textContent).toBe('Model');
   expect(navItems[2].textContent).toBe('Retrieval');
   expect(navItems[3].textContent).toBe('Agent');
   expect(navItems[4].textContent).toBe('Tools');     // was [5]
   expect(navItems[5].textContent).toBe('Advanced');   // was [6]
   expect(navItems[6].textContent).toBe('Preview');    // was [7]
   ```

7. **Section count assertion (line 237):** Change `expect(sections.length).toBe(8)` → `expect(sections.length).toBe(7)`.

8. **Section IDs assertion (line 239):** Remove `'indexing'` from expected array:
   ```ts
   expect(ids).toEqual(['chat', 'model', 'retrieval', 'agent', 'tools', 'advanced', 'preview']);
   ```

### Verification
- All tests pass with `vitest run tests/unit/aiSettingsPanel.test.ts`.
- No remaining `indexing` references in test expectations.
- ModelSection tests assert exactly 2 rows with keys `model.temperature` and `model.maxTokens`.

### Risk: LOW
- Test-only changes. No production code impact.

---

## G06: Mark Dead Config Fields @deprecated (S11, S12, S13)

- **Status:** DEAD → @deprecated
- **Audit findings:** S11 (`chatModel`/`defaultModel`), S12 (`contextWindow`), S13 (`embeddingModel`) are dead fields — UI is being removed (G01) or config is hardcoded at runtime.
- **Parallx file:** [src/aiSettings/unifiedConfigTypes.ts](src/aiSettings/unifiedConfigTypes.ts)

### What to change

**`IUnifiedModelConfig` (lines 72–80):**

```ts
export interface IUnifiedModelConfig {
  /** @deprecated F11-R3: Dead field — runtime reads model from chatConfig.get('defaultModel'), not unified config. UI removed in G01. */
  readonly chatModel: string;
  /** @deprecated F11-R3: Dead field — runtime hardcodes nomic-embed-text. No UI surface. */
  readonly embeddingModel: string;
  /** 0.0 = deterministic, 1.0 = creative */
  readonly temperature: number;
  /** Max tokens per response (0 = model default) */
  readonly maxTokens: number;
  /** @deprecated F11-R3: Dead field — runtime reads context window from Ollama API getModelContextLength(). UI removed in G01. */
  readonly contextWindow: number;
}
```

### Verification
- `chatModel`, `embeddingModel`, `contextWindow` all have `@deprecated` tags with F11-R3 reference and explanation of why they're dead.
- `temperature` and `maxTokens` are unchanged (ALIGNED).
- No behavioral change — the fields remain in the interface for type compatibility; only the JSDoc changes.

### Risk: LOW
- Pure documentation. TypeScript will surface deprecation warnings in IDEs for any code still referencing these fields, which is the desired outcome.

---

## Dependency Order

```
G03 (doc annotations)     ── no deps, can run first
G06 (deprecation tags)    ── no deps, can run in parallel with G03
G01 (remove dead UI)      ── no deps on G03/G06, but should run before G05
G02 (remove indexing nav)  ── no deps, can run in parallel with G01
G04 (iterations floor)    ── no deps, independent
G05 (test updates)        ── depends on G01 + G02 (must run after both)
```

Recommended execution order: **G03 → G06 → G01 + G02 (parallel) → G04 → G05**

---

## Cross-File Impact Summary

| Source change | Impacted file | What to update |
|--------------|---------------|----------------|
| G01: `ModelSection` constructor signature | `aiSettingsPanel.ts` line 89 | Remove `this._languageModelsService` argument |
| G02: Remove `IndexingSection` | `aiSettingsPanel.ts` lines 26, 90, 118 | Remove import, instantiation, nav entry |
| G01 + G02: Row/section counts | `aiSettingsPanel.test.ts` | See G05 |
| G04: New constant | `openclawDefaultParticipant.ts` only | No cross-file impact |
| G03 + G06: JSDoc only | `unifiedConfigTypes.ts` only | No cross-file impact |

---

## Out of Scope

- **Deleting `indexingSection.ts` file** — dead code removal is a separate cleanup concern.
- **Removing `IUnifiedIndexingConfig` from `IUnifiedAIConfig`** — type removal would cascade to serialization, defaults, migration. Defer to a separate type cleanup pass.
- **Removing `ILanguageModelsService` from `aiSettingsPanel.ts` constructor** — other sections or future features may need it. Only remove the argument to `ModelSection`.
- **Fixing the S11 disconnect** (runtime reads `chatConfig.get('defaultModel')` instead of unified config) — that's a runtime wiring fix, not a config surface fix. Tracked separately.
