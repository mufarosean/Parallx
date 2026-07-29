# Milestone 96 — Notebooks

> **Status: BUILT + FUNCTIONALLY VERIFIED** (2026-07-29). Real `.ipynb` files,
> a real Jupyter kernel, real cell execution with persistent state.
> `tsc --noEmit` clean, full renderer build clean, 4,562 unit tests green
> (43 new), and **41/41 end-to-end checks** passing against a live
> ipykernel 7.3.0 via `node scripts/verify-notebook-kernel.mjs`.
> **The pane itself has not been opened in the running app.**

---

## 1. Why a separate surface

Executable code blocks inside canvas pages would have been the cheaper build —
the block editor, code blocks, and highlighting already exist. It was rejected
for two reasons, both the user's call: a canvas page is not a format any other
tool can open, and canvas should stay notes rather than grow a second identity
as a compute surface.

That decision sets the bar for everything below. If the point is
interoperability, then a notebook written here has to open in VS Code or
JupyterLab, and — the harder direction — a notebook written *there* has to
survive a round trip through here.

---

## 2. Architecture

```
NotebookEditorPane  (cells, execution queue, keyboard)
      │  model-shaped outputs
NotebookKernelService  (consent gate, protocol → NotebookOutput)
      │  IPC
notebookKernelBridge.cjs  (spawn, framing, lifecycle)
      │  newline-delimited JSON over stdio
parallx_kernel_host.py  (jupyter_client → ZeroMQ → ipykernel)
```

**Why the Python host exists.** A Jupyter kernel is driven over ZeroMQ with a
multi-part, HMAC-signed wire protocol. Doing that from Node means a native
`zeromq` dependency — electron-rebuild, per-platform binaries, a whole class of
build failures — plus a hand-rolled reimplementation of a protocol
`jupyter_client` already implements correctly. So ZeroMQ stays in Python where
the reference implementation lives, and the host translates to JSON lines.
Node spawns it like any other workspace script. Same shape as
`tools/docling-bridge`.

**The kernel is not a special process.** It gets its environment, its
process-tree kill, and its machinery directories from `pythonBridge.cjs`
rather than a second copy. A kernel is a workspace Python process that happens
to stay alive, and it must inherit exactly the containment M94 built. A
duplicate `buildChildEnv` would be a second thing to keep correct, and its
failure mode is silent — a kernel quietly resolving packages from outside the
workspace venv.

**Consent.** Notebooks run arbitrary code, so they sit behind M94's existing
per-workspace `python.enabled` gate rather than inventing a second, weaker one.

---

## 3. Round-trip fidelity

nbformat is an open schema. Notebook metadata, cell metadata, and output
metadata all legitimately carry keys this app knows nothing about — widget
state, slide directives, nbgrader fields, papermill parameters, cell tags. A
model that parses into typed fields and writes back only those fields deletes
everything it did not model, silently, on save, to work someone did in another
tool.

So every level keeps what it did not model and writes it back verbatim. Most
of the 34 unit tests exist to hold that line, including:

- notebook-level `widgets` / `papermill` / `authors` survive
- cell-level `tags`, `nbgrader`, `slideshow` survive
- **`attachments` survives** — this one was caught by the tests, not by
  design. It was in the "known fields" set while not being modelled, which
  meant images pasted into markdown cells would have been dropped on first
  save. Listing a field as known without modelling it is exactly how silent
  data loss happens.
- output `metadata` survives
- serialisation is idempotent — a second round trip is byte-identical, so
  saving does not produce spurious git noise
- text is written as line arrays with trailing newlines, matching `nbformat`
- base64 images are **not** chunked into arrays, which nbformat permits but
  which is hostile to every other tool

nbformat v3 and earlier are refused rather than half-converted. A partial
conversion that then saves is worse than a clean refusal.

---

## 4. Output rendering

A kernel answers with a MIME bundle and expects the front end to pick the
richest representation it can show. Preference order is images → HTML →
markdown → JSON → plain text.

**Nothing from the kernel is ever inserted as markup.** That rule costs a
feature: `text/html` is how pandas renders a DataFrame. Dropping it would make
tables much worse, but injecting raw kernel HTML into the app's own document
would hand any notebook you merely *open* a script-execution surface in the
renderer process. So HTML is parsed in an inert `DOMParser` document and
sanitised to a structural subset — tables, spans, basic formatting — with
scripts, event handlers, `style`, `class`, `id`, and non-`http(s)` hrefs
removed, and unknown tags unwrapped rather than dropped so their content
survives. Tables render; injection does not.

`image/svg+xml` is deliberately ranked *below* raster images: SVG is an active
document format, and sanitising it safely is a larger, different problem. A
plot offering both gets the PNG.

**ANSI.** Tracebacks arrive coloured — verified, IPython emits real SGR codes.
`ansiToHtml.ts` is a new SGR parser (none existed; the terminal renders through
another path) that maps colours onto `--px-syntax-*` tokens so tracebacks stay
legible in light mode. It escapes HTML in the payload, because `evalue`
carries arbitrary user data — a `KeyError` on a dict key of
`<img onerror=...>` is an ordinary thing to hit while working.

