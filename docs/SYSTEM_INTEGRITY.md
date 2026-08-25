# System Integrity — the assessment and the program

Four system-level audits run 2026-08-25, at Mufaro's direction: assess
the app as a SYSTEM — functionality and usability, not code hygiene —
and identify the full CLASS of each gap, so the fixes are class-wide.
The four dimensions: interaction integrity (modes and focus), the
user-action language, self-knowledge (data about the app), and
modularity in truth. Companion to STANDARDIZATION.md (which covers the
code-hygiene layer below this one).

## The thesis

What separates a system from a pile of features is that the parts obey
shared contracts and the whole can describe itself. The audits found the
same shape in all four dimensions: Parallx HAS the right primitives —
one context-menu class, one journal grammar, one registry per concept,
one activation engine — and lacks the CONTRACTS that make primitives a
system: modes without exit contracts, gestures without command
equivalents, registries without a join, manifests whose declarations
nothing honors. Every finding below is a contract to write and enforce,
not a feature to add.

---

## Dimension I — Interaction integrity (modes and focus)

The menu-bar Enter-creates-a-file bug (fixed, 5fd35779) was one instance
of the class: INTERACTION MODES WITHOUT COMPLETE EXIT CONTRACTS. The
audit enumerated every mode in the app. Systemic findings:

- S1. NO mode anywhere exits on window blur — every menu, picker, drag
  and capture mode survives Alt-Tab fully armed.
- S2. A focus-return mechanism exists (focusTracker.restoreFocus) and
  has exactly ONE caller (the palette). Every other overlay strands
  focus on <body> when it closes.
- S3. Stranded body focus is actively harmful: the planner arms bare-key
  shortcuts (t/w/d/m, arrows) whenever activeElement is body — closing
  any icon picker or dialog silently arms a background planner.
- S4. The "remove the listener only in the branch that fired" leak
  pattern recurs ~8 times; two instances break the NEXT open (canvas DB
  header popover, chat attach picker: reopen, and the first click inside
  closes it).
- S5. No mode stack: a context menu (z 2575) floats above the command
  palette's backdrop (z 1000) and keeps its document-capture keyboard
  grab — palette becomes unnavigable.

Tier 0 — modes that EAT KEYSTROKES (the field-bug class):
- THE ENGINE IS ContextMenu ITSELF (ui/contextMenu.ts:329-375): it
  never takes focus, but its capture-phase keydown preventDefaults
  Enter/arrows/Home/End UNCONDITIONALLY — so the user keeps typing into
  the editable underneath while those keys are dead; grazing a row with
  the mouse arms it, and the next Enter EXECUTES it. Every context menu
  in the app (18 call sites), the editable right-click menu, the editor
  selection menus, and the titlebar dropdowns (autoSelectFirst + focus
  still in the editor) inherit this. One file fixes the class.
- WORST INSTANCE: keybinding capture mode (keyboardShortcutsPanel
  :164-183) — arm a keycap, click into the editor, type: the first
  character is silently BOUND AS A GLOBAL SHORTCUT and persisted. No
  click-outside/blur/focus-loss exit.
- Confirm-modal stacking: two concurrent confirms both bind
  document-capture Enter; one Enter confirms both.
- Palette-under-menu (S5) and the sash/drag family: four hand-rolled
  sash drags set body user-select:none globally with NO Escape, blur,
  or pointercancel path — a lost mouseup leaves the app resizing with
  no button held and text selection dead.

Tier 1 — focus strands: Overlay.hide() drops focus to body (settings
hub, icon picker, canvas modals, titlebar Alt exit); inline renames have
complete exits but inconsistent blur semantics (explorer: cancel;
layouts panel and canvas DB: commit).
Tier 2 — eight listener-leak sites (inventoried with file:line).
Tier 3 — eleven modes missing Escape or scroll/resize dismissal
(dashboard drawers have NO Escape at all; ContextMenu never dismisses on
scroll, unlike Dropdown which does it correctly).
Tier 4 — drags without cancel paths (dashboard resize can lose pointer
capture on re-render and stick its mode class forever).

THE CONTRACT TO CODIFY: every mode declares entry, complete exit set
(Escape, click-outside, focus-loss, window blur, selection), focus
placement on open, focus RETURN on close, and owns exactly the
document listeners it removes on every exit path. Reference
implementations already in-tree: Dropdown's dismissal set, the chat
mention autocomplete's scoped keyboard grab, findReplaceWidget's focus
return, quickAccess's focusTracker suspend/restore.

## Dimension II — The user-action language

