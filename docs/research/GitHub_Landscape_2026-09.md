# GitHub Landscape, September 2026 — what to learn from, what to rebuild

Written 2026-09-05. Mufaro's ask: *are there repos that have come up with
cool software we can learn from and rebuild as an extension in Parallx?
The OpenClaw repo was instrumental at the beginning of the harness.*

Method: GitHub search by topic and by creation date (repos created since
February 2026 with more than 8,000 stars), then the README of each
candidate, then a check of the Parallx code for what already exists. Star
counts and licences were read from the GitHub API on 2026-09-05.

Status: research only. The Polish Charter (docs/POLISH.md) is in force:
no new features until it closes. Everything here is post-polish backlog.
Four ideas graduated to briefs the same day:

- docs/MEMORY_BRIEF.md — memory as an editable artifact
- docs/SKILL_AUTHORING_BRIEF.md — skills that write themselves
- docs/LESSON_BUILDER_BRIEF.md — exam material into forms you can study
- docs/WORKBENCH_DRIVER_BRIEF.md — the AI runs Parallx like a human would
- docs/WORKFLOWS_BRIEF.md gained a suggestions audit (what OpenHuman adds)

---

## A correction that belongs at the top

The first draft of this research said workflow suggestions were unbuilt.
That was wrong. `src/services/workflows/workflowSuggestions.ts` turns a
confirmed daily habit (mind/habitDetector: 14-day window, 3 distinct days,
75-minute spread) into a disabled workflow with `source: 'suggested'`; the
Workflows panel renders a "Suggested by the AI" section with Review, Add
and Dismiss (src/built-in/autonomy-log/main.ts, renderSuggestedRow).
Shipped in the polish commit 24c8cd2f. The lesson is the standing one: a
negative claim needs the same three-layer verification as a positive one.

---

## Tier 1 — patterns Parallx should adopt

| Repo | Stars | Licence | The idea | Parallx today |
| --- | --- | --- | --- | --- |
| karpathy/llm-wiki (gist), SamurAIGPT/llm-wiki-agent, Astro-Han/karpathy-llm-wiki, AgriciDaniel/claude-obsidian | 3k to 15k | MIT | Synthesis at ingest, not query: every new source updates 10 to 15 wiki pages, contradictions flagged on arrival, append-only log, periodic lint | Raw sources are indexed and retrieved at query time (RAG). The Research Hub page is the nearest thing to a compounding artifact |
| matthiasn/lotti | 1.2k | GPL-3.0 (pattern only) | Agent proposals live in a physically separate store and reach the user's records only through an approval path; intended work (tasks) separated from actual work (time records); an AI impact dashboard per category | agentApprovalService gates actions; proposals are not a browsable surface. Suggested workflows are the one place the pattern already exists |
| ActivityWatch, JerryZLiu/Dayflow, screenpipe | 19k, 7k, 21k | MPL-2.0, MIT, source-available | Passive "what did I actually do" outside the app; Dayflow summarises what you built rather than which window was open; screenpipe "pipes" are scheduled agents as markdown with per-pipe YAML permissions | The activity journal only sees in-app events. The heartbeat never learns about the browser, Excel, or a PDF opened elsewhere |
| nagisanzenin/engram | 1.4k | MIT | A blind assessor that never sees the lesson; every grade is a receipt on disk; schedule changes quote evidence and need consent; no XP or streaks | Flashcards FSRS-6, production recall, deadline pacing. The tutor and the grader are the same turn |
| thedotmack/claude-mem, breferrari/obsidian-mind, EverMind-AI/EverOS, TencentCloud/TencentDB-Agent-Memory | 4k to 93k | Apache-2.0, MIT, Apache-2.0, see repo | Memory the user can read and edit; three-layer retrieval (index, timeline, detail); offline consolidation between sessions; a path from every summary back to evidence | Memory is already markdown in `.parallx/memory/` (MEMORY.md index, lessons, daily files) but has no in-app surface, no provenance, no consolidation pass. See docs/MEMORY_BRIEF.md |

## Tier 2 — strong single ideas

