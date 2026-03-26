---
name: deep-research
description: Perform a thorough multi-pass investigation across all workspace files. Sweep every folder, read every relevant file, cross-reference findings, and produce a structured research report with citations.
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: true
tags: [workflow, research, exhaustive, analysis]
parameters:
  - name: question
    type: string
    description: The research question or topic to investigate
    required: true
  - name: scope
    type: string
    description: Folder path to limit the research scope, or empty for entire workspace
    required: false
---

# Deep Research Workflow

Follow these steps precisely. Be thorough — the goal is to leave no relevant file unread.

## Step 1: Define scope and research plan

Restate the user's research question in your own words.
Identify the key concepts, entities, and relationships you need to investigate.
If a scope was provided, note the target folder; otherwise the scope is the entire workspace.

## Step 2: Sweep the workspace

Use `list_files` recursively to enumerate every file and folder within the scope.
Record the complete file list as your **investigation checklist**.
Group files by topic or folder to plan your reading order.

## Step 3: Systematic reading pass

For **every** file in the investigation checklist:
1. Use `read_file` to read the full content.
2. Extract facts, definitions, relationships, and data points relevant to the research question.
3. Note the source file for each finding.

Mark each file as read on your checklist. Do not skip files—even if a filename seems irrelevant, skim it to confirm.

## Step 4: Cross-reference and synthesize

Compare findings across files:
- Identify **agreements** — facts that multiple sources confirm.
- Identify **contradictions** — places where sources disagree.
- Identify **gaps** — questions the files do not answer.
- Trace **relationships** — how entities, processes, or policies connect across documents.

## Step 5: Produce the research report

Structure your response as:

1. **Research Question** — restate the question.
2. **Key Findings** — numbered list of the most important discoveries, each citing `[source-file]`.
3. **Cross-Reference Analysis** — agreements, contradictions, and relationships found across files.
4. **Gaps & Limitations** — what the workspace files do not answer.
5. **Conclusion** — a concise synthesis answering the original question.

Every factual claim must include a file citation.
