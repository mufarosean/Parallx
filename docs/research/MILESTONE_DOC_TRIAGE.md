---
Status: Draft
Author: Milestone and Documentation Steward (subagent invocation)
Branch: systems-redesign-planning
Commit: d684184
Created: 2026-05-23
---

# Parallx Milestone Documentation Triage

## Triage Table

| Milestone | Title | Proposed Status | Evidence | Recommended Action |
|---|---|---|---|---|
| **M64** | Budget extension UX consolidation | `implemented-verified` | **Pass 1 & Pass 2 complete**: "Pass 2 — Visual overhaul (this session)" (L229 shows date: current). Verification section (L127–137) specifies 6 executable test steps including sidebar count check, clickability tests, and existing command preservation. Multiple file:line citations in audit table (L22–38: renderDashboardSection L1575, renderCashFlowSection L2066, renderReportsSection L2165, etc.) | Label only; keep in `docs/` |
| **M65** | Web Research Extension (secure, agent-driven) | `implemented-verified` | **M65 fully closed** (L323 of milestone doc states: "M65 fully closed"). Execution tracker shows: "**complete** (2026-05-11) \| 2816 pass / 1 skipped (+83 new), tsc clean, build clean" (L321). Security Analyst APPROVED after veto fix; 10/10 Regression Sentinel checks PASS. Follow-ups F1–F4 tracked explicitly; F2 and F4 deferred to M66 (L322). Research-topic skill landed in defaultSkillContents.ts (L323). | Label only; keep in `docs/` |
| **M66** | Unified linking, citations, and AI self-awareness | `planning` | **Status: Planning** — explicit heading at document start. Design section (§1 "parallx:// URI scheme", §2 "LinkResolverService + api.links", §3 "Node content bridge", §4 "Prompt design") describes the system but no verification section, no code file:line citations to implementations, and no commit sha. Audit section (L17–66) lists current-state gaps only ("no mechanism", "None today", "Flat"). | Label only; keep in `docs/` (accept as active design if Conductor approves) |
| **M67** | Security & data-leakage hardening | `partial` | **Status: Substantially shipped** (L2–3). "Phase 1.1, 1.2, 1.4, 1.5, 4.1, 4.2, 4.5 + finding #3 all landed" (L3–4). BUT "Still open: Phase 1.3 (Gmail creds workspace-relocate — needs gmail-mcp server change), Phase 1.6 (LLM API key encryption — N/A while Parallx is Ollama-only) and Phase 3 (full extension migration to capability-based API)" (L5–7). Audit section (§A–D, L41–176) verifies each claim with file:line citations. Phase 1.3 explicitly carried to M72 (carried-forward rule). | Label only; keep in `docs/` |
| **M68** | Semantic Workspace Graph | `implemented-unverified` | **Status: MVP implemented; bake/tune ongoing** (L2–3). Scope section (L34–58) lists in-scope items: semantic links between Canvas pages, files, and Canvas pages with files; cached edge table; toggleable display; incremental recompute. Performance contract (§4, L89–121) lists explicit guardrails: "No model calls from Workspace Graph", "Core AI approval gate", "No all-pairs comparison", "Incremental first", "Single low-priority worker loop". Hard constraint: "must not consume local-model VRAM" (L13–14). Completion section (L356+) does not explicitly state "done" — only "When is M68 complete". "Bake/tune ongoing" suggests implementation exists but verification/testing is in progress. | Label only; keep in `docs/` (accept as partial pending bake completion) |
| **M69** | AI Node Inspector | `planning` | **Status: Planning** (L4). Architecture section (§1–3, L79–160) describes the design (content retrieval, node content bridge, prompt design) but no code implementations cited, no verification steps, and no completion claim. Out of scope section (L66–76) explicitly lists what is NOT in this pass. No execution tracker. | Label only; keep in `docs/` (design document; ready for kickoff when Conductor accepts redesign plan) |
| **M70** | App Command Control | `implemented-verified` | **Status: Implemented (commits `e71615e`, `31c43ca`)** (L2–3). Explicit commit shas provided. "~89 opted-in commands" (L3). Verification section (L150–165) lists specific test procedures: deduplication audit passed (Gate 1, L90), exclusion list enforced (Gate 2, L97–101). Design section (§5, L136–139) specifies Opt-in annotation with `aiInvocable` flag, workspace-level toggle, local model safety. Both tools (`app__find_commands`, `app__run_command`) documented with color-gate classification (L118–127: Green / Blue). | Label only; keep in `docs/` |
| **M71** | Configurable Dashboard (Home) | `planning` | **Status: Planning** (L4). Architecture section (§2 "Cell model", §3 "Cell types", §4 "Process runner") describes system design with detailed cell types (recent-files, budget-summary, workspace-activity, research-digest, quick-links, custom-ai-query) and refresh policies. Scope section (L116–128) specifies in-scope: dashboard-cell block type, auto-creation on first workspace open, cell configuration UI. Out of scope explicitly states custom-ai-query cell deferred to M71.5 (L130). No code implementations cited. | Label only; keep in `docs/` (design document; ready for implementation phase if Conductor approves) |
| **M72** | AI Ecosystem Cohesion ("The AI Knows You") | `planning` | **Status: Planning** (L4). "How Claude Code handles this" (§2, L11–31) describes the model to follow. "What currently exists and what is wrong with it" (§3, L36–56) is an audit of current state, not an implementation report. Design principles (§4, L59–71) and file system design (§5, L80–119) are prescriptive but not implemented. Phase 1 (L122–152: "Clean up dead code and make config truthful") lists TODO items like "Remove or clearly stub every dead field" — future tense. | Label only; keep in `docs/` (planning document; Phase 1 is the cleanup gate for M72) |
| **M73** | EPUB Reader and Indexing Support | `implemented-verified` | **Status: Implemented** (L4). Verification section (L23–32) lists explicit test commands run: `node --check electron/documentExtractor.cjs`, `npx.cmd tsc --noEmit`, `npx.cmd vitest run tests/unit/editorPersistence.test.ts tests/unit/epubDocumentExtractor.test.ts tests/unit/indexingPipeline.test.ts`, `node scripts/build.mjs`. "The renderer build passed with two pre-existing CSS warnings" (L32–33) — explicit pass report. File:line citations in What Changed section (L6–18): added `.epub` to extractor, implemented EPUB fallback extractor, followed OPF spine order, stripped XHTML, added EpubEditorInput and EpubEditorPane, registered with file editor resolver. | Label only; keep in `docs/` |
| **M74** | Rendered EPUB Reader | `implemented-verified` | **Status: Implemented** (L4). Verification section (L19–25) lists same test commands as M73. File:line citations in What Changed section (L6–17): added document.readEpub bridge, kept document.extractText for indexing, reused OPF/spine parser, sanitized XHTML, inlined local images, removed scripts/styles/external URLs. Guardrails section (L19–21) explicitly states constraints: "No changes to embeddings, vector search, Ollama, or model loading." | Label only; keep in `docs/` |
| **M75** | EPUB Reader Page Frame | `implemented-verified` | **Status: Implemented** (L4). Verification section (L14–18) lists test commands. What Changed section (L6–10) is brief (bordered page surface, subtle shadow, page width tied to zoom, responsive). Guardrails section (L12–14) explicitly constrains scope: "No changes to EPUB extraction, indexing, embeddings, Ollama, or AI routing. The change is limited to the built-in EPUB editor presentation layer." | Label only; keep in `docs/` |
| **M76** | Mind Map Workspace Graph | `planning` | **Status: Planning. Depends on M68 cached-edge infrastructure remaining intact** (L1–2). This is a forward-looking feature on the roadmap but explicitly stated as planning. "Verified codebase facts" section (L57–159) confirms pre-existing infrastructure from M68 is in place and ready to extend, but M76 itself has no implementation. Phases are listed (L200–322) as future work. Design section (§2, L200–322) lists five phases of implementation but explicitly prefixed with planning language. | Label only; keep in `docs/` (design document; depends on M68 completion); consider superseded by M81 if redesign changes the graph direction |
| **M77** | Canvas Reliability Hardening | `implemented-verified` | **Status: Implemented. All 11 phases shipped, including round-2 / round-3 audit follow-ups** (L1–2). Phases section (L47–199) documents phases 1–4 with explicit "Verification" subsections showing test procedures (L56–62, L72–80, L91–98, L108–115). Verified implementations cited: "Phase 10.1 (AI page-write revision bump) verified at pageTools.ts:712; Phase 11.5 (friendly save-error toast) at canvas/main.ts:325" (L3–4). Three-audit-tiers structure (L37–43) completed. | Label only; keep in `docs/` |
| **M78** | Performance Hardening | `implemented-verified` | **Status: Implemented. All 8 implementation phases (1–8) shipped** (L1–2). Verification section (L2–3) lists in-code verification locations: "timedDbHandler at main.cjs:1762, SQLite PRAGMAs at database.cjs:62-64, embedding worker flag in embeddingService.ts, autonomy log buffering in autonomyEventLog.ts, file-watcher coalescing in fileService.ts, suggestion idle-defer in proactiveSuggestionsService.ts, PageSaveEvent payload in canvasTypes.ts". Phases 1–8 documented (L46–189) with explicit UX impact section for each guaranteeing: "The user must not be able to tell anything changed except that the app is faster." | Label only; keep in `docs/` |
| **M79** | Text Generator: RP Engine Hardening | `partial` | **Status: Planning + execution underway** (L2). "The three tensions M79 negotiates" (§2, L24–33) and "UX contract for M79" (§3, L47–54) are defined. Phases section (L65–271) lists Phase 1 (Memory architecture), Phase 2 (Lorebook v2), Phase 3 (Lore delivery), Phase 4 (Character interaction scoring), Phase 5 (UI), Phase 6 (Inspection), Phase 7 (Convergence algorithm), Phase 8 (Prompt injection). Execution status is ambiguous: "Planning + execution underway" suggests some phases are in progress but not complete. No explicit completion date or verification section. | Label only; keep in `docs/` (accept as active partial implementation pending phase completion clarification) |
| **M80** | Budget Sync as a Skill+Tools Agent | `planning` | **Status: Planning. Awaiting user sign-off** (L2–3). This milestone reformats the budget extension's AI pipeline to use the skill+tools pattern (reference precedent: web-research at L45–65). "Verified codebase facts" section (L74–131) confirms pre-existing infrastructure is ready (Chat tool API, Skill discovery, Existing data layer). Decision made: "extension-owned skill seeding" (L118–125) but awaiting user approval. Explicit note: "The README's 'Active milestone' line is stale (still says M64) — update on close" (L6–7). | Label only; keep in `docs/` (design document; awaiting Conductor sign-off; design is solid, execution blocked on user approval) |

