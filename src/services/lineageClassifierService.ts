// lineageClassifierService.ts — chat-model lineage classification (M76 Phase 4)
//
// Registers a RefreshPass with the MindMapRefreshOrchestrator that classifies
// pairs of related sources as one of:
//
//   extends  — A builds on B's framework or results  →  edge A → B
//   refutes  — A argues against B's claims          →  edge A → B
//   none     — independent or only shares vocabulary →  no edge
//
// The classifier runs ONLY when the user clicks "Refresh mind map" and a
// refresh is started by the orchestrator. It never runs autonomously, never
// on indexing events, never on the graph render path.
//
// Candidate pairs come from edges already in the cache: similar-to,
// references, or co-occurrence. The classifier never compares all pairs —
// only those a cheaper Phase 2 signal already flagged as related in some
// way. For a typical incremental refresh that means a handful of LLM calls,
// not a worst-case N² sweep.
//
// LLM calls go through ILanguageModelsService.sendChatRequestForModel(),
// the isolated path heartbeat and cron already use. The active chat model
// is whatever the user has selected in the chat UI — this is the contract
// from the M76 design ("the user's chosen model, not a separate one").

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import type {
  IDatabaseService,
  IVectorStoreService,
  IMindMapRefreshOrchestrator,
  IWorkspaceService,
} from './serviceTypes.js';
import type { ILanguageModelsService, IChatMessage } from './chatTypes.js';
import type {
  RefreshContext,
  RefreshPass,
} from './mindMapRefreshOrchestrator.js';
import type {
  SemanticGraphSourceType,
} from './semanticGraphService.js';
import { semanticSourceToNodeId } from './semanticGraphService.js';

const PASS_ID = 'lineage';
const PASS_DISPLAY_NAME = 'Lineage classification';

/** How many partners to consider per changed source. Bounds runtime. */
const MAX_PARTNERS_PER_SOURCE = 20;
/** Excerpt length per side of the pair. Keeps the prompt within small-model context. */
const EXCERPT_CHARS_PER_SIDE = 1500;
/** Minimum confidence to accept a non-'none' classification. Low-confidence → treated as 'none'. */
const MIN_CONFIDENCE_FOR_EDGE = 0.55;
/** Average wall-clock cost per source (multiple pairs). Used by the orchestrator estimate. */
const ESTIMATED_SECONDS_PER_SOURCE = 30;

type LineageRelationship = 'extends' | 'refutes' | 'none';

interface LineageClassification {
  readonly relationship: LineageRelationship;
  readonly confidence: number;
}

interface CandidatePartner {
  readonly partnerType: SemanticGraphSourceType;
  readonly partnerId: string;
  readonly partnerNodeId: string;
}

/**
 * Owns the lineage RefreshPass. Construction registers the pass with the
 * orchestrator. dispose() removes it.
 *
 * Wired in workbenchServices.ts after both the orchestrator and the
 * language models service exist.
 */
export class LineageClassifierService extends Disposable {
  private _schemaReady = false;
  private readonly _passRegistration: IDisposable;

  constructor(
    private readonly _db: IDatabaseService,
    private readonly _vectorStore: IVectorStoreService,
    private readonly _languageModels: ILanguageModelsService,
    private readonly _workspaceService: IWorkspaceService,
    orchestrator: IMindMapRefreshOrchestrator,
  ) {
    super();
    const pass: RefreshPass = {
      id: PASS_ID,
      displayName: PASS_DISPLAY_NAME,
      estimateSecondsPerSource: () => ESTIMATED_SECONDS_PER_SOURCE,
      run: (ctx) => this._runPass(ctx),
    };
    this._passRegistration = orchestrator.registerPass(pass);
    this._register(this._passRegistration);
  }

  // ── Pass implementation ──────────────────────────────────────────────

