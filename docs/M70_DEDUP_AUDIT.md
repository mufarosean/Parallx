# M70 Command Audit — Deduplication, Exclusion, Opt-in

> **Status:** Awaiting sign-off before code is written (M70 Design Gate 1).

This audit walks every command currently registered in Parallx (built-ins and
shipped extensions) and classifies it for AI invocation. The classification
table is the source of truth for the `aiInvocable` annotation pass and for the
`app__run_command` runtime registry.

## Classification scheme

Each command is assigned exactly one bucket:

| Bucket | Meaning | Action |
|---|---|---|
| **OPT-IN** | Safe to surface to the AI. Zero-arg or single-string-arg. No duplication with existing tools. | `aiInvocable: true` + `aiDescription` |
| **DUPLICATE** | Covered by an existing AI tool (`read_file`, `write_file`, `create_page`, etc.). The existing tool is canonical. | Stay invisible to the AI |
| **OUT_OF_MVP** | Needs complex args (file path, page ID, position, content). MVP supports zero-arg / single-string-arg only — these come back in a phase two. | Stay invisible to the AI (for now) |
| **EXCLUDED** | Permanently excluded per Gate 2 (AI settings, secrets, install, workspace destruction) regardless of opt-in. | Hardcoded denylist enforced in `app__run_command` |

The denylist is enforced even if a future contributor sets `aiInvocable: true`
on an excluded command — Gate 2 has belt-and-braces.

User chose **broad sweep** for opt-in scope: anything that toggles a view,
opens a panel, switches a mode, or runs a one-shot maintenance action is
fair game. The bias is "opt-in unless there's a reason not to".

## Hardcoded EXCLUDED denylist (Gate 2)

These IDs are blocked at the `app__run_command` layer regardless of
`aiInvocable`. They cover AI-settings mutation, install/uninstall, workspace
destruction, and secret-touching paths.

```
ai-settings.open
ai-settings.scrollToSection
aiSettings.manageTools
aiSettings.manageMcp
aiSettings.manageAgents
aiSettings.manageCron
chat.selectModel
chat.switchMode
parallx.installDocling
workspace.resetConfig
workspace.importConfig
workspace.closeFolder
workspace.removeFolderFromWorkspace
workspace.closeWindow
workspace.duplicateWorkspace
workspace.openFolder
workspace.openRecent
workspace.switch
workspace.save
workspace.saveAs
workspace.rename
workspace.addFolderToWorkspace
workspace.exportToFile
workspace.importFromFile
file.revert
file.saveAll
explorer.delete
canvas.deletePage
budget.importCsv
media-organizer.emptyTrash
media-organizer.moveToTrash
memory.openDurable
memory.openTodayLog
```

Reasoning per category:

- **AI settings & model selection** — would let the AI alter its own
  invocation policy. Hard veto.
- **Workspace lifecycle** (open/close/switch/rename/save/duplicate, folder
  add/remove) — affects the very workspace the AI is reasoning about; one
  bad call evicts the user's session.
- **Reset config / import config** — wipes preferences.
- **Install** (`parallx.installDocling`) — runs a network install with side
  effects on the host.
- **Destructive content** (`explorer.delete`, `canvas.deletePage`,
  `file.revert`, `media-organizer.moveToTrash`, `media-organizer.emptyTrash`)
  — irreversible without user-targeted UI; the AI's existing `delete_*`
  tools (where they exist) gate on color and have explicit per-call args.
- **Budget CSV import** — file-write to the user's tracking ledger.
- **Memory durable / today log** — opens the AI's own memory editing
  surfaces; the AI should not be the one navigating them.

## OPT-IN annotated commands

These are cleared for `aiInvocable: true`. The `aiDescription` column is the
phrase the find tool will surface to the AI — written as a capability
statement, not a menu title.

### Workbench: view + layout

