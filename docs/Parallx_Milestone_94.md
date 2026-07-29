# Milestone 94 — Workspace-Local Python

> **Status: BUILT + FUNCTIONALLY VERIFIED** (2026-07-29). `tsc --noEmit`
> clean, full renderer build clean, 36 new unit tests green, and
> **46/46 checks passing against a real Python 3.13.7 interpreter** via
> `node scripts/verify-python-bridge.mjs`. The UI layer (Settings panel,
> chat-tool gating) is still static-analysis-only and needs in-app eyes.

## Verification
 
`scripts/verify-python-bridge.mjs` drives the real `pythonBridge.cjs` through
a fake `ipcMain`, so what is exercised is the **actual registered IPC surface**
rather than conveniently-exported internals. It builds a real venv in a
throwaway workspace, installs a package, runs scripts, and asserts the
localization claims from §0 from *inside the child process* — reading
`sys.prefix`, `sys.path`, and the environment as Python sees them. Then it
deletes the workspace.

It found a real bug that unit tests structurally could not, because they never
spawn anything: **detection resolved a command NAME, and the spawn used the
rebuilt PATH.** `py.exe` on a per-user Python install lives in
`%LOCALAPPDATA%\Programs\Python\Launcher`, which detection found via the
inherited PATH and `buildChildEnv`'s minimal PATH did not. `createEnv`
returned a failure in 4 ms with a 0-byte environment. `detectSystemPython`
now resolves to `sys.executable` — an absolute path — which also removes the
`py -3` launcher special case entirely. Regression-guarded in
`tests/unit/pythonEnv.test.ts`.

A workspace that opts in gets its own Python environment. Packages installed
in one workspace are invisible to every other workspace, and the wheel cache,
temp dir, and `$HOME` all resolve inside the workspace rather than pooling
somewhere global. Scripts and their outputs stay ordinary workspace content —
watched, indexed, readable by the assistant. The environment itself is
machinery: never watched, never indexed, never shown.

---

## 0. What is and is not guaranteed

This matters more than any other section, because the temptation is to write
"sandboxed" on the Settings screen and it would be false.

**Genuinely enforced:**

| Claim | Mechanism |
|---|---|
| `site-packages` is per-workspace | a venv at `<ws>/.parallx/venv` |
| the pip wheel cache does not pool globally | `PIP_CACHE_DIR` → workspace |
| temp files do not land in the system temp dir | `TMPDIR`/`TEMP`/`TMP` → workspace |
| library dotfile caches do not touch the user profile | `HOME`/`USERPROFILE`/`APPDATA`/`XDG_*` → workspace |
| no ambient module paths leak in | `PYTHONPATH`/`PYTHONHOME` absent, `PYTHONNOUSERSITE=1` |
| no shell is ever involved | every spawn is argv-form |
| script paths cannot escape the workspace | `validateScriptPath` |
| package specifiers cannot become pip flags, paths, or URLs | `validatePackages` |

The child environment is a **rebuild, not a filtered copy** of `process.env`.
An allowlist cannot leak a variable nobody thought to deny; a rebuild starts
from nothing and adds only the OS floor Python needs to start. There is a test
that plants a canary variable in `process.env` and asserts it does not reach
the child.

**Not guaranteed, and the UI says so in as many words:**

- A running Python process holds a raw `open()`. It is outside every boundary
  Parallx has — `_isAllowedReadPath`, `.parallxignore`, and the capability
  bridges are all IPC-layer checks, and a child process makes no IPC calls.
  `electron/main.cjs` already documents this for ffmpeg at `fs:isInWorkspace`.
- Network egress is unrestricted. `pip install` requires it by definition.

Real isolation needs an OS-level sandbox (AppContainer, a restricted token, or
a container) and is deliberately **not** in this milestone. Until then the job
is: make the default local, make every action auditable, and be honest on the
screen where the user decides. The Settings panel carries a "What this does
not do" block next to the switch.

---

## 1. Layout — machinery vs content

The split is structural rather than pattern-matched, so the ignore rule is one
path prefix instead of a growing list of `site-packages/`, `*.dist-info/`,
`*.pyc`…

```
<workspace>/
├── .parallx/
│   ├── venv/          ← machinery. interpreter, site-packages, pip cache
│   ├── tmp/           ← machinery. TMPDIR + redirected $HOME
│   └── data.db
├── scripts/           ← content. watched, indexed, assistant-readable
└── output/            ← content. PARALLX_OUT points here
```

`scripts/` and `output/` are **settings** (`python.scriptsDir`,
`python.outputDir`), not fixed conventions — a workspace that already has an
`output/` meaning something else can point elsewhere. This costs nothing on the
ignore side: only machinery needs ignore rules, and machinery is at fixed
paths. Content folders are just folders.

`PYTHONDONTWRITEBYTECODE=1` means `scripts/__pycache__/` never exists in the
first place, which beats ignoring it after the fact.

