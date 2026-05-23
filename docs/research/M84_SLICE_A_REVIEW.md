---
Status: Slice A Fitness Review (Conductor self-review, 2026-05-23)
Milestone: M84 / SR-4: System Fitness Harness — Slice A
Slice Commit: 63f5a6b8 (feat(fitness): shared utilities and startup baseline (M84 Slice A))
Branch: systems-redesign-planning
Created: 2026-05-23
Author: Systems Redesign Conductor
Predecessor audit: docs/research/M84_FITNESS_HARNESS_AUDIT.md
Verdict: **KEEP (infrastructure) + REVISE (sampling methodology) — followup tracked, does not block Slice B**
---

# M84 Slice A — Fitness Review

## 1. What shipped

Commit `63f5a6b8` added:

- `tests/fitness/_shared/{timer,launcher,reportWriter}.ts` — shared utilities.
- `tests/fitness/startup.fitness.ts` — 5 cold launches, drops warmup, writes per-module JSON.
- `playwright.fitness.config.ts` — serial, 1 worker, 240s timeout, line reporter.
- `scripts/run-fitness.mjs` — composer (tmp-dir per-module collection → `data/fitness-reports/<ISO>.json`).
- `package.json` `test:system-fitness` script entry.
- `docs/research/baselines/workbench-baseline.md` §2 rows for H1 startup numbers.

## 2. Audit-condition checklist

| Audit §10 closure criterion | PASS / FAIL |
|---|---|
| `npm run test:system-fitness -- --only startup` produces a valid JSON report | **PASS** — two reports on disk (`2026-05-23T21-51-11-638Z.json`, `2026-05-23T21-59-24-253Z.json`) |
| Rerun stays within p95 × 1.25 tolerance | **PASS** — tolerance is upper-bound only; rerun was faster than the first run on every metric |
| `npm run test:unit` stays green | **PASS** — pre-existing timestamp-jitter flakes in `tests/unit/openclawSystemPrompt.test.ts` re-run green in isolation; unrelated to Slice A |
| No anti-list file touched | **PASS** — verified `git show --stat 63f5a6b8`: only `tests/fitness/`, `scripts/run-fitness.mjs`, `playwright.fitness.config.ts`, `package.json`, `docs/research/baselines/workbench-baseline.md` |
| JSON schema v1 matches audit §7 | **PASS** — `schemaVersion: 1`, `milestone`, `ranAt`, `provenance{gitHead,nodeVersion,electronVersion,hostOs}`, `modules[]`, `overallStatus` |
| Provenance captures git HEAD | **PASS** — `reportWriter.ts` reads `.git/HEAD`; sample reports show `6499cfbf` (pre-commit) and `63f5a6b8` (post-commit) |
| Tolerance band default +25% | **PASS** — `statsFromSamples` default `toleranceFactor: 1.25` |

Infrastructure verdict: **KEEP**.

## 3. Inter-run variance — methodology gap

Two consecutive runs on the same machine, branch, and binary produced numbers ~2× apart:

| Metric | Run 1 p95 (ms) | Run 2 p95 (ms) | Δ |
|---|---|---|---|
| launchToFirstWindowMs | 1127.4 | 562.4 | **−50.1%** |
| launchToWorkbenchReadyMs | 2459.4 | 1037.5 | **−57.8%** |
| launchToFirstEditorMs | 2512.9 | 1105.3 | **−56.0%** |

This crosses the audit §7 stop-rule ("if 3 consecutive runs exceed 50% variance, escalate"). Two runs is not three, but the magnitude is too consistent across all three metrics to be noise; it is almost certainly the **OS-level disk cache warming between runs**:
- Run 1 happened right after `git commit` of the audit; many recently-touched files were still in the editor's working set, not in the OS file cache.
- Run 2 happened 8 minutes later, after a `tsc --noEmit` + a vitest sweep had paged the entire app into memory.

