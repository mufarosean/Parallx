# Agentic Harness Research

**Date:** 2026-09-28
**Status:** Research only. No code was changed. Nothing is scheduled to be built before the exam on 2026-10-27.
**Asked by:** Mufaro
**Question:** What would it take for Parallx to have permanent agents that work together, and are the security gates in the way?

---

## 1. Why This Research

- The automation system feels unpolished and peripheral. It has never been used in real work.
- The leading edge of AI software is deploying agents that persist and interact with each other.
- Paperclip was the reference: a harness of agents that hold stand-up meetings and hand work to each other.
- Proposal on the table: stop asking the user to approve actions one by one. Move to permission modes (Manual, Edit, Plan, Auto), where Auto never asks.

## 2. Verdict

1. **Do not rewrite the engine.** The part that runs an agent turn is sound.
2. **The missing part is the layer above the engine:** agents as things that exist, a shared place where they exchange work, and one way to schedule them.
3. **The security gates do block unattended agents.** In chat they barely matter; in scheduled work they stop the job.
4. **The four-mode proposal is the right replacement** for the three overlapping dials that exist today.
5. **Auto mode is workable if it keeps boundaries instead of prompts,** and if each agent only has the tools its role needs.

## 3. What Paperclip Is

Source: its public pages. The video was not seen.

Paperclip does not supply a better agent engine. It accepts existing agents and adds an organization on top of them.

| Feature | What it means |
|---|---|
| Named agents with roles | Each agent has a job, arranged in an org chart |
| Shared board | Work is assigned, checked out, handed off and reported in one place |
| Heartbeats | Each agent wakes on a schedule or when assigned or mentioned, checks its work, and acts |
| Budgets | A monthly limit per agent. At the limit, it stops |
| Governance | A human approves the large decisions |
| Bring your own agent | Any agent that can receive a wake-up can be hired |

A stand-up is a scheduled round in which each agent posts to a shared thread.

## 4. What Parallx Has Today

| Piece | State | Detail |
|---|---|---|
| Agent engine | Present | Runs a turn inside a chat session, with retry and compaction |
| Named agents | Plumbing only | A definition exists (name, model, tools, identity, instructions), but only three are hardcoded: Chat, Workspace, Canvas. No way to create, edit or save one |
| Handing off work | One-shot | A parent turn can spawn a helper, which returns text and ends. Depth limit 3, at most 5 at once |
| Agent-to-agent messaging | Missing | No inbox, queue or thread between agents |
| Shared board | Missing | |
| Schedules | Present, in three systems | Scheduled jobs, workflows, heartbeat |
| Memory per agent | Not connected | A memory service exists but is not tied to an agent identity |
| Budget per agent | Missing | Per-turn limits only (iterations, tokens) |
| Traffic control for the model | Missing | Requests are serialized per session only. Different sessions can run at the same time |
| Record of unattended runs | Present | Autonomy Log, with full transcripts that reopen read-only |

### The three unattended systems

| System | What triggers it | What it runs |
|---|---|---|
| Scheduled jobs | A time or interval | One turn in a throwaway session, result posted as a chat card |
| Workflows | Schedule, manual, or event | A graph of steps run in sequence, at most 3 agent turns per run |
| Heartbeat | Interval, system event, wake | A review turn, plus a rules engine that raises findings as tasks or notifications |

## 5. Why Automations Feel Peripheral

- Three separate features do overlapping jobs.
- Each fires an anonymous, one-off run. No agent owns the work or remembers the last run.
- Results land as a card or a log entry, not as progress on something.
- Any step that needs to change a file or run code is refused when nobody is watching (section 6).

## 6. Security Gates Today

### In chat

Since the consent model (Milestone 90), a chat request counts as consent. Everything runs without asking except two tools: running a shell command and deleting a file.

### Unattended

When a heartbeat, helper, or workflow tool step calls a tool that needs approval:

- If autonomy is set to manual, the call is blocked and logged.
- If autonomy is at the top level, the call is approved.
- Otherwise the call is **rejected immediately** and a note is added to the Autonomy Log for later review. The run does not wait and does not retry.