| ID | Title | aiDescription |
|---|---|---|
| `workbench.action.showCommands` | Show All Commands | Open the command palette listing every available command. |
| `workbench.action.quickOpen` | Go to File… | Open the quick file picker to navigate to a file by name. |
| `workbench.action.toggleSidebar` | Toggle Sidebar | Show or hide the primary sidebar (explorer, search, etc.). |
| `workbench.action.togglePanel` | Toggle Panel | Show or hide the bottom panel (terminal, output, diagnostics). |
| `workbench.action.toggleMaximizedPanel` | Maximize Panel | Maximize or restore the bottom panel. |
| `workbench.action.toggleAuxiliaryBar` | Toggle Secondary Side Bar | Show or hide the secondary side bar. |
| `workbench.action.toggleStatusbarVisibility` | Toggle Status Bar | Show or hide the status bar at the bottom of the window. |
| `workbench.action.toggleZenMode` | Toggle Zen Mode | Enter or exit distraction-free Zen mode. |
| `workbench.action.toggleNotificationCenter` | Toggle Notification Center | Show or hide the notification center. |
| `layout.reset` | Reset Layout to Defaults | Restore the workbench layout to its default arrangement. |
| `view.moveToSidebar` | Move View to Sidebar | Move the active view container to the sidebar. |
| `view.moveToPanel` | Move View to Panel | Move the active view container to the bottom panel. |
| `workbench.view.search` | Show Search | Reveal the search view in the sidebar. |
| `workbench.view.explorer` | Show Explorer | Reveal the file explorer view in the sidebar. |

### Editor groups

| ID | Title | aiDescription |
|---|---|---|
| `workbench.action.splitEditor` | Split Editor | Split the active editor into a second editor group beside it. |
| `workbench.action.splitEditorOrthogonal` | Split Editor Orthogonal | Split the active editor in the perpendicular direction. |
| `workbench.action.closeActiveEditor` | Close Editor | Close the currently active editor tab. |
| `workbench.action.nextEditor` | Next Editor | Switch focus to the next editor tab. |
| `workbench.action.previousEditor` | Previous Editor | Switch focus to the previous editor tab. |
| `markdown.showPreview` | Markdown: Open Preview | Open a rendered preview of the active markdown file. |
| `markdown.showPreviewToSide` | Markdown: Open Preview to the Side | Open a markdown preview alongside the source. |

### Focus

| ID | Title | aiDescription |
|---|---|---|
| `workbench.action.focusNextPart` | Focus Next Part | Move keyboard focus to the next workbench part. |
| `workbench.action.focusPreviousPart` | Focus Previous Part | Move keyboard focus to the previous workbench part. |
| `workbench.action.focusFirstEditorGroup` | Focus First Editor Group | Move focus to the first editor group. |
| `workbench.action.focusSecondEditorGroup` | Focus Second Editor Group | Move focus to the second editor group. |
| `workbench.action.focusThirdEditorGroup` | Focus Third Editor Group | Move focus to the third editor group. |
| `workbench.action.focusSideBar` | Focus Sidebar | Move focus to the sidebar. |
| `workbench.action.focusPanel` | Focus Panel | Move focus to the bottom panel. |
| `workbench.action.focusActivityBar` | Focus Activity Bar | Move focus to the activity bar. |
| `workbench.action.focusStatusBar` | Focus Status Bar | Move focus to the status bar. |

### Preferences

| ID | Title | aiDescription |
|---|---|---|
| `workbench.action.selectTheme` | Color Theme | Open the color theme picker. |
| `workbench.action.openSettings` | Open Settings | Open the workspace settings editor. |
| `workbench.action.openKeybindings` | Open Keyboard Shortcuts | Open the keyboard shortcuts editor. |

> Note: `selectTheme` opens the picker for the user to choose. Direct
> theme-set (`theme.setDark`, `theme.setLight`) doesn't exist as a command
> today; if/when added it would also be opt-in. The Gate 2 exclusion for
> "AI settings" covers AI-model and tool-policy settings, not visual
> preferences.

### Workspace (safe queries / inspections)

| ID | Title | aiDescription |
|---|---|---|
| `workspace.exportConfig` | Workspace: Export Configuration | Export the workspace configuration to a file for backup. |

### Built-in tools

