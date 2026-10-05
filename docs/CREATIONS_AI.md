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
Reroll (the Rewrite icon) opens a small box under the row: an optional
direction for this rewrite ("more detail on the war years", "warmer").
Enter rewrites (Shift+Enter is a new line), Escape closes it. Empty, it
is a fresh take as before; with a direction, the direction leads and may
make the field longer. What comes back is saved like any edit, and Undo
brings the old text back.
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
- Reroll takes an optional direction, the same box Story Writer's beats
  use, so a rewrite can be steered instead of rolled again and again.
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
an extension never invokes Web Research's bridge channels (`webFetch:*`,
`webSearch:*`) itself.

## Roleplay memory (built 2026-09-20)

Mufaro: the summariser fired too early, lost the setting (a parking garage
became a driveway), and its memory was held in the background where he
could neither see nor fix it. Summarising every turn is the weakest memory
there is: each rewrite starts from the last rewrite's blind spots, and the
model fills the gaps with plausible defaults.

What replaced it (ext/creations-ai/chat-memory.js, pure, tested):

- **One memory file per thread, `memories.md`, the user's to edit.** Facts
  (grouped: relationships, traits, events, places, preferences, other),
  Timeline (one line per beat, oldest first) and Notes. The Memory button
  on the chat toolbar opens it in the editor. The file is the source of
  truth: a line removed by hand stays removed; a line added is read on the
  next turn. The extractor that already ran every ten exchanges (now six)
  merges what it finds into the file and never overwrites a line; the two
  JSON logs it wrote stay as logs. A thread on the old shape is folded into
  the file the first time it is read.
- **When memory is written** (fixed 2026-10-04: it had stopped writing).
  After every sixth story reply (out-of-character and hidden ones do not
  count), the extractor reads what came since its last run plus a little
  before, at most 24 messages, and merges new Facts and Timeline beats into
  the file. How many replies the memory covers is kept on the thread, so
  the count survives closing the chat; it used to start over on every
  visit, so a chat read a few replies at a time never reached six. The
  model's reply is read however it is wrapped (prose, a code fence, a
  thinking block, or cut off by the token limit, in which case the complete
  items are kept); a reply with no JSON is logged, retried at the next
  reply once, then skipped. Update Now in the Memory panel runs it at once
  and says what it added. Notes are the user's: nothing writes them.
- **Facts and Notes go into every prompt.** The scene panel (Now) is pinned
  as before.
- **No summariser.** When turns drop out of the live window, the prompt
  gets the Timeline's tail and the dropped turns that bear on what is being
  said now, quoted word for word with their turn numbers, ranked by shared
  terms (BM25 over the thread in memory: names, places and objects said now
  pull the turns that said them). No model call, no rewrite, no index file
  anywhere, so nothing can leak into the workspace index. Vectors can be
  added when the platform exposes embeddings to extensions.
- **The rule against inventing**, in the block: a detail of the setting,
  of an object, of who is where or of what happened that is not in the
  scene, the memory or the quoted turns is left unsaid or asked about.
- The fit-method label says what it does: "Keep the memory file and quote
  earlier turns (recommended)".

Not built: proposals shown as a kept/changed/added diff before they land
(the file itself is the review for now), and a consistency check on a
reply against Facts. Both are next if the file alone is not enough.

## Redesign (built 2026-10-02)

Mockup: the Claude Design canvas "Creations Redesign"
(https://claude.ai/artifact/CQ1iYpSNpb5ptJu3iZXuSg), after the owner asked
for it calmer: colour on portraits only. The aim was a surface that feels
usable and alive without getting loud.

- **Portraits.** A character has no picture: their initials on a quiet tone
  of a hue taken from their name (`portrait.js`, Tier 3 `--px-portrait-*`
  tokens, a light pair for light mode). The hue shows on the portrait and
  nowhere else; cards, bubbles and panels stay neutral, and the accent marks
  the one main action. Clicking the Studio portrait picks another hue (saved
  as `hue` on the character; From The Name clears it).
- **Home.** "Who do you want to meet?" with a concept line, Surprise Me and
  two Try chips; Make Character opens the Studio and writes the sheet at
  once. A roll from one of your tables (Use As A Concept, Copy, roll again),
  four quick-start cards, the newest chat (its last line) and story to pick
  up, and your cast as cards. The tab is titled Creations.
- **Characters.** A gallery of cards (portrait, tagline, chat count, Chat,
  a ⋯ menu with Open, Start A Chat, Duplicate, Export As Markdown…,
  Delete…), search, and Characters | Lorebooks. Opening a card fills the page
  with the Studio; a back link returns. The rail and "Nothing open" are gone.
- **Studio.** A header with the portrait, the name and the tagline; the sheet
  rows are cards; Try A Line sits beside the sheet as a short exchange. While
  the sheet streams in, rows still to come shimmer, the next one says
  Writing, each that lands glows briefly, and the status counts "Writing 3
  of 11" over a thin progress bar.
- **Chat.** A header with who you are talking to and the message count; a Now
  line when the scene has a place, time or mood (click to edit it). Character
  messages in a neutral bubble beside their portrait, yours in the accent on
  the right; message actions float in a bar on hover; the composer is a card
  and its turn buttons are chips. The brain button opens a Memory panel
  beside the chat (Facts, Timeline, Notes from `memories.md`, Open
  memories.md); a pinned message lands in Facts.
- **Story Writer.** The chapters read as a manuscript; the Brief and Story
  Memory sit beside it (above it under 760 px). The composer asks "What
  happens next?" with four direction chips (Raise The Stakes, A Quiet
  Moment, Plot Twist, Time Skip) that fill the line. Cast chips carry
  portraits.
