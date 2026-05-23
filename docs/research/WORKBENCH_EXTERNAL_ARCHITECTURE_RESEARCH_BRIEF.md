---
Status: Draft
Author: Research Agent — external track (subagent invocation)
Branch: systems-redesign-planning
Commit: d684184
Created: 2026-05-23
---

# Parallx Workbench — External Architecture Research Brief

## Executive Summary

This brief documents successful extension and contribution patterns from three mature workbench/IDE platforms: **VS Code**, **Eclipse IDE**, and **JetBrains IntelliJ Platform**. Each platform provides distinct approaches to plugin contribution, resource identity, selection management, and capability gating. Where Parallx's current-code patterns map to these external systems, this research identifies applicable lessons and explicit anti-recommendations for the redesign.

The central finding: **no single platform perfectly answers all 10 open design questions, but their composite patterns illuminate a path that is less fragile than Parallx's current one-off bridges and more maintainable than any individual reference platform.**

---

## I. VS Code — Contribution Points Model

**Dominant reference.** Version: 1.99 (May 2026). Documentation: https://code.visualstudio.com/api/references/contribution-points

### A. Pattern Summary

VS Code's extension contribution system is declarative-first via `package.json` and programmatic-second via the VS Code API.

| Concept | Definition | File Anchor | Public Docs |
|---|---|---|---|
| **Contribution Point** | A named extension hook (e.g., `contributes.commands`, `contributes.views`, `contributes.keybindings`) | `package.json::contributes` | https://code.visualstudio.com/api/references/contribution-points |
| **Command** | Named, registered action with title, category, icon, enablement (`when` clause). Keybindings bind to command IDs, not implementation. | `commands, keybindings` contributions | https://code.visualstudio.com/api/references/contribution-points#contributes.commands |
| **Context Key** | A boolean or string predicate observable by all extensions; evaluated in `when` clauses to control visibility/enablement. Examples: `editorFocus`, `explorerViewletFocus`, `editorTextFocus`. | `when: "editorTextFocus && editorHasSelection"` | https://code.visualstudio.com/api/references/when-clause-contexts |
| **Menu Contribution** | Declarative placement of commands into menus or toolbars. Multiple menus: `editor/context`, `explorer/context`, `view/title`, `commandPalette`. Group-based sorting via `group: "1_run@5"`. | `menus.editor/context[0].when` | https://code.visualstudio.com/api/references/contribution-points#contributes.menus |
| **View** | A panel contributed to the Explorer, SCM, Debug, or Test activity bar via `viewsContainers` and `views` contributions. Populated by TreeView or WebviewView provider. | `views.explorer[0]`, `viewsContainers.activitybar[0]` | https://code.visualstudio.com/api/references/contribution-points#contributes.views |
| **Extension API** | `vscode` module namespace exposes commands, editors, windows, workspace, debug, scm, languages, etc. Commands invoked via `vscode.commands.executeCommand(id, ...args)`. | `import * as vscode from 'vscode'` | https://code.visualstudio.com/api/references/vscode-api |
| **Activation Event** | Trigger that loads an extension's code. Examples: `onCommand:cmd.id`, `onView:viewId`, `onLanguage:typescript`, `workspaceContains:package.json`, `*` (eager on startup). | `activationEvents: ["onCommand:extension.sayHello"]` | https://code.visualstudio.com/api/extension-guides/activation-events |
| **Extension Host** | Single-threaded Node.js process hosting all extensions; communicates with main workbench via `ExtensionHostWorker` IPC. Extensions share global scope. | Renderer ↔ ExtensionHost (IPC) | https://code.visualstudio.com/api/advanced-topics/extension-host |

### B. How Parallx Maps Today

| VS Code Pattern | Parallx Current Equivalent | File:Line | Gap |
|---|---|---|---|
| `contributes.commands` | `src/contributions/commandContribution.ts`, `src/commands/commandRegistry.ts` | L40, L33 | Commands exist but no centralized `when` clause model like VS Code. Visibility is per-handler, scattered. |
| Context keys (`CTX_*`) | `src/context/workbenchContext.ts:L64` | L64+ | Parallx has `CTX_SIDEBAR_VISIBLE`, `CTX_PANEL_VISIBLE`, but no public contract or discoverable list. ~10 keys vs VS Code's 100+. |
| `contributes.views` | `src/contributions/viewContribution.ts:L92` | L92 | Views exist but no cross-extension model. Built-ins only. No `when` clause gating. |
| `contributes.menus` | `src/contributions/menuContribution.ts:L46` | L46 | Menus exist. Group sorting exists. But no `when` clause context integration. Hard-coded visibility. |
| Selection → Dispatcher | `src/services/selectionActionDispatcher.ts:L16` + `selectionActionHandlers.ts:L35+` | L16, L35+ | **One-off bridge pattern.** Selection changes are routed to hard-coded handlers (`AddSelectionToChatHandler`, `SendSelectionToCanvasHandler`) instead of a declarative "listen for selection with `when` clause" model. |
| Command invocation | `src/api/bridges/commandBridge.ts` | (inferred) | Extensions invoke commands via API. Similar to `vscode.commands.executeCommand()`. |
| Resource URI | File paths, canvas URIs (`parallx.canvas:canvas:<uuid>`), editor IDs | Mixed | **No stable, composable URI scheme.** Files use file:// paths. Canvas uses custom scheme. Chat sessions have no URI. |

### C. What Parallx Should Learn

1. **Declarative-before-programmatic model:** VS Code's `package.json` contributions are validated, discoverable, and de-coupled from extension code loading. Parallx's current manifest model (`src/tools/toolManifest.ts`) is partial—it lists tools but does not declare contributions with visibility predicates. Adding a `when` clause layer to Parallx contributions would eliminate many one-off bridges.
   - **Evidence:** https://code.visualstudio.com/api/extension-guides/overview (contributes table shows 35+ contribution types, all declarative).

