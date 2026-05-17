// Tests for the M76 Phase 6 concept-curation methods on SemanticGraphService:
//   - renameConceptNode
//   - deleteConceptNode
//   - mergeConceptNodes
//   - forceFullReCluster
//
// The mock simulates the relevant tables (concept_nodes, concept_node_members,
// semantic_graph_edges, refresh_pass_state) so we can assert on persisted
// state rather than only on SQL strings.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Emitter } from '../../src/platform/events.js';
import { SemanticGraphService } from '../../src/services/semanticGraphService.js';

function _migratedPragma() {
  return [
    { name: 'source_node_id', pk: 1 },
    { name: 'target_node_id', pk: 2 },
    { name: 'kind', pk: 3 },
    { name: 'direction', pk: 0 },
  ];
}

function createMockDb() {
  const onDidOpen = new Emitter<string>();
  const onDidClose = new Emitter<void>();
  const conceptNodes = new Map<string, any>();
  const conceptNodeMembers: any[] = []; // {concept_id, source_type, source_id}
  const semanticGraphEdges: any[] = [];
  const refreshPassState: any[] = []; // {pass_id, source_type, source_id, last_processed_hash}

  function applyOp(op: { sql: string; params?: any[] }) {
    const s = String(op.sql);
    const p = op.params ?? [];

    if (s.includes('UPDATE concept_nodes SET user_deleted = 1')) {
      const node = conceptNodes.get(p[0]);
      if (node) node.user_deleted = 1;
      return;
    }
    if (s.includes('UPDATE concept_nodes SET label')) {
      const node = conceptNodes.get(p[1]);
      if (node) { node.label = p[0]; node.user_renamed = 1; }
      return;
    }
    if (s.includes('UPDATE concept_nodes') && s.includes('SET member_count')) {
      const node = conceptNodes.get(p[1]);
      if (node) {
        const count = conceptNodeMembers.filter((m) => m.concept_id === p[0]).length;
        node.member_count = count;
      }
      return;
    }
    if (s.includes('DELETE FROM concept_node_members WHERE concept_id')) {
      for (let i = conceptNodeMembers.length - 1; i >= 0; i--) {
        if (conceptNodeMembers[i].concept_id === p[0]) conceptNodeMembers.splice(i, 1);
      }
      return;
    }
    if (s.includes('DELETE FROM concept_node_members') && !s.includes('WHERE')) {
      conceptNodeMembers.length = 0;
      return;
    }
    if (s.includes('DELETE FROM concept_nodes WHERE stable_id')) {
      conceptNodes.delete(p[0]);
      return;
    }
    if (s.includes('DELETE FROM concept_nodes') && !s.includes('WHERE')) {
      conceptNodes.clear();
      return;
    }
    if (s.includes('DELETE FROM semantic_graph_edges') && s.includes("kind = 'member-of'") && s.includes('origin_id')) {
      for (let i = semanticGraphEdges.length - 1; i >= 0; i--) {
        if (semanticGraphEdges[i].kind === 'member-of' && semanticGraphEdges[i].origin_id === p[0]) {
          semanticGraphEdges.splice(i, 1);
        }
      }
      return;
    }
    if (s.includes('DELETE FROM semantic_graph_edges') && s.includes("kind = 'member-of'")) {
      for (let i = semanticGraphEdges.length - 1; i >= 0; i--) {
        if (semanticGraphEdges[i].kind === 'member-of') semanticGraphEdges.splice(i, 1);
      }
      return;
    }
    if (s.includes('DELETE FROM refresh_pass_state') && s.includes("'concept-clustering'")) {
      for (let i = refreshPassState.length - 1; i >= 0; i--) {
        if (refreshPassState[i].pass_id === 'concept-clustering') refreshPassState.splice(i, 1);
      }
      return;
    }
    if (s.includes('INSERT OR IGNORE INTO concept_node_members')) {
      // Move members from one cluster to another, ignoring dup PKs.
      const [survivorId, sourceClusterId] = p;
      const toMove = conceptNodeMembers.filter((m) => m.concept_id === sourceClusterId);
      for (const m of toMove) {
        const exists = conceptNodeMembers.some(
          (n) => n.concept_id === survivorId && n.source_type === m.source_type && n.source_id === m.source_id,
        );
        if (!exists) {
          conceptNodeMembers.push({ concept_id: survivorId, source_type: m.source_type, source_id: m.source_id });
        }
      }
      return;
    }
    if (s.includes('INSERT OR REPLACE INTO semantic_graph_edges') && s.includes('FROM semantic_graph_edges')) {
      // The merge "re-target" SELECT → INSERT. Simulate by re-pointing
      // matching edges at the survivor. Params: [concept:<survivor>,
      // <survivor>, <survivor>, <mergedId>].
      const [, , survivorId, mergedId] = p;
      for (const e of semanticGraphEdges) {
        if (e.kind === 'member-of' && e.origin_id === mergedId) {
          e.target_node_id = `concept:${survivorId}`;
          e.target_id = survivorId;
          e.origin_id = survivorId;
        }
      }
      return;
    }
  }

  return {
    isOpen: true,
    onDidOpen: onDidOpen.event,
    onDidClose: onDidClose.event,
    conceptNodes,
    conceptNodeMembers,
    semanticGraphEdges,
    refreshPassState,
    run: vi.fn(async (sql: string, params?: any[]) => {
      const s = String(sql);
      if (s.includes('CREATE TABLE') || s.includes('CREATE INDEX')) return { changes: 0, lastInsertRowid: 0 };
      applyOp({ sql, params });
      return { changes: 0, lastInsertRowid: 0 };
    }),
    get: vi.fn(async (sql: string, params?: any[]) => {
      const s = String(sql);
      if (s.includes('FROM concept_nodes WHERE stable_id')) {
        return conceptNodes.get((params ?? [])[0]) ?? null;
      }
      return null;
    }),
    all: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes('PRAGMA table_info')) return _migratedPragma();
      return [];
    }),
    runTransaction: vi.fn(async (ops: any[]) => {
      for (const op of ops) applyOp(op);
      return [];
    }),
  };
}

