// blockUnit.ts — THE single definition of the canvas interaction unit
//
// "Which block am I operating on?" must have exactly one answer, shared by
// every subsystem (drag handle, selection, marquee, action menu, keyboard,
// drop targeting).  Historically each subsystem re-derived it with its own
// walk — six divergent resolvers whose disagreements were the root cause of
// the nested-block bug class (marquee selecting the whole parent, Turn Into
// missing on nested rows, equation blocks losing their handle in columns).
//
// The unit semantics (docs/canvas/CANVAS_STRUCTURAL_MODEL.md):
//   • a list row (listItem / taskItem) is a unit — the innermost row wins;
//   • an atom block (mathBlock, image, …) is a unit;
//   • otherwise the nearest page-container's direct child is the unit;
//   • list wrappers, columnList, and column are structurally transparent —
//     they are never units themselves.
//
// Three entry points, one model:
//   resolveBlockUnit($pos)                — ProseMirror position (canonical)
//   resolveBlockUnitFromDOM(view, el)     — DOM element (hover, drop targets)
//   enumerateBlockUnits(doc)              — every unit in a doc (marquee)
//
// Part of blockStateRegistry — talks to blockRegistry only via the facade.

import {
  ATOM_BLOCK_TYPES,
  resolveMovableBlock,
  isListItemNodeName,
  isListNodeName,
  type MovableBlockContext,
} from './blockStateRegistry.js';

// ── Position entry point ─────────────────────────────────────────────────────

/**
 * Canonical position-based resolution.  Delegates to resolveMovableBlock —
 * the innermost list row, else the nearest page-container's direct child —
 * re-exported under the unit name so consumers speak one vocabulary.
 */
export function resolveBlockUnit($pos: any): MovableBlockContext | null {
  return resolveMovableBlock($pos);
}

/**
 * The direct-parent container context for a block whose "before" position is
 * `pos`: resolving that position lands INSIDE the parent, with `.index()` as
 * the block's sibling index.  This is the container notion used by selection
 * ranges and sibling walks — it follows list nesting (a nested row's container
 * is its sub-list), unlike the page-container ancestry walk.
 */
export interface BlockUnitContainer {
  readonly parent: any;
  readonly contentStart: number;
  readonly containerBefore: number | null;
  readonly index: number;
}

export function resolveUnitContainer(doc: any, pos: number): BlockUnitContainer | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const depth = $pos.depth;
  return {
    parent: $pos.parent,
    contentStart: $pos.start(depth),
    containerBefore: depth === 0 ? null : $pos.before(depth),
    index: $pos.index(depth),
  };
}

// ── Doc enumeration entry point ──────────────────────────────────────────────

/** Wrapper types that are structurally transparent — never units themselves. */
const UNIT_TRANSPARENT_WRAPPERS: ReadonlySet<string> = new Set([
  'columnList', 'column', 'bulletList', 'orderedList', 'taskList',
]);

export interface BlockUnitEntry {
  /** Absolute "before" position of the unit. */
  readonly pos: number;
  readonly node: any;
  /**
   * True for list rows: the unit's visual extent is its OWN first line, not
   * its full node box (which spans every nested descendant).  Geometry
   * consumers (marquee hit-testing) must measure the line, not the box.
   */
  readonly isListItem: boolean;
}

/**
 * Every interaction unit in `doc`, in document order.  Transparent wrappers
 * are recursed into; list rows are emitted AND their nested sub-lists are
 * recursed so nested rows are units of their own.  Container blocks (callout,
 * details, blockquote) are single units from the outside — entering them is
 * an editing operation, not a structural walk, matching the drag handle.
 */
export function enumerateBlockUnits(doc: any): BlockUnitEntry[] {
  const out: BlockUnitEntry[] = [];
  collectUnits(doc, 0, out);
  return out;
}

