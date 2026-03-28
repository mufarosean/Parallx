# F4: Tool Policy — Deep Audit (Iteration 2b)

**Domain:** F4 Tool Policy  
**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor (iter 2b — substantive re-audit)  
**Status:** 4 ALIGNED, 3 MISALIGNED, 1 ACCEPTED

---

## Summary Table

| ID | Severity | Finding | Status |
|---|---|---|---|
| F4-R2-01 | MEDIUM | `getToolFilteredReason` returns wrong reason for `readonly` profile denies | MISALIGNED |
| F4-R2-02 | LOW | `resolveToolProfile` has two misleading comments | MISALIGNED |
| F4-R2-03 | LOW | `modelCapabilities` parameter is dead code — never passed by any caller | MISALIGNED |
| F4-R2-04 | MEDIUM | Zero unit tests for `applyOpenclawToolPolicy` and `resolveToolProfile` | ACCEPTED |
| F4-R2-05 | — | Profile deny-first/allow-second logic is correct | ALIGNED ✅ |
| F4-R2-06 | — | Tool state counts are consistent with applied policy | ALIGNED ✅ |
| F4-R2-07 | — | Skill name-collision detection and dedup are correct | ALIGNED ✅ |
| F4-R2-08 | — | Tool loop safety blocking and repeat detection are correct | ALIGNED ✅ |

---

## Detailed Findings

### F4-R2-01: `getToolFilteredReason` returns wrong reason for `readonly` denies

- **Severity:** MEDIUM
- **File:** `src/openclaw/openclawToolState.ts`
- **Line(s):** 140–160
- **Issue:** The function reconstructs the filter reason after the fact with a hardcoded check:
  ```typescript
  if (mode === 'standard' && tool.name === 'run_command') {
    return 'tool-profile-deny';
  }
  return 'tool-profile-not-allowed';
  ```
  This only returns `'tool-profile-deny'` for exactly one case: `standard` mode + `run_command`.
  
  For `readonly` mode, all 5 denied tools (`write_file`, `edit_file`, `delete_file`, `run_command`, `create_page`) are reported as `'tool-profile-not-allowed'` instead of the correct `'tool-profile-deny'`. The two reasons have different meanings:
  - `'tool-profile-deny'` = tool is explicitly on the deny list
  - `'tool-profile-not-allowed'` = tool is not on the allow list
  
  Since all profiles use `allow: ['*']`, the `'tool-profile-not-allowed'` reason is always incorrect when a tool is denied — the tool IS on the allow list (via wildcard) but fails the deny check.

- **Impact:** Diagnostic reporting only. No effect on security or tool availability. The tool IS correctly filtered. Only the `filteredReason` in `IOpenclawToolCapabilityReportEntry` is wrong.
- **Fix:** Replace the hardcoded check with a proper deny-list lookup. Either:
  1. Export `TOOL_PROFILES` from `openclawToolPolicy.ts` and check `TOOL_PROFILES[mode].deny.includes(tool.name)`, or
  2. Move `getToolFilteredReason` into `openclawToolPolicy.ts` where it can access the profiles directly, or
  3. Add a new exported function `isToolDeniedByProfile(name, mode)` for the reason lookup.

---

### F4-R2-02: `resolveToolProfile` has two misleading comments

- **Severity:** LOW
- **File:** `src/openclaw/openclawToolPolicy.ts`
- **Line(s):** 124–134
- **Issue:** Two comment/code contradictions:
  1. **Line 126–127:** Comment says "All modes get full tool access" but the function returns `'standard'` for `edit` mode. `standard` is not `full` — it denies `run_command`.
  2. **Line 131:** Comment says `// Edit mode: read-only tools only` but the `standard` profile allows ALL tools except `run_command`. That's not "read-only" — it allows `write_file`, `edit_file`, `delete_file`, `create_page`.
- **Impact:** Code behavior is correct (`edit` → `standard` is reasonable). Comments are misleading for future developers.
- **Fix:** Update comments:
  ```typescript
  // M41 Phase 9: Most modes get full tool access. Edit mode uses standard
  // profile (no command execution). Approval gates on write tools are the
  // real safety boundary, not mode-based tool denial.
  switch (mode) {
    case 'edit':
      return 'standard'; // Edit mode: standard tools (no command execution)
    default:
      return 'full';     // Ask + Agent: full tools with approval gates
  }
  ```

---

### F4-R2-03: `modelCapabilities` parameter is dead code

- **Severity:** LOW
- **File:** `src/openclaw/openclawToolPolicy.ts` (lines 89, 92–94) + `src/openclaw/openclawToolState.ts` (lines 81–84, 145–148) + `src/services/chatRuntimeTypes.ts` (line 96)
- **Issue:** The `modelCapabilities` parameter in `applyOpenclawToolPolicy` was added as "M42 Phase 2" but **no caller ever passes it**:
  - `buildOpenclawRuntimeToolState` doesn't accept or forward `modelCapabilities`.
  - `getToolFilteredReason` doesn't pass it.
  - No other call site passes it.
  
  Additionally, `IOpenclawToolFilterReason` includes `'model-unsupported'` but no code path ever produces this value.
  
  The guard in `applyOpenclawToolPolicy` (lines 92–94) can never be reached in production.
