// conceptMapNode.ts — the concept map as a canvas block.
//
// The chat pattern, kept and made savable: the model writes an indented
// OUTLINE, the shared renderer (ui/conceptMap) draws it, and editing
// CONTENT means editing the outline text. Editing happens IN THE BOX:
// click one and type, with markdown and math formatting live under the
// caret; the commit rewrites that box's own outline LINE. Line, not
// label, is a box's identity, so two boxes may share a name without
// ever editing each other. LAYOUT is the user's to adjust: drag a box
// with its branch, drop it on another box to move the branch under that
// box, drag its right edge to resize (text re-wraps). Click selects;
// Shift or Ctrl adds; a drag across the board selects a frame of boxes;
// double-click edits. Adjustments live as OVERRIDES keyed by label
// (counted when repeated), deltas over the computed layout that carry a
// box's branch with it; rename a node and its override quietly
// evaporates back to auto layout. The outline can never drift because it
// never carries geometry.
//
// Attrs: { src, dir, overrides: { [key]: { dx, dy, w } }, layoutVersion }.
// layoutVersion 1 (or absent) stored each box's delta on its own; 2
// stores them relative to the parent. A version 1 map is converted on
// read and saved as 2 at its next change.

import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import {
  appendChildAtLine,
  caretSourceOffset,
  deleteBranches,
  deleteOutlineSubtree,
  editorHtml,
  editorSignature,
  hubPathsFor,
  indentBranch,
  insertSiblingAfter,
  MAP_MARGIN,
  migrateFlatOverrides,
  moveBranchAmongSiblings,
  moveBranchesUnder,
  normalizeLabel,
  outdentBranch,
  outlineLineText,
  outlineTree,
  overrideKeysByLine,
  parseMindMap,
  pruneOverrides,
  renderMindMapSvg,
  replaceOutlineLine,
  resolveSourceOffset,
  serializeEditorDom,
  subtreeLines,
  topmostLines,
  type EdgeBox,
  type EditorCaret,
  type HubChild,
  type MindMapDirection,
  type MindMapNode,
  type MindMapOverrides, coerceMindMapDirection, MAP_GRID, MAP_CELL2,
} from '../../../ui/conceptMap.js';
import { beginPointerDrag } from '../../../ui/interactionMode.js';

const renderMath = (tex: string): string =>
  katex.renderToString(tex, { throwOnError: false });

export const DEFAULT_CONCEPT_MAP_SRC = [
  'Central idea',
  '  First branch',
  '    A detail',
  '  Second branch',
].join('\n');

const CLICK_DIST = 4;
const RESIZE_EDGE_PX = 8;