This is the behavior that prevents permanent agents from doing real work.

### Overlapping controls

| Control | Values | Applies to |
|---|---|---|
| Approval strictness | strict, balanced, streamlined | All sessions |
| Autonomy level | manual, allow read-only, allow safe actions, allow policy actions | Unattended runs only |
| Careful Mode | on, off | One window |
| Chat mode picker | Edit, Agent | Chat |
| Tool enablement | per tool, two layers | All sessions |

There is no Plan mode and no read-only mode for chat.

### Protections that are not prompts

These already exist and would continue to apply in any mode:

| Protection | What it does |
|---|---|
| Workspace boundary | File tools cannot touch paths outside the workspace |
| Read before edit | A file cannot be edited in a session that has not read it |
| Checkpoints and rewind | Every file write, edit or delete by the AI is snapshotted first. The last 50 can be restored |
| Command block list | A short list of destructive commands is refused outright |
| Iteration and token limits | Default 25 iterations per turn, plus a token budget |

### What is not protected

- **Code and shell are not sandboxed.** A script runs as an ordinary process with the user's own permissions and open network access. The Python settings screen states this.
- **Rewind covers file tools only.** It does not cover what a script or command does.
- **The old web protection is gone.** The rule that forced approval for a write after reading web content was removed in Milestone 90.

## 7. Proposed Permission Modes

One switch, set per agent and per chat, replacing approval strictness, autonomy level and Careful Mode.

| Mode | Reads | File edits | Commands and code | Outward or irreversible actions |
|---|---|---|---|---|
| Manual | Run | Ask | Ask | Ask |
| Edit | Run | Run | Ask | Ask |
| Plan | Run | Refused | Refused | Refused |
| Auto | Run | Run | Run | Approval queue |

Notes:

- In an unattended run, "Ask" cannot mean a prompt. It has to mean the approval queue.
- Claude's own auto mode is not free of checks. A second model reviews each action in the background. On one local GPU that would double the cost of each step, so it is not recommended here.

## 8. Risks Of Auto And The Recommended Answer

| Risk | Why it matters | Answer |
|---|---|---|
| A script deletes or damages files | Not covered by rewind, not sandboxed | Give code and shell only to agents whose role needs them |
| A web page steers the agent | Local models are easier to manipulate than Claude | An agent that reads the web does not also get code or shell |
| Actions that leave the machine | Cannot be undone | Approval queue, cleared when convenient |
| Runaway cost or time | An agent loops | Budget per agent; at the limit it stops |

The principle: **permission by role and by boundary, not by prompt.** A researcher agent has the web but no shell. A builder agent has the shell but no web.

## 9. Hardware Constraint

- One GPU means agents take turns. A stand-up of five agents is five runs in sequence.
- Each switch between agents changes the start of the prompt, so the local model re-reads its instructions before answering.
- Nothing today stops two sessions from calling the model at once. A single queue is needed before many agents run.
- The Claude cloud provider could take one or two roles to ease this.

## 10. Recommended Build Order

Not started. For after the exam.

| Step | What | Why this order |
|---|---|---|
| 1 | One permission switch with the four modes | Smallest piece. Unblocks unattended work |
| 2 | Agents that can be created and saved: name, role, instructions, model, tools, mode, schedule, budget | Makes an agent a thing that exists |
| 3 | The board, and the stand-up as a scheduled round on a shared thread | Gives agents a place to exchange work |
| 4 | One queue for the model, plus budgets per agent | Needed once several agents run |
| 5 | Fold scheduled jobs, workflows and heartbeat into agents | A schedule becomes a property of an agent |

## 11. Open Questions

1. Do agents belong to a workspace or to the whole app?
2. Which roles run on the local model and which on Claude?
3. Is the Planner the right home for the board? Its code has not been checked for this.
4. What counts as outward or irreversible? Candidates: email, browser actions that submit forms, anything that spends money.
5. Does Auto apply to ordinary chat as well, or only to agents?
6. What happens to existing workflows and scheduled jobs: migrate them, or keep them working as they are?
7. What is the unit of a budget on a local model: tokens, minutes, or runs?
8. What does a stand-up produce, and how often?

