---
description: These instructions provide guidelines for AI to follow when thinking, planning tasks, generating code, running code, creating files, deleting files, documenting changes, answering questions, or reviewing changes in the project.
# applyTo: 'Describe when these instructions should be loaded' # when provided, instructions will automatically be added to the request context when the pattern matches an attached file
---

## 0. Active Milestone Context

The current work is **Milestone 15 — AI Personality & Behavior Settings** (`docs/Parallx_Milestone_15.md`). Read the milestone document before implementing any M15 task. It adds a first-class AI Settings panel so users can configure how all AI in Parallx thinks, speaks, and behaves — without touching code or config files.

### Key M15 Constraints

- **Service first, UI second.** `IAISettingsService` must fully work (persist, reload, emit events) before building any UI panel.
- **One group at a time.** Complete and validate each group (tsc clean + all tests pass + git commit) before starting the next. Order: A (Foundation) → B (Wiring) → C (UI Primitives) → D (Core UI) → E (Persistence).
- **Commit per task.** Each numbered task gets its own commit for fine-grained rollback.
- **Test after every task.** `tsc --noEmit` + `npx vitest run` after each task.
- **Use existing patterns.** DI: `createServiceIdentifier` + `registerInstance`. Events: `Emitter<T>/Event<T>` — no event bus. CSS: `var(--vscode-*)` tokens — no `--parallx-*`. Storage: `IStorage` from `platform/storage.ts`.
- **System prompt injection via `promptOverlay`.** `buildSystemPrompt()` in `chatSystemPrompts.ts` already checks `promptOverlay`. M15 generates the persona block and passes it as `promptOverlay`.
- **Use `ILanguageModelsService` for all Ollama communication.** Do NOT call Ollama HTTP endpoints directly.
- **New UI primitives in `src/ui/` first.** Slider, Toggle, Dropdown, SegmentedControl, Textarea must exist before panel sections.
- **Built-in presets are immutable.** Writing to a `isBuiltIn: true` profile silently clones it.
- **Deferred capabilities (5–11) are NOT in scope** for the core milestone.

### Key M11 Constraints

- **Local-only AI via Ollama** (`localhost:11434`). No cloud providers, no API keys.
- **Skill-based tool system**: Each tool is a skill with a `SKILL.md` manifest. Built-in skills ship with Parallx; workspace skills live in `.parallx/skills/`.
- **Prompt file layering**: `SOUL.md` (personality) → `AGENTS.md` (project context) → `TOOLS.md` (tool instructions) → `.parallx/rules/*.md` (pattern-scoped). All at workspace root, user-editable.
- **Workspace digest**: Every system prompt includes a pre-computed workspace digest (~2000 tokens) — canvas page titles, file tree (depth 3), key file previews. The AI "already knows" the workspace.
- **3-tier permissions**: always-allowed / requires-approval / never-allowed. Per-skill config in `.parallx/permissions.json`.
- **Token budget manager**: System 10%, RAG 30%, History 30%, User 30%. Priority-based trimming.
- **`.parallxignore`**: Git-style patterns for both indexing exclusion and AI file access blocking.
- **Small model guidance**: qwen2.5:32b-instruct needs explicit behavioral rules and pre-loaded context. System prompts include tool chaining instructions and personality directives.

### Inherited M10 Constraints (Still Apply)

- **Embedding model**: `nomic-embed-text` v1.5 via Ollama `/api/embed`. Task prefixes: `search_document:` / `search_query:`.
- **Vector storage**: `sqlite-vec` with `vec0` virtual table, `float[768]`.
- **Hybrid retrieval**: Vector cosine similarity + FTS5 BM25, merged via RRF (k=60).
- **Workspace-wide scope**: Indexes canvas pages, workspace files, and all tool data sources.

### Inherited M9 Constraints (Still Apply)

- **Tiptap reuse** for chat rendering and input.
- **Session URIs**: `parallx-chat-session:///<uuid>`.
- **Token estimation**: `chars / 4`.
- **11+ built-in tools** (M9 base + M10 `search_knowledge` + M11 `write_file`, `edit_file`, `delete_file`, `run_command`).

### Canvas Gate Architecture

The canvas built-in (`src/built-in/canvas/`) has its own registry-gated architecture. The original canvas core used five gates; the live enforced model now includes the integrated database gate as well. Full rules are in the archived instructions file (`.github/instructions/archive/parallx-instructions-pre-m9.instructions.md`) and in `ARCHITECTURE.md`. When working on canvas code, consult those references.

---

## 1. Role

- Think in steps. Document after each step. Verify quality against the full project scope before moving on.
- Ask clarification questions when requirements are ambiguous. Proactively identify issues before they become problems.
- Always consider how the user will interact with each piece of UI and how it fits into the overall experience.
- Follow the principle of "never reinvent the wheel" — if VS Code has a proven solution, adapt it for Parallx.
- After completing a task, mark it ✅ in the relevant milestone file. If the implementation deviated significantly, note the deviation alongside the completion marker.

---

## 2. Project Vision

