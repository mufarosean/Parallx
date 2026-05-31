# Parallx Tool SDK — How a tool joins the family

> **Status:** Living contract. Describes the surfaces a tool contributes to and
> the guarantees it gets in return. The goal: a new tool should *slot into*
> Parallx and feel native — not bolt on like a stranger in a harness.

Parallx is a workbench of tools (built-in and external/extension). A tool is a
folder with a `parallx-manifest.json` and a `main.js` that exports
`activate(api, context)` / `deactivate()`. Built-in manifests live in
[builtinManifests.ts](../src/tools/builtinManifests.ts); external tools are
discovered from the tools directory.

There are two ways to contribute, and **both surface in the same shared
places**:

- **Declarative** — `contributes.*` in the manifest. Processed for you.
- **Imperative** — call `api.*` inside `activate()`. For anything dynamic.

When you contribute through these surfaces, you get the family guarantees
below for free. The tool's profile in the **Tool Gallery** then shows its live
"membership" — every command, setting, view, and shortcut it adds, each a
one-click jump to where it lives.

---

## The membership contract (what you get for free)

| You contribute… | …and Parallx gives you | Where it shows up |
| --- | --- | --- |
| Any CSS | Auto-skinned by the `--px` design tokens + the `--vscode-*` bridge — never hardcode colors | Matches the active theme everywhere ([px-tokens.css](../src/theme/px-tokens.css), [themeService.ts](../src/services/themeService.ts)) |
| A **command** | Listed in the Command Palette (Ctrl+Shift+P); runnable from the tool profile | `CommandService` + palette |
| A **setting** | A row in the unified **Settings** hub, grouped under your category | Settings (Ctrl+Alt+S) |
| A **rich settings panel** | Its own category in the Settings hub | Settings hub left-nav |
| A **keybinding** | Registered, conflict-guarded, and user-rebindable | Settings → Keyboard Shortcuts |
| A **view / view container** | A panel in the sidebar / auxiliary bar | Activity bar + sidebar |
| A **dashboard widget** | A card users can add to any dashboard page | Dashboard widget picker |
| An **editor** | Opens as a tab via the editor provider API | Editor groups |

See [project memory: unified settings + commands] for the architecture. The
keybinding **reserved-key guard** (`RESERVED_KEYBINDINGS` in
[keybindingContribution.ts](../src/contributions/keybindingContribution.ts))
means you cannot — and no other tool can — steal core keys like Ctrl+Shift+P.

---

## Contribution surfaces

### Commands
Declarative — `contributes.commands` (id, title, optional category/icon/keybinding/`aiInvocable`).
Imperative — `api.commands.registerCommand(id, handler)` in `activate()`.
Either way the command is in the palette and runnable from your tool profile.

### Settings
Two shapes, both land in the **one** Settings hub:
- **Flat key→value** — declare `contributes.configuration` in the manifest
  (auto-mapped via [manifestSettings.ts](../src/services/manifestSettings.ts)),
  **or** call `ISettingsRegistryService.register(schema)` imperatively. Group
  related keys with the same `category` so they cluster in the hub.
- **Rich custom panel** — `settingsPanelRegistry.register({ id, label, order, fill?, render(container) })`
  ([settingsPanelRegistry.ts](../src/services/settingsPanelRegistry.ts)). This is
  how Appearance and AI Settings live inside Settings. Use `fill: true` if your
  panel brings its own scroll/sub-nav.

Do **not** build a separate settings window. Wire into the hub.

### Keybindings
Declarative — `contributes.keybindings` (command, key, optional `when`).
Reserved keys are refused; conflicts warn. Users can rebind any command from
Settings → Keyboard Shortcuts, and rebinds persist
([keybindingOverrides.ts](../src/services/keybindingOverrides.ts)).

### Views & view containers
Declarative — `contributes.viewContainers` / `contributes.views`.
Imperative — `api.views.registerViewProvider(viewId, { createView(container) })`.
Open a view from anywhere with `executeCommand('workbench.view.show', viewId)`.

### Dashboard widgets
Imperative — get the dashboard registry and call
`registry.registerWidgetType(registration)` in `activate()`
([dashboardTypes.ts](../src/built-in/dashboard/dashboardTypes.ts)). A registration
declares a `configSchema` (form fields), a `refreshPolicy`
(manual/interval/cron), an optional `refresh(ctx)` that returns a string, and
`createWidget(container, ctx)`. `ctx.api` is the full Parallx API — e.g. an
AI widget's refresh is just `api.commands.executeCommand('chat.submitPrompt', { text })`.

### Editors
Imperative — `api.editors.registerEditorProvider(typeId, { createEditorPane(container) })`,
opened via `api.editors.openEditor({ typeId, title, icon })`.

---

## Design rules (so it *feels* like family)

1. **No hardcoded colors.** Use `--px-*` tokens (or `--vscode-*`, which bridge
   to them). A stray `#1e1e1e` is how a tool starts looking foreign.
2. **No parallel control surfaces.** Settings → the hub. Commands → the
   registry. Shortcuts → the keybinding service. Don't reinvent them.
3. **Borders follow the three-tier system** — `--px-chrome-line` between parts,
   `--px-divider` within a surface, `--px-border` for floating surfaces.
4. **Tactile, restrained.** Press feedback on actions, one accent, no pill spam,
   no gratuitous chrome. See [Milestone 83](Parallx_Milestone_83.md).
5. **Icons are out of scope to restyle** — the app/canvas/file-type icon system
   is shared; don't fork it.

---

## Where membership is shown

The **Tool Gallery** (`tools.showInstalled`) lists every tool; opening one shows
a profile with a live **Membership banner** (counts that jump to each shared
surface) and an actionable **Contributions** tab (run a command, open a view,
"Open in Settings", "Manage shortcuts"). That profile is the proof a tool is
part of the family — and the first place to check that a new tool wired itself
in correctly.
