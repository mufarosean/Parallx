# Browser agent implementation contract

Reviewed 2026-09-10. This is the implementation decision record for the [browser audit](BROWSER_AGENT_AUDIT_AND_PROPOSAL.md). Read this document first when implementation is authorized. It supersedes exploratory alternatives in the audit; the audit supplies evidence, diagnostic commands, and acceptance fixtures.

## 1. Decisions to implement

1. **Keep the visible Electron WebContentsViews. Use native CDP through a shared main-process debugger controller.** Playwright remains the test driver. Do not add Playwright MCP, Stagehand, Browser Use, a cloud browser, or another model planner as production dependencies. Reconsider the transport only if the actual-view feasibility gate demonstrates a specific unmet requirement. A broken test harness alone is not that evidence.
2. **One active automation run per assistant profile initially.** It can own multiple tabs. A competing run receives `BROWSER_BUSY`; do not build a scheduler or silently queue another conversation behind a potentially consequential action. This also avoids simultaneous runs changing shared assistant cookies. User tabs remain separate.
3. **Reuse existing identities and cancellation.** `IChatToolInvocationCallContext.sessionId` identifies the chat; `ICancellationToken.turnId` identifies the request; `ISessionManager.activeContext` supplies workspace ID, workspace-session ID, and cancellation signal. Do not invent an alternative turn-ID propagation chain. Missing trusted identity returns `MISSING_CONTEXT` before acquiring control.
4. **Keep the current tool names.** Implement `browserOpen`, `browserRead`, `browserClick`, `browserType`, and `browserBack` through the new service. Add `browserAct` only for check/select/press/hover/scroll; `browserTabs` for list/switch/close; and `browserWait` for explicit waits. Add `browserCapture` only with completed image delivery. Do not simultaneously advertise renamed duplicates such as browserNavigate/browserObserve/browserSession. This replaces the audit's suggested naming table.
5. **The existing PolicyDecisionPoint remains the approval authority.** Preserve extension owner, disabled-tool checks, offered-tool checks, Careful Mode, user-task consent, autonomous-task behavior, and runtime observers. The browser broker enforces target ownership and operation validity; it does not implement a competing approval system. Do not restore the removed web-read-then-write confirmation gate.
6. **DOM/accessibility first; vision second.** No screenshot loop or extra inference call per action. No raw JavaScript/CDP tool for the model. This bounds model cost and keeps browser execution independently testable.

These are fixed design choices, not proof of runtime compatibility. The native fixture still needs to pass. Implementers should check contracts and tests, but should not repeat the framework survey without contradictory evidence.

## 2. File ownership and integration seams

New filenames below are prescribed module locations; they do not currently exist. Keep Electron runtime modules in CommonJS and renderer services in TypeScript, following their surrounding code. Do not move bundled Readability or refactor unrelated browser UI.

