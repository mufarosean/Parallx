# Parallx OpenClaw Interaction Improvements

**Status:** Improvement slice 1 implemented and focused verification passed, deeper parity follow-ups tracked  
**Date:** 2026-03-25  
**Purpose:** Record the OpenClaw-source-backed interaction improvements that should guide Parallx toward a more legible, more agentic, and less mode-confused AI experience.

---

## 1. Upstream Evidence

Relevant OpenClaw source evidence used for this slice:

- `openclaw/src/agents/pi-embedded-runner/run/attempt.ts`
  - runtime owns tool availability, tool execution, transcript repair, and session orchestration.
- `openclaw/src/agents/system-prompt.ts`
  - prompt guidance is explicit that first-class tools should be used directly and that completion/long-running work is session-aware.
- `openclaw/src/agents/pi-tools.before-tool-call.ts`
  - loop control and pre-tool policy are runtime behavior, not a user-facing wakefulness toggle.
- `openclaw/src/agents/tools/sessions-spawn-tool.ts`
  - autonomy is modeled as session/runtime breadth with explicit `run` vs `session` semantics.
- `openclaw/src/agents/tools/session-status-tool.ts`
  - status is a first-class visible surface, not something the user has to infer from vibes.
- `openclaw/docs/tools/subagents.md`
  - subagents exist to extend work, isolate tasks, and auto-report completion rather than to change whether the AI is “awake.”

The recurring shape is consistent: OpenClaw treats wakefulness as a property of the runtime, while modes and session choices shape authority, continuity, and approvals.

---

## 2. Current Parallx Gap

Parallx already has:

- read-only multi-step tool use in Ask mode,
- approval-aware action handling in Agent mode,
- a task/approval rail,
- runtime-owned autonomy mirroring in the live OpenClaw lane.

But the product language still teaches a weaker model:

- Ask reads like “not really agentic yet,”
- Agent reads like “AI is finally awake,”
- the mode picker hides too much state,
- the empty state and prompt copy over-index on mode labels instead of authority differences.

That mismatch makes the product feel less coherent than the runtime actually is.

---

## 3. Five Real Improvements

### Improvement 1. Modes should gate authority, not wakefulness

Parallx should stop teaching that Ask is passive and Agent is alive. The upstream OpenClaw model is closer to:

- runtime is always active,
- read-only evidence gathering is normal,
- action-taking surfaces add approval and policy implications.

**Implementation status in this slice:** implemented in prompt and UI copy.

### Improvement 2. The UI should visibly explain the current runtime posture

Users need a concise, always-visible explanation of what changes across modes.

Target language:

- Ask: awake, read-first, evidence-gathering, no side effects.
- Agent: awake, action-capable, approval-aware.

**Implementation status in this slice:** implemented in the mode picker, empty state, and task rail messaging.

### Improvement 3. Tool and skill picking should be framed as first-class contracts

OpenClaw’s prompt contract is explicit: when a first-class tool exists, use it directly. Parallx should be equally explicit about:

- using tools instead of narrating manual steps,
- following relevant workflow skills instead of improvising a weaker plan,
- treating skill matches as concrete routing hints rather than decorative catalog text.

**Implementation status in this slice:** implemented in the shared prompt copy for claw and OpenClaw lanes.

### Improvement 4. Skills should become file-first and user-visible

Current Parallx gap:

- built-in workflow skills are hardcoded string constants,
- users cannot inspect or edit them as first-class files,
- this diverges from the Claude Code / OpenClaw-adjacent file-first operating model the repo research already captured.

Target:

- bundled skills should materialize as editable `SKILL.md` files,
- same-name workspace skills should override without hidden magic,
- the user should be able to inspect what the AI is matching against.

**Implementation status in this slice:** documented gap only; code migration still pending.

### Improvement 5. Session/status surfaces should become more explicit

OpenClaw exposes session status, spawned sessions, and control surfaces directly. Parallx already has the beginnings of this in the task rail, but it still lacks a concise “what is the AI doing right now?” explanation that maps cleanly onto runtime state.

Target:

- surface current runtime posture,
- expose whether the run is reading, waiting on approval, or actioning,
- keep the explanation consistent with approval/task services.

**Implementation status in this slice:** partial messaging improvement only; deeper runtime status surfacing remains pending.

---

## 4. Local Files Touched By Slice 1

- `src/built-in/chat/pickers/chatModePicker.ts`
- `src/built-in/chat/input/chatInput.css`
- `src/built-in/chat/widgets/chatWidget.ts`
- `src/built-in/chat/rendering/chatTaskCards.ts`
- `src/built-in/chat/config/chatSystemPrompts.ts`
- `src/openclaw/participants/openclawContextReport.ts`
- focused tests under `tests/unit/`

This slice intentionally changes language, affordances, and prompt contracts without widening into a behavior rewrite.

---

## 5. Verification

Focused verification completed for this slice:

- `npx vitest run tests/unit/chatSystemPrompts.test.ts tests/unit/openclawDefaultParticipant.test.ts`
  - `67/67` tests passed.
- `npm run build:renderer`
  - passed.

Broader AI eval reruns remain optional until the next deeper behavioral slice lands.

---

## 6. Next Recommended Slice

The next OpenClaw-backed improvement should be the file-first skill migration.

That is the clearest remaining gap affecting tool/skill selection quality, traceability, and the user’s sense that Parallx is running a real inspectable agent system rather than a hidden prompt bundle.