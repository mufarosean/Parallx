/**
 * M38 Evidence Gatherer — executes plan steps to collect typed evidence bundles.
 *
 * Each non-synthesize step in the execution plan maps to a gather operation
 * that produces a typed evidence item (structural, semantic, or exhaustive).
 */

import type {
  EvidenceItem,
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

    const item = await gatherStep(step, userText, deps);
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
): Promise<EvidenceItem | undefined> {
  switch (step.kind) {
    case 'enumerate':
    case 'structural-inspect':
      return gatherStructural(step, deps);
    case 'scoped-retrieve':
      return gatherSemantic(step, userText, deps);
    case 'deterministic-read':
      return gatherExhaustive(step, deps);
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
  const entries = await deps.listFilesRelative(scopePath);

  const files: IFileEntry[] = entries
    .filter(e => e.type === 'file')
    .map(e => {
      const relativePath = scopePath ? `${scopePath}/${e.name}` : e.name;
      const dotIndex = e.name.lastIndexOf('.');
      const ext = dotIndex >= 0 ? e.name.slice(dotIndex) : '';
      return { relativePath, ext };
    });

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
): Promise<IExhaustiveEvidence | undefined> {
  if (!deps.readFileRelative || !step.targetPaths?.length) return undefined;

  const reads: { relativePath: string; content: string }[] = [];

  for (const targetPath of step.targetPaths.slice(0, MAX_READ_FILES)) {
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
