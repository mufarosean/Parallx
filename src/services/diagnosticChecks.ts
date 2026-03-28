// D3: Diagnostic check producers — extracted from D2 /doctor + extended checks
// Each producer is a pure function: deps → Promise<IDiagnosticResult>

import type { IDiagnosticCheckProducer } from './serviceTypes.js';

// ── Core checks (extracted from D2 /doctor inline checks) ───────────────────

const checkOllamaConnection: IDiagnosticCheckProducer = async (deps) => {
  const status = await deps.checkProviderStatus?.().catch(() => ({ available: false, error: 'Check failed' } as const));
  const version = status && 'version' in status ? status.version : undefined;
  const error = status && 'error' in status ? status.error : undefined;
  return {
    name: 'Ollama Connection',
    status: status?.available ? 'pass' : 'fail',
    detail: status?.available
      ? `Connected${version ? ` (v${version})` : ''}`
      : error ?? 'Cannot reach Ollama at localhost:11434',
    timestamp: Date.now(),
    category: 'connection',
  };
};

const checkActiveModel: IDiagnosticCheckProducer = async (deps) => {
  const model = deps.getActiveModel?.();
  return {
    name: 'Active Model',
    status: model ? 'pass' : 'fail',
    detail: model ?? 'No model selected',
    timestamp: Date.now(),
    category: 'model',
  };
};

const checkModelAvailable: IDiagnosticCheckProducer = async (deps) => {
  const model = deps.getActiveModel?.();
  if (!model || !deps.listModels) {
    return { name: 'Model Available', status: 'warn', detail: 'Cannot verify — no model or listModels unavailable', timestamp: Date.now(), category: 'model' };
  }
  const models = await deps.listModels().catch(() => []);
  const found = models.some(m => m.id === model || m.name === model);
  return {
    name: 'Model Available',
    status: found ? 'pass' : 'fail',
    detail: found ? `${model} is installed` : `${model} not found (run: ollama pull ${model})`,
    timestamp: Date.now(),
    category: 'model',
  };
};

const checkRAGEngine: IDiagnosticCheckProducer = async (deps) => {
  const available = deps.isRAGAvailable?.() ?? false;
  const indexing = deps.isIndexing?.() ?? false;
  return {
    name: 'RAG Engine',
    status: available ? 'pass' : 'warn',
    detail: available
      ? indexing ? 'Available (indexing in progress)' : 'Available and idle'
      : 'Not available — workspace retrieval will be limited',
    timestamp: Date.now(),
    category: 'rag',
  };
};

const checkFileIndex: IDiagnosticCheckProducer = async (deps) => {
  const count = await deps.getFileCount?.().catch(() => 0) ?? 0;
  return {
    name: 'File Index',
    status: count > 0 ? 'pass' : 'warn',
    detail: count > 0 ? `${count} files indexed` : 'No files indexed yet',
    timestamp: Date.now(),
    category: 'rag',
  };
};

const checkWorkspace: IDiagnosticCheckProducer = async (deps) => {
  const name = deps.getWorkspaceName();
  return {
    name: 'Workspace',
    status: name ? 'pass' : 'warn',
    detail: name ? `Workspace: ${name}` : 'No workspace open',
    timestamp: Date.now(),
    category: 'workspace',
  };
};

const checkBootstrap: IDiagnosticCheckProducer = async (deps) => {
  if (!deps.existsRelative) {
    return { name: 'Bootstrap (AGENTS.md)', status: 'warn', detail: 'Cannot check — existsRelative unavailable', timestamp: Date.now(), category: 'workspace' };
  }
  const found = await deps.existsRelative('.parallx/AGENTS.md').catch(() => false);
  return {
    name: 'Bootstrap (AGENTS.md)',
    status: found ? 'pass' : 'warn',
    detail: found ? 'Found' : 'Missing — run /init to generate',
    timestamp: Date.now(),
    category: 'workspace',
  };
};

