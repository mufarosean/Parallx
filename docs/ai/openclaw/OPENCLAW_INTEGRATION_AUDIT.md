# OpenClaw Integration Audit — Current Parallx State

**Date:** 2026-03-25  
**Scope:** Full line-by-line audit of all files in `src/openclaw/`  
**Upstream reference:** `OPENCLAW_REFERENCE_SOURCE_MAP.md`, `OPENCLAW_PIPELINE_REFERENCE.md`

---

## Files Audited

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 1 | `openclawDefaultRuntimeSupport.ts` | ~1750 | Monolith: commands, routing, context assembly, prompt, response repair |
| 2 | `openclawTypes.ts` | ~200+ | Type definitions for runtime, traces, tools, config |
| 3 | `openclawParticipantServices.ts` | ~100+ | Adapter deps interfaces, service builder |
| 4 | `openclawToolLoopSafety.ts` | ~50 | Tool call dedup/loop detection |
| 5 | `participants/openclawDefaultParticipant.ts` | ~1000+ | Main turn handler, finalization, workflow answers, tool loop |
| 6 | `participants/openclawParticipantRuntime.ts` | ~400+ | Bootstrap context, seed messages, model turn execution |
| 7 | `participants/openclawWorkspaceParticipant.ts` | — | Workspace surface participant |
| 8 | `participants/openclawCanvasParticipant.ts` | — | Canvas surface participant |
| 9 | `participants/openclawContextReport.ts` | — | /context command, prompt artifacts |
| 10 | `openclawWorkspaceDocumentListing.ts` | — | Document listing handler |
| 11 | `registerOpenclawParticipants.ts` | — | Registration entry point |

---

## Detailed Audit: `openclawDefaultRuntimeSupport.ts`

### Section 1: Hardcoded Routing Terms (L25-75)

**What it does:** Defines regex patterns for:
- `OPENCLAW_WORKSPACE_ROUTING_TERMS` — file/workspace/code keywords
- `OPENCLAW_TASK_ROUTING_TERMS` — action verbs (read, search, summarize...)
- `OPENCLAW_IN_SCOPE_DOMAIN_TERMS` — insurance domain keywords
- `OPENCLAW_OFF_TOPIC_DOMAIN_TERMS` — off-topic keywords (recipe, movie, sports...)
- `OPENCLAW_CONVERSATIONAL_PATTERNS` — greeting/farewell detection
- `BROAD_WORKSPACE_SUMMARY_PATTERNS` — "tell me about everything" patterns
- `EVIDENCE_STOP_WORDS` — terms excluded from evidence scoring

**Verdict: HEURISTIC PATCHWORK.**  
Upstream has NO equivalent. OpenClaw uses the model itself for intent/routing via the context engine and agent session, not regex keyword matching. The upstream `resolveAgentRoute` in `routing/resolve-route.ts` resolves routes based on channel/account/config, not message content regex.

### Section 2: Normalization & Direct-Answer Builders (L76-155)

**What it does:**
- `normalizeOpenclawRoutingText` — lowercase, strip punctuation
- `buildOpenclawOffTopicRedirectAnswer` — returns canned answer if off-topic keywords match and no workspace/task terms present
- `buildOpenclawProductSemanticsAnswer` — hardcoded Q&A for specific product questions (approve once vs approve task, outside workspace, recorded artifacts, trace details)
- `isLikelyOpenclawConversationalTurn` — regex-based greeting detection

**Verdict: HEURISTIC PATCHWORK.**  
The product semantics answers are hardcoded responses keyed to specific regex patterns. This is an eval-driven hack — these answers exist because specific test cases expect specific phrases, not because upstream has this pattern. Upstream handles all responses via the model with proper context.

### Section 3: Route Authority Correction (L173-200)

**What it does:**
- `isOpenclawExhaustiveGroundedRoute` — checks if route is exhaust/enumeration
- `correctOpenclawRouteAuthority` — falls back to representative retrieval if exhaustive produced no evidence

**Verdict: PARTIALLY VALID.**  
The concept of coverage modes exists in the Parallx type system and has a reasonable fallback pattern. But the upstream context engine handles this internally, not as a post-hoc correction.

### Section 4: Local Type Definitions (L202-248)

**What it does:** Defines `IOpenclawQueryScope`, `IOpenclawTurnRoute`, `IOpenclawContextPlan`, `IRequestTurnState` — local interfaces for the routing/context pipeline.

**Verdict: DISCONNECTED FROM UPSTREAM.**  
These types don't correspond to upstream contracts. The upstream equivalent is the context engine's type system (`ContextEngine`, `TranscriptRewriteResult`, etc.) plus the session/route types from `routing/`.

### Section 5: Command Registry (L250-290)

**What it does:** `createOpenclawCommandRegistry` — parses `/context`, `/init`, `/compact` slash commands.

