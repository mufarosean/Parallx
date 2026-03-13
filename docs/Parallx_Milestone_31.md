# Milestone 31 — Attribution Truth Model

> Authoritative scope notice
>
> This document is the single source of truth for Milestone 31.
> All work that separates sources considered from sources used, strengthens
> attribution reliability, and rebalances transcript UI around trustworthy
> citations must conform to the architecture, research findings, and execution
> phases defined here.

---

## Table of Contents

1. Problem Statement
2. Product Goal
3. Current State Audit
4. Research Findings
5. Design Principles
6. Execution Plan
7. Task Tracker
8. Verification Checklist
9. Risks and Open Questions

---

## Problem Statement

Parallx currently exposes two different source surfaces in assistant turns:

1. the thinking/context block shows provenance for sources considered during the
   turn;
2. the footer `Sources:` line and inline citations show sources attached to the
   final answer.

These surfaces are visually similar but semantically different. That creates
three trust problems:

1. users can mistake "considered" for "used";
2. the footer can imply stronger attribution certainty than the pipeline has
   actually established;
3. the thinking box can dominate the transcript with large chip walls that are
   secondary to the actual answer.

This milestone fixes the contract first and the UI second.

---

## Product Goal

Parallx should make one thing obvious:

1. the footer is the authoritative list of sources the answer is attributing;
2. the thinking box is for reasoning and progress first;
3. considered-but-not-cited sources remain available for inspection, but hidden
   by default and visually secondary.

Operationally, "sources used" means:

1. explicitly cited by the final answer, or
2. attached by a deterministic grounded fallback that can trace the answer back
   to concrete source material.

Parallx must not silently promote "sources considered" into "sources used".

---

## Current State Audit

### What currently drives the thinking/context box

The transcript thinking box is rendered in
`src/built-in/chat/rendering/chatContentParts.ts`.

Its source section is derived from `part.provenance`, which is written during
turn preparation through:

1. `src/built-in/chat/utilities/chatContextAssembly.ts`
2. `src/built-in/chat/utilities/chatTurnContextPreparation.ts`
3. the response stream's provenance/reference folding in `chatService.ts`

This is closer to "what entered or influenced the turn context" than "what the
final answer actually cited".

### What currently drives the footer and inline citations

The footer and inline citation map are finalized through:

1. `src/built-in/chat/utilities/chatResponseValidator.ts`
2. `src/built-in/chat/utilities/chatTurnSynthesis.ts`
3. `src/built-in/chat/utilities/chatResponseParsingHelpers.ts`

Today, that path is primarily driven by `ragSources`, and in several fallback
paths it can still attach a broad source set to the answer rather than only the
explicitly attributable subset.

### Structural mismatch

The system therefore has two different contracts:

1. provenance contract: what the turn had available;
2. citation contract: what the answer surfaced as supporting material.

The current UI does not make that distinction clear enough.

---

## Research Findings

### Internal repo research

1. `docs/ai/CITATION_ATTRIBUTION_REDESIGN.md`
   - correctly identified that user trust breaks when retrieval provenance and
     visible attribution drift apart.
2. `docs/Parallx_Milestone_30.md`
   - introduced first-class provenance ownership for turn context, which is the
     right foundation for separating considered vs used.
3. `memories/repo/chat-rendering-notes.md`
   - captured that source visibility in the thinking block is a direct UI
     behavior choice, not just a data-model consequence.

### External research

1. Anthropic citations docs
   - separate citable content from non-citable metadata;
   - treat citations as valid pointers into source material rather than a loose
     prompt-based convention;
   - reinforce that trustworthy attribution requires explicit, structured ties
     from answer text back to source content.

2. Azure OpenAI file search docs
   - show a grounded-answer model where retrieval results are post-processed
     into explicit annotations/citations rather than relying on the user to infer
     what the model may have read;
   - reinforce that query rewriting, reranking, and considered context are
     retrieval internals, while the user-facing contract should be cited output.

### Research conclusion

The product should expose two clearly separated concepts:

1. `Sources Used` — authoritative, attributable, user-facing.
2. `Sources Considered` — secondary, diagnostic, hidden by default.

---

## Design Principles

1. Footer is authoritative.
2. Thinking is for reasoning first.
3. Considered sources must not dominate the transcript.
4. Attribution must degrade honestly.
5. Every grounded answer should move toward stricter source traceability, not
   looser heuristics.

### Near-term interpretation

In the near term, before the full attribution redesign lands:

1. keep the thinking box visible if there is reasoning/progress to show;
2. keep considered-source details collapsed by default;
3. reduce visual confusion between considered context and cited footer sources.

### Long-term target

1. all citeable context types share a unified source registry;
2. the answer emits or is repaired into validated citations;
3. the footer shows only attributable sources;
4. deterministic fallback paths attach source-backed citations rather than broad
   retrieval sets.

---

## Execution Plan

### Phase A — UI demotion of considered sources

- [x] Keep the thinking box visible, but collapse considered sources by default.
- [x] Rename the inner section to `Sources Considered` so it no longer reads as
      the authoritative answer footer.
- [x] Add regression coverage for the default collapsed state.
- [x] Validate the Phase A slice with focused tests, full unit suite, and build.

### Phase B — Citation contract hardening

- [ ] Audit every path that calls `setCitations(...)` and separate explicit
      answer citations from broad retrieval candidates.
- [ ] Stop treating all `ragSources` as equivalent to "sources used".
- [ ] Introduce a validated `usedSources` set derived from explicit references
      or deterministic fallback attribution.

### Phase C — Repair and fallback reliability

- [ ] Add a citation repair step for grounded answers that return uncited prose.
- [ ] Ensure deterministic/extractive fallbacks attach only traceable sources.
- [ ] Add coverage for uncited, mismatched, and fallback-generated answer paths.

### Phase D — Footer truth model

- [ ] Rename the footer surface to `Sources Used` once the contract is actually
      true in code.
- [ ] Add a secondary affordance for `Sources Considered` only when needed.
- [ ] Remove redundant transcript duplication between the thinking block and the
      footer.

---

## Task Tracker

- [x] Review current attribution pipeline
- [x] Research internal citation/provenance docs
- [x] Research external grounded-citation patterns
- [x] Write Milestone 31 document
- [x] Collapse thinking-block considered sources by default
- [x] Relabel transcript source section as `Sources Considered`
- [x] Validate the Phase A UI slice
- [ ] Separate used sources from considered sources in the citation pipeline
- [ ] Add citation repair/regeneration pass
- [ ] Validate footer as authoritative source-of-truth
- [ ] Complete focused and full validation for each execution phase

---

## Verification Checklist

- [x] Thinking sources render collapsed by default in transcript rendering
- [x] Focused chat tests pass for the Phase A slice
- [x] `npm run test:unit` passes for the Phase A slice
- [x] `npm run build` passes for the Phase A slice
- [ ] Full attribution redesign tests pass
- [ ] Build passes after citation contract hardening
- [ ] Full Vitest suite passes after milestone completion

---

## Risks and Open Questions

1. The current prompt-based citation approach is still weaker than structured
   model-native citation APIs, so Phase B must be strict about what counts as
   authoritative.
2. Some context types are provenance-visible today but not yet first-class
   citeable sources in the footer path.
3. The footer should only be renamed to `Sources Used` once the data contract is
   truly enforced, not earlier.