---

## Summary Counts

| Status | Count |
|---|---|
| `implemented-verified` | 8 |
| `implemented-unverified` | 1 |
| `partial` | 3 |
| `active` | 0 |
| `planning` | 5 |
| `superseded` | 0 |
| `archived` | 0 |

**Total**: 17 milestones (M64–M80)

---

## Risk Flags

### 1. **Active vs. Planning Ambiguity**
- **M64** ("Budget extension UX consolidation") claims completion but **README says M64 is the current active milestone** (stale reference).
- **M80** explicitly notes: "The README's 'Active milestone' line is stale (still says M64) — **update on close**."
- **Action**: Update `docs/README.md` to reflect the actual active milestone when conducting accepts M81. Current state creates confusion about what execution is active.

### 2. **M67 + M80 Both Touch Budget, Different Approaches**
- **M67** (Security hardening) lists "Phase 1.3: Gmail creds workspace-relocate" as deferred, suggesting budget needs to coordinate with gmail-mcp server changes.
- **M80** proposes a full budget AI pipeline refactor to skills+tools, which would supersede the current AI runtime inside the budget extension.
- **Action**: Coordinate M80's execution with M67's gmail-mcp Phase 1.3 if both proceed. M80 should not ship until M67 Phase 1.3 clarifies whether budget keeps internal AI or delegates to the skill+tools pattern.