One grammar (actor/verb/object/source/ref through journal.note), NOT one
vocabulary:

- GESTURE/COMMAND PARITY: 6 of 22 gestures have command equivalents.
  Every miss is in the newest layer: move-part-beside (the headline
  gesture), container float/dock/rail-move, panel-tab detach/redock,
  widget move/remove/return-to-dashboard (adopt exists — asymmetric),
  saved-layout apply/rename/delete, tab reorder/cross-group move,
  window minimize/maximize.
- COMMAND BYPASS: 16 actions on the widget/container box menus exist as
  inline switch handlers with zero commands; the explorer context menu
  is a parallel door that skips its OWN registered commands; the
  extension menu API actively encourages inline handlers.
- JOURNAL COVERAGE: fluent in commands and editors, nearly MUTE on the
  layout half of the app — window move/resize/maximize, part drags,
  sash drags, container docking, widget ops, saved layouts, zen by
  non-command routes: all silent, and every one already has a live
  emitter no tap subscribes to. The fully-written layout narration tap
  (SurfaceActivityTap) exists, is tested, and says "NOT YET WIRED" in
  its own header. api.activity.note (extension narration) has zero
  adopters.
- ATTRIBUTION: settings writes are journaled but hardcoded actor:
  'user' (extension/restore/binding echoes misattributed); command
  events carry no origin (palette vs keybinding vs menu vs AI
  indistinguishable — the reason the noise-blocklist exists).
- SHAPE: verbs are ~20 uncoordinated free-form phrases; ActivityActor's
  `| string` collapses the type; query() cannot filter despite indexed
  columns; and the AI-facing activity_log tool FLATTENS structured
  events into prose the model would have to regex — the single
  highest-leverage automation fix.

THE CONTRACT: every user action is a command or a gesture WITH a
command; IContextMenuItem.id means command id; journal events are typed
(exported actor/source unions, documented verb set, origin on command
and settings writes); the AI tool returns the objects.

## Dimension III — Self-knowledge (data about the app)

Verdict: excellent RAW self-knowledge, essentially NO aggregation,
narration, or AI exposure.

- The truth exists per concept: tool roster/state (ToolRegistry),
  activation time + duration (ToolActivator), failures with context
  (ToolErrorService), enablement, activation events, commands,
  keybindings WITH source, containers/views/locations, rail seating,
  open editors, 22 continuously-synced context keys (activePart,
  activeEditor, visibility flags...), settings schemas, diagnostics.
- Nothing joins them: no single answer to "what is running right now."
  IToolActivatorService and IToolErrorService are registered in DI with
  ZERO consumers. The context-key map is unreadable through its own DI
  interface (getAllContext exists on the class only). ServiceCollection
  cannot enumerate its ~79 registered services. getAllKeybindings() has
  no caller. IViewService is an empty stub.
- No ORIGIN anywhere: settings getValue discards which precedence
  branch produced the value; UnifiedAIConfig's deepMerge destroys
  provenance.
- FAILURES DIE IN THE CONSOLE: database errors, every storage
  read/write failure, journal flush drops, enablement persist failures,
  force-deactivation at 50 errors — none reaches any UI.
- Diagnostics checks are 15/15 about the AI stack; the workbench is not
  a category. Activation health, DB state, keybinding conflicts:
  unchecked.
- The MODEL can query almost nothing: 4 of 39 chat tools are
  app-introspective; the tool roster, layout, settings, health, and
  editors are all invisible to it. The /doctor //status //context
  commands are user-only.

THE SHORTEST PATH (from the audit, ordered by value/cost):
- Tier 0 (one-liners): getAllContext onto IContextKeyService; keys() on
  ServiceCollection; getAllErrors onto IToolErrorService.
- Tier 1: IIntrospectionService (~250 lines, read-only join):
  describeTools (registry × activator × errors × enablement — THE
  "what is running" answer), describeCommands/Keybindings +
  findKeyConflicts (incl. chords), describeSurfaces (containers × rails
  × areaOf × editors), describeLayout (serializeBodyTree leaves labeled
  by areaOf, rendered as prose), describeSettings, describeHealth,
  snapshot().
- Tier 2: inspect(key) with origin on both settings services.
- Tier 3: journal taps whose emitters already exist (tool
  activate/deactivate/fail with duration, enablement, rails,
  visibility); DB/storage failures to notifications.
- Tier 4: app__describe chat tool (modeled on activityLogTool,
  always-allowed, topic enum) — the system diagnosing itself; workbench
  checks in diagnostics + /doctor; Tool Gallery Runtime tab gains
  duration + error list.
No new state, no new registries: join and expose.