  private async _runPass(ctx: RefreshContext): Promise<void> {
    if (!this._db.isOpen) return;
    await this._ensureSchema();

    // Snapshot the workspace root via the source-id mapper. We need it to
    // build node ids for `file_chunk` sources.
    const totalSources = ctx.changedSources.length;
    let completedSources = 0;

    for (const source of ctx.changedSources) {
      if (ctx.signal.aborted) return;

      const sourceNodeId = semanticSourceToNodeId(
        source.sourceType,
        source.sourceId,
        this._workspaceRootForSource(source.sourceType, source.sourceId),
      );
      if (!sourceNodeId) {
        // Can't build a node id — likely a file source with no workspace open.
        // Skip but mark processed so we don't keep retrying.
        await ctx.markProcessed(source.sourceType, source.sourceId, source.currentHash);
        completedSources += 1;
        continue;
      }

      // Wipe this source's prior extends/refutes edges. The classifier
      // reconstructs them from scratch each run for this source so
      // outcomes that flip ('extends' → 'none', say) clear cleanly.
      await this._db.run(
        `DELETE FROM semantic_graph_edges
          WHERE origin_type = ? AND origin_id = ? AND kind IN ('extends', 'refutes')`,
        [source.sourceType, source.sourceId],
      );

      const partners = await this._findCandidatePartners(source.sourceType, source.sourceId);

      const totalUnits = partners.length;
      let completedUnits = 0;
      ctx.reportProgress(
        completedSources,
        totalSources,
        `${PASS_DISPLAY_NAME}: ${source.sourceId} (${partners.length} candidate pair${partners.length === 1 ? '' : 's'})`,
      );

      for (const partner of partners) {
        if (ctx.signal.aborted) return;

        const partnerHash = await this._vectorStore.getContentHash(partner.partnerType, partner.partnerId);
        if (!partnerHash) {
          completedUnits += 1;
          continue;
        }

        // Check cache. If hashes match, reuse the prior classification.
        const cached = await this._readCachedClassification(
          sourceNodeId,
          partner.partnerNodeId,
          source.currentHash,
          partnerHash,
        );

        let classification: LineageClassification;
        if (cached) {
          classification = cached;
        } else {
          // Fresh classification via chat model. Catches errors so one bad
          // pair doesn't poison the whole refresh.
          classification = await this._classifyPair(
            source.sourceType,
            source.sourceId,
            partner.partnerType,
            partner.partnerId,
            ctx.signal,
          );
          await this._writeCachedClassification(
            sourceNodeId,
            partner.partnerNodeId,
            source.currentHash,
            partnerHash,
            classification,
          );
        }

        if (
          classification.relationship !== 'none' &&
          classification.confidence >= MIN_CONFIDENCE_FOR_EDGE
        ) {
          await this._writeLineageEdge(
            source.sourceType,
            source.sourceId,
            sourceNodeId,
            partner,
            partnerHash,
            classification,
          );
        }

        completedUnits += 1;
        ctx.reportProgress(
          completedSources + completedUnits / Math.max(1, totalUnits),
          totalSources,
          `${PASS_DISPLAY_NAME}: pair ${completedUnits} of ${totalUnits} for ${source.sourceId}`,
        );
      }

      await ctx.markProcessed(source.sourceType, source.sourceId, source.currentHash);
      completedSources += 1;
    }

    ctx.reportProgress(totalSources, totalSources, `${PASS_DISPLAY_NAME}: complete`);
  }

  // ── Candidate discovery ──────────────────────────────────────────────

