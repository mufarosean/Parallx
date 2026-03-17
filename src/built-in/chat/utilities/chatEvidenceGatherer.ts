/**
 * M38 Evidence Gatherer — executes plan steps to collect typed evidence bundles.
 *
 * Each non-synthesize step in the execution plan maps to a gather operation
 * that produces a typed evidence item (structural, semantic, or exhaustive).
 */

import type {
  CoverageLevel,
  EvidenceItem,
  ICoverageRecord,
  IEvidenceBundle,
  IExecutionPlan,
  IExecutionStep,
  IExhaustiveEvidence,
  IFileEntry,
  ISemanticEvidence,
  IStructuralEvidence,
} from '../chatTypes.js';

// ── Dependencies ───────────────────────────────────────────────────────────

export interface IEvidenceGathererDeps {
  /** List entries in a workspace-relative directory. */
  readonly listFilesRelative?: (relativePath: string) => Promise<{ name: string; type: 'file' | 'directory' }[]>;
  /** Read a workspace-relative file and return its text content. */
  readonly readFileRelative?: (relativePath: string) => Promise<string | null>;
  /** Scoped RAG retrieval with optional path prefixes. */
  readonly retrieveContext?: (query: string, pathPrefixes?: string[]) => Promise<{
    text: string;
    sources: Array<{ uri: string; label: string; index?: number }>;
  } | undefined>;
}

const MAX_ENUM_DEPTH = 3;
const MAX_ENUM_ENTRIES = 200;

