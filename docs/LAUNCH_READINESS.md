# Launch Readiness: What Has to Be True So Parallx Doesn't Fail on Day One

This review is written as if Parallx were going to market next quarter against Obsidian, Notion and Logseq. The run report (RUN_REPORT.md) covers what was fixed overnight. This document covers what a fix to the UI alone can't settle.

## 1. Who It's For

Parallx is not yet a general notes app, and pretending otherwise is the fastest way to lose. The code says what it is good at: Canvas pages, flashcards that pace new cards to an exam date, Worksheets that import practice exams, Concept Lab explorables, and an AI that runs on the user's own machine.

**Primary audience: people studying for something hard, privately.** This means professional-exam candidates (actuarial, CFA, bar, medical boards), graduate students and serious self-learners. They want notes, spaced repetition, practice problems and an AI tutor in one place. They don't want to upload their material to someone else's server.

**Secondary audience: privacy-minded knowledge workers.** These users want a local-first workspace with an AI that can read their files without sending them anywhere. The private browser and the egress-controlled web research are real differentiators for them.

**Not the audience (yet):** teams, people who want to publish, and anyone choosing a tool for its plugin ecosystem. Obsidian wins those users outright.

**One-line pitch:** *Your study desk, private by default. Notes, flashcards, practice and an AI tutor that runs on your computer.*

## 2. Positioning Against the Field

| | Obsidian | Notion | Parallx |
|---|---|---|---|
| Where your data lives | Plain Markdown files | Their cloud | Local SQLite plus your files |
| AI | Community plugins | Cloud, paid add-on | Built in. Local (Ollama) or Claude, per workspace |
| Study tools | Plugins of varying quality | None | Flashcards with exam pacing, Worksheets, Concept Lab |
| Editor | Markdown | Blocks | Blocks (Canvas) |
| Extensibility | Huge community | Integrations | Extension API with a UI kit and a style ratchet |

The wedge is the combination: local AI plus study tools in one coherent app. No single feature is the wedge on its own.

## 3. What Would Make Us Fail Immediately (and the Fix)

Ranked by how quickly each one would lose a new user.

### 3.1 The first five minutes don't explain the product
A new user lands in an IDE-shaped window: activity bar, Explorer and a Welcome tab. Every built-in is on, and the built-ins include Worksheets, Planner and Dashboard alongside Canvas and Chat. The overnight work hid the bottom panel by default and made activity icons hideable (right-click). Even so, nothing on screen says what this app is *for*.
**Fix:** a first-run screen that asks one question: "What are you here to do? Study / Write and think / Just look around." It turns on the matching tools and opens a sample workspace with a Canvas page, a deck and a worksheet already in it.

### 3.2 Opt-in tools carry personal defaults
I checked this rather than assume it. Extensions under `ext/` (Budget, Creations AI, Media Organizer, Concept Lab, Flashcards, Browser, Web Research, Workspace Graph) are **off by default**; the user turns them on in Manage Tools. That is the right shape. Two things still leak:
- Budget's Gmail filter defaults to `from:chase.com`, a single bank. A stranger who turns Budget on gets an empty ledger and no idea why.
- **Flashcards, the core of the study pitch, is off by default** while Worksheets is on.

**Fix (decision D1 for you):** decide the default set around the audience in section 1; I recommend Flashcards on. Change Budget's default filter to empty and ask on first sync.

### 3.3 AI is the headline, and it is dead without setup
Without Ollama running, chat used to spin forever. It now says so after 6 seconds and offers Open AI Settings, where Claude can be turned on with a key. That is the minimum.
**Fix:** make provider choice part of first run ("Run AI on this computer: Install Ollama" / "Use Claude: paste a key" / "Skip for now"), with an honest note on what leaves the machine. The AI settings page already has the right copy for this.

### 3.4 "Are my notes mine?"
This is the first question every Obsidian user will ask. Canvas pages live in SQLite. Export as Markdown exists per page, but there is no export of the whole workspace and no statement anywhere in the UI about where data lives.
**Fix:** add "Export Workspace as Markdown" (pages with their folder tree, attachments alongside). Add one sentence on the Welcome page: "Everything stays in this folder on your computer."

### 3.5 Platforms
The app crashed on start on Linux and macOS (Windows-only `setAppDetails` and `.ico`). That is fixed on this branch.
**Fix:** run a cross-platform pass for remaining Windows assumptions (paths, shell, the Anki and Python bridges), then sign and notarize. An unsigned app on macOS is a dead app.

### 3.6 Trust surfaces for an agent that acts
There is an autonomy agent, a heartbeat, web research and browser automation. They are well guarded in code, but the user sees three separate logs (Activity, Autonomy and Indexing).
**Fix:** one "What AI did" view with a single kill switch, linked from the status bar. Users forgive an agent they can watch.

### 3.7 Version and identity
The UI shows the API version (v0.2.0) where users expect the app version (package.json says 0.1.0).
**Fix (decision for you):** pick one source of truth for the version shown in Help and About.

## 4. Making It Feel Good

The reference point is the calm of Claude's own surfaces and of Linear: few colours, one type scale, generous space, and one obvious next action per screen. The overnight work put the foundations in:
- one button ladder and one type scale;
- no shouting caps;
- AA contrast in both modes;
- menus as one system;
- a kit that keeps extensions in line.

What is left is restraint, which code can't enforce:

- **One primary action per screen.** The kit's page header enforces it for new surfaces; older extension headers should move onto it as they are touched.
- **One home per thing.** Flashcards and Planner each show their tabs both in the sidebar and in the editor (decision D5). Pick the editor and let the sidebar list content, not navigation.
- **Status belongs in the status bar.** Chat's model and connection state should live there, not in the chat header.
- **Motion and sound sparingly.** A study app earns delight at the moment of a correct answer, a finished session or a streak. Spend it there, not on chrome.
- **Empty states that teach.** Every empty view should say what goes there and offer the one action that fills it. Worksheets and Dashboard now do. Use `api.ui.createEmptyState` everywhere else.

## 5. Ship List

Must-have before a public beta:
1. First-run flow (purpose, then tools, then AI provider) and a sample workspace.
2. Default tool set chosen for the audience (D1); Budget's personal filter removed.
3. Export Workspace as Markdown, and a "your data stays here" statement.
4. macOS signing and notarization; the cross-platform pass.
5. One "What AI did" view with a kill switch.
6. One version number.

Should-have:
- Status-bar AI state.
- D5 (one home for the Flashcards and Planner tabs).
- Remaining extension headers moved onto the kit.

Nice-to-have:
- A public theme gallery built on the existing palettes.
- Anki import already works (Flashcards: Import Cards), but only its tooltip says "Anki". For people switching over, it is the on-ramp: say it on the empty state ("Coming from Anki? Import your decks").
