---
name: get_page_properties
description: Get metadata and database properties of a page including title, icon, creation date, and block count.
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: pageId
    type: string
    description: The page UUID
    required: true
tags: [canvas, read]
---

# get_page_properties

Get metadata and database properties of a page including title, icon, creation date, and block count.

## Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `pageId`  | string | yes      | The page UUID |
