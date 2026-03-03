---
name: list_files
description: List files and directories at a workspace path. Returns name, type (file/directory), and size.
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: path
    type: string
    description: Relative directory path (default workspace root ".")
    required: false
tags: [filesystem, list]
---

# list_files

List files and directories at a workspace path. Returns name, type (file/directory), and size. Path is relative to the workspace root.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `path`    | string | no       | Relative directory path (default: workspace root ".") |
