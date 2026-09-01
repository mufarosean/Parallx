// conceptMapNode.ts — the concept map as a canvas block.
//
// The chat pattern, kept and made savable: the model writes an indented
// OUTLINE, the shared renderer (ui/conceptMap) draws it, and editing
// CONTENT means editing the outline text. LAYOUT, though, is the
// user's to adjust: drag a box to move it, drag its right edge to
// resize (text re-wraps). Adjustments live as OVERRIDES keyed by label,
// deltas over the computed layout — rename a node in the outline and
// its override quietly evaporates back to auto layout. The outline can
// never drift because it never carries geometry.
//
// Attrs: { src, dir, overrides: { [label]: { dx, dy, w } } }.

import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import {
  appendChildToOutline,
  hubPathsFor,
  parseMindMap,
  renderMindMapSvg,
  type EdgeBox,
  type HubChild,
  type MindMapDirection,
  type MindMapNode,
  type MindMapOverrides,
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

      const readAttrs = (a: Record<string, unknown>) => ({
        src: String(a.src ?? ''),
        dir: (a.dir === 'down' ? 'down' : 'right') as MindMapDirection,
        overrides: (a.overrides && typeof a.overrides === 'object' ? a.overrides : {}) as MindMapOverrides,
      });
      let attrs = readAttrs(node.attrs);
      let editing = false;

      const commit = (patch: Partial<{ src: string; dir: MindMapDirection; overrides: MindMapOverrides }>): void => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const next = { ...attrs, ...patch };
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, next));
      };

      /** One map node's <g> + box rect + label, from a pointer target. */
      const nodeParts = (target: EventTarget | null): { g: SVGGElement; rect: SVGRectElement; label: string } | null => {
        const g = (target as HTMLElement | null)?.closest?.('.parallx-mindmap__node') as SVGGElement | null;
        const rect = g?.querySelector('.parallx-mindmap__box') as SVGRectElement | null;
        const label = g?.getAttribute('data-mindmap-label') ?? '';
        return g && rect && label ? { g, rect, label } : null;
      };

      const startEdit = (): void => {
        editing = true;
        render();
      };

      /** Every box's geometry by label, read from the live SVG rects. */
      const boxGeoms = (root: HTMLElement): Map<string, EdgeBox> => {
        const out = new Map<string, EdgeBox>();
        for (const g of Array.from(root.querySelectorAll('.parallx-mindmap__node[data-mindmap-label]'))) {
          const rect = g.querySelector('.parallx-mindmap__box') as SVGRectElement | null;
          const label = g.getAttribute('data-mindmap-label');
          if (!rect || !label) continue;
          const x = Number(rect.getAttribute('x')) || 0;
          const y = Number(rect.getAttribute('y')) || 0;
          const width = Number(rect.getAttribute('width')) || 0;
          const height = Number(rect.getAttribute('height')) || 0;
          out.set(label, { x, y: y + height / 2, width, height });
        }
        return out;
      };

      /** Drag = move (recorded as an override); a still click = edit. */
      const beginBoxDrag = (e: PointerEvent | MouseEvent, parts: { g: SVGGElement; label: string }): void => {
        const startX = e.clientX;
        const startY = e.clientY;
        let lastX = startX;
        let lastY = startY;
        let moved = false;
        // The BOX moves by per-frame attribute updates, never a transform:
        // Chromium can stall repaints of transformed groups that contain a
        // foreignObject (formula boxes froze while their edges moved).
        const movables = (Array.from(parts.g.children) as SVGGraphicsElement[])
          .filter((el) => el.tagName === 'rect' || el.tagName === 'text' || el.tagName === 'foreignObject')
          .map((el) => ({
            el,
            baseX: Number(el.getAttribute('x')) || 0,
            baseY: Number(el.getAttribute('y')) || 0,
          }));
        const moveBox = (dx: number, dy: number): void => {
          for (const m of movables) {
            m.el.setAttribute('x', String(m.baseX + dx));
            m.el.setAttribute('y', String(m.baseY + dy));
          }
        };
        // HUBS touching the dragged box re-route LIVE: the box's own hub
        // (it is a parent) and its parent's hub (it is a child). Without
        // this the lines freeze mid-air and the drag feels broken.
        const svgRoot = parts.g.ownerSVGElement as unknown as HTMLElement | null;
        const geoms = svgRoot ? boxGeoms(svgRoot) : new Map<string, EdgeBox>();
        const baseGeom = geoms.get(parts.label);
        // Parent/children relations come from the OUTLINE (the one truth).
        const kidsOf = new Map<string, string[]>();
        const parentOf = new Map<string, string>();
        const walk = (n: MindMapNode): void => {
          kidsOf.set(n.label, n.children.map((c) => c.label));
          for (const c of n.children) { parentOf.set(c.label, n.label); walk(c); }
        };
        for (const r of parseMindMap(attrs.src)) walk(r);
        const affectedHubs = new Set<string>();
        if ((kidsOf.get(parts.label) ?? []).length > 0) affectedHubs.add(parts.label);
        const myParent = parentOf.get(parts.label);
        if (myParent) affectedHubs.add(myParent);
        const hubPathEls = svgRoot
          ? (Array.from(svgRoot.querySelectorAll('path[data-mm-hub]')) as SVGPathElement[])
              .filter((path) => affectedHubs.has(path.getAttribute('data-mm-hub') ?? ''))
              .map((path) => ({ path, baseD: path.getAttribute('d') ?? '' }))
          : [];
        const touching = hubPathEls;
        const colorOf = (label: string): number => {
          const g = svgRoot?.querySelector(`.parallx-mindmap__node[data-mindmap-label="${CSS.escape(label)}"]`);
          const m = /parallx-mindmap__node--b(\d)/.exec(g?.getAttribute('class') ?? '');
          return m ? Number(m[1]) : 0;
        };
        const rerouteEdges = (dx: number, dy: number): void => {
          if (!baseGeom || !svgRoot) return;
          const geomOf = (label: string): EdgeBox | undefined =>
            label === parts.label
              ? { ...baseGeom, x: baseGeom.x + dx, y: baseGeom.y + dy }
              : geoms.get(label);
          for (const hubLabel of affectedHubs) {
            const parentGeom = geomOf(hubLabel);
            const kidLabels = kidsOf.get(hubLabel) ?? [];
            if (!parentGeom || kidLabels.length === 0) continue;
            const kids: HubChild[] = [];
            for (const k of kidLabels) {
              const g = geomOf(k);
              if (g) kids.push({ ...g, label: k, color: colorOf(k) });
            }
            const hubs = hubPathsFor(parentGeom, kids, attrs.dir);
            // Repaint this hub's path elements in emission order:
            // stem, spine?, arms — matching the renderer's order.
            const els = hubPathEls.filter(({ path }) => path.getAttribute('data-mm-hub') === hubLabel);
            let i = 0;
            for (const hub of hubs) {
              if (els[i]) els[i++].path.setAttribute('d', hub.stem);
              if (hub.spine && els[i]) els[i++].path.setAttribute('d', hub.spine);
              for (const arm of hub.arms) {
                if (els[i]) els[i++].path.setAttribute('d', arm.d);
              }
            }
            // A drag can shrink the hub's shape (side flip mid-drag);
            // blank the leftovers so no stale segment hangs in the air.
            for (; i < els.length; i++) els[i].path.setAttribute('d', '');
          }
        };
        beginPointerDrag(e, {
          id: 'conceptmap-move',
          cursor: 'grabbing',
          onMove: (ev) => {
            lastX = ev.clientX;
            lastY = ev.clientY;
            const dx = lastX - startX;
            const dy = lastY - startY;
            if (!moved && Math.hypot(dx, dy) < CLICK_DIST) return;
            moved = true;
            moveBox(dx, dy);
            rerouteEdges(dx, dy);
          },
          onEnd: (canceled) => {
            if (canceled || !moved) {
              moveBox(0, 0);
              for (const { path, baseD } of touching) path.setAttribute('d', baseD);
            }
            if (canceled) return;
            if (!moved) { startEdit(); return; }
            const dx = lastX - startX;
            const dy = lastY - startY;
            const prev = attrs.overrides[parts.label] ?? {};
            commit({
              overrides: {
                ...attrs.overrides,
                [parts.label]: { ...prev, dx: (prev.dx ?? 0) + dx, dy: (prev.dy ?? 0) + dy },
              },
            });
          },
        });
      };

      /** The right-edge grip resizes; text re-wraps on commit. */
      const beginBoxResize = (e: PointerEvent | MouseEvent, parts: { rect: SVGRectElement; label: string }): void => {
        const startX = e.clientX;
        const startW = Number(parts.rect.getAttribute('width')) || 120;
        let w = startW;
        beginPointerDrag(e, {
          id: 'conceptmap-resize',
          cursor: 'ew-resize',
          onMove: (ev) => {
            w = Math.max(80, Math.min(420, Math.round(startW + (ev.clientX - startX))));
            parts.rect.setAttribute('width', String(w));
          },
          onEnd: (canceled) => {
            if (canceled || w === startW) { render(); return; }
            const prev = attrs.overrides[parts.label] ?? {};
            commit({ overrides: { ...attrs.overrides, [parts.label]: { ...prev, w } } });
          },
        });
      };

      const render = (): void => {
        dom.classList.toggle('is-editing', editing);
        dom.innerHTML = '';

        const tools = document.createElement('div');
        tools.classList.add('canvas-conceptmap__tools');

        const dirBtn = document.createElement('button');
        dirBtn.classList.add('canvas-conceptmap__tool');
        dirBtn.type = 'button';
        dirBtn.textContent = attrs.dir === 'right' ? 'Vertical' : 'Horizontal';
        dirBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          commit({ dir: attrs.dir === 'right' ? 'down' : 'right' });
        });
        tools.appendChild(dirBtn);

        if (Object.keys(attrs.overrides).length > 0 && !editing) {
          const resetBtn = document.createElement('button');
          resetBtn.classList.add('canvas-conceptmap__tool');
          resetBtn.type = 'button';
          resetBtn.textContent = 'Reset Layout';
          resetBtn.title = 'Drop every moved or resized box back to the automatic layout';
          resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            commit({ overrides: {} });
          });
          tools.appendChild(resetBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.classList.add('canvas-conceptmap__tool');
        editBtn.type = 'button';
        editBtn.textContent = editing ? 'Done' : 'Edit Outline';
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
          hint.textContent = 'One idea per line; indent to nest. **bold**, *italic*, `code`, and $x^2$ all render. On the map: drag a box to move it, drag its right edge to resize.';
          dom.appendChild(hint);
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editing = false;
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
            renderMath,
            overrides: attrs.overrides,
          });
          // Pointer contract: press a box and drag to MOVE it; press its
          // right edge to RESIZE; a still click opens the outline.
          // Hover affordances: the add-child "+" follows the hovered box,
          // and the cursor tells the contract (grab body, ew-resize edge).
          const addBtn = document.createElement('button');
          addBtn.classList.add('canvas-conceptmap__add');
          addBtn.type = 'button';
          addBtn.textContent = '+';
          addBtn.title = 'Add A Child Idea';
          addBtn.hidden = true;
          let addTarget = '';
          addBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
          addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!addTarget) return;
            const next = appendChildToOutline(attrs.src, addTarget, 'New idea');
            if (next) commit({ src: next });
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
            addTarget = parts.label;
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
          body.addEventListener('pointerdown', (e) => {
            if ((e as MouseEvent).button !== 0) return;
            const parts = nodeParts(e.target);
            if (!parts) return;
            e.preventDefault();
            e.stopPropagation();
            const rectRight = parts.rect.getBoundingClientRect().right;
            if (rectRight - e.clientX <= RESIZE_EDGE_PX) beginBoxResize(e, parts);
            else beginBoxDrag(e, parts);
          });
          dom.appendChild(body);
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
        stopEvent: (event: Event) => {
          if (editing) return true;
          const t = event.target as HTMLElement | null;
          return !!t?.closest?.('.canvas-conceptmap__tool, .canvas-conceptmap__editor, .canvas-conceptmap__add, .parallx-mindmap__node');
        },
        ignoreMutation: () => true,
      };
    };
  },
});
