# Parallx AI User Guide

Parallx AI is the assistant built into Parallx. It can answer questions about
your workspace, help you edit content, and in Agent mode it can take
multi-step actions with your approval.

This guide is written for people who may be new to AI entirely. It explains:

- what the AI is
- what it can and cannot do
- how to get started safely
- what the three chat modes mean
- what tools and skills are
- where to see what the AI has access to
- how to tell whether the AI is doing the right thing

Parallx is designed so the AI works with your workspace, not as a black box.

---

## Table of Contents

1. [What Parallx AI Is](#1-what-parallx-ai-is)
2. [AI Basics for New Users](#2-ai-basics-for-new-users)
3. [Before You Start](#3-before-you-start)
4. [Your First Five Minutes](#4-your-first-five-minutes)
5. [The Three Chat Modes](#5-the-three-chat-modes)
6. [What the AI Can Do by Mode](#6-what-the-ai-can-do-by-mode)
7. [Tools](#7-tools)
8. [Skills](#8-skills)
9. [Context, Mentions, and Attachments](#9-context-mentions-and-attachments)
10. [AI Settings](#10-ai-settings)
11. [Memory and Workspace Files](#11-memory-and-workspace-files)
12. [Approvals, Safety, and Privacy](#12-approvals-safety-and-privacy)
13. [How to Check What the AI Is Seeing](#13-how-to-check-what-the-ai-is-seeing)
14. [Recommended Ways to Use Parallx AI](#14-recommended-ways-to-use-parallx-ai)
15. [Examples You Can Try](#15-examples-you-can-try)
16. [Troubleshooting](#16-troubleshooting)
17. [FAQ](#17-faq)

---

## 1. What Parallx AI Is

Parallx AI is a workspace-aware assistant built into Parallx.

That means it is not only a text chatbot. It can work with:

- your files
- your notes and pages
- your workspace structure
- your AI settings
- approved tools and commands

In practical terms, Parallx AI can help in three different ways:

| Mode | Plain-English meaning |
|------|------------------------|
| Ask | "Answer my question" |
| Edit | "Propose changes for me to review" |
| Agent | "Do the work step by step, with approvals where needed" |

The important idea is this:

**Parallx AI is most useful when it is grounded in your workspace.**

If you ask general questions, it behaves like a general assistant. If you ask
about your workspace, it tries to use your actual files, notes, and context
instead of making things up.

---

## 2. AI Basics for New Users

If you are new to AI, start here.

### What an AI assistant is good at

AI is good at:

- summarizing
- explaining
- rewriting
- comparing documents
- finding patterns
- drafting text
- answering questions from available context
- helping you navigate a large workspace

### What an AI assistant is not good at

AI is not automatically truthful just because it sounds confident.

It can:

- misunderstand your question
- rely on incomplete context
- answer too broadly when you wanted precision
- miss a file if you did not clearly scope the request
- state something confidently that needs verification

### The safest way to use AI

Use this pattern:

1. Start with a clear request.
2. Give the AI the right context.
3. Ask for sources or citations when accuracy matters.
4. Review edits before accepting them.
5. Approve actions intentionally in Agent mode.

### A simple mental model

Think of Parallx AI as a fast junior collaborator that can read a lot quickly,
but still needs:

- good instructions
- access to the right material
- review for important work

---

## 3. Before You Start

Parallx AI depends on a local language model provider.

### Prerequisites

1. Install Ollama.
2. Make sure the Ollama service is running.
3. Pull at least one model.
4. Open the workspace you want Parallx AI to work with.

Example model pull:

```bash
ollama pull qwen2.5:32b-instruct
```

If Ollama is not running, Parallx should show setup guidance instead of simply
failing silently.

### Why opening the right workspace matters

Parallx AI only helps well when it knows what workspace it is operating in.

If you open the wrong folder, the AI may:

- search the wrong files
- miss relevant notes
- cite the wrong source set
- appear less accurate than it really is

---

## 4. Your First Five Minutes

If you want the shortest path to success, do this.

### Step 1: Open the chat panel

Open the chat panel from the chat UI in the workbench.

### Step 2: Confirm a model is selected

Use the model picker in the chat header to select the model you want.

### Step 3: Wait for workspace readiness

When you first open a workspace, Parallx may need a short time to index and
prepare retrieval. If you ask a workspace-specific question immediately,
results may be weaker until the workspace is ready.

### Step 4: Start in Ask mode

If you are new, begin with Ask mode. It is the safest mode because it is meant
for question answering and should not perform side effects.

### Step 5: Try a simple grounded question

Good first prompts:

- "What is this workspace about?"
- "Summarize the main folders in this workspace."
- "What files should I read first to understand this project?"
- "Explain this note in simpler language."

### Step 6: Ask for evidence when accuracy matters

Examples:

- "Answer using only the attached files."
- "Cite the file names you used."
- "If you are not sure, say so."
- "Tell me which file each point came from."

---

## 5. The Three Chat Modes

Parallx AI has three explicit modes. They are not just labels. They define what
the AI is allowed to do.

## Ask Mode

Ask mode is for question answering.

Use Ask mode when you want the AI to:

- explain something
- summarize documents
- compare notes
- answer questions about your workspace
- help you think through a problem

Ask mode is the best default for most users.

Important expectation:

- Ask mode is read-oriented.
- It should not be your "go edit everything" mode.

## Edit Mode

Edit mode is for proposing changes that you review before accepting.

Use Edit mode when you want the AI to:

- rewrite a page
- reorganize text
- improve clarity
- fix wording
- draft structured content into an existing canvas page or note

Important expectation:

- Edit mode is about proposed changes.
- You review the diff and decide whether to accept it.

## Agent Mode

Agent mode is for multi-step work.

Use Agent mode when you want the AI to:

- inspect multiple files
- search and then act on results
- write files after gathering evidence
- run terminal commands with approval
- carry out a longer chain of steps on your behalf

Important expectation:

- Agent mode is the most powerful mode.
- It is also the mode that needs the most oversight.

---

## 6. What the AI Can Do by Mode

This is the simplest capability map.

| Capability | Ask | Edit | Agent |
|------------|-----|------|-------|
| Answer questions | Yes | Yes | Yes |
| Summarize files and notes | Yes | Yes | Yes |
| Use workspace context | Yes | Yes | Yes |
| Propose text changes | Limited | Yes | Yes |
| Show a diff before writing | Not typical | Yes | Yes |
| Chain multiple actions | No | Limited | Yes |
| Use tools for autonomous work | No | Limited | Yes |
| Run commands | No | No | Yes, with approval |
| Write or edit files | No direct autonomy | Proposed edits | Yes, with approval gates |

### Best use of each mode

| If you want to... | Best mode |
|-------------------|-----------|
| learn | Ask |
| verify | Ask |
| rewrite | Edit |
| produce content you will review | Edit |
| automate a process | Agent |
| investigate a complex workspace issue | Agent |

### A practical rule

If you are unsure which mode to use:

- start with Ask
- move to Edit if you want changes proposed
- move to Agent only when you want the AI to carry out a sequence of actions

---

## 7. Tools

Tools are the actions Parallx AI can use to interact with your workspace.

Without tools, an AI can only generate text.

With tools, it can do things like:

- read a file
- search across files
- list files in a folder
- read a page
- create a page
- write or edit a file
- run a command

### Why tools matter

Tools are what make Parallx AI useful as a workspace assistant instead of just a
generic chatbot.

### Where users can see available tools

Parallx exposes tool visibility in several places:

1. **Tool Gallery**
  A dedicated installed-tools browser for seeing the tools that are available.

2. **AI Settings -> Tools**
  A tool tree where you can review and toggle tool availability.

3. **Chat tool picker**
  A per-conversation surface for enabling or disabling tools for the current
  work.

4. **OpenClaw `/context` commands**
  Advanced transparency commands such as `/context list`, `/context detail`,
  and `/context json` can show the current runtime context and tool footprint.

### Built-in tools

Examples of built-in tool categories include:

- file tools
- page tools
- search tools
- knowledge search tools
- write/edit/delete tools
- command execution tools

Not every tool is equally powerful. Some are read-only. Some can change things.

### Permission levels

Parallx uses permission tiers so the AI does not silently do everything.

Typical categories are:

- always allowed
- requires approval
- never allowed

As a user, the key point is:

**Reading is usually easier to allow than writing, deleting, or command
execution.**

### Tool control advice for beginners

If you are new, keep these enabled first:

- read tools
- search tools
- listing tools

Only enable broader action tools when you actually want the AI to take action.

---

## 8. Skills

Skills are packaged instructions or capabilities that teach the AI how to do a
particular kind of work.

You can think of a skill as a reusable playbook.

### What a skill is not

A skill is not the same thing as a model.

- A **model** is the engine that generates responses.
- A **tool** is an action the AI can perform.
- A **skill** is a structured guide or capability package that helps the AI use
  those tools or follow a defined workflow.

### Types of skills in Parallx

Parallx currently has two broad skill shapes:

1. **Built-in workflow skills**
  These ship with Parallx.

2. **Workspace skills**
  These live inside your workspace and can be customized per project.

### Where workspace skill files live

Workspace skills live here:

```text
.parallx/skills/<skill-name>/SKILL.md
```

Example:

```text
.parallx/skills/release-checklist/SKILL.md
```

### Where built-in skills live

Built-in workflow skills are bundled with Parallx itself. They are not exposed
as ordinary editable files in the same way workspace skills are.

For most users, the important distinction is:

- workspace skills are yours to inspect and customize
- built-in skills are product-provided behaviors

### Why skills are useful

Skills help the AI behave more consistently for recurring work.

Examples:

- a release workflow
- a code review workflow
- a note-formatting workflow
- a project-specific writing style

### When you should care about skills

If you only want to chat casually, you may never need to think about skills.

If you want Parallx AI to become more tailored to your workspace or your team,
skills become much more important.

---

## 9. Context, Mentions, and Attachments

AI quality depends heavily on context.

### What context means

Context is the information the model can see for the current turn.

That can include:

- your message
- attached files
- explicitly mentioned files or folders
- retrieved workspace snippets
- conversation history
- workspace prompt files such as `SOUL.md`, `AGENTS.md`, and `TOOLS.md`

### Why the same question can get different answers

If you ask the same question with different context, you can get different
answers.

For example:

- no file attached -> broad answer
- exact file attached -> grounded answer
- whole folder attached -> broader grounded answer

### @mentions

Parallx supports context mentions such as:

- `@file:...`
- `@folder:...`
- `@workspace`
- `@terminal`

Use them when you want to be explicit about what the AI should consider.

### Attachments and context pills

Attached context appears visibly in the chat UI. This is useful because you can
see what the AI is working from and remove context you did not intend to send.

### Best practice for accurate answers

When accuracy matters, do one or more of these:

1. attach the exact file
2. mention the exact folder
3. ask for citations
4. tell the AI to answer only from provided context

---

## 10. AI Settings

AI Settings control how Parallx AI behaves.

This is where you adjust things like:

- persona
- response style
- suggestions
- model behavior
- enabled tools

### Important idea

AI Settings change how the AI behaves.

They do **not** replace the workspace files that define project context and
memory.

### Major settings areas

#### Persona

Controls the assistant identity, description, and avatar.

#### Chat behavior

Controls things like:

- response length
- communication style
- domain focus
- system prompt override behavior

#### Suggestions

Controls proactive suggestion behavior.

#### Model

Controls things like:

- temperature
- token limits
- context window assumptions

#### Tools

Lets you review and manage tool availability.

### Beginner advice for settings

If you are new, do not change everything at once.

Start by adjusting only:

- response length
- tone
- enabled tools

Then test a few prompts and see whether the behavior improves.

---

## 11. Memory and Workspace Files

Parallx AI is not only driven by the current chat turn. It can also be shaped by
workspace files and memory files.

### Important workspace-level prompt files

These files are especially important:

- `SOUL.md`
- `AGENTS.md`
- `TOOLS.md`

### What they do

| File | Purpose |
|------|---------|
| `SOUL.md` | Identity, tone, boundaries, personality |
| `AGENTS.md` | Project context, conventions, instructions |
| `TOOLS.md` | Notes and guidance about tools and local conventions |

### Workspace memory files

Parallx uses file-backed memory inspired by the OpenClaw model.

Canonical memory files live under:

```text
.parallx/memory/
```

Typical files include:

- `.parallx/memory/MEMORY.md`
- `.parallx/memory/YYYY-MM-DD.md`

### Why this matters to users

This means important memory is inspectable. It is not trapped in a hidden AI
database that you cannot review.

That is good for:

- trust
- debugging
- portability
- explicit control

---

## 12. Approvals, Safety, and Privacy

Parallx AI is designed so you stay in control.

### Approval model

For higher-impact actions, Parallx can require approval before continuing.

Common examples:

- writing a file
- deleting a file
- creating a page
- running a command

### What you should do as a user

Before approving an action, quickly confirm:

1. Is this the right file or target?
2. Is this the right action?
3. Is the scope too broad?
4. Can I explain why the AI wants to do this?

If the answer to any of those is no, reject the action and ask the AI to revise

---

## Known Limitations

These are architectural limitations of the current version. They are planned
for improvement in future milestones.

### Skills run independently

Each skill (workflow) executes on its own — there is no automatic chaining
of one skill's output into another skill's input. If you need a multi-step
workflow (e.g., extract from PDF then compare), describe the full sequence
in a single prompt and the AI will orchestrate the steps manually.

**Planned:** Skill dependency chaining is targeted for a future milestone.

### Retrieval uses statistical fusion, not LLM re-ranking

When the AI searches your workspace, results are ranked using Reciprocal
Rank Fusion (RRF) across vector and keyword matches. There is no secondary
LLM-based re-ranking pass. This means results are fast and deterministic,
but may occasionally rank a less-relevant chunk higher than an LLM would.

**Workaround:** If answers seem to miss key context, try rephrasing your
question with more specific terms that appear in the target documents.

**Planned:** LLM re-ranking is targeted for a future milestone.
its plan.

### Privacy

Current Parallx AI architecture is local-first and built around local model use.

The main user expectation should be:

- your workspace remains under your control
- approvals exist for sensitive actions
- the system is designed to make context and actions inspectable

### Safety reminder

Do not approve destructive actions casually.

Examples:

- mass deletes
- shell commands you do not understand
- edits across many files if you have not reviewed the plan

---

## 13. How to Check What the AI Is Seeing

One of the best Parallx AI features is that the system is not meant to be fully
opaque.

### Everyday transparency surfaces

For most users, inspect here first:

1. context pills above the input
2. attached files in the current turn
3. tool toggles for the conversation
4. diff views for proposed edits

### Advanced transparency surfaces

For deeper inspection:

1. Tool Gallery
2. AI Settings -> Tools
3. workspace prompt files such as `SOUL.md`, `AGENTS.md`, and `TOOLS.md`
4. `/context list`
5. `/context detail`
6. `/context json`

### Why `/context` matters

The OpenClaw-backed runtime can report what was injected into the system prompt,
including things like:

- injected workspace files
- tool footprint
- skill footprint
- bootstrap size and truncation

That is useful when you want to answer questions like:

- "Did the AI actually load the project instructions?"
- "Is a large prompt file being truncated?"
- "What tools were available on this run?"

---

## 14. Recommended Ways to Use Parallx AI

### Good pattern 1: Learn first, act second

1. Ask mode: "Summarize the relevant files."
2. Ask mode: "What would you change and why?"
3. Edit or Agent mode: perform the change

### Good pattern 2: Narrow the scope

Instead of asking:

- "Explain this project"

Try:

- "Explain the purpose of these three files"
- "Summarize the `docs/ai` folder"
- "Compare these two notes"

### Good pattern 3: Require honesty

Useful phrases:

- "If you do not know, say so."
- "Do not guess."
- "Answer only from the attached files."
- "Cite your sources."

### Good pattern 4: Use Agent mode only for real work

Do not use Agent mode just because it sounds advanced.

Use it when you actually want:

- a sequence of actions
- file operations
- command execution
- a longer autonomous run with checkpoints

---

## 15. Examples You Can Try

### Ask mode examples

- "What does this workspace seem to be for?"
- "Summarize the main ideas in this file."
- "Which files should I read first if I am new here?"
- "Compare these two notes and list the differences."

### Edit mode examples

- "Rewrite this page for clarity."
- "Turn this rough note into a clean checklist."
- "Condense this long explanation into a user-facing guide."
- "Propose an improved structure, but let me review before applying."

### Agent mode examples

- "Find all docs related to memory behavior, summarize the differences, and
  draft a consolidated note."
- "Inspect the AI settings and tool surfaces, then write a beginner-facing
  explanation into a docs file."
- "Search for references to this feature across the workspace and prepare a
  change plan before editing anything."

### Example of a strong grounded prompt

"Use only the attached files. Summarize the differences in five bullets. Cite
the file name for each bullet. If the files do not answer something, say that
explicitly."

---

## 16. Troubleshooting

### Problem: The AI gives a vague or generic answer

Likely causes:

- not enough context
- wrong mode
- question too broad

What to do:

1. attach the relevant file
2. mention the relevant folder
3. ask for a grounded answer with citations

### Problem: The AI seems to miss a file

What to do:

1. confirm the correct workspace is open
2. use `@file` or `@folder`
3. wait for indexing/readiness if the workspace was just opened
4. ask the AI to list the files it used

### Problem: The AI wants to do too much in Agent mode

What to do:

1. reject the action
2. narrow the instruction
3. ask it to state the plan before acting
4. disable tools you do not want used

### Problem: The AI is confident but wrong

What to do:

1. ask for sources
2. ask for exact file citations
3. ask it to quote the relevant line or section
4. reduce the scope to the exact file or folder

### Problem: A proposed edit looks risky

What to do:

1. review the diff
2. reject it if the scope is wrong
3. ask for a smaller edit
4. ask for an explanation before re-running

---

## 17. FAQ

### Do I need to understand AI to use Parallx AI well?

No. You mainly need to learn three habits:

- give clear instructions
- provide the right context
- review important outputs

### Which mode should most people use most of the time?

Ask mode.

It is the best default for learning, exploring, and checking information.

### When should I use Edit instead of Ask?

Use Edit when you want change proposals rather than just explanation.

### When should I use Agent?

Use Agent when the task involves multiple steps or real actions, not just a
single answer.

### Where do I see what tools are available?

Use the Tool Gallery, AI Settings -> Tools, and the chat tool picker.

### Where do I see skill files?

Workspace skills live in `.parallx/skills/<skill-name>/SKILL.md`.

### Can the AI act without me knowing?

High-impact actions are meant to flow through approval-aware surfaces. You
should still review actions and diffs carefully.

### How do I get more accurate answers?

Use exact files, exact folders, citations, and narrower prompts.

### What should I do if the AI says something uncertain?

Treat that as useful honesty, not failure. It usually means the model needs
better context or the workspace does not actually contain the answer.

---

## Final Advice

If you remember only five things, remember these:

1. Start in Ask mode.
2. Give the AI the right context.
3. Ask for citations when accuracy matters.
4. Review edits before accepting them.
5. Use Agent mode intentionally, not casually.

That is the fastest path to getting real value from Parallx AI.

### Customizing Permissions

Edit `.parallx/permissions.json` to promote or demote any tool:
```json
{
  "write_file": "always-allowed",
  "read_file": "requires-approval"
}
```

### .parallxignore — Blocking AI Access

Create a `.parallxignore` file at your workspace root (same syntax as `.gitignore`):

```gitignore
# Secrets
.env
.env.*
*.key
*.pem
secrets/

# Large/irrelevant directories
node_modules/
dist/
build/
```

Files matching these patterns are:
1. **Not indexed** — the AI can't find them via search
2. **Not readable** — tools like `read_file` and `search_files` are blocked
3. **Not attachable** — "Add Context" won't let you attach them

### Workspace Sandbox

The AI can **never** access files outside your open workspace folder. Every file path is validated by the Workspace Boundary Service before any read, write, or execute operation.

---

## Configuration Reference

### .parallx/config.json

```json
{
  "models": {
    "chatModel": "qwen2.5:32b-instruct",
    "embeddingModel": "nomic-embed-text",
    "contextLength": 32768
  },
  "agent": {
    "maxIterations": 10,
    "autoRag": true,
    "ragTopK": 5,
    "ragScoreThreshold": 0.3
  },
  "indexing": {
    "autoIndex": true,
    "watchFiles": true,
    "maxFileSize": 1048576,
    "excludePatterns": ["node_modules", "dist"]
  }
}
```

### Key Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Open AI Settings |
| `Ctrl+L` | Focus chat input |
| `Ctrl+Shift+P` | Command Palette (type "AI" to filter) |
| `/` | Slash command autocomplete (in chat) |
| `@` | Context mention autocomplete (in chat) |
| `Escape` | Stop AI generation |