function joinRelativePath(base: string, name: string): string {
  if (!base) {
    return name;
  }
  return `${base.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Execute the gathering steps of an execution plan and return a typed
 * evidence bundle.  The `synthesize` step is excluded — it is consumed
 * downstream by the LLM synthesis stage.
 */
export async function gatherEvidence(
  plan: IExecutionPlan,
  userText: string,
  deps: IEvidenceGathererDeps,
): Promise<IEvidenceBundle> {
  const items: EvidenceItem[] = [];
  let totalChars = 0;

  for (const step of plan.steps) {
    if (step.kind === 'synthesize') continue;

    const item = await gatherStep(step, userText, deps, items);
    if (item) {
      items.push(item);
      totalChars += measureChars(item);
    }
  }

  return { plan, items, totalChars };
}

// ── Step dispatch ──────────────────────────────────────────────────────────

async function gatherStep(
  step: IExecutionStep,
  userText: string,
  deps: IEvidenceGathererDeps,
  priorItems: readonly EvidenceItem[],
): Promise<EvidenceItem | undefined> {
  switch (step.kind) {
    case 'enumerate':
    case 'structural-inspect':
      return gatherStructural(step, deps);
    case 'scoped-retrieve':
      return gatherSemantic(step, userText, deps);
    case 'deterministic-read':
      return gatherExhaustive(step, deps, priorItems);
    default:
      return undefined;
  }
}

// ── Structural (enumerate / structural-inspect) ────────────────────────────

async function gatherStructural(
  step: IExecutionStep,
  deps: IEvidenceGathererDeps,
): Promise<IStructuralEvidence | undefined> {
  if (!deps.listFilesRelative) return undefined;

  const scopePath = step.targetPaths?.[0] ?? '';
  const files = await collectFilesInScope(scopePath, deps);

  return { kind: 'structural', files, scopePath };
}

// ── Semantic (scoped-retrieve) ─────────────────────────────────────────────

async function gatherSemantic(
  step: IExecutionStep,
  userText: string,
  deps: IEvidenceGathererDeps,
): Promise<ISemanticEvidence | undefined> {
  if (!deps.retrieveContext) return undefined;

  const pathPrefixes = step.targetPaths ? [...step.targetPaths] : undefined;
  const result = pathPrefixes?.length
    ? await deps.retrieveContext(userText, pathPrefixes)
    : await deps.retrieveContext(userText);

  if (!result) return undefined;
  return { kind: 'semantic', text: result.text, sources: result.sources };
}

// ── Exhaustive (deterministic-read) ────────────────────────────────────────

const MAX_READ_FILES = 50;
const MAX_READ_CHARS = 10_000;

async function gatherExhaustive(
  step: IExecutionStep,
  deps: IEvidenceGathererDeps,
  priorItems: readonly EvidenceItem[],
): Promise<IExhaustiveEvidence | undefined> {
  if (!deps.readFileRelative) return undefined;

  const latestStructural = [...priorItems]
    .reverse()
    .find((item): item is IStructuralEvidence => item.kind === 'structural');

  const targetPaths = latestStructural?.files.length
    ? latestStructural.files.map((file) => file.relativePath)
    : step.targetPaths?.length
      ? [...step.targetPaths]
      : [];

  if (targetPaths.length === 0) {
    return undefined;
  }

  const reads: { relativePath: string; content: string }[] = [];

  for (const targetPath of targetPaths.slice(0, MAX_READ_FILES)) {
    const content = await deps.readFileRelative(targetPath);
    if (content !== null) {
      reads.push({
        relativePath: targetPath,
        content: content.length > MAX_READ_CHARS
          ? content.slice(0, MAX_READ_CHARS) + '\n… (truncated)'
          : content,
      });
    }
  }

  return { kind: 'exhaustive', reads };
}

async function collectFilesInScope(
  scopePath: string,
  deps: IEvidenceGathererDeps,
): Promise<IFileEntry[]> {
  if (!deps.listFilesRelative) {
    return [];
  }

  const results: IFileEntry[] = [];
  const visited = new Set<string>();

  const walk = async (relativePath: string, depth: number): Promise<void> => {
    if (results.length >= MAX_ENUM_ENTRIES) {
      return;
    }
    const key = relativePath || '.';
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const entries = await deps.listFilesRelative!(relativePath).catch(() => []);
    for (const entry of entries) {
      if (results.length >= MAX_ENUM_ENTRIES) {
        return;
      }

      const childPath = joinRelativePath(relativePath, entry.name);
      if (entry.type === 'file') {
        const dotIndex = entry.name.lastIndexOf('.');
        const ext = dotIndex >= 0 ? entry.name.slice(dotIndex) : '';
        results.push({ relativePath: childPath, ext });
        continue;
      }

      if (depth < MAX_ENUM_DEPTH) {
        await walk(childPath, depth + 1);
      }
    }
  };

  await walk(scopePath, 0);
  return results;
}

// ── Measurement ────────────────────────────────────────────────────────────

function measureChars(item: EvidenceItem): number {
  switch (item.kind) {
    case 'structural':
      return item.files.reduce((sum, f) => sum + f.relativePath.length, 0);
    case 'semantic':
      return item.text.length;
    case 'exhaustive':
      return item.reads.reduce((sum, r) => sum + r.content.length, 0);
  }
}

// ── Coverage computation ───────────────────────────────────────────────────

/**
 * Compute a coverage record from the evidence bundle.
 *
 * The record compares the set of files discovered during structural/enumerate
 * steps against the files actually read during exhaustive steps.  For purely
 * semantic workflows (no enumeration), coverage defaults to 'full' since
 * retrieval completeness is assessed separately by evidence sufficiency.
 */
export function computeCoverage(bundle: IEvidenceBundle): ICoverageRecord {
  // Collect all enumerated file paths from structural evidence.
  const enumeratedPaths = new Set<string>();
  for (const item of bundle.items) {
    if (item.kind === 'structural') {
      for (const file of item.files) {
        enumeratedPaths.add(file.relativePath);
      }
    }
  }

  // If no structural enumeration, coverage is not applicable — default full.
  if (enumeratedPaths.size === 0) {
    return { level: 'full', totalTargets: 0, coveredTargets: 0, gaps: [] };
  }

  // Collect all paths that were actually read.
  const readPaths = new Set<string>();
  for (const item of bundle.items) {
    if (item.kind === 'exhaustive') {
      for (const read of item.reads) {
        readPaths.add(read.relativePath);
      }
    }
  }

  // Also count semantic sources as covering files they reference.
  for (const item of bundle.items) {
    if (item.kind === 'semantic') {
      for (const source of item.sources) {
        readPaths.add(source.uri);
      }
    }
  }

  const totalTargets = enumeratedPaths.size;
  const gaps: string[] = [];
  for (const path of enumeratedPaths) {
    if (!readPaths.has(path)) {
      gaps.push(path);
    }
  }
  const coveredTargets = totalTargets - gaps.length;
  const level = classifyCoverageLevel(coveredTargets, totalTargets);

  return { level, totalTargets, coveredTargets, gaps };
}

function classifyCoverageLevel(covered: number, total: number): CoverageLevel {
  if (total === 0) return 'full';
  const ratio = covered / total;
  if (ratio >= 1) return 'full';
  if (ratio >= 0.7) return 'partial';
  if (ratio > 0) return 'minimal';
  return 'none';
}
