---
name: read_page
description: Read the full content of a page by its ID or title. Accepts a page UUID or a page title (case-insensitive match).
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: pageId
    type: string
    description: The page UUID or page title
    required: true
tags: [canvas, read]
---

# read_page

Read the full content of a page by its ID or title. Accepts a page UUID or a page title (case-insensitive match). Returns the page title and text content.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `pageId`  | string | yes      | The page UUID or page title |