  /**
   * Partners of a source for lineage classification are the OTHER endpoints
   * of any similarity / reference / co-occurrence edge that touches this
   * source. The DB stores edges canonicalised by node id for undirected
   * kinds, so we check both source_node_id and target_node_id columns.
   */
  private async _findCandidatePartners(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
  ): Promise<CandidatePartner[]> {
    const sourceNodeId = semanticSourceToNodeId(
      sourceType,
      sourceId,
      this._workspaceRootForSource(sourceType, sourceId),
    );
    if (!sourceNodeId) return [];

    const rows = await this._db.all<{
      partner_node_id: string;
      partner_type: SemanticGraphSourceType;
      partner_id: string;
    }>(
      `SELECT DISTINCT
         CASE WHEN source_node_id = ? THEN target_node_id ELSE source_node_id END AS partner_node_id,
         CASE WHEN source_node_id = ? THEN target_type    ELSE source_type    END AS partner_type,
         CASE WHEN source_node_id = ? THEN target_id      ELSE source_id      END AS partner_id
       FROM semantic_graph_edges
       WHERE (source_node_id = ? OR target_node_id = ?)
         AND kind IN ('similar-to', 'references', 'co-occurrence')
       LIMIT ?`,
      [sourceNodeId, sourceNodeId, sourceNodeId, sourceNodeId, sourceNodeId, MAX_PARTNERS_PER_SOURCE],
    );

    const partners: CandidatePartner[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const key = `${r.partner_type}:${r.partner_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Skip self-partner just in case canonicalisation ever flips.
      if (r.partner_type === sourceType && r.partner_id === sourceId) continue;
      partners.push({
        partnerType: r.partner_type,
        partnerId: r.partner_id,
        partnerNodeId: r.partner_node_id,
      });
    }
    return partners;
  }

  // ── Cache plumbing ───────────────────────────────────────────────────

  private async _readCachedClassification(
    sourceNodeId: string,
    targetNodeId: string,
    sourceHash: string,
    targetHash: string,
  ): Promise<LineageClassification | null> {
    const row = await this._db.get<{
      relationship: LineageRelationship;
      confidence: number;
    }>(
      `SELECT relationship, confidence
         FROM lineage_classification_cache
        WHERE source_node_id = ? AND target_node_id = ?
          AND source_content_hash = ? AND target_content_hash = ?`,
      [sourceNodeId, targetNodeId, sourceHash, targetHash],
    );
    if (!row) return null;
    return { relationship: row.relationship, confidence: row.confidence };
  }

  private async _writeCachedClassification(
    sourceNodeId: string,
    targetNodeId: string,
    sourceHash: string,
    targetHash: string,
    classification: LineageClassification,
  ): Promise<void> {
    await this._db.run(
      `INSERT OR REPLACE INTO lineage_classification_cache
         (source_node_id, target_node_id, source_content_hash, target_content_hash,
          relationship, confidence, classified_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        sourceNodeId,
        targetNodeId,
        sourceHash,
        targetHash,
        classification.relationship,
        classification.confidence,
      ],
    );
  }

  // ── Edge emission ────────────────────────────────────────────────────

  private async _writeLineageEdge(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
    sourceNodeId: string,
    partner: CandidatePartner,
    partnerHash: string,
    classification: LineageClassification,
  ): Promise<void> {
    await this._db.run(
      `INSERT OR REPLACE INTO semantic_graph_edges (
         source_node_id, target_node_id, source_type, source_id,
         target_type, target_id, origin_type, origin_id, score, kind,
         direction, source_content_hash, target_content_hash, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'forward', NULL, ?, datetime('now'))`,
      [
        sourceNodeId,
        partner.partnerNodeId,
        sourceType,
        sourceId,
        partner.partnerType,
        partner.partnerId,
        sourceType,
        sourceId,
        classification.confidence,
        classification.relationship,
        partnerHash,
      ],
    );
  }

  // ── Chat-model classification ────────────────────────────────────────

  private async _classifyPair(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
    partnerType: SemanticGraphSourceType,
    partnerId: string,
    signal: AbortSignal,
  ): Promise<LineageClassification> {
    const modelId = this._languageModels.getActiveModel();
    if (!modelId) {
      // No model selected — classifier can't run; treat as 'none' with zero
      // confidence so we don't emit edges and don't poison the cache long-term.
      return { relationship: 'none', confidence: 0 };
    }

    const aExcerpt = await this._excerptForSource(sourceType, sourceId, EXCERPT_CHARS_PER_SIDE);
    const bExcerpt = await this._excerptForSource(partnerType, partnerId, EXCERPT_CHARS_PER_SIDE);
    if (aExcerpt.length === 0 || bExcerpt.length === 0) {
      return { relationship: 'none', confidence: 0 };
    }

    const messages: IChatMessage[] = [
      {
        role: 'system',
        content:
          'You classify the relationship between two documents. Respond ONLY with valid JSON.',
      },
      {
        role: 'user',
        content: this._buildPrompt(aExcerpt, bExcerpt),
      },
    ];

    let assembled = '';
    try {
      const stream = this._languageModels.sendChatRequestForModel(
        modelId,
        messages,
        { temperature: 0.1, format: 'json', maxTokens: 200 },
        signal,
      );
      for await (const chunk of stream) {
        assembled += chunk.content;
        if (signal.aborted) return { relationship: 'none', confidence: 0 };
      }
    } catch {
      return { relationship: 'none', confidence: 0 };
    }

    return parseLineageResponse(assembled);
  }

