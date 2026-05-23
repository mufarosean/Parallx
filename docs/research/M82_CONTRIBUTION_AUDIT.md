---
Status: Draft (planning gate for M82)
Author: Research Agent (subagent invocation) + Conductor consolidation
Branch: systems-redesign-planning
Created: 2026-05-23
Milestone: docs/Parallx_Milestone_82.md
Manifest: docs/PARALLX_MANIFEST.md §14, §17
---

# M82 Contribution Audit — Current-State and External Findings

This audit answers the five current-state questions in [docs/Parallx_Milestone_82.md §6](../Parallx_Milestone_82.md#6-current-state-research-required-before-slice-a) and the three external questions in §7. Every finding carries a file:line anchor. Speculative recommendations without anchors are rejected per Manifest §14.

The audit gates Slice A. No Surgical Executor work begins until this doc is committed and the Conductor has confirmed it.

---

## Q1. Canvas Authoring Path

**Result: PASS, with one wording correction to M82 doc.**

[`src/built-in/canvas/config/blockRegistry.ts`](../../src/built-in/canvas/config/blockRegistry.ts) exports 13 primary symbols. All consumers are accounted for via internal gates (`canvasEditorProvider.ts`, `canvasSidebar.ts`, `canvasIcons.ts`, `header/pageChrome.ts`, `handles/handleRegistry.ts`). No external extension access exists today.

| Symbol | Type | Consumer anchor | M82 disposition |
|---|---|---|---|
| `BLOCK_REGISTRY` | `ReadonlyMap<string, BlockDefinition>` | [canvasEditorProvider.ts:L435](../../src/built-in/canvas/canvasEditorProvider.ts#L435) | Read-only at startup for built-in-id conflict detection. |
| `BlockDefinition` | Interface | Type-imported across menus, handles, chrome | Immutable type. Reused by `ICanvasBlockTypeRegistry`. |
| `PAGE_CONTAINERS` | `ReadonlySet<string>` | [blockStateRegistry.ts](../../src/built-in/canvas/config/blockStateRegistry.ts) | Must remain canonical. Container classification is built-in-only. |
| `getBlockExtensions(context)` | Function | [tiptapExtensions.ts:L20](../../src/built-in/canvas/config/tiptapExtensions.ts#L20) | **This is the M82 hook.** Accepts `EditorExtensionContext` — additive field on context carries contributed extensions. |
| `getSlashMenuBlocks()` | Function | [canvasMenuRegistry.ts](../../src/built-in/canvas/menus/canvasMenuRegistry.ts) | Reads `BLOCK_REGISTRY`. M82 processor invalidates menu cache after registration. |
| `getTurnIntoBlocks()` | Function | [canvasMenuRegistry.ts](../../src/built-in/canvas/menus/canvasMenuRegistry.ts) | Same pattern. |
| `getBlockLabel(typeName)` | Function | Menu rendering | Registry lookup. Works for contributed IDs unchanged. |
| `getBlockByName(typeName)` | Function | [handleRegistry.ts](../../src/built-in/canvas/handles/handleRegistry.ts) | Returns `undefined` for unregistered. Safe. |
| `isContainerBlockType(typeName)` | Function | [blockStateRegistry.ts:L96](../../src/built-in/canvas/config/blockStateRegistry.ts#L96) | Returns `false` for unregistered. Safe. |
| `getNodePlaceholder(typeName, attrs)` | Function | [tiptapExtensions.ts:L278](../../src/built-in/canvas/config/tiptapExtensions.ts#L278) | Safe fallback. |
| `createEditorExtensions(lowlight, context)` | Function (re-export) | [canvasEditorProvider.ts:L35](../../src/built-in/canvas/canvasEditorProvider.ts#L35) | Thread `EditorExtensionContext` with contributed registry. |
| `EditorExtensionContext` | Interface | Passed to extension factories | **Extensible**. M82 adds one optional field. |
| `PageChromeController` | Class (re-export) | [canvasEditorProvider.ts:L35](../../src/built-in/canvas/canvasEditorProvider.ts#L35) | Internal lifecycle. External blocks do not interact. |

**Redline for M82 §10 Slice A:**

> Change "Canvas editor reads `ICanvasBlockTypeRegistry.getAll()` once during editor extension assembly" → "Canvas editor passes an extended `EditorExtensionContext` (with `contributedBlockTypes: readonly BlockDefinition[]`) into `getBlockExtensions(context)` at [tiptapExtensions.ts:L20](../../src/built-in/canvas/config/tiptapExtensions.ts#L20). The function signature does NOT change; only the context shape gains one optional field."

---

## Q2. Canvas Save/Restore Round-Trip

**Result: PASS. Zero migrations required. Tiptap silently fallbacks for unknown nodes.**

Storage shape per [`contentSchema.ts:L1-L90`](../../src/built-in/canvas/contentSchema.ts):

```jsonc
{
  "schemaVersion": 2,
  "doc": {
    "type": "doc",
    "content": [ /* ProseMirror nodes */ ]
  }
}
```

Each node has `type`, optional `content[]`, and `attrs` (extension-defined attributes ride here verbatim).

Key anchors:

- [contentSchema.ts:L24](../../src/built-in/canvas/contentSchema.ts#L24) — `encodeEnvelope()` wraps doc with `schemaVersion`.
- [contentSchema.ts:L33](../../src/built-in/canvas/contentSchema.ts#L33) — `decodeCanvasContent()` returns `{ doc, schemaVersion, needsRepair, repairedStoredContent, reason }`.
- [canvasDataService.ts:L1346](../../src/built-in/canvas/canvasDataService.ts#L1346) — `decodePageContentForEditor()` auto-repairs legacy content.
- [canvasEditorProvider.ts:L759-L763](../../src/built-in/canvas/canvasEditorProvider.ts#L759-L763) — `setContent(decoded.doc)` round-trip.

**Unknown-node recovery:** Tiptap / ProseMirror does NOT throw when `setContent()` encounters an unknown node type. The node is silently dropped or fallback-rendered. M82 inherits this for free — no exception handling needed for "extension uninstalled, page still loads."

**Migration cost:** **NONE.** Block types are runtime registrations, not persistent schema. M82's "additive only, no migration" claim holds.

---

## Q3. Chat Participant Lifecycle

**Result: PASS, with one method-name correction to M82 doc.**

- [`chatAgentService.ts:L51`](../../src/services/chatAgentService.ts#L51): `registerAgent(participant: IChatParticipant): IDisposable`.
- [`chatAgentService.ts:L37-L51`](../../src/services/chatAgentService.ts#L37-L51): `_resolveAgent(participantId)` does priority lookup — direct map → `parallx.chat.${id}` namespace fallback → case-insensitive display-name match. **No hardcoded participant list anywhere.**
- [`chatAgentService.ts:L98`](../../src/services/chatAgentService.ts#L98): `invokeAgent(participantId, request, context, response, token)` dispatches through `_resolveAgent()`.
- [`registerOpenclawParticipants.ts:L39-L53`](../../src/openclaw/registerOpenclawParticipants.ts#L39-L53): default registration site; result pushed to disposables array at L74.
- [`chatRequestParser.ts:L43-L49`](../../src/built-in/chat/input/chatRequestParser.ts#L43-L49): `@participantId` regex `^@(\S+)\s*` — string-only, registry resolves.

**Redline for M82 §11 Preservation Checklist:**

> The doc references `IChatAgentService.getRegisteredParticipants()`. The actual API surface is `_resolveAgent()` (private) plus the public `onDidChangeAgents` event. The Slice B test should subscribe to `onDidChangeAgents` rather than call an enumeration method that does not exist by that name. If enumeration is required for the test, add a minimal `getAllParticipants()` method — but **only** if Slice B's test cannot work via event subscription.

**Capability/policy:** uniform per-tool, not per-participant (see Q5). Contributed participants inherit all gating.

---

## Q4. Manifest Loader Contract

**Result: PASS. M82 mirrors M81 Slice B pattern verbatim.**

- M81 ContributionRegistry: [`src/contributions/contributionRegistry.ts:L33-L62`](../../src/contributions/contributionRegistry.ts#L33). Per-processor try/catch wraps each call; errors logged but not rethrown.
- Test pattern to mirror: [`tests/unit/contributionRegistry.test.ts:L144-L158`](../../tests/unit/contributionRegistry.test.ts#L144) — asserts per-processor isolation.
- Loader call site: [`src/workbench/workbench.ts:L2316`](../../src/workbench/workbench.ts#L2316) — `ContributionRegistry.processContributions(toolDescription)` fans out to four current processors.
- Manifest validator is **strict but additive**: unknown fields stripped, but new array fields default to `[]` if the schema permits them. M82 adds two top-level array fields: `contributes.canvas.blockTypes[]` and `contributes.chat.participants[]`.

**No redline.** M82 §10 Slice A/B specs are correct.

---

## Q5. Capability/Policy Gating

**Result: PASS. M82 inherits gating for free.**

Policy decision is **keyed by tool name, not participant ID**:

- [`policyDecisionPoint.ts:L90-L120`](../../src/services/policyDecisionPoint.ts#L90) — `decide(request)` rule order (first match wins):
  1. `COMMAND_BLOCKLIST` → deny.
  2. Managed session + manual autonomy → deny.
  3. Permission service "never-allowed" → deny.
  4. `ALWAYS_REQUIRE_CONFIRMATION` safety belt → require-approval.
  5. M65 color gate (blue tool in red-tainted turn) → require-approval.
  6. Permission "requires-approval" → require-approval.
  7. Otherwise → allow.
- [`openclawToolPolicy.ts:L1`](../../src/openclaw/openclawToolPolicy.ts#L1), [`openclawToolPolicy.ts:L60-L80`](../../src/openclaw/openclawToolPolicy.ts#L60) — `TOOL_PROFILES` allowlist/denylist keyed by tool name.
- [`built-in/chat/main.ts:L1052`](../../src/built-in/chat/main.ts#L1052) — `buildOpenclawDefaultParticipantServices()` sets policy context.

**Conclusion:** Same tool invoked by `parallx.chat.default` or `myExt.custom-agent` gets the same policy decision. M82's §3 claim "capability gating inherited" is verified. No code changes needed in `openclawToolPolicy` or `policyDecisionPoint`. No participant-level override exists by design (Manifest §11).

---

## E1. VS Code `contributes.chatParticipants` Shape

Source: [VS Code Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat).

```jsonc
{
  "contributes": {
    "chatParticipants": [
      {
        "id": "chat-sample.my-participant",
        "name": "my-participant",
        "fullName": "My Participant",
        "description": "What can I teach you?",
        "isSticky": true,
        "commands": [
          { "name": "teach", "description": "Pick a CS concept and explain it" }
        ]
      }
    ]
  }
}
```

**Parallx adoption (M82 §10 Slice B):** field-for-field reuse. `id` ↔ participant ID, `name` ↔ `@name` mention, `fullName` ↔ response title, `description` ↔ chat placeholder. `isSticky` and `commands[]` reserved for shape parity but not consumed by M82 UI (UI integration deferred to a later milestone).

**Redline for M82 §3 Scope:** add this shape as the canonical Slice B contract.

---

## E2. VS Code `contributes.languages` Shape (Precedent)

Source: [VS Code Contribution Points — languages](https://code.visualstudio.com/api/references/contribution-points#contributeslanguages).

```jsonc
{
  "contributes": {
    "languages": [
      { "id": "python", "extensions": [".py"], "aliases": ["Python", "py"],
        "configuration": "./language-configuration.json" }
    ]
  }
}
```

**Lesson for M82 §10 Slice A:** Languages are keyed by **simple unprefixed `id`** ("python"). Parallx should follow: `blockTypes[].id` is a simple string, **conflict detection at registration time** against the built-in `BLOCK_REGISTRY` set. **Do NOT** require extension-namespace prefixing on the ID — adopt the VS Code convention. Extension authorship docs should recommend prefixing voluntarily.

---

## E3. Eclipse Anti-Patterns Confirmation

Parallx pattern is **registry-as-service + JSON manifest + runtime registration + per-processor error isolation**. This is the correct path. Avoid:

- XML descriptors / `plugin.xml`-style schemas. (Parallx uses JSON.)
- `InvalidRegistryObjectException` and similar exception-as-control-flow patterns. (Parallx returns `undefined` and falls back.)
- Lazy bundle loading with auto-activation. (Parallx ContributionRegistry is explicit and synchronous per tool.)

No new anti-pattern surfaced beyond the three Review §III §9 already noted.

---

## Findings Summary (for the Conductor)

1. **All five current-state Qs pass.** No M82 scope item is invalidated.
2. **One scope-level redline (E1 / Slice B):** adopt VS Code's `chatParticipants` shape verbatim. The M82 doc currently says "ChatParticipantDefinition" abstractly — pin it to the VS Code shape now to lock the schema.
3. **One Slice A wording redline (Q1):** the hook is `getBlockExtensions(context)` via additive `EditorExtensionContext` field, **not** a call site change inside `canvasEditorProvider.ts`. The doc's §10 Slice A should be tightened.
4. **One Slice B redline (Q3):** verification step should use `onDidChangeAgents` event subscription, not a `getRegisteredParticipants()` method that doesn't exist by that name. Either add a `getAllParticipants()` accessor (preferred, ~5 lines) or rewrite the test to use the event.
5. **One Slice A simplification (Q4):** mirror M81's `ContributionRegistry` pattern exactly. The doc already says this; no change needed. Test fixture pattern is at [`tests/unit/contributionRegistry.test.ts:L144`](../../tests/unit/contributionRegistry.test.ts#L144).
6. **One free win (E2):** VS Code's languages-contribution precedent confirms simple unprefixed `id` keys with conflict detection at registration. Adopt this convention; don't over-engineer namespacing.
7. **One free win (Q5):** capability gating is participant-agnostic. Zero changes to `openclawToolPolicy.ts` or `policyDecisionPoint.ts`. Confirms M82 §4 anti-list is correct.
8. **One free win (Q2):** zero schema migrations. Unknown nodes silently fall back via Tiptap. M82's "additive only" claim holds.

**Conductor action:** apply the three redlines (Slice A wording, Slice B verification mechanism, Slice B schema lock) to `docs/Parallx_Milestone_82.md` before any Surgical Executor work begins.
