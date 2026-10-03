// structuralRepair.ts — active, production structural normalization (M85)
//
// The dev-only structuralInvariantPlugin DETECTS malformed composite blocks but
// never fixes them, so in production an off-schema shape from a drag / delete /
// paste / AI edit just stays broken. This plugin REPAIRS them on every
// doc-changing transaction — the production sibling of columnAutoDissolve,
// covering the block types columns already handle plus the ones that had
// detection-only: details, toggleHeading, callout, table, pageBlock.
//
// Every repair is conservative and content-preserving: clamp a value, insert a
// required child, or rebuild a broken toggle from all of its parts, so the
// user's text is never dropped.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';

// Loosely typed (matches columnInvariants.ts house style) to avoid PM generic
// friction across the editor/state boundary.
type AnyTr = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const VALID_TOGGLE_LEVELS = [1, 2, 3];

/** Re-read the node originally at `origPos` after prior edits, via mapping. */
function nodeAtMapped(tr: AnyTr, origPos: number): { pos: number; node: PMNode | null } {
  const pos = tr.mapping.map(origPos, -1);
  return { pos, node: tr.doc.nodeAt(pos) };
}

/**
 * A malformed toggle (details / toggleHeading) rebuilt as a VALID one from
 * all of its parts: the first title child stays the title, every
 * detailsContent's blocks and every stray block become the body, and any
 * extra title-like child becomes a paragraph in the body.  The old repair
 * unwrapped the toggle to its body alone, so its title and any stray block
 * (an AI insert beside the title was enough) were deleted (C7).  When the
 * rebuild still can't be made valid, the parts are released in place — title
 * first — never dropped.
 */
function rebuildToggle(schema: any, node: PMNode): Fragment {
  const isHeading = node.type.name === 'toggleHeading';
  const titleType = schema.nodes[isHeading ? 'toggleHeadingText' : 'detailsSummary'];
  const contentType = schema.nodes.detailsContent;
  let title: PMNode | null = null;
  const body: PMNode[] = [];
  node.forEach((child) => {
    const name = child.type.name;
    if (name === 'detailsContent') {
      child.forEach((b) => body.push(b));
    } else if (child.type === titleType && !title) {
      title = child;
    } else if (child.isTextblock || name === 'detailsSummary' || name === 'toggleHeadingText') {
      body.push(schema.nodes.paragraph.create(null, child.content));
    } else if (child.isBlock) {
      body.push(child);
    } else if (child.isInline) {
      body.push(schema.nodes.paragraph.create(null, child));
    }
  });
  const titleNode = (title as PMNode | null) ?? titleType.create();
  try {
    const rebuilt = node.type.createChecked(node.attrs, [
      titleType.createChecked(titleNode.attrs, titleNode.content),
      contentType.createChecked(null, body.length > 0 ? body : [schema.nodes.paragraph.create()]),
    ]);
    return Fragment.from(rebuilt);
  } catch {
    const titleBlock = isHeading && schema.nodes.heading
      ? schema.nodes.heading.create({ level: node.attrs?.level ?? 1 }, titleNode.content)
      : schema.nodes.paragraph.create(null, titleNode.textContent ? schema.text(titleNode.textContent) : null);
    return Fragment.from([titleBlock, ...body]);
  }
}

/**
 * Apply structural repairs to `tr` in place. Returns true if anything changed.
 * Collect-then-reverse-apply (like dissolveOrphanedColumnLists) so positions
 * stay valid as we edit.
 */
