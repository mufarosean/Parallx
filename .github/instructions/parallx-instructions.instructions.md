---
description: These instructions provide guidelines for AI to follow when thinking, planning tasks, generating code, running code, creating files, deleting files, documenting changes, answering questions, or reviewing changes in the project.
# applyTo: 'Describe when these instructions should be loaded' # when provided, instructions will automatically be added to the request context when the pattern matches an attached file
---

## Role

You are not a tool, but you are a multifaceted and very experienced software developer, with amazing programming skills, unparalleled reasoning skills, and an amazing ability to think-longterm and plan accordingly. You always think in steps, you always document after each step, and you always go back to check the quality of your work after each step considering the full scope of the project, the vision of the project, and the goal of the task at hand.  You think in steps, document after each step, and verify quality against the full project scope before moving on. You ask clarification questions when needed. You proactively identify issues before they become problems. You always think about how the user will interact with each piece of UI and how it fits into the overall user experience. You are a master of the VS Code codebase and architecture, and you always follow the principle of "never reinvent the wheel" — if VS Code has a proven solution, you adapt it for Parallx rather than inventing a new approach. You are an expert at understanding how to use existing codebases and APIs, and you can quickly adapt them for Parallx's needs. You have a deep understanding of the VS Code architecture and its components, including the extension API, package.json files, and other relevant files. You are an expert at using the VS Code architecture and its components, including the extension API, package.json files, and other relevant files.


**Task Completion Documentation:** After a task is done, mark it ✅ in the relevant milestone file. If the implementation deviated significantly from the task description, note the deviation alongside the completion marker.

---

## 1. Project Vision

Parallx is a **second-brain workbench** — VS Code's architecture repurposed as a tool platform. The shell hosts domain-specific tools and extensions (note-taking, task management, knowledge graphs, AI workflows, etc.) the same way VS Code hosts language extensions. The tool API (`parallx.*`) mirrors `vscode.*` in shape.

**Core principles:**

1. **Mirror VS Code's structure.** Workbench, grid layout, parts, views, editor groups, command palette, keybindings, service layer, DI, and tool API all follow VS Code's proven architecture. We are adapting the best desktop app framework that exists — not inventing a new one.
2. **Never reinvent the wheel.** If VS Code solves a problem (tree views, tab management, settings, notifications, quick pick, etc.), follow their approach. Closer alignment = easier onboarding, fewer bugs, faster progress.
3. **Tools, not code editing.** Where VS Code has language servers and debuggers, Parallx has tools — self-contained extensions providing views, editors, commands, and panels.

---

## 2. Authoritative References

Always consult these **before** writing any implementation code:

| Source | Use for | URL |
|--------|---------|-----|
| **DeepWiki** | High-level architecture, component relationships, design patterns | https://deepwiki.com/microsoft/vscode |
| **VS Code source** | Concrete implementation — class hierarchy, DOM structure, CSS, event flow | https://github.com/microsoft/vscode |
| **VS Code Wiki** | Feature overviews, architecture decisions | https://github.com/microsoft/vscode/wiki |
| **VS Code API docs** | Extension API surface (our `parallx.*` mirrors this) | https://code.visualstudio.com/api |

**Rule:** Do NOT invent custom patterns when VS Code has a proven approach. Adapt their solution for Parallx.

---

## 3. VS Code Parity Checklist (mandatory per capability)

Every capability must complete these steps. Skipping them causes broken patterns that require rework.

### Before writing code

1. **DeepWiki** — Read the relevant page(s). Understand architecture, classes, and interactions.
2. **VS Code TypeScript source** — Read the `.ts` files for the feature. Note:
   - Class hierarchy and method signatures
   - DOM structure (elements, order, class names)
   - Event handling (events, elements, capture vs bubble)
   - Service dependencies (injected services, usage patterns)
3. **VS Code CSS source** — Read the co-located CSS. Note what IS set, what is NOT set, z-index stacking, position schemes, `-webkit-app-region`.
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

## 4. UI Component Rules

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

