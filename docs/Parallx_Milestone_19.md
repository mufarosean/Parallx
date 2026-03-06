# Milestone 19 — Cross-Cutting Polish & Standardization

## Research Document — July 2025

**Branch:** `milestone-19`

---

## Table of Contents

1. [Vision](#vision)
2. [Category A — Workbench / System](#category-a--workbench--system)
3. [Category B — PDF Viewer](#category-b--pdf-viewer)
4. [Category C — AI](#category-c--ai)
5. [Category D — Canvas](#category-d--canvas)
6. [Task Tracker](#task-tracker)
7. [Verification Checklist](#verification-checklist)
8. [Risk Register](#risk-register)

---

## Vision

**Before M19 — what the user experiences today:**

> You open a workspace, arrange your editor tabs, split views, resize the explorer sidebar, then close the app. When you reopen, every editor tab is gone — only a Welcome tab remains. The explorer sidebar can't be resized smoothly. Split editors have no visible border between them. The PDF viewer's outline can't be resized, clicking an outline item both navigates AND collapses, and the context menu clears your text selection before you can copy it. The AI chat shows 📁 folder emojis for every source reference regardless of file type. The canvas has no per-list-item drag handles. Four independent icon systems exist with no shared infrastructure, and context menus are built ad-hoc in some tools while a shared ContextMenu component sits unused.

**After M19 — what the user will experience:**

> Your editor state persists across sessions — tabs, split groups, scroll positions, all restored. The explorer sidebar resizes fluidly. Split editors show a clean 1px border. The PDF viewer has a resizable outline, arrow-only collapse toggles, working text copy, and opens at page-fit scale. AI chat shows proper file-type icons for every source. Canvas list items each have their own drag handle. A unified icon registry serves the entire app, and all context menus use the shared ContextMenu component.

---

## Category A — Workbench / System

### A1. Editor & Chat Session Persistence Across Reload

**Problem:** When the app reloads or restarts, all open editor tabs, split groups, and chat sessions are lost. The user must re-open everything manually.

**Root Cause:** The serialization types exist but are never populated. `workbench.ts` L1329 (`_buildEditorSnapshot()`) always returns `createDefaultEditorSnapshot()` — a hard-coded empty state. The restore path in `_applyRestoredState()` has no editor restoration code.

**Key Files:**
- `src/workbench/workbench.ts` — `_buildEditorSnapshot()` (L~1329), `_applyRestoredState()` (L~1100)
- `src/workspace/workspaceSaver.ts` — saves everything except editor state
- `src/workspace/workspaceTypes.ts` — `SerializedEditorSnapshot`, `SerializedEditorGroupSnapshot`, `SerializedEditorInputSnapshot` (L141–173) — types exist, never populated

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A1.1 | **Serialize editor group model** | In `_buildEditorSnapshot()`, iterate `EditorPart.groups`, serialize each group: `{ activeEditorIndex, editors: [{ typeId, uri, viewState }] }`. Use the existing `SerializedEditorGroupSnapshot` type. |
| A1.2 | **Serialize per-editor view state** | For each open editor, call the editor pane's `saveState()` or equivalent to capture scroll position, cursor position, and any pane-specific state. Store in `SerializedEditorInputSnapshot.viewState`. |
| A1.3 | **Wire editor snapshot into workspace save** | In `workspaceSaver.ts`, include the editor snapshot in the serialized workspace state. The `editorProvider` field in the workspace state type already exists — populate it. |
| A1.4 | **Restore editor state on load** | In `_applyRestoredState()`, read the serialized editor groups. For each group: create an editor group, open each editor input by `typeId` + `uri`, apply saved view state. Handle missing files gracefully (skip). |
| A1.5 | **Serialize chat session state** | If the chat panel has an active session, serialize its ID so it can be restored. This hooks into the existing `parallx-chat-session:///` URI scheme. |
| A1.6 | **Add unit tests** | Test serialization round-trip: create editor state → serialize → deserialize → verify equivalence. Test graceful handling of missing files. |

**Acceptance:** Close app with 3 tabs open (one split). Reopen. All 3 tabs restored in correct positions. Chat session restored if one was active.

---

### A2. Explorer Sidebar Scrolling & Resizing

**Problem:** The Explorer sidebar sections (tree + open editors) don't scroll independently and can't be smoothly resized relative to each other.

**Root Cause:** `viewContainer.ts` has section sash logic (`_rebuildSectionSashes()` at L608–626, `_onSectionSashMouseDown()` at L636), but `.open-editors-view` has no explicit height constraint, causing flex layout to either clip or overflow. The sash resize interaction needs debugging for proper min-height enforcement.

**Key Files:**
- `src/views/viewContainer.ts` — section sash creation (L608–626), resize handler (L636+)
- `src/built-in/explorer/explorer.css` — `.open-editors-view` styles
- `src/built-in/explorer/main.ts` — explorer view registration

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A2.1 | **Set explicit flex layout for sections** | Give each Explorer section (`overflow: auto`, `min-height: 80px`, `flex-shrink: 1`) so they're independently scrollable and have a minimum visible area. |
| A2.2 | **Debug sash resize interaction** | Trace `_onSectionSashMouseDown()` to verify it correctly adjusts the flex-basis of the sections above and below during drag. Fix any issues with flex layout competing with explicit heights. |
| A2.3 | **Add scroll containers** | Ensure each section's content is wrapped in a scroll container so long file lists scroll independently within their allocated space. |
| A2.4 | **Enforce minimum heights** | During sash drag, clamp both sections to their min-height so neither can be collapsed to zero. Mirror VS Code's `minSize` constraint on sidebar sections. |

**Acceptance:** Explorer tree and open-editors list scroll independently. Dragging the sash between them resizes smoothly with 80px minimum.

---

### A3. Menu Standardization

**Problem:** Context menus are inconsistent across the app. The shared `ContextMenu` component (`src/ui/contextMenu.ts`, 411 lines, VS Code-patterned) is used by 14 files, but the PDF editor builds menus with ad-hoc DOM. The canvas has its own `CanvasMenuRegistry` system. Future tools won't know which pattern to follow.

**Root Cause:** No enforcement or documentation of menu patterns. Each tool author picks whatever approach is convenient.

**Key Files:**
- `src/ui/contextMenu.ts` — shared ContextMenu (411 lines), keyboard nav, submenus, group separators, used by 14 files
- `src/built-in/editor/pdfEditorPane.ts` — ad-hoc DOM menu construction
- `src/built-in/canvas/menus/canvasMenuRegistry.ts` — canvas-specific registry (10 menu surfaces, icon re-export)

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A3.1 | **Migrate PDF editor to shared ContextMenu** | Replace the ad-hoc DOM menu in `pdfEditorPane.ts` with the shared `ContextMenu.show()` API. Define menu items as `IContextMenuItem[]` array. |
| A3.2 | **Document menu pattern for tool authors** | Add a section to `ARCHITECTURE.md` or a standalone `docs/MENU_PATTERN.md` documenting: (1) use `ContextMenu.show()` for all right-click menus, (2) canvas's `CanvasMenuRegistry` is domain-specific and is valid for canvas-internal menus, (3) provide code example. |
| A3.3 | **Audit remaining ad-hoc menus** | Search for any other files building context menus with raw DOM instead of the shared component. Migrate them. |
| A3.4 | **Consider an `IMenuService` abstraction** | Evaluate whether a DI-registered `IMenuService` (like VS Code's) would simplify command-palette + context-menu unification. Document decision — implement only if justified. |

**Acceptance:** PDF viewer context menu uses shared `ContextMenu`. All context menus app-wide use either the shared `ContextMenu` or the canvas `CanvasMenuRegistry` (for canvas-internal use). Pattern documented.

---

### A4. Icon Standardization

**Problem:** Four independent icon systems exist with no shared infrastructure:
1. Canvas: `canvasIcons.ts` (287 lines, ~40+ SVG icons) → `iconRegistry.ts` → registries
2. Chat: `chatIcons.ts` (181 lines, ~25 SVG icons)
3. PDF: inline `ICON` constant (17 SVG icons)
4. Explorer/Search: Unicode emojis (📁, 📄)

No shared lookup. No file-type icon mapping. No theming integration for icons.

**Key Files:**
- `src/built-in/canvas/config/canvasIcons.ts` — 287 lines, ~40+ icons
- `src/built-in/chat/chatIcons.ts` — 181 lines, ~25 icons
- `src/built-in/editor/pdfEditorPane.ts` — inline `ICON` constant
- `src/built-in/explorer/main.ts` — emojis at L305 (`📁`, `📄`)
- `src/built-in/search/main.ts` — emojis for results

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A4.1 | **Create shared `src/ui/iconRegistry.ts`** | Central registry: `registerIcon(id, svgMarkup)`, `getIcon(id): string`. All tools register their icons here. Follow the canvas `iconRegistry.ts` pattern but at app level. |
| A4.2 | **Add file-type icon set** | Register icons for common file extensions: `.md`, `.pdf`, `.txt`, `.json`, `.js`, `.ts`, `.css`, `.html`, `.py`, `.jpg/.png/.gif`, generic file, generic folder. Minimalist SVG, 16×16 viewBox, stroke-based. |
| A4.3 | **Add `getFileTypeIcon(extension)` helper** | Utility function that maps file extension → icon ID → SVG markup. Fallback to generic file icon for unknown extensions. |
| A4.4 | **Migrate explorer from emojis to SVG** | Replace `📁` and `📄` in `explorer/main.ts` L305 with SVG icons from the shared registry via `getFileTypeIcon()`. |
| A4.5 | **Migrate search results from emojis to SVG** | Replace emojis in `search/main.ts` with SVG icons from the shared registry. |
| A4.6 | **Migrate chat source pills from emojis to SVG** | Replace `📁`/`📄` in `chatContentParts.ts` L648–649 with `getFileTypeIcon()` based on the source URI's extension. |
| A4.7 | **Consolidate canvas and chat icon modules** | Have `canvasIcons.ts` and `chatIcons.ts` register into the shared `iconRegistry.ts`. They can still export convenience accessors but storage is centralized. |
| A4.8 | **Document icon conventions** | Add icon registration pattern, naming conventions (`icon-<domain>-<name>`), and size requirements to `ARCHITECTURE.md`. |

**Acceptance:** One shared icon registry. Explorer, search, and chat use SVG icons instead of emojis. File-type icons resolve by extension. All icon modules register into the shared registry.

---

### A5. Theme Engine Audit

**Problem:** The theme engine (`src/theme/`) is mature (~100+ CSS variable tokens, 4 built-in themes, registry → JSON → CSS variable injection), but hasn't been audited since new features were added (PDF viewer, AI settings, canvas expansions). New components may be using hardcoded colors instead of theme tokens.

**Key Files:**
- `src/theme/colorRegistry.ts` — token definitions
- `src/theme/themeService.ts` — CSS variable injection
- `src/theme/themes/*.json` — 4 built-in theme files

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A5.1 | **Audit new components for hardcoded colors** | Search all CSS files for `rgba(`, `rgb(`, `#` color literals not inside `var()` fallbacks. List every instance. |
| A5.2 | **Register missing tokens** | For each hardcoded color found, determine if an existing token covers it. If not, register a new token in `colorRegistry.ts` with values for all 4 themes. |
| A5.3 | **Replace hardcoded colors** | Update CSS to use `var(--vscode-*)` tokens instead of hardcoded values. Prioritize PDF viewer and AI settings panels (newest code, most likely to have hardcoded colors). |
| A5.4 | **Verify all 4 themes** | Open each theme and visually verify no components appear broken or unthemed. Screenshot comparison recommended. |

**Acceptance:** Zero hardcoded color literals in CSS (except inside `var()` fallbacks). All 4 themes render all components correctly.

---

### A6. Editor Split Group Border

**Problem:** When editors are split side-by-side, there's no visible border between them. The content of adjacent editors appears to bleed into each other. Users can't distinguish where one editor ends and another begins.

**Root Cause:** `.grid-sash` in `workbench.css` has `background: transparent`. The sash is only visible on hover. VS Code shows a persistent 1px border between editor groups.

**Key Files:**
- `src/workbench.css` — `.grid-sash` styles
- `src/parts/editorPart.ts` — grid sash creation

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A6.1 | **Add resting border token** | Register `--vscode-editorGroup-border` in `colorRegistry.ts` if it doesn't already exist. Set a subtle value (e.g., `rgba(255,255,255,0.06)` for dark themes, `rgba(0,0,0,0.08)` for light). |
| A6.2 | **Apply 1px border** | Update `.grid-sash` CSS to show a 1px solid border using the token. Keep hover behavior for resize affordance but add a resting visual separator. |
| A6.3 | **Verify in all layouts** | Test with 2-column, 3-column, and 2×2 grid splits. Border should appear consistently between all adjacent groups. |

**Acceptance:** 1px visible border between split editor groups at rest. Still highlights on hover for resize.

---

### A7. Editor Ribbon Height Alignment

**Problem:** File editors have a breadcrumbs bar at 22px while the canvas ribbon is 28px. When both are visible (e.g., a file editor split next to a canvas page), the height mismatch is visually jarring — the content areas don't align horizontally.

**Key Files:**
- `src/editor/breadcrumbsBar.ts` — `BREADCRUMBS_HEIGHT = 22`
- `src/built-in/canvas/canvas.css` — `.canvas-top-ribbon` height 28px
- `src/parts/editorPart.ts` — tab strip uses `TAB_HEIGHT = 35`

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A7.1 | **Decide unified height** | Choose one height for both ribbons — 28px aligns with canvas and gives more breathing room. Or 24px as a compromise. Decision should consider whether tab bar height (35px) also needs adjustment. |
| A7.2 | **Update `BREADCRUMBS_HEIGHT`** | Change the constant in `breadcrumbsBar.ts` to the chosen value. Update any CSS that uses a hardcoded `22px` for breadcrumb-related sizing. |
| A7.3 | **Verify alignment** | Open a split view with a file editor and a canvas page side by side. The ribbon areas should align perfectly at the same Y offset. |

**Acceptance:** Breadcrumbs bar and canvas ribbon are the same height. Content areas align in split views.

---

### A8. Explorer Sidebar Title Deduplication

**Problem:** The Explorer sidebar shows "EXPLORER" twice — once as the activity bar sidebar header (set by `workbench.ts` L1472–1477) and once as the first section header inside the explorer view. This is redundant and wastes vertical space.

**Key Files:**
- `src/workbench/workbench.ts` — sidebar header set at L1472–1477, hardcoded to `'EXPLORER'`
- `src/built-in/explorer/main.ts` — section header, tree rendering, title at L244–247 shows `'UNTITLED (WORKSPACE)'` for default workspaces
- `src/views/viewContainer.ts` — section header rendering

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A8.1 | **Remove duplicate section header** | Either: (a) remove the "EXPLORER" section header inside the view container and rely on the sidebar header alone, or (b) replace the section header with the workspace name. Option (b) is more informative. |
| A8.2 | **Show workspace name in section header** | Replace the duplicate "EXPLORER" text with the workspace's `displayName`. For single-folder workspaces this is the folder name. For multi-root, it's the workspace identity name. |
| A8.3 | **Handle "Default Workspace" case** | When the workspace name is "Default Workspace" (no user-assigned name), display the folder name instead of "UNTITLED (WORKSPACE)". |

**Acceptance:** No duplicate "EXPLORER" text. Sidebar header says "EXPLORER", section header shows the workspace name or folder name.

---

### A9. Workspace Naming

**Problem:** Users can't name their workspace. Multi-root workspaces default to "Default Workspace", which shows as "UNTITLED (WORKSPACE)" in the explorer. The title bar doesn't reflect the workspace name in a useful way.

**Root Cause:** `workspace.ts` creates workspaces with `Workspace.create('Default Workspace')` (workbench.ts L803). The `displayName` getter resolves: single folder → folder name, multi-root → identity name. No UI to rename.

**Key Files:**
- `src/workspace/workspace.ts` — `displayName` logic (L86–94), `Workspace.create()`
- `src/workbench/workbench.ts` — default workspace creation at L803

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| A9.1 | **Add workspace rename command** | Register a `parallx.workspace.rename` command that opens a quick-input prompt for the workspace name. Save the name to the workspace identity. |
| A9.2 | **Update title bar** | Reflect the workspace name in the window title. Format: `{workspaceName} — Parallx` or `{folderName} — Parallx` for unnamed single-folder workspaces. |
| A9.3 | **Update explorer header** | Wire the explorer section header (from A8.2) to react to workspace rename events, updating dynamically. |
| A9.4 | **Prompt on first multi-root creation** | When the user adds a second folder to the workspace (creating a multi-root workspace), prompt them to name it instead of defaulting to "Default Workspace". |

**Acceptance:** Users can rename workspaces. Title bar and explorer show the chosen name. Multi-root workspaces prompt for a name.

---

## Category B — PDF Viewer

### B1. Resizable Outline Sidebar

**Problem:** The PDF outline sidebar is a fixed 240px wide. Users can't resize it to accommodate long document titles or narrow it to see more of the PDF.

**Root Cause:** `.pdf-outline-sidebar` in `pdfEditorPane.css` has `width: 240px` with no resize handle or sash element.

**Key Files:**
- `src/built-in/editor/pdfEditorPane.ts` — outline sidebar creation
- `src/built-in/editor/pdfEditorPane.css` — `.pdf-outline-sidebar` fixed width

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| B1.1 | **Add sash element** | Create a 4px-wide sash `<div>` on the right edge of the outline sidebar. Style with `cursor: col-resize`. |
| B1.2 | **Implement drag-to-resize** | On `mousedown` of the sash, listen for `mousemove` on the container. Update the sidebar's `width` style. Clamp between 150px (min) and 500px (max). |
| B1.3 | **Persist width** | Store the user's preferred width in localStorage keyed by document URI (or globally). Restore on next open. |
| B1.4 | **CSS transitions** | Add subtle transition on resize for smooth feel. Ensure the PDF viewer area adjusts fluidly (flex layout). |

**Acceptance:** Outline sidebar can be resized by dragging. Width persists across sessions. Minimum 150px, maximum 500px.

---

### B2. Separate Outline Collapse from Navigation

**Problem:** Clicking an outline item both navigates to the page AND toggles the collapse state. Users who just want to collapse a section to see the structure are forced to navigate away. Users who want to navigate are forced to watch the tree change.

**Root Cause:** The current row click handler combines both actions. It should be: arrow/chevron click = toggle collapse only, title text click = navigate only.

**Key Files:**
- `src/built-in/editor/pdfEditorPane.ts` — outline row click handlers in `_buildOutlineNodes()`

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| B2.1 | **Split click targets** | The chevron/arrow element gets a click handler that ONLY toggles collapse (expand/contract children). The title text element gets a click handler that ONLY navigates to the destination page/section. |
| B2.2 | **Visual affordance for chevron** | Style the chevron as a clickable element: `cursor: pointer`, subtle hover background. Make the hit target at least 20×20px for easy clicking. |
| B2.3 | **Keyboard navigation** | Arrow Left collapses current node (or moves to parent if already collapsed). Arrow Right expands current node (or moves to first child if already expanded). Enter navigates to the selected item's destination. |

**Acceptance:** Clicking the chevron collapses/expands without navigating. Clicking the title navigates without collapsing. Keyboard arrows work for tree navigation.

---

### B3. Fix Context Menu Copy (Text Selection Clearing)

**Problem:** Right-clicking to use "Copy" in the PDF context menu doesn't copy the selected text. The text selection disappears before the menu action fires.

**Root Cause:** The `mousedown` event on the context menu clears the PDF viewer's text selection before the `click` event on the "Copy" item fires. The selected text needs to be captured at menu-show time, not at menu-click time.

**Key Files:**
- `src/built-in/editor/pdfEditorPane.ts` — context menu creation and Copy action

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| B3.1 | **Capture selection at show time** | When the context menu is triggered (on `contextmenu` event), immediately capture `window.getSelection().toString()` or the PDF viewer's internal selection and store it in a variable. |
| B3.2 | **Use captured text in Copy** | The "Copy" menu action reads from the captured variable, not from the live selection. Use `navigator.clipboard.writeText()` or Electron's `clipboard.writeText()` via IPC. |
| B3.3 | **Disable Copy when no selection** | If the captured text is empty, grey out or hide the "Copy" option in the context menu. |
| B3.4 | **Migrate to shared ContextMenu** | As part of A3.1, this menu should use the shared `ContextMenu.show()` API, which handles `mousedown` propagation correctly by calling `event.preventDefault()` on the overlay. |

**Acceptance:** Select text in PDF → right-click → Copy → paste elsewhere. Text is correct. Empty selection disables Copy.

---

### B4. Search Bar UI Polish

**Problem:** The PDF search bar could use visual refinement to match the overall app polish level — consistent styling, clear focus states, smooth transitions.

**Key Files:**
- `src/built-in/editor/pdfEditorPane.ts` — search bar creation
- `src/built-in/editor/pdfEditorPane.css` — search bar styles

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| B4.1 | **Audit current search bar styles** | Compare with VS Code's find widget. Check: input border, focus ring, button hover states, result count positioning, close button. |
| B4.2 | **Match count display** | Show "N of M" result count inline or adjacent to the search input. Currently may not show match counts clearly. |
| B4.3 | **Keyboard shortcut hint** | Show `Ctrl+F` hint in the search input placeholder or tooltip. |
| B4.4 | **Smooth open/close animation** | Slide in from top with a short CSS transition (150ms ease-out). Match the animation already used for toolbar interactions. |

**Acceptance:** Search bar visually polished, shows match count, has keyboard hints, animates smoothly.

---

### B5. Default Scale — Page Fit

**Problem:** PDFs open at "page-width" scale, which often requires scrolling vertically to see a full page. Users expect to see the entire first page when opening a document.

**Root Cause:** The default scale value is set to `'page-width'` in the PDF viewer initialization.

**Key Files:**
- `src/built-in/editor/pdfEditorPane.ts` — viewer initialization, scale setting

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| B5.1 | **Change default scale** | Set the initial `currentScaleValue` to `'page-fit'` instead of `'page-width'`. This fits the full page in the viewport. |
| B5.2 | **Persist user preference** | If the user changes the scale, remember their choice per-document or globally. Restore it on next open. |
| B5.3 | **Add "Fit Page" to toolbar** | Ensure there's a quick-access button or dropdown option to return to page-fit view. May already exist — verify. |

**Acceptance:** PDFs open showing the full first page. User scale preference persists.

---

## Category C — AI

### C1. Citation / Source Attribution Fix

**Problem:** AI chat citations (`[1]`, `[2]`, etc.) sometimes point to the wrong source. The model mentions content from one document but the citation badge links to a different one.

**Root Cause:** The citation pipeline has multiple stages (RAG retrieval → source numbering → response generation → citation parsing → rendering). The citation numbers assigned during retrieval must match the numbers the LLM produces in its response. If the LLM hallucinates a citation number or uses a different ordering, the mapping breaks.

**Key Files:**
- `src/services/retrievalService.ts` — `formatContext()` assigns citation numbers using `sourceIndex` Map (L245–260)
- `src/built-in/chat/participants/defaultParticipant.ts` — `ragSources` array, `response.reference()` (L630–640), `response.setCitations()` (L1312–1317)
- `src/services/chatService.ts` — `setCitations()` (L227–233), reference folding (L160–195)
- `src/built-in/chat/rendering/chatContentParts.ts` — `_postProcessCitations()` (L97–158), `_autoLinkSourceMentions()` (L170–283)

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| C1.1 | **Audit citation number consistency** | Trace the full pipeline: verify that the numbers in `formatContext()` output (injected into the prompt) match the numbers in `ragSources` passed to `setCitations()`. Look for off-by-one or reordering. |
| C1.2 | **Enforce citation instruction in system prompt** | Ensure the system prompt explicitly tells the LLM: "Use citation numbers exactly as provided in the context. Do not renumber or reorder citations." Verify this instruction exists in `systemPromptGenerator.ts` or `chatSystemPrompts.ts`. |
| C1.3 | **Validate citation mapping post-stream** | After streaming completes, before calling `setCitations()`, validate that every `[N]` number in the response text has a corresponding entry in `ragSources`. Log warnings for unmatched citations. |
| C1.4 | **Handle citation re-ordering** | If the LLM re-orders citations (e.g., uses `[1]` for a source that was numbered `[3]` in context), implement a post-processing step that remaps based on first-appearance order in the response. |
| C1.5 | **Add citation accuracy tests** | Unit tests with mocked retrieval results and known LLM responses. Verify badge `[N]` links to the correct source URI. |

**Acceptance:** Citations consistently link to the correct source document. No phantom citations pointing to wrong documents.

---

### C2. Move AI Settings to Secondary Sidebar

**Problem:** AI Settings occupies its own activity bar icon in the primary sidebar. It takes up prime sidebar real estate for something accessed infrequently. It should be accessible from within the chat panel as a settings gear icon.

**Root Cause:** `builtinManifests.ts` L235–240 registers AI Settings as `location: 'sidebar'` with its own container. The chat title bar has only 3 icons (New Chat, History, Clear).

**Key Files:**
- `src/tools/builtinManifests.ts` — AI Settings view container registration (L235–240)
- `src/built-in/ai-settings/main.ts` — view provider registration (L55), status bar item (L80)
- `src/built-in/chat/widgets/chatHeaderPart.ts` — chat panel header with 3 action buttons (L70, L78, L85)
- `src/built-in/chat/chatIcons.ts` — chat SVG icons

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| C2.1 | **Add gear icon to chat title bar** | In `chatHeaderPart.ts`, add a 4th action button (gear/cog SVG icon) that opens the AI Settings panel. Position it at the right end of the title bar. |
| C2.2 | **Register AI Settings in secondary sidebar** | Change the view container location from `'sidebar'` to `'panel'` or implement as a slide-out panel/overlay within the chat area. Alternatively, open it as an editor tab. |
| C2.3 | **Remove AI Settings from primary activity bar** | Remove the `⚙` activity bar icon. The settings are now accessed only from the chat title bar gear icon. |
| C2.4 | **Keep status bar indicator** | Retain the `⚙ AI: {presetName}` status bar item for quick visibility. Clicking it should also open AI Settings. |
| C2.5 | **Add gear icon SVG to chat icons** | Add a minimalist gear/cog SVG to `chatIcons.ts` for the title bar button. |

**Acceptance:** AI Settings accessible from gear icon in chat title bar. No separate activity bar icon. Status bar shortcut still works.

---

### C3. AI Settings UI — Replace Emojis with Icons

**Problem:** The AI persona avatar picker uses emojis (`🧠`, `💼`, `✍️`, etc.) which look inconsistent with the rest of the app's minimalist SVG icon aesthetic.

**Root Cause:** `personaSection.ts` L18 defines `AVATAR_EMOJIS` array with 12 emoji characters used as button labels.

**Key Files:**
- `src/aiSettings/ui/sections/personaSection.ts` — `AVATAR_EMOJIS` (L18), avatar button rendering (L80–90)
- `src/tools/builtinManifests.ts` — `⚙` emoji for container icon (L236)
- `src/built-in/ai-settings/main.ts` — `⚙` emoji for status bar (L80)

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| C3.1 | **Design 12 minimalist avatar SVGs** | Replace each emoji with a small (16×16 or 20×20) SVG icon: brain, briefcase, pen, coins, microscope, chart, target, robot, fox, wave, lightning, puzzle. Stroke-based, monochrome, matching app style. |
| C3.2 | **Register avatars in icon registry** | Use the shared `iconRegistry.ts` (from A4.1) to register the avatar icons. IDs: `avatar-brain`, `avatar-briefcase`, etc. |
| C3.3 | **Update avatar picker** | Replace emoji `textContent` with SVG `innerHTML` from the registry. Update CSS for proper sizing and hover effects. |
| C3.4 | **Replace `⚙` emoji in manifests** | Use an SVG gear icon for the AI Settings container icon and status bar text. Register in icon registry. |

**Acceptance:** All emojis in AI Settings replaced with consistent SVG icons. Visual style matches the rest of the app.

---

### C4. Chat Source Icons — File-Type Aware

**Problem:** All non-canvas-page source references in AI chat use the 📁 folder emoji regardless of file type. A PDF, a markdown file, and a TypeScript file all show the same folder icon.

**Root Cause:** `chatContentParts.ts` L648–649 uses a binary check: `isPage ? '📄' : '📁'`. No file extension parsing.

**Key Files:**
- `src/built-in/chat/rendering/chatContentParts.ts` — `_renderReference()` (L636–676)
- `src/built-in/chat/chatIcons.ts` — existing chat SVG icons (no file-type icons)

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| C4.1 | **Parse file extension from URI** | In `_renderReference()`, extract the file extension from `part.uri` using `path.extname()` or a simple regex. |
| C4.2 | **Map to file-type icon** | Use the `getFileTypeIcon(extension)` helper from A4.3 to get the appropriate SVG icon. Canvas pages get the page icon. |
| C4.3 | **Replace emoji with SVG** | Set `icon.innerHTML` to the SVG markup instead of `icon.textContent` with an emoji. Adjust CSS for proper sizing (12–14px inline icons). |
| C4.4 | **Fallback icon** | Unknown extensions get a generic document icon (not a folder emoji). |

**Acceptance:** PDF sources show PDF icon, markdown shows MD icon, code shows code icon, etc. No more folder emojis for file sources.

---

## Category D — Canvas

### D1. Per-List-Item Drag Handles

**Problem:** Numbered and bulleted list items don't have individual drag handles. Users can't reorder list items by dragging — they can only move the entire list block.

**Root Cause:** `blockHandles.ts` L639–641 explicitly excludes `ol` and `ul` from showing handles. The handle resolution logic (`_resolveBlockFromDocPos`) resolves to the list wrapper (depth 1), which is then excluded. Individual `listItem` nodes at depth 2 can get handles when hovered but the behavior is inconsistent.

**Key Files:**
- `src/built-in/canvas/handles/blockHandles.ts` — exclusion at L639–641, left offset at L661–663, resolution at L771–810

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| D1.1 | **Remove ol/ul exclusion** | Remove or modify the `dom.matches('ol, ul')` exclusion at L639–641. Instead, when the resolved block is a list wrapper, drill down to the `listItem` level. |
| D1.2 | **Resolve to `listItem` depth** | Modify `_resolveBlockFromDocPos` to resolve individual `listItem` nodes when the mouse is over a list. Each `li` gets its own handle at its vertical position. |
| D1.3 | **Handle drag for list items** | Ensure dragging a list item handle reorders within the list (ProseMirror node move) rather than moving the entire list. This requires a list-aware drag handler. |
| D1.4 | **Visual tuning** | Adjust the left offset to clear bullet/number markers (existing logic at L661–663). Ensure handles don't overlap with nested list indentation. |
| D1.5 | **Test nested lists** | Verify handles work for: flat bulleted list, flat numbered list, nested lists (2–3 levels), mixed numbered/bulleted nesting. |

**Acceptance:** Each list item has its own drag handle. Dragging reorders items within the list. Works for nested and mixed lists.

---

### D2. Remove Sidebar Separator Line

**Problem:** A thin horizontal separator line appears between the Favorites and Pages sections in the canvas sidebar. It's visually unnecessary — the section headers already provide clear separation.

**Root Cause:** `canvasSidebar.ts` L284–285 creates a `div.canvas-sidebar-separator` element between sections. CSS at `canvas.css` L2896–2900 gives it `height: 1px; background: rgba(255,255,255,0.06); margin: 4px 12px`.

**Key Files:**
- `src/built-in/canvas/canvasSidebar.ts` — separator creation at L284–285
- `src/built-in/canvas/canvas.css` — `.canvas-sidebar-separator` styles at L2896–2900

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| D2.1 | **Remove separator DOM element** | Delete the `const sep = $('div.canvas-sidebar-separator')` and `this._treeList.appendChild(sep)` lines in `canvasSidebar.ts`. |
| D2.2 | **Remove separator CSS** | Delete the `.canvas-sidebar-separator` rule from `canvas.css`. |
| D2.3 | **Adjust section spacing** | If removing the separator leaves too little visual gap, add `margin-top` or `padding-top` to the Pages section header to compensate. |

**Acceptance:** No separator line between Favorites and Pages. Clean visual separation via section headers alone.

---

### D3. Full-Width Page Logic

**Problem:** The "Full width" toggle on canvas pages uses fixed-pixel gutters (96px padding each side) which don't adapt to different screen sizes. On very wide monitors, the content still has narrow margins. On smaller screens, the gutters eat too much space.

**Root Cause:** `canvas.css` L2841–2852 sets `padding-left: 96px; padding-right: 96px` with `max-width: none`. Normal mode uses `max-width: 900px` centered. Neither approach is responsive.

**Key Files:**
- `src/built-in/canvas/canvas.css` — `.canvas-tiptap-editor` (L307) normal width, `.canvas-full-width .canvas-tiptap-editor` (L2841–2852) full-width mode
- `src/built-in/canvas/header/pageChrome.ts` — toggle at L794–795, class application at L158
- `src/built-in/canvas/canvasTypes.ts` — `fullWidth: boolean` (L39–40)

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| D3.1 | **Replace fixed padding with percentage** | Change full-width mode from `padding: 0 96px` to percentage-based: `padding: 0 5%` or use `max-width: 90%` with `margin: 0 auto`. This adapts to viewport width. |
| D3.2 | **Set responsive breakpoints** | For narrow viewports (<768px): minimal padding (16–24px). For medium (768–1440px): moderate padding (5%). For wide (>1440px): larger padding (8–10%) to prevent excessively wide lines. |
| D3.3 | **Consider max line width** | Even in full-width mode, cap content at a maximum readable width (e.g., 1200px or 80ch) and center it. This prevents unreadable 300+ character lines on ultrawide monitors. |
| D3.4 | **Update page header to match** | Ensure `.canvas-page-header` in full-width mode uses the same responsive padding/max-width rules. |
| D3.5 | **Test at multiple viewport sizes** | Verify at 1280px, 1920px, 2560px, and 3840px viewport widths. Content should be readable and well-proportioned at all sizes. |

**Acceptance:** Full-width pages use responsive sizing. Content readable at all viewport widths from 1280px to 3840px. No excessively long lines.

---

## Task Tracker

### Category A — Workbench / System

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| A1.1 | Serialize editor group model | P0 | ✅ |
| A1.2 | Serialize per-editor view state | P0 | ✅ |
| A1.3 | Wire editor snapshot into workspace save | P0 | ✅ |
| A1.4 | Restore editor state on load | P0 | ✅ |
| A1.5 | Serialize chat session state | P1 | ✅ |
| A1.6 | Add persistence unit tests | P0 | ✅ |
| A2.1 | Set explicit flex layout for sections | P1 | ✅ |
| A2.2 | Debug sash resize interaction | P1 | ✅ |
| A2.3 | Add scroll containers | P1 | ✅ |
| A2.4 | Enforce minimum heights | P1 | ✅ |
| A3.1 | Migrate PDF editor to shared ContextMenu | P1 | ✅ |
| A3.2 | Document menu pattern | P2 | ✅ |
| A3.3 | Audit remaining ad-hoc menus | P2 | ✅ |
| A3.4 | Consider IMenuService abstraction | P2 | ✅ |
| A4.1 | Create shared iconRegistry.ts | P1 | ✅ |
| A4.2 | Add file-type icon set | P1 | ✅ |
| A4.3 | Add getFileTypeIcon() helper | P1 | ✅ |
| A4.4 | Migrate explorer from emojis to SVG | P1 | ✅ |
| A4.5 | Migrate search results from emojis to SVG | P1 | ✅ |
| A4.6 | Migrate chat source pills from emojis to SVG | P1 | ✅ |
| A4.7 | Consolidate canvas and chat icon modules | P2 | ✅ |
| A4.8 | Document icon conventions | P2 | ✅ |
| A5.1 | Audit new components for hardcoded colors | P2 | ✅ |
| A5.2 | Register missing tokens | P2 | ✅ |
| A5.3 | Replace hardcoded colors | P2 | ✅ |
| A5.4 | Verify all 4 themes | P2 | ✅ |
| A6.1 | Add resting border token | P1 | ✅ |
| A6.2 | Apply 1px border to .grid-sash | P1 | ✅ |
| A6.3 | Verify in all layouts | P1 | ✅ |
| A7.1 | Decide unified ribbon height | P1 | ✅ |
| A7.2 | Update BREADCRUMBS_HEIGHT | P1 | ✅ |
| A7.3 | Verify alignment | P1 | ✅ |
| A8.1 | Remove duplicate section header | P1 | ✅ |
| A8.2 | Show workspace name in section header | P1 | ✅ |
| A8.3 | Handle "Default Workspace" case | P1 | ✅ |
| A9.1 | Add workspace rename command | P2 | ✅ |
| A9.2 | Update title bar with workspace name | P2 | ✅ |
| A9.3 | Wire explorer to rename events | P2 | ✅ |
| A9.4 | Prompt on first multi-root creation | P2 | ✅ |

### Category B — PDF Viewer

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| B1.1 | Add sash element to outline | P1 | ✅ |
| B1.2 | Implement drag-to-resize | P1 | ✅ |
| B1.3 | Persist outline width | P2 | ✅ |
| B1.4 | CSS transitions for resize | P2 | ✅ |
| B2.1 | Split click targets (chevron vs title) | P0 | ✅ |
| B2.2 | Visual affordance for chevron | P1 | ✅ |
| B2.3 | Keyboard navigation for outline | P2 | ✅ |
| B3.1 | Capture selection at show time | P0 | ✅ |
| B3.2 | Use captured text in Copy | P0 | ✅ |
| B3.3 | Disable Copy when no selection | P1 | ✅ |
| B3.4 | Migrate to shared ContextMenu | P1 | ✅ |
| B4.1 | Audit current search bar styles | P2 | ✅ |
| B4.2 | Match count display | P1 | ✅ |
| B4.3 | Keyboard shortcut hint | P2 | ✅ |
| B4.4 | Smooth open/close animation | P2 | ✅ |
| B5.1 | Change default scale to page-fit | P0 | ✅ |
| B5.2 | Persist user scale preference | P2 | ✅ |
| B5.3 | Verify Fit Page in toolbar | P1 | ✅ |

### Category C — AI

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| C1.1 | Audit citation number consistency | P0 | ✅ |
| C1.2 | Enforce citation instruction in prompt | P0 | ✅ |
| C1.3 | Validate citation mapping post-stream | P1 | ✅ |
| C1.4 | Handle citation re-ordering | P1 | ✅ |
| C1.5 | Add citation accuracy tests | P1 | ✅ |
| C2.1 | Add gear icon to chat title bar | P1 | ✅ |
| C2.2 | Register AI Settings in secondary sidebar | P1 | ✅ |
| C2.3 | Remove AI Settings from primary activity bar | P1 | ✅ |
| C2.4 | Keep status bar indicator | P1 | ✅ |
| C2.5 | Add gear icon SVG to chat icons | P1 | ✅ |
| C3.1 | Design 12 minimalist avatar SVGs | P2 | ✅ |
| C3.2 | Register avatars in icon registry | P2 | ✅ |
| C3.3 | Update avatar picker to SVGs | P2 | ✅ |
| C3.4 | Replace ⚙ emoji in manifests | P2 | ✅ |
| C4.1 | Parse file extension from URI | P1 | ✅ |
| C4.2 | Map to file-type icon | P1 | ✅ |
| C4.3 | Replace emoji with SVG in pills | P1 | ✅ |
| C4.4 | Fallback icon for unknown types | P1 | ✅ |

### Category D — Canvas

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| D1.1 | Remove ol/ul exclusion | P1 | ✅ |
| D1.2 | Resolve to listItem depth | P1 | ✅ |
| D1.3 | Handle drag for list items | P1 | ✅ |
| D1.4 | Visual tuning for list handles | P1 | ✅ |
| D1.5 | Test nested lists | P1 | ✅ |
| D2.1 | Remove separator DOM element | P0 | ✅ |
| D2.2 | Remove separator CSS | P0 | ✅ |
| D2.3 | Adjust section spacing | P1 | ✅ |
| D3.1 | Replace fixed padding with percentage | P1 | ✅ |
| D3.2 | Set responsive breakpoints | P1 | ✅ |
| D3.3 | Consider max line width | P1 | ✅ |
| D3.4 | Update page header to match | P1 | ✅ |
| D3.5 | Test at multiple viewport sizes | P1 | ✅ |

**Totals:** 74 tasks (19 P0, 38 P1, 17 P2)

---

## Verification Checklist

After each task group:

- [x] `tsc --noEmit` — zero errors
- [x] `npx vitest run` — all tests pass
- [x] Build succeeds: `npm run build`
- [x] Visual verification in running app
- [x] No regressions in existing functionality

After all tasks:

- [x] All 4 themes render correctly
- [x] Editor persistence works across restart
- [x] PDF viewer: outline resizes, collapse/navigate separate, copy works, page-fit default
- [x] AI chat: citations accurate, gear icon opens settings, SVG source icons
- [x] Canvas: list item handles work, no separator, responsive full-width
- [x] Explorer: no duplicate header, SVG icons, resize works
- [x] All context menus use shared ContextMenu or CanvasMenuRegistry

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Editor persistence breaks workspace loading | High — users lose access to workspace | Wrap restore in try/catch, fall back to Welcome tab on error. Store editor state separately from workspace state so corruption doesn't cascade. |
| Icon migration breaks canvas rendering | Medium — visual regression | Migrate one icon system at a time. Canvas icons last (most complex, already working). |
| PDF context menu migration changes behavior | Medium — users lose muscle memory | Match exact same menu items and ordering when switching to shared ContextMenu. |
| List item drag reorder conflicts with Tiptap | High — data loss in canvas pages | Prototype drag reorder in isolation first. Use ProseMirror `tr.insert` / `tr.delete` for atomic node moves. Test with undo/redo. |
| Theme audit reveals 100+ hardcoded colors | Low — labor intensive but not risky | Batch by component. Prioritize visible surfaces (PDF viewer, AI settings). |
| Full-width responsive changes break existing pages | Medium — layout shift | Keep `max-width: 900px` for normal mode untouched. Only change full-width mode. Add CSS `@container` or `clamp()` for smooth scaling. |

---

## Execution Order (Recommended)

**Phase 1 — Quick Wins (P0s, ~1 day)**
1. B5 — Default scale to page-fit (1 line change)
2. D2 — Remove sidebar separator (delete 2 lines + CSS)
3. B3 — Fix context menu copy (capture at show time)
4. B2 — Separate outline collapse from navigation

**Phase 2 — Infrastructure (P0+P1, ~2 days)**
5. A4.1–A4.3 — Shared icon registry + file-type icons
6. A3.1 — Migrate PDF context menu to shared ContextMenu
7. A6 — Editor split group border
8. A7 — Ribbon height alignment

**Phase 3 — Core Features (P0+P1, ~3 days)**
9. A1 — Editor persistence (largest task)
10. A2 — Explorer sidebar scrolling/resize
11. B1 — Resizable PDF outline

**Phase 4 — AI Polish (P1, ~2 days)**
12. C1 — Citation attribution fix
13. C2 — Move AI Settings to chat header
14. C4 — File-type source icons (depends on A4)

**Phase 5 — Canvas & Cosmetic (P1+P2, ~2 days)**
15. D1 — List item drag handles
16. D3 — Responsive full-width
17. A4.4–A4.7 — Icon migration (explorer, search, chat, consolidation)
18. A8+A9 — Explorer title + workspace naming

**Phase 6 — Polish Pass (P2, ~1 day)**
19. A5 — Theme audit
20. C3 — AI avatar SVGs
21. B4 — Search bar polish
22. A3.2–A3.4 — Menu documentation + audit
