# Creations AI

A Parallx extension for making things with a model: characters, roleplay,
stories, and the random tables that give them variety. It replaces the
Text Generator, whose characters move in. The references are three
Perchance generators, taken for what they do well and not for their UI:
ai-character-chat, enhanced-ai-story, ai-character-generator. No image
generation, now or later.

Started 2026-09-20. Charter first, then slices; each slice ships whole.

## What Perchance gets right, and what it gets wrong

Right: a character is a small text object (description, reminder, lore),
a story is a brief plus a running text you steer, a character can be made
from a link with a twist, and everything is text you can edit. Wrong:
one giant page per generator, state in the browser, no locking, no
per-field regeneration, no way to see what a twist changed, nothing kept
with the rest of your work.

Creations AI keeps the objects and fixes the handling: every creation is
a tab, every field is a control, everything is saved in the workspace.

## Rules

- Every model call goes through the workbench's provider layer, with the
  model the user chose. No per-model behaviour in this extension.
- Everything is saved in the workspace: characters and threads as the
  files the chat already reads, new kinds (stories, tables) in extension
  tables. Any creation exports as Markdown or saves as a canvas page.
  Nothing lives only in memory.
- Sidebar is navigational: Home, Settings, and the creations list.
  Actions live on a creation's tab. Setup lives on Settings.
- One dropdown implementation (api.ui.createDropdown), Title Case labels,
  tokens not hex, no em dashes in UI text, hints as tooltips.
- Sources fetched for a creation are fetched locally (the browser and
  web-research fetch path) and cited on the creation.
- No images. The word does not appear in the UI.

## Slice 1: Character Studio

A character is: name, tagline, appearance, personality, voice, backstory,
goals, flaws, skills, relationships, sample lines, plus the two fields
the chat uses, Description (how the model plays them) and Reminder (what
it must never forget). Existing Text Generator characters migrate into
this shape untouched.

Three ways to make one:

1. **From a prompt.** "A retired forensic accountant who hears music in
   ledgers." Generates every field.
2. **From sources.** One or several: a link, a canvas page, a PDF, a file
   in the workspace, pasted text. The text is fetched locally, condensed,
   and the character is drawn from it, cited.
3. **From sources with a Twist.** The Perchance feature, improved. The
   Twist is a field of its own ("Jackie Chan, but he never made it as an
   actor and works nights as a hotel security guard", "Jackie Chan in a
   wuxia world, a sought-after master who refuses students"). The model
   is told to keep everything the Twist does not touch faithful to the
   source. The result shows Original and Twisted side by side, field by
   field, so the change is visible. Twists are kept with the character
   and stack: a character keeps its lineage, and any ancestor can be
   reopened.

Every field has Lock and Reroll. Regenerate the backstory without moving
the personality. Reroll the whole sheet with three fields locked. The
same controls work on a character made by hand.

Test of done: a character made from a Wikipedia link with a Twist, three
fields rerolled, saved, exported as Markdown, reopened from Home.

### Slice 1 screens (gate 1: read before any code)

Built from what exists: the Media Organizer's one-provider-many-tabs
pattern, the Text Generator's character files (kept, so chat keeps
working), Lucide icons, the M89 empty states, api.ui.createDropdown.
New CSS is limited to two things, named below.

**Sidebar (Creations AI).** Home, Settings. Under them, Characters as a
plain list, most recent first; clicking one opens its Studio tab. No
actions in the sidebar.

**Home tab.** Two launcher rows: New Character, New Roleplay (Story
arrives with slice 3 and is not shown before then). Below, Recent: one
row per creation with its kind, name, when, and one chip (Draft,
Twisted, In Chat). Empty state from the registry: "No creations yet."
with New Character.

**Character Studio tab.** One column, flush, three sections.

Bar: the name as an editable title; a status chip (Draft, Saved,
Generating, Unsaved Changes); actions Generate, Save, Open Chat, Export
As Markdown; a Lineage dropdown when the character has ancestors
("Jackie Chan (source)" > "hotel security guard" > this), each entry
opening that ancestor's tab.

Make (collapses once a sheet exists; reopens with a click):
- Mode as two chips: From A Prompt, From Sources.
- Prompt: one text area. Hint as placeholder, sentence case.
- Sources: a list of rows, each with a Lucide icon for its kind (link,
  canvas page, PDF, workspace file, pasted text), its title, a state
  chip (Fetching, 3,200 words, Could Not Fetch) and Remove. Add Source
  is one dropdown with those five kinds. Fetching is local.