### 3. **M68 + M76 Dependency Chain, Both Partially Realized**
- **M68** (Semantic Workspace Graph): MVP implemented but "bake/tune ongoing" — tuning is not complete.
- **M76** (Mind Map Workspace Graph): Explicitly depends on M68 cached-edge infrastructure. "Depends on M68 cached-edge infrastructure remaining intact" (L1–2).
- **M81 (redesign root)** may make major changes to graph architecture, potentially invalidating both M68 tuning and M76's plans.
- **Action**: Keep M68 + M76 documentation stable during M81 planning. If M81 changes graph architecture, cascade that decision into M68/M76 close-out or supersession.

### 4. **M66 → M65 Deferred Work Not Yet Scheduled**
- **M65** deferred to M66: "F2 (storage DI identifier) and F4 (MCP-source-as-blue) carried to M66" (L322–323 of M65 doc).
- **M66** is still "planning" and does NOT yet list these specific carried-over follow-ups.
- **Action**: When M66 transitions to "active", explicitly call out the M65 carry-forward items in the M66 Scope section.

### 5. **M72 Blocks Itself (Cleanup Gate)**
- **M72** (AI Ecosystem Cohesion) Phase 1 is "Clean up dead code and make config truthful" — but it lists removing/stubbing dead fields in `IUnifiedAIConfig` that are part of the app codebase, not just this doc.
- The milestone is marked `planning` but Phase 1 explicitly requires code changes to make "every config field that exists must work" (L70).
- **Action**: M72's Phase 1 is a C1 (documentation truth cleanup → app-system cleanup) boundary. Do not transition M72 to `active` until C1 acceptance is explicit.

