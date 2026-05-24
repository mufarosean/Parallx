// diagnosticChecks.test.ts — pin diagnostic producer contracts.
//
// Pins:
//   - exported arrays compose correctly: ALL = CORE + EXTENDED (no overlap)
//   - each producer in ALL is a function and resolves to a result with the right shape
//   - status mapping for each check given representative dep responses
//   - missing-dep paths emit 'warn' with "Check unavailable" / "not wired" detail
//   - error-swallow paths (Promise rejections via .catch) downgrade to fail/warn
//     rather than throwing the entire producer
//   - Observability: turnCount=0 → pass; avgDurationMs>30000 → warn

import { describe, it, expect } from 'vitest';
import {
  CORE_DIAGNOSTIC_CHECKS,
  EXTENDED_DIAGNOSTIC_CHECKS,
  ALL_DIAGNOSTIC_CHECKS,
} from '../../src/services/diagnosticChecks';

const baseDeps = {
  getWorkspaceName: () => 'wkspc',
} as any;

async function runByName(name: string, deps: any) {
  for (const p of ALL_DIAGNOSTIC_CHECKS) {
    const r = await p(deps);
    if (r.name === name || r.name.startsWith(name)) return r;
  }
  throw new Error(`producer for ${name} not found`);
}

describe('diagnosticChecks — exported arrays', () => {
  it('ALL = CORE + EXTENDED (length and identity-preserving)', () => {
    expect(ALL_DIAGNOSTIC_CHECKS.length).toBe(
      CORE_DIAGNOSTIC_CHECKS.length + EXTENDED_DIAGNOSTIC_CHECKS.length,
    );
    for (const p of CORE_DIAGNOSTIC_CHECKS) {
      expect(ALL_DIAGNOSTIC_CHECKS.includes(p)).toBe(true);
    }
    for (const p of EXTENDED_DIAGNOSTIC_CHECKS) {
      expect(ALL_DIAGNOSTIC_CHECKS.includes(p)).toBe(true);
    }
  });

  it('every producer is a function and resolves to a well-shaped result', async () => {
    for (const p of ALL_DIAGNOSTIC_CHECKS) {
      expect(typeof p).toBe('function');
      const r = await p(baseDeps);
      expect(typeof r.name).toBe('string');
      expect(['pass', 'fail', 'warn']).toContain(r.status);
      expect(typeof r.detail).toBe('string');
      expect(typeof r.timestamp).toBe('number');
    }
  });
});

describe('diagnosticChecks — Ollama Connection', () => {
  it('pass when checkProviderStatus reports available', async () => {
    const r = await runByName('Ollama Connection', {
      ...baseDeps,
      checkProviderStatus: async () => ({ available: true, version: '0.1.2' }),
    });
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/Connected/);
    expect(r.detail).toMatch(/0\.1\.2/);
  });

  it('fail with error detail when unavailable', async () => {
    const r = await runByName('Ollama Connection', {
      ...baseDeps,
      checkProviderStatus: async () => ({ available: false, error: 'ECONNREFUSED' }),
    });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/ECONNREFUSED/);
  });

  it('fail-safe when checkProviderStatus throws', async () => {
    const r = await runByName('Ollama Connection', {
      ...baseDeps,
      checkProviderStatus: async () => {
        throw new Error('boom');
      },
    });
    expect(r.status).toBe('fail');
  });
});

describe('diagnosticChecks — Active Model + Model Available', () => {
  it('Active Model fails when getActiveModel returns undefined', async () => {
    const r = await runByName('Active Model', baseDeps);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/No model selected/);
  });

  it('Active Model passes when a model is set', async () => {
    const r = await runByName('Active Model', { ...baseDeps, getActiveModel: () => 'llama3' });
    expect(r.status).toBe('pass');
    expect(r.detail).toBe('llama3');
  });

  it('Model Available passes when active model exists in listModels', async () => {
    const r = await runByName('Model Available', {
      ...baseDeps,
      getActiveModel: () => 'llama3',
      listModels: async () => [{ id: 'llama3', name: 'llama3' }],
    });
    expect(r.status).toBe('pass');
  });

  it('Model Available fails when active model not in listModels', async () => {
    const r = await runByName('Model Available', {
      ...baseDeps,
      getActiveModel: () => 'llama3',
      listModels: async () => [{ id: 'other', name: 'other' }],
    });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/not found/);
  });

  it('Model Available warns when active model missing', async () => {
    const r = await runByName('Model Available', baseDeps);
    expect(r.status).toBe('warn');
  });
});

describe('diagnosticChecks — RAG + File Index', () => {
  it('RAG Engine: pass when available + idle; pass with "indexing in progress" when indexing', async () => {
    const idle = await runByName('RAG Engine', {
      ...baseDeps,
      isRAGAvailable: () => true,
      isIndexing: () => false,
    });
    expect(idle.status).toBe('pass');
    expect(idle.detail).toMatch(/idle/);

    const busy = await runByName('RAG Engine', {
      ...baseDeps,
      isRAGAvailable: () => true,
      isIndexing: () => true,
    });
    expect(busy.status).toBe('pass');
    expect(busy.detail).toMatch(/indexing in progress/);
  });

  it('RAG Engine: warn when unavailable', async () => {
    const r = await runByName('RAG Engine', baseDeps);
    expect(r.status).toBe('warn');
  });

  it('File Index: warn at 0, pass at >0', async () => {
    const zero = await runByName('File Index', { ...baseDeps, getFileCount: async () => 0 });
    expect(zero.status).toBe('warn');
    const some = await runByName('File Index', { ...baseDeps, getFileCount: async () => 42 });
    expect(some.status).toBe('pass');
    expect(some.detail).toMatch(/42 files indexed/);
  });
});