function createMockVectorStore() {
  return {
    onDidUpdateIndex: new Emitter().event,
    upsert: vi.fn(), deleteSource: vi.fn(), search: vi.fn(), vectorSearch: vi.fn(),
    getContentHash: vi.fn(), getIndexedAtMap: vi.fn(),
    getIndexedSources: vi.fn().mockResolvedValue([]),
    getStats: vi.fn(), getDocumentSummaries: vi.fn(), getEmbeddings: vi.fn(),
    getSourceCentroid: vi.fn(), getSourceChunks: vi.fn().mockResolvedValue([]),
    getStructuralCompanions: vi.fn(), purgeAll: vi.fn(), dispose: vi.fn(),
  };
}
function createMockPipeline() {
  return {
    isIndexing: false, progress: { phase: 'idle', processed: 0, total: 0 },
    isInitialIndexComplete: true,
    start: vi.fn(), cancel: vi.fn(), reindexPage: vi.fn(), reindexFile: vi.fn(),
    schedulePageReindex: vi.fn(), scheduleFileReindex: vi.fn(),
    onDidIndexSource: new Emitter().event,
    onDidCompleteInitialIndex: new Emitter().event,
    onDidChangeProgress: new Emitter().event,
    dispose: vi.fn(),
  };
}
function createMockWorkspace() {
  return {
    folders: [{ uri: { toString: () => 'file:///workspace' }, name: 'workspace', index: 0 }],
    dispose: vi.fn(),
  };
}

