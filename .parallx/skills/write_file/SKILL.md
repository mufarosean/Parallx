---
name: write_file
description: Write (create or overwrite) a file in the workspace. Validates path against .parallxignore sandbox rules. Requires user approval.
version: 1.0.0
author: parallx
permission: requires-approval
parameters:
  - name: path
    type: string
    description: Relative file path from workspace root
    required: true
  - name: content
    type: string
    description: The full file content to write
    required: true
tags: [filesystem, write]
---

# write_file

Write (create or overwrite) a file in the workspace. Path is relative to the workspace root. Validates the path against `.parallxignore` sandbox rules before writing. Requires user approval.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `path`    | string | yes      | Relative file path from workspace root |
| `content` | string | yes      | The full file content to write |
