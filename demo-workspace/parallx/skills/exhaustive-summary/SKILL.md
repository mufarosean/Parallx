---
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

Use `list_files` to enumerate every file in the target scope ($ARGUMENTS or the entire workspace root).
Record the complete list as your **coverage checklist**.

## Step 2: Read each file

For **every** file in the coverage checklist:
1. Use `read_file` to read the full content.
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
