# Browser automation implementation review

Reviewed 2026-09-11 against commit `8d440338fedab92ea799fcac33a66d082621dcd5`.

**Fix review, 2026-09-11:** R1, R2, and R3 below are implemented in the working tree. The build and 156 targeted tests pass. The native fixture passed all 64 gates at both default and 150% display scale. Live-model website success rates remain unmeasured. The original findings below describe the reviewed commit, before these fixes.

The original review changed no production files and reproduced all three defects with five failing tests. The user then authorized fixes. Production changes are confined to `electron/browserAutomationBroker.cjs`; the review group now contains 16 passing regression cases, running the actual broker through IPC and lifecycle hooks with synthetic views/debugger. Separate native fixtures exercise real pixels and mouse input. No existing user profile/workspace or Problem Bank source was changed.

## R1 — P1: deferred popups survive owner revocation

Location: `electron/browserAutomationBroker.cjs`, `onPopup`, lines 1959–1971. Caller: the allowed-popup branch in `electron/browserBridge.cjs`.

The handler captures the chat ID, awaits `privateRefused(url)`, then creates a tab and calls `loadURL`. It never rechecks the opener, workspace epoch, renderer generation, or the originating run after that await. Meanwhile `setContext` or `onRendererReset` can revoke the run and destroy all its views.

**Reproduction:** start an allowed popup and hold its address lookup; switch workspaces, seal the workspace, or reset the renderer; then resolve the lookup as public. All three cases create a replacement agent tab and issue `loadURL` after the old views were removed. In the real bridge a still-sealed session can block the network request, but it does not prevent the invalid tab creation. A new unsealed workspace has no such network block.

**Required fix:** capture ownership and workspace/renderer generation before asynchronous work. Revalidate the same opener record and generation immediately before creating a child and again before navigation if another await intervenes. Agent-triggered popups must respect cancellation/pause of their originating run. Preserve legitimate human popup behavior during takeover; do not require every human popup to have an active AI lease. Discard stale callbacks instead of reconstructing the old chat in a new workspace.

**Acceptance:** the three new revocation tests pass; the existing normal-popup tests still pass. Extend the actual-app fixture with a delayed lookup/route and a workspace transition to verify no stale tab appears.

## R2 — P1: screenshot coordinates do not validate changed page content

Location: `electron/browserAutomationBroker.cjs`, `actClickAt`, lines 1638–1657; capture metadata is created in `opCapture`.

`click_at` checks URL, navigation sequence, viewport, scroll, and zoom. It stores no content/visual generation and checks no pictured target identity. A SPA can replace a button or show a modal at the same coordinates while all checked metadata remains unchanged. The tool then sends a mouse move, press, and release and reports the click as executed.

**Reproduction:** capture the fixture; replace its content and targets with a different button while keeping URL, loader, scroll, and dimensions; call `click_at` with the old capture. The broker sends all three mouse events. The new test requires no input and `STALE_TARGET`.

**Required fix:** bind captures to meaningful content/layout state and revalidate the intended region before input. Where DOM identity is available, preserve the target/position association. For canvas or otherwise inaccessible content, verify current visual evidence for the target region or request a fresh capture. Navigation and viewport checks alone are insufficient. Do not replace this with the existing signature's text-length/node-count comparison: equal-length replacements and canvas changes evade that too.

**Acceptance:** the new stale-capture test passes, together with unchanged-page, scroll, zoom, and resize cases. Add a real fixture where a same-document replacement changes what occupies the clicked region, plus a canvas case. A mismatch must refuse input, not click and return an error afterwards.

## R3 — P2: check accepts an ordinary button and clicks it

Location: `electron/browserAutomationBroker.cjs`, `opAct`'s `check` branch, lines 1546–1560. The registered `browserAct` schema exposes check as a state-setting operation.

The branch validates disabled state but never verifies that the target is a checkbox, radio, switch, or supported checkable menu item. For an ordinary button, the generic node inspection reports `checked: false`; requesting `checked: true` therefore clicks it. Only after the click does the code return `STATE_NOT_CHANGED`. A mistaken model call can submit a form or trigger another button action even though it requested a checkbox operation. Asking for false can instead report “Already unchecked” for a non-checkable element.

**Reproduction:** call `browserAct` with `action: 'check'`, `checked: true`, and the ordinary `Send` button reference. Three mouse events are dispatched before the failure result.

