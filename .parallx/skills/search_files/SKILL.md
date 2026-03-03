---
name: search_files
description: Find files in the workspace matching a name pattern (case-insensitive substring match). Max depth 5, max 50 results.
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: pattern
    type: string
    description: Substring to match against file/directory names (case-insensitive)
    required: true
  - name: path
    type: string
    description: Relative directory to search within (default workspace root ".")
    required: false
tags: [filesystem, search]
---

# search_files

Find files in the workspace matching a name pattern (case-insensitive substring match). Returns relative paths. Max depth 5, max 50 results.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `pattern` | string | yes      | Substring to match against file/directory names (case-insensitive) |
| `path`    | string | no       | Relative directory to search within (default: workspace root ".") |