  private _buildPrompt(aExcerpt: string, bExcerpt: string): string {
    return [
      'Document A:',
      aExcerpt,
      '',
      '---',
      '',
      'Document B:',
      bExcerpt,
      '',
      '---',
      '',
      'What is the relationship of Document A TO Document B?',
      '- "extends": A builds on, develops, or applies B\'s framework or results.',
      '- "refutes": A argues against or contradicts B\'s claims.',
      '- "none": A is independent of B or merely shares topic vocabulary.',
      '',
      'Reply with valid JSON only, no commentary:',
      '{"relationship": "extends" | "refutes" | "none", "confidence": 0.0-1.0}',
    ].join('\n');
  }

  private async _excerptForSource(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
    maxChars: number,
  ): Promise<string> {
    const chunks = await this._vectorStore.getSourceChunks(sourceType, sourceId, 8);
    let out = '';
    for (const c of chunks) {
      const text = (c.text ?? '').trim();
      if (text.length === 0) continue;
      if (out.length + text.length + 1 > maxChars) {
        out += '\n' + text.slice(0, Math.max(0, maxChars - out.length - 1));
        break;
      }
      out += (out.length === 0 ? '' : '\n') + text;
    }
    return out;
  }

  // ── Schema ───────────────────────────────────────────────────────────

  private async _ensureSchema(): Promise<void> {
    if (this._schemaReady || !this._db.isOpen) return;
    await this._db.run(`
      CREATE TABLE IF NOT EXISTS lineage_classification_cache (
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        source_content_hash TEXT NOT NULL,
        target_content_hash TEXT NOT NULL,
        relationship TEXT NOT NULL,
        confidence REAL NOT NULL,
        classified_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source_node_id, target_node_id, source_content_hash, target_content_hash)
      )
    `);
    this._schemaReady = true;
  }

  // ── Helper ───────────────────────────────────────────────────────────

  /**
   * Workspace root URI snapshot — used by semanticSourceToNodeId to map
   * file_chunk source ids to graph node ids. Pages don't need it.
   */
  private _workspaceRootForSource(sourceType: SemanticGraphSourceType, _sourceId: string): string | undefined {
    if (sourceType === 'page_block') return undefined;
    const root = this._workspaceService.folders[0]?.uri;
    return root ? root.toString() : undefined;
  }
}

/**
 * Parse the chat-model response into a LineageClassification. Robust to:
 *   - extra prose around the JSON (some small models leak text)
 *   - missing or out-of-range confidence (clamped to [0, 1])
 *   - unknown relationship values (treated as 'none')
 *   - malformed JSON (treated as 'none' with zero confidence)
 *
 * Exported for unit testing.
 */
export function parseLineageResponse(raw: string): LineageClassification {
  const fallback: LineageClassification = { relationship: 'none', confidence: 0 };
  if (typeof raw !== 'string' || raw.length === 0) return fallback;

  // Extract the first JSON object if there's surrounding prose.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object') return fallback;
  const obj = parsed as { relationship?: unknown; confidence?: unknown };

  const rel = obj.relationship;
  const conf = obj.confidence;

  let relationship: LineageRelationship = 'none';
  if (rel === 'extends' || rel === 'refutes' || rel === 'none') {
    relationship = rel;
  }

  let confidence = 0;
  if (typeof conf === 'number' && Number.isFinite(conf)) {
    confidence = Math.max(0, Math.min(1, conf));
  }

  return { relationship, confidence };
}
