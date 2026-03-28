# D8 — Agent Configuration: Tracker

**Domain:** D8 — Agent Configuration  
**Status:** ✅ CLOSED  
**Started:** 2026-03-28

---

## Scorecard

| Capability | ID | Status | Iteration Fixed |
|---|---|---|---|
| Agent config type contract | D8-1 | ✅ ALIGNED | Iter 1 |
| Agent registry | D8-2 | ✅ ALIGNED | Iter 1 |
| Agent config-to-runtime binding | D8-3 | ✅ ALIGNED | Iter 1 |
| Config-driven agent definitions | D8-4 | ✅ ALIGNED | Iter 1 |
| Agent-specific system prompt overlay | D8-5 | ✅ ALIGNED | Iter 1 |
| Agent-specific tool policy profile | D8-6 | ✅ ALIGNED | Iter 1 |
| User-configurable agents | D8-7 | ✅ ALIGNED | Iter 2 |
| Subagent preparation | D8-8 | ✅ ALIGNED | Iter 2 |
| Default agent resolution | D8-9 | ✅ ALIGNED | Iter 1 |
| Agent lifecycle hooks | D8-10 | ✅ ALIGNED | Iter 1 |

---

## Key Files

| File | Role |
|---|---|
| `src/openclaw/agents/openclawAgentConfig.ts` | Types: IAgentConfig, IResolvedAgentConfig, defaults |
| `src/openclaw/agents/openclawAgentRegistry.ts` | Registry: register, lookup, resolve |
| `src/openclaw/agents/openclawAgentResolver.ts` | Resolver: merge defaults + agent + global |
| `src/openclaw/openclawToolPolicy.ts` | Tool policy: agent filter stage |
| `src/openclaw/openclawSystemPrompt.ts` | System prompt: agent overlay |
| `src/openclaw/openclawTypes.ts` | Turn context types |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Turn context builder |

---

## Upstream References

| Pattern | Upstream File | Upstream Function |
|---|---|---|
| Agent config type | `src/config/types.agents.ts:68-101` | `AgentConfig` |
| Agent registry | `src/agents/agent-scope.ts:55-92` | `listAgentEntries`, `resolveDefaultAgentId` |
| Config resolution | `src/agents/agent-scope.ts:130-156` | `resolveAgentConfig` |
| Agent identity | `src/agents/identity.ts:6-40` | `resolveAgentIdentity` |
| Agent tool policy | `src/agents/sandbox/tool-policy.ts` | `resolveSandboxToolPolicyForAgent` |
| Subagent hooks | `src/context-engine/types.ts:194-210` | `prepareSubagentSpawn`, `onSubagentEnded` |

---

## Iterations

### Iteration 1 — STRUCTURAL (2026-03-28)

- **Focus:** Core types, registry, resolver, wiring into turn context + prompt + tools
- **Audit:** 0/10 ALIGNED (7 MISSING, 3 MISALIGNED)
- **Gap Map:** 6-phase plan, 3 new files, 12 files modified
- **Code Execute:** ✅ Phase 1-4 complete (3 new files, 9 modifications)
- **Verification:** ✅ 140 files, 2664 tests, 0 failures, 0 tsc errors
- **UX Guardian:** ✅ 10 surfaces checked, 0 regressions
- **Gaps closed:** D8-1, D8-2, D8-3, D8-4, D8-5, D8-6, D8-9, D8-10 (8 of 10)
- **Remaining:** D8-7 (user-configurable agents UI), D8-8 (subagent context engine hooks)

### Iteration 2 — REFINEMENT (2026-03-28)

- **Focus:** Subagent context engine hooks, participant agent config wiring, test coverage, user-configurable agents UI
- **Audit findings:**
  - D8-8 MISSING → ALIGNED: Added `prepareSubagentSpawn`/`onSubagentEnded` to context engine interface + implementation, wired into `SubagentSpawner` lifecycle
  - D8-7 MISALIGNED → ALIGNED: Extended `AgentSection` UI with full agent list (table with Name/Surface/Model columns), inline edit panel (model override, temperature, system prompt overlay), add/remove buttons. Added `IAgentConfigData` to `unifiedConfigTypes.ts`, `agentDefinitions` field to `IUnifiedAgentConfig`, `hydrateAgentConfigs()` to `registerOpenclawParticipants.ts`
  - R1 (participant wiring): Workspace + canvas participants now resolve agent config for identity/overlay/temperature/maxTokens
  - R2 (tool policy tests): Added 7 tests for agent tool allow/deny filtering in `openclawToolPolicy.test.ts`
  - R3 (prompt overlay tests): Added 6 tests for agent identity/overlay sections in `openclawSystemPrompt.test.ts`
  - R5 (edge cases): Added 5 edge case tests for resolver (empty arrays, undefined fields)
  - Edge case found: `[]` is truthy in JS so `??` doesn't fall through — documented in test
- **Verification:** ✅ 140 files, 2681 tests, 0 failures, 0 tsc errors
- **UX Guardian:** ✅ Agent list UI accessible, edit/add/remove functional, built-in agents protected, persistence wired
- **Gaps closed:** D8-7, D8-8 (2 of 2 remaining → 10/10 ALIGNED)
- **Remaining:** None

### Iteration 3 — PARITY CHECK (2026-03-28)

- **Focus:** Final comprehensive audit of all 10 capabilities
- **Result:** 10/10 ALIGNED, 0 issues
- **M41 Compliance:** PASS — no anti-patterns (no heuristic logic, no output repair, no pre-classification, no eval-driven patchwork)
- **Cross-domain readiness:** READY for D2 (Chat Commands) — registry, resolver, tool policy all exposed for command handlers
- **Test suite:** 140 files, 2681 tests, 0 failures, 0 tsc errors
- **Decision:** CLOSE ✅

---

## Final Summary

**Domain D8 Agent Configuration: CLOSED ✅**
- 10/10 capabilities ALIGNED
- 3 new source files, 12+ modifications
- 3 new test files, 29+ tests for agent config system
- Full upstream traceability (6 upstream references)
- No M41 anti-patterns
- Clean test suite: 140 files, 2681 tests