**Required fix:** validate native input type or supported checkable accessibility role before comparing state or dispatching input. Reuse `CHECK_ROLES`, accounting for native checkbox/radio semantics. Return a typed unsupported-target error without clicking. Reject an impossible radio-uncheck request before input as well.

**Acceptance:** the new ordinary-button case passes; add the false-state case and ensure native/custom supported controls still work.

## Implemented fixes and follow-up review

- **R1:** deferred popups capture the opener, ownership epoch, workspace session, and originating active run. Ownership is checked before and after address resolution and after asynchronous tab creation. Revoked callbacks cannot navigate a new tab. Tests cover workspace switch, seal, renderer reset, cancel, pause, Stop, and host removal, while preserving valid human popups after request completion and during takeover.
- **R2:** keep the latest original lossless capture in host memory, bounded to one per run and released when the run ends. Immediately before coordinate input, compare the current pixels within 96 CSS pixels of the target in each direction. Same-document replacements and canvas changes in that region return retryable `STALE_TARGET` before input; changes elsewhere do not invalidate it. Preserve navigation/scroll/viewport/zoom checks and repeat ownership checks after asynchronous work. Reject captures collected across zoom/viewport/navigation changes and prevent artifact writes after cancellation. New captures invalidate older coordinate handles, while saved image artifacts remain readable according to the existing retention policy.
- **R3:** validate the live native input type or supported accessibility role before checking state or clicking. Ordinary buttons return `NOT_CHECKABLE` for either requested state. Selected radios cannot be unchecked through this operation; return `RADIO_UNCHECK_UNSUPPORTED` before input. Existing checkbox/native form coverage remains in the suite.

Follow-up checks included broker error conversion (stale captures must remain retryable), cancellation during screenshot validation, cancellation during capture, capture lifetime, tab removal cleanup, tool schemas, and the existing service/transport/image tests.

The pixel check is deliberately conservative. Animation, hover effects, or a blinking caret inside the target region can require another capture. It is a stale-image guard, not proof that a website's action is safe or that invisible event-handler changes are detected. There is still an unavoidable interval between observation and browser input. Prefer accessible references when available.

## Verification and handoff

Executed before adding review regressions:

- Eight targeted test files: **140 tests passed** (`browserAutomationBroker`, `browserAutomationBrokerRuntime`, `browserAutomationService`, `browserPolicy`, `chatServiceCompletion`, `openclawToolImages`, `anthropicToolImages`, `mcpToolBridgeImages`).
- `node node_modules/typescript/bin/tsc --noEmit`: passed.

Historical reproduction before the fix:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/browserAutomationBrokerRuntime.test.ts -t 'review regressions'
```

Result: **5 failed**, covering R1 in three lifecycle transitions, R2, and R3. These original assertions are retained and now pass.

After the fixes:

- Eight targeted test files: **156 passed**, including **81 broker runtime tests** (16 review regressions).
- `npm.cmd run build`: passed (TypeScript checks and application build).
- Native probe: **64/64 gates passed at both default and 150% display scale**, using a hidden actual application, throwaway profile/workspace, and local HTTP fixtures. Four new gates check rejection of ordinary-button `check`, stale DOM replacement, stale canvas pixels, and acceptance when only a distant region changes. Existing fixtures cover input, frames, shadow DOM, dialogs, downloads, workspace/run lifecycle, and coordinate scaling. Evidence: `test-results/browser-audit/regression-mtwzi65x/result.json` (default) and `test-results/browser-audit/regression-mtwzlcq2/result.json` (150%). Both runs also exercise 1x and 1.5x page zoom. The final retryable-error adjustment was covered by the 150% run and a further 16/16 focused regression run; the final build also passed.
- The command sandbox initially prevented the page renderer launching (`launch-failed`, exit code 49). The authorized isolated probe runs outside that command sandbox with test-only software rendering. This is a harness constraint, not a native test pass. No production security flags were changed.
- The native window-enumeration helper was already disabled in the reviewed implementation. A passing dialog gate does **not** independently prove absence of OS dialog windows.

Commands:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/browserAutomationBrokerRuntime.test.ts tests/unit/browserAutomationBroker.test.ts tests/unit/browserAutomationService.test.ts tests/unit/browserPolicy.test.ts tests/unit/chatServiceCompletion.test.ts tests/unit/openclawToolImages.test.ts tests/unit/anthropicToolImages.test.ts tests/unit/mcpToolBridgeImages.test.ts
npm.cmd run build
node tests/probes/browser-regression-probe.mjs --software
node tests/probes/browser-regression-probe.mjs --software --scale=1.5
```

