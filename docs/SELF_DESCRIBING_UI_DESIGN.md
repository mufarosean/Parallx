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

One element may hold a surface and one control: a view whose root is
its tree (the explorer) is the surface `view.explorer` and the control
`explorer.tree`, the control under the surface. The scene keeps
surfaces and controls in separate maps by element for this, and a
registration's dispose removes only its own entry.

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
- Within one parent surface and instance, control ids are unique.
  Registering a duplicate control throws in development and logs once in
  production, and the entry is not added. Surfaces may repeat: the same
  file open in two editor groups is two panes with one id and instance,
  and both are listed.

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
  /** Fires once per task at most, after any change (`Event` from `platform/events.ts`). */
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

and then the kind's own fields. A control runs a command, or a handler,
or names both: then the handler runs and the command is recorded in the
scene (a page header's action that calls a command through its own code
says which command that is):

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
| `declareControl` | an element the caller built | any but surface | caller's | `IDisposable` |
| `createPageHeader`, `createSectionLabel`, `createEmptyState` | themselves | none | none | as today |

`createSurface(element, declaration)` adds no DOM. It sets
`data-px-surface="<id>"` and, when given, `data-px-instance` on the
element, registers the surface entry and returns a handle. `setInstance`
changes the instance later (an editor pane learns its input after it is
created). The three base classes call it for their subclasses (section
9, step 2), so a pane author never does.

