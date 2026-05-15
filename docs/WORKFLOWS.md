# Parallx — Workflows & Recipes

Practical, end-to-end things you can do with Parallx today. Every workflow
below is built from shipped features: the bundled extensions
(**Budget**, **Media Organizer**, **Text Generator**, **Web Research**,
**Workspace Graph**), the **AI Chat** (Ask / Edit / Agent modes), the
**Canvas** (rich-text pages with blocks, tables, tasks, embeds), and
**AI Tools** (built-in tools + MCP servers).

Most workflows combine three or four of these. The pillar tags at the top
of each recipe show which parts you'll touch.

> **Pillar key**
> 🗂 **Explorer** — files, folders, the workspace tree, search
> 💬 **Chat** — AI Chat panel (Ask / Edit / Agent)
> 🎨 **Canvas** — canvas pages, blocks, embeds
> 🛠 **AI Tools** — built-in tools + MCP servers + skills

---

## Table of Contents

### 1. Personal Knowledge & Notetaking
1.1 Socratic reading — PDF book + AI as you read
1.2 Daily journal → weekly review
1.3 Meeting-to-action-items pipeline
1.4 Reading list with auto-summaries
1.5 Second brain: wire chat notes back to a canvas hub
1.6 Decision journal with monthly retrospection
1.7 Language-learning flashcards with a quiz agent

### 2. Money & Operations
2.1 Gmail → Budget ledger (the bundled Budget extension)
2.2 Monthly spending review on autopilot
2.3 Reconcile a CSV bank export against Gmail-sourced rows
2.4 Natural-language queries over your ledger
2.5 Subscription audit

### 3. Research & Writing
3.1 Topic research with the Web Research extension
3.2 Blog draft from a research question
3.3 Long-form fiction with Text Generator
3.4 Translate an entire docs folder
3.5 Compare-and-merge two long documents
3.6 Living "state of X" page that refreshes weekly

### 4. Code & Developer Workflow
4.1 Morning standup: open PRs + commits summary
4.2 Heartbeat code review on your active branch
4.3 Custom internal-API MCP server
4.4 Codebase onboarding canvas page
4.5 Postgres query buddy
4.6 Issue intake from Slack → Linear/GitHub

### 5. Email, Calendar, Communication
5.1 Inbox triage digest
5.2 Newsletter compression
5.3 Slack daily summary post
5.4 Auto-draft replies (review-only)
5.5 Calendar prep brief

### 6. Media & Memory
6.1 Photo library cleanup with Media Organizer
6.2 "Best of" trip albums
6.3 Drag photos onto canvas with AI captions
6.4 Find that whiteboard / receipt shot

### 7. Workspace Hygiene & Discovery
7.1 Workspace Graph for visual navigation
7.2 Broken-link sentinel (heartbeat)
7.3 "What changed this week" digest (cron)
7.4 Onboard a teammate to a workspace

### 8. Personal CRM & Life Ops
8.1 People you've met, follow-up nudges
8.2 Travel planner with Brave Search + Fetch
8.3 Recipe library with ingredient → cook plan
8.4 Resume tailoring against a job description

### 9. Advanced Patterns
9.1 Cron + Memory MCP for stateful daily jobs
9.2 Sequential Thinking for hard agent runs
9.3 Custom skill that captures *your* writing style
9.4 Two-workspace setup: "Personal" vs "Client"
9.5 Subagent fan-out

---

# 1. Personal Knowledge & Notetaking

## 1.1 Socratic reading — PDF book + AI as you read
Pillars: 🗂 💬 🎨

**What you get.** You open a PDF (textbook, paper, business book). As you
read, you chat with the AI about each section — it explains terms, finds
counterexamples, and quizzes you. At the end, the AI consolidates the
whole conversation into structured notes on a canvas page, with the
quotes you reacted to inline.

**Ingredients.** PDF viewer (built in), AI Chat (Ask mode), Canvas page,
the `@file` and `@selection` mentions.