R1's deliberately delayed address lookup is tested through the actual broker with a deterministic resolver; it is not a native DNS-race reproduction. Live-model website tasks have not been rerun in this fix review.

## Expected coverage and remaining work

This architecture can support many modern website workflows, but neither fixture pass counts nor use of CDP establishes an arbitrary-site success percentage. A working runtime and a model reliably choosing the right actions are separate requirements.

| Task type | Assessment from implementation; not a measured live-site rate |
| --- | --- |
| Reading, links, search, ordinary HTML forms, tab/popup flows | Strongest fit: text/AX references and native input are implemented. |
| SPAs, iframes, open shadow DOM, rich text, custom widgets | Supported mechanisms exist, but timing, accessible naming, unusual geometry, and widget behavior vary. |
| Canvas/visual-only controls | Requires a vision-capable model; capture/click fallback exists. Moving targets and pixel changes near a target can be refused. |
| Drag-and-drop, complex drawing/maps, touch gestures | The tool schema has no drag or touch primitives; workflows depending on these are incomplete. |
| Sign-in, sensitive fields, file upload | Human handoff is intentional. This is not unattended completion. |
| CAPTCHA, access challenges, browser restrictions | Do not promise completion; user assistance or site-specific limits can stop a task. |
| LAN/private/internal sites | Refused by the current assistant profile policy unless explicitly allowed; not general intranet coverage. |

The next acceptance step is a small live-model benchmark on representative sites and realistic tasks, with repeated trials and explicit success criteria. Use the already-installed local Ollama model selected by the user; record its exact model and vision capability. Separate runtime failures, model decisions, and expected human handoffs, and record completion rate, recovery attempts, time/tool calls, and incorrect side effects. Validate both successful completion and appropriate refusal. Do not report a general percentage before those results exist.

For comparison, [Playwright's documented actionability checks](https://playwright.dev/docs/actionability) improve individual interactions; they are not a guarantee of whole-task completion. The current broker is a focused CDP implementation, not the complete Playwright API.

## Remaining work: execution handoff

Keep the current architecture. Work only in disposable app profiles/workspaces; do not modify Problem Bank or other unrelated UI. Do not weaken the current assertions to make tests pass. Prioritize the following in order; do not add every possible browser feature speculatively.

1. **Measure live-model reliability before claiming broad site support.** Follow the existing audit/contract evaluation stages. Use the user's already-installed local Ollama model; first record its exact name and vision support. Define ten non-destructive tasks across at least five representative public sites (search/filter, navigation, multi-step forms without external submission, and one visual task if vision is available). Run each three times with isolated profiles. Record task, model, prompt, success criteria, outcome, tool count, elapsed time, recoveries, and human handoffs in a dated report under `test-results/browser-audit/`. A page opening is not task completion. Stop at login/CAPTCHA or external side effects. Deliver a failure classification and measured completion rate; fix reproduced runtime failures before expanding features.
2. **Add native coverage for the deferred-popup lifecycle race.** Extend `tests/probes/browser-regression-probe.mjs` with a deterministic test-only held address resolver, scoped to the probe process (do not expose production IPC for injecting functions). Start the popup, await evidence that its lookup is held, change workspace/seal or reset the renderer, release the lookup as public, and assert zero new agent views and zero child navigation requests. Keep a positive case where a valid human takeover popup opens. Existing runtime tests already cover these ownership conditions; this closes the native integration evidence gap.
3. **Only if real tasks require it, add drag support as a separate change.** Current `browserAct` has no drag primitive. Define reference-bound source/destination semantics, frame/zoom handling, cancellation between native input events, and release on interruption before implementing it through the existing service/bridge/broker. Require isolated fixtures for success, obscured/stale target refusal, and interruption; do not simulate arbitrary page JavaScript drag handlers.

Pixel-validation tuning is conditional on benchmark evidence: if stable visual targets repeatedly fail because of nearby animation, preserve stale-target refusal and add fixtures for both the failing valid interaction and same-position destructive replacement before changing the comparison. Do not simply disable pixel checks or raise a tolerance until the stale-target fixture passes accidentally.