export const ConceptMap = Node.create({
  name: 'conceptMap',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: DEFAULT_CONCEPT_MAP_SRC },
      dir: { default: 'right' },
      overrides: { default: {} },
      layoutVersion: { default: 1 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="concept-map"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'concept-map',
        class: 'canvas-conceptmap',
      }),
    ];
  },

  addNodeView() {
    // Loosely typed like the other custom node views (bookmarkNode) — the
    // tiptap prop types fight hand-rolled narrowing.
    return ({ node, editor, getPos }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-conceptmap');
      dom.setAttribute('data-type', 'concept-map');
      dom.contentEditable = 'false';
      dom.draggable = false;

      const readAttrs = (a: Record<string, unknown>) => {
        const src = String(a.src ?? '');
        const raw = (a.overrides && typeof a.overrides === 'object' ? a.overrides : {}) as MindMapOverrides;
        return {
          src,
          dir: coerceMindMapDirection(a.dir),
          overrides: (Number(a.layoutVersion) || 1) >= 2 ? raw : migrateFlatOverrides(src, raw),
        };
      };
      let attrs = readAttrs(node.attrs);
      let editing = false;
      // The in-place box editor: teardown removes overlay + listeners
      // WITHOUT committing; finish commits (or cancels) then re-renders.
      let boxEditTeardown: (() => void) | null = null;
      type EditorDoneVia = 'enter' | 'tab' | 'blur' | 'escape';
      let finishBoxEdit: ((via: EditorDoneVia) => void) | null = null;
      // A queued phantom editor, opened by the NEXT render (after the
      // insert it follows lands): how Enter/Tab chain across commits.
      let pendingPhantom: { kind: 'child' | 'sibling'; line: number } | null = null;

      const commit = (patch: Partial<{ src: string; dir: MindMapDirection; overrides: MindMapOverrides }>): void => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const next = { ...attrs, ...patch };
        // Every src change prunes overrides whose label no longer names
        // a box; without this an orphaned entry keeps Reset Layout lit.
        if (patch.src !== undefined) next.overrides = pruneOverrides(next.overrides, next.src);
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...next, layoutVersion: 2 }));
      };

      // ── Selection ────────────────────────────────────────────────────
      // Boxes are selected by SOURCE LINE. A change that moves lines hands
      // over the new ones; a render drops any line no longer drawn. The
      // map body takes focus on any press, so the keys act on the map.
      const selected = new Set<number>();
      let bodyEl: HTMLElement | null = null;
      let refocusMap = false;
      let updateResetTool: (() => void) | null = null;

      const paintSelection = (): void => {
        if (!bodyEl) return;
        for (const g of Array.from(bodyEl.querySelectorAll('.parallx-mindmap__node[data-mm-line]'))) {
          g.classList.toggle('parallx-mindmap__node--selected', selected.has(Number(g.getAttribute('data-mm-line'))));
        }
        updateResetTool?.();
      };
      const selectOnly = (lines: Iterable<number>): void => {
        selected.clear();
        for (const l of lines) selected.add(l);
        paintSelection();
      };
      /** Commit a change made on the map: the map keeps focus and the given selection. */
      const commitFromMap = (
        patch: Partial<{ src: string; dir: MindMapDirection; overrides: MindMapOverrides }>,
        nextSelection?: Iterable<number>,
      ): void => {
        if (nextSelection) { selected.clear(); for (const l of nextSelection) selected.add(l); }
        refocusMap = true;
        commit(patch);
      };
      /** The override key of every drawn box, by line. */
      const keysByLine = (): Map<number, string> => overrideKeysByLine(parseMindMap(attrs.src));
      /** Overrides with the own position delta of `lines` dropped (a width stays). */
      const withoutOwnDelta = (lines: Iterable<number>): MindMapOverrides => {
        const keys = keysByLine();
        const next: Record<string, { dx?: number; dy?: number; w?: number }> = { ...attrs.overrides };
        for (const l of lines) {
          const k = keys.get(l);
          if (!k || !next[k]) continue;
          const w = next[k].w;
          if (typeof w === 'number') next[k] = { w };
          else delete next[k];
        }
        return next;
      };
      /** Overrides with (dx, dy) added to the own delta of `lines`. */
      const withDelta = (lines: Iterable<number>, dx: number, dy: number): MindMapOverrides => {
        const keys = keysByLine();
        const next: Record<string, { dx?: number; dy?: number; w?: number }> = { ...attrs.overrides };
        for (const l of lines) {
          const k = keys.get(l);
          if (!k) continue;
          const prev = next[k] ?? {};
          next[k] = { ...prev, dx: (prev.dx ?? 0) + dx, dy: (prev.dy ?? 0) + dy };
        }
        return next;
      };

      /** One map node: its <g>, box rect, label, override key and SOURCE LINE. */
      type NodeParts = { g: SVGGElement; rect: SVGRectElement; label: string; key: string; line: number };
      const nodeParts = (target: EventTarget | null): NodeParts | null => {
        const g = (target as HTMLElement | null)?.closest?.('.parallx-mindmap__node') as SVGGElement | null;
        const rect = g?.querySelector('.parallx-mindmap__box') as SVGRectElement | null;
        const label = g?.getAttribute('data-mindmap-label') ?? '';
        const key = g?.getAttribute('data-mm-key') || label;
        const line = Number(g?.getAttribute('data-mm-line'));
        return g && rect && label && Number.isFinite(line) ? { g, rect, label, key, line } : null;
      };
      const partsForLine = (line: number): NodeParts | null =>
        nodeParts(bodyEl?.querySelector(`.parallx-mindmap__node[data-mm-line="${line}"] .parallx-mindmap__box`) ?? null);

      const startEdit = (): void => {
        editing = true;
        render();
      };

      /** The map's positioned host (overlay + hover button coordinates). */
      let mapHost: HTMLElement | null = null;

      /** A card's colour index (its LEVEL), read off its node class (d0..d4). */
      const branchOfEl = (g: Element | null): number => {
        const m = /parallx-mindmap__node--d(\d)/.exec(g?.getAttribute('class') ?? '');
        return m ? Number(m[1]) : 0;
      };

      /** Screen px per map unit: the SVG scales down to fit its column. */
      const svgScale = (svg: SVGSVGElement | null | undefined): number => {
        if (!svg) return 1;
        const vb = svg.viewBox?.baseVal?.width || 0;
        const w = svg.getBoundingClientRect().width;
        return vb > 0 && w > 0 ? w / vb : 1;
      };

      const boxCount = (outline: string): number => labelsOf(outline).length;

      /** Every label the outline would draw (duplicates included). */
      const labelsOf = (outline: string): string[] => {
        const out: string[] = [];
        const walk = (n: MindMapNode): void => { out.push(n.label); n.children.forEach(walk); };
        for (const r of parseMindMap(outline)) walk(r);
        return out;
      };

      /** Every box's geometry by SOURCE LINE, read from the live SVG. */
      const boxGeoms = (root: HTMLElement): Map<number, EdgeBox> => {
        const out = new Map<number, EdgeBox>();
        for (const g of Array.from(root.querySelectorAll('.parallx-mindmap__node[data-mm-line]'))) {
          const rect = g.querySelector('.parallx-mindmap__box') as SVGRectElement | null;
          const line = Number(g.getAttribute('data-mm-line'));
          if (!rect || !Number.isFinite(line)) continue;
          const x = Number(rect.getAttribute('x')) || 0;
          const y = Number(rect.getAttribute('y')) || 0;
          const width = Number(rect.getAttribute('width')) || 0;
          const height = Number(rect.getAttribute('height')) || 0;
          out.set(line, { x, y: y + height / 2, width, height });
        }
        return out;
      };

      /**
       * Drag = move the selection, each box with its whole branch (the
       * pressed box joins the selection first). Released over another box,
       * the branches move UNDER it in the outline and settle into the
       * layout there; released on the board, they stay where they were let
       * go, snapped to the grid (hold Alt to move freely), never past the
       * board's top or left margin. A still click selects the box; a still
       * click on the box that is already the only one selected edits it in
       * place (so a double-click edits too).
       */
      const beginGroupDrag = (e: PointerEvent | MouseEvent, parts: NodeParts, wasSole: boolean): void => {
        const svg = parts.g.ownerSVGElement;
        if (!svg || !bodyEl) return;
        const host = bodyEl;
        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;
        const scale = svgScale(svg);
        const tree = outlineTree(attrs.src);
        const tops = topmostLines(tree, selected.has(parts.line) ? selected : [parts.line]);
        const moving = new Set<number>();
        for (const t of tops) for (const l of subtreeLines(tree, t)) moving.add(l);
        const nodeEl = (line: number): SVGGElement | null =>
          svg.querySelector(`.parallx-mindmap__node[data-mm-line="${line}"]`);

        // Boxes move by per-frame attribute updates, never a transform on
        // the group: Chromium can stall repaints of transformed groups that
        // contain a foreignObject (formula boxes froze while their edges
        // moved). A note's corner paths have no x/y, so they take a
        // translate of their own (a bare path has no foreignObject inside).
        const movers: { el: SVGGraphicsElement; baseX: number; baseY: number }[] = [];
        const corners: SVGGraphicsElement[] = [];
        const movingEls: SVGGElement[] = [];
        for (const l of moving) {
          const g = nodeEl(l);
          if (!g) continue;
          movingEls.push(g);
          for (const el of Array.from(g.children) as SVGGraphicsElement[]) {
            if (el.tagName === 'rect' || el.tagName === 'text' || el.tagName === 'foreignObject') {
              movers.push({ el, baseX: Number(el.getAttribute('x')) || 0, baseY: Number(el.getAttribute('y')) || 0 });
            } else if (el.tagName === 'path') corners.push(el);
          }
        }
        const moveAll = (mx: number, my: number): void => {
          for (const m of movers) {
            m.el.setAttribute('x', String(m.baseX + mx));
            m.el.setAttribute('y', String(m.baseY + my));
          }
          for (const p of corners) {
            if (mx || my) p.setAttribute('transform', `translate(${mx} ${my})`);
            else p.removeAttribute('transform');
          }
        };

        const geoms = boxGeoms(svg as unknown as HTMLElement);
        const grabbed = geoms.get(parts.line);
        if (!grabbed) return;
        // The moving set never crosses the margin: that keeps the board's
        // frame, so the drop lands exactly where it was let go.
        let minLeft = Infinity;
        let minTop = Infinity;
        for (const l of moving) {
          const gm = geoms.get(l);
          if (!gm) continue;
          minLeft = Math.min(minLeft, gm.x);
          minTop = Math.min(minTop, gm.y - gm.height / 2);
        }
        const grabbedTop = grabbed.y - grabbed.height / 2;
        const place = (dxPx: number, dyPx: number, free: boolean): [number, number] => {
          let mx = dxPx / scale;
          let my = dyPx / scale;
          if (!free) {
            // The pressed box's top-left lands on a lattice point (map units).
            mx = Math.round((grabbed.x + mx) / MAP_GRID) * MAP_GRID - grabbed.x;
            my = Math.round((grabbedTop + my) / MAP_GRID) * MAP_GRID - grabbedTop;
          }
          return [Math.max(mx, MAP_MARGIN - minLeft), Math.max(my, MAP_MARGIN - minTop)];
        };

        // HUBS touching a moving box re-route LIVE: its own hub (it is a
        // parent) and its parent's hub (it is a child). Everything is keyed
        // by SOURCE LINE: two boxes sharing a label never trade arms.
        const affectedHubs = new Set<number>();
        for (const l of moving) {
          if ((tree.kidsOf.get(l) ?? []).length > 0) affectedHubs.add(l);
          const p = tree.parentOf.get(l);
          if (p !== undefined) affectedHubs.add(p);
        }
        const hubPathEls = (Array.from(svg.querySelectorAll('path[data-mm-hub]')) as SVGPathElement[])
          .filter((path) => affectedHubs.has(Number(path.getAttribute('data-mm-hub'))))
          .map((path) => ({ path, baseD: path.getAttribute('d') ?? '' }));
        const clones: SVGPathElement[] = [];
        const colorOf = (line: number): number => branchOfEl(nodeEl(line));
        const rerouteEdges = (mx: number, my: number): void => {
          const geomOf = (line: number): EdgeBox | undefined => {
            const g = geoms.get(line);
            return g && moving.has(line) ? { ...g, x: g.x + mx, y: g.y + my } : g;
          };
          for (const hubLine of affectedHubs) {
            const parentGeom = geomOf(hubLine);
            const kidLines = tree.kidsOf.get(hubLine) ?? [];
            if (!parentGeom || kidLines.length === 0) continue;
            const kids: HubChild[] = [];
            for (const k of kidLines) {
              const g = geomOf(k);
              if (g) kids.push({ ...g, label: String(k), color: colorOf(k) });
            }
            const hubs = hubPathsFor(parentGeom, kids, attrs.dir);
            // ARMS carry the arrowheads: match each by its target line.
            const els = hubPathEls.filter(({ path }) => Number(path.getAttribute('data-mm-hub')) === hubLine);
            const armByTo = new Map<string, SVGPathElement>();
            const trunkPool: SVGPathElement[] = [];
            for (const { path } of els) {
              const to = path.getAttribute('data-mm-to');
              if (to !== null) armByTo.set(to, path);
              else trunkPool.push(path);
            }
            let trunkNeed = 0;
            const seatTrunk = (d: string): void => {
              const idx = trunkNeed++;
              if (idx < trunkPool.length) { trunkPool[idx].setAttribute('d', d); return; }
              // More structure than the render had: clone a trunk path.
              const donor = trunkPool[0] ?? els[0]?.path;
              if (!donor) return;
              const extra = donor.cloneNode(false) as SVGPathElement;
              extra.removeAttribute('marker-end');
              extra.removeAttribute('data-mm-to');
              extra.setAttribute('d', d);
              donor.parentNode?.insertBefore(extra, donor);
              clones.push(extra);
            };
            for (const hub of hubs) {
              seatTrunk(hub.stem);
              if (hub.spine) seatTrunk(hub.spine);
              for (const arm of hub.arms) armByTo.get(arm.to)?.setAttribute('d', arm.d);
            }
            // Surplus trunk paths go blank, never stale; arms never blank.
            for (let t = trunkNeed; t < trunkPool.length; t++) trunkPool[t].setAttribute('d', '');
          }
        };

        // The drop target: the box under the pointer, outside the moving
        // branches, that is not already the parent of every moved branch.
        let dropTarget: number | null = null;
        const note = document.createElement('div');
        note.classList.add('canvas-conceptmap__dropnote');
        const findTarget = (clientX: number, clientY: number): number | null => {
          const svgB = svg.getBoundingClientRect();
          const px = (clientX - svgB.left) / scale;
          const py = (clientY - svgB.top) / scale;
          for (const [l, g] of geoms) {
            if (moving.has(l)) continue;
            if (px >= g.x && px <= g.x + g.width && py >= g.y - g.height / 2 && py <= g.y + g.height / 2) {
              return tops.every((t) => tree.parentOf.get(t) === l) ? null : l;
            }
          }
          return null;
        };
        const showTarget = (line: number | null): void => {
          if (line === dropTarget) return;
          if (dropTarget !== null) nodeEl(dropTarget)?.classList.remove('parallx-mindmap__node--drop');
          dropTarget = line;
          if (line === null) { note.remove(); return; }
          const g = nodeEl(line);
          g?.classList.add('parallx-mindmap__node--drop');
          const label = g?.getAttribute('data-mindmap-label') ?? '';
          note.textContent = `Move under “${label.length > 40 ? `${label.slice(0, 40)}…` : label}”`;
          const rb = g?.querySelector('.parallx-mindmap__box')?.getBoundingClientRect();
          const hb = host.getBoundingClientRect();
          if (rb) {
            note.style.left = `${Math.round(rb.left - hb.left)}px`;
            note.style.top = `${Math.round(rb.top - hb.top - 24)}px`;
          }
          if (!note.isConnected) host.appendChild(note);
        };

        let mx = 0;
        let my = 0;
        const restore = (): void => {
          moveAll(0, 0);
          for (const { path, baseD } of hubPathEls) path.setAttribute('d', baseD);
          for (const extra of clones) extra.remove();
          for (const g of movingEls) g.classList.remove('parallx-mindmap__node--moving');
          showTarget(null);
        };
        beginPointerDrag(e, {
          id: 'conceptmap-move',
          cursor: 'grabbing',
          onMove: (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!moved && Math.hypot(dx, dy) < CLICK_DIST) return;
            if (!moved) {
              moved = true;
              for (const g of movingEls) g.classList.add('parallx-mindmap__node--moving');
            }
            const free = 'altKey' in ev && Boolean((ev as MouseEvent).altKey);
            [mx, my] = place(dx, dy, free);
            moveAll(mx, my);
            rerouteEdges(mx, my);
            showTarget(findTarget(ev.clientX, ev.clientY));
          },
          onEnd: (canceled) => {
            const target = dropTarget;
            restore();
            if (canceled) return;
            if (!moved) {
              if (wasSole) beginBoxEdit(parts);
              else selectOnly([parts.line]);
              return;
            }
            if (target !== null) {
              const res = moveBranchesUnder(attrs.src, tops, target);
              if (!res) return;
              // Moved branches settle into the layout under their new
              // parent (their own deltas go; their insides keep theirs).
              commitFromMap({ src: res.src, overrides: withoutOwnDelta(tops) }, res.lines);
              return;
            }
            const rx = Math.round(mx);
            const ry = Math.round(my);
            if (!rx && !ry) return;
            commitFromMap({ overrides: withDelta(tops, rx, ry) });
          },
        });
      };

      /**
       * A drag across the empty board draws a frame; every box it touches
       * is selected (added to the selection with Shift or Ctrl). A still
       * click on the board clears the selection.
       */
      const beginMarquee = (e: PointerEvent | MouseEvent, additive: boolean): void => {
        const host = bodyEl;
        if (!host) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const base = additive ? new Set(selected) : new Set<number>();
        let moved = false;
        const frame = document.createElement('div');
        frame.classList.add('canvas-conceptmap__marquee');
        beginPointerDrag(e, {
          id: 'conceptmap-marquee',
          cursor: 'crosshair',
          onMove: (ev) => {
            if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < CLICK_DIST) return;
            if (!moved) { moved = true; host.appendChild(frame); }
            const left = Math.min(startX, ev.clientX);
            const top = Math.min(startY, ev.clientY);
            const right = Math.max(startX, ev.clientX);
            const bottom = Math.max(startY, ev.clientY);
            const hb = host.getBoundingClientRect();
            frame.style.left = `${Math.round(left - hb.left)}px`;
            frame.style.top = `${Math.round(top - hb.top)}px`;
            frame.style.width = `${Math.round(right - left)}px`;
            frame.style.height = `${Math.round(bottom - top)}px`;
            selected.clear();
            for (const l of base) selected.add(l);
            for (const g of Array.from(host.querySelectorAll('.parallx-mindmap__node[data-mm-line]'))) {
              const r = g.querySelector('.parallx-mindmap__box')?.getBoundingClientRect();
              if (r && r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom) {
                selected.add(Number(g.getAttribute('data-mm-line')));
              }
            }
            paintSelection();
          },
          onEnd: () => {
            frame.remove();
            if (!moved && !additive) selectOnly([]);
          },
        });
      };

      /** Arrow keys nudge the selected branches by a cell (Shift: four), never past the margin. */
      const nudgeSelection = (dxCells: number, dyCells: number): void => {
        const tree = outlineTree(attrs.src);
        const tops = topmostLines(tree, selected);
        if (tops.length === 0 || !bodyEl) return;
        const geoms = boxGeoms(bodyEl);
        let minLeft = Infinity;
        let minTop = Infinity;
        for (const t of tops) for (const l of subtreeLines(tree, t)) {
          const g = geoms.get(l);
          if (!g) continue;
          minLeft = Math.min(minLeft, g.x);
          minTop = Math.min(minTop, g.y - g.height / 2);
        }
        const dx = Math.max(dxCells * MAP_GRID, MAP_MARGIN - minLeft);
        const dy = Math.max(dyCells * MAP_GRID, MAP_MARGIN - minTop);
        if (!dx && !dy) return;
        commitFromMap({ overrides: withDelta(tops, dx, dy) });
      };

      /** The map's keys. Undo and redo (Ctrl or Cmd) pass through to the page. */
      const onMapKey = (e: KeyboardEvent): void => {
        if (boxEditTeardown) return;
        const mod = e.ctrlKey || e.metaKey;
        const take = (): void => { e.preventDefault(); e.stopPropagation(); };
        const drawn = new Set(Array.from(bodyEl?.querySelectorAll('.parallx-mindmap__node[data-mm-line]') ?? [])
          .map((g) => Number(g.getAttribute('data-mm-line'))));
        const sel = [...selected].filter((l) => drawn.has(l)).sort((a, b) => a - b);
        if (mod) {
          if (e.key === 'a' || e.key === 'A') { take(); selectOnly(drawn); }
          return;
        }
        if (e.key === 'Tab' && (e.shiftKey || sel.length !== 1)) return;
        // Every other key stays on the map: Enter or Backspace must never
        // reach the page, where they would replace or delete the block.
        take();
        if (e.key === 'Escape') { selectOnly([]); return; }
        if (sel.length === 0) return;
        if ((e.key === 'Enter' || e.key === 'F2') && sel.length === 1) {
          const p = partsForLine(sel[0]);
          if (p) beginBoxEdit(p);
          return;
        }
        if (e.key === 'Tab') { beginPhantomAdd('child', sel[0]); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const next = deleteBranches(attrs.src, sel);
          if (next) commitFromMap({ src: next }, []);
          return;
        }
        if (!e.key.startsWith('Arrow')) return;
        if (e.altKey) {
          if (sel.length !== 1) return;
          const l = sel[0];
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const res = moveBranchAmongSiblings(attrs.src, l, e.key === 'ArrowUp' ? -1 : 1);
            if (res) commitFromMap({ src: res.src }, res.lines);
          } else {
            const res = e.key === 'ArrowRight' ? indentBranch(attrs.src, l) : outdentBranch(attrs.src, l);
            if (res) commitFromMap({ src: res.src, overrides: withoutOwnDelta([l]) }, res.lines);
          }
          return;
        }
        const step = e.shiftKey ? 4 : 1;
        const dir: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
        };
        const [cx, cy] = dir[e.key] ?? [0, 0];
        nudgeSelection(cx, cy);
      };

      /** The right-edge grip resizes; text re-wraps on commit. */
      const beginBoxResize = (e: PointerEvent | MouseEvent, parts: { rect: SVGRectElement; key: string }): void => {
        const startX = e.clientX;
        const startW = Number(parts.rect.getAttribute('width')) || 120;
        const scale = svgScale(parts.rect.ownerSVGElement);
        let w = startW;
        beginPointerDrag(e, {
          id: 'conceptmap-resize',
          cursor: 'ew-resize',
          onMove: (ev) => {
            w = Math.max(MAP_CELL2, Math.round(Math.max(80, Math.min(420, startW + (ev.clientX - startX) / scale)) / MAP_CELL2) * MAP_CELL2);
            parts.rect.setAttribute('width', String(w));
          },
          onEnd: (canceled) => {
            if (canceled || w === startW) { render(); return; }
            const prev = attrs.overrides[parts.key] ?? {};
            commitFromMap({ overrides: { ...attrs.overrides, [parts.key]: { ...prev, w } } });
          },
        });
      };

      /**
       * The live-preview label editor: a contentEditable overlay with
       * markers dimmed, math rendered the moment the caret leaves its
       * span (click a formula to get the TeX back), repainting only
       * when the formatting changes so plain typing keeps the browser
       * caret and undo. One engine serves two doors: editing a box
       * that EXISTS (spec.line) and adding one that does not yet (a
       * phantom: nothing is inserted until the commit).
       */
      interface EditorSpec {
        readonly initial: string;
        readonly selectAll: boolean;
        /** Host-relative seat: where the overlay sits. */
        readonly rect: { left: number; top: number; width: number; height: number };
        /** Hue for the border (a phantom wears its parent's). */
        readonly branch: number;
        readonly hint: string;
        /** Trimmed text (null = escape). Runs AFTER teardown. */
        readonly onDone: (text: string | null, via: EditorDoneVia) => void;
      }

      const openEditorOverlay = (spec: EditorSpec): void => {
        if (boxEditTeardown) return;
        const host = mapHost;
        if (!host) return;

        const ed = document.createElement('div');
        ed.classList.add('canvas-conceptmap__boxedit', `canvas-conceptmap__boxedit--d${Math.min(Math.max(0, spec.branch), 4)}`);
        try {
          (ed as HTMLElement & { contentEditable: string }).contentEditable = 'plaintext-only';
        } catch {
          ed.contentEditable = 'true';
        }
        const hostB = host.getBoundingClientRect();
        ed.style.left = `${Math.round(spec.rect.left)}px`;
        ed.style.top = `${Math.round(spec.rect.top)}px`;
        ed.style.minWidth = `${Math.max(60, Math.round(spec.rect.width))}px`;
        ed.style.minHeight = `${Math.round(spec.rect.height)}px`;
        ed.style.maxWidth = `${Math.max(120, Math.round(hostB.width - spec.rect.left - 8))}px`;

        const hintEl = document.createElement('div');
        hintEl.classList.add('canvas-conceptmap__boxedit-hint');
        hintEl.textContent = spec.hint;
        hintEl.style.left = `${Math.round(spec.rect.left)}px`;

        let src = spec.initial;
        let composing = false;
        let lastSig = editorSignature(src, { start: src.length, end: src.length });

        const caretRange = (): EditorCaret | null => {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return null;
          const r = sel.getRangeAt(0);
          if (!ed.contains(r.startContainer) || !ed.contains(r.endContainer)) return null;
          return {
            start: caretSourceOffset(ed, r.startContainer, r.startOffset),
            end: caretSourceOffset(ed, r.endContainer, r.endOffset),
          };
        };
        const setSelection = (start: number, end: number): void => {
          const sel = window.getSelection();
          if (!sel) return;
          const a = resolveSourceOffset(ed, start);
          const b = start === end ? a : resolveSourceOffset(ed, end);
          const range = document.createRange();
          range.setStart(a.node, a.offset);
          range.setEnd(b.node, b.offset);
          sel.removeAllRanges();
          sel.addRange(range);
        };
        const seatHint = (): void => {
          hintEl.style.top = `${Math.round(ed.offsetTop + ed.offsetHeight + 4)}px`;
        };
        const repaint = (caret: EditorCaret | null): void => {
          lastSig = editorSignature(src, caret);
          ed.innerHTML = editorHtml(src, caret, renderMath);
          if (caret) setSelection(caret.start, caret.end);
          seatHint();
        };
        /**
         * Repaint ONLY when the formatting would actually change. Typing
         * a plain character inside a run leaves the browser's own DOM
         * edit in place, so the caret never jumps and undo still works;
         * closing a **bold** or a $…$ span rebuilds and re-seats the
         * caret by source offset.
         */
        const syncPreview = (): void => {
          const caret = caretRange();
          const sig = editorSignature(src, caret);
          if (sig !== lastSig) repaint(caret);
          else lastSig = sig;
        };

        const onInput = (): void => {
          if (composing) return;
          src = serializeEditorDom(ed);
          syncPreview();
          seatHint();
        };
        const onSelectionChange = (): void => {
          // A math span shows raw TeX only while the caret is inside it.
          if (composing || !ed.isConnected) return;
          if (document.activeElement !== ed && !ed.contains(document.activeElement)) return;
          syncPreview();
        };
        // Paste is always PLAIN text: contenteditable=plaintext-only
        // covers Chromium, this covers the 'true' fallback.
        const onPaste = (e: ClipboardEvent): void => {
          const text = e.clipboardData?.getData('text/plain');
          if (text === undefined) return;
          e.preventDefault();
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          const flat = text.replace(/\s+/g, ' ');
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(flat);
          range.insertNode(node);
          src = serializeEditorDom(ed);
          const after = caretSourceOffset(ed, node, flat.length);
          repaint({ start: after, end: after });
        };
        const onKeyDown = (e: KeyboardEvent): void => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); finishBoxEdit?.('enter'); }
          else if (e.key === 'Tab') { e.preventDefault(); finishBoxEdit?.('tab'); }
          else if (e.key === 'Escape') { e.preventDefault(); finishBoxEdit?.('escape'); }
        };
        const onPointerDown = (e: PointerEvent): void => {
          e.stopPropagation(); // never start a box drag from inside the editor
          const atom = (e.target as HTMLElement | null)?.closest?.('[data-src]');
          if (!atom || !ed.contains(atom) || !atom.parentNode) return;
          // Click a rendered formula: show its TeX, caret just inside.
          e.preventDefault();
          const idx = Array.prototype.indexOf.call(atom.parentNode.childNodes, atom);
          const before = caretSourceOffset(ed, atom.parentNode, idx);
          repaint({ start: before + 1, end: before + 1 });
          ed.focus();
        };
        const onFocusOut = (e: FocusEvent): void => {
          // NOTE: `Node` here is tiptap's, so type the DOM check explicitly.
          const rt = e.relatedTarget as globalThis.Node | null;
          if (rt && ed.contains(rt)) return;
          finishBoxEdit?.('blur');
        };
        const onCompositionStart = (): void => { composing = true; };
        const onCompositionEnd = (): void => { composing = false; onInput(); };

        ed.addEventListener('input', onInput);
        ed.addEventListener('paste', onPaste);
        ed.addEventListener('keydown', onKeyDown);
        ed.addEventListener('pointerdown', onPointerDown);
        ed.addEventListener('focusout', onFocusOut);
        ed.addEventListener('compositionstart', onCompositionStart);
        ed.addEventListener('compositionend', onCompositionEnd);
        document.addEventListener('selectionchange', onSelectionChange);

        boxEditTeardown = () => {
          document.removeEventListener('selectionchange', onSelectionChange);
          hintEl.remove();
          ed.remove();
          finishBoxEdit = null;
        };
        finishBoxEdit = (via: EditorDoneVia): void => {
          const teardown = boxEditTeardown;
          if (!teardown) return;
          boxEditTeardown = null;
          teardown();
          const text = src.replace(/\s+/g, ' ').trim();
          refocusMap = true;
          spec.onDone(via === 'escape' ? null : text, via);
        };

        host.appendChild(ed);
        host.appendChild(hintEl);
        const end = src.length;
        repaint({ start: end, end });
        ed.focus();
        setSelection(spec.selectAll ? 0 : end, end);
      };

      /**
       * Edit an EXISTING box. Seeds from its outline line (never the
       * drawn label — a truncated label would commit its own cut back
       * and delete the tail). Enter saves; Tab saves and adds a child;
       * emptying the text and pressing Enter deletes the node with its
       * subtree (a blur with empty text just cancels — leaving mid-
       * thought must never destroy anything).
       */
      const beginBoxEdit = (parts: NodeParts): void => {
        if (boxEditTeardown || !mapHost) return;
        const rectB = parts.rect.getBoundingClientRect();
        const hostB = mapHost.getBoundingClientRect();
        // The overlay replaces the box's label; the box itself stays as
        // the frame underneath.
        const labelEls = Array.from(parts.g.querySelectorAll('text, foreignObject'));
        for (const el of labelEls) el.setAttribute('opacity', '0');
        const restoreLabel = (): void => {
          for (const el of labelEls) el.removeAttribute('opacity');
        };
        openEditorOverlay({
          initial: outlineLineText(attrs.src, parts.line) ?? parts.label,
          selectAll: false,
          rect: {
            left: rectB.left - hostB.left,
            top: rectB.top - hostB.top,
            width: rectB.width,
            height: rectB.height,
          },
          branch: branchOfEl(parts.g),
          hint: 'Enter saves. Tab adds a child. Esc cancels. Empty deletes.',
          onDone: (text, via) => {
            restoreLabel();
            if (text === null) { render(); return; }
            if (!text) {
              // Deliberate delete only: Enter on an emptied box removes
              // the node AND its subtree; a blur just cancels.
              if (via !== 'enter') { render(); return; }
              const cutNext = deleteOutlineSubtree(attrs.src, parts.line);
              if (!cutNext) { render(); return; }
              commit({ src: cutNext });
              return;
            }
            const changed = text !== (outlineLineText(attrs.src, parts.line) ?? parts.label).trim();
            if (via === 'tab') pendingPhantom = { kind: 'child', line: parts.line };
            if (!changed) {
              // Nothing to commit; render still runs so a queued
              // Tab-child opens against the repainted map.
              render();
              return;
            }
            const next = replaceOutlineLine(attrs.src, parts.line, text);
            if (!next) { pendingPhantom = null; render(); return; }
            // The override follows the rename, keyed by the label the
            // PARSER will produce (markers stripped, truncation applied) —
            // moving a box then fixing a typo must not snap it back to
            // auto layout. It never overwrites another box's override:
            // when the new label collides, the old adjustment is dropped
            // rather than transplanted onto the box that owns that name.
            const newLabel = normalizeLabel(text);
            const prevOv = attrs.overrides[parts.key];
            let overrides = attrs.overrides;
            if (prevOv && newLabel !== parts.label) {
              const rest = { ...attrs.overrides } as Record<string, (typeof attrs.overrides)[string]>;
              delete rest[parts.key];
              const newKey = overrideKeysByLine(parseMindMap(next)).get(parts.line) ?? newLabel;
              overrides = rest[newKey] ? rest : { ...rest, [newKey]: prevOv };
            }
            commit({ src: next, overrides });
          },
        });
      };

      /**
       * Add a NEW box: a phantom editor near its future seat. Nothing
       * touches the outline until the commit, so walking away leaves
       * zero litter (the old flow committed a placeholder you then had
       * to rename or clean up). Enter inserts and opens the NEXT
       * sibling's phantom; Tab inserts and dives into a child — a
       * whole branch in one typing flow. Esc closes the chain.
       */
      const beginPhantomAdd = (kind: 'child' | 'sibling', anchorLine: number): void => {
        if (boxEditTeardown || !mapHost) return;
        if (boxCount(attrs.src) >= 40) return; // the renderer's node cap
        const g = mapHost.querySelector(`.parallx-mindmap__node[data-mm-line="${anchorLine}"]`);
        const rect = g?.querySelector('.parallx-mindmap__box') as SVGRectElement | null;
        if (!g || !rect) return;
        const rectB = rect.getBoundingClientRect();
        const hostB = mapHost.getBoundingClientRect();
        // Seat the phantom where the layout will roughly put the node:
        // childward of the anchor for a child, after it for a sibling.
        // Childward is right for a tree, below for top-down, and AWAY
        // from the centre on a radial map (a left-side card grows left).
        let childward: 'right' | 'left' | 'down' = attrs.dir === 'down' ? 'down' : 'right';
        if (attrs.dir === 'radial') {
          const svgB = (g as SVGGElement).ownerSVGElement?.getBoundingClientRect();
          if (svgB && rectB.left + rectB.width / 2 < svgB.left + svgB.width / 2 - 1) childward = 'left';
        }
        const childSeat = childward === 'right'
          ? { left: rectB.right - hostB.left + 26, top: rectB.top - hostB.top }
          : childward === 'left'
            ? { left: rectB.left - hostB.left - 26 - 90, top: rectB.top - hostB.top }
            : { left: rectB.left - hostB.left + 14, top: rectB.bottom - hostB.top + 18 };
        const siblingSeat = childward === 'down'
          ? { left: rectB.right - hostB.left + 10, top: rectB.top - hostB.top }
          : { left: rectB.left - hostB.left, top: rectB.bottom - hostB.top + 8 };
        const seat = kind === 'child' ? childSeat : siblingSeat;
        openEditorOverlay({
          initial: '',
          selectAll: false,
          rect: { ...seat, width: 90, height: 24 },
          branch: branchOfEl(g) + (kind === 'child' ? 1 : 0),
          hint: 'Enter adds another. Tab adds a child. Esc closes.',
          onDone: (text, via) => {
            if (!text) { render(); return; }
            const next = kind === 'child'
              ? appendChildAtLine(attrs.src, anchorLine, text)
              : insertSiblingAfter(attrs.src, anchorLine, text);
            if (!next) { render(); return; }
            // Both inserts land at anchorLine + 1: a child is spliced
            // right under its parent, and a sibling chain only ever
            // anchors on the just-inserted LEAF (its subtree is itself).
            const newLine = anchorLine + 1;
            if (via === 'enter') pendingPhantom = { kind: 'sibling', line: newLine };
            else if (via === 'tab') pendingPhantom = { kind: 'child', line: newLine };
            commitFromMap({ src: next }, [newLine]);
          },
        });
      };

      const render = (): void => {
        // An active in-place edit never survives a repaint; discard it
        // (external updates win, per the stale-save discipline).
        if (boxEditTeardown) {
          const teardown = boxEditTeardown;
          boxEditTeardown = null;
          teardown();
        }
        dom.classList.toggle('is-editing', editing);
        dom.innerHTML = '';

        const tools = document.createElement('div');
        tools.classList.add('canvas-conceptmap__tools');

        // The layout switch. Radial draws as the tree when the outline
        // has several roots or a single-child root; the choice still
        // sticks, so adding a second branch grows the map from the centre.
        const seg = document.createElement('div');
        seg.classList.add('canvas-conceptmap__seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Layout');
        const layouts: readonly [MindMapDirection, string, string][] = [
          ['radial', 'Radial', 'Grow The Map Out From The Centre'],
          ['right', 'Tree', 'Read The Map Left To Right'],
          ['down', 'Top-Down', 'Read The Map Top To Bottom'],
        ];
        for (const [value, label, title] of layouts) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.title = title;
          b.setAttribute('aria-pressed', String(attrs.dir === value));
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (attrs.dir !== value) commit({ dir: value });
          });
          seg.appendChild(b);
        }
        tools.appendChild(seg);

        // Reset: the selected boxes when any of them was moved or resized,
        // else the whole map. Repainted with the selection.
        const resetBtn = document.createElement('button');
        resetBtn.classList.add('canvas-conceptmap__tool');
        resetBtn.type = 'button';
        const resetScope = (): string[] => {
          const keys = keysByLine();
          return [...selected].map((l) => keys.get(l)).filter((k): k is string => !!k && !!attrs.overrides[k]);
        };
        updateResetTool = () => {
          const scoped = resetScope();
          resetBtn.textContent = scoped.length ? 'Reset Selected' : 'Reset Layout';
          resetBtn.title = scoped.length
            ? 'Put the selected boxes back where the automatic layout puts them'
            : 'Drop every moved or resized box back to the automatic layout';
          resetBtn.hidden = editing || Object.keys(attrs.overrides).length === 0;
        };
        resetBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const scoped = resetScope();
          if (scoped.length === 0) { commitFromMap({ overrides: {} }); return; }
          const next = { ...attrs.overrides } as Record<string, (typeof attrs.overrides)[string]>;
          for (const k of scoped) delete next[k];
          commitFromMap({ overrides: next });
        });
        updateResetTool();
        tools.appendChild(resetBtn);

        const editBtn = document.createElement('button');
        editBtn.classList.add('canvas-conceptmap__tool');
        editBtn.type = 'button';
        editBtn.textContent = editing ? 'Done' : 'Edit Outline';
        editBtn.title = editing ? 'Save And Show The Map' : 'Edit The Whole Map As An Indented List';
        tools.appendChild(editBtn);
        dom.appendChild(tools);

        if (editing) {
          const ta = document.createElement('textarea');
          ta.classList.add('canvas-conceptmap__editor');
          ta.value = attrs.src;
          ta.addEventListener('keydown', (e) => e.stopPropagation());
          dom.appendChild(ta);
          const hint = document.createElement('div');
          hint.classList.add('canvas-conceptmap__hint');
          hint.textContent = 'One idea per line; indent to nest. **bold**, *italic*, `code`, and $x^2$ all render. On the map: click a box to select it and click again to edit it, drag it to move it with its branch, drop it on another box to move it under that box, drag its right edge to resize.';
          dom.appendChild(hint);
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editing = false;
            // Back on the map, with its keys: the selection carries on.
            refocusMap = true;
            if (ta.value !== attrs.src) commit({ src: ta.value });
            else render();
          });
          ta.focus();
        } else {
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startEdit();
          });
          const body = document.createElement('div');
          body.innerHTML = renderMindMapSvg(attrs.src, {
            dir: attrs.dir,
            board: true,
            renderMath,
            overrides: attrs.overrides,
          });
          // Pointer contract: press a box and drag to MOVE it; press its
          // right edge to RESIZE; a still click edits the box IN PLACE.
          // Hover affordances: the add-child "+" follows the hovered box,
          // and the cursor tells the contract (grab body, ew-resize edge).
          const addBtn = document.createElement('button');
          addBtn.classList.add('canvas-conceptmap__add');
          addBtn.type = 'button';
          addBtn.textContent = '+';
          addBtn.title = 'Add A Child Idea';
          addBtn.hidden = true;
          let addTargetLine = -1;
          addBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
          addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (addTargetLine < 0) return;
            beginPhantomAdd('child', addTargetLine);
          });
          body.appendChild(addBtn);
          body.addEventListener('pointermove', (e) => {
            const parts = nodeParts(e.target);
            if (!parts) {
              // Hide only when the pointer is genuinely AWAY from the
              // button: travelling the last few pixels toward it must
              // never make it vanish (the disappearing-plus bug).
              if (!addBtn.hidden && !(e.target as HTMLElement | null)?.closest?.('.canvas-conceptmap__add')) {
                const r = addBtn.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                if (Math.hypot(e.clientX - cx, e.clientY - cy) > 28) addBtn.hidden = true;
              }
              return;
            }
            const rect = parts.rect.getBoundingClientRect();
            const host = body.getBoundingClientRect();
            addTargetLine = parts.line;
            addBtn.hidden = false;
            // Seated ON the corner — overlapping the box, so the pointer
            // never crosses dead space on its way to the button.
            addBtn.style.left = `${rect.right - host.left - 9}px`;
            addBtn.style.top = `${rect.bottom - host.top - 9}px`;
            (parts.g as unknown as { style: CSSStyleDeclaration }).style.cursor =
              rect.right - e.clientX <= RESIZE_EDGE_PX ? 'ew-resize' : 'grab';
          });
          body.addEventListener('pointerleave', () => { addBtn.hidden = true; });
          body.style.position = 'relative';
          body.classList.add('canvas-conceptmap__body');
          body.tabIndex = 0;
          body.setAttribute('aria-label', 'Concept map. Click a box to select it.');
          body.addEventListener('keydown', onMapKey);
          mapHost = body;
          bodyEl = body;
          if (pendingPhantom) {
            // The chained phantom opens against the FRESH map (its
            // anchor line just landed); consume exactly once.
            const queued = pendingPhantom;
            pendingPhantom = null;
            queueMicrotask(() => beginPhantomAdd(queued.kind, queued.line));
          }
          body.addEventListener('pointerdown', (e) => {
            if ((e as MouseEvent).button !== 0) return;
            if (boxEditTeardown) {
              // A press outside the open box editor commits it; the
              // repaint replaces this DOM, so never also start a drag.
              e.preventDefault();
              e.stopPropagation();
              finishBoxEdit?.('blur');
              return;
            }
            if ((e.target as HTMLElement | null)?.closest?.('.canvas-conceptmap__add')) return;
            e.preventDefault();
            e.stopPropagation();
            body.focus({ preventScroll: true });
            const additive = e.shiftKey || e.ctrlKey || e.metaKey;
            const parts = nodeParts(e.target);
            if (!parts) { beginMarquee(e, additive); return; }
            if (additive) {
              if (selected.has(parts.line)) selected.delete(parts.line);
              else selected.add(parts.line);
              paintSelection();
              return;
            }
            const wasSole = selected.size === 1 && selected.has(parts.line);
            const rectRight = parts.rect.getBoundingClientRect().right;
            if (rectRight - e.clientX <= RESIZE_EDGE_PX) {
              selectOnly([parts.line]);
              beginBoxResize(e, parts);
              return;
            }
            if (!selected.has(parts.line)) selectOnly([parts.line]);
            beginGroupDrag(e, parts, wasSole);
          });
          dom.appendChild(body);
          const keys = document.createElement('div');
          keys.classList.add('canvas-conceptmap__keys');
          keys.textContent = 'Click selects, Shift-click or a frame selects more. Click a selected box or press Enter to edit. Drag a box onto another to move it under it. Alt with the arrows reorders and re-nests; arrows nudge; Delete removes; Tab adds a child.';
          dom.appendChild(keys);
          // Selection survives the repaint for every line still drawn.
          const drawn = new Set(Array.from(body.querySelectorAll('.parallx-mindmap__node[data-mm-line]'))
            .map((g) => Number(g.getAttribute('data-mm-line'))));
          for (const l of [...selected]) if (!drawn.has(l)) selected.delete(l);
          paintSelection();
          if (refocusMap) {
            refocusMap = false;
            body.focus({ preventScroll: true });
          }
        }
      };

      render();

      return {
        dom,
        update: (updated: { type: { name: string }; attrs: Record<string, unknown> }) => {
          if (updated.type.name !== 'conceptMap') return false;
          attrs = readAttrs(updated.attrs);
          render();
          return true;
        },
        // Without these, the block is DEAD to the pointer: ProseMirror
        // turns a mousedown on the tools into a node SELECTION, and every
        // innerHTML rewrite triggers a reconciliation that clobbers the
        // NodeView's DOM (the mathBlock precedent returns both).
        // Undo and redo pressed on the map are the page's, so they pass.
        stopEvent: (event: Event) => {
          if (editing || boxEditTeardown) return true;
          const t = event.target as HTMLElement | null;
          if (!t?.closest?.('.canvas-conceptmap__tools, .canvas-conceptmap__editor, .canvas-conceptmap__add, .canvas-conceptmap__boxedit, .canvas-conceptmap__body')) return false;
          if (event.type === 'keydown') {
            const k = event as KeyboardEvent;
            if ((k.ctrlKey || k.metaKey) && /^[zy]$/i.test(k.key)) return false;
          }
          return true;
        },
        ignoreMutation: () => true,
        destroy: () => {
          if (boxEditTeardown) {
            const teardown = boxEditTeardown;
            boxEditTeardown = null;
            teardown();
          }
        },
      };
    };
  },
});