describe('diagnosticChecks — Workspace + Bootstrap', () => {
  it('Workspace: pass with name, warn when empty', async () => {
    const ok = await runByName('Workspace', baseDeps);
    expect(ok.status).toBe('pass');
    expect(ok.detail).toMatch(/wkspc/);
    const empty = await runByName('Workspace', { ...baseDeps, getWorkspaceName: () => '' });
    expect(empty.status).toBe('warn');
  });

  it('Bootstrap: warn when existsRelative not provided', async () => {
    const r = await runByName('Bootstrap', baseDeps);
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/unavailable/);
  });

  it('Bootstrap: pass when AGENTS.md present', async () => {
    const r = await runByName('Bootstrap', {
      ...baseDeps,
      existsRelative: async (p: string) => p === '.parallx/AGENTS.md',
    });
    expect(r.status).toBe('pass');
  });

  it('Bootstrap: warn when AGENTS.md absent', async () => {
    const r = await runByName('Bootstrap', { ...baseDeps, existsRelative: async () => false });
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/Missing/);
  });
});

describe('diagnosticChecks — Context Window + Configuration', () => {
  it('Context Window: warn at 0, pass when >0 with K rendering', async () => {
    const warn = await runByName('Context Window', baseDeps);
    expect(warn.status).toBe('warn');
    const pass = await runByName('Context Window', {
      ...baseDeps,
      getModelContextLength: () => 4096,
    });
    expect(pass.status).toBe('pass');
    expect(pass.detail).toMatch(/4K tokens/);
  });

  it('Configuration: pass when getEffectiveConfig returns truthy, warn otherwise', async () => {
    const pass = await runByName('Configuration', {
      ...baseDeps,
      getEffectiveConfig: () => ({ any: 'thing' }),
    });
    expect(pass.status).toBe('pass');
    const warn = await runByName('Configuration', baseDeps);
    expect(warn.status).toBe('warn');
  });
});

describe('diagnosticChecks — Extended: Embedding / Vector / Docling / Memory', () => {
  it('Embedding Model: warn when no checkEmbedding', async () => {
    const r = await runByName('Embedding Model', baseDeps);
    expect(r.status).toBe('warn');
  });

  it('Embedding Model: pass when checkEmbedding true, includes dimensions', async () => {
    const r = await runByName('Embedding Model', {
      ...baseDeps,
      checkEmbedding: async () => true,
      getEmbeddingModelInfo: () => ({ name: 'nomic', dimensions: 768, installed: true }),
    });
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/768d/);
  });

  it('Embedding Model: fail when checkEmbedding false', async () => {
    const r = await runByName('Embedding Model', {
      ...baseDeps,
      checkEmbedding: async () => false,
    });
    expect(r.status).toBe('fail');
  });

  it('Vector Store: fail when checkVectorStore returns false; pass when true', async () => {
    const fail = await runByName('Vector Store', {
      ...baseDeps,
      checkVectorStore: async () => false,
    });
    expect(fail.status).toBe('fail');
    const pass = await runByName('Vector Store', {
      ...baseDeps,
      checkVectorStore: async () => true,
    });
    expect(pass.status).toBe('pass');
  });

  it('Document Extraction: pass when checkDocumentExtraction true, warn otherwise', async () => {
    const pass = await runByName('Document Extraction', {
      ...baseDeps,
      checkDocumentExtraction: async () => true,
    });
    expect(pass.status).toBe('pass');
    const warn = await runByName('Document Extraction', {
      ...baseDeps,
      checkDocumentExtraction: async () => false,
    });
    expect(warn.status).toBe('warn');
  });

  it('Memory Service: pass true, warn false, warn-absent', async () => {
    const absent = await runByName('Memory Service', baseDeps);
    expect(absent.status).toBe('warn');
    const ok = await runByName('Memory Service', {
      ...baseDeps,
      checkMemoryService: async () => true,
    });
    expect(ok.status).toBe('pass');
    const bad = await runByName('Memory Service', {
      ...baseDeps,
      checkMemoryService: async () => false,
    });
    expect(bad.status).toBe('warn');
  });
});

describe('diagnosticChecks — Observability', () => {
  it('warn when getObservabilityMetrics not wired', async () => {
    const r = await runByName('Observability', baseDeps);
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/not wired/);
  });

  it('pass when turnCount === 0', async () => {
    const r = await runByName('Observability', {
      ...baseDeps,
      getObservabilityMetrics: () => ({ turnCount: 0, avgDurationMs: 0 }),
    });
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/no turns recorded yet/);
  });

  it('warn when avgDurationMs > 30000', async () => {
    const r = await runByName('Observability', {
      ...baseDeps,
      getObservabilityMetrics: () => ({ turnCount: 5, avgDurationMs: 30001 }),
    });
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/slow responses/);
  });

  it('pass when avgDurationMs <= 30000', async () => {
    const r = await runByName('Observability', {
      ...baseDeps,
      getObservabilityMetrics: () => ({ turnCount: 5, avgDurationMs: 1000 }),
    });
    expect(r.status).toBe('pass');
    expect(r.detail).not.toMatch(/slow responses/);
  });
});
