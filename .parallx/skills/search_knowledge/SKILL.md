---
name: search_knowledge
description: Semantic search across all indexed knowledge (canvas pages and workspace files). Returns the most relevant chunks with source attribution.
version: 1.0.0
author: parallx
permission: always-allowed
parameters:
  - name: query
    type: string
    description: Natural language search query
    required: true
  - name: source_filter
    type: string
    description: "Optional filter: page_block for canvas pages only, file_chunk for workspace files only"
    required: false
tags: [rag, search]
---

# search_knowledge

Semantic search across all indexed knowledge (canvas pages and workspace files). Use this when you need to find information beyond what is already provided in the context. Returns the most relevant chunks with source attribution.

## Parameters

| Parameter       | Type   | Required | Description |
|-----------------|--------|----------|-------------|
| `query`         | string | yes      | Natural language search query |
| `source_filter` | string | no       | Optional filter: `page_block` for canvas pages only, `file_chunk` for workspace files only |
