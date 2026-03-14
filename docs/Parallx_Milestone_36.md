# Milestone 36 — Non-Autonomous AI Alignment Gaps

> Authoritative scope notice
>
> This document is the single source of truth for Milestone 36.
> Its purpose is to capture the remaining non-autonomous AI gaps between
> Parallx and the OpenClaw model, so future work can be discussed and planned
> against a concrete, product-level audit rather than vague architectural
> intuition.

---

## Table of Contents

1. Problem Statement
2. Scope
3. Current Strengths
4. Priority Summary
5. Verified Remaining Gaps
6. Gap Severity Ranking
7. Target Product Contract
8. Execution Plan
9. Open Questions

---

## Problem Statement

Parallx has made major progress toward an OpenClaw-like non-autonomous AI
model:

1. local-first model execution is in place;
2. prompt-file layering exists;
3. canonical markdown memory is now the user-facing memory source of truth;
4. transcript state is separated from durable memory;
5. explicit memory and transcript tools exist.

However, the system is still not fully aligned with OpenClaw outside of
autonomous/agentic behavior.

The most important remaining problem is not that the AI itself is failing to be
a “second brain”.

The second brain is the workspace corpus: pages, files, canonical memory,
transcripts, and other durable knowledge artifacts.

The AI is the access and reasoning layer over that corpus.

That means the real product risk is retrieval-contract failure:

1. the AI can retrieve from the wrong knowledge lane;
2. it can mix lanes invisibly;
3. the user may not understand why an answer came from a given source;
4. when retrieval is wrong, trust in the whole second-brain experience drops.

The remaining gaps are therefore best understood as retrieval, provenance, and
knowledge-lane clarity problems first, and OpenClaw-parity problems second.

Milestone 36 is not about autonomy, agents, tool loops, or multi-step planning.
It is about the non-autonomous AI contract the user experiences in normal chat,
grounded Q&A, prompt layering, memory, transcript recall, provenance, and
settings.

---

## Scope

### In scope

1. retrieval-lane routing between current page, attachments, workspace
   retrieval, durable memory, daily memory, and transcripts;
2. prompt-file authority and settings precedence where they affect retrieval
   trust and product coherence;
3. canonical memory and transcript usage outside autonomous tool loops;
4. transcript recall quality and product honesty;
5. provenance and user-facing trust in answer sourcing;
6. user-facing consistency of the non-autonomous AI experience.

### Out of scope

1. autonomous agent loops and tool orchestration;
2. multi-agent workflows;
3. autonomous planning quality;
4. deployment, hosting, or cloud AI concerns.

---

## Current Strengths

Parallx is already strong in the following non-autonomous AI areas:

1. **Local-first execution**
   - Ollama-backed local models are a real product contract, not a thin demo.

2. **Prompt-file layering**
   - `SOUL.md`, `AGENTS.md`, `TOOLS.md`, and scoped rules exist and are wired.

3. **Canonical markdown memory**
   - `.parallx/memory/MEMORY.md` and `.parallx/memory/YYYY-MM-DD.md` are now
     the user-facing memory source of truth.

4. **Explicit memory and transcript tools**
   - `memory_search`, `memory_get`, `transcript_search`, and `transcript_get`
     exist as explicit product surfaces.

5. **Rich IDE-like product surface**
   - AI Settings, model selection, diff-based edit review, and retrieval-backed
     workspace Q&A are stronger than a bare OpenClaw-like shell.

These strengths matter because Milestone 36 is not a rescue milestone.
It is a coherence and product-contract milestone.

---

## Priority Summary

Milestone 36 should not treat all gaps as equally important.

The top three product-critical priorities are:

1. **Retrieval-lane contract**
   - define which knowledge lane should answer which class of question;
   - reduce wrong-source answers caused by implicit routing.

2. **Provenance and source-lane visibility**
   - make it clearer why an answer came from workspace docs, memory, daily
     notes, or transcripts;
   - improve trust without turning the UI into a debug console.

3. **Exact and structured retrieval strength**
   - improve high-precision asks involving names, numbers, identifiers,
     configuration keys, clauses, dates, and table-like evidence.

Everything else in this milestone is secondary to those three priorities.

In particular, some OpenClaw-parity items remain useful reference points, but
they are not first-order product risks for Parallx if retrieval and provenance
remain weak.

---

## Verified Remaining Gaps

### 1. Knowledge-lane routing is still too implicit

Parallx has the right data lanes, but the routing contract between them is not
yet explicit enough at the product level.

The system should clearly distinguish between:

1. current page;
2. attached files;
3. workspace retrieval;
4. durable memory;
5. daily memory;
6. transcript recall.

Why it matters:

1. many retrieval failures are routing failures, not ranking failures;
2. if the wrong lane competes too early, the answer can feel arbitrary or
   contaminated;
3. users lose trust when the system answers from a plausible but wrong source.

### 2. Provenance is still too thin

Parallx has citations and explicit tool surfaces, but it still does not make
source-lane choice visible enough in the final user experience.

