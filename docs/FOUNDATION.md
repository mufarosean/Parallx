# The Foundation

> Branch `foundation-surfaces`. Founding decisions for what Parallx is built
> out of. Written 2026-08-24 after the identity discussion concluded that the
> problem is architectural, not visual.
>
> This document supersedes the layout assumptions in every prior milestone.
> Where it contradicts an older doc, this wins.

## The vision, stated plainly

Parallx is **sandbox software**. One install. A student picks it up and
studies. A programmer picks it up and writes code. Someone else runs their
life in it. Not three products and not a product with three modes bolted on:
the same foundation, shaped differently.

It must *feel* that way — modular, but clean. The user shapes the app, and
the shaping is built on a standard that does not bend.

The sandbox mechanics already work. Extensions exist, they load, they talk to
the workbench. What is missing is the foundation those mechanics stand on,
and its absence is why the app reads as an IDE with features attached rather
than as one thing.

## The diagnosis

Parallx has **extensibility** (developers can add things) but not
**malleability** (users can shape things). They are different properties and
only the second produces the sandbox feeling.

The cause is concrete. There are four separate citizenship classes for "a
thing that renders", each with its own API, lifecycle, and *fixed* home:

| Class | May live | Contributed via |
| --- | --- | --- |
| `views` + `viewContainers` | sidebar only | manifest contributions |
| `editors` | editor area only | manifest contributions |
| `statusBar` items | status bar only | manifest contributions |
| dashboard widgets | dashboard grid only | `api.dashboard` |

Regions are **typed slots, not containers**. A dashboard widget can never be
a sidebar view. A sidebar view can never be an editor tab. Nothing moves.

That is why the primary sidebar cannot be dragged to another edge: the
sidebar is not a container, it is a named singleton at a hardcoded position
(`sidebarPartDescriptor` in `layout.ts`).

Obsidian can do it because it has one citizen (`WorkspaceLeaf`) and every
region — both sidebars, the main area, popout windows — is a node in one
tree. Any view lives in any leaf. That is the entire trick.

### The second grid

`src/layout/grid.ts` is a real recursive grid: `addView`, `splitView` with an
orientation, branch nodes, sashes, sizing. It is good code and it does what
is needed.

`src/parts/editorPart.ts` then instantiates **a second Grid of its own** for
editor groups.

So the app has two independent tree layout engines that cannot address each
other's nodes. Every "why can't I put X next to Y" question in Parallx
reduces to that sentence.

## Decision 1 — Migrate. Do not rebuild.

Considered seriously, and rejected.

**What a rebuild would throw away, all of it sound:** the recursive grid
itself; the editor group model and its input/serializer system; M101 pane
retention (panes survive tab switches, LRU, preview-replace pruning); M83
theming and the `--px` token system; the settings registry; the command
system and palette; the extension host and its permission model; the canvas
block-resolution model; the SQLite worker architecture; 5,400 passing tests.

**What is actually wrong:** one layer. Parts are named singletons instead of
uniform leaves, and there are two grids instead of one.

A rebuild to fix one layer, discarding nine that work, is not warranted.
The honest read is that the foundation is not missing — it is *half-built*
and stopped at the point where VS Code's model stopped, because that is what
it was copied from.

**Consequence:** every decision below is expressed as a migration with a
working app at each step. No big-bang cutover.

## Decision 2 — One citizen: the Surface

Collapse sidebar view, editor, panel view, and dashboard widget into a single
type.

A **Surface** has an id, a type, a title, an icon, a lifecycle
(mount / show / hide / dispose), serialisable state, and a binding (below).

A Surface **does not know where it lives.** It cannot read its region, cannot
branch on being "in the sidebar", and renders identically wherever it is
placed. This is the invariant that makes everything else possible, and it is
the one most likely to be violated under deadline pressure.

Sizing is a *hint* the surface declares (preferred width, minimum height),
never a position.

## Decision 3 — One container: the workspace tree

One `Grid` instance for the whole window. Left, right, bottom, main are
**nodes in that tree**, not classes.

The seven Parts split into two groups:

- **Chrome that is genuinely not a surface:** titlebar, status bar, activity
  bar. These stay parts. They are the window frame, not content.
- **Everything else** — sidebar, auxiliary bar, panel, editor — stops
  existing as a distinct type. They become *positions in the tree with
  default sizes*, which is all they ever were.

`EditorPart`'s nested grid is deleted. Editor groups become tree nodes like
everything else.

Dragging the sidebar to any edge is then not a feature. It is a consequence
of the tree having no special cases, and if it needs special-casing to work,
Decision 2 has been violated somewhere.

## Decision 4 — Surfaces relocate; they never re-instantiate

Moving a surface between positions moves **the live instance**. Same session,
same scroll position, same in-flight work, same everything. A running terminal
dragged from the bottom to the right edge does not restart.

`Grid` needs `moveView(id, targetNode, orientation)`. It has `addView`,
`removeView` and `splitView` today, so a naive move is remove-then-add, which
destroys the view. That is the one genuinely new piece of grid code.

M101 already established the retention semantics (hide/show rather than
dispose, view-state capture demoted to an eviction fallback). This extends
them from tabs to positions.