function collectUnits(parent: any, parentContentStart: number, out: BlockUnitEntry[]): void {
  parent.forEach((node: any, offset: number) => {
    const absPos = parentContentStart + offset;
    const name: string = node.type.name;

    if (UNIT_TRANSPARENT_WRAPPERS.has(name)) {
      collectUnits(node, absPos + 1, out);
      return;
    }

    if (isListItemNodeName(name)) {
      out.push({ pos: absPos, node, isListItem: true });
      // Beyond the row's own first line: nested sub-lists hold further row
      // units, and any OTHER child block (quote-in-row, trailing blocks from
      // in-place conversion) is a unit of its own — mirroring
      // resolveMovableBlock's non-first-child rule.
      let childPos = absPos + 1;
      node.forEach((child: any, _off: number, index: number) => {
        if (isListNodeName(child.type.name)) {
          collectUnits(child, childPos + 1, out);
        } else if (index > 0) {
          out.push({ pos: childPos, node: child, isListItem: false });
        }
        childPos += child.nodeSize;
      });
      return;
    }

    out.push({ pos: absPos, node, isListItem: false });
  });
}

// ── DOM entry point ──────────────────────────────────────────────────────────

/**
 * A list row's own content element: the row's first child block, skipping a
 * taskItem's checkbox `<label>`.  posAtDOM() on the `<li>` itself resolves to
 * the row's *content start* which ProseMirror reports at the wrapper level;
 * probing the content element instead lands inside the row so the resolver
 * finds the innermost item.  (Shared by hover, drop targeting, and clicks —
 * this mapping was previously copy-pasted at three sites.)
 */
export function listItemContentElement(li: HTMLElement): HTMLElement {
  const directChild = li.firstElementChild as HTMLElement | null;
  if (!directChild) return li;
  if (directChild.tagName === 'LABEL') {
    return (directChild.nextElementSibling as HTMLElement | null) ?? directChild;
  }
  return directChild;
}

export interface DomBlockUnit {
  readonly pos: number;
  readonly node: any;
  /** Full movable context when position-resolution succeeded (non-atom path). */
  readonly ctx: MovableBlockContext | null;
}

/**
 * Resolve the interaction unit for a DOM element inside the editor.
 *
 * Atom blocks are matched first via their NodeView root (`data-type`), because
 * posAtDOM() inside an atom's rendered content (e.g. KaTeX markup) can resolve
 * to a neighbouring position when the atom is nested in a column/callout.
 * Then list rows via their `<li>`, then the generic position path.
 */
export function resolveBlockUnitFromDOM(view: any, element: HTMLElement): DomBlockUnit | null {
  if (!view?.dom?.contains(element)) return null;

  // 1) Atom NodeView roots (mathBlock, image, bookmark, …).
  const typed = element.closest('[data-type]') as HTMLElement | null;
  if (typed && view.dom.contains(typed)) {
    const typeName = typed.getAttribute('data-type') ?? '';
    if (ATOM_BLOCK_TYPES.has(typeName)) {
      try {
        const pos = view.posAtDOM(typed, 0);
        const direct = view.state.doc.nodeAt(pos);
        if (direct && direct.type.name === typeName) {
          return { pos, node: direct, ctx: null };
        }
        const ctx = resolveMovableBlock(view.state.doc.resolve(pos));
        if (ctx && ctx.node?.type?.name === typeName) {
          return { pos: ctx.pos, node: ctx.node, ctx };
        }
      } catch { /* fall through to the generic paths */ }
    }
  }

  // 2) List rows — probe the row's own content element.
  const li = element.closest('li') as HTMLElement | null;
  if (li && view.dom.contains(li)) {
    try {
      const inner = view.posAtDOM(listItemContentElement(li), 0);
      const ctx = resolveMovableBlock(view.state.doc.resolve(inner));
      if (ctx) return { pos: ctx.pos, node: ctx.node, ctx };
    } catch { /* fall through */ }
  }

  // 3) Generic block element.
  try {
    const inner = view.posAtDOM(element, 0);
    const ctx = resolveMovableBlock(view.state.doc.resolve(inner));
    if (ctx) return { pos: ctx.pos, node: ctx.node, ctx };
  } catch { /* unresolvable */ }
  return null;
}