**Steps.**
1. Drop the PDF into your workspace folder. Open it in the Parallx
   PDF viewer.
2. Open AI Chat (`Ctrl+Shift+L`), select **Ask** mode.
3. As you read, attach the page or selection to the chat with `@file`
   or copy-paste a quote.
4. Use prompts like:
   - *"Explain what the author means by [term] in plain language."*
   - *"What's the strongest counterargument to the claim on page 12?"*
   - *"Quiz me on the last chapter — five questions, hardest first."*
5. When you finish a chapter or the whole book, switch to **Agent**
   mode and say:
   > *"Create a canvas page called 'Notes — \<book title\>'. For each
   > chapter we discussed, add an H2 with the chapter name, a short
   > summary, the key quote I reacted to, and a 'My take' callout
   > block."*

**Variations.** Swap PDF for an academic paper, a long blog post (use
`@web` and the Fetch MCP), or a YouTube transcript pasted into the chat.

---

## 1.2 Daily journal → weekly review
Pillars: 🎨 💬 🛠

**What you get.** A canvas page per day, free-form. Every Sunday a cron
job stitches the seven pages into a single review with patterns, wins,
and open threads.

**Ingredients.** Canvas, AI Agent mode, **Cron** (Autonomy → Manage cron
jobs…), optionally **Memory** MCP for cross-week trends.

**Steps.**
1. Create a canvas page `Journal/2026-05-15.md` style or use today's
   date as title.
2. In `Ctrl+Alt+S` → **Manage cron jobs…**, add:
   - **Schedule:** `0 18 * * 0` (Sunday 6 pm)
   - **Prompt:** *"Find canvas pages titled with this past week's
     dates under Journal/. Produce a new page 'Weekly Review —
     \<week start\>' with sections: Wins, Patterns, Open Threads,
     One Thing for Next Week. Quote two specific lines per section."*
3. Make sure **Autonomy → Cron enabled** is on and **Surface → Chat
   enabled** is on so you see the result.

---

## 1.3 Meeting-to-action-items pipeline
Pillars: 💬 🎨

**What you get.** Paste a meeting transcript into chat. AI extracts
action items as a task list directly on a "Meeting" canvas page, with
owners and due dates.

**Steps.**
1. Create canvas page `Meetings/2026-05-15 — \<topic\>`.
2. In **Agent** mode:
   > *"Here is a transcript [paste]. On the page 'Meetings/2026-05-15 —
   > \<topic\>', insert: a 1-paragraph summary, an H2 'Decisions', and
   > an H2 'Actions' as a task list block. Owner in parentheses,
   > due date as ISO if mentioned."*
3. Tasks appear as checkable items on the page. Check them off as you
   complete them.

---

## 1.4 Reading list with auto-summaries
Pillars: 🎨 🛠 💬

**What you get.** Drop a URL into a canvas page. A heartbeat agent fetches
it, generates a 5-bullet summary, and replaces the bare URL with a
captioned link block.

**Steps.**
1. Install the **Fetch** MCP server from the catalog (no setup).
2. Create canvas page `Reading List`. Paste URLs into a bullet list as
   you find them.
3. Settings → **Manage cron jobs…** → add:
   - **Schedule:** `0 * * * *` (hourly)
   - **Prompt:** *"On the 'Reading List' page, find any bullet that is
     a bare URL with no summary. Use the Fetch tool to load the page,
     and rewrite the bullet as: link title, 5-bullet TL;DR indented
     beneath. Skip bullets already processed."*

---

## 1.5 Second brain: wire chat notes back to a canvas hub
Pillars: 💬 🎨 🛠

**What you get.** A growing "Knowledge Hub" canvas page that you feed
throughout the day from chat, then have the AI organize on a schedule.

**Steps.**
1. Create a canvas page `Knowledge Hub` with sections (e.g. "Engineering",
   "Writing", "Health"). Also create a scratch page `Captures/Today`.