- **Impact:** No negative effect — it's dead code that would work correctly if wired in. The Ollama provider currently handles non-tool models by simply not passing tools in the request options (via the `tools: undefined` check in `openclawAttempt.ts:209`).
- **Fix:** Either:
  1. Wire `modelCapabilities` through `buildOpenclawRuntimeToolState` to make the guard functional, or
  2. Remove the dead parameter and `'model-unsupported'` enum value to reduce confusion.
  
  Option 2 is simpler and follows YAGNI — the check at the attempt level already handles this case.

---

### F4-R2-04: No unit tests for core policy functions

- **Severity:** MEDIUM
- **File:** `tests/unit/` (missing files)
- **Issue:** `applyOpenclawToolPolicy` and `resolveToolProfile` have **zero direct unit tests**. The 3 existing tests in `openclawSystemPrompt.test.ts` cover `buildOpenclawRuntimeToolState` integration scenarios but don't test:
  - Profile deny/allow edge cases (each profile, each denied tool)
  - `never-allowed` permission filtering
  - Empty tools array
  - Unknown tool names (neither denied nor explicitly allowed)
  - `resolveToolProfile` mode mapping (including `undefined`, `'edit'`, `'ask'`, `'agent'`, unknown modes)
  - The `modelCapabilities` gate (dead code, but should have a test if kept)
  
  For a security-relevant filtering function, this is a meaningful gap.
- **Impact:** Bugs in policy logic (like F4-R2-01) go undetected. Future changes could break filtering without test failures.
- **Classification:** ACCEPTED — this is a known gap that should be addressed but isn't a code defect. The existing integration tests in `buildOpenclawRuntimeToolState` provide partial coverage. Dedicated test file creation is recommended but not blocking.

---

### F4-R2-05: Profile deny-first/allow-second logic — ALIGNED ✅

- **File:** `src/openclaw/openclawToolPolicy.ts` lines 96–110
- **Verification:** The filter function correctly:
  1. Checks deny list first (returns `false` if tool name is on deny list)
  2. Checks allow list second (`*` wildcard passes all tools not denied)
  3. Checks permission third (`never-allowed` excluded)
  
  All three steps execute in the correct order. Empty deny lists (full profile) correctly pass all tools. Empty tools arrays correctly return empty. The `filter()` call creates a new array without mutating the input.

---

### F4-R2-06: Tool state count consistency — ALIGNED ✅

- **File:** `src/openclaw/openclawToolState.ts` lines 86–93
- **Verification:** The count formulas are:
  ```
  totalCount = reportEntries.filter(e => e.exposed).length
  availableCount = reportEntries.filter(e => e.exposed && e.available).length
  filteredCount = reportEntries.filter(e => e.exposed && !e.available).length
  ```
  Invariant: `totalCount === availableCount + filteredCount`. This holds because `exposed && available` and `exposed && !available` are a partition of `exposed`.
  
  `availableCount` should equal `availableDefinitions.length` because `getToolFilteredReason` and the final `applyOpenclawToolPolicy` call use the same inputs (mode + permissions). Since filtering is per-tool (no cross-tool interactions), the results are guaranteed consistent. Verified.

---

### F4-R2-07: Skill name-collision detection and dedup — ALIGNED ✅

- **File:** `src/openclaw/openclawToolState.ts` lines 27–78
- **Verification:**
  - `dedupeToolDefinitions` correctly uses a `Set` to keep first-seen, discard duplicates.
  - Platform tool names are tracked in `platformNames` Set before skill iteration.
  - Skill tools that collide with platform names get `exposed: false, available: false, filteredReason: 'name-collision'` and are NOT added to `skillDefinitions`.
  - Non-colliding skill tools are created via `buildToolDefinitionFromSkillCatalogEntry` and run through the same policy filter.
  - No validation of `skill.name` for empty/malformed strings — technically an edge case but not exploitable since skill manifests are local workspace files under user control.

---

### F4-R2-08: Tool loop safety — ALIGNED ✅

- **File:** `src/services/chatToolLoopSafety.ts` + integration in `src/openclaw/openclawAttempt.ts` lines 237–262
- **Verification:**
  - `stableStringify` produces deterministic output by sorting object keys. Handles `null`, primitives, arrays, and nested objects correctly.
  - `record()` maintains a sliding window of 30 signatures and counts consecutive identical entries from the tail.
  - Blocks at 8+ consecutive identical calls — sufficient for detecting stuck loops.
  - Known limitation: oscillating patterns (A→B→A→B...) are not detected. This matches the simpler heuristic documented in iter 1 audit.
  - Integration in attempt: safety check runs before each tool execution, blocked flag breaks the loop.
  - Additional safety layers in attempt: iteration budget cap, mid-loop budget check at 85% capacity, all-tools-failed bailout, tool result truncation at 20K chars. All correctly integrated.

---

## Overall Verdict: PASS (conditional)

The core tool policy filtering logic is correct and secure. The deny-first/allow-second pipeline works as intended. No tool can bypass the deny list through normal operation.

**Three MISALIGNED findings:**
- F4-R2-01 (MEDIUM) — Wrong filter reason in diagnostic reports. Fix is straightforward.
- F4-R2-02 (LOW) — Misleading comments. Comment-only fix.
- F4-R2-03 (LOW) — Dead code parameter. Clean up or wire in.

None affect security or functional correctness. All are reporting/documentation quality issues.

**Recommendation:** Fix F4-R2-01 and F4-R2-02 as low-effort improvements. F4-R2-03 can be addressed when model capability detection is actually needed.