| Files | Required work and boundary |
| --- | --- |
| **New** `electron/browserDebugger.cjs` | Single owner of attach/detach, CDP commands, and event subscriptions per web contents. Route existing scriptlets and theme commands through it. Track and restore domain/script registrations after detach. Do not repeatedly detach/reattach while human DevTools is open; pause automation and resume after a successful attachment. |
| **New** `electron/browserAutomationBroker.cjs` | Own leases, profile lock, target references, serialized commands, action validation, waiters, and cancellation. Receive a narrow internal view accessor from browserBridge; do not create a second view registry. |
| `electron/browserBridge.cjs` | Remain owner of views, partitions, popup policy, downloads, and layout attachment. Wire debugger controller and broker to these existing views. Add agent ownership to native popup/download handling. Preserve normal user/private behavior. |
| `electron/main.cjs`, `electron/preload.cjs` | Register a dedicated typed automation IPC surface; validate trusted main-window sender and main frame. Wire renderer replacement/destruction and workspace-root transitions to lease revocation. Do not expose a browser-wide remote debugging endpoint in production. |
| **New** `src/services/browserAutomationTypes.ts`, `src/services/browserAutomationService.ts` | Define service identifier, action/result types, tools, and browser-run UI state. Register one eager service in `src/workbench/workbenchServices.ts` after chat services, before extension activation. Inject tools service, chat service, session manager, and settings access. Do not require a database to construct it. |
| **New** `src/api/bridges/browserAutomationBridge.ts`; `src/api/apiFactory.ts`; `src/api/parallx.d.ts` | Add a narrow `parallx.browser.registerAutomationHost(host)` API, available to `parallx.browser` only. Host callbacks reveal/adopt a broker-created tab and display run state. The returned disposable releases host registration, tool registrations, and leases. This API must not let an extension mint ownership or dispatch arbitrary actions. |
| `ext/browser/main.js` | Replace local agent handler registration with host registration. Keep toolbar/editor rendering here. Host adopts only tab IDs and ownership metadata supplied by the broker. Remove duplicate registration of the five old tools in the same change that registers their replacements. |
| `src/services/chatTypes.ts`, `src/services/chatService.ts` | Add a narrow request-completion lifecycle event carrying chat session ID and turn ID, emitted on all terminal paths, including error/cancellation and ephemeral requests. The browser service releases its lease there. Do not infer request completion from token disposal: current `CancellationTokenSource.dispose()` does not cancel it. |
| `src/services/chatTypes.ts`, `src/services/languageModelToolsService.ts`, `src/openclaw/openclawAttempt.ts` | Add an optional trusted `resultCharBudget` to invocation metadata and its forwarding path. Derive it from the existing round cap and number of tool calls in the current round before dispatch; retain compatibility for callers that omit it. Browser results trim optional text/targets before JSON serialization. A final cap that still cannot fit the envelope returns a small valid error, not cut JSON. Do not alter plain-text tool behavior. |
| `src/services/sealedWorkspace.ts`, `src/workbench/workbench.ts` | Wire seal changes and workspace teardown into the browser service/broker. Main process must revoke agent control before a renderer reload can orphan it. Ordinary user browsing remains unaffected. |

Register the production browser tools in the core automation service **only while the extension host is registered**, with `source: 'bridge'` and `ownerToolId: 'parallx.browser'`. Dispatch still goes through `LanguageModelToolsService.invokeToolWithRuntimeControl`. This preserves extension activation, enablement, seal filtering, policy, and cleanup while keeping trusted invocation identity out of extension-controlled action arguments.

The broker's sender validation protects the guest/app boundary and scoped dispatch. It is not a claim that an arbitrary compromised trusted app renderer becomes harmless. Keep the scope of security claims accurate.

## 3. Identity, lifecycle, and UI rules

Use distinct names: `chatSessionId`, `turnId`, `workspaceId`, and `workspaceSessionId`. The latter is the per-open epoch, not the stable workspace ID. The broker generates its own opaque `leaseId`. Its record binds these identities, main-window renderer generation, assistant profile, owned tabs, and cancellation state. Never trust a model-provided workspace path, profile name, or webContents ID.

On the first browser action, acquire the profile lock, create or explicitly reacquire this chat's assistant tab, and ask the extension host to reveal it. A later turn in the same chat may reuse its page with a **new** lease and fresh observation. Another chat cannot adopt it. On completion, release automation authority and leave the page available for inspection. On workspace departure, close owned agent views and discard runtime references; do not close ordinary user views. App layout restoration must not resurrect agent leases or replay actions.

Subscribe to workspace-session invalidation, extension deactivation, request cancellation/completion, seal changes, and native view failure. Also invalidate leases in the main process when the app renderer navigates/reloads or disappears; Electron views can outlive renderer panes. Revocation must synchronously mark a lease inactive before asynchronous cleanup. Recheck this flag immediately before each input command and before returning evidence. Reject late results from old workspace epochs.

Main-process automation starts unavailable until the trusted renderer registers the current workspace epoch and seal state. On sealing, revoke leases, cancel owned downloads, and close agent views so their scripts cannot keep running; leave user/private browsing unchanged. Integrate the agent egress check into the existing session request handler, rather than replacing Electron's single handler and losing ad blocking or HTTPS policy. Already-sent requests cannot be undone. Unsealing permits a fresh lease; it never resumes old commands automatically.

One shared debugger controller coordinates automation with scriptlets, page theme, and DevTools. The driver must also cooperate with the renderer's overlay/snapshot hiding and view bounds. Coordinate actions require a current attached viewport; a hidden/detached view yields `PAGE_NOT_ACTIONABLE`. Reveal it through the host before retrying. Avoid creating a snapshot/hide/activate loop.

