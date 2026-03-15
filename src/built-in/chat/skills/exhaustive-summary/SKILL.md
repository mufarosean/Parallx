---
name: exhaustive-summary
description: >
  Summarize every file in a folder or the entire workspace. Reads each
  file individually and produces a per-file summary, then combines them
  into a comprehensive overview. Ensures no file is omitted.
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

You are executing the **exhaustive-summary** skill. Follow these steps
precisely. Do not skip any step. Do not summarize from memory — read every
file.

## Step 1: Enumerate all files

Use `list_files` to enumerate every file in the target scope ($ARGUMENTS or
the entire workspace root if no scope is specified).

- If the scope is a folder, list only that folder (recursively).
- If no scope is given, list the entire workspace root.
- Record the complete list of files. This is your **coverage checklist**.

## Step 2: Read each file

For **every** file in the coverage checklist:

1. Use `read_file` to read the file's full content.
2. Write a brief summary (2-4 sentences) of the file's content.
3. Note the file's relative path.

Do NOT skip files. Do NOT say a file is "too large to read." Every file
must be read and summarized.

If a file is very short (< 3 lines), note it as a stub and describe what
little content it has.

If a file contains irrelevant content (personal notes, off-topic material),
still summarize it but note that it appears unrelated to the workspace's
main topic.

## Step 3: Compile the summary

Present the summaries in a structured format:

1. **Overview**: One paragraph describing the workspace/folder's purpose
   based on what you read.
2. **File summaries**: A list of every file with:
   - File path (as a heading or bold text)
   - 2-4 sentence summary
   - Any notable characteristics (stub, draft, contradictions, etc.)
3. **Statistics**: Total file count, folder count, any notable patterns.

## Step 4: Verify coverage

Compare your summary list against the coverage checklist from Step 1.
If any file is missing from your summary, go back and read it now.

State: "Coverage: X/Y files summarized" where X = files you summarized and
Y = total files from Step 1. X must equal Y.

## Important notes

- Contradictions between files should be noted, not silently resolved.
- Near-empty files should be acknowledged, not skipped.
- Cite each file using [N] notation linked to its path.
- If a folder has subfolders, list files under their folder paths.
