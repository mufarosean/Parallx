---
name: edit_file
description: Edit an existing file by replacing a specific substring. The old content must match exactly (whitespace-sensitive). Requires user approval.
version: 1.0.0
author: parallx
permission: requires-approval
parameters:
  - name: path
    type: string
    description: Relative file path from workspace root
    required: true
  - name: old_content
    type: string
    description: The exact existing content to find and replace (must match exactly)
    required: true
  - name: new_content
    type: string
    description: The new content to replace it with
    required: true
tags: [filesystem, write]
---

# edit_file

Edit an existing file by replacing a specific substring. Provide the exact old content to replace and the new content. The old content must match exactly (whitespace-sensitive). Use `read_file` first to get the current content. Requires user approval.

## Parameters

| Parameter     | Type   | Required | Description |
|---------------|--------|----------|-------------|
| `path`        | string | yes      | Relative file path from workspace root |
| `old_content` | string | yes      | The exact existing content to find and replace (must match exactly) |
| `new_content` | string | yes      | The new content to replace it with |
