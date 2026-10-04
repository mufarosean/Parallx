# Modularity audit, 2026-10-04

The rule (CLAUDE.md, "The first principle"): the app is only what the user
turned on. The core knows no optional tool; each tool brings its blocks,
widgets, AI tools, settings, commands, menus, prompts and background work
while it runs, and takes them away when turned off.

Optional: the built-ins without `required: true` (Search, Welcome,
Terminal, Output, Indexing, Activity, Diagnostics, Agents, AI Settings,
Appearance, Planner, Worksheets) and every extension in `ext/` (Atelier,
Browser, Budget, Concept Lab, Creations AI, Flashcards, Web Research,
Workspace Graph). Core: Canvas, Chat, Explorer, Dashboard, Settings, Tools.

Status: **fixed** (commit), **open**, or **ok** (checked, follows the rule).

## 1. Seen by the user with the tool off

| # | Where | Tool | What | Status |
|---|---|---|---|---|
| 1 | `canvas/config/blockRegistry.ts` | Planner, Atelier, Worksheets | Agenda, Media Gallery, Practice Problems in every / menu | **fixed** `a2d44b5b`: `api.canvas.registerBlock`, generic `toolBlock` node |
| 2 | `services/settingsRegistryBootstrap.ts:72-79` | Budget, Browser, Flashcards, Atelier, Worksheets | Settings lists every *installed* tool's settings, on or off; never removed | **fixed**: registered as the tool starts, removed when it is turned off (values kept); the older configuration registry now releases them too |
| 3 | `aiSettings/ui/aiSettingsPanel.ts:99,135`, `sections/webResearchSection.ts` | Web Research | "Web Research" settings section (API key, budget) always shown | **fixed**: the extension declares its settings in its manifest (the key as a `secret`, kept in safeStorage); the core section is gone |
| 4 | `canvas/menus/bubbleMenu.ts:132`; `editor/panes/pdfEditorPane.ts:2938`, `markdownEditorPane.ts:183`, `textEditorPane.ts:776` | Flashcards | "Make Flashcard" on every text selection | **fixed**: editors list the selection actions running tools registered (`getToolSelectionActions`); none is hardcoded |
| 5 | `dashboard/widgets/timerWidget.ts` (+ `timerLogic.ts`) | Planner | Timer's Planner button and copy, on by default | **fixed**: tools that keep tasks register a task source (`services/taskSources`); the timer offers "Choose tasks" only while one runs, named after it |
| 6 | `dashboard/widgets/weatherWidget.ts`, `marketWidget.ts` | Web Research | Core widgets whose AI refresh needs Web Research's tools | **fixed**: moved into Web Research (stored type ids kept) |
| 7 | `dashboard/widgetTemplates.ts:61-68` | Planner | "Daily brief" template reads the planner | **fixed**: names no tool; the AI uses whatever schedule tools are on |
| 8 | `workbench/menuBuilder.ts:143,145` | Planner, Worksheets | Tools menu lists them (greyed out when off) | **fixed**: tools add themselves (`contributes.menus` "menubar/tools") and leave when turned off |
| 9 | `welcome/main.ts:196` | Planner | "Open Planner" on the Welcome page | **fixed**: Welcome lists the running tools' Tools-menu entries, redrawn as tools change (`api.tools.onDidChange`) |
| 10 | `chat/skills/defaultSkillContents.ts:459-520` | Web Research | `research-topic` skill seeded into every workspace | **fixed**: the extension brings it (`api.chat.registerSkill`), nothing is written to the workspace; an untouched old copy is removed |
| 11 | `openclaw/openclawDefaultRuntimeSupport.ts:104-113` | Web Research | `/research` chat command always offered | **fixed**: the extension brings it (`api.chat.registerSlashCommand`) |
| 12 | `openclaw/heartbeatTriggers.ts:242,267`, `chat/main.ts:2385-2501` | Planner | Heartbeat notices and follow-ups name the planner | **fixed** (with 19): they read the planner only while its service is registered, which now ends when Planner is turned off |
| 13 | `services/workflows/workflowLibrary.ts:27` (+ `workflowTypes.ts:67`, `workflowRunner.ts:39`) | Planner | "Morning Report" template reads the planner | **fixed**: reads the schedule only while a planner is on (gated on the service); description no longer names Planner |
| 14 | `openclaw/participants/openclawContextReport.ts:173` | Workspace Graph | `/context` tells you to use Workspace Graph | **fixed**: the mind map section shows only while Workspace Graph keeps its cache running |
| 15 | `services/sealedWorkspace.ts:33` | Browser | Always-shown setting text names the Browser | **fixed**: "Pages you browse yourself are unaffected." |
| 15a | `worksheet/dashboardPane.ts:458`, `worksheet/main.ts:3534` | Flashcards | Worksheets' plan offers "Review Due Flashcards" (says "not available" when off) | **fixed**: offered only while Flashcards' study command exists; the plan redraws when tools turn on or off |

