// similarity.js — how Flashcards tells two cards apart, with no host api.
//
// The thresholds the duplicate scan and the deck sweep use, the text a card
// is embedded as, the bytes a vector is stored as, and the trigram fallback
// for a machine without Ollama. Pure: main.js owns the database and the
// embedding service.

export const FC_EMB_DIMS = 768; // nomic-embed-text v1.5; EmbeddingService hard-validates
export const FC_DUP_SIM_EMBEDDING = 0.88; // cosine similarity flag threshold
export const FC_DUP_SIM_TRIGRAM = 0.5;    // Jaccard 3-gram fallback threshold
// Deck-wide sweep shortlist threshold: recall-biased (lower than the flag
// threshold) because the AI judge arbitrates every candidate cluster.
export const FC_SWEEP_SIM_EMBEDDING = 0.83;

/** The Ollama the embedding service talks to (the `ollama.baseUrl` setting), never a fixed localhost. */
export function fcOllamaVersionUrl(svc) {
  const base = String(svc?.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  return `${base}/api/version`;
}

/** The text a card is embedded as: front, then back, capped. */
export function fcCardEmbedText(front, back) {
  return `${String(front || '').trim()}\n${String(back || '').trim()}`.slice(0, 4000);
}

/** Standalone byte copy — IPC structured clone can misalign shared buffers. */
export function fcVecBlob(vec) {
  return new Uint8Array(new Float32Array(vec).buffer.slice(0));
}

/** 3-gram Jaccard similarity — the no-Ollama fallback. */
export function fcTrigramSimilarity(a, b) {
  const grams = (s) => {
    const norm = String(s || '').toLowerCase().replace(/[^a-z0-9$\\]+/g, ' ').replace(/\s+/g, ' ').trim();
    const set = new Set();
    for (let i = 0; i <= norm.length - 3; i++) set.add(norm.slice(i, i + 3));
    return set;
  };
  const ga = grams(a), gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}
