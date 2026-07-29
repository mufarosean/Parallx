# Milestone 97 — Terminal Environment Activation

> **Status: BUILT + FUNCTIONALLY VERIFIED** (2026-07-29). `tsc --noEmit` clean,
> build clean, **4,586 unit tests** green, **23/23** checks against a real venv
> and a real shell (`scripts/verify-terminal-activation.mjs`), and **9/9**
> against the real piped-shell session path.
>
> §8 and §9 are bugs found by the user in the running app — a Settings panel
> that rendered nothing, and a duplicated nav entry — both fixed with
> regression tests. §11 records a claim in an earlier draft of this document
> that was **wrong**: interactive prompts were asserted to hang without being
> tested, and they work.

The workspace terminal now uses the workspace's Python environment. Typing
`python`, `pip`, `pytest`, or any console script in the built-in terminal hits
the same interpreter a notebook cell or a Run button does.

---

## 1. Activation is not containment

The important decision, because getting it wrong breaks one side or the other:

| | `buildChildEnv` (M94) | `buildTerminalEnv` (this) |
|---|---|---|
| Used by | scripts, the notebook kernel, formatters | the terminal panel, `terminal_run_command` |
| Strategy | **rebuild from nothing** | **overlay onto the inherited env** |
| PATH | venv + a minimal OS floor | venv **prepended** to the user's own PATH |
| `HOME` / `APPDATA` | redirected into the workspace | untouched |
| `TMPDIR` | redirected into the workspace | untouched |
| Inherited vars | dropped | kept |

A process Parallx runs *on the user's behalf* should be as localised as
possible — that is what M94's containment is for. A **terminal is the user's
own shell**, and scrubbing it would strip git, node, ssh, their credential
helper, and their prompt theme. A terminal with a venv but no `git` is worse
than a terminal with no venv.

So this does precisely what `activate` does and nothing else: prepend
`<venv>/Scripts` (or `/bin`) to PATH, set `VIRTUAL_ENV`, set
`VIRTUAL_ENV_PROMPT` (starship / oh-my-posh / powerlevel10k read it and show
the indicator for free), and clear `PYTHONHOME` — a stale one silently
repoints the stdlib away from the venv.

The verification asserts both halves, including that the two functions have
**not converged**: `buildChildEnv` must still scrub while `buildTerminalEnv`
must still inherit. Without that check, a future "simplification" that routes
both through one helper would quietly destroy either containment or usability.

Not used: running `Activate.ps1`. It would give the `(venv)` prompt prefix, but
it depends on PowerShell execution policy, which is `Restricted` on plenty of
Windows machines — trading a reliable mechanism for a cosmetic one.

---

## 2. Also fixed: the terminal opened in the wrong place

`terminal:spawn` defaulted `cwd` to `app.getPath('home')`, so the built-in
terminal opened in the user's home directory rather than the workspace — a
`cd` every single time. It now prefers the workspace root.

---

## 3. Why it doesn't look like VS Code (and what was done about it)

VS Code shows `(.venv)` because its terminal is a **real pseudo-terminal** —
`node-pty` driving xterm.js. The shell believes it is attached to a TTY, so it
prints *its own* prompt, and `Activate.ps1` overrides that prompt function to
prepend the environment name.

Parallx's terminal is not a terminal emulator. It is an `<input>` writing to a
**piped** shell, and a shell with no TTY prints no prompt at all — the `❯` is
Parallx's own markup. So there was no shell prompt for `(.venv)` to appear in,
and setting `VIRTUAL_ENV` alone produced a correctly-activated environment with
no visible sign of it.

Since the prompt belongs to us, the indicator does too: the prompt now renders
`(.venv) ❯`, in success colour, with the full environment path on hover. Before
a shell has spawned it shows what the *next* one will get, so the panel does
not read as "no environment" until you type.

This is a UI equivalent, not the real thing. The real thing needs a PTY — see
§7.

---

## 4. The honest part: a running shell cannot follow

A live process's environment cannot be changed from outside. Creating a Python
environment while a terminal is already open therefore **cannot** retroactively
activate that shell — `python` would keep resolving to the system one with no
explanation, which is exactly the sort of thing that costs an hour.

Rather than let that be a mystery, the panel shows a warning strip — *"A Python
environment was created for this workspace — restart the shell to use it."* —
with a **Restart shell** button. It appears ONLY for that actionable state; the
steady state lives in the prompt (§3), because saying the same thing twice is
just noise. VS Code has the same constraint and answers it the same way: mark
the session, offer a relaunch.

