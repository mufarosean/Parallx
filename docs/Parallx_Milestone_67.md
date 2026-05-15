# Milestone 67 — Security & data-leakage hardening

> **Status:** Planning — research complete, implementation deferred to early
> June 2026 (or later). This is a planning document, not a work-in-progress.
> Nothing in this milestone is in flight.

## Why

Parallx runs an autonomous AI agent on the user's local machine with no
container, no OS sandbox, and no central trust boundary. The current security
posture is the cumulative result of many good local decisions (M53 file-backed
storage, M58 autonomy logs, M60 OAuth desktop flow, M65 web-research egress
controls), but those decisions are scattered across **five different layers**
that don't share state and don't share enforcement:

| Layer | What it enforces | Where |
|---|---|---|
| Tool layer | Workspace-relative path sanitization | `src/built-in/chat/tools/writeTools.ts` |
| Tool color | Web→write taint gate | `src/openclaw/openclawToolPolicy.ts` |
| Permission service | Approval level + strictness | `src/services/permissionService.ts` |
| Tool blocklist | Specific dangerous command strings | `src/built-in/chat/tools/terminalTools.ts` |
| IPC handlers | (mostly nothing — see audit) | `electron/main.cjs` |

The result: any *new* tool, *new* extension, or *new* IPC handler must
re-implement the right subset of these checks from memory. The mechanism is
strong where it has been thought through (M65 web fetch is genuinely good) and
absent where it hasn't (the `run_command` blocklist is security theater).

This milestone is **not "rewrite security from scratch."** It is:

1. Close the verified holes (Phase 1 — small, scoped, committable in a day).
2. Consolidate the scattered logic into a single Policy Decision Point so the
   next tool/extension/IPC handler gets the right enforcement by default
   (Phase 2 — refactor).
3. Tighten the renderer/preload trust boundary so a hostile extension cannot
   exfiltrate workspace data without going through a capability check
   (Phase 3 — bigger refactor).
4. Hygiene items that don't fit anywhere else (Phase 4 — finishing).

## Audit — what we actually have today

All claims below were verified by reading the listed file:line. False positives
from the initial scan have been corrected.

### A. Permission and approval system