| ID | Title | aiDescription |
|---|---|---|
| `search.findInFiles` | Search: Find in Files | Open the search view to find text across workspace files. |
| `search.clearResults` | Search: Clear Results | Clear the current search results. |
| `search.collapseAll` | Search: Collapse All | Collapse every group in the search results. |
| `search.expandAll` | Search: Expand All | Expand every group in the search results. |
| `output.clear` | Output: Clear | Clear the current output channel. |
| `output.toggleTimestamps` | Output: Toggle Timestamps | Toggle timestamp display in the output panel. |
| `terminal.clear` | Terminal: Clear | Clear the active terminal. |
| `terminal.restart` | Terminal: Restart | Restart the active terminal session. |
| `diagnostics.runChecks` | Diagnostics: Run Checks | Run the diagnostics checks and show results. |
| `indexingLog.clear` | Indexing Log: Clear | Clear the indexing log entries. |
| `indexingLog.toggleErrorFilter` | Indexing Log: Toggle Error Filter | Toggle the error-only filter in the indexing log. |
| `autonomyLog.markAllRead` | Autonomy Log: Mark All Read | Mark every autonomy log entry as read. |
| `autonomyLog.clear` | Autonomy Log: Clear | Clear all autonomy log entries. |
| `tools.showInstalled` | Tools: Show Installed | Show the list of installed tools and extensions. |
| `editor.toggleWordWrap` | Editor: Toggle Word Wrap | Toggle word-wrap in the active editor. |
| `editor.changeEncoding` | Editor: Change File Encoding | Open the file encoding picker for the active editor. |
| `welcome.openWelcome` | Welcome: Open | Open the welcome page. |
| `theme-editor.open` | Theme Editor: Open | Open the theme editor. |
| `settings.open` | Open Settings | Open the workspace settings editor. |
| `explorer.refresh` | Explorer: Refresh | Refresh the file explorer view. |
| `explorer.collapse` | Explorer: Collapse Folders | Collapse all folders in the file explorer. |
| `explorer.toggleHiddenFiles` | Explorer: Toggle Hidden Files | Show or hide dotfiles and hidden files in the explorer. |

### Chat / AI workflow surfaces

| ID | Title | aiDescription |
|---|---|---|
| `chat.toggle` | Chat: Toggle | Show or hide the chat view. |
| `chat.show` | Chat: Show | Reveal the chat view. |
| `chat.newSession` | Chat: New Session | Start a new chat session. |
| `chat.clearSession` | Chat: Clear Session | Clear the current chat session's messages. |
| `chat.focus` | Chat: Focus | Move focus into the chat input. |
| `chat.stop` | Chat: Stop | Stop the current AI generation. |

### Canvas

| ID | Title | aiDescription |
|---|---|---|
| `canvas.showKeyboardShortcuts` | Canvas: Keyboard Shortcuts | Show the canvas keyboard shortcuts overlay. |
| `canvas.showTemplatePicker` | Canvas: Show Template Picker | Open the canvas template picker. |

> `canvas.newPage` removed: the existing `create_page` AI tool with a title
> arg is the canonical path. Leaving the command in the palette for human
> users; just not surfacing it to the AI.

### Extensions

| ID | Title | aiDescription |
|---|---|---|
| `workspaceGraph.open` | Workspace Graph: Open | Open the workspace graph visualization. |
| `workspaceGraph.refresh` | Workspace Graph: Refresh | Refresh the workspace graph data. |
| `workspaceGraph.rebuildConceptualLinks` | Workspace Graph: Rebuild Conceptual Links | Recompute the semantic edges in the workspace graph. |
| `budget.sync` | Budget: Sync | Sync budget data from connected sources. |
| `budget.reprocessHistory` | Budget: Reprocess History | Reprocess the full transaction history for re-classification. |
| `budget.reclassifyUntyped` | Budget: Reclassify Untyped | Reclassify transactions that have no category. |
| `budget.exportCsv` | Budget: Export CSV | Export the budget data to a CSV file. |
| `textGenerator.openHome` | Text Generator: Home | Open the text generator home page. |
| `textGenerator.openCharacters` | Text Generator: Characters | Open the text generator character roster. |
| `textGenerator.openSettings` | Text Generator: Settings | Open the text generator settings page. |
| `textGenerator.newChat` | Text Generator: New Chat | Start a new text generator chat. |

> Media Organizer commands intentionally excluded from this pass. It is an
> external extension and should opt itself in via the manifest
> `aiInvocable` support added at the end of this milestone; first-party
> code does not annotate other people's extensions.

**OPT-IN total: 72 commands** (after dropping `canvas.newPage` + the 14
media-organizer entries per sign-off).

## DUPLICATE — covered by existing AI tools

These would be useful capabilities but the AI already has a dedicated tool
that does the same job with explicit, typed args. Surfacing them via
`app__run_command` would create two ways to do the same thing and confuse
local models.

