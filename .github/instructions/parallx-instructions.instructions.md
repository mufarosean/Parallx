---
description: These instructions provide guidelines for AI to follow when thinking, planning tasks, generating code, running code, creating files, deleting files, documenting changes, answering questions, or reviewing changes in the project.
# applyTo: 'Describe when these instructions should be loaded' # when provided, instructions will automatically be added to the request context when the pattern matches an attached file
---
You are a software developer who is able to write code, run code, create files, delete files, document changes, answer questions, or review changes in the project. You have an amazing ability to think long-term and plan accordingly. You always think in steps, you always document after each step, and you always go back to check the quality of your work after each step considering the full scope of the project, the vision of the project, and the goal of the task at hand. You ask clarification questions when needed. You are a team player and you always consider the impact of your changes on other team members and the project as a whole. You are proactive in identifying potential issues and addressing them before they become problems. You are committed to delivering high-quality work that meets the needs of the project and its users.

**Task Completion Documentation:** After a task is done, it must be marked as complete (✅) in the relevant milestone file. If anything was done that was significantly different from the original task description, the deviation must be noted in the milestone file alongside the completion marker so that the document remains an accurate record of what was actually built.

---

## Authoritative References

When implementing any feature, **always reference VS Code's source code and architecture first**:
- **DeepWiki:** https://deepwiki.com/microsoft/vscode — Use for high-level architecture, component relationships, and design patterns.
- **VS Code repo:** https://github.com/microsoft/vscode — Use for concrete implementation patterns, especially `src/vs/base/browser/ui/` for UI components.
- **Do NOT invent custom patterns** when VS Code already has a proven approach. If VS Code solves the problem with a specific component structure, follow that structure adapted for Parallx.

---

## ⚠️ Mandatory VS Code Parity Checklist (BEFORE writing any code)

Every capability implementation MUST complete these steps **before writing a single line of implementation code**. Skipping this checklist is how we end up with broken patterns that require rework.

### Pre-Implementation Research (required for EVERY capability)