| Concern | File:line | State |
|---|---|---|
| Three-tier permission model | [permissionService.ts:1-15](../src/services/permissionService.ts#L1-L15) | ✅ Implemented |
| Global auto-approve flag | [permissionService.ts:295-298](../src/services/permissionService.ts#L295-L298) | ⚠️ Mechanism exists; only `setAutoApprove(true)` caller in production is **tests** ([languageModelToolsService.test.ts:211](../tests/unit/languageModelToolsService.test.ts#L211)). No UI, no setting, no IPC. Risk = future regression. |
| Approval-strictness `streamlined` | [permissionService.ts:444-451](../src/services/permissionService.ts#L444-L451) | ⚠️ Live; set from agent-config JSON only ([unifiedConfigTypes.ts:279-280](../src/aiSettings/unifiedConfigTypes.ts#L279-L280)). Default is `'balanced'` ([permissionService.ts:86](../src/services/permissionService.ts#L86)). No UI exposure. |
| Persistent overrides | [permissionsFileService.ts:20](../src/services/permissionsFileService.ts#L20) | ✅ Workspace-scoped at `.parallx/permissions.json`, debounced write |
| Heartbeat / subagent gate | [permissionService.ts:467-493](../src/services/permissionService.ts#L467-L493) | ✅ `autonomy='manual'` blocks all tools BEFORE auto-approve is checked |
| Decision order | [permissionService.ts:428-461](../src/services/permissionService.ts#L428-L461) | autoApprove → persistent → session → strictness → default |

### B. Tools and color gating

`RED_TOOLS` and `BLUE_TOOLS` per [openclawToolPolicy.ts:404-434](../src/openclaw/openclawToolPolicy.ts#L404-L434):

- **Red (untrusted-content sources):** `webSearch`, `webFetch`
- **Blue (consequential writes; gated after red fires this turn):** `write_file`,
  `edit_file`, `create_page`, `compose_page`, `set_page_property`,
  `set_page_style`, `edit_block`, `insert_block_after`, `link_block`,
  `surface_send`

**Notable absences from BLUE_TOOLS:**

- `run_command` — arbitrary shell execution. After a `webFetch` taints the
  turn, a prompt-injected response can direct the model to run
  `run_command "powershell -c '...'"` and the color gate does not fire.
- `delete_file` — destructive write; also not blue.
- `sessions_spawn` — can spawn a subagent that itself runs blue tools.
- MCP tools generically — M65 §F4 was explicitly deferred; the explicit
  blue-name list is the current contract.

### C. `run_command` specifically

[terminalTools.ts:14-31](../src/built-in/chat/tools/terminalTools.ts#L14-L31):

```ts
const COMMAND_BLOCKLIST: readonly string[] = [
  'rm -rf /', 'format', 'mkfs', 'dd if=', ':(){:|:&};:',
  'shutdown', 'reboot', 'halt', 'init 0', 'init 6',
];
function isCommandBlocked(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return COMMAND_BLOCKLIST.some(b => lower.startsWith(b) || lower.includes(b));
}
```

Trivially evaded by: `cmd /c rd /s /q ...`, `powershell -c "..."`,
`python -c "import shutil; ..."`, `Move-Item -Force`, `taskkill`,
`reg delete`, `schtasks /create`, `curl ... | iex`, etc. None are in the list.

[main.cjs:1974-1985](../electron/main.cjs#L1974-L1985) then concatenates the
command into `execAsync(command, { shell: 'powershell.exe', ... })`. Once
approval is granted, the command runs as the user, full PowerShell semantics.

### D. AI file tools — workspace scoping

✅ **The workspace boundary IS enforced at the tool layer** (verified, despite
the initial audit's incorrect "CRITICAL" flag here):

- [writeTools.ts:32-58](../src/built-in/chat/tools/writeTools.ts#L32-L58):
  `sanitizeRelativePath()` rejects `/` prefix, drive letters, `..` traversal,
  and `.parallxignore` matches.
- [main.ts:1396](../src/built-in/chat/main.ts#L1396): writer constructs the
  target URI as `rootUri.joinPath(clean)` — workspace-relative join.

⚠️ **But the IPC handlers themselves do not re-validate**. Confirmed by direct
read of [main.cjs:995-1033](../electron/main.cjs#L995-L1033) — `fs:readFile`
and `fs:writeFile` call `fs.readFile`/`fs.writeFile` directly with no path
check. If any other renderer code (extension, future feature) constructs an
absolute path and routes it through `api.fs.*`, the IPC layer happily accepts
it. The tool-layer guard is the only line of defense.

This is the most important architectural correction from the initial audit:
**the boundary works today, but it is single-layer and depends on every caller
remembering to call `sanitizeRelativePath` first.**

### E. IPC handler surface — 82 channels

Full enumeration in research notes (not duplicated here). Highlights:

| Class | Channels | Risk |
|---|---|---|
| `fs:*` (10 channels) | read/write/stat/readdir/exists/rename/delete/mkdir/copy/watch | ⚠️ No re-validation — see §D |
| `database:*` (12 channels) | SQLite operations | ✅ Parameterized; one exception: `database:dropToolData` interpolates identifiers ([main.cjs:1630](../electron/main.cjs#L1630)) — currently only called with hard-coded prefixes |
| `ext-database:*` (8 channels) | Per-extension SQLite | ✅ Extension-ID + parameterized |
| `terminal:*` (6 channels) | Shell exec / spawn | ⚠️ See §C; `terminal:exec` is the live RCE risk |
| `mcp:*` (4 channels) | MCP server lifecycle | ✅ `filterEnv()` allowlist ([mcpBridge.cjs:194-213](../electron/mcpBridge.cjs#L194-L213)); spawn with args array, no shell concat |
| `webFetch:*`, `webSearch:*` (3 channels) | Network egress | ✅ M65 7-layer defense — see §G |
| `secret:*` (3 channels) | Encrypted secret storage | ✅ Key allowlist `^[a-zA-Z0-9._-]{1,128}$` ([main.cjs:1265-1271](../electron/main.cjs#L1265-L1271)); values via `safeStorage` |
| `shell:openExternal` | Open URL in default browser | ✅ HTTPS-only check ([main.cjs:1195](../electron/main.cjs#L1195)) |
| Others (dialog/docling/document/storage/window/lifecycle) | Misc | ✅ Adequate |

### F. Preload surface

[preload.cjs](../electron/preload.cjs) exposes **only** namespaced IPC under
`window.parallxElectron`. ✅ No `require`, ✅ no raw `fs`/`path`/`child_process`,
✅ no Node modules. The renderer's only path to the host OS is through
contextIsolated IPC.

### G. Web fetch chokepoint (M65)

[webFetchBridge.cjs](../electron/webFetchBridge.cjs) — all seven layers verified
present:

1. DNS preflight + private-CIDR blocklist ([211-274](../electron/webFetchBridge.cjs#L211-L274))
2. Domain blocklist with subdomain match + `/raw/` defense ([275-290](../electron/webFetchBridge.cjs#L275-L290))
3. HTTPS-only hard reject ([319-332](../electron/webFetchBridge.cjs#L319-L332))
4. Body cap 10 MB measured by bytes-read, not Content-Length ([381-393](../electron/webFetchBridge.cjs#L381-L393))
5. 15 s wall-clock AbortController ([333-336](../electron/webFetchBridge.cjs#L333-L336))
6. Max 3 redirects, each re-preflighted ([340-366](../electron/webFetchBridge.cjs#L340-L366))
7. DNS pinning via `https.request({ lookup })` closure ([301-318](../electron/webFetchBridge.cjs#L301-L318))

**Verified gaps:**
- ⚠️ No IDN (punycode/homoglyph) normalization before blocklist check.
- ⚠️ MCP server processes do **not** route through this chokepoint — they have
  unrestricted network access at user privilege.
- ⚠️ Local file reads (`read_file`) and MCP tool outputs are **not** tainted;
  M65 taint only tracks web content.

### H. Renderer / Electron posture

[main.cjs:457-463](../electron/main.cjs#L457-L463):
```js
webPreferences: {
  preload: '...',
  contextIsolation: true,   // ✅
  nodeIntegration: false,   // ✅
  sandbox: false,           // ⚠️ intentional (preload needs Node)
  spellcheck: true,
}
```

**CSP IS present** ([index.html:6-7](../electron/index.html#L6-L7)) — initial
audit was wrong on this point:

```
default-src 'self';
connect-src 'self' http://localhost:11434 http://127.0.0.1:11434;
style-src 'self' 'unsafe-inline';
script-src 'self' file: blob:;
worker-src 'self' blob:;
font-src 'self' data: blob:;
img-src 'self' data: blob: https:;
media-src 'self' data: blob: https:;
object-src 'self' data:;
frame-src 'self' data: blob: https:;
```

Gaps:
- `style-src 'unsafe-inline'` is necessary for dynamic UI; defense-in-depth only.
- `img-src/media-src/frame-src https:` are needed for web-research but allow
  anywhere; M65 §Layer 6 renderer image-gate covers this for chat surfaces.
- No `setWindowOpenHandler` / `'will-navigate'` interception. Verified by grep:
  zero matches in `src/`. SPA model means this hasn't been needed, but it is
  a defense-in-depth gap.

### I. Extensions

- **Loaded as blob: imports** ([toolModuleLoader.ts:80-88](../src/tools/toolModuleLoader.ts#L80-L88))
  in the same renderer.
- **Share `api.workspace.fs`** with no per-extension namespace — any extension
  can read any workspace file, not just its own subdirectory.
- **`.plx` packages installed with no signature or hash check**
  ([main.cjs:699-787](../electron/main.cjs#L699-L787)). Manifest is parsed,
  contents extracted via `AdmZip`. User trust = source trust.
- **Per-extension SQLite IS isolated** ([main.cjs:1683-1768](../electron/main.cjs#L1683-L1768))
  — each extension gets `ext-database:open(extensionId, ...)` and the bridge
  enforces extension-id scope.

### J. Data at rest

| Item | Where | Encrypted? |
|---|---|---|
| Brave Search API key | `data/secrets/<sha256>.enc` | ✅ `safeStorage` (DPAPI/Keychain/libsecret) |
| LLM API keys (OpenAI, Anthropic, etc.) | `data/global-storage.json` or workspace `settings.json` | ❌ Plaintext JSON |
| Agent configs / system prompts | Same | ❌ Plaintext |
| Gmail OAuth refresh token | `~/.parallx/gmail-mcp/credentials.json` | ❌ File permissions only (mode 0600); **outside portable folder** |
| Autonomy event log | `<workspace>/.parallx/logs/autonomy-events.<date>.ndjson` | ❌ Plaintext; **unredacted** — includes raw tool I/O, file contents, web bodies |
| Permission overrides | `<workspace>/.parallx/permissions.json` | ❌ Plaintext (not sensitive) |
| Workspace data | `<workspace>/.parallx/data.db` | ❌ SQLite; not encrypted |

### K. Temp files / child processes

- ✅ Electron defaults redirected to portable folder ([main.cjs:127-138](../electron/main.cjs#L127-L138)):
  `userData`, `sessionData`, `crashDumps`, `logs` all point inside `data/`.
- ⚠️ `TMPDIR`/`TEMP`/`TMP` not overridden for child spawns. Docling Python
  subprocess and ffmpeg (called by media-organizer) write to system temp.
- ✅ media-organizer's own temp files (phash `.gray` files) go to its
  extension data directory, not system temp
  ([ext/media-organizer/main.js:18194-18197](../ext/media-organizer/main.js#L18194-L18197)).

### L. Recycle bin / deletes

[main.cjs:1134-1165](../electron/main.cjs#L1134-L1165) — `fs:delete` defaults
to `useTrash: 'auto'`:
- Same-volume → `shell.trashItem` (Windows Recycle Bin via IFileOperation).
- Cross-volume → permanent `fs.rm` (Windows Recycle Bin can't span volumes).
- Explicit `useTrash: false` only used by media-organizer for its own temp
  files ([ext/media-organizer/main.js:3491-3531](../ext/media-organizer/main.js#L3491-L3531)).

## Threat model

| Adversary | Capabilities today | Plausibility |
|---|---|---|
| **Malicious prompt-injected web page** | Can talk to LLM via webFetch result; constrained to text only; cannot construct URLs (M65 Layer 2); cannot bypass body cap | High plausibility, **partially mitigated** by M65 |
| **Malicious file in workspace** (downloaded, cloned, gifted) | `read_file` is `always-allowed` and content is fed verbatim to model with no taint mark | High plausibility, **unmitigated** |
| **Malicious MCP server** (user-installed) | Inherits user privilege; unrestricted network; full filesystem at user level | Medium plausibility (user picks the server), **unmitigated** |
| **Malicious .plx extension** | Same renderer, same `api.workspace.fs`, can read entire workspace | Medium plausibility, **unmitigated** |
| **Compromised LLM response** (provider breach, model jailbreak) | Can request `run_command`; blocked behind approval gate today | Medium plausibility, **mitigated only by approval prompt + bypassable blocklist** |
| **Local user with disk access** (theft, multi-user PC) | Plaintext LLM API keys, plaintext Gmail token (mode 0600 only), plaintext autonomy log | Low-medium plausibility, **partially mitigated** |
| **Network attacker** (rogue Wi-Fi, MITM) | HTTPS-only + DNS pin defeat passive eavesdropping; cert pinning absent | Low plausibility (HTTPS sufficient) |

## Top findings, ranked

1. **🔴 `run_command` is approval-gated only.** Blocklist is theater. Once
   approved, full PowerShell on the user's box. Not in `BLUE_TOOLS` so the
   M65 taint gate does not fire after web fetch.
2. **🔴 `_autoApprove` mechanism exists with no production caller.** Not a live
   exploit, but a foot-gun — any future "agent mode" UI that flips this flag
   undoes every approval gate at once.
3. **🟠 IPC `fs:*` handlers don't re-validate paths.** Single-layer boundary;
   only the tool layer enforces workspace scope. An extension or any future
   renderer code that constructs an absolute path is unconstrained.
4. **🟠 `read_file` is `always-allowed` and untainted.** Prompt injection via
   workspace file (Markdown, PDF text, etc.) is unmitigated.
5. **🟠 MCP server processes have unrestricted network and filesystem.** The
   egress chokepoint does not apply to them.
6. **🟠 Extensions share one renderer + one `api.workspace.fs` namespace + no
   `.plx` signature check.**
7. **🟡 LLM API keys + agent configs stored plaintext** in `global-storage.json`.
8. **🟡 Gmail credentials at `~/.parallx/gmail-mcp/credentials.json`** —
   outside portable folder, file permissions only.
9. **🟡 Autonomy event log unredacted.** 90-day retention of raw tool I/O.
10. **🟡 `TMPDIR` not redirected** for docling/ffmpeg children.
11. **🟡 No IDN homoglyph normalization** in web fetch blocklist.
12. **🟡 No `setWindowOpenHandler` / `'will-navigate'`** defense-in-depth.

## Design — three architectural moves

### 1. Policy Decision Point (PDP)

Single service that every tool invocation, every IPC handler, and every
extension capability check consults. Replaces:

- `permissionService.checkPermission` (the approval-level computation)
- `openclawToolPolicy.getToolColor` (color classification)
- `terminalTools.isCommandBlocked` (blocklist)
- `writeTools.sanitizeRelativePath` (path enforcement at tool layer)
- The implicit-and-undocumented "did we remember to validate the path here?"
  pattern in IPC handlers.

**Proposed interface** (sketch — not final):

```ts
interface IPolicyDecisionPoint {
  /**
   * Decide whether `caller` may invoke `tool` with `args` in `turnContext`.
   * Returns the full decision with reasons (auditable).
   */
  decide(req: PolicyRequest): PolicyDecision;
}

interface PolicyRequest {
  caller: { kind: 'built-in' | 'extension' | 'mcp', id: string };
  tool: { name: string, color: ToolColor };
  args: Record<string, unknown>;
  turn: { id: string, taintedBy: Set<string> };
  approvalState: 'allow-once' | 'allow-session' | 'always-allow' | null;
}

interface PolicyDecision {
  outcome: 'allow' | 'require-approval' | 'deny';
  reasons: string[];      // ['caller-trusted', 'color-blue-post-red', ...]
  taintAfter: Set<string>;
  redactionsForLog: string[]; // paths within args to redact when logging
}
```

**Closes findings:** #1 (run_command color + blocklist replaced), #2
(autoApprove gated through PDP can never override deny), #3 (path-check
becomes one function called from IPC AND tools), #4 (file-read taint added
as a first-class concept).

**Effort:** ~2-3 weeks. Mechanical migration after design lands. Tests added
per migrated tool family.

### 2. Capability-issued IPC for extensions

Today: every extension gets ambient `api.workspace.fs.*` over the same
workspace root.

Proposed: extensions request capabilities at activation:

```ts
const fs = await api.requestCapability('fs', {
  scope: 'extension-data',   // or 'workspace-data', 'workspace-files'
  roots: ['extensions/budget'],
  modes: ['read', 'write']
});
fs.readFile('data.json');   // namespace-bound; cannot escape
```

The capability handle carries a per-extension token. IPC handlers trust the
token (and the path is automatically prefixed by the granted root) rather
than trusting the extension to pass a sane path.

**Closes findings:** #3 (IPC re-validation by construction), #6 (extension
namespace isolation), partially #5 (MCP gets the same capability-issuance
model).

**Effort:** ~4-6 weeks. Compat shim required so existing extensions keep
working during migration. First-party extensions migrated first; third-party
gets a one-version deprecation window.

### 3. Taint propagation beyond web content

Extend the M65 turn-taint registry to track:
- File reads that originate outside a `trusted-roots` list (user-configurable;
  defaults to the workspace canvas + chat history + memory).
- MCP tool outputs (M65 §F4 already deferred this).
- Files that contain a `<!-- parallx:untrusted -->` marker.

A tainted turn forces re-approval for any blue tool, just like M65 today.

**Closes findings:** #4 (read_file taint), part of #5 (MCP output taint).

**Effort:** ~1 week. Builds directly on M65 plumbing.

## Phased plan

### Phase 1 — Close the verified holes (~1 day, 6 small PRs)

| # | Change | File | Effort |
|---|---|---|---|
| 1 | Add `run_command` and `delete_file` to `BLUE_TOOLS` | `openclawToolPolicy.ts` | 5 min |
| 2 | `run_command` hard-coded to ignore `_autoApprove` and `streamlined` | `permissionService.ts` | 30 min |
| 3 | Move Gmail creds to `<workspace>/.parallx/mcp/gmail-mcp/credentials.json` + migration shim | `mcpBridge.cjs`, Gmail MCP server | 2 h |
| 4 | Set `TMPDIR`/`TEMP`/`TMP` to `<app_root>/data/temp/` before spawning docling/ffmpeg/MCP | `doclingBridge.cjs`, `mcpBridge.cjs`, ffmpeg spawn site | 1 h |
| 5 | Heuristic redaction in autonomy log writes (`sk-...`, `ghp_...`, `Authorization:` headers) | `autonomyLogService.ts` | 2 h |
| 6 | Migrate LLM API keys from plaintext `global-storage.json` to `safeStorage` (reuse Brave pattern) | `unifiedAIConfigService.ts`, `main.cjs` secret handler | 4 h |

**Acceptance:** unit tests for each change; no e2e regression; documented in
`SECURITY_CHANGELOG.md`.

### Phase 2 — Policy Decision Point (~2-3 weeks)

- 2.1 Design `IPolicyDecisionPoint` interface; review with Security Analyst agent.
- 2.2 Implement `PolicyDecisionPoint` service consolidating
  `permissionService` + `openclawToolPolicy` + `terminalTools` blocklist.
- 2.3 Migrate file tools → canvas tools → terminal → MCP-routed tools.
- 2.4 Wire IPC `fs:*` handlers through the PDP using a built-in caller ID
  (`'built-in:ipc:fs'`).
- 2.5 Audit log every decision (the existing `_auditLog` becomes the PDP log).

**Acceptance:** every approval-gate in production goes through PDP; legacy
`checkPermission` is a thin shim or removed; new test suite covering all
decision paths.

### Phase 3 — Capability IPC for extensions (~4-6 weeks)

- 3.1 Define capability schema in manifest (`capabilities: { fs: { roots: [...] } }`).
- 3.2 Implement `api.requestCapability()` returning per-extension fs/secret/network handles.
- 3.3 Ship compat shim: legacy ambient `api.workspace.fs` continues working
  for one release with deprecation warning.
- 3.4 Migrate first-party extensions (budget, media-organizer, text-generator,
  workspace-graph, web-research) to capability-based API.
- 3.5 Tighten preload: legacy ambient APIs only available to extensions that
  declare `legacy: true` in manifest.

**Acceptance:** an extension without `fs` capability cannot read workspace
files; e2e test confirms; first-party extensions pass with no functional
regression.

### Phase 4 — Hygiene (~1 week)

- 4.1 IDN punycode normalization in web fetch blocklist.
- 4.2 `setWindowOpenHandler` returning `{ action: 'deny' }` + open via
  `shell.openExternal` instead.
- 4.3 `.plx` package SHA-256 manifest + optional Ed25519 signature check.
- 4.4 Add taint propagation for `read_file` and MCP outputs (M65 §F4 follow-up).
- 4.5 Remove `_autoApprove` test-only setter entirely; replace with test-only
  PDP injection so the production codebase carries no global bypass.

## Out of scope

- **OS-level sandbox** (Windows AppContainer, macOS sandbox-exec, Linux user
  namespaces). Too disruptive for what Parallx does (ffmpeg, docling, MCP
  children, user workspace anywhere on disk).
- **End-to-end workspace encryption.** SQLite/JSON files at rest are protected
  by user-level file permissions only. Adding encryption is a separate
  initiative (likely M70+).
- **Code signing the Parallx app binary itself.** Distribution concern, not
  in-app security.
- **Per-IPC-channel rate limiting.** Useful as DoS defense; not on the threat
  model today.
- **Capability check for first-party built-in tools.** Built-ins are trusted
  by definition; PDP for built-ins is about consistency, not isolation.

## Open questions for the user

1. **`run_command` shape:** keep raw shell string + better gating, or move to
   argv mode (`{ command, args[] }`) and lose pipeline syntax?
2. **`streamlined` strictness:** keep it (advanced user feature), or remove it
   along with `_autoApprove` so the only approval-bypass route is per-tool
   "always allow"?
3. **Extension trust tiers:** binary (trusted / untrusted) or three tiers
   (first-party / approved-marketplace / sideloaded)?
4. **Phase 1 commit policy:** all six items in one PR or one per item? Each
   one is small enough to commit independently and has its own test.
5. **Timeline:** all four phases, or stop after Phase 1 + Phase 2 (the highest
   risk reduction per week of effort)?

## References

- M58 — autonomy log infrastructure: [Parallx_Milestone_58.md](Parallx_Milestone_58.md)
- M60 — desktop OAuth + safeStorage: [Parallx_Milestone_60.md](Parallx_Milestone_60.md)
- M65 — web research egress + color gating + 7-layer defense: [Parallx_Milestone_65.md](Parallx_Milestone_65.md)
- M65 §F4 (deferred MCP-source blue detection) — picked up here as Phase 4.4
- Extension authoring contract: [PARALLX_EXTENSION_AUTHORING_FOR_AI.md](PARALLX_EXTENSION_AUTHORING_FOR_AI.md)
- MCP user guide: [MCP_SERVERS_USER_GUIDE.md](MCP_SERVERS_USER_GUIDE.md)