2. Whenever a chat exchange produces something worth keeping, ask the
   AI in **Edit** mode:
   > *"Append the last answer to the page 'Captures/Today' as a
   > bullet with a timestamp."*
3. Cron job, `30 22 * * *`:
   > *"Read 'Captures/Today'. For each bullet, append it under the
   > best-matching section of 'Knowledge Hub' with today's date.
   > Then rename 'Captures/Today' to 'Captures/\<YYYY-MM-DD\>' and
   > create a fresh empty 'Captures/Today'."*
4. Over weeks the hub becomes your personal Wikipedia, with the daily
   capture pages as an audit trail.

---

## 1.6 Decision journal with monthly retrospection
Pillars: 🎨 💬

**What you get.** Every important decision goes in a structured table
on canvas: context, options, choice, expected outcome. A monthly cron
asks "what actually happened" for decisions older than 30 days.

**Steps.**
1. Canvas page `Decision Journal` with a table: Date | Decision |
   Options | Chose | Why | Expected | Reviewed?
2. Add rows as decisions happen.
3. Cron `0 9 1 * *` (first of month, 9 am):
   > *"On 'Decision Journal', find rows where Reviewed is empty and
   > Date is more than 30 days ago. Open a chat thread for each with:
   > 'Decision from \<date\>: \<row\>. Did the expected outcome match
   > reality?'. After I respond, mark Reviewed = yes."*

---

## 1.7 Language-learning flashcards with a quiz agent
Pillars: 🎨 💬

**What you get.** A canvas page of vocab in a table. Type "quiz me" in
chat and an agent picks 10 cards, asks each, scores you, and updates a
"last seen / confidence" column on the page.

**Steps.**
1. Create canvas `Spanish Vocab` with table: Word | Meaning | Last Seen | Confidence.
2. In chat (Agent mode):
   > *"Pick 10 rows from 'Spanish Vocab' weighted toward low confidence
   > and old Last Seen. Quiz me one at a time. After the round, update
   > Last Seen and Confidence (1–5)."*

---

# 2. Money & Operations

## 2.1 Gmail → Budget ledger
Pillars: 🛠 (Gmail MCP) + Budget extension + 💬

**What you get.** Every credit-card transaction email Gmail receives is
parsed by a local AI pipeline into a categorized row in a per-workspace
SQLite ledger. Dashboards in the Budget extension show spend by category,
month, account.

**Steps.**
1. **Settings → Manage MCP servers… → Gmail → Install → Authorize**
   (read-only OAuth, browser flow).
2. The **Budget** extension is bundled. Open the Budget sidebar (wallet
   icon) → click **Settings**.
3. Confirm `budget.gmailMcpServerId = gmail` (matches the row id above).
4. Adjust `budget.gmailQuery` if your bank isn't in the default
   `from:(chase.com OR americanexpress.com OR …)` filter.
5. Hit **Sync Gmail Transactions** once to backfill (default
   `budget.syncStartDays = 90`).
6. The cron job for `budget.sync` runs automatically every
   `budget.syncIntervalMinutes` (default 30 min). Settings → **Manage
   cron jobs…** to change or disable.

**Verify.** Budget → **Open Transactions**. Open **Sync Log** if rows
don't show — it explains skipped messages, model misclassifications,
and rule hits.

---

## 2.2 Monthly spending review on autopilot
Pillars: Budget + 💬 + 🎨

**What you get.** On the 1st of every month, AI posts a budget review to
chat *and* drops a summary page on canvas comparing actuals vs your
budget plan.

**Steps.**
1. With workflow 2.1 running, set up the **Plan** in Budget (per-category
   monthly targets).
2. Cron `0 9 1 * *`:
   > *"Open the Budget tools. For last month, list spending by category
   > vs plan. Flag categories ≥110% of plan. Create a canvas page
   > 'Budget Reviews/\<YYYY-MM\>' with a table and a one-paragraph
   > narrative. Also post a 3-sentence summary in chat."*

