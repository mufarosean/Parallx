// runner.ts — Autonomy eval scenario runner (M60 T6.F5).
//
// Per Parallx_Milestone_60.md §11.2: scenario JSONs in this directory
// are the frozen behavior contract for each autonomy domain. This
// runner consumes them.
//
// What this runner DOES today:
//   • Discovers `*.scenario.json` files.
//   • Validates basic shape (id, trigger, preconditions/expected, rubric).
//   • Resolves rubrics: embedded `rubric` block OR sidecar `<id>.rubric.json`.
//   • For Gmail-style fixture-mode scenarios: loads `fixturePath` and
//     verifies fixture/scenario coherence (tool name match, message
//     shape conforms to gmail-mcp-server `UnreadMessage`).
//   • Emits per-scenario results (pass/fail/gated) so callers can fold
//     them into eval reports.
//
// What this runner does NOT yet do:
//   • Drive cron / heartbeat / sub-agent / canvas scenarios end-to-end.
//     Those need the full Parallx service graph mounted; that work is
//     deferred until each domain has a service-level test entry point.
//   • Execute the Gmail scenario end-to-end. With F2 (OAuth) + F3
//     (safeStorage IPC) + F4 (gmail.list_unread tool) landed, the
//     integration primitives are in place. Live mode (PARALLX_GMAIL_E2E=1)
//     reports `live-mode-ready` and skips fixture coherence; the
//     end-to-end driver that spawns the MCP child + drives the OAuth
//     flow is a future increment.
//   • LLM-graded rubric scoring. Rubrics are loaded but not graded.
//     Grading hooks into the configured chat provider; that wiring
//     lands when the runner is upgraded to drive scenarios live.
//
// Mode flag:
//   PARALLX_GMAIL_E2E=0 (or unset) — fixture mode. No network.
//   PARALLX_GMAIL_E2E=1            — live mode. Real Gmail. Never CI.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────

export interface IScenarioRubricInline {
  readonly dimensions: ReadonlyArray<{ readonly id: string; readonly max: number; readonly description: string }>;
  readonly passThreshold: number;
}

export interface IScenarioFile {
  readonly id: string;
  readonly title?: string;
  readonly trigger: { readonly kind: string;[k: string]: unknown };
  readonly preconditions?: Record<string, unknown>;
  readonly expected?: Record<string, unknown>;
  /** Either an inline rubric block, or a string filename to a sidecar rubric. */
  readonly rubric?: IScenarioRubricInline | string;
  readonly _runner_status?: string;
}

export interface IRubricFile {
  readonly id: string;
  readonly kind?: 'deterministic' | 'llm-graded';
  readonly dimensions: ReadonlyArray<{ readonly id: string; readonly max: number; readonly description: string }>;
  readonly passThreshold: number;
  readonly stability?: { readonly consecutiveRunsRequired?: number };
}

export interface IGmailFixtureMessage {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  readonly receivedAt: string;
  readonly labels: readonly string[];
}

export interface IGmailFixture {
  readonly id: string;
  readonly tool: string;
  readonly messages: readonly IGmailFixtureMessage[];
}

export interface IScenarioResult {
  readonly scenarioId: string;
  readonly outcome: 'loaded' | 'gated' | 'fixture-ok' | 'fixture-mismatch' | 'invalid' | 'live-mode-ready';
  readonly note?: string;
  readonly rubric?: IRubricFile;
}

// ── Discovery ──────────────────────────────────────────────────────

export function discoverScenarios(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir)
    .filter((name) => name.endsWith('.scenario.json'))
    .map((name) => join(rootDir, name))
    .sort();
}

// ── Loading + validation ──────────────────────────────────────────