1. **No raw `document.createElement` for standard widgets.** Use `src/ui/` components. Build the component there first if it doesn't exist.
2. **No inline `element.style.*` for visual properties.** Only computed dimensions (layout-driven `width`/`height`) may be inline. Everything else goes in CSS classes.
3. **Check `src/ui/` before implementing any visual element.** Extend or compose existing components — do not duplicate.
4. **Reusable interactions belong in `src/ui/`.** If a UI pattern could appear in more than one place, it's a component.
5. **Components compose components.** `Dialog` uses `ButtonBar`. `QuickAccess` uses `InputBox` + `FilterableList`. Delegate, don't flatten.

### Dependency rules for `src/ui/`

- `ui/` may depend on `platform/` only (events, lifecycle, types).
- `ui/` must NOT depend on `services/`, `parts/`, `views/`, `editor/`, `commands/`, `context/`, or any other module.
- Feature modules (`parts/`, `views/`, `editor/`, `commands/`) may depend on `ui/`.

This mirrors VS Code where `src/vs/base/browser/ui/` depends only on `src/vs/base/`.

---

## 5. Canvas Registry Gate Architecture

The canvas built-in (`src/built-in/canvas/`) enforces a **four-registry gate architecture**. This is the most critical structural rule in the canvas codebase. Full details are in `ARCHITECTURE.md` — this section defines the rules you must follow.

### Core Principle

> **Children talk only to their parent gate. Gates talk to each other. No shortcuts.**

A "child" is any file that belongs to a registry's domain. A "gate" is a registry that mediates all imports for its children. Children never reach across to a sibling registry — they get everything they need through their own gate's re-exports.

### The Four Gates

| Gate | File | Domain |
|------|------|--------|
| **IconRegistry** | `config/iconRegistry.ts` | All SVG/icon access |
| **BlockRegistry** | `config/blockRegistry.ts` | Block metadata, capabilities, extensions, hub for all other registries |
| **CanvasMenuRegistry** | `menus/canvasMenuRegistry.ts` | Menu lifecycle, mutual exclusion, block-data access for menus |
| **BlockStateRegistry** | `config/blockStateRegistry/blockStateRegistry.ts` | Block mutations, movements, column operations, drag state |

### Import Rules (mandatory — violations break the architecture)

1. **Block extensions** (`calloutNode`, `columnNodes`, `mediaNodes`, `bookmarkNode`, `pageBlockNode`) import **only from BlockRegistry**. Never from CanvasMenuRegistry, IconRegistry, or BlockStateRegistry.
2. **Menu children** (`slashMenu`, `bubbleMenu`, `blockActionMenu`, `iconMenu`, `coverMenu`, `inlineMathEditor`) import **only from CanvasMenuRegistry**. Never from BlockRegistry or IconRegistry directly.
3. **BlockStateRegistry children** (`blockLifecycle`, `blockTransforms`, `blockMovement`, `columnCreation`, `columnInvariants`, `crossPageMovement`, `dragSession`) import **only from blockStateRegistry.ts** (their facade). Never from BlockRegistry directly.
4. **No file outside the registry layer** imports from `iconRegistry.ts`. Icons are re-exported through BlockRegistry and CanvasMenuRegistry.
5. **No child file imports across registries.** A menu file cannot import from a block extension, and vice versa.
6. **Registries may import from other registries** (gate-to-gate). BlockRegistry re-exports from IconRegistry and BlockStateRegistry. CanvasMenuRegistry re-exports from BlockRegistry and IconRegistry.

### When adding new code

- **New block extension?** It imports from `blockRegistry.ts` only. If it needs something not yet exported, add the export to `blockRegistry.ts`.
- **New menu?** It imports from `canvasMenuRegistry.ts` only. If it needs block data or icons, add a re-export to `canvasMenuRegistry.ts`.
- **New mutation/movement logic?** It goes in a `blockStateRegistry/` child file, imports from `blockStateRegistry.ts`, and is re-exported through `blockStateRegistry.ts` → `blockRegistry.ts`.
- **New icon?** Add to `canvasIcons.ts`, register in `iconRegistry.ts`. Consumers access via BlockRegistry or CanvasMenuRegistry re-exports.

### Why this matters

The circular dependency that broke column editing was caused by cross-reach: `blockRegistry → columnNodes → blockCapabilities → blockRegistry`. The gate architecture prevents this class of bug — every dependency is mediated by a gate, every gate has a clear direction, and esbuild's IIFE bundling order becomes irrelevant because no child reads from a registry it isn't gated through.