---

## 2. Slice 1 — ignore and watcher hygiene (a pre-existing bug)

Investigating where the ignore list is honoured turned up a live bug unrelated
to Python, which a `pip install` would have detonated.

**`_handleFileChanges` never consulted `.parallxignore`.** The full tree walk
always has (`_walkDirectory`), but the watch-driven incremental path filtered
on file extension alone and went straight to `scheduleFileReindex`. Since
`.py`, `.json`, `.txt`, `.cfg`, `.toml` and `.csv` are all in
`INDEXABLE_EXTENSIONS`, anything a background process wrote into an ignored
subtree got scheduled for embedding — `npm install` included, today, before
any of this. Fixed at `src/services/indexingPipeline.ts`.

**`isIgnored` cannot answer the question an event asks.** Directory-only
patterns (`node_modules/`) are skipped for files by design, so
`isIgnored('node_modules/foo/bar.js', false)` returns **false**. Correct for a
top-down walk, which never descends and so never asks. Wrong for a watcher,
which hands you the leaf with no memory of the parent. New `isPathIgnored`
walks every ancestor segment as a directory first.

**The watcher filter did not know about venvs.** `WATCHER_IGNORE` in
`main.cjs` already covered `.git`, `node_modules`, `__pycache__` — smaller gap
than expected. `fs:watch` now also accepts `options.ignoreSegments`, supplied
by the renderer from the single source `WATCH_IGNORE_SEGMENTS`
(`src/services/parallxIgnore.ts`) and threaded through `IFileService.watch`.
Filtering in the main process means an install storm never crosses IPC.

**Note:** the full-walk path was already safe — `indexingPipeline.ts:1237`
allowlists `.parallx` children to `memory`/`sessions`. No change needed there.

Machinery patterns added to `DEFAULT_PATTERNS`: `.parallx/venv/`,
`.parallx/tmp/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`,
`.ipynb_checkpoints/`, `*.egg-info/`, `*.pyc`, `*.pyo`, `*.pyd`.
(`.venv/` and `__pycache__/` were already there.)

---

## 3. Slice 2 — `electron/pythonBridge.cjs`

Owns containment. Modelled on `doclingBridge.cjs`, which already proved the
shape (detect interpreter → install package → spawn long-lived process →
health-check → teardown).

- `detectSystemPython()` — probes `py -3` / `python` / `python3` for 3.10+,
  cached for the process lifetime. Isolated in one function on purpose:
  swapping in a managed interpreter (bundled CPython, or `uv python install`)
  later means replacing this and nothing else.
- `envPaths(root)` — every machinery path, platform-correct
  (`Scripts/python.exe` vs `bin/python`).
- `buildChildEnv(root, extra)` — the localization mechanism (§0).
- `createEnv` / `removeEnv` — `--upgrade-deps` deliberately omitted so
  creating an environment works offline. Writes a `parallx-env.json` marker
  recording which interpreter version built it, so drift is visible.
- `installPackages` / `uninstallPackages` / `listPackages` — via
  `<venv>/python -m pip`, never the pip shim.
- `runScript` — argv spawn, `cwd` = workspace root, streams `python:run:data`,
  completes with `python:run:exit`. Timeout kills the process **tree**
  (`taskkill /T /F` on Windows, process group on POSIX). Output capped at 2 MB
  per run; 4 concurrent runs per workspace.
- `shutdown()` wired into the `'workspace'` teardown scope, so a script
  started against one workspace cannot outlive a switch to another.

**Not built: an "execute this code string" tool.** A script the model wants to
run is written to the workspace with the ordinary file tools first. The user
can read it before approving, it lands in version control with everything
else, and the run log points at something that still exists afterwards.

**Left alone deliberately:** `doclingBridge.cjs` keeps its own
`detectPython()`. It stores a command *string* (`'py -3'`) and feeds it to
both `execSync` (works — shell) and `spawn` (would not), so folding the two
probes together is a behaviour change to a shipping path, not a rename. Worth
doing, on its own.

---

## 4. Slice 3 — `src/services/pythonEnvService.ts`

Owns consent and accountability, the mirror of the bridge's containment.

- Registers four workspace-scoped settings: `python.enabled` (**default
  false**), `python.scriptsDir`, `python.outputDir`, `python.runTimeoutMs`.
- `_guard()` funnels every mutating operation. "Not in Electron / no
  workspace" and "not enabled" are distinct messages — the second is a consent
  problem the user can fix, and it says where.
- **Status and deletion are deliberately not gated.** The panel must be able
  to say "there is a 340 MB environment here" while Python is switched off,
  otherwise turning it off hides the thing you want to delete, and reclaiming
  disk would require re-granting consent first.
- Every environment mutation and every run is written to the activity journal
  (`source: 'python'`), so Python appears in the same narrative as everything
  else the user and assistant did.