Staleness is detected by comparing what a *new* shell would get
(`terminal:envInfo`) against what the *running* one was started with
(`terminal:sessionEnv`), and the strip refreshes off
`IPythonEnvService.onDidChangeStatus`, so creating or deleting the environment
updates it immediately.

---

## 5. `terminal_run_command` too

The agent's shell tool gets the same activation. Two different answers to
`pip list` depending on whether the user or the assistant asked would be its
own class of bug.

---

## 6. Files

**Modified:** `electron/pythonBridge.cjs` (`buildTerminalEnv`,
`terminalEnvInfo`), `electron/main.cjs` (`terminal:spawn`, `terminal:exec`,
`terminal:envInfo`, `terminal:sessionEnv`), `electron/preload.cjs`,
`src/built-in/terminal/main.ts`, `src/built-in/terminal/terminal.css`.

**New:** `scripts/verify-terminal-activation.mjs`, `scripts/verify-python-progress.mjs`, `scripts/verify-python-responsiveness.mjs`.

---

## 7. Verification

23/23 against a real venv and a real PowerShell:

- no venv → environment returned byte-identical, no invented `VIRTUAL_ENV`
- venv bin first on PATH; `VIRTUAL_ENV` / `VIRTUAL_ENV_PROMPT` set;
  `PYTHONHOME` cleared; no duplicate `PATH` key (Windows `Path` vs `PATH`)
- **every original PATH entry survives**, and a planted canary variable
  survives — the overlay property
- re-activating is idempotent (no stacked PATH entries across restarts)
- a real shell resolves `python` inside the venv, and `sys.prefix` matches
- **control**: the same shell *without* the overlay does not resolve into the
  venv, so the test proves something
- removing the environment deactivates future shells

---

## 8. The Settings panel rendered nothing (fixed)

Reported from the running app: **Settings → Python showed a heading and an
empty body.** The toggle this milestone's own instructions point at did not
exist on screen.

Root cause, a boot-order bug:

```
workbench.ts:734    registerWorkbenchServices()   → constructs PythonEnvService
                                                     → registers python.* settings
                                                     → getGlobalSettingsRegistry() is UNDEFINED
chat/main.ts:545    setGlobalSettingsRegistry()   → registry finally exists
```

The service registered its settings in its constructor, before any registry
existed, so nothing was registered at all. Then
`SettingsRegistryService.getValue` **throws** on an unregistered key rather
than falling back to a default — so the first read of `python.enabled` threw
inside the panel constructor, `render()` never completed, and the hub drew only
the metadata it owns: heading and description. A crash that looks exactly like
an unimplemented feature.

Built-in tools (canvas, planner) avoid this because they register from their
own *activation*, which runs after the registry exists. A service constructed
at composition time cannot.

Fixed on three levels:

1. `ensureSettingsRegistered()` — idempotent, guarded by `getSchema` (not a
   boolean flag, which would be wrong after a registry swap), and called from
   every read/write plus panel construction. Registration now happens whenever
   the registry first becomes reachable.
2. `_setting()` checks `getSchema` before `getValue`, so a settings read can
   never throw into its caller.
3. The panel wraps construction in try/catch and renders the error. A future
   bug of this shape will say what happened instead of showing an empty pane.

Two further robustness fixes fell out: `getPythonApi()` and `getKernelApi()`
touched `window` unguarded (a `ReferenceError` outside a browser, which is why
these services could not be unit-tested at all), and `sameWorkspace` used the
deprecated `navigator.platform` — now decided by path shape, which is a
question about the two strings rather than about the host.

**20 new tests**, split deliberately:
`tests/unit/pythonSettingsRegistration.test.ts` (12) reproduces the real boot
order and pins `getValue`'s throwing behaviour;
`tests/unit/pythonSettingsPanel.test.ts` (8, jsdom) asserts the panel actually
**paints** — a switch exists, `aria-checked` starts false, clicking it writes
the workspace setting, the security caveat is present, and a throwing panel
renders an explanation rather than nothing.

---

## 9. Two "Python" entries in the Settings nav (fixed)

Reported from the running app once the panel started rendering: the nav listed
**Python twice**, both under Extensions.

`SettingsEditor._collectEntries` builds nav entries from two independent
sources and keys them separately — `panel:<id>` for a registered panel,
`schema:<category>` for every distinct `category:` string among the schemas.
The Python feature contributes both: a panel with `id: 'python'` and four
settings with `category: 'Python'`. Two different keys, the same label, and
neither claimed by the curated taxonomy, so both landed in Extensions as
identical rows with no way to tell which was which.

