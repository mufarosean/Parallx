/**
 * Default SKILL.md file contents — written to `.parallx/skills/` during
 * workspace initialization. These are the canonical source-of-truth for
 * the default skills that ship with every Parallx workspace.
 *
 * Users get these automatically via `/init`. They can edit or delete them.
 * The skill scanner picks them up from disk like any other workspace skill.
 */

/** Map of skill-name → SKILL.md file content. */
/**
 * Skills once copied into every workspace that now come from the tool they
 * belong to, while it runs (api.chat.registerSkill). A workspace copy is
 * removed when it is exactly what was copied (sha256), never when edited.
 */
export const RETIRED_SEEDED_SKILLS: ReadonlyMap<string, string> = new Map([
  ['research-topic', '89113ebc4766ceb50544311d7f1c7b132683e15f750987d061af949d78933cf8'],
]);

export const defaultSkillContents: ReadonlyMap<string, string> = new Map([
  ['deep-research', `---
name: deep-research
description: Perform a thorough multi-pass investigation across all workspace files. Sweep every folder, read every relevant file, cross-reference findings, and produce a structured research report with citations.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, research, exhaustive, analysis]
parameters:
  - name: question
    type: string
    description: The research question or topic to investigate
    required: true
  - name: scope
    type: string
    description: Folder path to limit the research scope, or empty for entire workspace
    required: false
---

# Deep Research Workflow

Follow these steps precisely. Be thorough — the goal is to leave no relevant file unread.

## Step 1: Define scope and research plan

Restate the user's research question in your own words.
Identify the key concepts, entities, and relationships you need to investigate.
If a scope was provided, note the target folder; otherwise the scope is the entire workspace.

## Step 2: Sweep the workspace

Use \`fs_list_files\` recursively to enumerate every file and folder within the scope.
Record the complete file list as your **investigation checklist**.
Group files by topic or folder to plan your reading order.

## Step 3: Systematic reading pass

For **every** file in the investigation checklist:
1. Use \`fs_read_file\` to read the full content.
2. Extract facts, definitions, relationships, and data points relevant to the research question.
3. Note the source file for each finding.

Mark each file as read on your checklist. Do not skip files—even if a filename seems irrelevant, skim it to confirm.

## Step 4: Cross-reference and synthesize

Compare findings across files:
- Identify **agreements** — facts that multiple sources confirm.
- Identify **contradictions** — places where sources disagree.
- Identify **gaps** — questions the files do not answer.
- Trace **relationships** — how entities, processes, or policies connect across documents.

## Step 5: Produce the research report

Structure your response as:

1. **Research Question** — restate the question.
2. **Key Findings** — numbered list of the most important discoveries, each citing \`[source-file]\`.
3. **Cross-Reference Analysis** — agreements, contradictions, and relationships found across files.
4. **Gaps & Limitations** — what the workspace files do not answer.
5. **Conclusion** — a concise synthesis answering the original question.

Every factual claim must include a file citation.
`],

  ['scoped-extraction', `---
name: scoped-extraction
description: Extract specific information from all files in a scope. Reads every file, extracts requested facts or values, and aggregates results with full coverage.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, extraction, exhaustive]
parameters:
  - name: query
    type: string
    description: What to extract and from which scope
    required: true
---

# Scoped Extraction Workflow

Follow these steps precisely. Check every file — no exceptions.

## Step 1: Parse the request

From $ARGUMENTS, determine:
- **What** to extract (e.g. "deductible amounts", "contact names")
- **Where** to look (specific folder or entire workspace)

## Step 2: Enumerate files

Use \`fs_list_files\` to enumerate all files in scope.
Record the complete file list as your coverage checklist.

## Step 3: Read and extract

For **every** file in the checklist:
1. Use \`fs_read_file\` to read the content.
2. Search for the target information.
3. If found: record value(s), file path, and context.
4. If not found: note "No matching information in [file]."

## Step 4: Aggregate results

1. **Extraction target**: What was searched for
2. **Scope**: Files/folders searched
3. **Results**: Each value with source file and context
4. **No matches**: Files checked but containing no relevant info
5. **Coverage**: "Checked X/Y files" (X must equal Y)

## Step 5: Identify conflicts

If the same information has different values in different files, flag the conflict and show both values.
`],

  ['folder-overview', `---
name: folder-overview
description: Provide a structural overview of a folder including file count, types, hierarchy, and brief descriptions of each file.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, overview, structural]
parameters:
  - name: folder
    type: string
    description: Folder path to overview, or empty for workspace root
    required: false
---

# Folder Overview Workflow

Follow these steps precisely.

## Step 1: Enumerate the folder

Use \`fs_list_files\` to list all files and subfolders in $ARGUMENTS or the workspace root.
Record total file count, subfolder names, and file names.

## Step 2: Classify files

For each file, use \`fs_read_file\` to read the first ~20 lines. Determine:
- **Type**: based on extension
- **Purpose**: brief description based on content

## Step 3: Build the overview

1. **Folder**: Name and path
2. **Contents**: Total files, total subfolders
3. **File listing**: Each file with name, type, and 1-sentence description
4. **Subfolders**: List contents one level deep

## Step 4: Note issues

Flag: empty/stub files, duplicate filenames, inconsistent naming, drafts.
`],

  ['document-comparison', `---
name: document-comparison
description: Compare two or more documents in detail, analyzing differences, contradictions, and similarities across multiple dimensions.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, comparison, analysis]
parameters:
  - name: targets
    type: string
    description: Names or paths of documents to compare
    required: true
---

# Document Comparison Workflow

Follow these steps precisely. Read every target document in full.

## Step 1: Identify target documents

Parse $ARGUMENTS to determine which documents to compare.
Use \`fs_list_files\` and \`fs_search_knowledge\` to locate them.
If the same filename exists in multiple folders, identify ALL instances.

## Step 2: Read each document

Use \`fs_read_file\` to read the **complete content** of each document.
For each, note: path, length, structure, key claims/numbers/facts.

## Step 3: Analyze dimensions

Compare across:
1. **Structure**: Organization, sections, format
2. **Content overlap**: Shared topics
3. **Factual differences**: Different facts, numbers, dates
4. **Contradictions**: Direct conflicts (flag prominently)
5. **Unique content**: What exists in one but not the other

## Step 4: Synthesize comparison

1. **Documents compared**: List each with path
2. **Summary**: One paragraph overview
3. **Key differences**: Specific values from each document
4. **Contradictions**: Exact conflicting claims, citing both sources
5. **Similarities**: Shared content
6. **Unique content**: Per-document exclusive content

Always cite exact values. Present BOTH sides of contradictions.
`],

  ['exhaustive-summary', `---
name: exhaustive-summary
description: Summarize every file in a folder or the entire workspace. Reads each file individually and produces a per-file summary, then combines them into a comprehensive overview.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, summary, exhaustive]
parameters:
  - name: scope
    type: string
    description: Folder path to summarize, or empty for entire workspace
    required: false
---

# Exhaustive Summary Workflow

Follow these steps precisely. Do not skip any step. Read every file.

## Step 1: Enumerate all files

Use \`fs_list_files\` to enumerate every file in the target scope ($ARGUMENTS or the entire workspace root).
Record the complete list as your **coverage checklist**.

## Step 2: Read each file

For **every** file in the coverage checklist:
1. Use \`fs_read_file\` to read the full content.
2. Write a 2-4 sentence summary.
3. Note the file's relative path.

Do NOT skip files. Do NOT say a file is "too large to read."
If a file is very short (< 3 lines), note it as a stub.
If a file contains irrelevant content, still summarize it but note it.

## Step 3: Compile the summary

1. **Overview**: One paragraph describing the workspace/folder's purpose.
2. **File summaries**: Each file with path, 2-4 sentence summary, and any notable characteristics.
3. **Statistics**: Total file count, folder count, notable patterns.

## Step 4: Verify coverage

Compare your summary list against the checklist from Step 1.
State: "Coverage: X/Y files summarized" where X must equal Y.
Note any contradictions between files.
`],

  ['git-status', `---
name: git-status
description: Show the current Git status, recent commits, and uncommitted changes in the workspace.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, git, version-control]
parameters:
  - name: detail
    type: string
    description: "brief" for status only, "full" for status + log + diff
    required: false
---

# Git Status Workflow

## Step 1: Check repository status

Use \`terminal_run_command\` to run: \`git status --short\`

Record: staged files (A/M/D), unstaged changes, untracked files.

## Step 2: Recent commits

Use \`terminal_run_command\` to run: \`git log --oneline -10\`

Record the last 10 commits with short hashes and messages.

## Step 3: Current branch

Use \`terminal_run_command\` to run: \`git branch --show-current\`

## Step 4: Show diff (if detail = "full")

If the user requested full detail:
Use \`terminal_run_command\` to run: \`git diff --stat\`

## Step 5: Present results

1. **Branch**: Current branch name
2. **Status**: Modified/added/deleted/untracked files
3. **Recent commits**: Last 10 commits
4. **Changes** (if full): Diff stat summary
`],

  ['fetch-url', `---
name: fetch-url
description: Fetch the content of a URL and return it as text. Useful for reading web pages, API responses, or online documentation.
version: 1.0.0
author: parallx
kind: workflow
permission: requires-approval
user-invocable: true
tags: [workflow, web, fetch]
parameters:
  - name: url
    type: string
    description: The URL to fetch
    required: true
---

# Fetch URL Workflow

## Step 1: Validate the URL

Check that $ARGUMENTS contains a valid URL starting with http:// or https://.
If missing or invalid, respond with an error message.

## Step 2: Fetch the content

Use \`terminal_run_command\` to run: \`curl -sL --max-time 15 "$URL"\`

## Step 3: Process the response

- HTML: extract main text content (strip tags)
- JSON: format readably
- Plain text: return as-is
- Failure: report the error

## Step 4: Present results

1. **URL**: The fetched URL
2. **Content type**: HTML / JSON / Plain text
3. **Content**: Extracted text (truncated to ~4000 chars if very long)
`],

  ['pdf-extract', `---
name: pdf-extract
description: Extract text content from a PDF file using the Docling bridge.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, pdf, extraction, docling]
parameters:
  - name: file
    type: string
    description: Path to the PDF file to extract
    required: true
---

# PDF Extract Workflow

## Step 1: Locate the PDF

Check that $ARGUMENTS contains a file path ending in .pdf.
Use \`fs_list_files\` to verify the file exists.

## Step 2: Extract content

Use \`fs_read_file\` on the PDF path. Docling integration will automatically extract the text.

## Step 3: Present results

1. **File**: The PDF path
2. **Pages**: Number of pages (if available)
3. **Content**: The extracted text

If extraction fails (e.g., scanned image PDF without OCR), report the limitation.
`],

  ['explain-selection', `---
name: explain-selection
description: "Explain a selected text excerpt in detail. Triggered by the /explain command or when the user asks to explain attached text."
version: 1.0.0
author: parallx
kind: prompt
permission: auto-allow
user-invocable: true
tags: [explain, selection, analysis]
---

# Explain Selection

The user has selected a text excerpt and asked you to explain it.
The selected text is provided as a "Selected Text from:" context block in the conversation.

## Instructions

1. Read the selected text carefully.
2. Provide a clear, detailed explanation:
   - Break down any **complex concepts**, terminology, or jargon.
   - Explain the **logic or reasoning** behind statements.
   - Clarify any **abbreviations or acronyms**.
   - If the text references external concepts the user may not know, briefly explain those too.
3. Structure your explanation with headings or bullet points when the excerpt covers multiple topics.
4. If the excerpt is from a specific domain (legal, medical, technical, financial), adapt your language to be accessible while remaining accurate.
5. End with a brief one-sentence summary of what the excerpt means overall.

Do NOT just paraphrase the text. Add genuine explanatory value.
`],

  ['summarize-selection', `---
name: summarize-selection
description: "Summarize a selected text excerpt concisely. Triggered by the /summarize command or when the user asks to summarize attached text."
version: 1.0.0
author: parallx
kind: prompt
permission: auto-allow
user-invocable: true
tags: [summarize, selection, concise]
---

# Summarize Selection

The user has selected a text excerpt and asked you to summarize it.
The selected text is provided as a "Selected Text from:" context block in the conversation.

## Instructions

1. Read the selected text carefully.
2. Provide a **concise summary** that captures the essential meaning:
   - Identify and state the **main point** or thesis first.
   - List the **key supporting points** (3-5 bullets max).
   - Note any **critical details** (numbers, dates, names) that are essential to understanding.
3. Keep the summary to roughly 20-30% of the original length.
4. Use clear, direct language. Avoid filler phrases.
5. If the excerpt contains actionable items or decisions, highlight those prominently.

Do NOT add information that isn't in the original text. Summarize only what is there.
`],

  ['quiz', `---
name: quiz
description: "Write a quiz onto a canvas page from source material, or mark the answers already written on one. Triggered by /quiz, or when the user asks for practice questions or asks you to grade a quiz page."
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, study, quiz, canvas, grading]
parameters:
  - name: target
    type: string
    description: The source to write questions from, or the quiz page to mark
    required: false
---

# Quiz Workflow

A quiz lives on a canvas page and nowhere else. There is no score to record
and no database to update — the page IS the record, and it is searchable
later like any other page.

## The page convention

Everything here depends on one shape, which the **Quiz** page template sets up:

- A **heading** is a question.
- The **list directly under it** is the user's answer.
- A **callout** (\`> [!note] …\`) under that is your marking.

Never restructure the page. Never rewrite the user's answers.

## Which job is this?

Read the request. If the page already has answers written under the
questions, this is **Marking**. Otherwise it is **Writing**.

# Writing a quiz

## Step 1: Read the source

The user names a source — a canvas page, a file, a deck's material, or a
topic already discussed. Read it properly with \`canvas_read_page\` or
\`fs_read_file\`. Do not write questions from memory of a filename.

## Step 2: Write the questions

Ask for what the source actually teaches. Prefer questions that need an
explanation — *why*, *how*, *when would you use*, *what breaks if* — over
questions answered by a single term, because a term is what a flashcard is
for and a quiz is not.

Aim for 5-8 unless the user asks for a different number. Every question must
be answerable from the source; never test something it does not cover.

## Step 3: Create the page

Use \`canvas_create_page\` with a title of the form \`Quiz: <topic>\`, and a
body in this exact shape:

\`\`\`
**Source:** <what the questions came from>

## <the first question>

-

## <the second question>

-
\`\`\`

One empty bullet under each heading is where the user writes. Leave it empty.

## Step 4: Tell the user

Name the page, say how many questions, and say that you will mark it when
they ask.

# Marking a quiz

## Step 1: Read the whole page

\`canvas_read_page\` on the quiz page. You need the block ids, so read it
even if you wrote it earlier in this same conversation.

## Step 2: Re-read the source

Find the source named at the top of the page and read it. **Mark against the
source, not against your own recollection of the topic.** If you cannot find
the source, say so and mark against the question only, and tell the user that
is what you did.

## Step 3: Mark each answer in place

For each question, take the list under it as the answer, and insert a callout
immediately after that list with \`canvas_insert_block_after\`:

\`\`\`
> [!note] **Correct** — <or "Partly" / "Not quite">
> <what was right, in one line>
> <what was missing or wrong, and what the source actually says>
\`\`\`

Rules that matter:

- **Mark meaning, not wording.** Terse and correct beats fluent and empty.
- **Name what is missing.** "Partly right" with no gap named is useless.
- **Quote the source** when correcting a claim, so the user can check you.
- **An empty answer is not a failure to mark.** Say what the answer was.
- Insert after the ANSWER list, never after the heading — inserting after the
  heading would push your marking above the answer it refers to.

Work through every question. Do not stop at the first few.

## Step 4: Summarise

After the callouts are in, reply with a short read on where the
understanding is solid and where it is thin — the pattern across answers,
not a restatement of each one. Offer to explain anything they got wrong.

If the user asks a follow-up about a specific question, answer it in chat.
Only add another callout if they ask you to record the clarification on the
page.
`],
  // Written raw: its \n line breaks and TeX backslashes reach the file as typed;
  // ´ stands in for a backtick, which a raw template literal cannot hold.
  ['concept-map', String.raw`---
name: concept-map
description: "Draw a concept map (mind map) in your reply. Use whenever the user asks for a mind map, concept map, diagram of ideas, or a map of a topic, paper, method or comparison. Teaches how to decompose a topic level by level and how to put real detail (sentences, lists, formulas) inside the boxes."
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, study, concept-map, mindmap, diagram]
parameters:
  - name: topic
    type: string
    description: What to map, or the page or file to map from
    required: false
---

# Concept Map Workflow

A concept map is not a list of related words. It is a topic **taken apart**,
one question at a time:

- The centre box names the topic.
- Every box asks one question of its subject, and its children are the
  answers to that question. "What are the parts?" "What are the steps?"
  "Why does it work?" "When does it fail?" "How does it differ from X?"
- Siblings are the same kind of thing (all parts, or all steps, or all
  causes), they do not overlap, and together they cover the question.
- Detail goes DOWN the map. The top levels give structure; the bottom
  levels carry the substance: definitions, formulas, numbers, conditions,
  examples, exceptions.

A reader should be able to learn the topic from the map alone. If the map
only reminds someone of what they already know, it is too thin.

## Step 1: Read the source

If the user names a page, file or earlier answer, read it first
(´canvas_read_page´, ´fs_read_file´). Map what the source says, not what
you remember about the subject. Note every formula, number, condition and
named idea; they all need a place in the map.

## Step 2: Choose the shape

Pick the question the first level answers. This choice decides whether the
map makes sense, so make it deliberately. Common shapes:

| The topic is... | First-level question | Typical branches |
|---|---|---|
| A concept or model | What do I need to know about it? | What it is · Why it works · How it is used · Assumptions · Limits · Compared with alternatives |
| A method or procedure | What happens, in order? | Inputs · Step 1, 2, 3... · Output · Checks |
| A comparison | On what do they differ? | One branch per dimension; each box says how EACH option behaves |
| A cause and effect | What drives it? | One branch per cause; children say how and how much |
| A paper or chapter | What does it argue? | Problem · Approach · Key results · Assumptions · Diagnostics · Pitfalls |
| A problem to solve | What does solving it take? | Givens · Unknowns · Method · Steps · Answer checks |

Then, for each branch, ask the next question down. Name that question to
yourself for every box that has children. If you cannot name it, the
children are an association, not a decomposition: regroup them.

## Step 3: Write the boxes

Every box is a complete thought, written in full sentences with normal
capitalization and punctuation. Never write fragments like
"make the parameters" or "assumption issue".

A good box has a **bold lead** and then the substance:

    **Least squares.** It picks the line that makes the squared misses as small as possible, so large misses count the most.

A box is markdown. To put several lines in ONE box, write ´\n´ inside its
line. Use this when a box holds a short list that does not deserve its own
branches:

    **Residual checks**\n- No curve when plotted against fitted values.\n- No funnel shape.\n- No clusters over time.

What renders inside a box:

- **bold**, *italic*, ´code´, ~~strike~~, [link text](url)
- inline math: $\hat{f}_k = \sum_i C_{i,k+1} / \sum_i C_{i,k}$
- a line of display math on its own: ´$$ ... $$´ after a ´\n´
- ´- ´ bullets, ´1. ´ numbered items (indent two spaces after ´\n´ to nest)
- ´# ´ headings and ´> ´ quotes inside the box

Text is never cut off; a box grows to fit. Keep each box to ONE idea:
if a box needs more than about six lines, split it into children.

When to use children and when to use lines inside a box:

- Children when each item has something more to say (its own why, how or
  example), or when the reader should see the items as parts of the structure.
- Lines inside one box when the items are short facts that belong together
  (a list of assumptions, the three values of a test, the steps of one
  calculation).

Links across branches: a map is a tree, so write a relation to another
branch inside the box, for example "Explains why one point can mislead (see
**Where it misleads**)".

## Step 4: Size and depth

- 12 to 40 boxes. The renderer draws at most 40 boxes and 5 levels.
- 3 to 7 children under a box. One child means the parent and child are
  the same idea: merge them. More than 7: group them under a new level.
- Most maps need 3 or 4 levels. A two-level map is usually a list in
  disguise: go one level deeper where the substance is.

## Step 5: Write the fence

The map is an indented outline in a fenced block. Indent two spaces per
level. One line is one box.

- ´ ´´´mindmap ´ draws radially from one centre box (the default; give it
  one root with 3 to 7 branches).
- ´ ´´´mindmap tree ´ draws left to right (good for procedures and long
  chains).
- ´ ´´´mindmap vertical ´ draws top down (good for wide, shallow maps).

After the map, explain it in prose: walk the main branches in a few
paragraphs and say how they connect. The map is the skeleton of the
answer, never the whole answer.

## A worked example

The user asks for a concept map of linear regression.

´´´mindmap
Linear regression
  **What it is.** A model of a response $y$ as a straight-line function of predictors, plus noise.\n$$y_i = \beta_0 + \beta_1 x_i + \varepsilon_i$$
    **The coefficients.** $\beta_1$ is the change in the expected $y$ for a one-unit change in $x$; $\beta_0$ is the expected $y$ at $x = 0$.
    **The noise term.** $\varepsilon_i$ collects everything the line does not explain; the model's assumptions are all about it.
  **How it is fitted.** Ordinary least squares picks the line that minimises the sum of squared residuals.
    **The estimates**\n$$\hat\beta_1 = \frac{\sum (x_i - \bar x)(y_i - \bar y)}{\sum (x_i - \bar x)^2}$$\n$\hat\beta_0 = \bar y - \hat\beta_1 \bar x$
    **Why squares.** Squaring makes every miss count, punishes large misses most, and gives a closed-form answer.
  **What it assumes.** The estimates are trustworthy only when these hold:\n1. The relationship is linear.\n2. Errors are independent.\n3. Errors have constant variance.\n4. For tests and intervals: errors are roughly normal.
    **Checking them.** Plot residuals against fitted values.\n- A curve means the relationship is not linear.\n- A funnel means the variance is not constant.\n- Clusters over time mean the errors are not independent.
    **When they fail.** Transform $y$ (for example $\log y$), add the missing predictor, or use weighted least squares for unequal variance.
  **How good is the fit.** Two different questions with two different answers.
    **Explained variation.** $R^2 = 1 - \frac{SS_{res}}{SS_{tot}}$ is the share of the variation in $y$ the line accounts for; a high $R^2$ does not prove the model is right.
    **Is the slope real?** The t-test on $\hat\beta_1$ asks whether the slope could be zero; a small p-value says the relationship is unlikely to be noise.
  **Where it misleads.** Most bad conclusions come from these three:\n- **Extrapolation.** The line is only checked inside the range of the data.\n- **Outliers.** One extreme point can tilt the whole line.\n- **Correlation is not causation.** A third factor can drive both $x$ and $y$.
´´´

What makes this map work:

- Every first-level box answers "what do I need to know about linear
  regression?", and the branches do not overlap.
- Each box below asks its own next question ("how is it fitted?" splits
  into the formula and the reason for it).
- The substance (formulas, the four assumptions, the three residual
  patterns, the remedies) sits inside the boxes in full sentences, not in
  the explanation afterwards.

## The mistake to avoid

This is what a weak map looks like:

´´´mindmap
Linear regression
  line
    slope
    intercept
  least squares
  assumptions
    normality
  R squared
  problems
´´´

It names topics without saying anything about them, mixes kinds of thing
under one parent, has a box with a single child, and leaves the reader
knowing no more than the title told them. Never send a map like this.

## Before you send: check

- [ ] The first-level question is clear, and every branch answers it.
- [ ] Siblings are the same kind of thing and do not overlap.
- [ ] No box has exactly one child.
- [ ] Every box is a full sentence or a bold lead plus sentences.
- [ ] Every formula, number and condition from the source is somewhere.
- [ ] 12 to 40 boxes, no deeper than 5 levels.
- [ ] Multi-line boxes use ´\n´; nothing is crammed into one long line.
- [ ] A prose explanation follows the map.
`.replace(/\u00b4/g, '`')],
]);
