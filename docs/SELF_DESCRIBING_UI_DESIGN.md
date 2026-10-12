# The self-describing UI: design and build order

The app's screen becomes a projection of declarations, so that the same
declaration serves a screen reader, a test, the docs, the model and, later,
an assistant driving the app. This page is the whole design and the whole
build order. It is written for the sessions that implement it: every
decision is made here, and a session that finds a gap in it writes the
decision into this page before writing code, so the next session builds
the same thing.

Read it top to bottom once. Then work by section 9, one step per session.

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

## 3. Vocabulary

Use these words in code, comments, tests and docs. Do not invent others.

- **Declaration**: the data a control or surface is made from: id, kind,
  label, hint, icon, owner, when, command or handler, state.
- **Control**: one interactive element: a button, an icon button, a
  chip, a segmented switch, a toggle, an input, a select, a slider, a
  list, a tree, a tab bar, a menu. A control has an id and a kind.
- **Surface**: a region that holds controls: a part (title bar, activity
  bar, sidebar, editor part, panel, status bar), a view in a part, an
  editor pane, a dialog, a popover. A surface has an id and an owner.
- **Owner**: the tool id that put the surface or control there
  (`core` for the workbench, `canvas`, `chat`, `ext:budget`, ...). Turned
  off, an owner's entries vanish with it, which is the first principle
  in CLAUDE.md made checkable.
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
  /** Stable within the owner: 'planner.addTask', 'chat.input'. Section 4.3. */
  readonly id: string;
  readonly kind: SceneKind;
  /** Tool id or 'core'. */
  readonly owner: string;
  /** What a person reads: the button label, the input's label, the pane title. */
  readonly label: string;
  /** One line more, when there is one: the tooltip. */
  readonly hint?: string;
  /** The command this control runs, when it runs one. */
  readonly command?: string;
  /** The parent surface's id, or undefined for a top-level surface. */
  readonly parent?: string;
  /** The element, for probes and for focus. Never serialised. */
  readonly element: HTMLElement;
  /** The control's state now: section 4.4. Undefined when it has none. */
  readonly state?: () => SceneState;
}

export type SceneState =
  | { readonly kind: 'pressed'; readonly value: boolean }
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'selection'; readonly value: readonly string[]; readonly count: number }
  | { readonly kind: 'enabled'; readonly value: boolean };