Neither source is wrong — they are two halves of one page. So a panel now
**absorbs** a schema category whose name matches its label (compared
case- and whitespace-insensitively): the category stops producing its own nav
entry, and the panel's page renders the rich controls followed by an
"All settings" section with the raw rows. One entry, nothing hidden.

Fixed in the shared editor rather than by renaming the Python panel, because
the collision is structural: any future feature contributing both a panel and
flat settings under one name would hit it. A `fill` panel (AI Settings) owns
its own scroll and would clip appended rows, so those keep the panel alone.

Four tests in `tests/unit/settingsEditor.test.ts` cover it, including that a
category with no matching panel is untouched. Note for anyone extending them:
the nav collapses a single-member group to the GROUP's label, so a collision
test needs a second Extensions member to see real child labels.

---

## 10. Package installs showed no progress (fixed)

Reported from the running app: creating an environment, or typing `pandas` and
pressing Install, produced **nothing visible anywhere** — the terminal stayed
empty and the panel showed only a disabled button.

Two causes, both in code written here:

1. `runToCompletion` **buffered** stdout and stderr and returned them only when
   the process exited. A `pip install pandas` is a ~20-second operation whose
   entire user-facing signal is its output, and none of it left the main
   process until it was over.
2. The Settings panel then **discarded** the successful output entirely —
   `if (!res.ok) showError(...) else input.value = ''`. Even the final log was
   thrown away.

So there was never anything to show, and a slow install was
indistinguishable from a hang.

Fixed by streaming: `runToCompletion` takes an `onData` sink, `createEnv` /
`installPackages` / `uninstallPackages` forward through a `python:progress`
IPC event, and `PythonEnvService` re-emits it as `onDidProgress` (filtered by
workspace, through the same path normaliser the notebook service needed —
forward slashes one side, backslashes the other). The panel renders it live in
an **Output** block beneath the packages list, pinned to the newest line,
capped at 40 KB, with `\r` collapsed to newlines so pip's redraws do not
become one line of mush. The phase is announced up front (`$ pip install
pandas`) because `python -m venv` is otherwise silent for several seconds.

**Why not the Terminal panel**, which is where the user looked first: the
terminal is their own interactive shell. Splicing an unrelated background
process's output into a session they are typing in would interleave with their
commands and imply the command ran there, which it did not. The output belongs
beside the control that started it. (VS Code draws the same line — its Python
extension writes installs to an Output channel, not into your terminal.)

Verified by `scripts/verify-python-progress.mjs` — **14/14** against a real
`pip install pandas`: 24 progress events spread across 21 seconds, arriving
*before* the operation returns, correctly workspace-tagged, containing pip's
real `Collecting` / `Successfully installed` lines. The "spread across the
operation" assertion is the one that actually distinguishes streaming from a
lump at the end.

---

## 11. The whole app lagged during installs (fixed)

Reported from the running app, with a workspace on a **USB stick**: installing
`ipykernel` was slow, and *the whole app lagged while it happened*.

The slow install is the device — thousands of small files on USB. The lag was
a bug, and a bad one:

`getEnvSize()` was a **synchronous** `readdirSync` + `statSync` walk running in
the **Electron main process**, which routes every IPC message and window event.
Measured here, an ipykernel venv is **9,732 files / 105 MB**; walking it
synchronously starves the event loop *completely*. And it ran on every status
refresh — including immediately after an install, when the tree is largest and
the disk is busiest.

This is the same lesson as the SQLite worker thread: nothing that scales with
data size belongs on the main process, synchronously.

Now: fully async, yielding to the event loop every 500 entries (async fs calls
alone can still starve the loop when they resolve from the OS cache), capped at
80,000 files, cached per workspace, invalidated on create/install/uninstall/
remove, and de-duplicated so concurrent callers share one walk. The panel also
skips the walk entirely while an operation is in flight and reuses the last
value.

A second, smaller cause was in the progress log added in §10: it read
`textContent.length` per chunk (O(n) each, so O(n²) overall) and assigned
`scrollTop = scrollHeight` per chunk (forcing synchronous layout). Now the
length is tracked in a field, trimming drops whole leading nodes, and the
scroll is coalesced through the shared `rafThrottle`.

### Measuring it took three attempts, and the first two were wrong

`scripts/verify-python-responsiveness.mjs` — 11/11. The metric is what
fraction of scheduled timer ticks actually fire while the work runs. Two
earlier versions of this measurement were misleading:

