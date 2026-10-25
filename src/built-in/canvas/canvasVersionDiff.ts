// canvasVersionDiff.ts — what one saved version of a page changed, block by
// block: the version history's summaries and its marked-up preview.
//
// Top-level blocks are matched by their stable id (UniqueID), or by their
// content when a block has none, through a longest common subsequence, so a
// block that moved, stayed or changed reads as itself and not as one removed
// plus one added.

export interface DocNode {
  readonly type?: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly DocNode[];
  readonly text?: string;
}

export type BlockChange = 'same' | 'added' | 'changed' | 'removed';

export interface IBlockDiffRow {
  readonly node: DocNode;
  readonly change: BlockChange;
}

export interface IVersionSummary {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  /** Words in this version less words in the one before. */
  readonly wordDelta: number;
}

const blockId = (n: DocNode): string | null => {
  const id = n.attrs?.id;
  return typeof id === 'string' && id ? id : null;
};

/** The block's content, without its id: what "changed" compares. */
const contentKey = (n: DocNode): string => JSON.stringify(n, (k, v) => (k === 'id' ? undefined : v));

const identity = (n: DocNode): string => blockId(n) ?? `content:${contentKey(n)}`;

/** The text of a node and everything under it. */
export function nodeText(n: DocNode | undefined): string {
  if (!n) return '';
  if (typeof n.text === 'string') return n.text;
  return (n.content ?? []).map(nodeText).join(' ');
}

export function wordCount(doc: DocNode | undefined): number {
  const t = nodeText(doc).trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * The blocks of `after` in order, each marked against `before`, with the
 * blocks `before` had and `after` lost put back where they stood.
 */
export function diffBlocks(before: DocNode | undefined, after: DocNode | undefined): IBlockDiffRow[] {
  const a = before?.content ?? [];
  const b = after?.content ?? [];
  const ka = a.map(identity);
  const kb = b.map(identity);
  // LCS table over identities (a page is at most a few thousand blocks).
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: IBlockDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ka[i] === kb[j]) {
      rows.push({ node: b[j], change: contentKey(a[i]) === contentKey(b[j]) ? 'same' : 'changed' });
      i++; j++;
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      rows.push({ node: b[j], change: 'added' });
      j++;
    } else {
      rows.push({ node: a[i], change: 'removed' });
      i++;
    }
  }
  return rows;
}

export function summarize(before: DocNode | undefined, after: DocNode | undefined): IVersionSummary {
  const rows = diffBlocks(before, after);
  const count = (c: BlockChange): number => rows.filter((r) => r.change === c).length;
  return { added: count('added'), changed: count('changed'), removed: count('removed'), wordDelta: wordCount(after) - wordCount(before) };
}

const blocks = (n: number): string => (n === 1 ? '1 block' : `${n} blocks`);

/** One short line for a list row: "+2 blocks · 1 edited · 1 removed". */
export function summaryChip(s: IVersionSummary): string {
  const parts = [
    s.added ? `+${blocks(s.added)}` : '',
    s.changed ? `${s.changed} edited` : '',
    s.removed ? `${s.removed} removed` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No change to the text';
}

/** The sentence over the preview: "Added 2 blocks, edited 1 and removed 1. 48 words more." */
export function summarySentence(s: IVersionSummary): string {
  const parts = [
    s.added ? `added ${blocks(s.added)}` : '',
    s.changed ? `edited ${s.changed === 1 ? '1' : s.changed}` : '',
    s.removed ? `removed ${s.removed}` : '',
  ].filter(Boolean);
  const words = s.wordDelta === 0 ? '' : ` ${Math.abs(s.wordDelta)} ${Math.abs(s.wordDelta) === 1 ? 'word' : 'words'} ${s.wordDelta > 0 ? 'more' : 'fewer'}.`;
  if (parts.length === 0) return words ? `Text unchanged in structure.${words}` : 'No change to the text (formatting or settings only).';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.${words}`;
}