**Verdict: REASONABLE.**  
Slash command parsing is a Parallx-side concern. The upstream has its own command parsing (`parseReplyDirectives`, `detectCommand`) but Parallx needs its own since it's not a messaging gateway. This is acceptable.

### Section 6: /init Command (L296-477)

**What it does:** `tryHandleOpenclawInitCommand` / `executeOpenclawInitCommand` — scans workspace, reads config files, sends to model to generate AGENTS.md, creates `.parallx/` directory structure.

**Verdict: REASONABLE.**  
This is a Parallx-specific capability. The upstream has bootstrap file loading but not a generate-from-scan feature. This is additive, not wrong.

### Section 7: /compact Command (L479-592)

**What it does:** `tryHandleOpenclawCompactCommand` / `tryExecuteCompactOpenclawCommand` — summarizes conversation history to free token budget.

**Verdict: PARTIALLY ALIGNED.**  
Upstream has `compactEmbeddedPiSession` which does context compaction as part of the execution pipeline (L2/L3). Parallx's version is user-triggered and conversation-level only. The upstream also compacts automatically on context overflow — Parallx doesn't.

### Section 8: Turn Interpretation (L594-720)

**What it does:** `resolveOpenclawTurnInterpretation` — the main routing function. Uses all the regex patterns from Section 1 to classify the turn into route types (conversational, memory-recall, product-semantics, off-topic, grounded with various coverage modes).

**Verdict: HEURISTIC PATCHWORK — MOST CRITICAL PROBLEM.**  
This is where the integration fails hardest. Instead of a proper execution pipeline where the model handles intent classification with context, this function uses cascading regex checks to pre-classify everything before the model even sees the message. The route determination happens BEFORE model inference, which is backwards from upstream where the model+tools handle routing.

Specific problems:
- `/\bdeductible\b/i.test(requestText) && /\b(?:extract|list|all|every)\b/i.test(requestText)` → hardcoded exhaustive-extraction trigger by keyword
- `/\bcompare\b/i.test(requestText) && /(how-to-file|versus|\bvs\.?\b)/i.test(requestText)` → hardcoded comparative trigger
- Memory recall detected by `/\b(?:remember|previous|prior|last|durable|today|preference|preferences|only for today|note)\b/i`
- Broad workspace summary detected by fixed regex patterns

### Section 9: Query Scope Detection (L722-760)

**What it does:** `detectOpenclawQueryScope` — extracts file path or folder references from user text to scope retrieval.

**Verdict: PARTIALLY VALID.**  
Path detection from user text is reasonable. But the upstream context engine handles scoping internally based on workspace structure, not regex extraction from the question.

### Section 10: Context Plan Builder (L762-800)

**What it does:** `buildOpenclawContextPlan` — builds a plan from route + scope. Determines whether to use retrieval, memory, citations.

**Verdict: STRUCTURALLY REASONABLE, BUT WRONG INPUTS.**  
The plan builder itself is fine. The problem is it's fed by the heuristic route from Section 8, so garbage in → garbage out.

### Section 11: Context Assembly (L835-960)

**What it does:** `prepareOpenclawContext` — assembles context for the model call. Handles exhaustive file enumeration, representative retrieval, memory recall, evidence assessment, route correction.

**Verdict: STRUCTURALLY REASONABLE.**  
This is the closest thing to an upstream context engine. It handles retrieval, file enumeration, and evidence assessment. But it's not a pluggable contract — it's a hardcoded flow.

### Section 12: Prompt Envelope (L1115-1165)

**What it does:** `buildOpenclawPromptEnvelope` — constructs the final user message with context sections and evidence constraints.

**Verdict: AD-HOC.**  
System prompt is just `'OpenClaw runtime system prompt placeholder.'`. The actual system prompt is built in `openclawParticipantRuntime.ts` via bootstrap files, but it's stitched together ad-hoc, not via the structured `buildEmbeddedSystemPrompt` pattern from upstream.

### Section 13: Evidence Assessment (L1105-1200)

**What it does:** `assessEvidenceSufficiency` — scores whether retrieved context contains enough evidence to answer the query. Checks term overlap, source content quality, specific coverage terms.

**Verdict: HEURISTIC BUT FUNCTIONAL.**  
The upstream doesn't have a comparable pre-answer evidence scorer — it relies on the model to handle insufficient evidence via prompt instructions. This is a Parallx-side heuristic that helps with answer quality for local models.

### Section 14: Deterministic Workflow Answers (L1300-1400)

**What it does:** `buildDeterministicWorkflowAnswer` — generates answers without model for folder-summary, comparative, and exhaustive-extraction workflows by parsing retrieved context directly.