1. **"Worst delay between consecutive ticks"** — a trap. A fully blocking
   operation stops the timer firing *at all*, so the worst delay stays 0 and
   reads as perfect. **The broken code passed that assertion.**
2. **"At least 80% of ticks fire"** — an absolute threshold above what Windows
   can deliver. Its default timer quantum is ~15.6 ms, so a 20 ms interval
   fires ~64% of the naive expectation on a completely idle process. Measured:
   idle scores 65% at 20 ms, 81% at 50 ms, 88% at 100 ms. That threshold would
   fail a perfectly healthy machine — and briefly did, sending me looking for a
   phantom second bug.

The harness now uses a 50 ms interval and calibrates against an idle baseline
measured on the machine at run time. Separation is unambiguous — against this
repo's `node_modules` (17,777 files), the old synchronous walk fired **0 of 43**
scheduled ticks; the async one fired **64 of 64**.

---

## 12. Terminal colour

The panel used to `stripAnsi()` its output, so `pip`, `pytest` and `ruff` all
arrived as undifferentiated grey — the error line indistinguishable from the
twenty above it. Two halves, which only work together:

- Child processes are given `FORCE_COLOR` / `CLICOLOR_FORCE` / `PY_COLORS`.
  Well-behaved tools call `isatty()` and suppress colour on a pipe, which is
  correct for a redirected log and wrong for a consumer that renders escapes.
  These are the documented opt-outs for exactly this case.
- Output is rendered through the ANSI parser written for notebook tracebacks,
  now promoted from `built-in/editor/notebook/` to **`src/ui/ansiToHtml.ts`**
  as a shared primitive with two consumers. It HTML-escapes everything it does
  not itself emit, so shell output can never become markup.

The buffer trim had to change with it: it previously reassigned
`textContent`, which would now flatten every colour span in the scrollback. It
drops whole chunks from the front instead.

---

## 13. Not done

**A real terminal**, eventually — but the gap is much narrower than first
claimed, and the first version of this section was wrong. It listed things as
broken without testing them. Measured against the actual piped shell
(9/9 plus a dedicated interactive probe):

**Works today:** commands run and stream; the shell opens in the workspace;
`python` and `pip` are the workspace venv; variables and `cd` persist across
commands; ANSI colour arrives and renders; script files run; **and interactive
prompts work** — `Read-Host`, Python `input()`, and stdin confirmations all
accept an answer typed into the panel's input box, because stdin is a pipe this
app owns. The earlier claim that they "hang" was asserted, not measured, and it
was false.

**Genuinely missing without a PTY:**

- `Ctrl+C` — a runaway command cannot be interrupted; only the shell restarted
- full-screen / curses programs (`vim`, `htop`, `git rebase -i`'s editor)
- in-place redraw — progress bars append a line per update instead of
  overwriting one
- the shell's own prompt (synthesised instead, §3), and resize/reflow

That is a real list, but it is a list of edge cases rather than of everyday
work. It does not justify installing a multi-GB compiler toolchain on the
machine, and the recommendation to do so is **withdrawn**.

The fix is `node-pty` + a terminal emulator front end, which is what VS Code
does. **It was attempted and is blocked on this machine:**

- `npm install node-pty` succeeds, but the package ships no binary.
- `electron-rebuild --only node-pty` fails with
  `Could not find any Visual Studio installation to use` — there are no MSVC
  build tools installed.
- The prebuilt fork (`@homebridge/node-pty-prebuilt-multiarch`) publishes
  Electron binaries only up to **ABI v121** (Electron ~28). This app is on
  **Electron 40.2.1 / ABI v143**, so `prebuild-install` 404s.

So a real PTY requires installing Visual Studio Build Tools (multi-GB, admin)
— a change to the machine, and the user's call rather than something to do
silently. The dependencies were **removed again** rather than left in
`package.json` in an unusable state.

Once Build Tools exist the path is short: reinstall `node-pty` and `@xterm/*`,
`npx electron-rebuild --only node-pty`, then replace the `<input>` + piped
shell with a PTY session and an xterm front end. Everything in §1–§9 stays as
it is; the PTY only changes how bytes get in and out.

**But it is not worth doing now.** See the measured list above: the piped shell
handles everyday work including interactive prompts. Revisit only if `Ctrl+C`
or a full-screen program becomes a real obstacle in practice.

Also not done: per-terminal environment switching. One shell, one workspace
environment; multiple terminals with different envs is a larger feature.
