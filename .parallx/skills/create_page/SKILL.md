---
name: create_page
description: Create a new page in the workspace with a title and optional content.
version: 1.0.0
author: parallx
permission: requires-approval
parameters:
  - name: title
    type: string
    description: Page title
    required: true
  - name: content
    type: string
    description: Initial text content for the page (plain text)
    required: false
  - name: icon
    type: string
    description: Page icon emoji
    required: false
tags: [canvas, write]
---

# create_page

Create a new page in the workspace with a title and optional content. Requires user approval before execution.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `title`   | string | yes      | Page title |
| `content` | string | no       | Initial text content for the page (plain text) |
| `icon`    | string | no       | Page icon emoji |
