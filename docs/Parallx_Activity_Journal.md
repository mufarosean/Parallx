# Activity Journal — the app's common activity language

One append-only stream of human-readable events describing what happened in
Parallx, from app open to app close:

```
12:01 app started session in workspace "study"
12:01 user focused explorer view
12:02 user opened pdf "Friedland_Ch9.pdf"
12:14 user viewing canvas page "Exam 7 — Reserving"
12:14 user signal created page "Exam 7 — Reserving"
12:31 user asked the assistant "summarize the trend selection section"
12:31 assistant ran tool search_knowledge
12:40 user left the app window
```

This is the sense heartbeat/autonomy was missing: it could only see file-change
aftermath, never behavior. Now every wake-up seed includes the timeline, the
model can query history on demand, and diagnostics has a ready-made
"what led up to this".

## Grammar

`IActivityEvent` (src/services/activityJournalService.ts):

| field | meaning |
|---|---|
| `ts` | epoch ms |
| `actor` | `user` \| `ai` \| `system` \| `ext:<toolId>` — **first-class**, so the agent never mistakes its own actions for the user's |
| `verb` | short verb phrase ("opened", "ran", "asked the assistant") |
| `object` | what it acted on, with names quoted (`pdf "x.pdf"`) |
| `detail` | optional extra (truncated 300) |
| `source` | which tap produced it |
| `ref` | optional **stable identity** of the object (`page:<id>`, editor resource id) |
| `count` | coalesced repeat count |

Rules baked into `note()`: **semantic events only, never raw input** (typing
comes from debounced save commits, not keystrokes); **redact before store**
(credential-shaped fragments and long hex are stripped — the stream is destined
for model prompts, and cloud providers are opt-in-enabled); **coalesce bursts**
(same actor+verb+object+ref within 90s folds into one `×N` line).

**Refs — clear to the human, exact for the model.** Display names collide (two
pages named "Notes"); a reader that needs to ACT on a line needs the object's
identity, not its title. The model-facing render (`renderActivityLine`, used by
the heartbeat seed and the `activity_log` tool) appends a compact `[page:abc]`
suffix so the agent can `canvas_read_page` the exact page instead of
title-searching into the wrong twin; the human panel keeps the line clean and
reveals the ref on hover. Producers that know identity supply it: canvas saves
(`page:<id>`), editor open/close/viewing (editor resource id).

## Storage

In-memory ring (600 events) is the session's source of truth; a per-workspace
SQLite table `activity_log` mirrors it via batched `runTransaction` flushes
(1s / 32-event window), count-capped at 4,000 rows. Flushes are forced at the
three exit points (app close inside the teardown budget, workspace switch,
open-folder) with a `session ended` line. A closed DB never blocks `note()`.

## Producers (wired in src/workbench/activityTaps.ts)

| seam | what it narrates |
|---|---|
| `CommandService.onDidExecuteCommand` | every palette/keybinding/menu/extension/AI command, by human title |
| `IEditorService` open-set diff + active change | opened/closed/viewing editors, typed by kind (pdf, canvas page, …) |
| `FocusTracker.onDidFocusView` | which view has attention (coalesced) |
| `ContextMenu.onDidSelectAny` (new static tap) | every menu selection app-wide, by label |
| `ISettingsRegistryService.onDidChange` + theme | settings and theme changes |
| `AutonomySignalService` bridge | existing extension signals (canvas page-created, budget alerts) join the stream |
| `ChatService.onDidSendUserRequest` (new emitter) | user queries vs. autonomous turns, split by session origin |
| `RuntimeHookRegistry` tool observer (previously dormant) | every AI tool execution and failure |
| window blur/focus | left/returned to the app |
| `CanvasDataService.onDidSavePage` (wired in canvas/main.ts) | **typing in canvas pages** — `user edited page "X" [page:id] ×N — ~chars`; fires only from the editor save pipeline, so it is the user's own keystrokes (AI tools mutate via a different path) |

Attribution caveats, learned the hard way: the command tap cannot yet tell a
user gesture from programmatic plumbing or the AI's `app__run_command` (all
fire the same emitter), so dispatch-plumbing ids (`parallx.autonomy.signal`,
`chat.runBackgroundPrompt`, `chat.submitPrompt`) are COMMAND_NOISE — their
events are narrated by their own taps — and command events are excluded from
habit learning entirely. Canvas signals carry an `actor` stamp (`user` |
`agent`) so the MIND's human-behavior senses (habits, capability meter) never
learn from the agent's own page mutations.

Extensions narrate their hand-wired UI through **`api.activity.note(verb,
object, detail?)`** — the actor is stamped with the calling tool's id by the
API closure, never self-reported.

## Consumers

1. **Activity panel (user-facing)** — `src/built-in/activity-log/`, an
   "Activity" tab in the bottom panel: live timeline seeded from persisted
   history, incremental appends (coalesced events rewrite their row), actor
   filters (All / User / Assistant / App), auto-scroll, and copy-to-clipboard
   (`activityLog.copyRecent`) for pasting into bug reports.
2. **Heartbeat wake context** — `getRecentActivity` dep renders the last 40
   lines into every review seed, explicitly telling the model that
   "assistant" lines are its own actions (anti-self-echo).
3. **`activity_log` chat tool** — read-only, always allowed; the model can ask
   for the last N minutes/events at any time (diagnostics, "what was I doing").
4. **`journal.onDidAppend` / `renderRecent()`** — available for further
   surfaces (error-report attachments, dashboard widgets).

## Not yet covered (phase 2, seams already scouted)

Explorer file operations (direct `parallxElectron.fs`, 6 sites), OS idle/
suspend via `powerMonitor` (absent today), modal/confirm answers, planner
`origin` field (user vs Google-sync writes), media playback, terminal command
lines (privacy-hard), search queries, per-extension `api.activity.note`
adoption (media-organizer first). Each is independent of the core.
