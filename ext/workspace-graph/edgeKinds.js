// edgeKinds.js — the kinds of edge the graph draws, and how each looks.
//
// Rendering, settings and the semantic graph service all key off these
// names, so they live in one place.
export const EDGE_KINDS = [
  'similar-to', 'references', 'co-occurrence',
  'same-folder', 'same-author', 'same-date',
  'extends', 'refutes', 'member-of',
];

export const EDGE_KIND_LABEL = {
  'similar-to':    'Similarity',
  'references':    'References',
  'co-occurrence': 'Co-occurrence',
  'same-folder':   'Same folder',
  'same-author':   'Same author',
  'same-date':     'Same date',
  'extends':       'Extends',
  'refutes':       'Refutes',
  'member-of':     'Concept membership',
};

// Per-kind visual treatment, keyed by edge.kind.
export const EDGE_KIND_RGB = {
  'similar-to':    '126,196,244',
  'references':    '167,230,168',
  'co-occurrence': '240,198,116',
  'same-folder':   '180,180,180',
  'same-author':   '180,180,180',
  'same-date':     '180,180,180',
  'extends':       '200,130,230',
  'refutes':       '230,130,130',
  'member-of':     '255,192,100',
};

export const EDGE_KIND_DASH = {
  'similar-to':    [4, 4],
  'references':    [],
  'co-occurrence': [2, 3],
  'same-folder':   [1, 6],
  'same-author':   [1, 6],
  'same-date':     [1, 6],
  'extends':       [],
  'refutes':       [6, 3],
  'member-of':     [],
};

// True if the edge kind is a "concept edge" — anything from the semantic
// graph service, as opposed to structural workspace edges (file tree,
// canvas page hierarchy). Used in places that need to distinguish concept
// edges from structural ones for force-strength and rendering decisions.
export function isConceptEdge(kind) {
  return typeof kind === 'string' && EDGE_KINDS.indexOf(kind) >= 0;
}
