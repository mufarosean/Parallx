---
name: read_file
description: Read the text content of a workspace file. Path is relative to workspace root. Max 50 KB.
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: path
    type: string
    description: Relative file path from workspace root
    required: true
tags: [filesystem, read]
---

# read_file

Read the text content of a workspace file. Path is relative to the workspace root. Maximum 50 KB.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `path`    | string | yes      | Relative file path from workspace root |
