---
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

Use `list_files` to list all files and subfolders in $ARGUMENTS or the workspace root.
Record total file count, subfolder names, and file names.

## Step 2: Classify files

For each file, use `read_file` to read the first ~20 lines. Determine:
- **Type**: based on extension
- **Purpose**: brief description based on content

## Step 3: Build the overview

1. **Folder**: Name and path
2. **Contents**: Total files, total subfolders
3. **File listing**: Each file with name, type, and 1-sentence description
4. **Subfolders**: List contents one level deep

## Step 4: Note issues

Flag: empty/stub files, duplicate filenames, inconsistent naming, drafts.
