/**
 * Default SKILL.md file contents — written to `.parallx/skills/` during
 * workspace initialization. These are the canonical source-of-truth for
 * the default skills that ship with every Parallx workspace.
 *
 * Users get these automatically via `/init`. They can edit or delete them.
 * The skill scanner picks them up from disk like any other workspace skill.
 */

/** Map of skill-name → SKILL.md file content. */
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

Use \`list_files\` recursively to enumerate every file and folder within the scope.
Record the complete file list as your **investigation checklist**.
Group files by topic or folder to plan your reading order.

## Step 3: Systematic reading pass

For **every** file in the investigation checklist:
1. Use \`read_file\` to read the full content.
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

Use \`list_files\` to enumerate all files in scope.
Record the complete file list as your coverage checklist.

## Step 3: Read and extract

For **every** file in the checklist:
1. Use \`read_file\` to read the content.
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

Use \`list_files\` to list all files and subfolders in $ARGUMENTS or the workspace root.
Record total file count, subfolder names, and file names.

## Step 2: Classify files

For each file, use \`read_file\` to read the first ~20 lines. Determine:
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
Use \`list_files\` and \`search_knowledge\` to locate them.
If the same filename exists in multiple folders, identify ALL instances.

## Step 2: Read each document

Use \`read_file\` to read the **complete content** of each document.
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

Use \`list_files\` to enumerate every file in the target scope ($ARGUMENTS or the entire workspace root).
Record the complete list as your **coverage checklist**.

## Step 2: Read each file

For **every** file in the coverage checklist:
1. Use \`read_file\` to read the full content.
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

Use \`run_command\` to run: \`git status --short\`

Record: staged files (A/M/D), unstaged changes, untracked files.

## Step 2: Recent commits

Use \`run_command\` to run: \`git log --oneline -10\`

Record the last 10 commits with short hashes and messages.

## Step 3: Current branch

Use \`run_command\` to run: \`git branch --show-current\`

## Step 4: Show diff (if detail = "full")

If the user requested full detail:
Use \`run_command\` to run: \`git diff --stat\`

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

Use \`run_command\` to run: \`curl -sL --max-time 15 "$URL"\`

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
Use \`list_files\` to verify the file exists.

## Step 2: Extract content

Use \`read_file\` on the PDF path. Docling integration will automatically extract the text.

## Step 3: Present results

1. **File**: The PDF path
2. **Pages**: Number of pages (if available)
3. **Content**: The extracted text

If extraction fails (e.g., scanned image PDF without OCR), report the limitation.
`],
]);