| ID | Duplicates |
|---|---|
| `file.openFile` | `read_file`, plus existing context-attach tools |
| `file.newTextFile` | `write_file` (creates new files) |
| `file.save` | implicit in `write_file`; no save-as-command needed |
| `file.saveAs` | `write_file` with a new path |
| `explorer.newFile` | `write_file` |
| `explorer.newFolder` | `create_directory` (or equivalent) |
| `explorer.rename` | `rename_file` / move tool |
| `explorer.revealInExplorer` | not actionable in headless agent context |
| `edit.find` / `edit.replace` | `search` tool / direct edits |
| `edit.undo` / `edit.redo` / `edit.cut` / `edit.copy` / `edit.paste` | terminal-only `document.execCommand` shims; AI should produce new edits, not run UI undo |
| `chat.addFileAttachment` | AI is *inside* the chat; doesn't need to attach to itself |
| `chat.addSelectionContext` | AI already sees its conversation context |
| `chat.getRelatedContent` / `chat.suggestTags` / `chat.autoTagPage` / `chat.getPageTags` / `chat.getSuggestions` / `chat.analyzeSuggestions` / `chat.dismissSuggestion` / `chat.getInlineAIProvider` / `chat.getSelectionActionDispatcher` | internal RPC commands invoked by chat UI surfaces; not user-facing actions |
| `parallx.wakeAgent` | the agent is the one running |
| `autonomy.replay` | replays an agent run — the agent calling this on itself is nonsensical |
| `parallx.chat.openWithInit` | internal helper for welcome card |
| `parallx.openAIUserGuide` | static doc link; not a real workflow action |
| `parallx.openWorkspaceAIConfig` | covered by EXCLUDED AI-settings policy |
| `editor.addSelectionToChat` | the AI is the chat — receives selection via existing context attach |

## OUT_OF_MVP — needs args we can't safely collect yet

MVP supports zero-arg or single-string-arg commands only. These take typed
args (page IDs, file URIs, IDs from other systems) that the AI would have
to *also* discover via a separate tool call. The find→run loop should not
require chaining for MVP; revisit in M70 phase 2.

| ID | Why deferred |
|---|---|
| `canvas.renamePage` | requires `(pageId, newTitle)` |
| `canvas.duplicatePage` | requires `pageId` |
| `chat.getPageTags` | requires `pageId` (also covered by DUPLICATE above) |
| `media-organizer.createAlbum` | requires album name + media IDs |
| `media-organizer.saveSmartAlbum` | requires saved-search payload |
| `media-organizer.openSmartAlbum` | requires album ID |
| `media-organizer.stackSelected` | requires media-ID list |
| `media-organizer.revealInMO` | requires media path |
| `view.show` (`workbench.view.show`) | requires view ID |
| `part.resize` | requires part ID + size delta |
| `workbench.action.gotoLine` | requires line number; UI prompt-driven |
| `goto-line` (quick-access) | quick-pick type, not a command |

## Counts

| Bucket | Count |
|---|---|
| OPT-IN | 72 |
| DUPLICATE | ~25 |
| OUT_OF_MVP | ~12 |
| MEDIA_ORGANIZER (ext-managed, defer) | 14 |
| EXCLUDED | 32 |
| **Total commands inventoried** | **~156** |

Inventory sources (registration call sites):
- `src/commands/*.ts` aggregated in `structuralCommands.ts:ALL_BUILTIN_COMMANDS` — 57
- `src/built-in/*/main.ts` per-tool registrations — ~62
- `src/workbench/statusBarController.ts` — 1
- `ext/{budget,workspace-graph,media-organizer,text-generator}/main.js` — 35

## Sign-off (resolved)

1. **Theme commands** — keep the picker only (`workbench.action.selectTheme`).
   No explicit `theme.setDark` / `theme.setLight` in this milestone.
2. **`chat.selectModel`** — EXCLUDED. Model selection is an AI-settings
   mutation and the AI should not steer its own invocation policy.
3. **`workspace.exportConfig`** — stays OPT-IN. It writes a JSON snapshot
   of workspace settings (secrets filtered) and the user picks the
   destination via a save-file dialog. Read-only on settings,
   user-driven on write target.
4. **`canvas.newPage`** — removed from OPT-IN. The existing `create_page`
   AI tool (which takes a title arg) is the canonical path.
5. **Media Organizer** — all 14 entries removed from OPT-IN. The
   extension can opt itself in via the manifest `aiInvocable` support
   shipped at the end of this milestone.

Audit signed off. Next: extend `CommandDescriptor`, add the two tools,
wire the toggle, annotate the 72 opt-in commands.