---

## 2.3 Reconcile a CSV bank export against Gmail rows
Pillars: 🗂 + Budget + 💬

**Steps.**
1. Download your bank's CSV export. Drop it in the workspace folder.
2. Budget → **Import Transactions from CSV**.
3. In chat (Agent):
   > *"For all transactions in May 2026, list rows where the
   > Gmail-sourced amount and the CSV-sourced amount disagree by more
   > than $1.00, or where one source has a row the other doesn't.
   > Output as a markdown table."*

---

## 2.4 Natural-language queries over your ledger
Pillars: Budget + 💬

> *"What did I spend on dining last quarter, broken down by week?"*
> *"List every transaction over $500 from American Express, sorted by
> date, with merchant and category."*
> *"How does this month's grocery spend compare to my 12-month average?"*

The Budget extension exposes its SQLite tables to the agent, so the AI
answers by running real queries — no hallucinated numbers.

---

## 2.5 Subscription audit
Pillars: Budget + 💬 + 🎨

**Prompt** (Agent):
> *"Find all recurring charges in my ledger from the last 6 months.
> Group by merchant, show average amount and frequency. Create a canvas
> page 'Subscriptions' with the list, sorted by annual cost descending.
> Flag any that haven't charged in 60+ days as possibly cancelled."*

---

# 3. Research & Writing

## 3.1 Topic research with the Web Research extension
Pillars: 🛠 + 🎨 + 💬

**What you get.** A single prompt kicks off web search + fetch + sanitize
+ summarize. Results land on a canvas "Research Hub" page with citations,
clearly tagged as untrusted external content.

**Steps.**
1. The **Web Research** extension is bundled. Confirm
   `webResearch.dailyBudget` (default 100 search calls/day).
2. In chat (Agent mode):
   > *"Research 'state of small modular reactors in 2026'. Find 5
   > reputable sources. Summarize each, then synthesize. Drop the
   > result on the Research Hub page under a new H1 with today's
   > date."*
3. The extension uses the **research-topic** skill, the secure egress
   chokepoint, and Brave Search under the hood. Each finding is
   labeled with its source URL.

---

## 3.2 Blog draft from a research question
Pillars: 🛠 + 🎨 + 💬 (Edit mode)

**Steps.**
1. Run 3.1 to gather research into the Research Hub.
2. Create canvas page `Drafts/\<post slug\>` with an outline (H2 sections).
3. Switch chat to **Edit** mode, target the draft page:
   > *"Fill in the 'Background' and 'Why now' sections using the
   > Research Hub findings from today. Match my writing voice from
   > recent posts in Drafts/."*
4. Review the diff. Accept, reject, or refine.

---

## 3.3 Long-form fiction with Text Generator
Pillars: Text Generator extension + 🎨

**What you get.** Character-driven chats with persistent personas, with
or without your own canvas-page notes feeding in as worldbuilding.

**Steps.**
1. Open **Text Generator** sidebar (book icon).
2. **Characters → New Character**: name, persona, scenario, dialogue
   examples.
3. **New Chat** with the character. Conversation runs on local Ollama.
4. (Optional) Drop scene notes into a canvas page; reference them in
   the character's persona to keep continuity.

---

## 3.4 Translate an entire docs folder
Pillars: 🗂 + 💬 (Edit mode) + 🛠 (Filesystem MCP optional)

**Steps.**
1. Workspace skill at `.parallx/skills/translate-es/SKILL.md`:
   > *"Translate Markdown to Spanish. Preserve code blocks, headings,
   > links unchanged. Use formal 'usted'."*
2. In **Agent** mode:
   > *"For every .md under /handbook/, apply the translate-es skill
   > and save the output to /handbook-es/ with the same relative
   > path. Skip files that already exist in /handbook-es/."*

---