**Verdict: HEURISTIC PATCHWORK — EVAL-DRIVEN.**  
These "deterministic" answers bypass the model entirely and construct responses from parsed source content. The `summarizeSource` function (L1240-1290) contains HARDCODED path-specific summaries (e.g., `if (normalizedPath.includes('random-thoughts'))` returns a specific description). This was built to pass specific eval test cases.

### Section 15: Output Repair Functions (L1400-1750)

**What it does:** `repairGroundedAnswer` and ~10 specific repair functions that post-process model output:
- `repairGroundedAnswerTypography` — normalize unicode
- `repairUnsupportedSpecificCoverageAnswer` — override answer for missing coverage
- `repairUnsupportedWorkspaceTopicAnswer` — override for off-topic in-folder queries
- `repairVehicleInfoAnswer` — inject vehicle info from context
- `repairAgentContactAnswer` — inject agent contact info
- `repairCollisionDeductibleAuthorityAnswer` — force authoritative deductible amount
- `repairCoverageOverviewAnswer` — append missing coverage types
- `repairWorkflowArchitectureAnswer` — fix architecture references
- `repairWrongUserClaimConfirmationAnswer` — fix incorrect confirmations

**Verdict: HEURISTIC PATCHWORK — THE M40 VIOLATION.**  
This is the output-repair layer that M40 explicitly prohibits. Instead of fixing the input (system prompt, context, model selection) to produce correct output, it patches the output after the fact. Every one of these functions exists because a test case was failing and the previous agent patched the symptom instead of the cause.

---

## Detailed Audit: `participants/openclawDefaultParticipant.ts`

### Main Turn Handler (`runOpenclawDefaultTurn`, L580+)

**Control flow:**
1. Try /init, /context, document listing, /compact commands
2. `resolveOpenclawTurnInterpretation` — heuristic routing
3. If direct answer available → return immediately
4. `prepareOpenclawContext` — context assembly
5. Build system prompt via `buildOpenclawPromptArtifacts` → bootstrap files
6. Build prompt envelope
7. Try deterministic workflow answer → if found, skip model call entirely
8. Agent loop: `executeOpenclawModelTurn` → handle tool calls → iterate

**Verdict: FLAT EXECUTION — No Pipeline Layers.**  
This is a single function that handles everything. Compared to upstream's L1→L2→L3→L4, all concerns are merged:
- No retry on context overflow
- No model fallback
- No auth profile rotation
- No concurrency control (session/global lanes)
- No context engine lifecycle (bootstrap/assemble/maintain/finalize)
- Deterministic workflow answers bypass model entirely

### Workflow Repair Layer (L100-600)

Multiple functions that post-process model output:
- `ensureFolderCountAcknowledgement` — append file count
- `ensureComparisonStepCounts` — append step counts for comparison
- `normalizeHowToFileComparisonPhrasing` — normalize comparison phrasing
- `ensureHowToFileInformalNotesPhrase` — append informal notes phrase
- `ensureBriefSourceAcknowledgement` — append "brief file" note
- `ensureStubRequestAcknowledgement` — append "stub file" note

**Verdict: MORE OUTPUT REPAIR PATCHWORK.**  
Same problem as Section 15 above. These functions exist because specific eval tests expect specific output patterns and the model doesn't naturally produce them.

---

## Audit Summary

### Components That Are Structurally Sound
1. **Slash command registry** — Parallx-specific, appropriate
2. **Bootstrap file loading** — Aligns with upstream bootstrap concept
3. **Tool loop safety** — Reasonable guard against infinite tool loops
4. **Seed message builder** — Standard conversation history → messages array
5. **Model turn execution** — Standard streaming model call with tool support
6. **Type definitions** — Reasonable structure, just disconnected from upstream

### Components That Are Heuristic Patchwork
1. **Regex routing terms** (L25-75) — No upstream equivalent
2. **Product semantics hardcoded answers** (L105-152) — Eval-driven 
3. **Turn interpretation** (L594-720) — Regex cascades instead of model-based routing
4. **Deterministic workflow answers** (L1300-1400) — Bypass model, hardcoded per-path summaries
5. **Output repair layer** (L1400-1750 + participant L100-600) — Post-hoc answer patching
6. **Hardcoded source summaries** (L1240-1290) — Path-keyed predetermined descriptions

### Components That Are Missing (vs upstream)
1. **4-layer execution pipeline** — Everything is flat
2. **Context engine contract** — No pluggable ContextEngine interface
3. **Context compaction on overflow** — No automatic compaction
4. **Model fallback / retry** — No transient error handling
5. **Concurrency control** — No session/global lane queuing
6. **Auth profile rotation** — Not applicable (single local model) but the retry pattern is
7. **System prompt builder** — No structured `buildEmbeddedSystemPrompt`
8. **Tool policy enforcement** — No multi-stage filtering
9. **Ollama num_ctx injection** — Missing despite being critical for local model
10. **Context engine lifecycle** — No bootstrap/assemble/maintain/finalize cycle