Human input pauses control. Do not distinguish it using `event.isTrusted` alone: native automated input can also be trusted. Track automation dispatch and test concurrent genuine user input explicitly; an overly broad suppression window that ignores the user fails acceptance. Resume obtains a fresh observation. Browser keyboard shortcuts must not allow model key presses to invoke arbitrary workbench commands; scope the automated key path to page input.

Assistant cookies remain in the existing persistent assistant partition for this project. Do not silently migrate/copy user cookies or introduce per-workspace authentication stores. Make assistant clearing explicit; keep agent navigation out of ordinary history/tab persistence. Do not guess ownership of historical mixed rows or mass-delete user history. Test new-write separation and future clearing behavior.

## 4. Action and result contract

Every target reference binds a document, frame, observation, and host-owned node identity. Preserve identity across harmless mutations when revalidation succeeds; reject detached, replaced, obscured, or mismatched targets. A fresh read must never make an old reference point at a different element. For legacy numeric arguments, map to the latest observation within that lease only; validate it before dispatch. Numbers are never direct DOM attribute selectors.

The result envelope is versioned JSON inside `IToolResult.content` initially:

```typescript
type BrowserOutcome = {
  version: 1;
  status: 'ok' | 'needs_user' | 'cancelled' | 'error';
  tabId?: string;
  documentId?: string;
  observationId?: string;
  url?: string;
  summary: string;
  targets?: BrowserTarget[];
  truncated?: boolean;
  evidence?: { kind: string; detail: string }[];
  error?: { code: string; retryable: boolean };
};
```

Keep lease credentials internal. `isError` must be true for `error`, `cancelled`, and an action that was not executed because user intervention is required. `needs_user` must explain the intervention; it must not be narrated as success. Do not return a background `pending` action that continues after the tool call ends. Long operations return a bounded wait outcome and can be observed again.

Use explicit conditions for success: selected option matches, checkbox state matches, navigation committed, requested text entered, or the expected target/state appeared. A click being delivered is not proof of a booking/payment/submission succeeding. Never automatically retry an uncertain consequential action. Generic browser controls cannot reliably infer every website's business consequences from DOM labels; do not claim that a label classifier enforces task intent. Preserve user authorization and use concrete handoff when scope is unresolved.

For popup acceptance, check the resulting tab's actual Electron session, opener/run ownership, and model-visible tab state. Checking only the forwarded event is insufficient. Keep the existing popup-blocking policy; do not allow all popups to make a test pass. Agent downloads must be assigned to the originating run at `will-download`, never to whichever workspace happens to be active when completion arrives.

Route an allowed agent popup through the broker to create its owned child before notifying the extension; do not also forward it into the ordinary `openTab` branch. Model-requested navigation accepts HTTP(S) URLs only; internal blank pages are host-created. Preserve ordinary browser URL policy outside the automation path. Downloads stage at `userData/browser/artifacts/<workspaceId>/<runId>/`, using validated host-generated directory identifiers and collision-safe filenames. The run record fixes that path at start; the model cannot choose it. Temporary screenshots use the same ownership convention. Provide bounded cleanup for abandoned artifacts and explicit retention for artifacts referenced by saved chat history.

## 5. Interaction with other app systems