### 6. **M71 + M72 Overlap in Cron/Scheduling Infrastructure**
- **M71** (Dashboard) requires a cron job infrastructure for cell refresh policies (§4, L109–137).
- **M72** lists no cron work but Phase 1 touches config/scaffolding that may interact with M71's cron.
- **Action**: Sequence M71 → M72 (not M72 → M71) if both proceed, so cron infrastructure is available for M72's background LLM calls.

### 7. **M79 Ambiguous Execution Status**
- **M79** says "Planning + execution underway" but provides no phase-by-phase completion state.
- No verification section; no commit shas; no test counts.
- Compare to M78 which is "all 8 phases shipped" with specific in-code verifications.
- **Action**: Clarify M79's actual status: which phases are complete, which are in-code (need verification), which are still pending. Recommend explicit completion date or deferral to M81 redesign.

### 8. **M81 (Redesign Root) Will Likely Supersede M76, M72 Section 2+**
- **M72** Phase 1 is cleanup (independent), but Phase 2+ (user file schema, SOUL/memory architecture) are high-risk for redesign incompatibility.
- **M76** (Mind Map) is speculative UI work that may not align with the new redesign direction.
- **Action**: When M81 kickoff is accepted, re-evaluate M72 Phase 2+, M76, and M69 against the redesign architectural decisions.

---

## Doc Triage for Other Top-Level Docs

### [Future_Improvements.md](docs/Future_Improvements.md)
- **Status**: `research` (mixed)
- **Evidence**: Covers historical performance work. "Startup Performance — Indexing Pipeline Freeze" has solution options 1–4; options 1–4 all show "✅ **Landed in M60 Phase [X]**" with archive citations. This doc is historical record of solved problems, not active planning. Rules: keep under `docs/` as reference; update links to point to `archive/root-audits/STARTUP_PERFORMANCE.md`.
- **Recommended action**: Label as research/archive reference. Do not treat as active. Update README to clarify this is historical context, not forward-looking.

### [M70_DEDUP_AUDIT.md](docs/M70_DEDUP_AUDIT.md)
- **Status**: `planning` (gate document)
- **Evidence**: "Status: Awaiting sign-off before code is written (M70 Design Gate 1)." This is a gate deliverable for M70, not M70 itself. Serves as the reference for M70's Opt-in annotation pass. User chose "broad sweep" approach (per document).
- **Recommended action**: Label as planning / gate document. Keep in `docs/` during M70 → M81 transition. Archive to `docs/archive/audits/` after M70 closes and design gate is approved. This is a design-phase artifact, not a canonical reference.

