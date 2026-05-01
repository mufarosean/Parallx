// autonomyEvalRunner.test.ts — Drives the M60 T6.F5 eval runner against
// the JSON scenarios in tests/autonomy-eval/.
//
// The runner is intentionally minimal at this phase (see
// tests/autonomy-eval/runner/runner.ts file-level docstring). What we
// assert here:
//
//   1. Every shipped `*.scenario.json` is parseable + has a resolvable
//      rubric (inline OR sidecar).
//   2. The Gmail scenario in fixture mode reports `fixture-ok` and the
//      fixture stays metadata-only (no body leak).
//   3. The Gmail scenario in live mode (PARALLX_GMAIL_E2E=1) reports
//      `gated` until F4 lands — a guard against accidental live runs
//      from CI.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  discoverScenarios,
  loadScenario,
  resolveRubric,
  loadGmailFixture,
  runAll,
  runOne,
} from '../autonomy-eval/runner/runner.js';

const ROOT = join(__dirname, '..', 'autonomy-eval');

describe('autonomy-eval runner — discovery & rubric resolution', () => {
  it('discovers every shipped scenario', () => {
    const scenarios = discoverScenarios(ROOT);
    // 8 from γ + δ (heartbeat, cron, subagent, 5×canvas-*) + 1 from η F5 (gmail).
    expect(scenarios.length).toBeGreaterThanOrEqual(9);
    expect(scenarios.some((p) => p.endsWith('gmail-inbox-digest.scenario.json'))).toBe(true);
  });

  it('every scenario parses + resolves a rubric', () => {
    const scenarios = discoverScenarios(ROOT);
    for (const p of scenarios) {
      const sc = loadScenario(p);
      const rubric = resolveRubric(sc, p);
      expect(rubric.id).toBeTruthy();
      expect(rubric.dimensions.length).toBeGreaterThan(0);
      expect(rubric.passThreshold).toBeGreaterThan(0);
    }
  });
});

describe('autonomy-eval runner — Gmail fixture mode', () => {
  it('Gmail fixture is metadata-only (no body field anywhere)', () => {
    const fixturePath = join(ROOT, 'fixtures', 'gmail-inbox.json');
    const fixture = loadGmailFixture(fixturePath);
    expect(fixture.messages.length).toBeGreaterThanOrEqual(5);
    for (const m of fixture.messages) {
      expect((m as Record<string, unknown>).body).toBeUndefined();
      expect(typeof m.subject).toBe('string');
      expect(typeof m.from).toBe('string');
    }
  });

  it('Gmail scenario reports fixture-ok in default (offline) mode', () => {
    const scenarioPath = join(ROOT, 'gmail-inbox-digest.scenario.json');
    const result = runOne(scenarioPath, { rootDir: ROOT, env: { PARALLX_GMAIL_E2E: '0' } });
    expect(result.scenarioId).toBe('gmail-inbox-digest');
    expect(result.outcome).toBe('fixture-ok');
    expect(result.rubric?.dimensions.length).toBe(6); // §9.3 dims
    expect(result.rubric?.passThreshold).toBe(10);
  });

  it('Gmail scenario reports live-mode-ready when PARALLX_GMAIL_E2E=1 (post-F4)', () => {
    const scenarioPath = join(ROOT, 'gmail-inbox-digest.scenario.json');
    const result = runOne(scenarioPath, { rootDir: ROOT, env: { PARALLX_GMAIL_E2E: '1' } });
    expect(result.outcome).toBe('live-mode-ready');
    expect(result.note).toMatch(/F2\+F3\+F4/);
  });

  it('runAll reports loaded for non-Gmail scenarios + fixture-ok for Gmail (offline)', () => {
    const results = runAll({ rootDir: ROOT, env: {} });
    const gmail = results.find((r) => r.scenarioId === 'gmail-inbox-digest');
    expect(gmail?.outcome).toBe('fixture-ok');

    const heartbeat = results.find((r) => r.scenarioId === 'heartbeat-tick');
    expect(heartbeat?.outcome).toBe('loaded');

    const subagent = results.find((r) => r.scenarioId === 'subagent-spawn');
    expect(subagent?.outcome).toBe('loaded');

    // No invalid / fixture-mismatch outcomes for shipped scenarios.
    expect(results.some((r) => r.outcome === 'invalid')).toBe(false);
    expect(results.some((r) => r.outcome === 'fixture-mismatch')).toBe(false);
  });
});

describe('autonomy-eval runner — Gmail rubric (§9.3 six-dimension contract)', () => {
  it('Gmail rubric carries the six §9.3 dimensions', () => {
    const scenarioPath = join(ROOT, 'gmail-inbox-digest.scenario.json');
    const sc = loadScenario(scenarioPath);
    const rubric = resolveRubric(sc, scenarioPath);
    const ids = rubric.dimensions.map((d) => d.id).sort();
    expect(ids).toEqual([
      'loop.safety',
      'report.quality',
      'surface.routing',
      'tool.args',
      'tool.selection',
      'trust.surface',
    ]);
    // Each dimension is 0/1/2.
    for (const d of rubric.dimensions) expect(d.max).toBe(2);
    // Stability gate: 5 consecutive runs.
    expect(rubric.stability?.consecutiveRunsRequired).toBe(5);
  });
});
