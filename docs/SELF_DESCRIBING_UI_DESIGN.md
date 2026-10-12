# The self-describing UI: design and build order

The app's screen becomes a projection of declarations, so that the same
declaration serves a screen reader, a test, the docs, the model and, later,
an assistant driving the app. This page is the whole design and the whole
build order. It is written for the sessions that implement it: every
decision is made here. A session that finds a gap writes the decision into
section 11 before writing code, so the next session builds the same thing.

Read it top to bottom once. Then work by section 9, one step per session,
with section 13 open beside you.

## 1. The problem in one paragraph

Parallx has two worlds that do not know each other. The model world is
good: 205 commands declare an id, title, category, icon, keybinding, a
when-clause and an AI description; views, editors, settings, blocks and
menus all have ids and owners; the introspection service can list them
and the `app__describe` chat tool reads it. The screen world is built by
hand: 1,887 raw element builds in `src/`, 2,590 in `ext/`, 547 click
listeners, and a kit of seven components used 184 times whose buttons do
not know which command they run. So the app knows what it can do and
nothing knows what it is showing. Screen readers get labels in a few
places, the hidden probes drive the app by CSS class names, the docs can
drift from the UI, and the model has to be told what it is looking at.

## 2. Goals and non-goals

Goals, in order of importance:

1. Every interactive thing on screen is the rendering of a declaration
   with an id, a kind, a label, an owner and, where it has one, a state.
2. The declaration is written once and read by the DOM (roles, labels),
   by the scene (section 4), by the probes (section 7) and by the docs
   (section 8).
3. The app keeps working at every commit. Each step is a swap of
   equivalent code, verified in the running app before it is committed.
4. A new reader finds one shape per feature and one vocabulary for UI.

Non-goals, so nobody builds them by mistake:

- No framework. No virtual DOM, no reactive templates. The kit stays a
  set of functions that build DOM and register what they built.
- No rewrite of the embedded editors: the page editor (Tiptap), the code
  editor (CodeMirror), the sheet engine (Univer) and the PDF viewer
  (pdf.js) are each one declared surface with its own API. Nothing inside
  them is converted.
- No AI control in this work. The scene makes it a serialiser later; this
  page builds nothing that calls a model.
- No visual change. A converted control renders the same class names and
  the same structure as before, so no stylesheet changes.
- No when-clause evaluation in the kit. A declaration records `when` for
  the docs; enabling and disabling stay where they are today.
- No change to what a kit function returns. Code that holds the returned
  element or handle keeps compiling.

## 3. Vocabulary

Use these words in code, comments, tests and docs. Do not invent others.

- **Declaration**: the data a control or surface is made from: id, kind,
  label, hint, icon, owner, when, command or handler, state.
- **Control**: one interactive element: a button, an icon button, a
  chip, a segmented switch, a toggle, an input, a select, a slider, a
  list, a tree, a tab bar, a menu. A control has an id and a kind.
- **Not a control**: a layout element, a label, an icon, a row inside a
  list, a drag handle, a sash, a resizer, a canvas node, a
  `contenteditable` region, a link inside rendered markdown. These stay
  raw DOM and are never declared.
- **Surface**: a region that holds controls: a part (title bar, activity
  bar, sidebar, editor part, panel, status bar, auxiliary bar), a view in
  a part, an editor pane, a dialog, a popover, a menu while open. A
  surface has an id, an owner and, when several of it can be open at
  once, an instance.
- **Instance**: the string that tells two open copies of one surface
  apart: for an editor pane the editor input's id, for a dialog nothing.
- **Owner**: the tool that put the surface there: `core` for the
  workbench, else the last segment of the tool's manifest id
  (`parallx.worksheet` is `worksheet`; an extension's manifest id
  `budget` is `budget`). Controls inherit it from their surface.
- **Scene**: the live registry of mounted surfaces and controls, with
  their state, as data (section 4).
