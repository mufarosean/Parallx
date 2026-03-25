import type { IChatRuntimeTrace } from '../../src/built-in/chat/chatTypes';
import { CLAW_PARITY_SCENARIOS, type IClawParityScenario } from './clawParityBenchmark';

export type ClawParitySystem = 'parallx' | 'nemo-claw';
export type ClawParityArtifactOutcome = 'completed' | 'failed' | 'blocked';
export type ClawParityComparisonStatus = 'pass' | 'fail' | 'blocked';

export interface IClawParityRuntimeBoundary {
  readonly type: string;
  readonly participantId?: string;
  readonly runtime?: string;
}

export interface IClawParityArtifactInput {
  readonly system: ClawParitySystem;
  readonly scenarioId: string;
  readonly capturedAt?: string;
  readonly outcome?: ClawParityArtifactOutcome;
  readonly answerText?: string;
  readonly traces?: readonly IChatRuntimeTrace[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly observedSignals?: readonly string[];
  readonly blockers?: readonly string[];
  readonly notes?: readonly string[];
}

export interface IClawParityArtifact {
  readonly version: 1;
  readonly system: ClawParitySystem;
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly prompt: string;
  readonly capturedAt: string;
  readonly outcome: ClawParityArtifactOutcome;
  readonly answerText: string;
  readonly traces: readonly IChatRuntimeTrace[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signals: readonly string[];
  readonly blockers: readonly string[];
  readonly notes: readonly string[];
}

export interface IClawParityComparison {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly comparisonMethod: IClawParityScenario['comparisonMethod'];
  readonly status: ClawParityComparisonStatus;
  readonly requiredSignals: readonly string[];
  readonly matchedSignals: readonly string[];
  readonly missingFromParallx: readonly string[];
  readonly missingFromNemoClaw: readonly string[];
  readonly parallxOnlySignals: readonly string[];
  readonly nemoClawOnlySignals: readonly string[];
  readonly blockers: readonly string[];
  readonly summary: string;
}

export interface IClawParityComparisonSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly blocked: number;
}

function getScenarioOrThrow(scenarioId: string): IClawParityScenario {
  const scenario = CLAW_PARITY_SCENARIOS.find((entry) => entry.id === scenarioId);
  if (!scenario) {
    throw new Error(`Unknown claw parity scenario: ${scenarioId}`);
  }
  return scenario;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function hasTruthyRecordProperty(record: Record<string, unknown> | undefined, key: string): boolean {
  return Boolean(record && key in record && record[key]);
}

function extractRuntimeBoundary(metadata: Record<string, unknown> | undefined): IClawParityRuntimeBoundary | undefined {
  const boundary = asRecord(metadata?.runtimeBoundary);
  if (!boundary || typeof boundary.type !== 'string') {
    return undefined;
  }

  return {
    type: boundary.type,
    participantId: typeof boundary.participantId === 'string' ? boundary.participantId : undefined,
    runtime: typeof boundary.runtime === 'string' ? boundary.runtime : undefined,
  };
}

function normalizeSignals(
  traces: readonly IChatRuntimeTrace[],
  metadata: Record<string, unknown> | undefined,
  observedSignals: readonly string[] | undefined,
): string[] {
  const signals = new Set<string>(observedSignals ?? []);
  let postFinalizationIndex = -1;
  let memoryStoredIndex = -1;
  let hasApprovalTrace = false;
  let hasToolCheckpoint = false;

  traces.forEach((trace, index) => {
    if (trace.runtime) {
      signals.add(`runtime=${trace.runtime}`);
    }
    if (trace.runState) {
      signals.add(`runState=${trace.runState}`);
    }
    if (trace.approvalState) {
      signals.add(`approvalState=${trace.approvalState}`);
      signals.add('approval state trace');
      signals.add('permission or approval posture visible');
      hasApprovalTrace = true;
    }
    if (trace.toolName) {
      signals.add(`tool=${trace.toolName}`);
      signals.add('tool identity visible');
    }
    if (trace.checkpoint) {
      signals.add(trace.checkpoint);
      if (trace.checkpoint === 'prompt-seed') {
        signals.add('prompt-seed checkpoint');
      }
      if (trace.checkpoint === 'prompt-envelope') {
        signals.add('prompt-envelope checkpoint');
      }
      if (trace.checkpoint === 'post-finalization') {
        postFinalizationIndex = index;
      }
      if (trace.checkpoint === 'memory-summary-refined-stored') {
        memoryStoredIndex = index;
      }
      if (trace.checkpoint.toLowerCase().includes('tool')) {
        hasToolCheckpoint = true;
      }
    }
  });

  if (postFinalizationIndex >= 0 && memoryStoredIndex > postFinalizationIndex) {
    signals.add('memory-summary-refined-stored occurs after completion');
  }

  if (hasToolCheckpoint) {
    signals.add('tool validation trace when tools are used');
  }

  if (hasApprovalTrace) {
    signals.add('executed only when approved');
  }

  const runtimeBoundary = extractRuntimeBoundary(metadata);
  if (runtimeBoundary) {
    signals.add(`runtimeBoundary=${runtimeBoundary.type}`);
    if (runtimeBoundary.runtime) {
      signals.add(`runtime=${runtimeBoundary.runtime}`);
    }
    if (runtimeBoundary.type === 'bridge-compatibility') {
      signals.add('surface=bridge');
    }
  }

  if (hasTruthyRecordProperty(metadata, 'toolProvenance') || hasTruthyRecordProperty(metadata, 'provenance')) {
    signals.add('tool source provenance visible');
    signals.add('tool provenance');
  }
  if (Array.isArray(metadata?.promptLayers) || Array.isArray(metadata?.effectivePromptLayers)) {
    signals.add('effective prompt layers are inspectable');
  }
  if (hasTruthyRecordProperty(metadata, 'skillSource') || Array.isArray(metadata?.skillSources)) {
    signals.add('skill source is identifiable');
  }
  if (hasTruthyRecordProperty(metadata, 'workspacePromptLayer')) {
    signals.add('workspace prompt layer recognized');
  }
  if (metadata?.hiddenBundledStringPath === false) {
    signals.add('hidden bundled string path absent');
  }

  return Array.from(signals).sort();
}

export function createClawParityArtifact(input: IClawParityArtifactInput): IClawParityArtifact {
  const scenario = getScenarioOrThrow(input.scenarioId);
  const traces = [...(input.traces ?? [])];
  const metadata = asRecord(input.metadata);

  return {
    version: 1,
    system: input.system,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    prompt: scenario.prompt,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    outcome: input.outcome ?? 'completed',
    answerText: input.answerText ?? '',
    traces,
    metadata,
    signals: normalizeSignals(traces, metadata, input.observedSignals),
    blockers: [...(input.blockers ?? [])],
    notes: [...(input.notes ?? [])],
  };
}

function difference(requiredSignals: readonly string[], presentSignals: readonly string[]): string[] {
  const present = new Set(presentSignals);
  return requiredSignals.filter((signal) => !present.has(signal));
}

function setDifference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((signal) => !rightSet.has(signal)).sort();
}

function buildSummary(
  status: ClawParityComparisonStatus,
  scenario: IClawParityScenario,
  missingFromParallx: readonly string[],
  missingFromNemoClaw: readonly string[],
  blockers: readonly string[],
): string {
  if (status === 'blocked') {
    return `${scenario.id} is blocked: ${blockers.join('; ')}`;
  }
  if (status === 'pass') {
    return `${scenario.id} passed with all required signals present in Parallx and NemoClaw artifacts.`;
  }
  const missing: string[] = [];
  if (missingFromParallx.length > 0) {
    missing.push(`Parallx missing ${missingFromParallx.join(', ')}`);
  }
  if (missingFromNemoClaw.length > 0) {
    missing.push(`NemoClaw missing ${missingFromNemoClaw.join(', ')}`);
  }
  return `${scenario.id} failed: ${missing.join('; ')}`;
}

export function compareClawParityArtifacts(
  scenarioId: string,
  parallxArtifact: IClawParityArtifact,
  nemoClawArtifact?: IClawParityArtifact,
): IClawParityComparison {
  const scenario = getScenarioOrThrow(scenarioId);

  if (parallxArtifact.scenarioId !== scenarioId) {
    throw new Error(`Parallx artifact scenario mismatch: expected ${scenarioId}, received ${parallxArtifact.scenarioId}`);
  }
  if (parallxArtifact.system !== 'parallx') {
    throw new Error(`Expected Parallx artifact, received ${parallxArtifact.system}`);
  }
  if (nemoClawArtifact && nemoClawArtifact.scenarioId !== scenarioId) {
    throw new Error(`NemoClaw artifact scenario mismatch: expected ${scenarioId}, received ${nemoClawArtifact.scenarioId}`);
  }
  if (nemoClawArtifact && nemoClawArtifact.system !== 'nemo-claw') {
    throw new Error(`Expected NemoClaw artifact, received ${nemoClawArtifact.system}`);
  }

  const requiredSignals = [...scenario.requiredSignals];
  const missingFromParallx = difference(requiredSignals, parallxArtifact.signals);
  const missingFromNemoClaw = nemoClawArtifact
    ? difference(requiredSignals, nemoClawArtifact.signals)
    : requiredSignals;
  const matchedSignals = requiredSignals.filter((signal) =>
    parallxArtifact.signals.includes(signal) && Boolean(nemoClawArtifact?.signals.includes(signal)),
  );
  const parallxOnlySignals = nemoClawArtifact
    ? setDifference(parallxArtifact.signals, nemoClawArtifact.signals)
    : [...parallxArtifact.signals].sort();
  const nemoClawOnlySignals = nemoClawArtifact
    ? setDifference(nemoClawArtifact.signals, parallxArtifact.signals)
    : [];

  const blockers = [
    ...parallxArtifact.blockers,
    ...(nemoClawArtifact?.blockers ?? []),
  ];
  if (!nemoClawArtifact) {
    blockers.push('Missing NemoClaw artifact');
  }
  if (scenario.blocker && (parallxArtifact.outcome === 'blocked' || nemoClawArtifact?.outcome === 'blocked' || !nemoClawArtifact)) {
    blockers.push(scenario.blocker);
  }

  const status: ClawParityComparisonStatus = blockers.length > 0
    ? 'blocked'
    : (missingFromParallx.length === 0 && missingFromNemoClaw.length === 0 ? 'pass' : 'fail');

  return {
    scenarioId,
    scenarioName: scenario.name,
    comparisonMethod: scenario.comparisonMethod,
    status,
    requiredSignals,
    matchedSignals,
    missingFromParallx,
    missingFromNemoClaw,
    parallxOnlySignals,
    nemoClawOnlySignals,
    blockers,
    summary: buildSummary(status, scenario, missingFromParallx, missingFromNemoClaw, blockers),
  };
}

export function summarizeClawParityComparisons(
  comparisons: readonly IClawParityComparison[],
): IClawParityComparisonSummary {
  return comparisons.reduce<IClawParityComparisonSummary>((summary, comparison) => ({
    total: summary.total + 1,
    passed: summary.passed + (comparison.status === 'pass' ? 1 : 0),
    failed: summary.failed + (comparison.status === 'fail' ? 1 : 0),
    blocked: summary.blocked + (comparison.status === 'blocked' ? 1 : 0),
  }), {
    total: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
  });
}