## 3.5 Compare-and-merge two long documents
Pillars: 🗂 + 💬

**Prompt** (Ask):
> *"Compare @file:proposal-v1.md and @file:proposal-v2.md. Show
> structural changes as a tree diff, content changes as a side-by-side
> table. List substantive disagreements separately from rewording."*

---

## 3.6 Living "state of X" page that refreshes weekly
Pillars: 🛠 + 🎨

**Setup.** Pick a topic you track (a competitor, an open-source project,
a scientific frontier). Cron job, weekly:
> *"Search the web for news on \<topic\> from the last 7 days. Update
> the canvas page 'State of \<topic\>' under an H2 'Week of
> \<date\>'. Append, never overwrite. Cite every claim."*

Tip: pair with the **Memory** MCP so the agent doesn't repeat findings
from prior weeks.

---

# 4. Code & Developer Workflow

## 4.1 Morning standup: open PRs + commits summary
Pillars: 🛠 (GitHub MCP) + 💬 + Cron

**Steps.**
1. Install **GitHub** MCP from the catalog with a fine-scoped PAT
   (`repo`, `read:org`).
2. Cron `0 9 * * 1-5` (weekday 9 am):
   > *"List my open PRs across all my repos. For each: title, repo,
   > age, review status, and one-sentence summary of the diff. Also
   > list my commits from yesterday by repo. Post in chat."*

---

## 4.2 Heartbeat code review on your active branch
Pillars: 🛠 + 💬 + Heartbeat

**Steps.**
1. Settings → **Autonomy → Heartbeat enabled** = On.
2. Interval: 5 min.
3. Heartbeat prompt (Settings → Autonomy → Heartbeat instructions):
   > *"Run `git diff` against origin/main. If there are changes,
   > review them for: missing error handling, unused imports, public
   > APIs without docs, and obvious test gaps. If you find issues,
   > post a single concise message in chat. If clean, stay silent."*

The heartbeat is idle-aware — silent when nothing has changed.

---

## 4.3 Custom internal-API MCP server
Pillars: 🛠

**What you get.** Your internal API becomes a first-class tool the agent
can invoke.

**Steps.**
1. Write a tiny stdio MCP server (Node, Python — any language with an
   MCP SDK). See `docs/PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md`.
2. Publish it locally (`npm link`, or just an absolute path).
3. Settings → **Manage MCP servers… → Custom server**:
   - Name: `internal-api`
   - Command: `node`
   - Args: `["/abs/path/to/server.js"]`
   - Env: secrets as needed
4. Once connected, the agent can call `internal_api.listUsers`,
   `internal_api.createTicket`, etc.

---

## 4.4 Codebase onboarding canvas page
Pillars: 🗂 + 💬 + 🎨

**Prompt** (Agent):
> *"Read the top-level structure of this workspace. For each top-level
> folder, write 2–3 sentences explaining its purpose. Create a canvas
> page 'New Engineer Onboarding' with: project overview (from README),
> directory map (table), how to run locally (from package.json
> scripts), and links to the three most-edited files of the last
> month."*

---

## 4.5 Postgres query buddy
Pillars: 🛠 (custom Postgres MCP)

**Steps.**
1. Install a Postgres MCP server (community: `mcp-server-postgres`)
   via the **Custom** form, pointing at your read-only replica.
2. In chat: *"How many users signed up last week, by day?"* — the
   agent writes and runs the SQL, returns a table.
3. Pair with a **Memory** MCP entry so the agent remembers your
   schema across sessions without re-introspecting every time.

---

## 4.6 Issue intake from Slack → Linear/GitHub
Pillars: 🛠 (Slack MCP + GitHub MCP) + Cron

**Steps.**
1. Install **Slack** MCP (bot token, see MCP user guide).
2. Cron `*/15 * * * *` (every 15 min):
   > *"Read new messages in #bug-reports since last check. For each
   > message containing 'bug:' or 'feature:', create a GitHub issue
   > in the appropriate repo with the message as body and the user
   > as @-mentioned reporter. Reply in the thread with the issue
   > link."*