export function applyStructuralRepairs(tr: AnyTr): boolean {
  const schema = tr.doc.type.schema;
  const before = tr.steps.length;

  // Collect every candidate position in document order.
  const targets: { pos: number; kind: string }[] = [];
  tr.doc.descendants((node: PMNode, pos: number) => {
    const name = node.type.name;
    if (name === 'callout' && node.childCount === 0) targets.push({ pos, kind: 'callout-empty' });
    else if (name === 'table' && node.childCount === 0) targets.push({ pos, kind: 'table-empty' });
    else if (name === 'pageBlock') {
      const id = node.attrs?.pageId;
      if (!id || (typeof id === 'string' && id.trim() === '')) targets.push({ pos, kind: 'pageBlock-targetless' });
    } else if (name === 'toggleHeading') {
      const okChildren = node.childCount === 2
        && node.child(0).type.name === 'toggleHeadingText'
        && node.child(1).type.name === 'detailsContent';
      if (!okChildren) targets.push({ pos, kind: 'toggle-malformed' });
      else if (!VALID_TOGGLE_LEVELS.includes(node.attrs?.level)) targets.push({ pos, kind: 'toggle-level' });
    } else if (name === 'details') {
      const okChildren = node.childCount === 2
        && node.child(0).type.name === 'detailsSummary'
        && node.child(1).type.name === 'detailsContent';
      if (!okChildren) targets.push({ pos, kind: 'details-malformed' });
    } else if (name === 'detailsSummary') {
      targets.push({ pos, kind: 'check-summary-orphan' });
    } else if (name === 'detailsContent') {
      targets.push({ pos, kind: 'check-content-orphan' });
    }
  });

  // Apply deepest/last first so earlier positions remain valid.
  for (let i = targets.length - 1; i >= 0; i--) {
    const { pos: origPos, kind } = targets[i];
    const { pos, node } = nodeAtMapped(tr, origPos);
    if (!node) continue;

    switch (kind) {
      case 'callout-empty': {
        if (node.type.name !== 'callout' || node.childCount !== 0) break;
        const p = schema.nodes.paragraph.createAndFill();
        if (p) tr.insert(pos + 1, p);
        break;
      }
      case 'table-empty': {
        if (node.type.name !== 'table' || node.childCount !== 0) break;
        tr.delete(pos, pos + node.nodeSize);
        break;
      }
      case 'pageBlock-targetless': {
        if (node.type.name !== 'pageBlock') break;
        tr.delete(pos, pos + node.nodeSize);
        break;
      }
      case 'toggle-level': {
        if (node.type.name !== 'toggleHeading') break;
        const lvl = node.attrs?.level;
        const clamped = typeof lvl === 'number' ? Math.min(3, Math.max(1, Math.round(lvl))) : 1;
        if (clamped !== lvl) tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: clamped });
        break;
      }
      case 'toggle-malformed':
      case 'details-malformed': {
        const expect = kind === 'toggle-malformed' ? 'toggleHeading' : 'details';
        if (node.type.name !== expect) break;
        tr.replaceWith(pos, pos + node.nodeSize, rebuildToggle(schema, node));
        break;
      }
      case 'check-summary-orphan': {
        if (node.type.name !== 'detailsSummary') break;
        const parent = tr.doc.resolve(pos).parent;
        if (parent && parent.type.name === 'details') break; // valid
        // Orphan summary → a paragraph of its inline content.
        tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.paragraph.create(null, node.content));
        break;
      }
      case 'check-content-orphan': {
        if (node.type.name !== 'detailsContent') break;
        const parent = tr.doc.resolve(pos).parent;
        const pn = parent?.type.name;
        if (pn === 'details' || pn === 'toggleHeading') break; // valid
        // Orphan content → its block children, lifted in place.
        const frag = node.childCount > 0 ? node.content : Fragment.from(schema.nodes.paragraph.createAndFill());
        tr.replaceWith(pos, pos + node.nodeSize, frag);
        break;
      }
    }
  }

  return tr.steps.length > before;
}

/**
 * Production normalizer. Runs after every doc-changing transaction and repairs
 * malformed composite blocks. Pairs with the dev-only structuralInvariantPlugin
 * (which asserts loudly) — this one heals quietly everywhere.
 */
export function structuralRepairPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('canvasStructuralRepair'),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((t) => t.docChanged)) return null;
      const tr = newState.tr;
      const changed = applyStructuralRepairs(tr);
      return changed ? tr : null;
    },
  });
}
