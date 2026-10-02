# Persistent agents: proposal (2026-10-02)

Agents today are temporary AI calls. The goal: persistent agents dedicated to
specific tasks, each with a prompt you can read and change, its own tools and
memory, able to hand work to each other, and watchable.

## What the app does today

**Defining an agent.** AI Settings › Agent has agent cards ("Chat", "Workspace",
"Canvas", + Add Agent). A card edits three things: model, temperature, and a
"system prompt overlay".
- The model override is resolved but not used; the session model wins.
- The name can't be edited. A new agent is invoked as `@parallx.chat.agent.custom-<timestamp>`,
  an id the UI never shows, and only appears after a reload.
- Edits to the Workspace and Canvas cards have no effect.
- The Chat card's overlay silently applies to every background turn (heartbeat,
  routines, workflows, helpers).
- Tools, identity, step limits exist in the stored type but have no UI.

**The prompt.** You can see the overlay. The full prompt is only visible as "View
System Prompt" in chat, which shows the last prompt sent by anything (a
background run can overwrite it). Workspace files (SOUL.md, USER.md, AGENTS.md,
rules) shape every agent alike. The heartbeat's seed prompt is hard-coded.

**Agents working together.** Only `sessions_spawn`: a chat turn hands one task to
an anonymous helper and gets its final answer back. Off by default, one level
deep, can't target a named agent, the model parameter is dropped. No messages
between agents, no handoff. Workflow agent steps don't pass output to later
steps; workflows can't trigger each other.

**Watching.** Nothing is live. Helper transcripts are archived but no screen
links to them. The Agents run tab works only on "delegated tasks", which no
production feature creates (test mode only, and they never call a model).

**Memory.** Nothing is keyed to an agent. Workspace memory, the Mind and chat
sessions are shared by everything.

## What leading apps do

Products surveyed: Claude Code subagents, OpenAI Agents SDK, Copilot Studio,
CrewAI, LangGraph, Google ADK and A2A, Lindy, Relevance AI, Gumloop, Zapier
Agents, n8n, Notion custom agents, Letta.

- **An agent is a small, legible object**: name, a description of when to use it,
  instructions you can always see and edit, model, tools with per-tool
  permission (auto / ask / deny), what it may read or write, memory, triggers,
  limits, where results go. Claude Code keeps each one as a markdown file with
  frontmatter, so it is diffable and versioned. Notion gives each agent its own
  permissions "like a teammate".
- **Describe-it builders** (Notion, Gumloop) write the instructions for you, then
  show them, never hide them. Test runs before going live.
- **Collaboration that works**: one agent asks another as a tool, passing a
  brief; the other runs in a fresh context with its own prompt and returns a
  result. Work is a task object with a lifecycle (queued, working, needs
  approval, done, failed). Only some agents may delegate; depth is capped.
  Group chats and swarms are where loops, cost (about 15x tokens) and
  conflicting decisions come from. Research on 1,600 multi-agent traces puts
  most failures on vague roles and unclear stopping, not on the model.
- **What non-developers actually watch**: a run list with status and a one-line
  summary, a "needs you" inbox, approval drafts, and a readable transcript where
  "A asked B" shows as a nested, expandable conversation. Span trees are
  developer-only.

## Proposal

### 1. An Agent is a file you can read

`.parallx/agents/<name>.md`: frontmatter plus the instructions as the body.

```
---
name: Inbox Keeper
description: Sorts new notes into the right folders and links related pages. Use for anything about filing or tidying.
icon: tray
model: default            # or a specific local or cloud model
tools:                    # from the tool registry
  read_page: auto
  move_page: ask
  delete_page: deny
scope: [Inbox, Projects]  # pages and folders it may touch
memory: true              # keeps its own notes page
maxSteps: 12
delegatesTo: [Researcher]
results: inbox            # inbox | page | notification
---
You keep my Inbox tidy. Every morning ...
```

- An **Agent editor** tab shows all of this as a form, the instructions as an
  editor, the **full compiled prompt** (read-only preview), and **Test Run**.
- **New Agent…** starts from a template, or from "describe what it should do",
  which drafts the file for you to read and change.
- **Starters**: Chat (the one you talk to), Heartbeat (the reviewer; its
  HEARTBEAT.md watches become its instructions), Researcher, Writer, Inbox
  Keeper. The AI Settings agent cards move here; their broken parts go.
- Files mean history, diffing, and sharing between workspaces for free.

### 2. Routines assign an agent

A routine = trigger + agent + task (+ where results go). Triggers: schedule,
workspace event, heartbeat finding, manual, or another agent's task finishing.
- New Routine gets "Who does it". The visual workflow's agent step picks an
  agent instead of carrying a loose prompt, so the step editor becomes the way
  to chain agents: Researcher → Writer → notify.
- The heartbeat becomes an agent with a routine ("every 30 minutes"), not a
  special case.

### 3. Agents hand work to each other

- A tool, `ask_agent(agent, brief)`, creates a **Task**: from, to, brief, status,
  result, parent run. The other agent runs fresh with its own prompt, tools and
  permissions, and returns a result.
- Only agents with `delegatesTo` may delegate, only to those agents, and depth
  is capped at 2. Each agent's own permissions apply; approvals land in Needs
  you as usual.
- This replaces the anonymous helper (`sessions_spawn` becomes "ask a general
  agent"). No group chat.

### 4. You can watch

- **Agents tab "Team"**: each agent with its status (idle, working on …,
  waiting for you), last run, and its routines. Opening one shows its file,
  memory and runs.
- **Live run view** (what the run tab was meant to be): the transcript streams
  as the agent works; a delegated task appears as a nested conversation you can
  open while it runs; approvals inline; Stop and Steer.
- **History** rows open the full transcript, delegations nested inside.

### 5. Memory per agent

Each agent may keep a notes page it reads at the start of a run and appends to
at the end, readable and editable like any page. The workspace Mind stays as
the shared picture of you, shown on the Team tab.

### Agents sidebar, after

Now · Team · Routines · History. (Mind moves into Team: the shared picture, plus
each agent's own notes.)

## Phases

1. **Agent files**: the file format, loader, editor tab with prompt preview and
   Test Run, Team tab, migrate AI Settings agent cards; Chat and background
   turns run as a named agent (fixes the overlay leaking into every run).
2. **Routines pick agents**: New Routine and workflow agent steps reference an
   agent; the heartbeat becomes an agent with a routine.
3. **Hand-offs**: `ask_agent`, Task objects, the live run view with nested
   delegations, History links to transcripts.
4. **Agent memory**: per-agent notes pages.

**Deferred**: group chat or swarms, cross-app protocols (A2A), parallel fan-out
(slow and costly on local models), automatic memory consolidation, evals.

Next step: mockups of the Team tab, the Agent editor, a live run with a nested
hand-off, and a routine with "Who does it", in the Parallx Motion canvas.