---

# 5. Email, Calendar, Communication

## 5.1 Inbox triage digest
Pillars: 🛠 (Gmail MCP) + Cron

**Steps.**
1. Gmail MCP installed (see workflow 2.1).
2. Cron `0 8 * * *`:
   > *"List unread Gmail from the last 24 hours. Group by: needs
   > action, FYI, newsletters, automated. For 'needs action', give
   > a one-line summary each. Post in chat."*

The Gmail MCP **never reads message bodies** — only headers and
snippets. Perfect for triage.

---

## 5.2 Newsletter compression
Pillars: 🛠 + 🎨

**Prompt** (cron, daily 7 am):
> *"From Gmail unread newsletters (label: newsletter) received in the
> last day, fetch the linked article when present, and produce a
> single 'Newsletter Digest \<date\>' canvas page: one bullet per
> newsletter, 2 sentences each, link out."*

---

## 5.3 Slack daily summary post
Pillars: 🛠 (Slack MCP)

**Steps.**
1. Slack MCP installed with `chat:write`, `channels:history`,
   `channels:read`.
2. Cron weekday 5:30 pm:
   > *"Review channels #project-alpha and #project-beta for today.
   > Summarize: decisions made, open questions, blockers. Post the
   > summary in #standup as me."*

---

## 5.4 Auto-draft replies (review-only)
Pillars: 🛠 + 💬 (Edit mode)

The bundled Gmail MCP is **read-only**, so the agent can't send. Instead:
1. Agent reads an email thread.
2. Drafts a reply in a canvas page `Drafts/Email — \<subject\>`.
3. You copy-paste into Gmail when ready.

This keeps a paper trail and avoids accidental sends.

---

## 5.5 Calendar prep brief
Pillars: 🛠 (custom Google Calendar MCP) + 💬 + Cron

**Steps.**
1. Install a community Google Calendar MCP (custom server form).
2. Cron `0 7 * * 1-5`:
   > *"List today's meetings with attendees. For each meeting, scan
   > my workspace for notes mentioning the attendees or topic.
   > Produce a brief: agenda guess, prior context, suggested
   > questions. Post in chat."*

---

# 6. Media & Memory

## 6.1 Photo library cleanup with Media Organizer
Pillars: Media Organizer extension

**What you get.** Scan a folder of photos/videos, get an Apple-Photos-like
grid with tags, albums, ratings, EXIF metadata, and duplicate detection.

**Steps.**
1. Open Media Organizer (sidebar).
2. **Folders → Add Folder**, point at your photo library root.
3. Scan runs in the background with progress in the status bar.
4. Browse, tag, rate. Drag tag chips onto cards to bulk-tag.
5. **Duplicates** sidebar entry lists pHash-detected near-duplicates
   for review.

---

## 6.2 "Best of" trip albums
Pillars: Media Organizer

**Steps.**
1. Filter the grid by date range and (optional) GPS region.
2. Rate your favorites 4+ stars as you skim.
3. Save as a **Smart Album** with the filter `rating >= 4 AND dateFrom..dateTo`.
4. Smart Albums refresh dynamically — they're saved queries.

---

## 6.3 Drag photos onto canvas with AI captions
Pillars: Media Organizer + 🎨 + 💬

**Steps.**
1. Open a canvas page (e.g. `Trip — Lisbon 2026`).
2. Drag photos from the Media Organizer grid directly onto the page —
   they embed as image blocks.
3. In chat (Edit mode):
   > *"For each image on this page that has no caption, propose a
   > one-sentence caption based on filename, date, and any GPS info
   > the image has."*

---

## 6.4 Find that whiteboard / receipt shot
Pillars: Media Organizer

**Prompt** (the Media Organizer exposes its data to the agent):
> *"Find photos from the last 3 months taken on weekday afternoons
> with a portrait orientation and a filename starting with 'IMG_' —
> those are likely my whiteboard captures."*

