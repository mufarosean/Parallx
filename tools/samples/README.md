# Parallx External Tool Samples

This directory contains sample tools that demonstrate the Parallx tool API.
They serve as templates for building your own tools.

## Installing a Sample Tool

Copy the tool folder to your user tools directory:

```bash
# Windows
xcopy /E /I tools\samples\hello-world "%USERPROFILE%\.parallx\tools\hello-world"

# macOS / Linux
cp -r tools/samples/hello-world ~/.parallx/tools/hello-world
```

Restart Parallx. The tool will be automatically discovered, registered, and
activated based on its `activationEvents`.

## Creating Your Own Tool

1. Create a folder under `~/.parallx/tools/<your-tool-name>/`
2. Add a `parallx-manifest.json` — see [hello-world/parallx-manifest.json](hello-world/parallx-manifest.json)
3. Add a `main.js` (ES module) that exports `activate(parallx, context)` — see [hello-world/main.js](hello-world/main.js)
4. Restart Parallx

### Manifest Reference

| Field | Required | Description |
|-------|----------|-------------|
| `manifestVersion` | ✅ | Always `1` |
| `id` | ✅ | Unique ID, e.g. `"my-publisher.my-tool"` |
| `name` | ✅ | Human-readable name |
| `version` | ✅ | Semver version |
| `publisher` | ✅ | Publisher name |
| `description` | | Short description |
| `main` | ✅ | Entry point (relative path to JS module) |
| `activationEvents` | ✅ | When to activate: `"*"`, `"onStartupFinished"`, `"onCommand:<id>"`, `"onView:<id>"` |
| `engines.parallx` | ✅ | Parallx version requirement (semver range) |
| `contributes` | | Declarative contributions (commands, views, viewContainers, configuration, menus, keybindings, statusBar) |

### Activation Events

| Event | When |
|-------|------|
| `*` | Immediately on startup |
| `onStartupFinished` | After workbench is fully ready |
| `onCommand:<id>` | When the specified command is first invoked |
| `onView:<id>` | When the specified view is first shown |

### API Surface

The `parallx` object passed to `activate()` mirrors the VS Code extension API shape:

- `parallx.views.registerViewProvider(viewId, provider)` — Register a view
- `parallx.views.setBadge(containerId, badge)` — Set an activity bar badge
- `parallx.commands.registerCommand(id, handler)` — Register a command
- `parallx.commands.executeCommand(id, ...args)` — Execute a command
- `parallx.window.showInformationMessage(msg)` — Show a notification
- `parallx.window.createOutputChannel(name)` — Create an output channel
- `parallx.workspace.getConfiguration(section)` — Access configuration
- ... and more (see `src/api/parallx.d.ts` for the full API surface)