### [WORKFLOWS.md](docs/WORKFLOWS.md)
- **Status**: `canonical`
- **Evidence**: Explicitly positioned as "Practical, end-to-end things you can do with Parallx today" using "shipped features: the bundled extensions, AI Chat, Canvas, and AI Tools." All 48 workflows reference built-in or shipped extension capabilities. This is user-facing canonical documentation, not a milestone or research doc.
- **Recommended action**: Label as canonical. Keep at `docs/` root. Link from README under "End users" section. Update on every milestone close to add new workflow examples. No archive move.

### [README.md](docs/README.md)
- **Status**: `canonical` (but requires update)
- **Evidence**: Current state has a stale "Active milestone" line that still says M64. README explicitly governs the truth model per Manifest §24: "if a doc is canonical, it must be accurate enough to act on. If it is not accurate, archive it or label it as draft/research." Current README is inaccurate on the active milestone.
- **Recommended action**: 
  1. Update "## Milestone status" section to reflect M64–M80 triage table.
  2. Add a "## Milestone Triage Status" table with the above triage results.
  3. Update "Active milestone" line once Conductor accepts the next redesign milestone (M81).
  4. Add explicit note that M64–M80 are under triage; do not treat any single root milestone as active until labeled in the triage table.
  5. Keep at `docs/` root as the single index.

---

## Recommended Archive Moves (C1 Phase, After Acceptance)

**Do not execute these moves yet — only recommend for C1 phase (Documentation truth cleanup) after labels/archive rules/README shape are accepted.**

None of M64–M80 are ready for archival yet. All are either shipped (and still canonical references for the systems they built) or planning (and needed as design documents). Archival becomes relevant only after:

1. M81 (redesign root) is accepted and executed.
2. Redesign produces replacement or supersession decisions for each M64–M80 milestone.
3. Explicit "close" decision is made for each milestone with a final status tag in the milestone document itself (e.g., "Closed: 2026-05-31" at the document header).

**Future archival candidates (do not move now):**
- **M66, M69, M71, M72, M76** (planning documents): Archive to `docs/archive/milestones/` after redesign closes them or when design is superseded by M81 direction. Use `git mv` to preserve history.
- **M70_DEDUP_AUDIT.md**: Archive to `docs/archive/audits/` after M70 closes and gate is approved.
- **Future_Improvements.md**: Already historical (solution options landed in M60). Consider splitting into `archive/root-audits/PERFORMANCE_HARDENING_SUMMARY.md` (the results) and `archive/audits/STARTUP_FREEZE_OPTIONS.md` (the decision log).

**Permanent archive moves (not applicable for M64–M80):**
- None of these milestones have been closed yet.

---

## C0 Planning Cleanup Checklist (From Manifest §25)

Per the redesign manifest, C0 (Planning cleanup) includes:
- ✅ In-place labels (this triage table provides them)
- ✅ Agent cards (Milestone and Documentation Steward card read at task start)
- ✅ Milestone template (Manifest §17 defines the shape)
- ⚠️ README truth notes (current README is stale on active milestone; needs update)
- ⚠️ Artifact directories (archive/milestones/ exists; structure is in place but no moves yet)

**Actions for C0 completion:**
1. Write this triage table to `docs/research/MILESTONE_DOC_TRIAGE.md`.
2. Update `docs/README.md` to reflect the triage results and clarify stale "active milestone" line.
3. Confirm with Conductor that the status labels and archive rules are acceptable before proceeding to C1.

---

## Adjacency to M81 (Systems Redesign Planning Root)

This triage supports M81 kickoff by:

1. **Documenting current state**: Every shipped milestone (M64–M78, partly M79) is now labeled with evidence, making it clear what exists and what can be built on.
2. **Identifying planning work**: M66, M69, M71, M72, M76, M80 are all well-designed but not yet executed. M81 can accept or revise these designs.
3. **Flagging dependencies**: M68 ↔ M76, M67 ↔ M80, M71 + M72 (cron), M72 cleanup gate all documented so M81 plan can sequence them correctly.
4. **Providing supersession anchors**: When M81 makes architectural decisions (e.g., new graph design, new AI ecosystem shape), it will reference this triage to close out old milestones or carry them forward.

**No blocker for M81 kickoff**: this triage is informational only. M81 can proceed once user accepts the redesign manifest and kickoff plan.