---

# 7. Workspace Hygiene & Discovery

## 7.1 Workspace Graph for visual navigation
Pillars: Workspace Graph extension

**What you get.** A force-directed graph of files, canvas pages, and AI
sessions. See clusters, find orphan files, jump to any node.

**Steps.**
1. Workspace Graph is bundled. Open via Command Palette: *"Workspace
   Graph: Open Full Graph"*.
2. Click a node → opens the file/page.
3. Refresh after major reorganizations.

---

## 7.2 Broken-link sentinel (heartbeat)
Pillars: Heartbeat + 💬

Heartbeat is a file-watcher — it fires when files in the workspace
change (filtered by `Autonomy → Heartbeat watch include extensions`
and `… exclude globs`). Canvas pages are stored as files, so editing
one triggers heartbeat the same as editing any other file.

**Prompt** (heartbeat instructions):
> *"For each changed file in this run, if it is a canvas page or
> markdown file, check that every internal link in it still resolves
> to an existing page or file. If a broken link appears, post a chat
> notification with the page, the link text, and a suggested target.
> Otherwise stay silent."*

Keep the heartbeat interval at the default (15 s minimum) so the
feedback is near-real-time without thrashing.

---

## 7.3 "What changed this week" digest
Pillars: Cron + 💬 + 🎨

**Cron** `0 17 * * 5` (Friday 5 pm):
> *"List files modified this week, grouped by top-level folder.
> Highlight the 3 biggest content changes (by diff size). Create a
> canvas page 'Weekly Digest — \<date\>' with the list and a one
> sentence framing for each cluster."*

---

## 7.4 Onboard a teammate to a workspace
Pillars: 🗂 + 💬 + 🎨 + Settings export

**Steps.**
1. Settings → **Export workspace config…** to share settings (secrets
   are stripped automatically).
2. Run workflow 4.4 to produce an onboarding page.
3. Teammate **Import workspace config…**, re-enters their own secrets,
   and starts.

---

# 8. Personal CRM & Life Ops

## 8.1 People you've met, follow-up nudges
Pillars: 🎨 + Cron + 💬

**Steps.**
1. Canvas page `People` with table: Name | Met At | What We Talked About | Next Step | Due.
2. Cron daily 8 am:
   > *"On the 'People' page, find rows where Due is today or earlier
   > and Next Step is non-empty. Post in chat as a list."*

---

## 8.2 Travel planner with Brave Search + Fetch
Pillars: 🛠 (Brave + Fetch) + 🎨 + 💬

**Prompt** (Agent):
> *"I'm going to Lisbon for 5 days in October. Use Brave Search and
> Fetch to gather: 3 neighborhoods to stay in, 8 sights with cluster
> proximity, 5 restaurants per neighborhood. Output as a canvas page
> 'Trips/Lisbon 2026' with a day-by-day suggested itinerary table
> and links."*

---

## 8.3 Recipe library with ingredient → cook plan
Pillars: 🎨 + 💬

**Steps.**
1. Canvas page per recipe with table: Ingredient | Amount.
2. In chat:
   > *"Here are the ingredients I have at home: [list]. From canvas
   > recipes that match at least 80%, propose 3 meals for this week.
   > Generate a shopping list for whatever's missing."*

---

## 8.4 Resume tailoring against a job description
Pillars: 🎨 + 💬 (Edit mode)

**Steps.**
1. Canvas page `Resume — Master`. Paste the JD in the chat.
2. **Edit** mode:
   > *"Given this JD, propose edits to my Resume — Master page that
   > emphasize the matching experience. Don't fabricate. Show diffs."*
3. Review, accept, export.

---

# 9. Advanced Patterns

## 9.1 Cron + Memory MCP for stateful daily jobs
Pillars: 🛠 (Memory MCP) + Cron

