---
name: read_page_by_title
description: Read a page by its title. Performs case-insensitive matching. If multiple pages match, returns the most recently updated one.
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: title
    type: string
    description: The page title to search for (case-insensitive)
    required: true
tags: [canvas, read]
---

# read_page_by_title

Read a page by its title. Performs case-insensitive matching. If multiple pages match, returns the most recently updated one.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `title`   | string | yes      | The page title to search for (case-insensitive) |