Parallx is a **second-brain workbench** — VS Code's architecture repurposed as a tool platform. The shell hosts domain-specific tools and extensions (note-taking, task management, knowledge graphs, AI workflows, etc.) the same way VS Code hosts language extensions. The tool API (`parallx.*`) mirrors `vscode.*` in shape.

**Core principles:**

1. **Mirror VS Code's structure.** Workbench, grid layout, parts, views, editor groups, command palette, keybindings, service layer, DI, and tool API all follow VS Code's proven architecture.
2. **Never reinvent the wheel.** If VS Code solves a problem (tree views, tab management, settings, notifications, quick pick, etc.), follow their approach.
3. **Tools, not code editing.** Where VS Code has language servers and debuggers, Parallx has tools — self-contained extensions providing views, editors, commands, and panels.

---

## 3. Authoritative References

Always consult these **before** writing any implementation code:

| Source | Use for | URL |
|--------|---------|-----|
| **DeepWiki** | High-level architecture, component relationships, design patterns | https://deepwiki.com/microsoft/vscode |
| **VS Code source** | Concrete implementation — class hierarchy, DOM structure, CSS, event flow | https://github.com/microsoft/vscode |
| **VS Code Wiki** | Feature overviews, architecture decisions | https://github.com/microsoft/vscode/wiki |
| **VS Code API docs** | Extension API surface (our `parallx.*` mirrors this) | https://code.visualstudio.com/api |

**Rule:** Do NOT invent custom patterns when VS Code has a proven approach. Adapt their solution for Parallx.

---

## 4. VS Code Parity Checklist (mandatory per capability)

Every capability must complete these steps. Skipping them causes broken patterns that require rework.

### Before writing code

1. **DeepWiki** — Read the relevant page(s). Understand architecture, classes, and interactions.
2. **VS Code TypeScript source** — Read the `.ts` files for the feature. Note class hierarchy, method signatures, DOM structure, event handling, and service dependencies.
3. **VS Code CSS source** — Read the co-located CSS. Note what IS set, what is NOT set, z-index stacking, position schemes.
4. **Document findings** — Briefly record what VS Code does, what Parallx will do, and any deliberate deviations with rationale.

### During implementation

5. **Match DOM structure** — Same nesting, same class names where practical, same creation order (`prepend` vs `append` matters).
6. **Match CSS approach** — Follow VS Code's choices for properties, absence of properties, and layering strategy.
7. **Match abstractions** — If VS Code uses a service, use the Parallx equivalent. No `window.parallxElectron` in Part/View classes. No direct IPC from UI code.

### After implementation

8. **Compare DOM** — DevTools comparison against VS Code for the same component.
9. **Compare CSS** — Verify key computed properties (drag regions, z-index, overflow, position).
10. **Test interactions** — Verify dragging, clicking, keyboard nav actually work — not just rendering.

---

## 5. File & Naming Conventions

| Category | Convention | Example |
|----------|-----------|---------|
| TypeScript files | `camelCase.ts` | `editorService.ts`, `commandRegistry.ts` |
| CSS files | `camelCase.css`, co-located with `.ts` | `notificationService.css` |
| Unit tests | `tests/unit/<feature>.test.ts` | `fileService.test.ts` |
| E2E tests | `tests/e2e/<NN>-<kebab-case>.spec.ts` | `09-canvas.spec.ts` |
| Barrel files | **None.** No `index.ts`. Every import targets a specific file. |
| Electron entry files | `.cjs` extension (CommonJS) | `main.cjs`, `preload.cjs` |

---

## 6. Import Conventions

- **Source files** use relative imports with `.js` extensions (ESM compat for esbuild):
  ```ts
  import { Disposable } from '../platform/lifecycle.js';
  import { Emitter, Event } from '../platform/events.js';
  ```
- **Type-only imports** use `import type`:
  ```ts
  import type { IEditorInput } from '../editor/editorInput.js';
  ```
- **CSS imports** are side-effect imports in the `.ts` file that owns the styles:
  ```ts
  import './myComponent.css';
  ```
- **Test files** use relative imports **without** `.js` extensions (Vitest resolves them):
  ```ts
  import { FileService } from '../../src/services/fileService';
  ```
- Path aliases exist in `tsconfig.json` but are **not used** in production source. All source uses relative paths.

---

## 7. Service & DI Conventions

### Interface + identifier pattern

Each service has a dual-purpose constant in `src/services/serviceTypes.ts`:

```ts
// Interface (type position)
export interface ILayoutService extends IDisposable {
  readonly container: HTMLElement | undefined;
  layout(): void;
}

// DI key (value position) — same name
export const ILayoutService = createServiceIdentifier<ILayoutService>('ILayoutService');
```

### Service implementation pattern

1. Extend `Disposable` (from `platform/lifecycle.ts`).
2. Implement the interface from `serviceTypes.ts`.
3. Register events with `this._register(new Emitter<T>())`.
4. Expose events as `readonly onDidX: Event<T>`.
5. Use `_` prefixed private fields.

### DI registration