**Why.** Plain cron prompts are amnesiac. With the **Memory** MCP, the
agent can persist a key-value store across runs — last-processed
timestamp, running tallies, "decisions I've already made".

**Pattern.**
> *"Use memory:get('last_inbox_cursor') to find the last processed
> timestamp. List Gmail messages received after that. Process them.
> Store memory:set('last_inbox_cursor', <new latest>)."*

---

## 9.2 Sequential Thinking for hard agent runs
Pillars: 🛠 (Sequential Thinking MCP)

For multi-step research or planning, install **Sequential Thinking**
from the catalog. The agent uses it as a scratch pad — visible
reasoning steps before it acts. Particularly helpful when you ask
it to design something or debug an unclear failure.

---

## 9.3 Custom skill that captures *your* writing style
Pillars: 🛠 (skills)

**Steps.**
1. Create `.parallx/skills/my-voice/SKILL.md` with:
   - 3 representative excerpts from past writing
   - Bulleted "do this / don't do this" rules
   - Common phrases and structural preferences
2. The skill is auto-loaded for any chat in this workspace.
3. When drafting, the AI now writes in your voice by default. No more
   re-explaining tone each time.

See `docs/ai/AI_USER_GUIDE.md` §8 for the full skill format.

---

## 9.4 Two-workspace setup: "Personal" vs "Client"
Pillars: 🗂 + Settings

Parallx doesn't have profiles — **workspaces are the unit of
separation**. Open two folders, e.g. `~/parallx-personal/` and
`~/parallx-acme-corp/`. Each has its own:

- `.parallx/workspace-state.json` (settings, MCP servers, cron jobs)
- canvas pages
- skills
- autonomy event logs

Switch between them as you would VS Code projects. Secrets from one
workspace are not visible in the other.

---

## 9.5 Subagent fan-out
Pillars: 💬 (Agent mode)

When you need broad parallel research without polluting the main chat:

> *"Spawn 5 subagents in parallel, each researching one of these
> competitors: [list]. Each subagent returns: pricing, key features,
> 3 customer reviews. Then you synthesize a single comparison table."*

The main agent gets a clean synthesis; the noisy exploration stays in
the subagents.

---

# Outside MCPs worth exploring

Beyond the bundled catalog, the community MCP ecosystem includes
servers for:

| Domain | Servers |
|---|---|
| Productivity | Notion, Obsidian, Apple Notes, Linear, Asana, Todoist |
| Data | Postgres, MySQL, SQLite, BigQuery, Snowflake |
| Cloud | AWS, GCP, Cloudflare, Vercel, Kubernetes |
| Observability | Sentry, Datadog, Grafana, PagerDuty |
| Comms | Discord, Telegram, Microsoft Teams |
| Calendar | Google Calendar, CalDAV, iCloud |
| Finance | Stripe, Plaid, QuickBooks |
| Browser | Puppeteer, Playwright |
| Smart home | HomeAssistant, Hue |
| Files | Google Drive, Dropbox, OneDrive |

Any stdio-based MCP server works through Settings → **Manage MCP
servers… → Custom server**. See
`docs/MCP_SERVERS_USER_GUIDE.md` Part 3 for the full setup procedure
and troubleshooting.

---

# Sending this to customers

These workflows are intentionally task-oriented, not feature-oriented.
For a quick-start handout, pick 3–5 that match the customer's role:

- **Knowledge worker / student** → 1.1, 1.4, 1.5, 3.1, 7.3
- **Solo founder** → 2.1, 4.1, 5.3, 7.3, 8.1
- **Engineer** → 4.1, 4.2, 4.4, 9.1, 9.3
- **Creator** → 1.1, 3.2, 3.3, 6.1, 6.3
- **Family / household** → 2.1, 5.1, 6.1, 8.2, 8.3

Every workflow above has been validated against shipped features as of
the date of this document. New milestones may add or refine; keep
this doc updated as the surface grows.