- **Kit**: `src/ui/kit.ts`, the only way to make a control (section 5).
- **Ratchet**: a test that records a count in a baseline and fails when
  the count moves the wrong way (section 6).

## 4. The scene

### 4.1 What it is

One module, `src/ui/scene.ts`, in the ui layer (it imports only from
`platform/`). It holds a tree of entries and tells listeners when the
tree changes. Nothing draws from it. Nothing in the app depends on it
being complete, so a missing registration never breaks a feature; it only
keeps a ratchet from rising.

### 4.2 Entries

```ts
export type SceneKind =
  | 'surface'
  | 'button' | 'iconButton' | 'chip' | 'segmented' | 'toggle'
  | 'input' | 'select' | 'slider'
  | 'list' | 'tree' | 'tabs' | 'menu';

export interface ISceneEntry {
  /** Stable within its parent: 'planner.addTask', 'chat.input'. Section 4.3. */
  readonly id: string;
  readonly kind: SceneKind;
  /** Surfaces: the tool that owns it. Controls: inherited from the surface. */
  readonly owner: string;
  /** Surfaces only: tells two open copies apart. Undefined otherwise. */
  readonly instance?: string;
  /** What a person reads: the button label, the input's label, the pane title. */
  readonly label: string;
  /** One line more, when there is one: the tooltip. */
  readonly hint?: string;
  /** The command this control runs, when it runs one. */
  readonly command?: string;
  /** Recorded for the docs. Never evaluated here. */
  readonly when?: string;
  /** The element. Never serialised. */
  readonly element: HTMLElement;
  /** The entry's state now: section 4.4. Undefined when it has none. */
  readonly state?: () => SceneState;
}

export type SceneState =
  | { readonly kind: 'pressed'; readonly value: boolean }
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'selection'; readonly value: readonly string[]; readonly count: number }
  | { readonly kind: 'enabled'; readonly value: boolean };
```

There is no `parent` field. The parent of an entry is found from the
DOM when the entry registers: the nearest ancestor element carrying
`data-px-surface`. A control in a pane never has to be told which pane
it is in, and a helper module that builds buttons for several panes
(the Worksheets `widgets.ts`) needs no plumbing.

A list, a tree or a tab bar registers once, as one entry whose state is
a selection with a count. Its rows are never entries; a tree of 400 notes
is one entry. This is the rule that keeps the scene small and cheap.

### 4.3 Ids

- An id is `<owner>.<name>`, with the prefix dropped when the owner is
  `core`: `planner.addTask`, `worksheet.sheetTheme`, `sidebar`,
  `quickAccess.input`. The name is lower camel case.
- A control that runs a command uses the command's id as its own id when
  it is the only rendering of that command in its surface. A second
  rendering in another surface uses `<surface>.<command>`:
  `titlebar.workbench.action.toggleSidebar`.
