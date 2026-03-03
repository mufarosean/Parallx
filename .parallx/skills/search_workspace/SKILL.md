---
name: search_workspace
description: Search pages and blocks by text query. Returns matching page titles and content snippets.
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: query
    type: string
    description: Search text to match against page titles and content
    required: true
  - name: limit
    type: number
    description: Maximum number of results (default 10)
    required: false
tags: [canvas, search]
---

# search_workspace

Search pages and blocks by text query. Returns matching page titles and content snippets.

## Usage

Use this tool when you need to find specific content across the workspace's canvas pages. Provide a text query and optionally limit the number of results.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `query`   | string | yes      | Search text to match against page titles and content |
| `limit`   | number | no       | Maximum number of results (default: 10) |

## Example

```json
{
  "query": "project roadmap",
  "limit": 5
}
```
