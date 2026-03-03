---
name: list_pages
description: List all pages in the workspace with their titles and IDs.
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: limit
    type: number
    description: Maximum number of pages to return (default 50)
    required: false
tags: [canvas, list]
---

# list_pages

List all pages in the workspace with their titles and IDs.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `limit`   | number | no       | Maximum number of pages to return (default: 50) |