- **Tables.** The editor and the roll side by side; a larger Roll; results as
  numbered cards, the newest glowing; Earlier rolls under them. The page
  opens the first table instead of an empty pane.
- **Settings.** The kit page header (Creations Settings) and a Feel section,
  saved on change: Show writing as it arrives (off adds `.cr-still` and stops
  every animation; reduced motion stops them too) and Roll a table on Home.

Departures from the mockup, on purpose:
- No word goal on the Story Writer, and no genre filter chips in the gallery:
  stories have no goal and characters carry no genres. Search stands in.
- The chat's chips are its existing turn buttons (who speaks next) and the
  character's own shortcut buttons; the mockup's sample shortcuts were
  invented.
- Tables keep the 1 / 5 / 10 / 20 dropdown and their file names.
- The Memory panel hides under 760 px; the brain button still toggles it.
- The rest of the Settings form (budgets, defaults) is unchanged.

Probe: `node tests/probes/creations-redesign-probe.mjs <outDir>` seeds
characters, a chat, a story, a table and a lorebook, then shoots every
surface in dark, light and a narrow pane.

## Characters that are not alone (built 2026-10-05)

Mufaro, after a week of use: the generator gives one good character from
one seed and nothing to choose between; the dice randomise the body and
leave the motive blank; in a chat the world has a bartender and a sister
but the model cannot voice them without being told, and when it is told it
speaks for them as if they had a seat; characters state their values
("peace", "solitude") instead of showing them, so he retypes "how people
talk" into every chat; and a card is static, so a character married on the
card and divorced in the chat is either, turn by turn. Six changes, each
its own commit and tests:

- **The card is the start, the memory is the present.** The Cast and
  Conversation Memories sections say which wins when they differ. Growth is
  per chat (`memories.md`); the card stays the base for every other story.
  The Timeline's last twenty lines ride with the memory in every prompt;
  they used to reach the model under one fit method only.
- **Dialogue rules.** A Settings field, shipped with a default (people talk
  about what is in front of them, never name their own values, no abstract
  nouns as subjects, humour from the scene), Reset To Default, empty means
  none. In every roleplay prompt as "## How People Talk" and in the Story
  Writer's beat prompt. Not prescriptive about voice: the Voice field stays
  description.
- **Supporting cast.** `thread.supportingCast`: a character from the roster
  (its card read fresh each prompt) or a person typed as "Name: who they
  are, how they talk". One line each under "## Supporting Cast"; whoever is
  writing the turn may give them a line or two inside it; they never get a
  turn, a stop token or a chip. The Turn Contract names that one exception.
  Chat Settings: From Roster, Someone New. The chat head reads "Ada · with
  Dana".
- **Pitches before the sheet.** Pitch Ideas asks for four different takes on
  the concept (name, tagline, hook, contradiction, a line) as cards; Write
  This One writes the sheet from the one picked, naming the character after
  it unless a name was typed. Generate still writes straight from the
  concept. `studio.pitch` keeps the one chosen.
- **Example dialogue from the sheet.** The three situations come from this
  character's drives, secret and relationships, not a template; one shows
  what they care about by what they do, never by naming it; no abstract
  nouns in their mouth; humour from something specific.
- **Character Seeds.** `tables/character-seeds.txt` ships once (the
  `characterSeedsShipped` flag means a deleted file stays deleted) and is
  the user's to edit: concept, occupation, quirk, contradiction, setting,
  place, want, fear, secret. Surprise Me and the Try chips roll `concept`
  (the fixed lines stand in without the table); Roll The Dice fills Want,
  Fear and Secret, each lockable.
- **Make one of their people.** The Relationships row has a fourth action:
  pick a "Name: note" line and open the Studio on that person, named, with
  the line as the concept in relation to this character. Added to a chat as
  supporting cast, the leads have someone to talk to.

Not done, on purpose: growth across chats (the card is the base for every
story), a Wildness control, direction chips (the reroll box takes a typed
direction), rules in the Voice field.

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