## Dimension IV — Modularity in truth

"Add or remove things as they please" is currently TRUE only for the 7
external extensions. For the 19 built-ins it is structurally false:

- The disable button is hardcoded disabled for every built-in; the
  re-activation machinery for them is unreachable dead code.
- FIVE built-ins are load-bearing core in tool costumes: canvas (owns
  all 13 shared-DB migrations incl. the RAG tables core services read),
  chat (CONSTRUCTS the settings registry, the manifest-config sweep,
  cron, autonomy flags/rail/patterns, the background prompt runner),
  dashboard (the widget system core's widgetBox statically imports —
  drawers and renderer are hard imports while the host is politely
  command-resolved), editor (34 core import lines, the only '*'
  activation), explorer (core hardcodes view.explorer with a non-null
  assertion).
- Activation events are DECORATIVE for built-ins: boot awaits all 19
  activations unconditionally (chat's 3.7k-line activate blocks
  startup); the engine supports onCommand/onView and nothing uses them.
- Ten cross-tool import sites; worst is dashboard's notesWidget value-
  importing canvas's editor class (dashboard cannot load without
  canvas). The correctly-inverted pattern exists (planner's
  WidgetRegistrar structural interface) and is the model.
- No dependency declarations in manifests — ordering constraints live
  in code comments on a literal array.
- api.services is UNGATED and UNDOCUMENTED: extensions can forge
  identifiers and overwrite core services; four extensions already use
  it. A manners boundary, not a security boundary. Six dead shadow
  parallx-manifest.json files mislead about what is registered.

THE TEN DECOUPLINGS (from the audit): shared schema to a core-owned
migrations dir; SettingsRegistryService constructed by the workbench,
not chat; widgetBox inverted fully behind the widget host; the autonomy
runtime extracted from chat into core services; built-in/editor renamed
to core; notesWidget onto a command seam; manifest
dependencies/optionalDependencies + validation; honor activation events
for built-ins (nine tools leave the boot path); required:true for the
genuine core five and real enablement for the other fourteen; decide
api.services (gate registerInstance + document get/has, or promote the
container to a real API).

---

## The program — fixing classes, in order

PHASE A — THE INTERACTION CONTRACT (usability first; the class of the
field bug):
1. ContextMenu engine: conditional keyboard grab (Enter only when a row
   is armed; arrows not stolen from editables), highlight cleared on
   mouseleave, focus-loss/window-blur/scroll dismissal. One file, fixes
   T0-1..4 and the palette-under-menu stack.
2. Keybinding capture: pointer-down/blur/focus-loss exits; refuse to
   bind when focus left the panel.
3. One guarded drag helper (pointer capture + Escape/blur/pointercancel
   /lostpointercapture routing to one cleanup) adopted by the four sash
   copies + canvas drags.
4. Focus return: overlays close through focusTracker restore; the
   listener-leak eight fixed mechanically; blur semantics for inline
   renames standardized (blur = commit).
5. Enforcement: a mode-contract test harness (open each menu/popup in
   jsdom, assert Escape + outside-click + focus-loss all dismiss and
   document listener counts return to baseline).

PHASE B — THE ACTION LANGUAGE:
1. Command-ify the box/container/layout/window layer (~15 commands);
   IContextMenuItem.id becomes command id by contract; the eight inline
   switch menus converted. Parity closes and the journal narrates them
   FREE via the existing command tap.
2. origin on CommandExecutedEvent and settings writes (deletes the
   noise blocklist; fixes attribution).
3. Wire the layout/lifecycle taps (emitters exist); wire or port
   SurfaceActivityTap's vocabulary.
4. Typed vocabulary: exported actor/source unions, verb set; query()
   filters; activity_log returns structured events.

PHASE C — SELF-KNOWLEDGE: the Tier 0 one-liners, IIntrospectionService,
settings inspect(), failure surfacing, app__describe, workbench
diagnostics checks, Tool Gallery runtime columns.

PHASE D — MODULARITY: the ten decouplings, ordered: settings registry
to core → schema to core → widgetBox inversion → autonomy extraction →
editor rename → notesWidget seam → manifest dependencies → honored
activation events → real enablement → api.services decision → delete
shadow manifests.

DEFINITION OF DONE — "the app can explain itself": app__describe
answers what is running, where everything sits, what every setting is
and why; /doctor covers the workbench, not just the AI stack; every
gesture has a command and every command a journal line with an origin;
every mode passes the exit-contract harness; a built-in that is not one
of the required five can be disabled and the app degrades gracefully,
loudly, and diagnosably.