`declareControl(element, { id, label, kind, command, state })` declares a
control the kit did not build and keeps its DOM and listeners: a window
button, a menu bar item, an editor tab, anything whose look the kit does
not have. The rule of no visual change wins over the rule of kit-only
DOM, so such a control is declared in place; its raw DOM stays counted
by the ratchet, which accepts a count that did not fall. `command` on
it is recorded, never run: the element's own listener runs it.

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
true`), created the first time the kit registers anything, handled in the
observer's own callback (one batch per task; never on an animation frame,
which a hidden or covered window throttles). On each batch:

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
from the document without disposing also empties it once the observer
has run. Also: a declaration with both `command` and `onClick` runs the
handler and records the command; a missing `label` throws; a duplicate id under one surface
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

Done 2026-10-12 (77177bce). Everything below is in; the probe ran here
under xvfb and wrote an empty scene, as expected before step 2.

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

Done 2026-10-12. The scene probe shows 16 surfaces at boot and 21 with
the built-ins open: the seven parts, every view under its part with its
tool as owner, every pane under the editor part with its type as id,
its input as instance and its tool as owner. No controls yet: none has
an id until step 3. One deviation from the text below: a tool editor
input carries its tool as `ownerToolId`, so the pane reads that, with
no lookup in the editors bridge.

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

Done 2026-10-12, in the cloud, verified by the scene probe in a real
window under xvfb: the title bar's five menus and three window buttons
(with their commands), the activity bar's icons (pressed while active)
and its manage gear, the status bar's items (with their commands and
their text as state), the notification centre as a surface with its
Clear All, each editor group as a surface with the group id as instance
and its tab bar as one entry, quick access as a surface with its input
and list, and the settings editor as a surface with its search, nav items
and every setting's control. The frame's ids are the probe's `FRAME_IDS`
list. The side bar, panel and auxiliary bar have no controls of their
own. Four things learned on the way, all now in the text above: bespoke
chrome is declared in place (`declareControl`); two controls with one id
in one frame, one replacing the other, are not duplicates; the scene
flushes in the observer's callback, never on an animation frame, because
a hidden window throttles frames; and the two giants touched
(`quickAccess.ts`, `editorGroupView.ts`) each lost a module
(`quickAccessMatch.ts`, `editorTabContextMenu.ts`) so they ended smaller.
The tab strip a view container draws to switch between its views is
declared too (`<container>.views`, kind `tabs`), in `src/views/viewContainer.ts`.

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

### Step 4. `id` becomes required (cloud, after steps 5 and 7)

`id` is made required on the seven original functions. This comes
after the built-ins and the extensions are converted, not before: the
184 kit calls without an id today are nearly all inside built-ins and
extensions, and each gets its id in its own conversion session, where
the person converting it knows the feature. Once typecheck lists no
caller without one, the field turns required and a kit call without a
declaration is a type error from then on.

### Step 5. Built-ins, one per session (local or cloud)

Either place: the scene probe runs in the cloud container under xvfb,
so a conversion can be verified in a real window there too.

Worksheets done 2026-10-12, in the cloud. Every pane's single controls
carry ids (`worksheet.<pane>.<name>`, the shared ones `worksheet.home`,
`worksheet.newQuiz`, `worksheet.sheetTheme`): header actions, the
sidebar's rows, Home's cards, the bank's search, filters and recipes,
the builder's filters, switches, length, shuffle and name, the quiz's
overview and next-marked, the sheet's star, mark, rating, note, reveal,
grades, try-again and review, the import pane's buttons and checkboxes,
the generate pane's fields, the settings pane's switches, fields,
campaign and rest days. Four of the sheet pane's hand-built `px-btn`
buttons became kit calls. What stayed undeclared on purpose: anything in
a row (a problem's star in the bank, a quiz row's Resume, a plan day's
cell), per the one-entry-per-list rule. Two things learned: a page
header's or empty state's action is itself a control, so `IKitAction`
carries `id` and `command` and the header passes them through; and the
dashboard pane, a giant, lost its day planner to `dayPlan.ts` so it
ended under budget. The probe checks Home's and the sidebar's ids and
the scratch sheet's theme and export buttons.

Planner done 2026-10-12, in the cloud. The pane's three tabs (pressed
while active), the sidebar's rows, the calendar bar (today, previous,
next, the view switch as a select, sync, calendars, New Event with its
command), the task list's New Task (with its command) and its nav
filters, Today's capture box, month arrows and review-queue button, the
notes' attach button, and the three popovers as surfaces with every
field and button declared (`planner.event.*`, `planner.task.*`,
`planner.calendars.*`), plus the settings panel's switches, calendar
and Google buttons. Undeclared on purpose: task rows, event bars, day
cells, month chips, calendar rows, colour swatches. The probe checks the
Today tab's ids and opens the task popover by command to find its
surface, title and save button.

PDF viewer done 2026-10-12, in the cloud. `pdfButton` takes an id and an
optional pressed reader, so the toolbar (page arrows and field, zoom
field, presets, in, out, fit, find, panel, night reading, more), the find
bar (query, match case, whole word, previous, next, close), the
highlight popover as a surface (colours, delete, note, continue in chat,
ask, send) and the selection bubble as a surface (highlight colours,
copy, ask AI, add to note, more) are declared. Undeclared: outline rows,
thumbnails, highlight tabs in the margin, canvas-link rows. The probe
writes a one-page PDF by hand (`tinyPdf` in `tests/probes/scene.mjs`),
opens it through quick open, and checks the toolbar's ids.

Explorer and Search done 2026-10-12, in the cloud. The explorer's tree
is one entry (`explorer.tree`, selection the selected node's uri), its
open editors list another (`explorer.openEditors`, selection the active
row), with Open Folder (its command recorded), Retry, and the inline
rename and new-file or new-folder fields declared. Search's query,
replace, include and exclude fields, its replace and details toggles,
the three option toggles (match case, whole word, regular expression;
ids from their labels) and its results list are declared. Tree rows,
open-editor rows and result rows are not. The explorer, a giant, lost
its unique-name helper to `uniqueName.ts` and ended smaller. The probe
opens Search by command and checks both panes' ids.

Dashboard done 2026-10-12, in the cloud. The page header's buttons (add,
refresh all, schedule, hide and show header, the empty state's add),
the schedule popover as a surface with its time, cron, save and cancel,
each widget card as a surface with the widget id as instance and its
chrome buttons under it (refresh, run in chat, configure, appearance,
move to workbench, remove), the picker and both drawers as surfaces
with their cancel, save, title and hide-title-bar controls, the
sidebar's new button and its page list, and inside the widgets the
tasks box and add button, the image widget's choose and replace, the
notes widget's open-in-canvas, the coin, and the timer's task box.
Rows (sidebar pages, task rows, picker tiles, tracker rows) are not.
The probe checks the header's and the sidebar's ids.

Settings panels, Welcome, Terminal, Activity Log, Tool Gallery and
Theme Editor done 2026-10-12, in the cloud, as one batch because each is
small. The keyboard shortcuts search and the Python panel's toggle,
environment and package controls; the welcome page's rows, each
carrying the command it runs (`welcome.<command>`); the terminal's
restart button (it carries `terminal.restart`, the command it runs) and
its input line; the activity log's filter buttons with their pressed
state; the tool gallery's search, install, enable and uninstall; the
appearance panel's text sizes, modes, themes, fonts, accents, custom
hue slider, comfort toggles, theme name and save. Tool rows, shortcut
rows and log rows are not. The tool gallery's editor grew past its
size baseline, so its details and status tabs moved to
`toolEditorTabs.ts`. The probe checks the welcome rows, the gallery's
search and install, the appearance panel's dark mode, hue, name and
save, and the two panel views through `workbench.view.show`.

Agents view done 2026-10-12, in the cloud (the workflow editor is not:
it is over the size limit and needs a module extracted first). The
header's new-routine and settings buttons carry their commands, the tab
switch is `agents.tab`, and on the Now tab each approval and running
card is a surface (`agents.approval` by request id, `agents.run` by task
id) with its buttons under it. Routines: the heartbeat card's action,
heartbeat settings, each suggestion and each routine row as a surface
(`agents.suggestion`, `agents.routine` by key) with run, edit, the
on/off button (pressed while on), delete and the openable head; the add
section's two buttons and the template buttons (`agents.template.<key>`).
History: the filter, mark-all-read (carrying `autonomyLog.markAllRead`),
clear, the list, and each heartbeat finding's action bar as a surface
(`agents.finding`, shared with the Now tab) with Do It, Tell Me More and
Dismiss. Mind: each belief and each standing approval as a surface with
its forget or revoke, and the forget-all and revoke-all buttons. The run
pane's pause, continue, answer, note and send; the New Routine form as
`agents.routineForm` with its fields, day toggles, time and buttons.
`sceneSlug` moved into the kit; the four local copies use it. The probe
checks the header, the Routines tab and the form.

Workflow editor done 2026-10-12, in the cloud. The palette entries, the
hidden kinds and the node summary moved to `workflowPalette.ts` so the
pane could take its declarations under the size limit. Declared: the
name input, Run Now, the enabled button (pressed while the routine is
on), each palette item (`workflows.editor.add.<kind>`), the coach's Got
It, the inspector's fields (`workflows.editor.field.<label>`, text,
number and text area alike), Delete Node and Delete Connection as one
`workflows.editor.deleteSelection`, Preview Compiled Prompt, Back and
Back To Editing. The node cards on the canvas and the run picker
dropdown are not. The probe opens a new workflow and checks the header
and one palette item.

AI settings, Output, Diagnostics and Indexing log done 2026-10-12, in
the cloud. The AI & Models panel (`src/aiSettings/ui/`) is a surface
`aiSettings` owned by ai-settings inside the settings editor, with its
search, nav buttons (pressed while active), every row's reset and each
section's reset link, the providers' enable toggles and API key fields,
each agent card as `aiSettings.agent` by id with configure, remove,
save and cancel, the tool tree's group, category and tool checkboxes as
toggles, each MCP server row as `aiSettings.mcp.server` by id with its
state buttons (`aiSettings.mcp.server.<label>`), the add form's tabs,
each catalog card as `aiSettings.mcp.catalog` with its install, the
environment inputs, and the custom form's fields and buttons. The three
panel logs are one `createList` each (`output.log`,
`diagnostics.results`, `indexingLog.log`); their commands live in the
view title menus, not in the view. The probe opens the AI panel again
after the openers (the settings editor shows one panel at a time, as a
centred overlay) and checks the panel, its search, a nav item, add
agent and add server, then presses Escape.

Chat chrome done 2026-10-12, in the cloud, except the message area:
the input's add-context, configure-tools, send and stop buttons (one
`iconButton` helper now makes all four, which kept the file under its
baseline), the message box (`chat.input`), the context picker's Done,
the mode, model and context-window pickers (value is the button's
text), the engine chip (`chat.engine`) and its popover as a surface
with the model rows (pressed) and Details, the session sidebar's
refresh, filter, search box, the session list, and each session row as
`chat.session` by id with its delete; the context menu's toggle
(`chat.context`, pressed while open) and each pill as `chat.contextPill`
with restore or remove; each attachment chip as `chat.attachment` with
remove and Switch Model, and each suggested file as `chat.suggestedFile`
with add and dismiss. The probe checks the input, send, add context, mode, engine and
context ids (and, since the widget's own commit below, new chat and
the strip's commands cell).

Canvas page chrome and bubble menu done 2026-10-12, in the cloud. The
page menu's Font section moved to `header/pageFontMenu.ts` (the gate
test lists it) so `pageChrome.ts` could take its declarations under
the size limit: the ribbon's favorite (pressed while favorited) and
page menu, the backlinks toggle, the cover's reposition, change and
remove, the hover affordances (add icon, cover, properties), the
reposition bar's cancel and save, the page menu as a surface
`canvas.pageMenu` with each action (`canvas.pageMenu.<label>`), and
in the font section the current font, each font's pick, set-default
and remove, and upload. The bubble menu is a surface
`canvas.bubbleMenu` with its formatting buttons (`canvas.bubble.<title>`,
pressed while the mark is active), the link field and its apply, copy,
open and remove, and the tool actions (`canvas.bubble.tool.<action>`).
Not done: the sidebar (`canvasSidebar.ts`, 2198 lines), the property
editors and picker, the template picker and the version history panel;
each is a session of its own and the sidebar needs an extraction first.
The probe makes a new page and checks the ribbon and an affordance.

Canvas pickers done 2026-10-12, in the cloud: the template picker as
`canvas.templatePicker` with each template card (`canvas.template.<id>`),
blank, manage and cancel; the version history panel as
`canvas.versionHistory` with close and restore (the version rows are
not); the property picker as `canvas.propertyPicker` with its search,
each property row as `canvas.propertyPicker.item` by name with its
delete, and the new-property name, type and create. Left in canvas:
the sidebar and the property editors (`properties/propertyEditors.ts`,
one editor per property, so ids need the property name from
`createPropertyEditor`'s caller).

Chat widget done 2026-10-12, in the cloud. The empty state's strip and
the offline notice moved to `widgets/chatEmptyStateKeys.ts` (the chat
gate test lists it) so the widget could take its declarations under
the size limit: the title actions (new chat carrying `chat.newSession`,
history, view system prompt, AI settings), each queued message as
`chat.pending` by id with steer and remove, the plan card's clear, the
system prompt viewer as `chat.systemPrompt` with close and copy, the
strip's `/`, `@` and mode cells (`chat.empty.*`, the mode cell's value
is the mode's label) and the offline notice's Open AI Settings. The
message list and its content parts stay undeclared by design.

Canvas property editors done 2026-10-12, in the cloud.
`createPropertyEditor` declares the editor it builds when its context
carries a `sceneId`, with the property's name as label and what the
editor shows as state (a box's checked, a field's text, else the words
on it). A page's property panel passes `canvas.property.<name>` per
property; the database table passes none, since one id per cell would
repeat under one surface.

Canvas sidebar done 2026-10-12, in the cloud. The undo toast moved to
`canvasSidebarToast.ts` (the gate test lists it) so the sidebar could
take its declarations under the size limit: the page tree as one
`createTree` (`canvas.sidebar.tree`, selection is the selected page),
the new page button and its options chevron, the recents header, the
trash button, the empty state's two buttons, the page options popup as
`canvas.pageOptions` by page id with its icon button and each action
(`canvas.pageOptions.<id>`), the trash panel's close and empty, the add
popover as `canvas.addPopover` with each choice (`canvas.add.<label>`),
and the toast's undo and dismiss. Tree rows, their hover buttons and
the trash rows are not. With this, step 5 is complete for the
built-ins; the sweep's remaining raw DOM in them is chrome the kit does
not draw (rows, cells, cards), which stays.

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

Done 2026-10-12, in the cloud. `api.ui` now has `createSurface`,
`declareControl`, `createToggle`, `createInput`, `createSelect`,
`createSlider`, `createTabs`, `createMenu`, `createList` and
`createTree`, and every kit option type takes `id`, `hint` and (for
buttons) `command`. `createDropdown` with an id is in the scene as a
select whose value is the chosen item, and its dispose removes the
entry; `createAiButton` with an id is a button that records its
command; without ids both behave exactly as before. `parallx.d.ts`
declares all of it under `ui` with a `SceneState` type, the authoring
guide's section 6.3 shows one example of each, and
`tests/unit/uiBridgeScene.test.ts` checks the bridge against the scene.

### Step 7. Extensions, one per session (local)

In this order: workspace-graph, web-research, budget, flashcards,
concept-lab, media-organizer, creations-ai, browser, study (last, because
`scripts/bundle-study.mjs` rebuilds its main file; convert the sources
under `ext/study/src/` and re-bundle). Each session converts one
extension's controls to `api.ui` calls with the recipe and its probe row.
`extStyleRatchet` and `extUndefinedNames` stay green throughout.

workspace-graph done 2026-10-12, in the cloud, with `api.ui.declareControl`
on the chrome it draws itself (its DOM and styles unchanged): the
toolbar's search, view switch (value is its text), pause physics, hide
edges, fit all, refresh, AI refresh and settings; the settings panel's
refresh action and re-cluster; the sidebar's refresh and open. The
per-concept merge dropdowns are rows and carry no id. Its DOM helpers
moved to `chrome.js` (the loader resolves relative imports) to keep
`main.js` under its size baseline. The scene probe
now turns an extension on through the enablement service (the seeded
workspace has none on) and checks one surface per extension; its
`EXTENSION_IDS` map gains a row per converted extension.

web-research checked 2026-10-13, in the cloud: it draws no chrome (an
AI tool and a bridge, no buttons or fields), so there is nothing to
declare; it is done as it stands.

Next is budget, on the owner's machine as planned. What the next
session needs to know: `ext/budget/main.js` is at its size baseline
(9060 lines), so every id goes inside an existing kit call's options on
the same line, or a module is extracted first (the drawers at lines
1850 to 1910, 3696 to 3735 and 4040 to 4065 are the natural cut; the
loader resolves relative imports). Of its 31 kit calls, give ids only
to the singletons (the sidebar's sync, the undo bar, the month
navigation, the rules editor's cancel and save, the plan view switch,
the drawers' close buttons with one id per drawer); the per-row calls
(category, account and rule actions, review confirm and skip, the
"use suggested" buttons) repeat and need a surface per row first.
Raw inputs (the drawers' fields, the search box) take
`api.ui.declareControl` with a value state. Then flashcards,
concept-lab, media-organizer, creations-ai, browser and study, in that
order.

### Step 8. The scene line in the prompt (cloud)

One line on the latest user turn, where `formatTurnClock` is prepended in
`src/openclaw/openclawAttempt.ts`: the active editor, the focused surface
and its selection, from `describeScene`. Never in the system prompt, so
the prompt cache stays warm.

Done 2026-10-12, in the cloud. `formatSceneLine` in `src/ui/scene.ts`
turns a description into `[Scene: editor "Reading" (pdf); focused
"Explorer" (view.explorer); explorer.tree: notes/alpha.md]`: the first
visible pane inside an editor group, the deepest focused surface (not
repeated when it is the editor), and each non-empty selection directly
under it (five values, then a count). It is empty when nothing is
mounted, so a turn built outside a window adds nothing.
`openclawAttempt` puts it on its own line after the turn clock, on the
latest user message only. `tests/unit/sceneLine.test.ts` covers it.

### Step 9. The probes move to ids (local)

`refactor-verify-probe.mjs` and `ui-screenshot-probe.mjs` lose their
class-name queries and `__parallx_workbench__` reaches except `cmd()`;
they use `tests/probes/scene.mjs`.

### Step 10. Reference docs (cloud)

Section 8.

Done 2026-10-12, in the cloud. The rendering lives in
`tests/unit/referenceDocs.test.ts`, because it needs the TypeScript
modules vitest loads: the core command modules (a check keeps that list
complete), the built-in manifests through `builtinManifests.ts`, and
every `ext/*/parallx-manifest.json`. `scripts/build-reference.mjs` runs
that file with `UPDATE_REFERENCE=1`, and `npm run build` runs the
script; without the flag the test fails when a file on disk differs
from what the registries say. Settings the workbench registers at run
time are not in `settings.md` (its header says so); the manifests'
are.

### Step 11. The audit (cloud, after steps 5 and 7)

`scripts/scene-sweep.mjs`, on the model of `scripts/dead-code-sweep.mjs`:
reads `scene-full.json` and the source, and lists every entry with no
label, every id registered under two parents, every kit call with
`onClick` where a command with the same name exists, and every file
whose raw DOM count is above zero. Its output goes into section 11 as
the remaining work.

The script is done (2026-10-12, in the cloud); the audit re-runs after
step 7. Its first run, on the probe's scene at commit 7db7ace6:
unlabeled 0, twoParents 0, onClick 0, rawDom 242 files. The raw DOM
list is led by the extension mains (flashcards 783, creations-ai 541,
budget 503, media-organizer 460, browser 241, study's pane 218,
concept-lab 182), which step 7 converts, then by the built-ins step 5
still owes or only partly declared: the chat's content parts (118),
the canvas database editor (109) and sidebar (108), the dashboard
editor (106), the worksheet dashboard pane (91) and the workflow editor
(85). Section 11 carries the summary; the full list is the script's
output.

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
   returned element or handle in the same variable. A control whose
   look the kit does not have (a window button, a tab, a menu bar item)
   is declared in place with `declareControl` instead, and both passes
   are one commit for it. Run section 13.
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

- 2026-10-12, step 3: an open context menu was not a scene entry.
  Closed the same day: `ContextMenu` registers itself as a surface
  `contextMenu` (label from the new `label` option, 'Menu' otherwise)
  and each row as `contextMenu.<item id>` (a toggle when the item is
  checkable, with its pressed state; else a button with its enabled
  state and the tooltip as hint), all disposed with the menu.
  `tests/unit/contextMenuScene.test.ts` covers it.

- 2026-10-12, step 5, hand-off (steps 1, 2, 3 done; step 5 done for
  worksheet, planner, PDF, explorer, search, dashboard, settings panels,
  welcome, terminal, activity log, tool gallery, theme editor, the
  Agents view, run pane and routine form, the workflow editor, AI
  settings, the three panel logs, the chat chrome, the chat widget, and
  the canvas: step 5 is complete for the built-ins). Left in
  step 5, in this order, one commit each, each verified by the probe
  (section 13; in the cloud run it as
  `timeout 280 xvfb-run -a node tests/probes/scene-probe.mjs <outDir>`
  after `npm run build`) and the full suite:
  1. (done, see step 5's notes) the workflow editor, ai-settings,
     output, diagnostics and indexing-log.
  3. canvas: done (page chrome, bubble menu, pickers, property editors,
     sidebar). Never the Tiptap document.
  4. chat: done; the message list's markdown is never declared.
  Steps 6, 8 and 10 are done, and step 11's script exists (run it after
  step 7). Step 7 has started (workspace-graph); its remaining
  extensions and step 9 are local, then 4 and the step 11 audit.

  What this session learned, for whoever continues:
  - A repeated card (a widget, a routine row, an approval) is a surface
    with the row's id as `instance`, and its buttons sit under it with
    fixed ids. A row with no actions is not declared; a list of rows is
    one `createList` entry.
  - A kit button whose scene state is not "enabled" (an on/off button)
    is made without an id and then `declareControl`ed with the state;
    `createButton` with an id plus a second `declareControl` on the
    same element is silently ignored.
  - A control that runs a command with arguments (Heartbeat Settings…
    runs `agents.openSettings` with a group) keeps its own id and
    records the command; only a control that runs the bare command
    takes the command id as its id, and that at most once per surface.
  - `sceneSlug` lives in the kit now; use it for every dynamic id
    segment.
  - Probe: the appearance panel opens as a centred overlay and swallows
    clicks; the probe presses Escape after reading the full scene. A
    test that leaves a declared element in the document after its
    owner is disposed collides with the next test under the window:
    clear the body and `scene.reset()` in `afterEach`.

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