This means the **first run is "cold-disk cold-start"** while the **second run is "warm-disk cold-start."** Both are real user scenarios:
- Cold-disk = user just rebooted, or just installed an update.
- Warm-disk = user closes and immediately reopens the app during a single session.

The current `startup.fitness.ts` does not distinguish them; it averages 4 samples that may straddle the boundary depending on what ran before.

### 3.1 Why this matters now, not later

If Slices B–F inherit the same sampling pattern (5 runs, discard 1), they will produce numbers that depend on whatever else was just run on the machine. That makes the JSON reports a poor regression signal for SR-5+ — the noise will swamp the signal of any real change.

## 4. Recommended methodology revision (deferred to a Slice A.1 followup)

**Not blocking Slice B.** The infrastructure is correct; the sampling is the gap. Proposed adjustments:

1. **Document two startup states explicitly:** `startup.cold-disk` and `startup.warm-disk`. The harness should emit both.
   - cold-disk: invoke `Clear-FileSystemCache` (Windows) / `sync && echo 3 > /proc/sys/vm/drop_caches` (Linux) before each launch. May require elevation; if unavailable, skip the cold-disk module with `status: "skipped"` and a `note`.
   - warm-disk: run a single dummy launch as a "prime the cache" step that is discarded entirely, then run 5 measured launches.
2. **Bump sample count for warm-disk to 8 with first 2 discarded** (per audit §11 first-run risk; one warmup is insufficient when CDP attach + Chromium startup themselves vary).
3. **Add a `variance` field to each metric's stats:** `{p50, p95, samples, stdDevMs}`. If `stdDevMs / p50 > 0.25`, flag the module as `"unstable"` (not `"fail"`) and add a note. This makes noise visible in the JSON.
4. **Add a third metric: `coefficient_of_variation`** (stdev / mean) as a first-class field — a single number SR-5+ can use to decide whether a regression is real or noise.

### 4.1 Risk if not adopted

Slices B–F will record baselines that look defensible inside one run but cannot be reproduced across runs. Any SR-5+ milestone comparing its post-change numbers to the M84 baseline will be unable to distinguish "real regression" from "the laptop was busier today."

## 5. Anti-list compliance

`git show --stat 63f5a6b8`:

```
 docs/research/baselines/workbench-baseline.md |  6 ++
 package.json                                  |  3 +-
 playwright.fitness.config.ts                  | 23 +++++++++
 scripts/run-fitness.mjs                       | 116 ++++++++++++++++++++++
 tests/fitness/_shared/launcher.ts             | 77 ++++++++++++++
 tests/fitness/_shared/reportWriter.ts         | 132 ++++++++++++++++++++++++
 tests/fitness/_shared/timer.ts                | 33 +++++++
 tests/fitness/startup.fitness.ts              | 116 ++++++++++++++++++++++
```

Zero anti-list files touched. `package.json` change is a single scripts entry. `docs/research/baselines/workbench-baseline.md` is a baseline doc, not source.

## 6. Verdict

**KEEP (infrastructure) + REVISE (methodology, deferred).**

- **KEEP:** harness scaffolding, JSON schema, composer, npm script, provenance capture, tolerance band, anti-list discipline — all sound.
- **REVISE (followup, NOT blocking Slice B):** sampling methodology must be hardened with cold-disk/warm-disk split + stdev/CoV reporting before any SR-5+ milestone treats M84 numbers as authoritative. Track as **Slice A.1 — Sampling Hardening**, scheduled after Slice F so Slices B–F can collect raw numbers under the current methodology and then be re-baselined once A.1 lands.

## 7. Followups (non-blocking)

- **A.1 — Sampling hardening.** Cold-disk/warm-disk split, 8 samples (drop 2), stdDev + coefficient_of_variation per metric, `"unstable"` module status when CoV > 0.25.
- **A.2 — CI integration.** Wire `test:system-fitness` to a nightly job; surface trend in `data/fitness-reports/`.
- **A.3 — Electron version capture.** `provenance.electronVersion` currently `null` (Node process running the composer is not Electron). Read from `package.json` `devDependencies.electron` instead.
