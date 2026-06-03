---
name: folder-overview
description: >
  Produce a structural overview of a folder — file count, file types,
  folder hierarchy, and a one-line purpose per file. Use when the user
  asks how a folder is organized or what's in it at a glance, without
  needing deep content. For per-file detailed summaries use
  exhaustive-summary; for extracting specific facts use scoped-extraction.
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

You are executing the **folder-overview** skill. Follow these steps
precisely.

## Step 1: Enumerate the folder

Use `fs_list_files` to list all files and subfolders in the target folder
($ARGUMENTS or the workspace root if no folder is specified).

Record:
- Total file count
- Subfolder names
- File names with extensions

## Step 2: Classify files

For each file, determine:
- **Type**: based on extension (.md = markdown, .json = config, .pdf = document, etc.)
- **Size category**: stub (< 3 lines), small, medium, large (estimated from content)
- **Purpose**: brief description based on filename and a quick read

Use `fs_read_file` to read the first ~20 lines of each file to understand its purpose.
For very short files, read the entire content.

## Step 3: Build the overview

Present the overview in this structure:

1. **Folder**: Name and path
2. **Contents**: Total files, total subfolders
3. **File listing**: Table or list with:
   - File name
   - Type/extension
   - Brief description (1 sentence)
4. **Subfolders**: For each subfolder, recurse and list its contents
   (one level deep is sufficient unless the user specified otherwise)

## Step 4: Note any issues

Flag any notable patterns:
- Empty or stub files
- Duplicate filenames in different subfolders
- Inconsistent naming conventions
- Files that appear to be drafts or incomplete