const checkContextWindow: IDiagnosticCheckProducer = async (deps) => {
  const length = deps.getModelContextLength?.() ?? 0;
  return {
    name: 'Context Window',
    status: length > 0 ? 'pass' : 'warn',
    detail: length > 0 ? `${(length / 1024).toFixed(0)}K tokens` : 'Unknown (model info unavailable)',
    timestamp: Date.now(),
    category: 'model',
  };
};

const checkConfiguration: IDiagnosticCheckProducer = async (deps) => {
  const config = deps.getEffectiveConfig?.();
  return {
    name: 'Configuration',
    status: config ? 'pass' : 'warn',
    detail: config ? 'Unified config loaded' : 'Using defaults',
    timestamp: Date.now(),
    category: 'config',
  };
};

// ── Extended checks (D3 additions) ──────────────────────────────────────────

const checkEmbeddingModel: IDiagnosticCheckProducer = async (deps) => {
  if (!deps.checkEmbedding) {
    return { name: 'Embedding Model', status: 'warn', detail: 'Check unavailable', timestamp: Date.now(), category: 'rag' };
  }
  const ok = await deps.checkEmbedding().catch(() => false);
  return {
    name: 'Embedding Model',
    status: ok ? 'pass' : 'fail',
    detail: ok ? 'nomic-embed-text responding' : 'Embedding model unavailable (run: ollama pull nomic-embed-text)',
    timestamp: Date.now(),
    category: 'rag',
  };
};

const checkVectorStore: IDiagnosticCheckProducer = async (deps) => {
  if (!deps.checkVectorStore) {
    return { name: 'Vector Store', status: 'warn', detail: 'Check unavailable', timestamp: Date.now(), category: 'rag' };
  }
  const ok = await deps.checkVectorStore().catch(() => false);
  return {
    name: 'Vector Store (sqlite-vec)',
    status: ok ? 'pass' : 'fail',
    detail: ok ? 'sqlite-vec operational' : 'Vector store not responding',
    timestamp: Date.now(),
    category: 'rag',
  };
};

const checkDocumentExtraction: IDiagnosticCheckProducer = async (deps) => {
  if (!deps.checkDocumentExtraction) {
    return { name: 'Document Extraction', status: 'warn', detail: 'Check unavailable', timestamp: Date.now(), category: 'rag' };
  }
  const ok = await deps.checkDocumentExtraction().catch(() => false);
  return {
    name: 'Document Extraction (Docling)',
    status: ok ? 'pass' : 'warn',
    detail: ok ? 'Docling bridge available' : 'Docling not available — PDF extraction limited',
    timestamp: Date.now(),
    category: 'rag',
  };
};

const checkMemoryService: IDiagnosticCheckProducer = async (deps) => {
  if (!deps.checkMemoryService) {
    return { name: 'Memory Service', status: 'warn', detail: 'Check unavailable', timestamp: Date.now(), category: 'config' };
  }
  const ok = await deps.checkMemoryService().catch(() => false);
  return {
    name: 'Memory Service',
    status: ok ? 'pass' : 'warn',
    detail: ok ? 'Conversation memory operational' : 'Memory service not available',
    timestamp: Date.now(),
    category: 'config',
  };
};

// ── Export all check producers ──────────────────────────────────────────────

export const CORE_DIAGNOSTIC_CHECKS: readonly IDiagnosticCheckProducer[] = [
  checkOllamaConnection,
  checkActiveModel,
  checkModelAvailable,
  checkRAGEngine,
  checkFileIndex,
  checkWorkspace,
  checkBootstrap,
  checkContextWindow,
  checkConfiguration,
];

export const EXTENDED_DIAGNOSTIC_CHECKS: readonly IDiagnosticCheckProducer[] = [
  checkEmbeddingModel,
  checkVectorStore,
  checkDocumentExtraction,
  checkMemoryService,
];

export const ALL_DIAGNOSTIC_CHECKS: readonly IDiagnosticCheckProducer[] = [
  ...CORE_DIAGNOSTIC_CHECKS,
  ...EXTENDED_DIAGNOSTIC_CHECKS,
];
