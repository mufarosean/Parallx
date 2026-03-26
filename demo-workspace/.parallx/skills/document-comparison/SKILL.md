---
name: document-comparison
description: Compare two or more documents in detail, analyzing differences, contradictions, and similarities across multiple dimensions.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, comparison, analysis]
parameters:
  - name: targets
    type: string
    description: Names or paths of documents to compare
    required: true
---

# Document Comparison Workflow

Follow these steps precisely. Read every target document in full.

## Step 1: Identify target documents

Parse $ARGUMENTS to determine which documents to compare.
Use `list_files` and `search_knowledge` to locate them.
If the same filename exists in multiple folders, identify ALL instances.

## Step 2: Read each document

Use `read_file` to read the **complete content** of each document.
For each, note: path, length, structure, key claims/numbers/facts.

## Step 3: Analyze dimensions

Compare across:
1. **Structure**: Organization, sections, format
2. **Content overlap**: Shared topics
3. **Factual differences**: Different facts, numbers, dates
4. **Contradictions**: Direct conflicts (flag prominently)
5. **Unique content**: What exists in one but not the other

## Step 4: Synthesize comparison

1. **Documents compared**: List each with path
2. **Summary**: One paragraph overview
3. **Key differences**: Specific values from each document
4. **Contradictions**: Exact conflicting claims, citing both sources
5. **Similarities**: Shared content
6. **Unique content**: Per-document exclusive content

Always cite exact values. Present BOTH sides of contradictions.