- Ids never carry instance data. A pane for page 42 registers the surface
  `canvas.page` with instance `42` (the editor input's id).
- Ids are stable across versions. Renaming one is a commit of its own,
  with the old id in the message.
- Within one parent surface and instance, ids are unique. Registering a
  duplicate throws in development and logs once in production, and the
  entry is not added.

### 4.4 State

State is read through a function, not stored, so the scene never goes
stale and a control keeps its state where it always did (the DOM
attribute, the component field). The kit supplies the function; a
converted control never writes one by hand. A surface may carry a state
function too (the chat input's text, the sheet pane's item id); the
caller of `createSurface` passes it.

### 4.5 The API

```ts
export interface IScene {
  /**
   * Adds the entry under the nearest surface ancestor of entry.element.
   * An element not yet connected is held and added when it connects
   * (section 5.6). The returned disposable removes it.
   */
  register(entry: ISceneEntry): IDisposable;
  /** The mounted entries with this id, in registration order. */
  find(id: string): readonly ISceneEntry[];
  /** Every mounted entry, parents before children, in registration order. */
  entries(): readonly ISceneEntry[];
  /** The entries under one surface entry, recursively. */
  under(surface: ISceneEntry): readonly ISceneEntry[];
  /** Fires once per animation frame at most, after any change (`Event` from `platform/events.ts`). */
  readonly onDidChange: Event<void>;
  /** Section 4.6. */
  describe(scope?: string): SceneDescription;
}
export const scene: IScene;
```

One instance, exported from the module. It is not a DI service: the kit
is below the service layer and must register without a workbench.

### 4.6 The description

`describe(scope)` returns the tree as plain data with no elements and no
functions, ready for a test, the introspection service or a prompt.
`scope` is a surface id; without it the whole tree is returned.

```ts
export interface SceneDescription {
  readonly surfaces: readonly SceneNode[];
}
export interface SceneNode {
  readonly id: string;
  readonly kind: SceneKind;
  readonly owner: string;
  readonly instance?: string;
  readonly label: string;
  readonly hint?: string;
  readonly command?: string;
  readonly state?: SceneState;
  /** Surfaces only. */
  readonly children?: readonly SceneNode[];
  /** Connected, laid out and the document not hidden. */
  readonly visible: boolean;
  /** True for the surface that holds document.activeElement. */
  readonly focused?: boolean;
}
```

`visible` is computed the way `paneOnScreen` in
`src/built-in/worksheet/state.ts` computes it: `!document.hidden &&
element.isConnected && element.offsetParent !== null`. Hidden entries stay
in the description with `visible: false`; a consumer that wants only what
is on screen filters.

The introspection service gains `describeScene(scope?)` that returns
this, and `app__describe` gains the topic `scene`. That is the only
change to the model-facing code in this work.

### 4.7 What the scene is not

- Not a focus manager. Focus stays where it is handled today
  (`src/ui/interactionMode.ts` and the parts).
- Not an event bus. Controls still call their handlers directly.
- Not persisted. It is rebuilt by mounting.

## 5. The kit contract

### 5.1 The rule

Every control in `src/` and, through `api.ui`, in `ext/` is made by a
kit function. A kit function takes a declaration, builds the same DOM the
hand-built version built, sets the role and the label, registers in the
scene while mounted, and returns exactly what it returns today.

### 5.2 Declarations

Every kit function's options object starts with these fields:

```ts
export interface IKitControlDeclaration {
  /** Section 4.3. Required from step 4 on; optional before, and a control without one registers nothing. */
  readonly id: string;
  /** What a person reads. Required. For an icon button it is the tooltip (`title` today). */
  readonly label: string;
  readonly hint?: string;
  readonly icon?: string;
  /** Recorded for the docs. Not evaluated. */
  readonly when?: string;
}
export interface IKitSurfaceDeclaration {
  readonly id: string;
  readonly owner: string;
  readonly label: string;
  readonly instance?: string;
  readonly state?: () => SceneState;
}
```

and then the kind's own fields. A control runs either a command or a
handler, never both; the kit throws in development on both:

```ts
export type KitAction =
  | { readonly command: string; readonly args?: readonly unknown[] }
  | { readonly onClick: (e: MouseEvent) => void };
```

When it is a command, the kit runs it through the command service handle
that `installKitCommands(service)` set at boot (section 9, step 1), and
the entry's `command` field is set. A control with a handler is allowed;
it is what a list row's local action is. The ratchet in 6.3 counts
handlers so the share of commands rises over time.

For the seven functions that exist today the field names stay: a button
keeps `label`, an icon button keeps `title` (the kit copies it into the
declaration's `label`), a chip keeps `label`, a segmented keeps
`ariaLabel` (copied into `label`). Only `id` is new on them.

### 5.3 The components

The kit grows from seven functions to the set below. Each existing
component in `src/ui/` keeps its class and its file; the kit function
wraps it, exactly as `createSegmented` wraps `SegmentedControl` today.
Nothing is rewritten. Return types are unchanged for the existing seven.

| Kit function | Wraps | Kind | State | Returns |
|---|---|---|---|---|
| `createButton` | itself | button | enabled | `HTMLButtonElement` (as today) |
| `createIconButton` | itself | iconButton | enabled | `HTMLButtonElement` (as today) |
| `createFilterChip` | itself | chip | pressed | `IKitFilterChip` (as today) |
| `createSegmented` | `SegmentedControl` | segmented | value | `IKitSegmented` (as today) |
| `createToggle` | `Toggle` (`src/ui/toggle.ts`) | toggle | pressed | `{ element, checked, dispose }` |
| `createInput` | `InputBox` (`src/ui/inputBox.ts`) | input | value | `{ element, value, dispose }` |
| `createSelect` | `createSelect` in `src/ui/dropdown.ts` | select | value | what that returns today |
| `createSlider` | `Slider` (`src/ui/slider.ts`) | slider | number | `{ element, value, dispose }` |
| `createTabs` | `TabBar` (`src/ui/tabBar.ts`) | tabs | selection | `{ element, selected, dispose }` |
| `createMenu` | `showExtensionContextMenu` (`src/ui/contextMenu.ts`) | menu | none | what that returns today |
| `createList` | new, thin (below) | list | selection | `{ element, selected, dispose }` |
| `createTree` | same code as `createList`, kind `tree` | tree | selection | same |
| `createSurface` | itself | surface | optional | `{ element, setInstance, dispose }` |
| `createPageHeader`, `createSectionLabel`, `createEmptyState` | themselves | none | none | as today |

`createSurface(element, declaration)` adds no DOM. It sets
`data-px-surface="<id>"` and, when given, `data-px-instance` on the
element, registers the surface entry and returns a handle. `setInstance`
changes the instance later (an editor pane learns its input after it is
created). The three base classes call it for their subclasses (section
9, step 2), so a pane author never does.

`createList(container, { id, label, rows, selected })` is the one new
piece of UI code. `rows` is `() => HTMLElement[]` and `selected` is
`() => string[]`, both supplied by the caller from the row code it
already has. It manages nothing visual and renders nothing. It exists so
a list is one entry with a selection state. There is no tree component
to wrap in the code base; the explorer builds its tree by hand, so
`createTree` is `createList` with kind `tree`.

### 5.4 What the kit writes into the DOM

For every control: `data-px-id="<id>"` on the element, the role the kind
implies (`button`, `switch`, `combobox`, `slider`, `listbox`, `tree`,
`tablist`, `menu`; a native `<button>` gets none), and `aria-label` when
the control shows no text of its own. Nothing else changes: class names,
structure and listeners are exactly what the hand-built version had. The
compliance test in 6.2 reads `data-px-id`.

### 5.5 The extension API

`api.ui` gains the same functions with the same options. The bridge
fills nothing: an extension's controls inherit the owner from the
surface the bridge registered for its view or pane (step 2), so an
extension never names itself. The four functions `api.ui` has today
(`createDropdown`, `renderMarkdown`, `createAiButton`,
`showContextMenu`) stay and are reimplemented on the kit, so an
extension written today keeps working unchanged.
`docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md` section 6 gets the new
functions with one example each, in the same commit as the bridge.

### 5.6 Registration and removal

One `MutationObserver` on `document.body` (`childList: true, subtree:
true`), created the first time the kit registers anything, batched to one
callback per animation frame. On each batch:

- For every added node, and every descendant of it with `data-px-id` or
  `data-px-surface`: if the kit holds a pending entry for that element,
  find its parent surface (nearest ancestor with `data-px-surface`,
  excluding itself) and add it.
- For every removed node, and every descendant with those attributes:
  remove its entry if present.

`register` adds immediately when `entry.element.isConnected`, else holds
the entry until the observer sees it connect. Disposing a handle removes
the entry whether or not the element is still in the document. This is
what makes conversion safe: a pane that forgets to dispose a control
still leaves the scene clean when its DOM goes.

Rules enforced at runtime:

- A declaration missing `id` or `label` throws when `isDevMode()`
  (`src/platform/devMode.ts`, true under the probes) and logs once per
  id in production, then renders anyway. The app never breaks over a
  label.
- A duplicate id under one parent and instance: same, and the second
  entry is not added.

## 6. The ratchets

Three tests in `tests/unit/`, on the model of `fileSizeRatchet.test.ts`:
a baseline JSON beside the test, `UPDATE_<NAME>_BASELINE=1` refreshes it,
and the test fails when a count moves the wrong way. Baselines are
refreshed only in a commit whose message says what fell.

### 6.1 `rawDomRatchet.test.ts`, baseline `raw-dom-baseline.json`

Files: `src/**/*.ts` and `ext/**/*.js`, ignoring `**/node_modules/**`,
`**/*.generated.ts`, `**/*.d.ts`, `ext/study/main.js`,
`ext/**/readability.js`, `ext/**/test/**`, and the kit and the components
it wraps: `src/ui/kit.ts`, `src/ui/scene.ts`, `src/ui/toggle.ts`,
`src/ui/inputBox.ts`, `src/ui/dropdown.ts`, `src/ui/slider.ts`,
`src/ui/tabBar.ts`, `src/ui/segmentedControl.ts`, `src/ui/contextMenu.ts`.

Count per file, on the text with comments stripped the way
`historyTagRatchet.test.ts` strips them, the matches of:

```
/document\.createElement\(/g
/\bel\('/g
/\bh\('/g
/\$\('/g
/\.innerHTML\s*=/g
/addEventListener\('click'/g
```

The baseline maps file to count. A count may fall, never rise. A file not
in the baseline must be zero. Environment variable:
`UPDATE_RAW_DOM_BASELINE=1`.

### 6.2 `kitContractCompliance.test.ts`

`// @vitest-environment jsdom` (126 tests already use it). For every
kit function in the 5.3 table, mount once into a connected container
under a `createSurface` with id `test`, with a full declaration, then
assert: `data-px-id` set; role as 5.4 says; a readable label
(`aria-label` or text content); `scene.find(id)` has one entry under the
`test` surface with the right kind; `state()` returns the shape the
table says; `dispose()` empties `scene.find(id)`; removing the element
from the document without disposing also empties it after one
animation frame. Also: a declaration with both `command` and `onClick`
throws; a missing `label` throws; a duplicate id under one surface
throws and is not added.

### 6.3 `kitHandlerRatchet.test.ts`, baseline `kit-handler-baseline.json`

Same files and stripping as 6.1. Count per file the matches of
`/\bonClick:/g`. May fall, never rise. `UPDATE_KIT_HANDLER_BASELINE=1`.

### 6.4 The scene probe

`tests/probes/scene-probe.mjs` (section 7) launches the app, waits for
the workbench, writes `scene.json` from `scene.describe()`, then runs
the command that opens each built-in's main surface (the list of
commands is in the probe, one per built-in, in the order of section 9
step 5) and writes `scene-full.json`. It fails when a visible entry has
an empty label or when two entries share an id under one parent and
instance. It runs locally before every commit of a conversion. It is not
a vitest test.

## 7. The probes address by id

The probes in `tests/probes/` drive the app with Playwright through
`window.__parallx_workbench__` and CSS class names. A shared
`tests/probes/scene.mjs` holds the launch code (`launchEnv`, `launchApp`,
`cmd`; the older probes keep their own copies until step 9 moves them)
and three helpers:

```js
// scene.describe(scope) from the page, as JSON.
export async function sceneOf(page, scope)
// The element with data-px-id === id. When several are mounted, the one
// whose surface is visible; `opts.instance` picks a specific one. A real
// Playwright click. Throws naming the ids under the same surface when
// none is found.
export async function click(page, id, opts)
// Focus the input with this id, select all, type, blur.
export async function type(page, id, text, opts)
```

A conversion step is done only when its probe row addresses the
converted feature by id and passes.

## 8. Docs from the registries

`scripts/build-reference.mjs` writes `docs/reference/commands.md`,
`docs/reference/settings.md` and `docs/reference/views.md` from the
command descriptors, the settings schemas and manifests, and the view
registrations, each entry with its owner and when-clause. It reads the
manifests and command modules under jsdom the way the compliance tests
do. `npm run build` runs it. A test asserts the three files match the
registries, so they cannot drift. This is step 10 and comes last.

## 9. The build order

One step per session. Each step ends with section 13. A step that is not
finished is not committed as half: the session pushes what works and
writes what is left into section 11.

### Step 1. The scene and the kit contract (cloud)

- `src/ui/scene.ts` as in section 4, with `tests/unit/scene.test.ts`
  under jsdom covering register, find, under, describe, the pending
  path (register before connect), removal by observer, duplicates.
- `IKitControlDeclaration`, `IKitSurfaceDeclaration` and the command
  fields in `kit.ts`. The seven existing functions accept `id` as an
  optional field until step 4; a missing `id` registers nothing (the
  scene sweep in step 11 lists such controls). Nothing else about them
  changes.
- `installKitCommands(service)` exported from `kit.ts` and called once
  in `src/workbench/workbench.ts` right after the command service is
  registered.
- `createSurface`, `createToggle`, `createInput`, `createSelect`,
  `createSlider`, `createTabs`, `createMenu`, `createList`,
  `createTree`.
- `data-px-id`, roles and labels as in 5.4.
- The three ratchets with baselines at today's counts.
- `describeScene` on the introspection service and the `scene` topic on
  `app__describe`.
- `tests/probes/scene.mjs` and `tests/probes/scene-probe.mjs`.

Nothing in the app is converted. The app behaves exactly as before.

### Step 2. The three base classes register surfaces (local)

Three insertions, nothing else:

- `src/parts/part.ts`, in `create(parent)`, after the line that sets
  `data-part-id`: `this._surface = createSurface(this._element, { id:
  this.id, owner: 'core', label: this._name })`, disposed in the part's
  dispose.
- `src/editor/editorPane.ts`: a pane's `id` is a generated
  `editor-pane-N`, so the surface is registered in `setInput`, where the
  pane first knows what it shows. On the first call:
  `this._surface = createSurface(this._element, { id: input.typeId,
  owner: ownerOfEditorType(input.typeId), instance: input.id, label:
  input.name })`; on later calls `this._surface.setInstance(input.id)`;
  disposed in the pane's dispose. `ownerOfEditorType` is a new export of
  `src/api/bridges/editorsBridge.ts` reading the module-level map of
  tool editor providers it already keeps, returning the last segment of
  the tool id, or `core` for a type no tool registered (file, markdown
  preview, PDF, notebook, settings).
- `src/api/bridges/viewsBridge.ts`, where `provider.createView(container)`
  is called (`resolveView` and `_createToolView`): wrap the container
  with `createSurface(container, { id: viewId, owner: lastSegment(this._toolId),
  label: name })` and dispose it with the view's disposable.

After this step the scene holds every part, pane and view with no
feature touched. Run `scene-probe` and keep `scene.json` in the commit
message's summary (counts only). Verify in the app: in chat, ask for the
`scene` topic of the describe tool and read the tree.

### Step 3. The frame (local, two sessions)

Convert, in this order, with the recipe in section 10:
`src/parts/titlebarPart.ts`, `src/parts/activityBarPart.ts`,
`src/parts/statusBarPart.ts` and `src/workbench/statusBarController.ts`,
`src/parts/sidebarPart.ts`, `src/parts/panelPart.ts`,
`src/parts/auxiliaryBarPart.ts`, `src/parts/editorPart.ts` (its tab bar
through `createTabs`), `src/commands/quickAccess.ts` (the command
palette and quick open), `src/workbench/menuBuilder.ts`,
`src/built-in/settings/settingsEditor.ts`. These are the surfaces every
feature hangs in, so once they are done every later probe row can
navigate by id.

### Step 4. `id` becomes required (cloud)

`id` is made required on the seven original functions. Typecheck lists
every caller still without one; they are given ids in this step (the
few outside the frame and the built-ins). From here a kit call without
a declaration is a type error.

### Step 5. Built-ins, one per session (local)

In this order, because the first three are already split into panes and
the last two are the largest: worksheet, planner, the PDF viewer
(`src/editor/panes/pdf/`), explorer, search, dashboard, settings (the
panels not done in step 3), welcome, agents, ai-settings, output,
terminal, diagnostics, tool-gallery, theme-editor, activity-log,
indexing-log, canvas (toolbar, menus, property editors; never the Tiptap
document), chat (header, input chips, mode switch, tool cards; never the
message list's markdown). Each session converts one built-in with the
recipe and adds its probe row.

### Step 6. The extension API (cloud)

`api.ui` gains the kit functions (5.5); the authoring guide gets the
examples; `createAiButton` and `createDropdown` are reimplemented on the
kit. No extension changes yet.

### Step 7. Extensions, one per session (local)

In this order: workspace-graph, web-research, budget, flashcards,
concept-lab, media-organizer, creations-ai, browser, study (last, because
`scripts/bundle-study.mjs` rebuilds its main file; convert the sources
under `ext/study/src/` and re-bundle). Each session converts one
extension's controls to `api.ui` calls with the recipe and its probe row.
`extStyleRatchet` and `extUndefinedNames` stay green throughout.

### Step 8. The scene line in the prompt (cloud)

One line on the latest user turn, where `formatTurnClock` is prepended in
`src/openclaw/openclawAttempt.ts`: the active editor, the focused surface
and its selection, from `describeScene`. Never in the system prompt, so
the prompt cache stays warm.

### Step 9. The probes move to ids (local)

`refactor-verify-probe.mjs` and `ui-screenshot-probe.mjs` lose their
class-name queries and `__parallx_workbench__` reaches except `cmd()`;
they use `tests/probes/scene.mjs`.

### Step 10. Reference docs (cloud)

Section 8.

### Step 11. The audit (cloud, after steps 5 and 7)

`scripts/scene-sweep.mjs`, on the model of `scripts/dead-code-sweep.mjs`:
reads `scene-full.json` and the source, and lists every entry with no
label, every id registered under two parents, every kit call with
`onClick` where a command with the same name exists, and every file
whose raw DOM count is above zero. Its output goes into section 11 as
the remaining work.

## 10. The conversion recipe

For one file. Follow it in order, every time.

1. Read the file. List every element a person clicks, types in,
   toggles, selects or picks from. Those are the controls. Everything in
   "not a control" (section 3) stays raw DOM.
2. For each control write its declaration before touching code: id
   (4.3), label (the text a person sees, or the tooltip for an icon),
   hint, and whether it does the same thing as an existing command
   (search the command ids in the tool's manifest and
   `src/commands/`). If it should be a command and is not, add the
   command in pass two, with `aiInvocable` and `aiDescription` set the
   way its neighbours are.
3. Pass one, construction. Replace each control's element construction
   with the kit call, keeping the existing handler as `onClick` and the
   returned element or handle in the same variable. Run section 13.
   Open the app and use the feature. Commit: `<Feature>: controls
   through the kit`.
4. Pass two, declaration. Replace `onClick` with `command` wherever step
   2 found one. Delete the handler if nothing else calls it. Run section
   13 and the same probe row. Commit: `<Feature>: controls declare their
   commands`.
5. Refresh `rawDomRatchet` and `kitHandlerRatchet` baselines in these
   commits only for this file; the message names the counts that fell.
6. Write the probe row for the feature, by id, in the same session. A
   feature without a probe row is not converted.

What never changes in a conversion: class names, DOM structure,
stylesheets, the handler's body, the order listeners are attached in,
focus handling, drag and drop, what the function returns. If a
conversion needs one of these to change, stop, write why into section
11, and leave that control raw. The ratchet accepts a file that did not
fall; it refuses one that rose.

### A worked example

The sheet theme button in `src/built-in/worksheet/widgets.ts`, used by
`panes/sheetPane.ts`. Today:

```ts
export function makeSheetThemeButton(): HTMLButtonElement {
  const btn = iconBtn('moon', 'Dark Sheet', { onClick: () => { void setSheetAppearance(resolveSheetDark() ? 'light' : 'dark'); } });
  paintSheetThemeButton(btn);
  return btn;
}
```

`iconBtn` already calls `createIconButton`, so pass one is one field:

```ts
export function makeSheetThemeButton(): HTMLButtonElement {
  const btn = iconBtn('moon', 'Dark Sheet', { id: 'worksheet.sheetTheme', onClick: () => { void setSheetAppearance(resolveSheetDark() ? 'light' : 'dark'); } });
  paintSheetThemeButton(btn);
  return btn;
}
```

with `iconBtn` passing `id` through to `createIconButton`. The button
renders as before; the scene now holds `worksheet.sheetTheme` under the
`worksheet` pane surface with the instance of that pane. The probe row
clicks it by id and asserts the sheet's dark class flipped.

Pass two: Worksheets has no command for this, and a person would want one
in the palette, so the manifest gains `worksheet.toggleSheetTheme`
("Worksheets: Toggle Sheet Theme", `aiInvocable: true`) whose handler is
the body of the old `onClick`, and the button becomes:

```ts
const btn = iconBtn('moon', 'Dark Sheet', { id: 'worksheet.toggleSheetTheme', command: 'worksheet.toggleSheetTheme' });
```

Both passes: `paintSheetThemeButton` is untouched, the pane's call is
untouched, the class names are untouched.

## 11. Open items

Sessions append here. Each line: date, step, what was left and why.

(none yet)

## 12. Glossary for a new reader

- **Part**: one of the seven fixed regions of the window (title bar,
  activity bar, sidebar, editor part, panel, auxiliary bar, status bar).
- **View**: a tool's content in the sidebar, panel or auxiliary bar.
- **Editor pane**: a tool's content in the editor part, one per tab.
- **Command**: a named action with an id, runnable from the palette, a
  keybinding, a menu, a control or the model.
- **When-clause**: the condition under which a command is available,
  over context keys.
- **Context key**: a named value the workbench keeps about its state
  (`activeEditor`, `sidebarVisible`).
- **Contribution point**: the place a tool registers something into the
  core (a view, a block, a command).
- **Tool**: a built-in or an extension; the unit the user turns on or
  off.

## 13. The session checklist

Run in this order before every commit of this work. All must pass.

```
git pull origin dev
npm run typecheck
npx vitest run
npm run build
node tests/probes/scene-probe.mjs <outDir>          # local sessions
node tests/probes/refactor-verify-probe.mjs <outDir> <row>   # the row for what changed
```

Then, for a conversion commit only, refresh the two baselines for the
files touched:

```
UPDATE_RAW_DOM_BASELINE=1 UPDATE_KIT_HANDLER_BASELINE=1 npx vitest run tests/unit/rawDomRatchet.test.ts tests/unit/kitHandlerRatchet.test.ts
git diff tests/unit/raw-dom-baseline.json tests/unit/kit-handler-baseline.json   # only falls, only your files
```

Commit with the message pattern in section 10, push to `dev`, and if the
step is not finished write the remainder into section 11 in the same
commit.
