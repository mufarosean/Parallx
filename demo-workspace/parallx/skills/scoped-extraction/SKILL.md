---
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

Use `list_files` to enumerate all files in scope.
Record the complete file list as your coverage checklist.

## Step 3: Read and extract

For **every** file in the checklist:
1. Use `read_file` to read the content.
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