## 2. Work done for a tool that is off

| # | Where | Tool | What | Status |
|---|---|---|---|---|
| 16 | `electron/main.cjs:908`, `browserBridge.cjs:133-346` | Browser | At every start: two browser sessions, ad-block lists downloaded from the internet, re-checked hourly | **fixed**: nothing of the Browser loads until the extension starts it (`browser:start`); turned off, list checks and sweeps stop (`browser:stop`) |
| 17 | `electron/browserAutomationBroker.cjs:448-452` | Browser | At start: clears leftovers, sweeps artifacts on a timer | **fixed** (with 16) |
| 18 | `services/browserAutomationService.ts:172` | Browser | Core service clears browser artifacts on every chat deletion | **fixed**: kept on purpose (it erases the user's own files when they delete a chat), now without starting the Browser (`forgetChatsOnDisk`) |
| 19 | `planner/main.ts:150` (`IPlannerQueryService`) | Planner | Never unregistered: after turning Planner off, heartbeat and workflows keep calling it | **fixed**: a service a tool registers through `api.services` is unregistered when the tool deactivates (`ServiceCollection.unregisterInstance`) |
| 20 | `services/semanticGraphService.ts` and friends (`workbenchServices.ts:360-407`) | Workspace Graph | Once started, keeps re-indexing after Workspace Graph is turned off; tables created by core | **fixed**: Workspace Graph stops the cache when it deactivates (`stopCache`: queue dropped, timers cleared, no rebuilds). Tables are created only on first use by the graph. The lineage and concept passes run only on a refresh the user starts from the graph |
| 21 | `services/autonomyBootstrap.ts` (`workbench.ts:3409`) | Agents | Cron, workflows, task rail built at every start (also used by Chat: decide) | **fixed**: Chat (always on) owns them; the heartbeat runs only when turned on, and the scheduled-task and routine checks tick only while an enabled job or scheduled routine exists. The services themselves are storage, built so their lists show; they do no work at rest |

## 3. Core code that exists only for one tool (dormant)

| # | Where | Tool | Status |
|---|---|---|---|
| 22 | `electron/webFetchBridge.cjs` (`main.cjs:257`), preload `webFetch`/`webSearch`, secret `webResearch.braveApiKey` | Web Research | **fixed** for the main process: the bridge (which read the key, but started no timer or request at start) is required on Web Research's first call (`electron/optionalBridges.cjs`); the workspace seal it carried moved to the core `electron/workspaceSeal.cjs` (now preload `workspaceSeal.setSealed`, channel `workspace:setSealed`). **fixed** for the preload: it names no Web Research channel; the tool calls `parallxElectron.optionalBridges.invoke('webSearch:request' \| 'webFetch:request', …)`, which allows only the channels `optionalBridges.cjs` registers in main (the preload reads that same frozen list) and refuses any other before IPC, so it is no pass-through and reaches nothing the named functions did not. Planner, Worksheets, Atelier and Flashcards still have their own named preload objects (their callers can move to the same door) |
| 23 | `electron/googleSyncBridge.cjs` (`main.cjs:258`), preload `google`; `IPlannerQueryService` in `serviceTypes.ts` | Planner | **fixed** for the electron bridge: required on the Planner's first `google:*` call (`optionalBridges.cjs`); it read no credentials and opened nothing at start, and still opens its OAuth loopback only on `google:authorize`. `IPlannerQueryService`: **fixed**: gone from the core; tools that keep a schedule register a schedule source (`services/scheduleSources`: open tasks, task facts, today, sync health, follow-ups) and the Planner does while it runs. Heartbeat and workflow facts read the hub ("Calendar sync is failing", detail and digest hint from the source); workflow facts' `planner` key is now `schedule` (old key still read) |
| 24 | `electron/main.cjs:3307-4013` screen recorder; `fs:hashFile` + `hashWorker.cjs`; `terminal:execStream`; `fs:registerExtraRoots`; `parallx-media://`; `modelBridge.cjs` (onnxruntime) | Atelier | **fixed**: the recorder moved to `electron/screenRecorderBridge.cjs` and `modelBridge.cjs` is required on the tool's first call (`optionalBridges.cjs`; `recorder:anyActive` answers "no" without loading it; quit still kills any ffmpeg and now frees the model worker); onnxruntime loads only in the model worker on the first `models:run`. The hash pool (`electron/hashPool.cjs`) starts no worker until the first hash and stops idle workers after 30 s. Left as **ok**: `terminal:execStream`, `fs:registerExtraRoots` and the `parallx-media://` handler are generic capabilities that do nothing until called (the scheme must be declared before app ready) |
| 25 | `electron/ankiBridge.cjs`, `anki:read` | Flashcards | **fixed**: `anki:read` lives in `optionalBridges.cjs` and requires the bridge on the first import; its stale temp sweep and parser worker run only then, as before |
| 26 | `electron/imageBridge.cjs`, `document:extractWorkbookGrid` | Worksheets | **fixed**: `imageBridge.cjs` is required on the first `image:*` call (`optionalBridges.cjs`). Left as **ok**: `document:extractWorkbookGrid` is in the core document extractor and loads `xlsx` only when called |
| 27 | `services/browserAutomationService.ts` tool definitions, `browserAutomationTypes.ts` | Browser | **fixed**: the Browser brings its tool specs (`AUTOMATION_TOOLS` in `ext/browser/main.js`) to `registerAutomationHost(host, tools)`; the core keeps only the broker machinery and enforces per broker operation (known ops only, declared arguments only, page actions always confirm, `reachesNetwork` and a generic `needsChatTurn` that workflow Tool steps refuse in place of `isBrowserToolName`) |
| 28 | Policy lists naming tools: `openclawToolPolicy.ts:430` (`RED_TOOLS`), `sealedWorkspace.ts:21`, `openclawSystemPrompt.ts:434`, `commands/m70CommandPolicy.ts:57-59`, `dashboardBridge.ts:256` | Web Research, Browser, Budget, Planner, Atelier | **fixed** for the security lists: a tool declares `reachesNetwork` (sealed hides it) and `untrustedOutput` (taints the turn) when it registers an AI tool; the command denylist no longer names tools (their commands reach the AI only by manifest opt-in). Left as **ok**: the prompt legend names a family only when that tool's AI tools are offered this turn; `dashboardBridge` legacy owners is a frozen id map for saved dashboards |
| 29 | `chat/input/chatInputPart.ts:594` (`application/x-mo-items`), `workbench.ts:2348`, `activityTaps.ts:248`, `chat/main.ts:2639` | Atelier, Planner | **fixed**: the chat input accepts a tool's own drag type through the drop handler it registers (`api.chat.registerDropHandler`; Atelier's says a card had no file yet). The sidebar's More Actions lists `contributes.menus` "viewContainer/title" items for the showing container (Explorer and Atelier bring theirs). Signals: the publisher's `actor` stamp decides user or not (`resolveSignalActor`); only the core canvas defaults to the user, no tool is named |
| 30 | `settings/settingsEditor.ts:79,86` (Planner and Web Research nav groups) | Planner, Web Research | **fixed**: removed; their pages sit under Extensions like any tool's |
| 31 | `theme/px-tokens.css:267-287`, `px-base.css:28`; `ui/brandIcons.ts`; `ui/emptyStates.ts:25-42` | Planner, Worksheets, others | **fixed**: Planner's and Worksheets' tokens moved into `planner.css` / `worksheet.css` (same values); px-base's planner selectors were dead (planner.css overrides them) and are gone; a tool brings its icons (`contributes.icons`, registered while it runs: Planner, Agents, Flashcards, Budget, Media Organizer, Creations AI, Web Research, Workspace Graph), brand icons keep only core nouns; Planner, Search and Welcome keep their own empty-state lines (`renderEmptyStateEntry`), three unused entries removed. Left as **ok**: the media viewer, clip, image editor and portrait blocks in px-tokens.css carry raw colours an extension may not write and have neutral names |
| 32 | `package.json`: `@ghostery/adblocker-electron`, `onnxruntime-node`, `@univerjs/presets`, `jszip` | Browser, Atelier, Worksheets | **ok at run time** (checked 2026-10-04 in the real app): no optional tool's library loads or runs while it is off. The main-process ones (`onnxruntime-node`, the ad blocker, `adm-zip`) load on the tool's first call (`optionalBridges.cjs`, `browserBridge.cjs`); Univer is its own bundle (`worksheet-univer.js`) loaded when a worksheet opens. **Open, packaging only**: shipping each tool's dependencies with the tool needs an installer, which Parallx does not have yet |

## 4. Checked and following the rule

- AI tools: tools register their own (`api.chat.registerTool`); turned off,
  they are removed (`chatBridge.dispose`, `toolActivator.deactivate`) and
  filtered (`languageModelToolsService._isOwnerExtensionDisabled`).
- Dashboard widgets from tools appear only while the tool runs.
- Core manifests contribute nothing for optional tools; the core database
  migrations create no table an optional tool owns.
- No core code reads an optional tool's tables.

## 5. Found along the way

- `America/Chicago` was hardcoded in Budget, Atelier, Workspace Graph and
  Web Research. **fixed**: one app time zone, `api.env.timeZone` (the Time
  Zone setting, or this computer's zone when empty), applied from boot; a
  test fails if a tool hardcodes a zone again.