describe('SemanticGraphService concept curation (M76 Phase 6)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SemanticGraphService;

  beforeEach(() => {
    db = createMockDb();
    service = new SemanticGraphService(
      db as any,
      createMockVectorStore() as any,
      createMockPipeline() as any,
      createMockWorkspace() as any,
    );
  });

  // ── renameConceptNode ─────────────────────────────────────────────

  it('renameConceptNode updates the label and sets user_renamed', async () => {
    db.conceptNodes.set('concept-aaa', {
      stable_id: 'concept-aaa', label: 'OldName', member_count: 3, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    await service.renameConceptNode('concept-aaa', 'My Custom Topic');
    const row = db.conceptNodes.get('concept-aaa');
    expect(row.label).toBe('My Custom Topic');
    expect(row.user_renamed).toBe(1);
  });

  it('renameConceptNode trims whitespace and rejects empty labels', async () => {
    db.conceptNodes.set('concept-aaa', {
      stable_id: 'concept-aaa', label: 'OldName', member_count: 3, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    await service.renameConceptNode('concept-aaa', '   ');
    const row = db.conceptNodes.get('concept-aaa');
    expect(row.label).toBe('OldName'); // unchanged
  });

  it('renameConceptNode truncates labels longer than 100 chars', async () => {
    db.conceptNodes.set('concept-aaa', {
      stable_id: 'concept-aaa', label: 'OldName', member_count: 3, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    const long = 'A'.repeat(200);
    await service.renameConceptNode('concept-aaa', long);
    const row = db.conceptNodes.get('concept-aaa');
    expect(row.label.length).toBe(100);
  });

  // ── deleteConceptNode ─────────────────────────────────────────────

  it('deleteConceptNode sets user_deleted and wipes members + member-of edges', async () => {
    db.conceptNodes.set('concept-aaa', {
      stable_id: 'concept-aaa', label: 'Topic', member_count: 3, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    db.conceptNodeMembers.push(
      { concept_id: 'concept-aaa', source_type: 'page_block', source_id: 'p1' },
      { concept_id: 'concept-aaa', source_type: 'page_block', source_id: 'p2' },
    );
    db.semanticGraphEdges.push(
      { source_node_id: 'page:p1', target_node_id: 'concept:concept-aaa', kind: 'member-of', origin_id: 'concept-aaa' },
      { source_node_id: 'page:p2', target_node_id: 'concept:concept-aaa', kind: 'member-of', origin_id: 'concept-aaa' },
    );

    await service.deleteConceptNode('concept-aaa');

    const row = db.conceptNodes.get('concept-aaa');
    expect(row.user_deleted).toBe(1); // sticky tombstone
    expect(db.conceptNodeMembers.filter((m) => m.concept_id === 'concept-aaa')).toHaveLength(0);
    expect(db.semanticGraphEdges.filter((e) => e.origin_id === 'concept-aaa')).toHaveLength(0);
  });

  // ── mergeConceptNodes ─────────────────────────────────────────────

  it('mergeConceptNodes moves members, retargets edges, deletes merged row', async () => {
    db.conceptNodes.set('concept-survivor', {
      stable_id: 'concept-survivor', label: 'Survivor', member_count: 2, member_hash: 'h',
      user_renamed: 1, user_deleted: 0,
    });
    db.conceptNodes.set('concept-merged', {
      stable_id: 'concept-merged', label: 'Merged', member_count: 2, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    db.conceptNodeMembers.push(
      { concept_id: 'concept-survivor', source_type: 'page_block', source_id: 'a' },
      { concept_id: 'concept-survivor', source_type: 'page_block', source_id: 'b' },
      { concept_id: 'concept-merged', source_type: 'page_block', source_id: 'c' },
      { concept_id: 'concept-merged', source_type: 'page_block', source_id: 'd' },
    );
    db.semanticGraphEdges.push(
      { source_node_id: 'page:c', target_node_id: 'concept:concept-merged', kind: 'member-of', origin_id: 'concept-merged' },
      { source_node_id: 'page:d', target_node_id: 'concept:concept-merged', kind: 'member-of', origin_id: 'concept-merged' },
    );

    await service.mergeConceptNodes('concept-survivor', 'concept-merged');

    // Survivor exists with label intact, count = 4
    const survivor = db.conceptNodes.get('concept-survivor');
    expect(survivor).toBeDefined();
    expect(survivor.label).toBe('Survivor');
    expect(survivor.member_count).toBe(4);
    // Merged is gone (fully removed, not tombstoned)
    expect(db.conceptNodes.has('concept-merged')).toBe(false);
    // Members re-attributed
    const survivorMembers = db.conceptNodeMembers.filter((m) => m.concept_id === 'concept-survivor');
    expect(survivorMembers.map((m) => m.source_id).sort()).toEqual(['a', 'b', 'c', 'd']);
    // Edges retargeted at survivor
    expect(db.semanticGraphEdges.filter((e) => e.origin_id === 'concept-merged')).toHaveLength(0);
    expect(db.semanticGraphEdges.filter((e) => e.target_node_id === 'concept:concept-survivor')).toHaveLength(2);
  });

  it('mergeConceptNodes is a no-op when either id is missing', async () => {
    db.conceptNodes.set('concept-aaa', {
      stable_id: 'concept-aaa', label: 'A', member_count: 2, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    db.conceptNodeMembers.push(
      { concept_id: 'concept-aaa', source_type: 'page_block', source_id: 'a' },
    );

    await service.mergeConceptNodes('concept-aaa', 'concept-missing');
    expect(db.conceptNodes.has('concept-aaa')).toBe(true);
    expect(db.conceptNodes.get('concept-aaa').member_count).toBe(2);
  });

  it('mergeConceptNodes is a no-op when survivor == merged', async () => {
    db.conceptNodes.set('concept-aaa', {
      stable_id: 'concept-aaa', label: 'A', member_count: 2, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    await service.mergeConceptNodes('concept-aaa', 'concept-aaa');
    expect(db.conceptNodes.get('concept-aaa').label).toBe('A');
  });

  // ── forceFullReCluster ────────────────────────────────────────────

  it('forceFullReCluster wipes refresh_pass_state for concept-clustering, all concept rows, and member-of edges', async () => {
    db.conceptNodes.set('concept-keep', {
      stable_id: 'concept-keep', label: 'Topic', member_count: 3, member_hash: 'h',
      user_renamed: 1, user_deleted: 0,
    });
    db.conceptNodes.set('concept-deleted', {
      stable_id: 'concept-deleted', label: 'Gone', member_count: 3, member_hash: 'h',
      user_renamed: 0, user_deleted: 1,
    });
    db.conceptNodeMembers.push({ concept_id: 'concept-keep', source_type: 'page_block', source_id: 'a' });
    db.semanticGraphEdges.push(
      { source_node_id: 'page:a', target_node_id: 'concept:concept-keep', kind: 'member-of', origin_id: 'concept-keep' },
    );
    db.refreshPassState.push(
      { pass_id: 'concept-clustering', source_type: 'page_block', source_id: 'a', last_processed_hash: 'h' },
      { pass_id: 'lineage', source_type: 'page_block', source_id: 'a', last_processed_hash: 'h' },
    );

    await service.forceFullReCluster();

    // All concept rows gone (including user_deleted tombstones)
    expect(db.conceptNodes.size).toBe(0);
    expect(db.conceptNodeMembers).toHaveLength(0);
    // member-of edges gone
    expect(db.semanticGraphEdges.filter((e) => e.kind === 'member-of')).toHaveLength(0);
    // refresh_pass_state for concept-clustering gone, but lineage preserved
    expect(db.refreshPassState.filter((r) => r.pass_id === 'concept-clustering')).toHaveLength(0);
    expect(db.refreshPassState.filter((r) => r.pass_id === 'lineage')).toHaveLength(1);
  });

  // ── change event ──────────────────────────────────────────────────

  it('fires onDidChangeEdges after each curation action', async () => {
    db.conceptNodes.set('concept-aaa', {
      stable_id: 'concept-aaa', label: 'A', member_count: 2, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    db.conceptNodes.set('concept-bbb', {
      stable_id: 'concept-bbb', label: 'B', member_count: 2, member_hash: 'h',
      user_renamed: 0, user_deleted: 0,
    });
    const events: number[] = [];
    service.onDidChangeEdges(() => events.push(1));

    await service.renameConceptNode('concept-aaa', 'Renamed');
    await service.deleteConceptNode('concept-aaa');
    await service.mergeConceptNodes('concept-aaa', 'concept-bbb');
    await service.forceFullReCluster();

    expect(events.length).toBeGreaterThanOrEqual(3);
  });
});
