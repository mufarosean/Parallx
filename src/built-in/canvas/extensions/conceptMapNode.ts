// conceptMapNode.ts — the concept map as a canvas block.
//
// The chat pattern, kept and made savable: the model writes an indented
// OUTLINE, the shared renderer (ui/conceptMap) draws it, and editing
// CONTENT means editing the outline text. Editing happens IN THE BOX:
// click one and type, with markdown and math formatting live under the
// caret; the commit rewrites that box's own outline LINE. Line, not
// label, is a box's identity, so two boxes may share a name without
// ever editing each other. LAYOUT is the user's to adjust: drag a box
// to move it, drag its right edge to resize (text re-wraps).
// Adjustments live as OVERRIDES keyed by label, deltas over the
// computed layout — rename a node in the outline and its override
// quietly evaporates back to auto layout. The outline can never drift
// because it never carries geometry.
//
// Attrs: { src, dir, overrides: { [label]: { dx, dy, w } } }.

import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import {
  appendChildAtLine,
  caretSourceOffset,
  deleteOutlineSubtree,
  editorHtml,
  editorSignature,
  hubPathsFor,
  insertSiblingAfter,
  normalizeLabel,
  outlineLineText,
  parseMindMap,
  pruneOverrides,
  renderMindMapSvg,
  replaceOutlineLine,
  resolveSourceOffset,
  serializeEditorDom,
  type EdgeBox,
  type EditorCaret,
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
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, next));
      };

      /** One map node: its <g>, box rect, label, and SOURCE LINE. */
      type NodeParts = { g: SVGGElement; rect: SVGRectElement; label: string; line: number };
      const nodeParts = (target: EventTarget | null): NodeParts | null => {
        const g = (target as HTMLElement | null)?.closest?.('.parallx-mindmap__node') as SVGGElement | null;
        const rect = g?.querySelector('.parallx-mindmap__box') as SVGRectElement | null;
        const label = g?.getAttribute('data-mindmap-label') ?? '';
        const line = Number(g?.getAttribute('data-mm-line'));
        return g && rect && label && Number.isFinite(line) ? { g, rect, label, line } : null;
      };

      const startEdit = (): void => {
        editing = true;
        render();
      };

      /** The map's positioned host (overlay + hover button coordinates). */
      let mapHost: HTMLElement | null = null;

      /** A box's hue index, read off its node class (b0..b5). */
      const branchOfEl = (g: Element | null): number => {
        const m = /parallx-mindmap__node--b(\d)/.exec(g?.getAttribute('class') ?? '');
        return m ? Number(m[1]) : 0;
      };

      const boxCount = (outline: string): number => labelsOf(outline).length;

      /** Every label the outline would draw (duplicates included). */
      const labelsOf = (outline: string): string[] => {
        const out: string[] = [];
        const walk = (n: MindMapNode): void => { out.push(n.label); n.children.forEach(walk); };
        for (const r of parseMindMap(outline)) walk(r);
        return out;
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

      /** Drag = move (recorded as an override); a still click = edit in place. */
      const beginBoxDrag = (e: PointerEvent | MouseEvent, parts: NodeParts): void => {
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
            if (!moved) { beginBoxEdit(parts); return; }
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
        ed.classList.add('canvas-conceptmap__boxedit', `canvas-conceptmap__boxedit--b${spec.branch % 6}`);
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
          hint: 'Enter saves · Tab adds a child · Esc cancels · empty deletes',
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
            const prevOv = attrs.overrides[parts.label];
            let overrides = attrs.overrides;
            if (prevOv && newLabel !== parts.label) {
              const rest = { ...attrs.overrides } as Record<string, (typeof attrs.overrides)[string]>;
              delete rest[parts.label];
              const taken = labelsOf(next).filter((l) => l === newLabel).length > 1;
              overrides = taken || rest[newLabel] ? rest : { ...rest, [newLabel]: prevOv };
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
        const right = attrs.dir === 'right';
        const childSeat = right
          ? { left: rectB.right - hostB.left + 26, top: rectB.top - hostB.top }
          : { left: rectB.left - hostB.left + 14, top: rectB.bottom - hostB.top + 18 };
        const siblingSeat = right
          ? { left: rectB.left - hostB.left, top: rectB.bottom - hostB.top + 8 }
          : { left: rectB.right - hostB.left + 10, top: rectB.top - hostB.top };
        const seat = kind === 'child' ? childSeat : siblingSeat;
        openEditorOverlay({
          initial: '',
          selectAll: false,
          rect: { ...seat, width: 90, height: 24 },
          branch: branchOfEl(g),
          hint: 'Enter adds another · Tab adds a child · Esc closes',
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
            commit({ src: next });
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

        const dirBtn = document.createElement('button');
        dirBtn.classList.add('canvas-conceptmap__tool');
        dirBtn.type = 'button';
        dirBtn.textContent = attrs.dir === 'right' ? 'Vertical' : 'Horizontal';
        dirBtn.title = attrs.dir === 'right' ? 'Switch To A Top-Down Layout' : 'Switch To A Left-To-Right Layout';
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
          hint.textContent = 'One idea per line; indent to nest. **bold**, *italic*, `code`, and $x^2$ all render. On the map: click a box to edit it in place, drag to move it, drag its right edge to resize.';
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
          mapHost = body;
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
          if (editing || boxEditTeardown) return true;
          const t = event.target as HTMLElement | null;
          return !!t?.closest?.('.canvas-conceptmap__tool, .canvas-conceptmap__editor, .canvas-conceptmap__add, .canvas-conceptmap__boxedit, .parallx-mindmap__node');
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
