# Motion, AI edits and Agents (built 2026-10-02)

One build push from the "Parallx Motion" mockups. Calm is the base: short,
ease-out, no bounce, everything lands at once with reduced motion or in an
unseen window. The aim is that moving between parts of the app feels like one
app, and that work the AI does on its own is visible and steerable.

## M1: areas move, they don't pop

- `src/workbench/partMotion.ts`: `animatePartIn` / `animatePartOut` / `tween`.
  The sidebar slides in and out; the panel and the right sidebar slide in when
  shown (hiding stays synchronous, callers read visibility right after); the
  panel glides to maximized and back.
- Classes: `.part-animating`, `.part-collapsed--left/right/bottom`
  (`src/workbench.css`).
- Edit-mode Accept in Chat now applies the page edit (`canvas.applyEditProposal`).

## M2: one spine for tool steps and approvals

- `src/built-in/chat/rendering/chatApproval.ts`: `buildApprovalNode` /
  `settleApprovalNode`. An approval is a node on the same spine as every tool
  step: what it wants to do, a preview, then Allow, Allow For This Chat, Reject
  (Always Allow is a quiet link). Escape inside it rejects; it never takes focus.
- `foldToolRuns` (chatListRenderer.ts): finished runs of two or more steps fold
  into "Used N tools".

## M3: model and context in one chip

- `src/built-in/chat/widgets/chatEngineChip.ts`: the chip shows a usage ring and
  "model · 16K"; its popover holds the model list, a "How much it remembers"
  slider with a plain-language hint, and this chat's usage with Details….

## M4: AI edits stream in, then you keep or undo

- When Chat's page tools write to an open page (`markAiEdit` in canvas main.ts),
  `_animateExternalDoc` streams the change in with margin marks
  (`plugins/aiEditMarks.ts`, keyed by block id): green added, blue rewritten
  (tooltip shows the old text), red struck through for a moment before removal.
- A pill reads "Chat is editing this page", then grows into "Chat changed N
  blocks" with Undo / Keep. Undo puts the old blocks back as an ordinary saved
  edit; Ctrl+Z does the same while the page is still as Chat left it.
- `classifySpan` (canvasDocDiff.ts) pairs old and new blocks: by content, then
  by id, then by shared words within the same type, so a markdown rewrite with
  fresh ids reads as rewrites, not churn.
- The page's tab shows a breathing dot while the AI writes
  (`EditorInput.setAiWriting`, `.ui-tab-ai`).

## M5: Agents get their own space

- `src/built-in/agents/`: a right-sidebar container under Chat
  (`AGENTS_MANIFEST`, icon `px-automations`). Sections by urgency: Needs you
  (Allow / Allow This Task / Reject), Running now (step, progress, Watch,
  Pause / Continue), Coming up (routines and the heartbeat), Done today. The
  header switch is the global pause (`FLAG_PAUSED_GLOBAL`).
- `agentsModel.ts` turns the services' state into the four sections (pure,
  tested); `agentsServices.ts` resolves the services lazily and answers
  approvals the way Chat's task cards do.
- Chat's header buttons hide when another right-sidebar container is showing;
  Chat: Show brings Chat back to the front.

## M6: agents are visible from anywhere

- `agentsPresence.ts`: a status bar entry (what the agent is doing, what needs
  your OK, or that agents are paused), a count on the Agents icon (a dot while
  one runs; view badges now reach right-sidebar icons), and a toast for each new
  approval with Allow / Reject / Open Agents when the Agents view isn't in front.
- `agentsRun.ts`: Watch opens a run tab with the plan as a timeline, what it
  touched, and a note box. A note pauses the task after its current step, joins
  its constraints (`redirectTask` only accepts a paused task) and the task
  replans and carries on.
- `agentsRoutine.ts`: New Routine (+ in Agents, or Agents: New Routine…): name,
  what to do, days and time, the page it writes into, the next three runs, Try It
  Once Now. Saved as a cron job. The mockup's "ask me first" choice is not built:
  scheduled jobs have no per-job approval policy to back it.

## One home for autonomy (Autonomy Log folded into Agents)

The Autonomy Log panel kept the same things as Agents in a second place, so
it is gone: everything autonomous lives in Agents, in four tabs.

- **Now**: what needs you (approvals and heartbeat findings with Do It / Tell
  Me More / Dismiss), running now, coming up (routines, workflows, the
  heartbeat), done today.
- **Routines** (`agentsRoutines.ts`): the heartbeat (Wake Now, Turn On) and the
  scheduled-routines switch; routines the AI suggested (Add / Review / Dismiss);
  your routines, workflows and scheduled jobs alike (Run Now, Edit, Turn Off,
  Open As Workflow, Delete; click one for its last run); New Routine, a blank
  workflow, or a template.
- **History** (`agentsHistory.ts`): every background run in one stream (the
  old Live and History modes), filtered by All / Heartbeat / Routines /
  Helpers; unread marks, failures, the model, View Full Run, Mark All Read,
  Clear. Reads delivered results from the log and run records from the task
  rail when it exists (`readRunRows`).
- **Mind** (`agentsMind.ts`): the meters in words, beliefs you can forget (or
  all of them), habits it noticed, and what it may do without asking (the
  old Patterns tab, with Revoke).

The workflow editor moved with it (`agents/workflowEditorPane.ts`). Command
ids are kept: `workflows.showPanel` opens Routines, `autonomyLog.markAllRead`
and `autonomyLog.clear` act on History; `agents.showRoutines` and
`agents.showHistory` are new.

## M7: continuity in the everyday pieces

- Tabs grow in when opened and shrink shut when closed (`tabBar.ts` diffs ids;
  `.ui-tab--entering` / `.ui-tab--leaving` in px-motion.css).
- A moving selection slides from row to row in the command palette and the
  explorer (`src/ui/glide.ts`, `glideHighlight`).
- A folder's rows unfold top to bottom when it opens (`.tree-node--unfold`).
- A dismissed toast closes its slot so the stack settles instead of jumping
  (`.parallx-notification--draining`).

## Checks

- Unit tests: `canvasAiEditClassify`, `agentsModel`, `agentsPresenceRoutine`.
- In-app probes (hidden Electron window, motion forced on): tab enter and leave
  classes appear and clear, palette and explorer glides appear and clear, the
  folder unfolds, toasts drain; AI edit marks, Keep, Ctrl+Z undo and the saved
  result; Agents sections, pause switch, status bar, badge, toast, run tab and
  New Routine; light mode for the Agents view and the edit review.
- Not covered live: a real model driving an agent task end to end (the test app
  has no model), so approvals and running tasks were seeded through the
  services.