- Twist: one text area, "What changes". The faithfulness rule (keep
  everything the Twist does not touch true to the source) is always on;
  it is a rule, not a toggle.
- Generate. Primary in the accent. Never green.

Sheet: one row per field, in this order: Name, Tagline, Appearance,
Personality, Voice, Backstory, Goals, Flaws, Skills, Relationships,
Sample Lines, Description (what the chat plays), Reminder (what it
never forgets). Each row is label, text (edited in place, grows with
its content) and, on hover, two icon actions: Lock and Reroll. A locked
row shows a small lock chip and is never touched by Generate or Reroll.
When the character is twisted, a Show Original toggle in the bar puts
each field's pre-twist text beneath it in muted type. While generating,
rows fill in order as the model streams; locked rows stay; a row that
fails shows "Could not generate. Try Again" inline, never a modal.

Chat Behaviour (collapsed, at the bottom): the existing settings the
chat already reads, unchanged in meaning, re-labelled in Title Case:
Writing Preset, Point Of View, Reply Length, Example Dialogue, Opening
Messages, Lorebooks, Memory, Shortcut Buttons, Temperature. The custom
CSS field is dropped; it is a Perchance page artefact.

**Settings tab.** Model (the workbench's chooser), Default Writing
Preset, Words Kept Per Source (the condensation cap).

**States accounted for.** First open after install: "12 characters
brought over from Text Generator" once, on Home. No model configured:
Generate is disabled with the tooltip saying why and Settings one click
away. A source that fails: its row says so; Generate still runs on the
others. A model error mid-stream: filled rows keep their text, the
rest show Try Again. Unsaved changes on tab close: the workbench's own
confirm, never window.confirm.

**The two pieces of new CSS.** The field row (label, growing text,
hover actions, lock chip, Original sub-text) and the source row. Both
on tokens only.

### Slice 1 build list (every part, with its gate)

1. Extension scaffold `ext/creations-ai`: manifest, activation, one view
   provider, one editor provider routing on instanceId prefixes
   (`home`, `character:<id>`, `settings`), commands, settings keys
   registered lazily and idempotently. Gate: activates clean, tabs open.
2. Data: characters stay as the existing JSON files (chat keeps reading
   them) with new fields under `studio`: the sheet fields, `sources[]`
   with citations, `twist`, `original` (pre-twist sheet), `locks[]`,
   `parentId`. Migration is a read, not a rewrite. Gate: every existing
   character opens in the Studio unchanged; unit tests on the mapping.
3. Sources: link through the web-research fetch and readability path
   (exposed as a command if it is not already callable across
   extensions), canvas page text, PDF text through the M93 path,
   workspace file, pasted text; each condensed to the cap with the
   citation kept. Gate: unit tests on condensation; one probe per kind.
4. Generation: one structured request, fields in fixed order behind
   delimiters, parsed incrementally as it streams; locked fields sent
   as fixed context, never regenerated; the Twist instruction with the
   faithfulness rule; pure prompt builder and parser unit-tested with a
   stubbed model (never live Ollama in tests). No model-specific
   behaviour anywhere.
5. Lineage: parent pointer plus the original snapshot; the Lineage
   dropdown; Twist Again creates a child. Gate: unit test on lineage
   walk; probe opening an ancestor.
6. Home, sidebar, Settings. Gate: design checklist.
7. Open Chat and Export As Markdown reuse the Text Generator's code
   paths as they are.
8. Gates before "done": design-system checklist; hidden probe reading
   computed styles in both themes (tokens resolved, no hex, no
   horizontal overflow, popups above the frame); tsc and vitest; the
   full-flow probe (link, Twist, three rerolls, save, export, reopen)
   against the stubbed model.
9. Charter updated; memory note written.

### Slice 1: built 2026-09-20

What shipped against the screens above, and where I decided differently
and why:

- The Studio is the one surface for a character, new or existing, Forge-made
  or hand-written: a rail click opens it. Chat Behaviour is the old form
  behind a button, with Back To Studio, until slice 2 restyles it.
- No Save button. The sheet autosaves (800 ms after an edit, at once after
  Generate); the status chip reads Draft, Saving, Saved or the generation
  stage. A new character gets its file the moment it has a name.
- Show Original became the Canon section. Prose diffs guess; the canon says
  it: every fact marked kept, changed (with "was") or added, and any fact
  can be clicked out of the next generation. One sheet is written, from the
  twisted canon, so a Twist costs two extra model calls, not a second sheet.
- Reroll has Undo. Three alternatives per field were cut: one more control
  per row for a gain the undo already gives.
- The name has no lock. A name that is in the title when you press Generate
  is the name: the prompt is told it and the model never rewrites it; clear
  the title to let the model choose (Mufaro, 2026-09-20: his typed name was
  being overwritten while the rail still showed it). Every later save also
  updates the rail row and the sidebar, not only the first.
- Try A Line at the bottom of the sheet: one reply in their voice, no
  thread, so the voice is heard before Open Chat.
- The dials sit inside Make, collapsed, and enter the prompt only once
  touched, so a character from a Wikipedia link is never handed random hair.
- Sources: link (the local fetch bridge, readable text extracted in the
  Studio), canvas page (canvas.pickPageLink, canvas.getPageMarkdown),
  workspace file (a path, since the platform has no file-open bridge for
  extensions yet), pasted text. PDF is deferred: the platform has no PDF
  text bridge; it lands when one does. Each source is condensed to Words
  Kept Per Source (settings.studioSourceWords, default 1500), citation kept.
- The old Forge pane and its prompts are gone; the dials, their lists and
  buildForgeSpec stay and feed the Studio. Its live harness
  (ext/text-generator/test/run-forge-test.mjs) is superseded by
  tests/unit/creationsStudioPane.test.ts.
- The rail's two native confirm() dialogs became workbench warnings. Five
  remain in the chat and the behaviour form: slice 2.
- Lineage: studio.parentId and parentName; crumbs under the bar, each
  ancestor a click; Twist Again starts a child from the current canon.
- Files: ext/text-generator/studio-core.js (pure), studio.js (the pane),
  main.js (studioDeps, the characters page wiring). The manifest and every
  visible title say Creations AI; the folder and the ids rename in slice 5.

Gates run: 18 core tests and 9 pane tests (a stubbed model streams the
sheet in two chunks; canon, Twist, locks, reroll and undo, a legacy
character, Twist Again, crumbs), and the design greps (no hex in the Studio
stylesheet, Title Case labels, no native select, no em dashes). Not yet
run: the hidden probe against the live app, and Mufaro's look. Both are
owed before slice 1 is called done.

## Slice 2: Roleplay (built 2026-09-20)

Already built underneath: the Text Generator was a port of ai-character-chat
(threads, forks, lorebooks with trigger scoring, rolling memories, scene
state, slash commands, a consolidated system prompt with a token budget).
Nothing about how it prompts changed. What this slice did to its screens:

- Every native dialog is gone from the extension: the five confirm() calls
  in the chat (delete a chat, regenerate past a point, twice) and the
  behaviour form (discard changes) are workbench warning messages with a
  named action, like the two in the character rail before them.
- The two `#388a34` fallbacks (the audit's green primaries) are gone; the
  accent token stands alone.
- Home is the charter's Home: four launchers (New Character, New Roleplay,
  New Story, New Table) and three recents (chats, characters, stories),
  each row opening its tab. The sidebar navigates: Home, Characters,
  Stories, Tables, Settings, then the chats list.
- Settings gained Words Kept Per Source and lost its one emoji warning.
- Not done in this slice: relabelling the chat's own buttons and the
  behaviour form to Title Case, and the chat's stylesheet still uses the
  legacy `--parallx-*` variables with px fallbacks (not hex). That is the
  remaining checklist residue, and it is visible only inside a chat.

## Slice 3: Story Writer (built 2026-09-20)

story-core.js (pure, 7 tests) and story.js (the page, 5 rendered tests
with a stubbed model). A rail of stories; the open one is a column: the
bar (title, status, Export As Markdown, New Chapter), the Brief (premise
with Roll A Table beside it, genre, setting, style, Point Of View, Tense,
Beat Length, Cast picked from the roster, the Author's Note the writer
sees every beat, the model and context picks), the Story Memory
(editable, Update Memory by hand, refreshed on its own every four beats),
then chapters with beats edited in place, each with Rewrite (with a
direction) and Undo and Delete, and the composer at the end: a direction
and Continue. A beat streams into the chapter as it is written; Stop
keeps what has arrived. Cast members carry their portrait, voice and
drives from the Studio sheet, clipped. Everything autosaves to
`.parallx/extensions/text-generator/stories/<id>.json`. Export writes the
story as Markdown, a heading per chapter, through the same save dialog
characters use. Saving straight to a canvas page is deferred: the canvas
exposes page reading to extensions but not page creation with content.

## Slice 4: Tables (built 2026-09-20)

tables-core.js (pure, 13 tests): the Perchance list grammar, local.
Lists and indented items, `[references]`, weights (`^3`), inline choices
(`{a|b^2}`), ranges (`{1-20}`, decimals kept), the dynamic article
(`{a}`/`{A}` resolved after the next word: "an owl", "a unicorn", "an
hour"), nested items that pick through their children, `.titleCase`,
`.upperCase`, `.lowerCase`, `.sentenceCase`, `.pluralForm`,
`.singularForm`, `.selectOne`, `.selectMany(n)`, `.selectUnique(n)`,
`.selectAll`, `.joinItems(sep)`, variables (`[x = name]`, printed as on
Perchance), escapes, whole-line comments, and `alias = {import:file}`
resolving other tables through a loader. Unknown references stay as
text and are reported; a self-referring list stops at depth 100. A
single-item list spends no random number. JavaScript inside brackets is
not supported. tables.js (4 rendered tests): a rail of `.txt` tables
under `.parallx/extensions/text-generator/tables`, the source in a
monospace editor (Tab indents) with parse errors under it, Roll with a
count and a list to roll from, results with Copy and Reroll, autosave,
New Table from a shipped starter. `attachTableRoll` is the Roll A Table
control beside the Studio's concept and the story's premise: pick a
table, one roll lands in the field.

## Slice 5: The rename (built 2026-09-20)

`ext/text-generator` is `ext/creations-ai`; the manifest id is
`parallx-community.creations-ai`, and its name and every command, view
and editor title say Creations AI. The packaging script is
`scripts/package-creations-ai.mjs`. Kept on purpose: the editor type ids
and command ids (`text-generator-*`, `textGenerator.*`), because the
workbench persists open tabs by type id and keybindings by command id,
and the workspace data folder `.parallx/extensions/text-generator`,
because every character, thread, lorebook and setting a user has is in
there. Both are invisible; the reasons sit at the constant.

## The review pass (2026-09-20, after the build)

Read back against the running app rather than the tests, three defects
that no stub could show:

- **Multi-file extensions did not load.** Tools under `ext/` are loaded
  through a blob URL, and a blob URL cannot resolve `import './studio.js'`;
  the whole extension would have failed at activation. The loader now
  reads every relative import an external tool names, gives each file a
  blob URL of its own (recursively, deduplicated, cycles refused) and
  rewrites the specifiers before importing the entry
  (src/tools/toolModuleLoader.ts, tests/unit/toolModuleLoaderImports.test.ts).
  Any extension can now be more than one file. The renderer was rebuilt.
- **`showInputBox` takes `placeholder`, not `placeHolder`.** Two call
  sites fixed (Add File in the Studio, New Table).
- **A delete could be undone by an autosave.** Deleting the open character,
  story or table from its rail disposed the pane, and a pane with an edit
  still pending saved on dispose, writing the file back. Each pane now has
  `abandon()`, and every rail calls it before deleting.

Also found: saved dials were marked as set but never put back on the
controls when a character was reopened; they are now.

**One door to the web (Mufaro, 2026-09-20).** The Studio's Add Link had
called the egress bridge directly and read the page with its own code,
which skipped the chat's sanitizer (hidden text a page plants for a
model), its per-turn cap and its history. That was a second, less curated
way for the app to reach the web. Now Web Research exposes its whole
fetch pipeline as the command `webResearch.fetchReadable`, the Studio
calls that and nothing else, and its own page reader is deleted. Without
Web Research, Add Link says so and does nothing. The rule for the future:
an extension never touches `parallxElectron.webFetch` itself.

## Gates, whole program

Unit suite: 405 files, 6414 tests green after the rename, of which
Creations AI adds 56 (18 Studio core, 9 Studio pane, 7 Story core, 5
Story pane, 13 Tables core, 4 Tables pane). Static gates on every new
file: every `--px-*` token used exists in px-tokens.css; no hex; every
icon name is in the registry; no em dashes in UI strings; no native
select; Title Case labels. Not run: the hidden probe against the live
app, and Mufaro's look at each surface. Those two are what "done" still
waits on.

## Out of scope

Image generation. Voice. Community sharing. Perchance's custom code in
generators (JavaScript inside brackets): Tables supports the list
grammar only.