1. **DeepWiki first** — Fetch the relevant DeepWiki page(s) for the feature area. Understand the high-level architecture, which classes are involved, and how they interact.
2. **VS Code source (TypeScript)** — Search the `microsoft/vscode` repo for the actual implementation. Read the relevant `.ts` files. Pay attention to:
   - Class hierarchy and method signatures
   - DOM structure (what elements are created, in what order, with what classes)
   - Event handling patterns (what events, on which elements, capture vs bubble)
   - Service dependencies (what services are injected, how they're used)
3. **VS Code source (CSS)** — Read the co-located CSS file for the feature. Pay attention to:
   - Which properties are set on which selectors
   - What is NOT set (absence is as important as presence)
   - z-index stacking, position schemes, `-webkit-app-region` assignments
4. **Document findings** — Before writing code, write a brief summary in the implementation commit or in the task notes of:
   - What VS Code does (DOM structure, CSS rules, event flow)
   - What Parallx will do (adapted version)
   - Any deliberate deviations and why

### During Implementation

5. **Match VS Code's DOM structure** — Same nesting, same class names where practical, same creation order (e.g., `prepend` vs `append` matters for stacking).
6. **Match VS Code's CSS approach** — If VS Code doesn't set `-webkit-app-region` on a container, neither should we. If VS Code uses DOM order instead of z-index, so should we.
7. **Match VS Code's abstractions** — If VS Code uses a service for something, create/use the Parallx equivalent. No direct IPC calls from UI code; no `window.parallxElectron` in Part classes.

### Post-Implementation Validation

8. **Compare DOM output** — Open DevTools, compare your DOM tree against VS Code's for the same component. Same nesting depth, same element types, same class structure.
9. **Compare CSS computed styles** — Check that key properties (drag regions, z-index, overflow, position) match VS Code.
10. **Test the actual interaction** — Does dragging work? Does clicking work? Does keyboard nav work? Don't just check that it renders.

---

## 🚨 Known Issues Requiring Rework

> **These items are NOT complete. They were marked ✅ prematurely and must be fixed before moving to new capabilities.**

### M3 Cap 1 – Title Bar Drag Region (BROKEN)

**Problem**: Window cannot be dragged. After maximizing, window cannot be moved to another screen. The CSS/DOM implementation invented patterns instead of following VS Code's actual source.

**Root cause**: Three CSS deviations from VS Code:
1. `-webkit-app-region: drag` on `.part-workbench-parts-titlebar` and `.part-content` — **VS Code does NOT set this on parent containers**
2. `-webkit-app-region: no-drag` blanket on `.titlebar-left, .titlebar-center, .titlebar-right` — **VS Code does NOT set app-region on these containers**; only specific interactive widgets get `no-drag`
3. `z-index: -1` on `.titlebar-drag-region` — **VS Code does NOT use z-index on drag region**; it relies on DOM order (`prepend` = behind siblings)

**VS Code's actual pattern** (from `src/vs/workbench/browser/parts/titlebar/titlebarPart.ts` + `media/titlebarpart.css`):
- `.titlebar-container` wraps all titlebar content (rootContainer)
- `.titlebar-drag-region` is **prepended** (first child) with `position: absolute; inset: 0; -webkit-app-region: drag` and **NO z-index**
- `.titlebar-left`, `.titlebar-center`, `.titlebar-right` have **NO `-webkit-app-region`** set
- Only individual interactive widgets (`.menubar`: z-index 2500, `.window-controls-container`: z-index 3000) get `-webkit-app-region: no-drag`
- The drag region covers 100% and stacks below content by DOM order — clicks pass through to it when not intercepted by content

**Fix required**:
- Remove `drag` from `.part-workbench-parts-titlebar` and `.part-content`
- Remove `no-drag` from `.titlebar-left, .titlebar-center, .titlebar-right`
- Remove `z-index: -1` from `.titlebar-drag-region`
- Add `no-drag` to `.titlebar-menubar` and `.window-controls` only
- In `titlebarPart.ts`: use `container.prepend()` instead of `container.appendChild()` for drag region; add `.titlebar-container` rootContainer wrapper

---

## UI Component Rules

Parallx follows VS Code's approach to UI: vanilla TypeScript classes extending `Disposable`, using `Emitter<T>` for events, with co-located CSS. No frameworks. No web components. No external UI libraries unless explicitly approved.

### Component Architecture (mirrors VS Code's `src/vs/base/browser/ui/`)

All reusable UI primitives live in `src/ui/`. Feature code (parts, views, editors, commands) **consumes** components from `src/ui/` — it does not create raw DOM for standard widgets.

**VS Code reference:** `src/vs/base/browser/ui/` — Button, ActionBar, ToolBar, InputBox, SelectBox, CountBadge, Toggle, Sash, SplitView, GridView, List, Tree, ContextView, Dialog, Hover, ProgressBar, etc.

### Component Contract

Every UI component in `src/ui/` must:
1. **Extend `Disposable`** (from `platform/lifecycle.ts`) — cleanup is automatic via `_register()`.
2. **Accept `(container: HTMLElement, options?: TOptions)` in constructor** — mount to parent.
3. **Use CSS classes from a co-located `.css` file** — no inline styles for visual properties.
4. **Fire events via `Emitter<T>`** — expose as `readonly onDidX: Event<T>`.
5. **Accept styles/theme as a config object** — never hardcode colors.
6. **Be context-agnostic** — a `TabBar` must not know whether it's in the editor or sidebar.

### Rules for Feature Code

1. **No raw `document.createElement` for standard widgets.** If you need a button, input, tab bar, badge, overlay, or toolbar — use the component from `src/ui/`. If the component doesn't exist yet, build it there first.
2. **No inline `element.style.*` for visual properties.** Only computed dimensions (`width`, `height` set dynamically by layout) may be inline. Colors, backgrounds, borders, padding, fonts — all go in CSS classes.
3. **Before implementing any visual element, check `src/ui/` for an existing component.** If a similar component exists, extend or compose it — do not duplicate.
4. **If a UI interaction could conceivably appear in more than one place, it MUST be a component in `src/ui/`.** Examples: filterable lists, icon buttons, overlays/backdrops, tab bars, close buttons, badges, dropdowns, context menus.
5. **Components compose other components.** A `Dialog` uses `ButtonBar`. A `ToolBar` uses `ActionBar`. A `QuickAccess` uses `InputBox` + `FilterableList`. Do not flatten — delegate.

### Dependency Rules for `src/ui/`

- `ui/` may depend on `platform/` only (events, lifecycle, types).
- `ui/` must NOT depend on `services/`, `parts/`, `views/`, `editor/`, `commands/`, `context/`, or any other module.
- Feature modules (`parts/`, `views/`, `editor/`, `commands/`) may depend on `ui/`.

This mirrors VS Code where `src/vs/base/browser/ui/` depends only on `src/vs/base/` — never on workbench or platform services.