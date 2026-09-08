# Workbench Driver Brief — the AI runs Parallx like a human would

Written 2026-09-05 from the GitHub landscape review
(docs/research/GitHub_Landscape_2026-09.md). Mufaro: *I have a vision of
the AI being able to run everything in Parallx, like a human would.* The
prompt was microsoft/skill-recorder, which turned out to record and never
drive. This brief is the driving half; the recording half lives in
docs/SKILL_AUTHORING_BRIEF.md.

Status: brief only. Post-polish (docs/POLISH.md).

---

## What skill-recorder actually is (read from source 2026-09-05)

Not Playwright. An Electron app that only observes:

- Frames from Electron's own desktop capturer, extracted and correlated
  to events.
- The active window through direct Win32 calls via a foreign-function
  bridge (koffi).
- The browser's URL from the Windows UI Automation tree, read by a
  persistent PowerShell host so the assemblies load once.
- Narration transcribed on-device with Whisper; frames OCR'd with
  Tesseract and scrubbed with secretlint before anything is analysed.
- Intent and steps reconstructed by the Copilot SDK; a skill builder
  that prefers native tools over replaying clicks.

That last rule is the design centre of this brief. CLI-Anything (49k
stars) makes the same argument from the other side: software becomes
agent-native through a structured interface over its real backend, with
`--json` output and a self-describing SKILL.md, not through a camera
pointed at its UI.

---

## What exists (verified 2026-09-05)

| Need | Already in-tree |
| --- | --- |
| The app describes itself | `introspectionService`: tools, commands, keybindings with source, settings, services, the 22 live context keys, the serialised layout tree. Served to the model as `app__describe` |
| The model can act through commands | `app__find_commands`, `app__run_command` over the one command bus. Origin is stamped; initiator is not (habitDetector excludes commands for exactly this reason) |
| Typed hands | The Tool SDK: canvas, planner, flashcards, memory, workflow tools |
| One dispatcher, one dropdown | The keybinding architecture and `api.ui.createDropdown` mean there is one hook for keys and one for choices |
| Semantic recording | The activity journal: what happened, by whom, from where |
| Consent | M90 initiator-based permissions, the destructive class, the kill switch |
| Screenshots in-process | The hidden Electron probe pattern uses `webContents.capturePage` against the real bundle (tests/probes/ui-screenshot-probe.mjs) |
| Driving in tests | tests/ai-eval: Playwright drives the Electron app through the same DOM affordances a user touches, with real Ollama inference and rubric scoring (three canvas scenarios today) |
| Screen capture | CLIPS: a transparent framing window plus ffmpeg gdigrab (electron/main.cjs, "Screen Recorder") |
| The conscience | mind/capabilityMeter and mind/skillProbe, whose headers say do-it capability should not grow until they measure independently |
| Accessibility hooks | About 52 role and aria attributes across src/ui and src/parts: a thin layer |

The app can already describe itself and run its own commands. It cannot
say what is on screen right now in a form a model can act on, and it
cannot touch a surface that has no command.

---

## The model: three rungs

### Rung 1 — the semantic driver (build first)

Two tools.

`workbench_observe` returns a compact tree of the workbench as it is:
parts and their visibility, the active editor group's tabs and which is
active, the focused view and its selection, any open dialog, popup or
dropdown with its options, the form fields of the focused surface with
their labels and values, and the commands relevant to the focus with
their when-clause truth. Built on introspectionService and the layout
tree plus one new contract: every view, part and editor pane implements
`describe()`, the way every tool already meets the Tool SDK membership
contract. A surface that cannot describe itself is listed as opaque.

`workbench_act` takes typed operations: focus a view, open an editor,
run a command, type into a labelled field, choose an option in a
dropdown, press a labelled button, send a key chord through the
dispatcher, scroll a named scroller. Each operation routes through the
same seams a user's gesture does, journals with actor `ai`, and passes
through consent with an initiator. Nothing is a raw DOM click.

This rung is cheap for local models (text in, text out), deterministic,
and testable in tests/ai-eval without a display.

### Rung 2 — the visual driver (the eyes)

No external driver is needed. Electron can screenshot its own window
(`webContents.capturePage`, which the probe already does) and inject
pointer and keyboard events at coordinates
(`webContents.sendInputEvent`). Two more tools:

`workbench_screenshot` returns the window downscaled to a fixed logical
size with the scale factor, so coordinates are stable on a 3440 by 1440
display. `workbench_pointer` clicks, drags, scrolls or types at
coordinates in that space.

Claude's computer-use tool contract (screenshot, then actions at
coordinates) maps onto these directly. Use them for surfaces without
semantic hooks (Univer worksheets, the PDF canvas, embedded engines) and
to verify that a rung-1 action produced what a human would see. Gate by
model tier (openclawModelTier): small local models are poor at
coordinates, and a screenshot per step is expensive.

### Rung 3 — beyond the window (deferred, opt-in)

Other applications through the UI Automation tree and input injection
(koffi FFI or nut.js), with skill-recorder's collectors for recording.
A much larger consent surface; not needed for "everything in Parallx".
Not in this brief's execution order.

---

## Recording, briefly

Inside Parallx the journal is already the recording: semantic events
with actor and origin, no OCR, no frames. A skill drafted from a session
starts there (docs/SKILL_AUTHORING_BRIEF.md). Outside Parallx, CLIPS
capture plus window and clipboard collectors and Whisper narration is
the skill-recorder path, later and opt-in.

---

## Safety, stated once

- Every act carries an initiator; automatic firings never borrow user
  consent (the workflow slices already fixed this seam once).
- The destructive class prompts; the kill switch stops the loop.
- Native tools first. If a tool or command exists, the driver uses it;
  pointer actions are the fallback, and the trace says so.
- The conscience gate goes live here. The driver ships with the
  capabilityMeter readout visible: when the agent's share of work rises
  and the human's unaided fluency falls, that is shown, not hidden.

---

## Decisions (Mufaro's)

**W1 — Rung 1 before rung 2?** Recommendation: yes. Text-level driving
is what local models can do today and what the eval harness can score.

**W2 — `describe()` as a membership contract.** Recommendation: yes, in
the Tool SDK doc, with opaque as the honest default.

**W3 — Initiator on command execution.** Recommendation: do it first; it
unblocks command habits in the Mind as well.

**W4 — Visual rung gated by model tier.** Recommendation: yes; cloud and
large local models only, per-workspace opt-in like the cloud provider.

**W5 — Rung 3.** Recommendation: deferred; revisit after the recorder
door in the skills brief ships.

---

## Execution order (each step ships alone)

1. Initiator on command execution; habitDetector admits commands.
2. `describe()` on parts, views and editor panes; `workbench_observe`.
3. `workbench_act` over existing seams, journaled and gated.
4. Driver scenarios in tests/ai-eval ("open the planner and add a task
   for Friday", "mark this quiz page").
5. `workbench_screenshot` and `workbench_pointer` behind the tier gate.
6. The conscience readout beside the driver's settings.

## Non-goals and risks

- No driving other applications in v1.
- No replacement of typed tools by clicking. The driver fills gaps.
- Risk: the model loops on a surface it cannot read. Opaque is a
  first-class answer and the loop-safety guard (chatToolLoopSafety)
  already bounds iterations.
- Risk: deskilling. The meter is the answer, and it is why the driver
  does not ship without it.