export function loadScenario(scenarioPath: string): IScenarioFile {
  const raw = readFileSync(scenarioPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Scenario JSON parse failed (${basename(scenarioPath)}): ${(err as Error).message}`);
  }
  const obj = parsed as Partial<IScenarioFile>;
  if (!obj.id || typeof obj.id !== 'string') {
    throw new Error(`Scenario missing id: ${basename(scenarioPath)}`);
  }
  if (!obj.trigger || typeof obj.trigger !== 'object' || typeof (obj.trigger as { kind?: unknown }).kind !== 'string') {
    throw new Error(`Scenario ${obj.id}: trigger.kind must be a string`);
  }
  return obj as IScenarioFile;
}

export function resolveRubric(scenario: IScenarioFile, scenarioPath: string): IRubricFile {
  const r = scenario.rubric;
  // Inline rubric (existing pattern in heartbeat/cron/subagent/canvas-*).
  if (r && typeof r === 'object' && Array.isArray((r as IScenarioRubricInline).dimensions)) {
    const inline = r as IScenarioRubricInline;
    return {
      id: scenario.id,
      kind: 'deterministic',
      dimensions: inline.dimensions,
      passThreshold: inline.passThreshold,
    };
  }
  // Sidecar rubric — string filename relative to scenario dir.
  if (typeof r === 'string') {
    const sidecarPath = resolve(dirname(scenarioPath), r);
    if (!existsSync(sidecarPath)) {
      throw new Error(`Scenario ${scenario.id}: sidecar rubric not found at ${sidecarPath}`);
    }
    const parsed = JSON.parse(readFileSync(sidecarPath, 'utf8')) as IRubricFile;
    if (!parsed.id || !Array.isArray(parsed.dimensions) || typeof parsed.passThreshold !== 'number') {
      throw new Error(`Scenario ${scenario.id}: sidecar rubric ${basename(sidecarPath)} is malformed`);
    }
    return parsed;
  }
  throw new Error(`Scenario ${scenario.id}: no rubric (neither inline nor sidecar)`);
}

// ── Mode flag ──────────────────────────────────────────────────────

export function isLiveMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PARALLX_GMAIL_E2E === '1';
}

// ── Gmail fixture coherence ───────────────────────────────────────

export function loadGmailFixture(fixturePath: string): IGmailFixture {
  const raw = readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as IGmailFixture;
  if (!parsed.tool || !Array.isArray(parsed.messages)) {
    throw new Error(`Gmail fixture malformed: ${basename(fixturePath)}`);
  }
  for (const m of parsed.messages) {
    if (typeof m.id !== 'string' ||
        typeof m.from !== 'string' ||
        typeof m.subject !== 'string' ||
        typeof m.snippet !== 'string' ||
        typeof m.receivedAt !== 'string' ||
        !Array.isArray(m.labels)) {
      throw new Error(`Gmail fixture message malformed in ${basename(fixturePath)}: ${m.id}`);
    }
    // Defense in depth: fixture must NEVER carry a body — only metadata.
    // The MCP server contract is metadata-only; if a body slipped into
    // the recorded fixture it indicates a recording bug or data leak.
    if ('body' in m) {
      throw new Error(`Gmail fixture ${basename(fixturePath)} message ${m.id} contains a 'body' field — fixture must be metadata-only.`);
    }
  }
  return parsed;
}

// ── Runner entry point ────────────────────────────────────────────

export interface IRunOptions {
  readonly rootDir: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function runAll(opts: IRunOptions): IScenarioResult[] {
  const scenarios = discoverScenarios(opts.rootDir);
  return scenarios.map((p) => runOne(p, opts));
}

export function runOne(scenarioPath: string, opts: IRunOptions): IScenarioResult {
  let scenario: IScenarioFile;
  try {
    scenario = loadScenario(scenarioPath);
  } catch (err) {
    return {
      scenarioId: basename(scenarioPath),
      outcome: 'invalid',
      note: (err as Error).message,
    };
  }

  let rubric: IRubricFile;
  try {
    rubric = resolveRubric(scenario, scenarioPath);
  } catch (err) {
    return {
      scenarioId: scenario.id,
      outcome: 'invalid',
      note: (err as Error).message,
    };
  }

  // Gmail (or any scenario carrying a `fixturePath` and a `modeFlag`)
  // is the only domain the runner currently exercises beyond schema
  // validation. Other scenarios are reported as `loaded` — their full
  // execution is deferred (see file-level docstring).
  const trigger = scenario.trigger as { kind: string; fixturePath?: string; modeFlag?: string };
  const isGmailLike = typeof trigger.fixturePath === 'string';

  if (!isGmailLike) {
    return {
      scenarioId: scenario.id,
      outcome: 'loaded',
      rubric,
      note: scenario._runner_status ?? 'Loaded; execution gated until service-level driver is wired.',
    };
  }

  // Gmail-shaped scenario.
  if (isLiveMode(opts.env)) {
    // M60 Phase η F5 follow-up: with F2 (OAuth) + F3 (encrypted token
    // storage) + F4 (gmail.list_unread tool) landed, the integration
    // primitives are in place. Live mode skips fixture coherence and
    // signals the caller to drive the real MCP server. The runner
    // itself remains a static validator — it does not spawn the MCP
    // child or perform the OAuth flow. Callers (manual harness or
    // future end-to-end driver) are expected to consume this outcome
    // and exercise the wiring.
    return {
      scenarioId: scenario.id,
      outcome: 'live-mode-ready',
      rubric,
      note:
        'PARALLX_GMAIL_E2E=1 — F2+F3+F4 landed; integration primitives ready. ' +
        'Fixture coherence skipped. Driver/harness should now exercise the real Gmail MCP path.',
    };
  }

  const fixturePath = resolve(dirname(scenarioPath), trigger.fixturePath!);
  if (!existsSync(fixturePath)) {
    return {
      scenarioId: scenario.id,
      outcome: 'fixture-mismatch',
      rubric,
      note: `Fixture not found at ${fixturePath}`,
    };
  }

  let fixture: IGmailFixture;
  try {
    fixture = loadGmailFixture(fixturePath);
  } catch (err) {
    return {
      scenarioId: scenario.id,
      outcome: 'fixture-mismatch',
      rubric,
      note: (err as Error).message,
    };
  }

  // Coherence: fixture.tool MUST match an expected toolCall name.
  const expectedTools = ((scenario.expected as { toolCalls?: Array<{ name: string }> } | undefined)?.toolCalls ?? [])
    .map((t) => t.name);
  if (expectedTools.length > 0 && !expectedTools.includes(fixture.tool)) {
    return {
      scenarioId: scenario.id,
      outcome: 'fixture-mismatch',
      rubric,
      note: `Fixture tool "${fixture.tool}" is not listed in scenario.expected.toolCalls (${expectedTools.join(', ')}).`,
    };
  }

  return {
    scenarioId: scenario.id,
    outcome: 'fixture-ok',
    rubric,
    note: `Fixture has ${fixture.messages.length} message(s); execution gated on integration driver (F4 wiring landed; an end-to-end driver remains a future increment).`,
  };
}