```

A list, a tree or a tab bar registers once, as one entry whose state is
a selection with a count. Its rows are never entries; a tree of 400 notes
is one entry. This is the rule that keeps the scene small and cheap.

### 4.3 Ids

- An id is `<owner>.<name>` with the owner's prefix dropped when the
  owner is `core`: `planner.addTask`, `worksheet.sheetTheme`,
  `commandPalette.input`, `sidebar`.
- A control that runs a command uses the command's id as its own id when
  there is one such control in its surface. A second rendering of the
  same command in another surface uses `<surface>.<command>`:
  `titlebar.workbench.action.toggleSidebar`.
- Ids never carry instance data. A pane for page 42 is
  `canvas.page` and its surface state carries the page.
- Ids are stable across versions. Renaming one is a change the docs and
  the memory lessons feel, so it is a commit of its own with the old id
  listed in the message.
- Within one parent, ids are unique. Registering a duplicate throws in
  development and logs once in production, and the entry is not added.

### 4.4 State

State is read through a function, not stored, so the scene never goes
stale and a control keeps its state where it always did (the DOM
attribute, the component field). The kit supplies the function; a
converted control never writes one by hand.

### 4.5 The API

```ts
export interface IScene {
  /** Adds the entry; the returned disposable removes it. */
  register(entry: ISceneEntry): IDisposable;
  /** The entry with this id, if mounted. */
  get(id: string): ISceneEntry | undefined;
  /** Every mounted entry, parents before children, in registration order. */
  entries(): readonly ISceneEntry[];
  /** The entries under one surface, recursively. */
  under(surfaceId: string): readonly ISceneEntry[];
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
functions, ready for a test, the introspection service or a prompt:

```ts
export interface SceneDescription {
  readonly surfaces: readonly SceneNode[];
}
export interface SceneNode {
  readonly id: string;
  readonly kind: SceneKind;
  readonly owner: string;
  readonly label: string;
  readonly hint?: string;
  readonly command?: string;
  readonly state?: SceneState;
  /** Surfaces only. */
  readonly children?: readonly SceneNode[];
  /** True when the element is connected, laid out and not hidden. */
  readonly visible: boolean;
}
```

`visible` is computed the way `paneOnScreen` in the Worksheets state
module computes it: connected, `offsetParent` not null, document not
hidden. Hidden entries are kept in the description with `visible: false`;
a consumer that wants only what is on screen filters.

The introspection service gains `describeScene(scope?)` that returns
this, and `app__describe` gains the topic `scene`. That is the only
change to the model-facing code in this work.

### 4.7 What the scene is not

- Not a focus manager. Focus stays where it is handled today
  (`interactionMode.ts` and the parts).
- Not an event bus. Controls still call their handlers directly.
- Not persisted. It is rebuilt by mounting.

## 5. The kit contract

### 5.1 The rule

Every control in `src/` and, through `api.ui`, in `ext/` is made by a
kit function. A kit function takes a declaration, builds the same DOM the
hand-built version built, sets the role and the label, registers in the
scene while mounted, and returns a handle with `element`, `dispose()` and
the state the control has.

### 5.2 Declarations

Every kit function takes one options object with these fields first:

```ts
export interface IKitDeclaration {
  /** Section 4.3. Required. */
  readonly id: string;
  /** The tool id or 'core'. Required; api.ui fills it for extensions. */
  readonly owner: string;
  /** What a person reads. Required; for an icon button it is the tooltip. */
  readonly label: string;
  readonly hint?: string;
  readonly icon?: string;
  /** A when-clause; evaluated by the caller, recorded here for the docs. */
  readonly when?: string;
  /** The parent surface. Required for a control; optional for a surface. */
  readonly surface?: string;
}
```

and then the kind's own fields. A control runs either a command or a
handler, never both, and the kit refuses a declaration with both:

```ts
export type KitAction =
  | { readonly command: string; readonly args?: readonly unknown[] }
  | { readonly onClick: (e: MouseEvent) => void };
```

When it is a command, the kit runs it through the command service handle
that `installKitCommands(service)` set at boot (section 9, step 1), and
the control's `command` field is set in the scene. When the command has a
`when` and it is false, the control renders disabled. A control with a
handler is allowed; it is what a list row's local action is. The ratchet
in 6.3 counts handlers so the share of commands rises over time.

### 5.3 The components

The kit grows from seven functions to the set below. Each existing
component in `src/ui/` (toggle, inputBox, dropdown, slider, tabBar,
segmentedControl, contextMenu) keeps its class and its file; the kit
function wraps it, exactly as `createSegmented` wraps `SegmentedControl`
today. Nothing is rewritten.

| Kit function | Wraps | Kind | State |
|---|---|---|---|
| `createButton` | itself | button | enabled |
| `createIconButton` | itself | iconButton | enabled |
| `createFilterChip` | itself | chip | pressed |
| `createSegmented` | SegmentedControl | segmented | value |
| `createToggle` | Toggle | toggle | pressed |
| `createInput` | InputBox | input | value |
| `createSelect` | Dropdown (`createSelect`) | select | value |
| `createSlider` | Slider | slider | number |
| `createList` | new, thin | list | selection |
| `createTree` | the explorer's tree | tree | selection |
| `createTabs` | TabBar | tabs | selection |
| `createMenu` | contextMenu | menu | none |
| `createSurface` | itself | surface | none |
| `createPageHeader`, `createSectionLabel`, `createEmptyState` | themselves | none | none |

`createSurface(container, declaration)` registers a surface and returns
`{ element, dispose }`. It adds no DOM of its own when `container` is
given: it registers the container. A pane calls it once in
`createPaneContent`; a view calls it once in `createView`; a part calls
it once in its `create`. The three base classes do this for their
subclasses (section 9, step 2), so a pane author never calls it.

`createList` is the one new piece of UI code. It takes the row elements
the caller already builds and manages selection and the scene entry:
`{ id, owner, label, rows: () => HTMLElement[], selected: () => string[] }`.
It does not render rows. The existing lists keep their row code.

### 5.4 What the kit writes into the DOM

For every control: `data-px-id="<id>"` on the element, the role the kind
implies (`button`, `switch`, `combobox`, `slider`, `listbox`, `tree`,
`tablist`, `menu`), and `aria-label` when the control shows no text of
its own. Nothing else changes: class names, structure and listeners are
exactly what the hand-built version had. The compliance test in 6.2 reads
`data-px-id`.

### 5.5 The extension API

`api.ui` gains the same functions with the same options minus `owner`,
which the bridge fills from the extension's id. The four functions it
has today (`createDropdown`, `renderMarkdown`, `createAiButton`,
`showContextMenu`) stay and are implemented by the kit, so an extension
written today keeps working unchanged. `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`
section 6 gets the new functions with one example each, added in the
same commit as the bridge.

### 5.6 Rules the kit enforces at runtime

- A declaration without `id`, `owner` or `label` throws in development
  (`isDevMode()` from `src/platform/devMode.ts`, which is also true under
  the probes) and logs once in production, then renders anyway. The app never breaks over a label.
- A control registers in the scene when mounted into a connected parent,
  or when its surface registers, whichever is later; it leaves on
  `dispose()` or when its element is removed from the document (a
  `MutationObserver` on `document.body`, one for the whole kit, batched
  per frame). This is what makes conversion safe: a pane that forgets to
  dispose a control still leaves the scene clean.

## 6. The ratchets

Three tests in `tests/unit/`, on the model of `fileSizeRatchet.test.ts`:
a baseline file committed beside the test, `UPDATE_<NAME>_BASELINE=1`
refreshes it, and the test fails when a count moves the wrong way. The
baselines are refreshed only in a commit whose message says what fell.

### 6.1 `rawDomRatchet`

Counts, per file in `src/**/*.ts` and `ext/**/*.js` (not readability.js,
not generated files, not `src/ui/kit.ts` and the components it wraps):
`document.createElement(`, `el('`, `h('`, `innerHTML =`, and
`addEventListener('click'`. A count may fall, never rise. A new file
starts at zero. This is what stops a conversion from leaking back.

### 6.2 `sceneCoverageCompliance`

Runs under vitest with jsdom, mounts each kit function once with a full
declaration, and asserts: `data-px-id` set, role set, label readable
(`aria-label` or text), scene entry present with the right kind, state
function returns the right shape, dispose removes the entry. This is the
kit's own contract test; it does not need the app.

### 6.3 `kitHandlerRatchet`

Counts, per file, kit calls whose action is `onClick` rather than
`command`. May fall, never rise. Keeps the share of declared commands
growing without forbidding local handlers.

### 6.4 The probe check

`tests/probes/scene-probe.mjs` (section 7) launches the app, waits for
the workbench, and writes `scene.json` from `scene.describe()`. A second
run in the same session, after opening each built-in's main surface by
command, writes `scene-full.json`. The probe fails when any visible
control lacks a label or when two entries share an id under one parent.
It runs locally, on a session's machine, before every commit of a
conversion. It is not a vitest test.

## 7. The probes address by id

The probes in `tests/probes/` drive the app with Playwright through
`window.__parallx_workbench__` and CSS class names. They get three
helpers in a shared `tests/probes/scene.mjs`:

```js
export async function sceneOf(page, scope)      // scene.describe(scope)
export async function click(page, id)           // the element with data-px-id, a real click
export async function type(page, id, text)      // focus the input by id, type, blur
```

`click` throws with the ids that exist under the same surface when the id
is not found, so a failing probe names the control it wanted and the
controls that were there. A conversion step is done only when its
probe row addresses the converted feature by id and passes.

## 8. Docs from the registries

`scripts/build-reference.mjs` runs the renderer bundle under jsdom the
way the compliance tests do, or, when that is not possible for a tool,
reads its manifest, and writes `docs/reference/commands.md`,
`docs/reference/settings.md` and `docs/reference/views.md` from the
command registry, the settings schemas and the view registrations, with
each entry's owner and when-clause. `npm run build` runs it. A test
asserts the three files match the registries, so they cannot drift.
This is step 10 in section 9 and comes last, after the registries are
the only source.

## 9. The build order

One step per session. Each step ends with: `npm run typecheck`,
`npx vitest run`, `npm run build`, the probe rows for what changed run
locally, the ratchet baselines refreshed only where counts fell, one
commit, pushed. A step that is not finished is not committed as half;
the session pushes what works and writes what is left into section 11.

### Step 1. The scene and the kit contract (cloud)

- `src/ui/scene.ts` as in section 4, with its unit test.
- `IKitDeclaration` and `KitAction` in `kit.ts`; the seven existing
  functions take them (the old positional `options` keep working for one
  step by a shim that fills `id` from the label and `owner: 'core'`,
  logged as a warning; the shim is deleted in step 4).
- `installKitCommands(service)` called once in the workbench boot right
  after the command service exists.
- `createSurface`, `createToggle`, `createInput`, `createSelect`,
  `createSlider`, `createTabs`, `createMenu`, `createList`.
- `data-px-id`, roles and labels as in 5.4.
- The three ratchets with their baselines at today's counts.
- `describeScene` on the introspection service and the `scene` topic on
  `app__describe`.
- `tests/probes/scene.mjs` and `tests/probes/scene-probe.mjs`.

Nothing in the app is converted in this step. The app behaves exactly as
before. This step is the contract every later step copies.

### Step 2. The three base classes register surfaces (local)

`Part.create` in `src/parts/part.ts`, the caller of
`EditorPane.createPaneContent` in `src/editor/editorPane.ts` and the view
provider wrapper in `src/api/bridges/viewsBridge.ts` each call `createSurface` with the id
and owner they already know (part id, editor type id, view id) and
dispose it with the host. After this step the scene holds every part,
pane and view with no feature touched, and `scene-probe` writes the first
`scene.json`. Verify in the app: open the describe tool in chat with the
`scene` topic and read the tree.

### Step 3. The frame (local, two sessions)

Convert, in this order, the controls in: `titlebarPart`,
`activityBarPart`, `statusBarPart`, `sidebarPart`, `panelPart`,
`auxiliaryBarPart`, `editorPart` (its tab bar through `createTabs`), the
command palette, the quick open, the settings editor. Two passes per
file, as in section 10. These are the surfaces every feature hangs in,
so once they are done every later probe row can navigate by id.

### Step 4. Delete the shim (cloud)

The positional shim from step 1 goes; typecheck lists every remaining
caller; they are converted in this step (they are the few outside the
frame and the built-ins). From here `createButton` without a declaration
is a type error.

### Step 5. Built-ins, one per session (local)

In this order, because the first three are already split into panes and
the last two are the largest: worksheet, planner, pdf viewer (an editor
pane under `src/editor/panes/pdf/`), explorer, search, dashboard,
settings, welcome, agents, ai-settings, output, terminal, diagnostics,
tool-gallery, theme-editor, activity-log, indexing-log, canvas (its
toolbar, menus and property editors; never the Tiptap document), chat
(its header, input chips, mode switch and tool cards; never the message
list's markdown). Each session converts one built-in in two passes and
adds its probe row.

### Step 6. The extension API (cloud)

`api.ui` gains the kit functions (5.5); the bridge fills `owner`; the
authoring guide gets the examples; `createAiButton` and
`createDropdown` are reimplemented on the kit. No extension changes yet.

### Step 7. Extensions, one per session (local)

In this order: workspace-graph, web-research, budget, flashcards,
concept-lab, media-organizer, creations-ai, browser, study (study last,
because `bundle-study.mjs` rebuilds its main file). Each session
converts one extension's controls to `api.ui` calls, two passes, with
its probe row. The `extStyleRatchet` and `extUndefinedNames` tests stay
green throughout.

### Step 8. The scene line in the prompt (cloud)

One line on the latest user turn, beside the clock that already goes
there (`formatTurnClock`, prepended in `openclawAttempt.ts`): the active editor, the focused surface and
the selection, from `describeScene`. Never in the system prompt, so the
prompt cache stays warm. Half a session, and the first thing a user
notices.

### Step 9. The probes move to ids (local)

`refactor-verify-probe.mjs` and `ui-screenshot-probe.mjs` lose their
class-name queries and `__parallx_workbench__` reaches; they use
`tests/probes/scene.mjs`. The global stays for `cmd()` only.

### Step 10. Reference docs (cloud)

Section 8.

### Step 11. The audit (cloud, after steps 5 and 7)

A sweep on the model of `scripts/dead-code-sweep.mjs`:
`scripts/scene-sweep.mjs` lists every `data-px-id` the probes saw with
no label, every id registered under two parents, every kit call with a
handler where a command of the same name exists, and every raw DOM count
above zero. Its output goes into section 11 as the remaining work.

## 10. The conversion recipe

For one file. Follow it in order, every time.

1. Read the file. List every element that a person clicks, types in,
   toggles, selects or drags. Those are the controls. Everything else
   (layout divs, labels, icons, rows) stays raw DOM.
2. For each control, write its declaration on paper first: id (4.3),
   label (the text a person sees, or the tooltip for an icon), hint,
   and whether it runs a command that already exists. If it does the
   same thing as an existing command, it runs that command. If it should
   be a command and is not, add the command in this step, with
   `aiInvocable` and `aiDescription` set the way its neighbours are.
3. Pass one, construction. Replace each control's element construction
   with the kit call, keeping the existing handler as `onClick`. Run
   typecheck, the unit tests, the build and the feature's probe row.
   Open the app and use the feature. Commit: "<Feature>: controls through
   the kit".
4. Pass two, declaration. Replace `onClick` with `command` wherever step
   2 found one. Delete the handler if nothing else calls it. Run the
   same checks and the same probe row. Commit: "<Feature>: controls
   declare their commands".
5. Refresh `rawDomRatchet` and `kitHandlerRatchet` baselines in the
   second commit only, and only for this file; the message names the
   counts that fell.
6. Write the probe row for the feature, by id, in the same session. A
   feature without a probe row is not converted.

What never changes in a conversion: class names, DOM structure,
stylesheets, the handler's body, the order listeners are attached in,
focus handling, drag and drop. If the conversion needs one of these to
change, stop, write why into section 11, and leave that control raw for
now. The ratchet accepts a file that did not fall; it refuses one that
rose.

## 11. Open items

Sessions append here. Each line: date, step, what was left and why.

(none yet)

## 12. Glossary for a new reader

- **Part**: one of the six fixed regions of the window (title bar,
  activity bar, sidebar, editor part, panel, status bar).
- **View**: a tool's content in the sidebar, panel or auxiliary bar.
- **Editor pane**: a tool's content in the editor part, one per tab.
- **Command**: a named action with an id, runnable from the palette, a
  keybinding, a menu, a control or the model.
- **When-clause**: the condition under which a command or control is
  available, over context keys.
- **Context key**: a named value the workbench keeps about its state
  (`activeEditor`, `sidebarVisible`).
- **Contribution point**: the place a tool registers something into the
  core (a view, a block, a command).
- **Tool**: a built-in or an extension; the unit the user turns on or
  off.
