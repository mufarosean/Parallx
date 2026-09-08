# Skill Authoring Brief — skills that write themselves

Written 2026-09-05 from the GitHub landscape review
(docs/research/GitHub_Landscape_2026-09.md). Mufaro: *we do need a
self-authoring for skills system.* Prior art: Hermes Agent (MIT) closes
the loop where an agent writes skills from experience and refines them in
use; microsoft/skill-recorder (MIT) turns one recorded session into a
generalised skill through a two-phase propose-then-submit flow.

Status: brief only. Post-polish (docs/POLISH.md).

---

## What exists (verified 2026-09-05)

| Need | Already in-tree |
| --- | --- |
| Skill storage and hot reload | `SkillLoaderService` scans `.parallx/skills/*/SKILL.md`, parses frontmatter, watches for changes so a new folder appears live |
| Skill vocabulary | `kind: tool | workflow`, `disableModelInvocation`, `userInvocable`, typed parameters, bundled `scripts/`, `references/`, `assets/` (agentskills.io alignment, M81 Phase 6) |
| Default skills | Twelve written by `/init` from src/built-in/chat/skills/defaultSkillContents.ts (deep-research, scoped-extraction, folder-overview, document-comparison, exhaustive-summary, git-status, fetch-url, pdf-extract, explain-selection, summarize-selection, research-topic, quiz) |
| Prompt budget | Skills section with OpenClaw parity limits (150 skills, 18,000 chars, compact fallback) in openclawSkillState.ts |
| The agent can already write files | fs tools reach the workspace, so a SKILL.md can technically be written today. Nothing prompts it, nothing gates it, nothing measures it |
| A conscience | mind/capabilityMeter (the agent's share of work) and mind/skillProbe (the human's unaided fluency, held-out occasionally). Both headers say do-it capability should not grow until these measure independently |

What is missing is the loop: a reason to draft, a place for drafts, an
approval, and a record of whether the skill worked.

---

## What the repos teach

**Hermes Agent.** After a complex task the agent writes a skill; on later
use it edits the skill when the procedure drifts. Skills follow the
agentskills.io standard Parallx already speaks. Adopt the closed loop.
Skip the seven execution backends and the messaging gateway.

**skill-recorder.** Not Playwright and not a driver. It records one
session (Electron desktop capturer for frames, Win32 foreground-window
calls through a foreign-function bridge, the browser URL from the Windows
UI Automation tree, on-device Whisper for narration, Tesseract plus
secretlint to scrub frames) and then reconstructs intent and ordered
steps. The builder's rules are the part to copy verbatim
(electron/skillbuilder/instructions.ts in their repo):

- Two phases, never skipped: `propose_plan` shows the generalisation,
  the fixed values and the steps; the user edits in natural language;
  `submit_skill` writes SKILL.md only after approval.
- Generalise from one example: three rows recorded means "every row".
- Fixed values become `{{id}}` tokens the user edits in one place.
- Steps are `calculation` (no side effect) or `action` (changes the
  world); actions are the risky surface and stay explicit.
- Native tools before UI replay. Searching a service is a tool call, not
  simulated clicks.
- The description is the trigger: it carries every "when to use" cue.

**Ars contexta.** Fresh context per pipeline phase. A skill draft is
written by a turn that has only the evidence, not the whole session.

---

## The model

**Inside the app, the recording already exists.** The activity journal is
a semantic recording of what the user did (opened, edited, ran), with
actor and origin, without OCR or frames. A skill drafted from a Parallx
session starts from the journal slice and the session's tool calls, which
is better evidence than skill-recorder gets from pixels.

**Three doors into a draft.**

1. *Reflection.* After a turn that used many tool calls and succeeded,
   and whose mission resembles an earlier session (memory_search over
   summaries), the agent proposes a skill. The threshold is a setting.
2. *The user asks.* "Remember how to do this" or `/skill from this turn`.
3. *A recording* (later). CLIPS capture plus window and clipboard
   collectors and Whisper narration, for work done outside Parallx.
   Same drafts folder, same review.

**Drafts are quarantined.** `.parallx/skills/_drafts/<name>/SKILL.md`.
The loader ignores `_drafts`, so a draft is never callable. Frontmatter
carries `source: agent`, `derivedFrom: <session id>`, and the
skill-recorder shape: description as trigger, `values` as `{{tokens}}`,
steps tagged calculation or action, `allowedTools` narrowed to what the
steps need.

**Review is the same three verbs as suggested workflows.** In the Tool
Gallery's skills section: Review opens the draft in the editor, Add moves
the folder out of `_drafts` (the watcher registers it live), Dismiss
deletes it. Agent-authored skills keep a visible provenance marker after
Add (the custom-block brief's D3: you should always see that a thing was
model-written).

**Use is measured.** Every invocation of a skill appends an outcome line
(succeeded, failed, user edited the result within N minutes) to
`.parallx/skills/<name>/runs.jsonl`. After a run of failures the agent
proposes an edit as a draft diff, reviewed the same way. The agent never
edits an installed skill directly.

**The conscience gate becomes live.** Skills the agent authored for
things the human used to do by hand are exactly the do-it capability
capabilityMeter and skillProbe were built to watch. The skills section
shows the meter's readout next to agent-authored skills. If the human's
unaided fluency on a held-out task falls, the skill is flagged, not
silently kept.

---

## Decisions (Mufaro's)

**K1 — Drafts folder or database?** Recommendation: folder. Skills are
files; drafts are files the loader ignores.

**K2 — Reflection threshold.** Recommendation: a setting, default eight
tool calls and one prior similar session; off for autonomous turns
(workflows and heartbeat never draft skills about themselves).

**K3 — May the agent edit its own installed skills?** Recommendation:
no. Edits are drafts.

**K4 — Recorder scope.** Recommendation: journal-derived drafts first;
OS collectors later, opt-in, with the same scrub-before-analyse rule
skill-recorder uses.

**K5 — Do agent-authored skills appear in the slash menu?**
Recommendation: yes after Add, marked.

---

## Execution order (each step ships alone)

1. `_drafts` quarantine in the loader, the `skill_draft` tool, and the
   frontmatter shape. A draft the user writes by hand goes through the
   same door.
2. The review section in the Tool Gallery with Review, Add, Dismiss and
   the provenance marker. Probe-captured.
3. The reflection trigger and the `/skill from this turn` command.
4. Outcome logging and the refine-as-draft proposal.
5. The conscience readout beside agent-authored skills.
6. The recorder door (see docs/WORKBENCH_DRIVER_BRIEF.md for collectors).

## Non-goals and risks

- No marketplace, no sharing, no auto-enable.
- No skill that drives other applications; that is the driver brief.
- Risk: draft spam. The threshold, the once-per-mission dedupe and the
  attention budget bound it; Dismiss remembers.
- Risk: a local model writes a confident, wrong procedure. The
  calculation/action split and the narrowed `allowedTools` bound the
  damage; the outcome log surfaces it; the conscience readout keeps the
  human's hand visible.