| System | Required behavior and test |
| --- | --- |
| Chat tools, Careful Mode, workflows/cron | Same registry and PDP path for old and new browser tools. Browser state creates no new initiator or consent inference. Test interactive, user-task, autonomous, disabled extension, and sealed workspace. A busy foreground browser returns a typed result to an autonomous run rather than stealing its view. |
| Session/workspace teardown | Combine token cancellation with workspace abort. Add a late-result test: switch A to B during a browser wait/download; no result or file is written into B. Test renderer reload independently of extension cleanup. |
| Transcript and tool cards | Use existing runtime tool cards for progress/outcomes. Preserve error flags through normalization and round caps. Keep detailed trace references, not full page HTML or screenshots in every progress event. Test cancellation and `needs_user` rendering. |
| Search, fetch, RAG, notes/canvas | Preserve current search/fetch tools. Browser reads describe the live page with URL/title and observation time; they do not silently re-fetch it. Page data is untrusted source material, not system instructions. No automatic indexing or note/canvas writes as a side effect of observing. Explicit saves use existing app tools and source attribution. |
| Links and OAuth | Agent popups retain agent ownership. Normal app links keep existing in-app/system routing. Do not divert explicit system-browser OAuth links into the assistant browser. Test these independently. |
| Persistence and downloads | Runtime leases/element references are never persisted as resumable commands. Download staging uses an owned application artifact directory bound to the originating workspace/run; export uses existing file boundaries. Keep downloads and screenshots out of ordinary indexed workspace content until explicitly saved. |
| Model providers and MCP, vision phase only | Update `IToolResult`, message conversion in `openclawAttempt.ts`, inbound `mcpToolBridge.ts`, outbound `src/api/bridges/mcpBridge.ts`, provider serializers, tool cards, and `chatSessionPersistence.ts` together. Current Anthropic tool-result serialization is text; Ollama accepts message images in its adapter but that does not prove tool-image model support. Capability-check and verify actual serialized requests. Preserve tool-call association and error text. |

For vision, keep `content: string` backward compatible and add optional artifact references. Resolve bounded image bytes only at provider serialization. Persist references with explicit retention; reopen history must tolerate an expired artifact. Never rely on base64 text. Clear/delete operations remove owned artifacts without deleting unrelated files. Do not send screenshots to a provider absent vision capability or cloud/sealed authorization.

## 6. Cost and performance defaults

These are initial tunable limits, not measured performance claims. Keep them in one options object and record truncation/timeouts in evidence:

- Normal observation: at most 80 actionable targets and 12,000 characters total, or the smaller current tool-result budget. Preserve the result header, error, and complete target records. Return a truncation indicator and scope/cursor for additional reads; do not serialize JSON and then cut it mid-record.
- Summarize the requested region first. Return changed state after an action; do not automatically repeat 50 KB of readable text. Provide enough nearby content for the model to decide its next action.
- Actionability wait: 5 seconds; navigation/explicit condition wait: 15 seconds by default, bounded at 30 seconds per call. These are deadlines, not fixed delays; return immediately once verified. Register listeners before dispatch and remove them in `finally`.
- At most one automatic refresh-and-revalidate for read-only/stale observation recovery. Never silently retarget or replay a click/type/submit. Repeated identical no-progress outcomes return an explanation to the model.
- Vision: viewport/region capture on request or explicit fallback only, one image per observation, initial 1 MB encoded-image cap. Return a typed size error or an explicitly scaled image with matching coordinate metadata.
- Use existing model turn/tool budgets and existing logs. Do not build another budget manager, always-on screenshot stream, or persisted DOM mirror.

## 7. Implementation gates and verification

Follow Tasks A–E in the audit with these refinements: A proves **native CDP first**; it does not require a framework comparison. B implements the file ownership/registration contracts above. C completes the action regressions. D completes the actual visible task workflow and cross-system matrix. E adds image delivery end to end.

Keep gate dependencies acyclic: A verifies transport primitives and demonstrates manual detach/reattach feasibility in the isolated harness. It does not require the production broker, automated recovery, or new lifecycle events to exist already. Those are implemented and tested in B. A's screenshot is a diagnostic artifact; model-visible screenshot delivery belongs to E. B–D use deterministic actions and text results without depending on E.

The outstanding native probe failed with `ERR_FAILED (-2)` before testing accessibility/input/capture. Resolve the fixture, then verify the real integration. Do not announce transport support based on this document. Revisit a fixed choice only with a failing reproducible acceptance case or a conflicting current repository contract; record the smallest required amendment and continue independent work.

Additional review baseline: **59 tests passed** in `chatBridge.test.ts` (5), `languageModelToolsService.test.ts` (30), `mcp/mcpToolBridge.test.ts` (16), and `workspaceSwitchFreeze.test.ts` (8). The latter covers cancellation helpers, not a complete native browser workspace transition. Together with the audit's earlier 29 tests, this is 88 existing baseline tests, not tests of the proposed feature.

Completion requires new integration/regression coverage for every changed boundary, the repository build, and an isolated actual-app demonstration. Keep production browser code unchanged until implementation is requested. No whole-app launch against the user's current workspace, live consequential website tests, or paid model evaluation is part of document review.
