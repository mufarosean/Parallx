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
| 5 | `dashboard/widgets/timerWidget.ts` (+ `timerLogic.ts`) | Planner | Timer's Planner button and copy, on by default | open |
| 6 | `dashboard/widgets/weatherWidget.ts`, `marketWidget.ts` | Web Research | Core widgets whose AI refresh needs Web Research's tools | open |
| 7 | `dashboard/widgetTemplates.ts:61-68` | Planner | "Daily brief" template reads the planner | open |
| 8 | `workbench/menuBuilder.ts:143,145` | Planner, Worksheets | Tools menu lists them (greyed out when off) | open |
| 9 | `welcome/main.ts:196` | Planner | "Open Planner" on the Welcome page | open |
| 10 | `chat/skills/defaultSkillContents.ts:459-520` | Web Research | `research-topic` skill seeded into every workspace | open |
| 11 | `openclaw/openclawDefaultRuntimeSupport.ts:104-113` | Web Research | `/research` chat command always offered | open |
| 12 | `openclaw/heartbeatTriggers.ts:242,267`, `chat/main.ts:2385-2501` | Planner | Heartbeat notices and follow-ups name the planner | open |
| 13 | `services/workflows/workflowLibrary.ts:27` (+ `workflowTypes.ts:67`, `workflowRunner.ts:39`) | Planner | "Morning Report" template reads the planner | open |
| 14 | `openclaw/participants/openclawContextReport.ts:173` | Workspace Graph | `/context` tells you to use Workspace Graph | open |
| 15 | `services/sealedWorkspace.ts:33` | Browser | Always-shown setting text names the Browser | open |
| 15a | `worksheet/dashboardPane.ts:458`, `worksheet/main.ts:3534` | Flashcards | Worksheets' plan offers "Review Due Flashcards" (says "not available" when off) | open |

## 2. Work done for a tool that is off

| # | Where | Tool | What | Status |
|---|---|---|---|---|
| 16 | `electron/main.cjs:908`, `browserBridge.cjs:133-346` | Browser | At every start: two browser sessions, ad-block lists downloaded from the internet, re-checked hourly | **fixed**: nothing of the Browser loads until the extension starts it (`browser:start`); turned off, list checks and sweeps stop (`browser:stop`) |
| 17 | `electron/browserAutomationBroker.cjs:448-452` | Browser | At start: clears leftovers, sweeps artifacts on a timer | **fixed** (with 16) |
| 18 | `services/browserAutomationService.ts:172` | Browser | Core service clears browser artifacts on every chat deletion | **fixed**: kept on purpose (it erases the user's own files when they delete a chat), now without starting the Browser (`forgetChatsOnDisk`) |
| 19 | `planner/main.ts:150` (`IPlannerQueryService`) | Planner | Never unregistered: after turning Planner off, heartbeat and workflows keep calling it | open |
| 20 | `services/semanticGraphService.ts` and friends (`workbenchServices.ts:360-407`) | Workspace Graph | Once started, keeps re-indexing after Workspace Graph is turned off; tables created by core | open |
| 21 | `services/autonomyBootstrap.ts` (`workbench.ts:3409`) | Agents | Cron, workflows, task rail built at every start (also used by Chat: decide) | open |

## 3. Core code that exists only for one tool (dormant)

| # | Where | Tool | Status |
|---|---|---|---|
| 22 | `electron/webFetchBridge.cjs` (`main.cjs:257`), preload `webFetch`/`webSearch`, secret `webResearch.braveApiKey` | Web Research | open |
| 23 | `electron/googleSyncBridge.cjs` (`main.cjs:258`), preload `google`; `IPlannerQueryService` in `serviceTypes.ts` | Planner | open |
| 24 | `electron/main.cjs:3307-4013` screen recorder; `fs:hashFile` + `hashWorker.cjs`; `terminal:execStream`; `fs:registerExtraRoots`; `parallx-media://`; `modelBridge.cjs` (onnxruntime) | Atelier | open |
| 25 | `electron/ankiBridge.cjs`, `anki:read` | Flashcards | open |
| 26 | `electron/imageBridge.cjs`, `document:extractWorkbookGrid` | Worksheets | open |
| 27 | `services/browserAutomationService.ts` tool definitions, `browserAutomationTypes.ts` | Browser | open |
| 28 | Policy lists naming tools: `openclawToolPolicy.ts:430` (`RED_TOOLS`), `sealedWorkspace.ts:21`, `openclawSystemPrompt.ts:434`, `commands/m70CommandPolicy.ts:57-59`, `dashboardBridge.ts:256` | Web Research, Browser, Budget, Planner, Atelier | open: should be declared by the tool |
| 29 | `chat/input/chatInputPart.ts:594` (`application/x-mo-items`), `workbench.ts:2348`, `activityTaps.ts:248`, `chat/main.ts:2639` | Atelier, Planner | open |
| 30 | `settings/settingsEditor.ts:79,86` (Planner and Web Research nav groups) | Planner, Web Research | **fixed**: removed; their pages sit under Extensions like any tool's |
| 31 | `theme/px-tokens.css:267-287`, `px-base.css:28`; `ui/brandIcons.ts`; `ui/emptyStates.ts:25-42` | Planner, Worksheets, others | open (styles/icons/copy the tool should bring) |
| 32 | `package.json`: `@ghostery/adblocker-electron`, `onnxruntime-node`, `@univerjs/presets`, `jszip` | Browser, Atelier, Worksheets | open (packaging: a tool's dependencies ship with it) |

## 4. Checked and following the rule

- AI tools: tools register their own (`api.chat.registerTool`); turned off,
  they are removed (`chatBridge.dispose`, `toolActivator.deactivate`) and
  filtered (`languageModelToolsService._isOwnerExtensionDisabled`).
- Dashboard widgets from tools appear only while the tool runs.
- Core manifests contribute nothing for optional tools; the core database
  migrations create no table an optional tool owns.
- No core code reads an optional tool's tables.