Two subtleties it handles, both tested: extended-colour arguments (`38;5;n`,
`38;2;r;g;b`) are consumed so a colour index cannot be re-read as "bold", and
the pattern is ESC-anchored so `arr[31m]` in real Python is left alone.

---

## 5. The pane

Cell editors are the **same `CodeEditor` primitive** the file editor uses, in
`autoHeight` mode — which is why that mode and `extraKeymap` exist on it
(M95). One code surface, two consumers.

Two visible decisions:

**No Jupyter-style modal editing.** Command mode vs edit mode is muscle memory
for heavy Jupyter users and a trap for everyone else — typing `dd` and losing
a cell because focus was one keystroke off. Per-cell affordances are buttons
and explicit shortcuts instead: `Shift+Enter` run-and-advance, `Ctrl+Enter`
run-in-place, `Alt+Enter` run-and-insert. If modal editing is wanted it should
be asked for; guessing wrong here is worse than not guessing.

**Execution is serialised through one queue.** A kernel executes one request at
a time regardless, so firing cells concurrently would only make the UI's idea
of order diverge from the kernel's — which is precisely what breaks "Run All"
on a notebook whose cells depend on each other. Run All also stops at the
first error, like Jupyter, rather than producing cascades of derivative
failures that bury the real one.

**Cell timing.** Each code cell shows how long the kernel spent on it: a live
counter while running (a cell showing only `[*]` gives no sense of whether it
has been going two seconds or two minutes — exactly when you want to decide
between waiting and interrupting), then the final duration.

Measured from `execute_input` — the kernel *picking the cell up* — to the
reply, so time spent queued behind an earlier cell is excluded. Timing from the
request instead would report the last cell of a "Run All" as having taken as
long as the whole notebook.

Persisted to `metadata.execution` in **JupyterLab's shape** (ISO timestamps
keyed by the protocol message they came from), so the number survives a reload
here and is visible to anyone opening the file in JupyterLab. Sibling keys
another tool wrote in that block are preserved, consistent with the
unknown-field policy everywhere else. "Clear outputs" clears timing too —
leaving `1.4s` beside a cell whose outputs are gone would be a lie.

Also handled: stream chunks are merged (a loop printing 10,000 lines would
otherwise become 10,000 outputs in the saved file), `clear_output(wait=True)`
defers the clear to the next write, outputs beyond 50 per cell fold away, and
a missing `ipykernel` surfaces as an inline **Install ipykernel** button
rather than a dead end.

---

## 6. Verification

`scripts/verify-notebook-kernel.mjs` drives the real bridge against a real
kernel in a throwaway workspace, through a fake `ipcMain`. Covers: environment
setup, start/idempotent-start, stdout streaming, `execute_result`,
**persistent state across cells** (the thing a notebook is *for*),
errors with ANSI tracebacks, kernel survival after an error, HTML and PNG
display data, `clear_output`, per-request output correlation with two cells
queued at once, interrupt, restart clearing all variables, chunk-boundary
framing, a 200 KB output, and clean failure after stop.

**It caught a real bug, and the first fix was wrong.** Interrupt appeared not
to work, so the kernelspec was switched to `"interrupt_mode": "message"` on the
reasoning that a control-channel message is more portable than an OS signal.
Re-running the harness produced `[IPKernelApp] ERROR | Interrupt message not
supported on Windows` — ipykernel's message handler only forwards interrupts to
*child* processes.

Rather than reason further, a direct probe measured all four combinations
(Windows, ipykernel 7.3.0, jupyter_client 8.9.1):

| mode | CPU-bound loop | blocking `time.sleep` |
|---|---|---|
| **signal** | **interrupted in 0.1 s** | not interrupted |
| message | not interrupted | not interrupted |

So the original default was right, and the "fix" had made interrupt fail
everywhere instead of only for blocking calls. The spec now declares
`"signal"` explicitly, with the measurements in a comment, because the
portable-looking alternative is wrong and someone will otherwise try it again.

The residual gap is CPython's: on Windows a thread blocked in `time.sleep`
does not wake from `interrupt_main()`. Jupyter behaves identically. Rather than
leave a cell spinning silently after the user pressed Interrupt, the pane
waits ~4 s and, if the cell is still running, explains that it is blocked in an
uninterruptible call and offers Restart inline.

The harness now tests interrupt with a CPU-bound loop (the case that works and
the more common runaway) and *pins* the `time.sleep` limitation as a logged,
non-failing probe — so if a future ipykernel fixes it, the harness says so.

**It then caught a second bug: restart never completed.** `wait_for_ready()`
works by sending `kernel_info_request` and waiting for the reply on the shell
channel — but the pump threads were already draining that channel, so the reply
was consumed before the wait could see it and the call blocked until timeout.
Startup avoided this by accident (pumps start *after* the wait); restart did
not. Fixed by giving the pumps a lifetime separate from the host's: restart
stops them, waits, and starts a fresh generation. The stop-event is passed to
each pump as an argument rather than read off `self`, so a lingering thread
from the old generation cannot see the new event, find it unset, and keep
draining channels the new pumps are reading.