## 12. Evidence And Confidence

| Finding | How it was established |
|---|---|
| Three hardcoded agents | Read directly |
| Helper depth and concurrency limits | Read directly |
| Workflow limit of 3 agent turns per run | Read directly |
| Unattended calls rejected and logged | Read directly, for heartbeat, helper and workflow tool steps |
| Two tools always ask in chat | Read directly |
| Command block list | Read directly |
| Checkpoint limit of 50 | Read directly |
| Code is not sandboxed | Read directly, from the comment in the Python settings panel |
| Autonomy levels and approval strictness exist | Read directly |
| No queue across the model provider | Survey report, not confirmed directly |
| Memory service not tied to agents | Survey report, not confirmed directly |
| How scheduled job turns are gated | Survey report, not traced directly |
| Paperclip features | Its public pages, not the video |
| Planner as the board | A proposal, not checked against the code |

The survey was two read-only passes over the source by helper agents, followed by direct checks of the main findings.

## 13. Code Reference

| Area | File |
|---|---|
| Turn loop | `src/openclaw/openclawTurnRunner.ts`, `src/openclaw/openclawAttempt.ts` |
| Session serialization | `src/services/chatService.ts` |
| Agent definitions | `src/openclaw/agents/openclawAgentConfig.ts`, `openclawAgentRegistry.ts` |
| Helpers | `src/openclaw/openclawSubagentSpawn.ts`, `openclawSubagentExecutor.ts` |
| Scheduled jobs | `src/openclaw/openclawCronService.ts`, `openclawCronExecutor.ts` |
| Workflows | `src/services/workflows/workflowTypes.ts`, `workflowRunner.ts` |
| Workflow editor | `src/built-in/autonomy-log/workflowEditorPane.ts` |
| Heartbeat | `src/openclaw/openclawHeartbeatRunner.ts`, `openclawHeartbeatExecutor.ts`, `heartbeatTriggers.ts` |
| Activity Journal | `src/services/activityJournalService.ts` |
| Permission decisions | `src/services/policyDecisionPoint.ts` |
| Permission service | `src/services/permissionService.ts` |
| Tool colors | `src/openclaw/openclawToolPolicy.ts` |
| Autonomy levels | `src/agent/agentTypes.ts` |
| Approval strictness | `src/aiSettings/unifiedConfigTypes.ts` |
| Chat mode picker | `src/built-in/chat/pickers/chatModePicker.ts` |
| Workspace boundary | `src/services/workspaceBoundaryService.ts` |
| Checkpoints | `src/services/fileCheckpointService.ts` |
| Rewind command | `src/openclaw/commands/openclawRewindCommand.ts` |
| Tool enablement | `src/services/languageModelToolsService.ts`, `src/tools/toolEnablementService.ts` |
| Python settings note | `src/built-in/settings/pythonSettingsPanel.ts` |

### Where a mode parameter would go

- `PolicyDecisionPoint.decide()`
- `PermissionService.getSessionInitiator()`
- `PermissionService.confirmToolInvocation()`
- `ALWAYS_REQUIRE_CONFIRMATION` in `permissionService.ts`
- The strictness branch in `PermissionService.checkPermission()`

## 14. Related Documents

- `docs/HARNESS.md`
- `docs/Parallx_Milestone_90.md` (consent model)
- `docs/Parallx_Milestone_91.md` (unattended run transcripts)
- `docs/Parallx_Milestone_93.md` (automations)
- `docs/Parallx_Milestone_87.md` (heartbeat triggers)
- `docs/HEARTBEAT_AWARENESS_REDESIGN.md`
- `docs/WORKFLOWS.md`, `docs/WORKFLOWS_BRIEF.md`
- `docs/Parallx_Activity_Journal.md`

## 15. Sources

- Paperclip on GitHub: https://github.com/paperclipai/paperclip
- Paperclip, the control plane for AI agents: https://paperclipai.net/
- Ry Walker Research, Paperclip: https://rywalker.com/research/paperclip
- Zeabur, Run a Zero-Human Company with AI Agent Teams: https://zeabur.com/blogs/deploy-paperclip-ai-agent-orchestration
