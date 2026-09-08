// practiceSession.ts — Worksheets: ADAPT-style practice sessions. PURE
// selection logic (unit-tested); the pane layer owns UI and serving.
//
// A session is a filtered, optionally shuffled slice of the item bank:
// pick tags (ANY match), an attempt-state focus (everything / never tried /
// missed or partial), a count, shuffle — work the items one after another,
// finish with a summary of the grades earned.

export interface PracticeFilters {
  /** Selected tags — an item qualifies when it carries ANY of them.
   *  Empty = all items. The Problem Bank tags every problem with its paper,
   *  source (rf, cas, custom) and kind (quant, qual, essay), so those are
   *  tag filters too. */
  readonly tags: readonly string[];
  /** 'all' | 'unseen' (never attempted) | 'struggling' (last rating Hard or
   *  Medium, or open) | 'easy' | 'medium' | 'hard' (last rating exactly that)
   *  | 'incomplete' (never attempted or open, the workbook's "Incomplete"). */
  readonly state: string;
  readonly count: number;
  readonly shuffle: boolean;
  /** Problem Bank groups, ANY within a group and ALL groups must pass.
   *  Empty or absent = no restriction on that axis. An item with no source
   *  counts as 'generated'. */
  readonly papers?: readonly string[];
  readonly sources?: readonly string[];
  readonly kinds?: readonly string[];
}

interface ItemLike {
  readonly id: number;
  readonly tags: string;
  readonly attemptState: string;
  readonly attemptCount: number;
  readonly paper?: string;
  readonly source?: string;
  readonly kind?: string;
}

export function itemTags(tags: string): string[] {
  return String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);
}

/** Tag → item count over the bank (for the filter chips). */
export function tagCounts(items: readonly ItemLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const t of itemTags(item.tags)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

/**
 * Build the ordered id list for a session. `rng` is injectable for
 * deterministic tests (Fisher-Yates when shuffling; bank order otherwise).
 */
export function buildPracticeSet(
  items: readonly ItemLike[],
  filters: PracticeFilters,
  rng: () => number = Math.random,
): number[] {
  let pool = [...items];
  if (filters.tags.length > 0) {
    const wanted = new Set(filters.tags);
    pool = pool.filter((i) => itemTags(i.tags).some((t) => wanted.has(t)));
  }
  if (filters.papers && filters.papers.length > 0) {
    const wanted = new Set(filters.papers);
    pool = pool.filter((i) => wanted.has(i.paper ?? ''));
  }
  if (filters.sources && filters.sources.length > 0) {
    const wanted = new Set(filters.sources);
    pool = pool.filter((i) => wanted.has(i.source || 'generated'));
  }
  if (filters.kinds && filters.kinds.length > 0) {
    const wanted = new Set(filters.kinds);
    pool = pool.filter((i) => wanted.has(i.kind ?? ''));
  }
  const rating = (i: ItemLike): string => {
    const s = i.attemptState;
    return s === 'nailed' ? 'easy' : s === 'partial' ? 'medium' : s === 'missed' ? 'hard' : s;
  };
  if (filters.state === 'unseen') {
    pool = pool.filter((i) => i.attemptCount === 0 && i.attemptState !== 'open');
  } else if (filters.state === 'struggling') {
    pool = pool.filter((i) => { const r = rating(i); return r === 'hard' || r === 'medium' || r === 'open'; });
  } else if (filters.state === 'incomplete') {
    pool = pool.filter((i) => i.attemptCount === 0 || i.attemptState === 'open');
  } else if (filters.state === 'easy' || filters.state === 'medium' || filters.state === 'hard') {
    pool = pool.filter((i) => rating(i) === filters.state);
  }
  const ids = pool.map((i) => i.id);
  if (filters.shuffle) {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  const n = Math.floor(filters.count);
  const count = n > 0 ? n : 10; // non-positive/NaN → the default length
  return ids.slice(0, count);
}