| Repo | Stars | Licence | The idea | Parallx today |
| --- | --- | --- | --- | --- |
| tinyhumansai/openhuman | 39k | GPL-3.0 (pattern only) | Agents propose automations on a canvas for approval; tool-output compression | Habit-derived suggested workflows exist. Delta documented in docs/WORKFLOWS_BRIEF.md |
| NousResearch/hermes-agent | 242k | MIT | The agent writes its own skills after complex tasks and refines them in use; agentskills.io standard | The skill loader watches `.parallx/skills/`; bundled subfolders follow agentskills.io; nothing authors skills. See docs/SKILL_AUTHORING_BRIEF.md |
| THU-MAIC/OpenMAIC | 32k | MIT | Material to outline to scenes (slides, quiz, interactive sim, project role-play); teacher plus AI classmates; resumable jobs | Extraction, flashcards, quiz template, concept maps, Concept Lab. See docs/LESSON_BUILDER_BRIEF.md |
| microsoft/skill-recorder | 3.8k | MIT | Record one session, reconstruct intent and steps, generalise into a skill; native tools over UI replay; two-phase propose then submit | CLIPS records the screen (ffmpeg gdigrab). See docs/WORKBENCH_DRIVER_BRIEF.md |
| karakeep-app/karakeep | 29k | AGPL-3.0 (pattern only) | A bookmark-everything inbox: AI tagging, full-page archive, RSS auto-hoard, rules engine | Web research fetches; there is no save-for-later capture path |
| Graphify-Labs/graphify, Egonex-AI/Understand-Anything | 115k, 82k | see repos | Every edge tagged EXTRACTED / INFERRED / AMBIGUOUS; guided tours in dependency order; per-community wiki output | M68 semantic graph, workspace-graph extension, concept maps |
| agenticnotetaking/arscontexta | 3.5k | see repo | Two to four questions derive folders, templates and hooks from research claims; fresh context per pipeline phase | `/init` scaffolds a fixed layout |
| super-productivity | 22k | MIT | Timeboxing tasks against the day; issue trackers sync into tasks | Planner with calendar sync |
| siyuan-note/siyuan | 46k | AGPL-3.0 | Block references, transclusion, SQL query embeds, flashcards from blocks | Canvas blocks have ids (M60); no transclusion |

## Worth watching, not building

- **odysseus-dev/odysseus** (87k) and **openTrinity/mycontext** (3.4k): the closest direct analogues, self-hosted AI workspaces with email triage, documents and a personal context graph. Study as competitors.
- **HKUDS/CLI-Anything** (49k): any software made agent-native through a generated CLI with `--json` and a SKILL.md. The argument for a semantic driver over pixel automation.
- **farion1231/cc-switch** (131k), **nexu-io/open-design** (94k), **garrytan/gstack**, **mattpocock/skills**: tooling around coding agents, not substrate ideas.
- **lifeos-app/lifeos**: gamified life OS. Engram's evidence and the M89 decision to cut celebrations both say no.

## Rejected for Parallx

- Embedding any of these as a dependency. OpenMAIC is a Next.js server; OpenHuman is a Rust daemon; both are the wrong shape. Patterns and, where MIT, prompts and schemas are what transfer.
- External whiteboard or canvas engines (the retired mindmap program is the precedent; never re-propose).
- Gamification.

## Sources

- https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- https://github.com/SamurAIGPT/llm-wiki-agent
- https://github.com/Astro-Han/karpathy-llm-wiki
- https://github.com/AgriciDaniel/claude-obsidian
- https://github.com/matthiasn/lotti
- https://github.com/ActivityWatch/activitywatch
- https://github.com/JerryZLiu/Dayflow
- https://github.com/screenpipe/screenpipe
- https://github.com/nagisanzenin/engram
- https://github.com/thedotmack/claude-mem
- https://github.com/breferrari/obsidian-mind
- https://github.com/EverMind-AI/EverOS
- https://github.com/TencentCloud/TencentDB-Agent-Memory
- https://github.com/tinyhumansai/openhuman
- https://github.com/NousResearch/hermes-agent
- https://github.com/THU-MAIC/OpenMAIC
- https://github.com/microsoft/skill-recorder
- https://github.com/karakeep-app/karakeep
- https://github.com/Graphify-Labs/graphify
- https://github.com/Egonex-AI/Understand-Anything
- https://github.com/agenticnotetaking/arscontexta
- https://github.com/HKUDS/CLI-Anything
- https://github.com/odysseus-dev/odysseus
- https://github.com/openTrinity/mycontext