## Decision 5 — The arrangement is a first-class object

This is the part that makes Parallx itself rather than a well-built Obsidian.

An **arrangement** is a named, switchable, shareable object that owns:

1. the tree (what is where, at what size),
2. the surfaces in it,
3. and their **bindings** — what each surface is pointed at (this deck, this
   folder, this workspace scope).

Bindings are included deliberately. Layout alone is a saved window position.
Layout plus binding is a *working context*: "Study" is not "flashcards on the
right", it is "flashcards on the right, showing the Exam 7 deck, next to
Taylor's paper open at the page I stopped on."

Notion felt limitless because a structure could be captured, shared, and
adopted. Parallx's equivalent of a Notion template is not a canvas page
template. It is the arrangement.

The consequence is the vision statement made literal: the student's Parallx
and the programmer's Parallx are **the same install in two arrangements**,
and either can be exported and handed to someone else.

It also answers the home-page question. The home arrangement is a real
place the app always lands on, deterministic because it is a saved
arrangement rather than a computed dashboard.

## Decision 6 — One contribution point

`contributes.surfaces` replaces `views`, `viewContainers`, `editors`, and the
separate dashboard widget API.

A contribution declares what a surface *is* (id, type, title, icon, sizing
hints) and where it would *prefer* to open. Preference is a default the user
overrides by moving it, never a constraint the extension enforces.

This is the change every existing extension feels, and the migration is
mechanical: the four current declaration shapes map onto one, with the old
region becoming the new default placement.

## Decision 7 — Activity keyed by surface

Activity is currently generic because the system only knows about typed slots
— it can say "a file opened" because that is the only vocabulary it has.

Once surfaces are uniform citizens with stable identity and a lifecycle, the
activity stream is specific for free: which surface, bound to what, for how
long, adjacent to what else. That is the input the app needs to be responsive
rather than merely extensible, and it is a consequence of Decisions 2 and 5
rather than separate work.

## What an app is, unified

The pieces named as the core of the app, and what the foundation does to
each. The point is not to cut features; it is that all of them speak one
language.

| Piece | Today | After |
| --- | --- | --- |
| **Commands** | One registry, one palette | Unchanged. Already right. |
| **Settings** | One schema registry | Unchanged. Already right. |
| **Theming** | One token system (M83) | Unchanged. Already right. |
| **Extensions** | One host, **four** contribution classes | One host, one class: surfaces |
| **Tools** | AI tool registry, separate from UI | Stays separate. A tool is what the assistant can do; a surface is what the user sees. Both are capabilities the workspace grants, and both answer to the same permission model. |
| **Layout** | Two grids, seven singleton parts | One grid, one citizen |
| **Activity** | Generic event stream | Keyed by surface + binding |
| **Arrangement** | Does not exist | First-class, named, shareable |

Three of seven are already unified and stay untouched. That is the case for
migration in one line.

### The operating-system reading

The framing is load-bearing, not rhetoric. An OS provides processes, windows,
a filesystem, IPC, permissions, and a shell. Parallx has each:

- **processes** — extensions, in the extension host
- **windows** — surfaces in the tree
- **filesystem** — the workspace
- **IPC** — commands and events
- **permissions** — the autonomy and consent model
- **shell** — the workbench, and arrangements are its sessions

Stating the mapping is what gives the vocabulary its consistency. Where a
piece of Parallx has no answer in that list, it is probably in the wrong
place.

## Migration order

Each step leaves a working app and is independently shippable.

1. **`Grid.moveView`** plus tests. No user-visible change. Unblocks everything.
2. **The Surface type**, with adapters for the two content contracts that
   need them: views (`ViewSurface`) and editor panes (`EditorPaneSurface`).
   The status bar is chrome, not content (Decision 3), so it gets no adapter;
   dashboard widgets become surfaces when the dashboard itself migrates onto
   the tree, not before. No user-visible change.
3. **One tree.** Delete `EditorPart`'s nested grid; editor groups become
   nodes in the workspace tree. Sidebar/aux/panel become positions. Highest
   risk step; everything after it is small.
4. **Drag anything anywhere.** Falls out of 1–3. First user-visible payoff,
   and the proof that Decision 2 held.
5. **Arrangements** — save, name, switch, export. The home arrangement.
6. **`contributes.surfaces`**, with the old contribution points supported as
   deprecated aliases for one release.
7. **Activity keyed by surface**, and the specific stream that enables.

## Open questions, to be decided before step 3

These are real forks, not requests for permission. Recorded so the decision
is deliberate when it arrives.

- **Does a surface have one instance per binding, or one per placement?** Two
  flashcard surfaces bound to different decks, side by side: clearly two
  instances. Two views of the *same* deck: one instance rendered twice, or
  two? Obsidian says two independent leaves. Cheaper, and probably right.
- **Do arrangements nest?** A "Study" arrangement containing a "Reading"
  sub-arrangement is powerful and is also where this design could acquire
  the complexity it exists to remove. Default answer: no, until something
  demands it.
- **What happens to an arrangement when an extension it references is
  removed?** The surface must degrade to a named placeholder that explains
  itself, never a blank pane, and never a load failure that takes the
  arrangement down with it.