Registered dep-free in `registerWorkbenchServices` (so Settings can render the
Python category before a workspace opens), pointed at the workspace and the
journal later in boot.

---

## 5. Slice 4 — Settings panel

`Settings › Python`. The flat schema rows cover configuration; the panel
covers what only exists on disk: whether an environment is there, what it
weighs (size + file count), what is installed, and the last 25 runs with live
streaming output and a Stop button. Consent switch at the top with the "What
this does not do" block beside it.

`src/built-in/settings/pythonSettingsPanel.ts` + `pythonSettings.css`
(`--px` tokens only, `prefers-reduced-motion` respected on the running-run
pulse).

---

## 6. Slice 5 — chat tools

| Tool | Class | Notes |
|---|---|---|
| `python_list_packages` | green, always-allowed | read-only |
| `python_install_packages` | **blue**, requires-approval | creates the env if absent |
| `python_run_script` | **blue**, requires-approval | collects streamed output into one result |

New `'python'` tool category (`ToolCategory` + `CATEGORY_DISPLAY`).

Registered **only while `python.enabled` is on**, using the same attach/detach
shape as M70 App Command Control: a workspace that has not opted in carries
zero footprint in the model's tool list, so the assistant cannot offer to run
Python where the user never allowed it. Flipping the switch attaches them live,
no chat reload.

Both write-class tools are in `BLUE_TOOLS` (`openclawToolPolicy.ts`) — running
a script is arbitrary code execution, installing a package fetches and runs
third-party setup code, and both must gate after a turn has ingested untrusted
content.

`python_run_script` also disposes its subscriptions on turn cancellation and
kills the run, and guards the case where a script finishes between the spawn
returning and the subscriptions attaching (otherwise the tool would wait on an
event that already fired).

---

## 7. Tests — `tests/unit/pythonEnv.test.ts` (32)

Covers the parts that actually hold a boundary, against the real modules:

- **Package specifiers** — accepts names/extras/versions; rejects pip flags
  (`--index-url`, `-e .`, `-r`), paths, URLs, VCS specifiers, and a second
  argument smuggled in behind whitespace or a newline.
- **Script paths** — rejects traversal, absolute-outside, anything inside the
  venv, non-`.py`, empty. A well-formed in-workspace path reaches the
  existence check last, proving the earlier gates passed.
- **Child environment** — every cache/scratch var resolves inside the
  workspace; `PYTHONPATH`/`PYTHONHOME` absent; the canary test proving it is a
  rebuild not a filter; venv first on `PATH`; OS floor present.
- **Machinery vs content** — venv and buried venv files hidden; `scripts/`,
  `output/`, nested content visible; bytecode and tool caches inside content
  folders still hidden; a folder merely *named* like `venv` not hidden.
- **`isPathIgnored`** — the ancestor gap, backslashes, leading slashes,
  empty input.

---

## 8. Files touched

**New:** `electron/pythonBridge.cjs`, `src/services/pythonEnvService.ts`,
`src/built-in/chat/tools/pythonTools.ts`,
`src/built-in/settings/pythonSettingsPanel.ts`,
`src/built-in/settings/pythonSettings.css`, `tests/unit/pythonEnv.test.ts`.

**Modified:** `electron/main.cjs` (bridge wiring, teardown, `fs:watch`
ignoreSegments), `electron/preload.cjs` (`python` surface),
`src/services/parallxIgnore.ts` (machinery patterns, `isPathIgnored`,
`WATCH_IGNORE_SEGMENTS`), `src/services/indexingPipeline.ts` (the incremental
ignore fix), `src/services/fileService.ts` + `serviceTypes.ts` (watch
options), `src/workbench/workbench.ts` + `workbenchServices.ts` (service
registration + workspace wiring), `src/services/chatTypes.ts` +
`src/aiSettings/ui/sections/toolsSection.ts` (`python` category),
`src/built-in/chat/main.ts` (gated tool registration),
`src/built-in/settings/main.ts` (panel registration),
`src/openclaw/openclawToolPolicy.ts` (blue tools),
`tests/unit/chatGateCompliance.test.ts` (folder rule).

---

## 9. Follow-ups (not built)

1. **OS-level sandbox.** AppContainer / restricted token / container. The only
   thing that would make the §0 "not guaranteed" list shorter.
2. **Managed interpreter.** `uv` would make "this workspace runs Python
   3.12.4 with these exact packages" a real property rather than an
   aspiration, and removes "install Python first". `detectSystemPython` is the
   only function that would change.
3. **`requirements.txt` as source of truth.** Currently packages are installed
   imperatively and read back from `pip list`. A declared, diffable manifest
   would make environments reproducible.
4. **Consolidate the docling interpreter probe** (§3), including its latent
   `spawn('py -3')` bug.
5. **Network egress control.** Currently unrestricted; genuinely hard without
   the sandbox in (1).