Why it matters:

1. users need to trust not just the answer, but the path by which the answer
   was formed;
2. retrieval trust improves when the product can show whether an answer came
   from workspace docs, memory, daily logs, or transcripts;
3. provenance is one of the most effective ways to make a second-brain product
   feel reliable.

### 3. Prompt authority is still ambiguous

Parallx currently allows AI Settings system prompt configuration to override the
workspace file-driven prompt overlay.

This weakens the file-first model.

Why it matters:

1. OpenClaw's model is much more clearly workspace-file-driven;
2. users can no longer easily reason about which layer truly owns behavior;
3. the system risks saying “files are canonical” while still letting GUI state
   become the effective source of truth for instructions.

### 4. Transcript search is weaker than the product wording implies

Parallx exposes transcript recall as an explicit tool surface, which is good.
But the current transcript search implementation is still lightweight lexical
matching over transcript-rendered text rather than a stronger semantic/indexed
recall path.

Why it matters:

1. product language can outrun implementation reality;
2. users may reasonably expect better transcript recall quality than the current
   implementation delivers;
3. transcript recall is one of the explicit access lanes into the second brain,
   so quality and honesty matter directly.

### 5. Exact and structured retrieval behavior still needs to be stronger

Users often ask about narrow, high-precision targets:

1. names;
2. numbers;
3. policy values;
4. config keys;
5. code identifiers;
6. table entries;
7. dates and thresholds.

Why it matters:

1. semantic retrieval alone is not enough for these asks;
2. trust suffers when the system lands on adjacent concepts rather than the
   exact field or clause the user asked for;
3. a second-brain access layer must be especially strong at exact retrieval.

### 6. Session-start semantics are still less explicit than they should be

Parallx has improved fresh-session behavior by reducing automatic memory
injection, but it still does not have a formal session-start contract equivalent
to OpenClaw's explicit startup read pattern.

Why it matters:

1. startup semantics remain implicit rather than explainable;
2. continuity policy is safer than before but not yet principled enough;
3. the product lacks a deterministic answer to “what does the assistant load at
   the beginning of a new session, and why?”

### 7. Session state is still somewhat hybrid

Parallx has separated memory and transcript layers better than before, but the
overall session model still mixes database-era chat persistence, canonical
memory files, transcript files, and retrieval-oriented runtime behavior.

Why it matters:

1. the architecture is better than before but not fully clean;
2. product behavior can still feel stitched together rather than singular;
3. some fallback logic still exists because the migration is not fully retired.

### 8. No compaction-aware durable memory flush contract

OpenClaw's model includes a stronger story around explicit durable-memory
persistence before context compaction.

Parallx has write-back and compaction-related features, but not the same clear
contract.

Why it matters:

1. the system still relies too much on “best-effort post-turn write-back”;
2. long-session continuity is less explicit and less inspectable than it could
   be;
3. users do not yet get the same clear durable-memory persistence guarantees.

### 9. Migration success is improved but still not strongly surfaced

Legacy-workspace normalization is now more robust, but the product still lacks a
simple user-facing signal that says whether workspace memory has been fully
normalized into canonical markdown.

Why it matters:

1. trust is stronger when migration state is inspectable;
2. old-workspace confidence is still partly inferred rather than explicit;
3. support/debugging is harder without a visible normalization status.

---

## Gap Severity Ranking

From highest product impact to lowest:

1. **Knowledge-lane routing clarity**
2. **Provenance and source-lane visibility**
3. **Prompt authority ambiguity**
4. **Transcript search quality / product honesty gap**
5. **Exact and structured retrieval strength**
6. **Missing explicit session-start contract**
7. **Hybrid session-state model**
8. **Missing compaction-aware durable memory flush contract**
9. **Weak migration-status surfacing**

Practical interpretation:

1. items 1–3 are the work most likely to change what the user actually feels;
2. items 4–6 are important correctness and consistency work;
3. items 7–9 are secondary cleanup and trust-completeness work.

This ordering is intentional:

1. the top risks are the ones users feel directly as “the AI answered from the
   wrong part of my knowledge base”;
2. the next tier covers trust, instruction authority, and transcript honesty;
3. the later items still matter, but they are less central to everyday
   second-brain access quality.

---

## Target Product Contract

After Milestone 36, Parallx's non-autonomous AI should satisfy the following
contract:

1. **The AI behaves as a trustworthy access layer to the second brain**
   - the system routes questions to the right knowledge lane;
   - lane competition is controlled rather than accidental;
   - the user can trust that the answer came from the right part of the corpus.

2. **Source-lane provenance is visible enough to build trust**
   - users can tell whether an answer came from workspace docs, durable memory,
     daily memory, or transcripts.

3. **Workspace prompt files have a principled authority model**
   - users can understand exactly how `SOUL.md`, `AGENTS.md`, `TOOLS.md`,
     scoped rules, and AI Settings interact;
   - Parallx does not silently undermine the file-first model.

