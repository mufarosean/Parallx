---
name: document-comparison
description: >
  Compare two or more documents in detail. Reads each document fully,
  analyzes them across multiple dimensions (structure, content, claims,
  data), and produces a structured comparison highlighting similarities,
  differences, and contradictions.
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

You are executing the **document-comparison** skill. Follow these steps
precisely. Read every target document in full — do not compare from
summaries or memory.

## Step 1: Identify target documents

Parse $ARGUMENTS to determine which documents to compare.

- If specific filenames are given, use `search_knowledge` or `list_files`
  to locate them.
- If the user refers to documents by description (e.g. "the two policy
  files"), use `list_files` and `search_knowledge` to identify them.
- If the same filename exists in multiple folders, identify ALL instances
  and ask the user to clarify, or compare all instances.

Record the full paths of all documents to compare.

## Step 2: Read each document

Use `read_file` to read the **complete content** of each target document.
Do not truncate or skip sections.

For each document, note:
- File path
- Length (approximate line count)
- Structure (headings, sections, format)
- Key claims, numbers, and facts

## Step 3: Analyze dimensions

Compare the documents across these dimensions:

1. **Structure**: How are they organized? Same sections? Different format?
2. **Content overlap**: What topics do they share?
3. **Factual differences**: Where do they state different facts, numbers,
   or dates?
4. **Contradictions**: Where do they directly contradict each other?
   (Flag these prominently.)
5. **Unique content**: What exists in one document but not the other?

## Step 4: Synthesize comparison

Present the comparison in this structure:

1. **Documents compared**: List each with path and brief description
2. **Summary**: One paragraph overview of the relationship
3. **Key differences**: Bullet list of factual differences with specific
   values from each document
4. **Contradictions**: Highlighted section with exact conflicting claims,
   citing both sources
5. **Similarities**: Shared content and agreement
6. **Unique content**: What each document covers that the other doesn't

## Important notes

- Always cite exact values, not vague descriptions ("$500" not "a deductible")
- When documents contradict, present BOTH values — do not pick a winner
- If documents are different versions of the same thing, note version differences
- Use [N] citation notation linking to each document
