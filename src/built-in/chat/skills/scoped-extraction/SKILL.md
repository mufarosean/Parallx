---
name: scoped-extraction
description: >
  Extract specific information from all files in a scope. Reads every
  file in the target folder or workspace, extracts the requested facts
  or values, and aggregates them into a structured result. Ensures
  exhaustive coverage across all files.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, extraction, exhaustive]
parameters:
  - name: query
    type: string
    description: What information to extract and from which scope
    required: true
---

# Scoped Extraction Workflow

You are executing the **scoped-extraction** skill. Follow these steps
precisely. Do not skip files — every file in scope must be checked.

## Step 1: Parse the extraction request

From $ARGUMENTS, determine:
- **What** to extract (e.g. "deductible amounts", "contact names", "dates")
- **Where** to look (specific folder, file type, or entire workspace)

If the scope is unclear, default to the entire workspace.

## Step 2: Enumerate files in scope

Use `list_files` to enumerate all files in the target scope.
Record the complete file list as your coverage checklist.

## Step 3: Read and extract from each file

For **every** file in the coverage checklist:

1. Use `read_file` to read the file's content.
2. Search for instances of the target information.
3. If found, record:
   - The extracted value(s)
   - The file path where it was found
   - The context (surrounding text, section heading)
4. If NOT found in this file, note: "No matching information in [file]"

Do NOT skip files. Even if you think a file is unlikely to contain the
target information, read it and check.

## Step 4: Aggregate results

Present the extracted information in a structured format:

1. **Extraction target**: What was searched for
2. **Scope**: What files/folders were searched
3. **Results**: Table or list with:
   - Value found
   - Source file (with path)
   - Context snippet
4. **Files with no matches**: List files that were checked but contained
   no relevant information
5. **Coverage**: "Checked X/Y files" (X must equal Y)

## Step 5: Identify conflicts

If the same type of information has different values in different files:
- Flag the conflict prominently
- Show both values with their source files
- Do not silently pick one value over another

## Important notes

- Completeness over speed — check every file, no exceptions
- Cite sources using [N] notation
- If a value appears approximate or uncertain, note the uncertainty
- Distinguish between "not found" (checked, absent) and "not checked"
  (should never happen)