4. **Exact and structured asks are handled with high precision**
   - names, numbers, identifiers, fields, clauses, and table values are not
     left entirely to broad semantic retrieval.

5. **New sessions have a deterministic startup policy**
   - the product can state what is read at session start, what is not read, and
     under what conditions memory or transcript layers enter the conversation.

6. **Transcript recall is accurately described and appropriately powered**
   - either it becomes stronger and more semantic, or the product description is
     tightened to match reality.

7. **The non-autonomous AI model feels singular rather than hybrid**
   - chat, memory, transcript recall, prompt files, and retrieval all behave as
     one coherent system.

8. **Existing workspaces remain first-class**
   - migration and normalization are trustworthy, inspectable, and non-fragile.

---

## Execution Plan

### Phase A — Retrieval-lane contract

- [ ] Define the explicit routing contract between current-page context,
   attachments, workspace retrieval, durable memory, daily memory, and
   transcripts.
- [ ] Identify where current routing is heuristic, implicit, or inconsistent.
- [ ] Define which user intents should prefer which lane first.

Why this phase is first:

1. many “retrieval quality” failures are really lane-selection failures;
2. this work should happen before another round of generic ranking tuning.

### Phase B — Provenance and trust

- [ ] Define the minimum viable provenance surface for non-autonomous answers.
- [ ] Decide how source-lane identity should appear in the user experience.
- [ ] Ensure provenance clarifies lane choice without turning into a noisy debug
   panel.

Why this phase is second:

1. even correct retrieval is less trustworthy when the source lane is opaque;
2. provenance is the shortest path from internal correctness to user trust.

### Phase C — Prompt authority

- [ ] Audit the exact precedence rules between AI Settings prompt fields and
      prompt-file overlays.
- [ ] Decide and document the intended authority model.
- [ ] Rework the implementation if the current precedence violates the intended
      file-first product contract.

### Phase D — Exact and structured retrieval

- [ ] Audit how narrow factual queries currently retrieve names, numbers,
   identifiers, and table-like evidence.
- [ ] Decide which exact-match and structured boosts belong in the generic
   retrieval path versus specialized routing.
- [ ] Add focused coverage for narrow, high-precision asks that should not be
   answered from adjacent semantic matches.

Why this phase is still top-tier:

1. users strongly notice failures on specific factual asks;
2. exactness is central to a trustworthy second-brain access layer.

### Phase E — Session startup semantics

- [ ] Define the explicit non-autonomous session-start contract.
- [ ] Decide whether Parallx should read any memory layers automatically at
      startup, and if so, which ones.
- [ ] Align runtime behavior and product guidance with that contract.

Priority note:

1. this matters, but it is lower priority than routing, provenance, and exact
   retrieval quality;
2. OpenClaw parity here should be treated as a reference, not an absolute goal.

### Phase F — Transcript recall honesty and quality

- [ ] Audit transcript search quality against its product description.
- [ ] Decide whether to strengthen transcript recall or narrow the product
      language.
- [ ] Ensure transcript recall remains clearly separate from canonical memory.

### Phase G — Coherence and trust

- [ ] Audit remaining hybrid session-state seams that users can feel.
- [ ] Decide whether a migration/normalization status surface is needed.
- [ ] Update user-facing docs once the contract is final.

---

## Implementation Guidance

When selecting the first implementation slice for Milestone 36, prefer work
that changes user trust in this order:

1. source-lane routing before ranking tweaks;
2. provenance before new memory UI;
3. exact retrieval before startup ritual parity;
4. user-facing trust improvements before deeper architectural cleanup that the
   user cannot feel.

---

## Open Questions

1. Should AI Settings ever be allowed to fully override prompt-file authority,
   or should prompt files remain the dominant workspace-local instruction layer?
2. How explicit should lane routing be in the product: internal policy only, or
   partially user-visible?
3. What is the smallest provenance surface that materially improves trust
   without cluttering the chat experience?
4. Should Parallx adopt a visible session-start routine closer to OpenClaw, or
   keep a lighter-weight fresh-session policy?
5. Should transcript search become truly semantic/indexed, or stay lightweight
   and be described more narrowly?
6. Is a user-visible migration-status surface worth the extra product surface
   area, or should this remain a diagnostic-only concern?

---

## Implementation Log

### 2026-03-14 — First retrieval-lane routing slice

Completed in this slice:

1. introduced a first-class `transcript-recall` route in the chat lane
   contract instead of relying on a late regex heuristic during context
   preparation;
2. wired transcript recall intent through `IChatContextPlan` so the routing
   decision, context planner, and source loader agree on lane choice;
3. fixed route precedence so explicit transcript-history questions win over the
   broader memory-recall matcher;
4. added focused regression coverage in the chat turn prelude tests.

Focused validation completed:

1. `npm run test:unit -- chatTurnPrelude.test.ts chatDataServiceMemoryRecall.test.ts chatViewerOpeners.test.ts` ✅