2. **Context as a composable selection predicate:** VS Code's context keys (`editorTextFocus`, `editorHasSelection`, `resourceScheme == file`, etc.) are published by the workbench and observable by all extensions via `when` clauses. This enables **declarative visibility gating without per-feature bridges.**
   - **Parallx analog:** Instead of `selectionActionDispatcher` routing to named handlers, Parallx could publish `selection.changed` event with a typed Selection object, and let each surface declare `when: "selection.type == 'file' || selection.type == 'canvas'"` to opt in.
   - **Evidence:** https://code.visualstudio.com/api/references/when-clause-contexts lists 100+ context keys; each is a predicate on workbench state.

3. **Activation events as lazy loading gates:** VS Code's `onCommand:`, `onView:`, `onLanguage:`, `workspaceContains:` prevent extensions from loading until their first relevant trigger. Parallx's current `src/tools/activationEventService.ts` is less granular—most tools activate on Phase 5 indiscriminately.
   - **Parallx gain:** Lazy activation of heavy tools (e.g., media-organizer, text-generator) would improve startup latency.
   - **Evidence:** Current-code brief §B.1, steps 1–2: workspace open → tool activation. No on-demand deferral.

4. **Unified URI scheme for resources:** VS Code does not solve this perfectly (file:// paths, custom schemes like `vscode-notebook-cell://`), but the presence of `contributes.resourceLabelFormatters` shows VS Code's intent: resources have stable URIs, and formatters are pluggable per scheme.
   - **Parallx gain:** Standardizing Resource as `parallx://<type>:<id>[?params]` (e.g., `parallx://file:abc123`, `parallx://canvas:page-uuid`) would let chat, canvas, explorer all reference the same identity without translating URIs.

### D. What Parallx Should NOT Copy

1. **Extension host isolation per extension:** VS Code's extension host is a single Node.js process hosting ALL extensions. This creates a shared global scope and single point of failure if any extension crashes. Parallx runs built-in tools inline in the renderer and external extensions in-process, which has the same problem.
   - **Anti-recommendation:** Do NOT create per-extension processes or isolated VM contexts for each tool. The cost is orders of magnitude: forking a process per tool makes tool activation 100–1000ms slower. Parallx already has this risk; do NOT make it worse by isolating further.
   - **Source:** VS Code's Extension Host: https://code.visualstudio.com/api/advanced-topics/extension-host describes the single-threaded model; JetBrains avoids this by grouping plugins into a single app-level plugin system (see §II).

2. **Eager activation on all events:** VS Code's `activationEvent: "*"` (load on startup) can be a footgun if overused. Parallx should NOT adopt a pattern where every built-in tool activates eagerly; instead, use precise activation events.
   - **Anti-recommendation:** Do NOT add an `activationEvents: ["*"]` catch-all to all tools. Current-code brief shows most tools activate in Phase 5; this is already too broad.

3. **When clauses as the only visibility gate:** VS Code's `when` clauses are strings evaluated at runtime. While declarative, they are not typed and can become hard to debug. A typesafe context system (with autocomplete in code) is better.
   - **Anti-recommendation:** Do NOT replicate VS Code's string-based `when` clause syntax for Parallx. Instead, use typed context keys (TypeScript enum or const dictionary) so extensions can reference them by name with IDE intellisense.

### E. Overengineering Risk

**Risk: Contribution explosion without ownership.** VS Code has 35+ contribution types. If Parallx adopts a fully declarative model without clear ownership of each contribution type, the manifest grows to 5000+ lines, and no one owns the semantics of `contributes.x[i].when[j]`.

**Mitigation:** Define contribution types in phases. Start with commands, keybindings, menus, views. Do NOT add `contributes.toolbars`, `contributes.docklets`, `contributes.snippets`, etc. until each is used by 3+ features and its semantics are proven.

---

## II. Eclipse IDE — Extension Registry & Plugin Model

**Secondary reference.** Version: 2026-03 (latest). Documentation: https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/core/runtime/IExtensionRegistry.html

### A. Pattern Summary

Eclipse's plugin system is based on OSGi bundles, declarative `plugin.xml` extension points, and a runtime extension registry (`IExtensionRegistry`) that discovers, loads, and manages plugins dynamically.

| Concept | Definition | File Anchor | Public Docs |
|---|---|---|---|
| **Bundle** | An OSGi container for code, metadata, and resources. Each bundle has a `MANIFEST.MF` and optional `plugin.xml`. | `MANIFEST.MF::Bundle-SymbolicName` | OSGi spec, adopted by Eclipse PDE |
| **Extension Point** | A contract declared in `plugin.xml` by a **provider** plugin. Other plugins can contribute extensions to this point. Example: `org.eclipse.core.resources.builders`. | `<extensionPoint name="builders" />` | https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/core/runtime/IExtensionRegistry.html#getExtensionPoint(java.lang.String,java.lang.String) |
| **Extension** | A concrete implementation contributed by a plugin to an extension point. Example: `<builder implementation="com.acme.MyBuilder" />`. | `<extension point="org.eclipse.core.resources.builders">` | Declared in `plugin.xml`, registered via `IExtensionRegistry.addContribution()` |
| **Configuration Element** | Parsed XML child of an extension, exposing attributes and nested elements. Example: `<builder><filter>*.java</filter></builder>`. | `IConfigurationElement`, queried via `IExtensionRegistry.getConfigurationElementsFor()` | https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/core/runtime/IConfigurationElement.html |
| **Registry Listener** | Listens for dynamic plugin adds/removes and fires `IRegistryChangeEvent`. Extensions remain valid only while their plugin is active; they throw `InvalidRegistryObjectException` if accessed after plugin removal. | `IExtensionRegistry.addListener(IRegistryEventListener, extensionPointId)` | https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/core/runtime/IExtensionRegistry.html#addListener(org.eclipse.core.runtime.IRegistryEventListener,java.lang.String) |
| **Namespace** | Plugins are grouped by namespace (same as Bundle-SymbolicName). Extension point IDs are hierarchical: `org.eclipse.platform::builders`, `org.eclipse.jdt::javadoc`. | `IExtensionRegistry.getExtensionPoints(String namespace)` | Namespace = plugin/bundle ID |
| **Dynamic Activation** | Plugins are loaded on first use, not eagerly. Once a plugin is removed from the registry, all its extensions become invalid. Clients must handle `InvalidRegistryObjectException`. | `IExtensionRegistry.getExtension()`, null-check and validity | Plugin unload triggers registry change events; clients must re-query. |

### B. How Parallx Maps Today

| Eclipse Pattern | Parallx Current Equivalent | File:Line | Gap |
|---|---|---|---|
| **Extension Point** (contract) | Built-in tools expose manifest from `activate()` but there is no central registry of **offered** extension points by built-in tools. Explorer, Canvas, Chat do not publish extension points for external tools to plug into. | `src/tools/toolManifest.ts`, `src/built-in/*/main.ts:L300+` | **Major gap:** Parallx's built-in tools are not extensible by external tools. Chat does not offer an extension point for custom participants. Canvas does not offer an extension point for custom block types. |
| **Configuration Element** | Tool manifests in `src/tools/toolManifest.ts` list contributions but do not expose nested structured config (like Eclipse's XML element trees). | L1+ | No nested schema definition. Flat JSON. |
| **Registry Listener** | `src/tools/toolRegistry.ts` fires `onDidRegisterTool` and `onDidUnregisterTool` events. | (inferred event names) | Similar to `IRegistryChangeEvent`, but not implemented for contribution changes—only tool lifecycle. |
| **Dynamic Unload** | Built-in tools are never unloaded. External extensions can uninstall, but no "extension unload handler" is defined. Canvas, Chat, Explorer do not implement cleanup for uninstalled tool references. | `src/tools/toolActivator.ts:L150+` (deactivate exists but error-caught and unclear if removal cleans up contributions) | No per-contribution cleanup. Tool deactivation cleanup is not audited. |
| **Namespace** | Parallx has no namespacing. Tool IDs are flat strings (`media-organizer`, `text-generator`). | `ext/*/package.json::name` | No hierarchical plugin ID like `org.eclipse.jdt::builder`. Hard to avoid collisions if Parallx ecosystem grows. |

### C. What Parallx Should Learn

1. **Extension points as published contracts:** Eclipse's pattern is: core plugins declare extension points (contracts), other plugins implement extensions against those contracts. Parallx's built-in features (Explorer, Canvas, Chat) should publish extension points that allow external tools to add new:
   - Canvas block types.
   - Chat participants or tool executors.
   - Explorer context menu items.
   - Custom resource types.
   - **Benefit:** Reduces hard-coded feature coupling and enables third-party extensibility without modifying core code.
   - **Evidence:** Eclipse has 100+ extension points in the platform core; tools like JDT add 50+. Parallx has ~0 published extension points for built-ins.

2. **Hierarchical plugin namespacing:** Using `org.parallx.core::resource` and `org.parallx.ext.mediaorg::provider` avoids collisions and makes the ownership of extensions clear.
   - **Current risk:** Two external tools independently name a custom view `media-grid` → collision. Namespace prevents this.
   - **Evidence:** Eclipse prevents `org.eclipse.core.resources` and `com.acme.widgets` collisions via fully-qualified plugin ID and extension point name.

3. **Registry change listeners as the extension lifecycle hook:** Rather than `src/tools/toolActivator.ts` manually managing tool state, Parallx could register listeners on specific extension points and auto-populate UI when extensions are added/removed.
   - **Parallx example:** `onDidRegisterExtension("parallx.canvas::blockType")` → auto-add block to palette. `onDidUnregisterExtension()` → remove from palette without UI flicker or manual coordination.
   - **Evidence:** https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/core/runtime/IExtensionRegistry.html#addListener(org.eclipse.core.runtime.IRegistryEventListener,java.lang.String)

4. **Explicit validity checks for extension references:** Eclipse forces clients to call `extension.isValid()` before using extension objects. This is a defensive pattern Parallx should adopt: if a tool uninstalls, its contributed resources become invalid.
   - **Parallx gain:** Canvas blocks contributed by media-organizer should be marked invalid if media-organizer uninstalls. Chat should stop offering media-organizer as a participant. This requires explicit tracking.

### D. What Parallx Should NOT Copy

1. **XML plugin descriptors as the primary manifest:** Eclipse's `plugin.xml` is verbose and brittle. Each plugin declares namespace, name, version, dependencies, activator class, extension points, and extensions in XML. 
   - **Anti-recommendation:** DO NOT use XML for Parallx tool manifests. JSON or TypeScript (like current `toolManifest.ts`) is more maintainable.
   - **Why:** XML is hard to parse dynamically, slow to validate schemas, and prone to encoding issues.

2. **OSGi complexity:** Eclipse's full OSGi runtime brings version resolution, transitive dependencies, lazy class loading, and fragment merging. This is powerful but adds 50,000+ lines of runtime overhead.
   - **Anti-recommendation:** DO NOT implement full OSGi. Parallx's simpler plugin model (tools are files or npm packages, not full bundles) is sufficient.

3. **InvalidRegistryObjectException as a normal control flow:** Eclipse requires clients to catch `InvalidRegistryObjectException` everywhere. This is defensive but makes code verbose and error-prone.
   - **Anti-recommendation:** DO NOT require Parallx clients to wrap every extension query in try-catch. Instead, provide a `getExtensionIfValid()` method that returns null on invalidity. Make validity checking opt-in, not required.

### E. Overengineering Risk

**Risk: Plugin dependency resolution spiral.** If Parallx adopts Eclipse-like version constraints on tools (e.g., `media-organizer >= 1.2.0`), the startup cost of dependency resolution is significant, and version conflicts block startup.

**Mitigation:** Keep tools version-independent within a workspace. If a breaking change is needed, mark the tool as incompatible and disable it, but do NOT block workspace load.

---

## III. JetBrains IntelliJ Platform — Actions, Extensions, Listeners

**Tertiary reference.** Version: 2024.3+ (latest). Documentation: https://plugins.jetbrains.com/docs/intellij/plugin-structure.html

### A. Pattern Summary

JetBrains' plugin system separates **actions** (user-invoked commands), **extensions** (API implementations), and **listeners** (event subscriptions) via a single declarative `plugin.xml` file.

| Concept | Definition | File Anchor | Public Docs |
|---|---|---|---|
| **Action** | Implements `AnAction`, triggered by menu, toolbar, or keyboard. Action groups organize actions into menus. `com.intellij.action` extension point registers the action. | `<action id="MyAction" class="MyActionImpl" />` | https://plugins.jetbrains.com/docs/intellij/plugin-actions.html |
| **Extension Point** | Declared by a host plugin (e.g., `com.intellij.toolWindow`), allows other plugins to contribute implementations. Over 1700 extension points in the platform. | `<extensionPoint name="toolWindow" beanClass="..."/>` | https://plugins.jetbrains.com/docs/intellij/plugin-extension-points.html |
| **Extension** | A plugin implements an extension by declaring `<extension point="com.intellij.toolWindow" implementation="..."/>` in its `plugin.xml`. | `<extension defaultExtensionNs="com.intellij"><toolWindow impl="MyToolWindowFactory"/></extension>` | https://plugins.jetbrains.com/docs/intellij/plugin-extensions.html |
| **Listener** | Plugin subscribes to IDE events via `<listener topic="com.intellij.openapi.fileEditor.FileEditorManagerListener" class="MyListener" />`. | `<listeners><listener topic="..."/></listeners>` | https://plugins.jetbrains.com/docs/intellij/plugin-listeners.html |
| **Service** | A singleton accessible globally or per-project. `ApplicationService`, `ProjectService`. Lazy-loaded on first access. | `<extensions><applicationService serviceInterface="..." serviceImplementation="..."/></extensions>` | https://plugins.jetbrains.com/docs/intellij/plugin-services.html |
| **Extension Declaration** | Two models: **interface-based** (plugin specifies class implementing interface) or **bean-based** (plugin specifies all properties in XML). Bean-based has IDE code-complete support. | `implementation="com.example.MyImpl"` or `key="value"` attributes | https://plugins.jetbrains.com/docs/intellij/plugin-extensions.html#declaring-extension |
| **Activity Tracking** | IDE exposes rich event topics for File, Editor, Project, VCS changes, etc. Over 200 listener topics. Plugins subscribe to topics of interest. | `<listener topic="com.intellij.openapi.wm.ToolWindowManagerListener"/>` | https://plugins.jetbrains.com/docs/intellij/plugin-listeners.html |

### B. How Parallx Maps Today

| IntelliJ Pattern | Parallx Current Equivalent | File:Line | Gap |
|---|---|---|---|
| **Action** (`AnAction`, menus, keybindings) | `src/commands/commandRegistry.ts`, `src/contributions/menuContribution.ts` | L33, L46 | Actions exist and are keybindable. But no grouping into ActionGroups like IntelliJ; menus are flat. |
| **Extension Point** | Parallx built-ins do not declare extension points. No public API for external tools to extend Canvas block types, Chat participants, etc. | (none) | **Major gap.** |
| **Extension** | Tools contribute via `src/tools/toolManifest.ts` but no typed extension schema. Hard to validate that a tool implements the right interface. | `src/tools/toolManifest.ts::L1+` | Manifests are untyped JSON. No schema validation against interface contracts. |
| **Listener** | `src/platform/events.ts` exposes `Emitter<T>` / `Event<T>`. Tools subscribe to canvas, chat, editor, workspace events. | L1+ | Similar to IntelliJ's listener topics. But listeners are scattered across services, not centralized in a registry. |
| **Service** | Parallx has `src/services/*` (workspace, editor, chat, etc.) but they are not registered in a centralized service registry. Direct imports via factory functions. | `src/api/apiFactory.ts:L7+` | Not lazy-loaded in the same way. Services are eager-initialized in workbench phases. |
| **Activity Tracking** | No rich event topic registry. Events are ad hoc per service. | `src/workbench/workbench.ts::onDidInitialize` | Only ~5 workbench-level events. IntelliJ has 200+. |

### C. What Parallx Should Learn

1. **Centralized activity/event topic registry:** IntelliJ publishes 200+ listener topics organized by domain (File, Editor, VCS, Tool Window, etc.). Parallx currently has sparse, implicit events. Publishing a centralized event registry would let tools subscribe to exactly what they need without polling or one-off bridges.
   - **Parallx example:** Instead of polling editor state, tools could listen to `onDidChangeActiveEditor`, `onDidChangeEditorSelection`, `onDidSaveEditorDocument` topics.
   - **Benefit:** Reduces watcher/polling code in tools and ensures all tools react to the same events in the same order.
   - **Evidence:** https://plugins.jetbrains.com/docs/intellij/plugin-listeners.html lists 200+ listener topics by category (openapi.fileEditor.FileEditorManagerListener, openapi.vcs.*, etc.).

2. **Bean-class extension points with IDE-assisted property validation:** IntelliJ's extension declaration supports either interface-based (pluggable implementation class) or bean-based (pluggable properties). Bean-based allows IDE code-complete on XML attributes.
   - **Parallx analog:** Instead of `toolManifest.commands = [{id, title, when?, group?}]`, use a typed bean class with `@Attribute` annotations, allowing tool manifests to declare contributions with IDE validation.
   - **Benefit:** Typos in contribution properties are caught at tool installation time, not runtime.
   - **Evidence:** https://plugins.jetbrains.com/docs/intellij/plugin-extensions.html#extension-properties-code-insight

3. **Action groups as structural containers:** IntelliJ's `ActionGroup` organizes related actions and can be nested. Parallx's menus are flat. Adopting groups would reduce menu nesting complexity.
   - **Parallx gain:** Canvas block operations could be grouped: `Canvas > Insert Block > (Paragraph, Heading, Code, List)` instead of 4 separate menu items.

4. **Service lifecycle as an explicit contract:** IntelliJ's `ApplicationService` and `ProjectService` are loaded on first access and shut down when the application/project closes. Parallx's services are eager-loaded and never explicitly torn down.
   - **Parallx gain:** If media-organizer is a service that's created per-workspace, it can be torn down when the workspace closes, freeing resources without manual cleanup.

### D. What Parallx Should NOT Copy

1. **Tight plugin ID coupling:** IntelliJ plugins are identified by their `id` in `plugin.xml`, and plugins reference each other by ID (e.g., `<plugin id="com.jetbrains.myPlugin" depends="com.intellij.modules.platform"/>`). This requires the IDE to load the declaration and lock down plugin IDs early.
   - **Anti-recommendation:** DO NOT enforce strict plugin ID pre-registration before allowing plugins to load. Parallx's looser model (tools discover each other via file scanning) is more flexible and allows user-installed tools without central registry updates.

2. **Action hierarchy as the only command model:** IntelliJ's command model is **actions and action groups**. There is no separate concept of a "command" with arguments and result types like VS Code's `vscode.commands.executeCommand(id, ...args)`. This makes it hard for tools to programmatically invoke other tools' logic.
   - **Anti-recommendation:** DO NOT remove typed command/tool invocation from Parallx. Instead of forcing everything through menus/keybindings, keep the ability to call tools by name and pass structured args: `api.tools.invoke("media-organizer.importPhotos", { path: "~/Pictures" })`.

3. **Listener topics as the only inter-plugin communication:** IntelliJ discourages direct API calls between plugins. Instead, use listener topics. This is very decoupled but can make debugging hard because the call chain is implicit in listener subscriptions.
   - **Anti-recommendation:** DO NOT remove explicit API calls between Parallx services. Keep both patterns: events for UI-level changes (selection, focus) and direct calls for data services (query canvas pages, fetch file content).

### E. Overengineering Risk

**Risk: Listener subscription explosion.** If Parallx publishes 200+ event topics, tools might subscribe to all of them, causing high message throughput and GC pressure. Listener callbacks can also create dependency cycles: Tool A listens for Tool B's events, Tool B listens for Tool A's events.

**Mitigation:** Start with 20–30 core event topics (Editor, Canvas, Workspace, Selection, Settings). Add more only if a tool explicitly requests a topic that is not covered. Enforce acyclic listener subscriptions via static analysis at tool load time.

---

## IV. Addressing Parallx Open Design Questions

Each question from current-code brief §G is illuminated by external patterns:

### Q1: Canonical `Resource` Identity Across File/Canvas/Chat/Tool Artifacts

**External pattern (VS Code):** URIs with schemes (`file://`, `vscode-notebook-cell://`, custom `parallx.canvas://`). No perfect unified scheme; instead, `contributes.resourceLabelFormatters` allows per-scheme formatters.

**External pattern (Eclipse):** Plugins implement `IResource` hierarchy with stable IDs; extensions query resources by ID from registry.

**Parallx recommendation:**
- Define `Resource` as a **sum type** with variants: `File`, `CanvasPage`, `ChatSession`, `ToolArtifact`.
- Each variant has a **stable, persistent ID** (UUID for canvas pages, file path + hash for files, tool-provided ID for artifacts).
- URI scheme: `parallx://<type>:<id>[?workspace=<uuid>&branch=<hash>]`.
- **Code anchor in current:** Chat uses `parallx.canvas:canvas:<uuid>` (§D.2 current-code brief); generalize to all resource types.
- **Implementation anchor:** `src/links/linkResolverService.ts:L1+` should resolve all resource types via a single `resolveParallxUri(uri) → Resource` function.

**Parallx should NOT:** Abandon per-scheme formatters (like VS Code); instead, centralize the scheme registry and lazy-load formatters per type.

**Overengineering risk:** If Resource becomes a kitchen-sink type with 100 optional fields, it is unmaintainable. Keep Resource minimal: just ID and type. Per-type handlers fetch additional metadata.

---

### Q2: Should `Selection` be a Workbench-Level Primitive Observable by Any Surface?

**External pattern (VS Code):** `editorHasSelection`, `editorTextFocus`, etc. are context keys. UI observes context; commands check `when: "editorHasSelection"` to decide visibility. No central "active selection" service.

**External pattern (IntelliJ):** Listeners for `com.intellij.openapi.editor.CaretListener`, `com.intellij.openapi.vcs.CheckinProjectPanel.SelectionListener`. Each domain publishes its own selection listener topic.

**Parallx recommendation:**
- Define `Selection` as a shared workbench primitive: `{ resource: Resource, location?: { line, col }, context?: Surface }`.
- Publish `selection.onDidChangeSelection` event (TypeScript, not string-based like VS Code's `when` clauses).
- Any surface (Explorer, Editor, Canvas, Chat) emits `setSelection(selection)`.
- Any feature can subscribe: `api.selection.onDidChangeSelection(sel => { ... })` or declare in contributions `when: "selection.type == 'file'"`.
- **Code anchor in current:** `src/services/selectionActionDispatcher.ts:L16` is a one-off bridge; replace with `src/services/selectionService.ts` that emits typed events.

**Parallx should NOT:** Create a "SelectionMode" enum with 20+ variants (File, Editor, Canvas, Chat, Search, etc.). Instead, let each surface define its own selection via a union type.

**Overengineering risk:** Selection can become a bottleneck if every keystroke fires a selection change event. Batch selection updates and coalesce events within a frame (100ms window).

---

### Q3: Where Should `Surface` Concept Live?

**External pattern (VS Code):** `explorer`, `editor`, `panel` are implicit. No `Surface` interface in the API. Instead, commands and context know which surface is active via `when` clauses.

**External pattern (Eclipse):** `IWorkbenchPage` contains `IEditorPart`, `IViewPart`, `IEditorSite`. Surfaces are tightly coupled to the workbench layout.

**Parallx recommendation:**
- Define `Surface` as an interface: `{ id: string, type: 'editor'|'panel'|'sidebar'|'view', active: boolean, focus?: Resource, selection?: Selection }`.
- Live in `src/layout/surfaceRegistry.ts` or `src/workbench/surfaceRegistry.ts`.
- Export a registry: `api.surfaces.getActiveSurface()`, `api.surfaces.getSurfaces()`, `api.surfaces.onDidChangeSurface()`.
- **Current gap:** `src/parts/partTypes.ts:L99+` defines parts but not a unified `Surface` abstraction.

**Parallx should NOT:** Make Surface a subclass of Part. Surfaces are a higher-level concept that group related parts (e.g., "Editor" surface = EditorPart + status bar in specific layout). Keep them orthogonal.

**Overengineering risk:** If Surface becomes a large class with 50 methods (getEditors, getViews, getMenu, etc.), it will be hard to maintain. Keep it lightweight: just metadata, ID, and type.

---

### Q4: Can `Capability` be Centralized?

**External pattern (VS Code):** Capabilities are implicit. Each extension declares what it needs: `"capabilities": { "virtualWorkspaces": true }` in package.json, and the IDE decides if it is compatible.

**External pattern (IntelliJ):** No explicit capability system. Plugins assume they have access to API. Broken plugins crash or are disabled.

**External pattern (Eclipse):** `IWorkspaceDescription::isAutoBuilding()`, `IProject::hasNature()`. Capabilities are ad hoc, per-domain.

**Parallx recommendation:**
- Centralize in `src/services/capabilityService.ts`. Parallel to current `src/services/autonomyFeatureFlags.ts` but more general.
- Define capabilities: `filesystem`, `shell`, `database`, `secrets`, `ai_model`, `network`, `autonomy_task`, etc.
- Each capability has: `{ id, required: boolean, gated: boolean, permission: 'allow'|'deny'|'ask', grantedAt: timestamp }`.
- Tool manifests declare `capabilities: ["filesystem", "ai_model"]`. Workbench checks before activating.
- **Code anchor in current:** `src/services/autonomyFeatureFlags.ts` for autonomy-specific flags; generalize to all capabilities.
- **Code anchor in current:** `src/services/permissionService.ts` for tool execution permissions; integrate with capability checks.

**Parallx should NOT:** Check capabilities in 50 different places. Centralize checks in `src/api/apiFactory.ts` and throw `CapabilityNotGrantedError` if a tool tries to use a denied capability.

**Overengineering risk:** If capabilities become too granular (e.g., `filesystem.write.home`, `filesystem.write.workspace`, `filesystem.read.only`), the permission model becomes POSIX-like and unmaintainable. Stick to 10–15 top-level capabilities.

---

### Q5: Should Tool Deactivation Guarantee Contribution Removal?

**External pattern (VS Code):** Deactivation is implicit (extension host unload). Contributions persist if the UI cache is not cleared.

**External pattern (Eclipse):** Plugin unload fires `IRegistryChangeEvent`. Clients are responsible for handling `InvalidRegistryObjectException` if they still reference unloaded plugin objects.

**External pattern (IntelliJ):** Dynamic plugins support unload, but contributions are not removed automatically. UI may show stale actions.

**Parallx recommendation:**
- Yes, tool deactivation should guarantee contribution removal.
- When a tool is uninstalled or disabled, call a standardized `cleanupToolContributions(toolId)` function that:
  - Removes tool contributions from all registries (commands, views, menus).
  - Emits `onDidUnregisterToolContributions(toolId)` so services can react (e.g., Chat unregisters custom participants).
  - Marks any resources created by the tool as invalid.
- **Code anchor in current:** `src/tools/toolActivator.ts:L150+` (deactivate method exists but cleanup is not comprehensive).

**Parallx should NOT:** Leave stale contributions in the UI after a tool uninstalls. This creates confusion and hard-to-debug bugs where users see actions that do not work.

**Overengineering risk:** Cleanup can be slow if a tool created 1000 canvas blocks. Do cleanup asynchronously and provide a progress notification.

---

### Q6: What is the Migration Path for `parallx.canvas:canvas:<uuid>` URIs if Resource IDs Unify?

**Parallx recommendation:**
- **Backward compatible URI aliasing:** When a canvas page is loaded, its URI is registered in `LinkResolverService` under both the old scheme (`parallx.canvas:canvas:UUID`) and new scheme (`parallx://canvas:UUID`).
- Redirect old URIs to new URIs: if `parallx.canvas:canvas:UUID` is resolved, return the canonical `parallx://canvas:UUID`.
- Over time, new canvas pages use the canonical scheme. Old pages are migrated on first access.
- **Code anchor in current:** `src/built-in/canvas/main.ts:L150+` (canvas link resolver); update to emit both old and new URIs.
- **Implementation:** `src/links/linkResolverService.ts::registerResourceAlias(oldUri, newUri)`.

**Parallx should NOT:** Do a one-time migration script that breaks old workspaces. Gradual migration with aliasing is safer.

**Overengineering risk:** If resource ID scheme changes again (e.g., from `UUID` to `hash+timestamp`), maintaining multiple aliases becomes a nightmare. Fix the scheme once, make it stable for 5+ years.

---

### Q7: Should Autonomy Be Lifted Out of Chat Into Top-Level Workbench Task Service?

**External pattern (VS Code):** No autonomy/background task system. Extensions run tasks in the background via the standard Node.js event loop.

**External pattern (IntelliJ):** `ProgressManager`, `Task`, `BackgroundableTask` for long-running work. Tasks can be canceled, report progress, and run in background or foreground.

**Parallx recommendation:**
- Yes, autonomy should be a top-level service, not nested in Chat.
- Create `src/services/taskService.ts` with:
  - `registerTask(id, definition)` — define a task with cron schedule, concurrency limit, retry policy.
  - `executeTask(taskId, args)` — run synchronously or enqueue for background execution.
  - `onDidCompleteTask` — event for task completion or failure.
- Chat can use taskService to schedule agent heartbeats and sub-agent work without owning the task lifecycle.
- **Code anchor in current:** Chat activation at `src/built-in/chat/main.ts:L100+` directly manages heartbeat and cron. Move to taskService.

**Parallx should NOT:** Keep autonomy hard-coded in Chat. This couples Chat to background work and makes it hard for other tools (e.g., media-organizer, text-generator) to schedule background tasks.

**Overengineering risk:** If taskService becomes a full job scheduler with queues, retries, and persistence, the scope explodes. Start simple: in-memory queue, immediate retry on failure, no persistence.

---

### Q8: Should `SelectionActionDispatcher` Be Replaced by Typed Events?

**External pattern (VS Code):** Events via `Emitter<T>`, not a dispatcher.

**External pattern (IntelliJ):** Listener topics for events.

**Parallx recommendation:**
- Yes. Replace `src/services/selectionActionDispatcher.ts:L16` + `selectionActionHandlers.ts:L35+` with:
  - `src/services/selectionService.ts::onDidChangeSelection(handler: (sel: Selection) => void)`.
  - Each surface emits typed Selection events: `Explorer.onDidChangeSelection`, `Editor.onDidChangeSelection`, etc.
  - Handlers subscribe to the events they care about instead of a dispatcher routing to named handlers.
- **Benefit:** No more hard-coded handler names. Adding a new destination for selection (e.g., a new tool) does not require modifying `selectionActionHandlers.ts`.

**Parallx should NOT:** Keep SelectionActionDispatcher but refactor it to use events internally. It is a legacy abstraction that conflates routing with action dispatch.

**Overengineering risk:** If selection events are not debounced, every keystroke fires an event, and listeners are called 100+ times/sec. Throttle or debounce selection events to 100ms windows.

---

### Q9: Should `Workspace` Be the Canonical Owner of Folder Set?

**External pattern (VS Code):** `workspace.workspaceFolders` is the canonical source. File service derives the root from workspace folders.

**External pattern (Eclipse):** `IWorkspace` owns projects; `IProjectDescription` owns project references (folders). Tight coupling.

**Parallx recommendation:**
- Yes. Make `Workspace` the canonical owner of the folder set.
- `src/workspace/workspace.ts:L38` should be the source of truth: `Workspace.folders: WorkspaceFolder[]`.
- `FileService` derives its root: `getWorkspaceRoot() → workspace.folders[0]` (for now; multi-root is future work).
- When folders change, Workspace emits `onDidChangeFolders`, and FileService re-scans.
- **Code anchor in current:** Currently, `Workspace.folders` and `FileService.setWorkspaceRoot()` are dual sources. Unify.

**Parallx should NOT:** Create a separate FolderRegistry service. One source, one event.

**Overengineering risk:** If folder changes are not debounced, a move of a large folder triggers hundreds of file-watcher events. Batch folder changes into a single `onDidChangeFolders` event.

---

### Q10: What Persistence-Version Migration Test Pattern Should Be Standard?

**External pattern (VS Code):** `.vscode/settings.json` is JSON with no schema versioning. Breaking changes require UI migration (e.g., show a dialog and offer to migrate).

**External pattern (Eclipse):** Workspace format version in `.metadata/.plugins/org.eclipse.core.resources/.root/.indexes/`. On version mismatch, migration scripts run.

**External pattern (IntelliJ):** Project file (`project.iml`) has a version attribute. Inspection framework runs migration inspections on load if version is old.

**Parallx recommendation:**
- Define a `persistenceVersion: number` in `.parallx/workspace-state.json`.
- Create `src/workspace/migrationService.ts` with:
  - `registerMigration(fromVersion, toVersion, handler)` — handler is a function that transforms workspace state.
  - `migrateWorkspace(workspace, targetVersion)` — runs all applicable migrations in sequence.
- Store migration logs in `.parallx/migration-log.json` for debugging.
- **Test pattern:** For each migration, create a test workspace at the old version, apply the migration, and assert the result.
  - File: `tests/unit/persistenceMigration.test.ts` (new).
  - Example: `test('migrates canvas pages from v1 to v2 format')`.
- **Code anchor in current:** `src/workspace/workspaceLoader.ts:L23` loads state; call `migrationService.migrateWorkspace()` before parsing.

**Parallx should NOT:** Silently upgrade workspace state without a record. Always log migrations so users can debug if something goes wrong.

**Overengineering risk:** If every feature adds a migration, the migration chain can become circular or have side effects. Enforce: migrations are idempotent, ordered, and one-way (no rollback).

---

## V. Summary Matrix: Which Platform Patterns Solve Which Questions

| Question | VS Code | Eclipse | IntelliJ | Parallx Recommendation |
|---|---|---|---|---|
| 1. Resource identity | URI schemes + formatters | Registry + IDs | Not well-defined | Unified URI scheme + formatters (VS Code model) |
| 2. Selection observable | Context keys | Listeners | Listener topics | Typed event (IntelliJ model) |
| 3. Surface concept | Implicit | Tight coupling | Not explicit | Explicit registry (IntelliJ + custom) |
| 4. Capability central | Implicit in manifest | Ad hoc | Ad hoc | Centralized registry (custom, inspired by VS Code's capabilities) |
| 5. Tool deactivation cleanup | Implicit (host unload) | Registry change events | Dynamic unload | Explicit cleanup registry (Eclipse model) |
| 6. URI migration | Aliasing recommended | Migration scripts | Not defined | Aliasing + migration logs (VS Code + Eclipse hybrid) |
| 7. Autonomy as service | No background tasks | BackgroundableTask | No autonomy | Top-level task service (IntelliJ model) |
| 8. Selection dispatcher → events | Events/Emitter | Listeners | Listener topics | Typed events (VS Code model) |
| 9. Workspace folder owner | `workspace.workspaceFolders` | Coupled to project | Not defined | Workspace canonical (VS Code model) |
| 10. Persistence migration tests | No version schema | Migration scripts | Version attributes | Versioned state + migration tests (Eclipse + IntelliJ hybrid) |

---

## VI. Composite Recommendation: Parallx External Architecture Hybrid

**Do not adopt any single external system verbatim.** Instead, assemble Parallx's external architecture from the best of each pattern:

1. **Contribution model from VS Code:** Declarative `package.json`-like manifest (already in use); add `when` clauses for visibility.
2. **Extension points from Eclipse:** Built-in features (Explorer, Canvas, Chat) publish extension points for external tools to plug into.
3. **Events & listeners from IntelliJ:** Centralized event registry with 20–30 core topics (Editor, Canvas, Workspace, Selection, Settings); tools subscribe to topics.
4. **Resource identity from VS Code + custom:** Unified `parallx://` URI scheme with per-type formatters.
5. **Service lifecycle from IntelliJ:** Lazy-loaded, scoped services (per-workspace, per-project) that are torn down when scope closes.
6. **Persistence & migration from Eclipse + IntelliJ:** Versioned workspace state, migration handlers, migration logs.
7. **Capability gating from custom:** Centralized capability registry with per-tool permissions (inspired by VS Code's implicit model).

**Do NOT:**
- Copy VS Code's single-threaded extension host isolation (too expensive).
- Copy Eclipse's OSGi complexity (too heavyweight).
- Copy IntelliJ's tight plugin-to-IDE coupling (lose flexibility).
- Use XML for manifests (prefer JSON/TypeScript).
- Require try-catch for every extension query (prefer null-return for invalidity).

---

## VII. Implementation Priorities for Redesign

1. **Phase 1 (foundation):** Unified Resource URI scheme, centralized capability service, Selection as event.
2. **Phase 2 (extensibility):** Extension points for Canvas block types, Chat participants, Explorer context menus.
3. **Phase 3 (lifecycle):** Explicit tool deactivation cleanup, registry change listeners.
4. **Phase 4 (observability):** Centralized event registry with 20+ core topics; migrate existing features to emit events.
5. **Phase 5 (persistence):** Migration versioning, migration tests, migration logs.

---

## VIII. Risk Mitigation

| Risk | Mitigation |
|---|---|
| Contribution explosion (35+ → 1000+) | Start with 5 contribution types. Add via design review only. |
| Event listener bottleneck | Throttle/debounce high-frequency events (selection, editor scroll). |
| Extension point underuse | Document extension points with examples. Ship 2–3 reference implementations in built-in tools. |
| Circular extension dependencies | Static analysis check at tool load time; fail fast if cycles detected. |
| Persistence migration drift | Every migration must have a test case. Migrations are code-reviewed separately from feature code. |
| Capability scope creep | Fix set of 15 capabilities. New capabilities require design review and justification. |

---

## Conclusion

Parallx's redesign should adopt a **hybrid external model** that combines VS Code's declarative contributions, Eclipse's extension points, and IntelliJ's event-based architecture. This hybrid avoids the weaknesses of any single system while leveraging proven patterns for extension, composition, and observability.

The key insight: **one-off bridges are a smell.** Every bridge (SelectionActionDispatcher, hard-coded canvas-to-chat link, Explorer-to-editor routing) is a violation of the DRY principle and a missed opportunity to publish a composable extension point or event.

By the time Parallx's redesign is complete, there should be **zero one-off bridges.** All cross-feature interaction should flow through published extension points, typed events, or the unified Resource/Selection model.