Services are wired manually in `src/workbench/workbenchServices.ts`:

```ts
services.registerInstance(ICommandService, new CommandService(services));
```

No auto-scanning. Dependencies passed via constructor. Both eager (`registerInstance`) and lazy (`register` with `ServiceDescriptor`) modes available.

---

## 8. UI Component Rules

Vanilla TypeScript classes extending `Disposable`, `Emitter<T>` for events, co-located CSS. No frameworks. No web components. No external UI libraries unless explicitly approved.

### Component architecture

All reusable primitives live in `src/ui/` (mirrors VS Code's `src/vs/base/browser/ui/`). Feature code **consumes** `src/ui/` components — it does not create raw DOM for standard widgets.

### Component contract

Every `src/ui/` component must:

1. Extend `Disposable` (from `platform/lifecycle.ts`) — cleanup via `_register()`.
2. Accept `(container: HTMLElement, options?: TOptions)` in constructor.
3. Use CSS classes from a co-located `.css` file — no inline styles for visual properties.
4. Fire events via `Emitter<T>` — expose as `readonly onDidX: Event<T>`.
5. Accept styles/theme as a config object — never hardcode colors.
6. Be context-agnostic — a `TabBar` must not know whether it's in the editor or sidebar.

### Feature code rules

1. **No raw `document.createElement` for standard widgets.** Use `src/ui/` components.
2. **No inline `element.style.*` for visual properties.** Only computed dimensions (layout-driven `width`/`height`) may be inline. Everything else goes in CSS classes.
3. **Check `src/ui/` before implementing any visual element.** Extend or compose existing components — do not duplicate.
4. **Components compose components.** `Dialog` uses `ButtonBar`. `QuickAccess` uses `InputBox` + `FilterableList`. Delegate, don't flatten.

### Dependency rules for `src/ui/`

- `ui/` may depend on `platform/` only (events, lifecycle, types).
- `ui/` must NOT depend on `services/`, `parts/`, `views/`, `editor/`, `commands/`, `context/`, or any other module.
- Feature modules (`parts/`, `views/`, `editor/`, `commands/`) may depend on `ui/`.

---

## 9. CSS Conventions

| Pattern | Example |
|---------|---------|
| UI components: `ui-` prefix | `.ui-button`, `.ui-input-box` |
| Workbench parts: `part-` prefix | `.part`, `.part-content` |
| Domain features: `parallx-` prefix | `.parallx-drop-overlay`, `.parallx-notification` |
| Modifiers: double-dash | `.ui-button--secondary`, `.ui-button--disabled` |
| Sub-elements: double-underscore (occasional) | `.contributed-view-placeholder__name` |

- All colors use CSS custom properties — primarily `--vscode-*` tokens from `ThemeService`. Always provide fallback values.
- No CSS framework, no CSS-in-JS, no scoped styles.
- Section comments use: `/* ── Section Name ── */`

---

## 10. Test Conventions

### Unit tests (Vitest)

- Location: `tests/unit/<feature>.test.ts`
- Globals enabled: `describe`, `expect`, `it`, `beforeEach`, `vi` available without import (or import from `vitest`).
- For DOM-dependent tests, add `// @vitest-environment jsdom` at the top of the file.
- Run: `npx vitest run` (single), `npx vitest` (watch).

### E2E tests (Playwright)

- Location: `tests/e2e/<NN>-<kebab-case-name>.spec.ts` (numbered for ordering).
- Import fixtures: `import { test, expect } from './fixtures';` (custom Electron fixtures in `tests/e2e/fixtures.ts`).
- Workers: 1 (serial execution). Timeout: 60s.
- Run: `npx playwright test`.

### When to write tests

- Every new service must have a unit test covering its public API.
- Every new command must be exercised in an existing or new E2E test.
- Bug fixes should include a regression test when the fix is non-trivial.

---

## 11. Build & Run

| Command | What it does |
|---------|-------------|
| `npm run build` | `tsc --noEmit` + esbuild bundle |
| `npm run dev` | Build + launch Electron |
| `npm run test:unit` | Vitest single run |
| `npm run test:e2e` | Playwright full suite |

- Module format: ESM (`"type": "module"` in `package.json`). Electron files are `.cjs`.
- TypeScript is for type checking only (`tsc --noEmit`). esbuild handles bundling (IIFE, ES2022, browser).
- Entry: `src/main.ts` → `dist/renderer/main.js` + `dist/renderer/main.css`.

---

## 12. Bug Diagnosis Rules

1. **No code is trusted.** Do not assume any code is correct — including code written earlier in the same session. Every line on the failure path is a suspect until proven innocent by reasoning about real runtime values.
2. **Start at the symptom, work backward.** Spend 80% of diagnosis time on the code nearest to the failure point. Do not explore tangential systems until the primary path is eliminated.
3. **Simulate runtime values, don't just read logic.** For any conditional, ask: "What actual values will these variables hold when this line executes?"
4. **State your ranked suspect list before investigating.** Write a numbered list of most-likely-to-least-likely causes. Investigate in that order — go deep on #1 first.