Restarting also had to suppress the liveness watcher, which would otherwise
race the intentional shutdown and report `KERNEL_DIED` for a kernel that was
merely being replaced.

---

## 7. Adversarial review

The harness covers the bridge and the host; the unit tests cover the model and
ANSI. That left the **renderer-side code — pane, service, editor input — with
no automated coverage at all**, so it went through a review pass: three
reviewers (lifecycle, correctness, security), then one independent skeptic per
finding whose job was to *refute* it by reading the code.

19 findings raised, **8 refuted**, 11 confirmed and fixed. The refutations
mattered as much as the confirmations — several plausible-sounding claims
(an SVG sanitiser bypass, `target="_blank"` reaching `shell.openExternal`,
a leaked interrupt timer, selection pointing at a deleted cell) turned out to
be unreachable, already guarded elsewhere, or the app's documented policy.

The most important finding is one the end-to-end harness **structurally could
not catch**, because the harness drives the bridge directly and never crosses
the renderer boundary:

> `NotebookKernelService._handleEvent` compared workspace roots with `!==`.
> The renderer's value comes from `URI.fsPath` → `C:/work/ws`; the main
> process tags every event with `path.resolve()` → `C:\work\ws`. **Every
> kernel event was dropped in the real app** — cells would run, produce
> output, and the UI would never hear about it, spinning forever.

38/38 end-to-end green, and the one thing that would have made notebooks
unusable in practice was invisible to it. Also fixed:

| Defect | Consequence |
|---|---|
| In-flight execution not cancelled on pane teardown | Tab-switching mid-run leaked the pane and its detached DOM (permanently for a non-terminating cell), and late output mutated the shared document *without* marking it dirty — so an expensive run was silently discarded on close |
| Output listeners closed over a captured `CellView` | Converting or deleting a running cell wrote into a disposed editor |
| Stream merging defeated `MAX_RENDERED_OUTPUTS` | Merging pins the output *count* at 1, so the cap stopped protecting anything; a `print` loop repainted a growing multi-MB block on every kernel flush. Now byte-capped (tail kept) and repaints coalesced to one per frame via `rafThrottle` |
| Interrupt button polarity inverted | Interrupt stayed enabled after every single-cell run and disabled during Run All — exactly backwards |
| Restart did not stop an in-progress Run All | The loop kept feeding cells into the fresh kernel, producing a cascade of `NameError`s from a restart the user asked for |
| `pickMime` used `in` on unchecked `data` | A malformed `.ipynb` threw a `TypeError` through `_renderOutputs` — an unopenable notebook |
| Last-cell reset cleared `executionCount` without repainting | Stale `[7]` beside an emptied cell |

---

## 8. Files

**New:** `tools/jupyter-bridge/parallx_kernel_host.py`,
`electron/notebookKernelBridge.cjs`, `src/services/notebookKernelService.ts`,
`src/built-in/editor/notebook/{notebookModel,notebookEditorInput,notebookEditorPane,outputRenderer,ansiToHtml}.ts`,
`src/built-in/editor/notebook/notebook.css`,
`tests/unit/notebookModel.test.ts`, `scripts/verify-notebook-kernel.mjs`.

**Modified:** `electron/main.cjs` (bridge + workspace teardown),
`electron/preload.cjs` (`notebookKernel` surface),
`electron/pythonBridge.cjs` (exports `ensureMachineryDirs` / `killTree`),
`src/workbench/workbenchServices.ts`, `src/workbench/workbench.ts`,
`src/workbench/workbenchFileEditorSetup.ts` (`.ipynb` routing).

---

## 9. Still to verify, and known gaps

Static + headless only. The pane has never been opened, so these are unproven:
opening a `.ipynb` renders cells; editing marks the tab dirty; save produces a
file Jupyter accepts; markdown preview toggling; the install-ipykernel banner.

Known gaps, deliberate:

1. **Interrupt cannot break a blocking call on Windows.** See §6. Restart is
   the escape hatch, offered inline when it happens.
2. **`input()` raises instead of prompting.** `allow_stdin=False`. With stdin
   enabled a stray `input()` parks the kernel forever on a channel this front
   end does not yet answer, and the only recourse is killing the process. A
   `StdinNotImplementedError` traceback is recoverable; a hang is not.
3. **No completions in cells.** The protocol path exists
   (`notebook:kernel:complete`) and the host implements `complete_request`, but
   it is not wired into CodeMirror's autocomplete yet.
4. **No ipywidgets.** Widget *state* round-trips untouched, but interactive
   widgets need the comm protocol and a JS widget manager.
5. **No SVG output.** See §4.
6. **No AI integration.** The assistant cannot yet read or edit notebook cells;
   there are no `notebook_*` chat tools.
