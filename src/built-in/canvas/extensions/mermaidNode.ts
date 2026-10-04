// mermaidNode.ts — Mermaid diagram: diagram code, drawn as a picture
//
// Shows the drawn diagram. Double-click it (or Edit Diagram…) to edit the code with
// the drawing updating beside it; Done or a click outside keeps the change,
// Escape drops it. A mistake in the code shows Mermaid's message instead of
// the drawing, and the code is kept as typed.
//
// Mermaid is loaded on first use from its own bundle (mermaidHost.ts), and
// draws in the app's light or dark look, redrawing when the mode changes.

import { Node, mergeAttributes } from '@tiptap/core';
import { blockEditButton, setBlockAttrs, focusBlock } from './liveBlock.js';

export const MERMAID_SAMPLE = 'flowchart LR\n  A[Idea] --> B[Draft]\n  B --> C[Done]';

type MermaidModule = { renderMermaid(code: string, theme: 'dark' | 'default'): Promise<{ svg: string } | { error: string }> };
let loading: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
  if (!loading) {
    // Computed at runtime so esbuild does not inline mermaid into main.js.
    const url = new URL('dist/renderer/canvas-mermaid.js', document.baseURI).href;
    loading = (import(/* webpackIgnore: true */ url) as Promise<MermaidModule>).catch((err) => { loading = null; throw err; });
  }
  return loading;
}

/** Light pages get Mermaid's default look, dark ones its dark look. Read
 *  from the colour the page is actually painted with: the app does not
 *  always mark its mode on the root (dark mode drew pale boxes and arrows
 *  that could not be seen). */
export function mermaidTheme(background: string = getComputedStyle(document.body).backgroundColor): 'dark' | 'default' {
  const m = background.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return 'dark';
  if (m[4] !== undefined && Number(m[4]) === 0) return 'dark';
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.5 ? 'default' : 'dark';
}

async function draw(target: HTMLElement, code: string): Promise<void> {
  if (!code.trim()) {
    target.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'canvas-mermaid__message';
    empty.textContent = 'Empty diagram. Click to write one.';
    target.appendChild(empty);
    return;
  }
  try {
    const mod = await loadMermaid();
    const result = await mod.renderMermaid(code, mermaidTheme());
    target.innerHTML = '';
    if ('svg' in result) {
      // Mermaid ran with securityLevel "strict" (sanitized SVG).
      target.innerHTML = result.svg;
    } else {
      const msg = document.createElement('pre');
      msg.className = 'canvas-mermaid__message canvas-mermaid__message--error';
      msg.textContent = result.error;
      target.appendChild(msg);
    }
  } catch {
    target.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'canvas-mermaid__message canvas-mermaid__message--error';
    msg.textContent = 'Diagrams cannot be drawn here.';
    target.appendChild(msg);
  }
}

export const MermaidDiagram = Node.create({
  name: 'mermaidDiagram',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { code: { default: MERMAID_SAMPLE } };
  },

  parseHTML() { return [{ tag: 'div[data-type="mermaidDiagram"]' }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaidDiagram', class: 'canvas-mermaid' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }: any) => {
      let current = node;
      let editing = false;
      const dom = document.createElement('div');
      dom.className = 'canvas-mermaid';
      dom.setAttribute('data-type', 'mermaidDiagram');
      dom.contentEditable = 'false';

      const preview = document.createElement('div');
      preview.className = 'canvas-mermaid__preview';
      preview.setAttribute('role', 'img');
      const bar = document.createElement('div');
      bar.className = 'canvas-mermaid__bar';
      const edit = blockEditButton('Edit Diagram…');
      bar.appendChild(edit);
      dom.append(bar, preview);

      let drawSeq = 0;
      const redraw = (code: string): void => {
        const mine = ++drawSeq;
        const target = document.createElement('div');
        void draw(target, code).then(() => {
          if (mine !== drawSeq) return;
          preview.replaceChildren(...target.childNodes);
          preview.setAttribute('aria-label', `Diagram: ${code.split('\n')[0] ?? ''}`);
        });
      };

      let editor$: HTMLElement | null = null;
      const close = (keep: boolean, text?: string): void => {
        if (!editing) return;
        editing = false;
        dom.classList.remove('canvas-mermaid--editing');
        editor$?.remove();
        editor$ = null;
        if (keep && text !== undefined && text !== current.attrs.code) setBlockAttrs(editor, getPos, { code: text });
        else redraw(String(current.attrs.code ?? ''));
        // Done or Escape left focus nowhere: back to the block. A click elsewhere keeps its place.
        if (!document.activeElement || document.activeElement === document.body) focusBlock(editor, getPos);
      };
      const open = (): void => {
        if (editing || !editor.isEditable) return;
        editing = true;
        dom.classList.add('canvas-mermaid--editing');
        const pane = document.createElement('div');
        pane.className = 'canvas-mermaid__editor';
        const area = document.createElement('textarea');
        area.className = 'canvas-mermaid__code';
        area.value = String(current.attrs.code ?? '');
        area.spellcheck = false;
        area.setAttribute('aria-label', 'Diagram code');
        const actions = document.createElement('div');
        actions.className = 'canvas-mermaid__actions';
        const hint = document.createElement('span');
        hint.className = 'canvas-mermaid__hint';
        hint.textContent = 'Mermaid syntax. Escape to cancel.';
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'canvas-live-popover__primary';
        done.textContent = 'Done';
        done.addEventListener('mousedown', (e) => e.preventDefault());
        done.addEventListener('click', () => close(true, area.value));
        actions.append(hint, done);
        pane.append(area, actions);
        dom.insertBefore(pane, preview);
        editor$ = pane;
        let t: ReturnType<typeof setTimeout> | null = null;
        area.addEventListener('input', () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => redraw(area.value), 350);
        });
        area.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); close(true, area.value); }
        });
        area.addEventListener('blur', () => {
          // Leaving the code keeps it (unless focus moved to Done, which handles it).
          setTimeout(() => { if (editing && !pane.contains(document.activeElement)) close(true, area.value); }, 0);
        });
        area.focus();
      };
      edit.addEventListener('click', open);
      preview.addEventListener('dblclick', open);

      // Redraw in the other look when the app switches light and dark.
      let theme = mermaidTheme();
      const observer = new MutationObserver(() => {
        const next = mermaidTheme();
        if (next !== theme) { theme = next; redraw(String(current.attrs.code ?? '')); }
      });
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.body, { attributes: true });

      redraw(String(current.attrs.code ?? ''));

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== 'mermaidDiagram') return false;
          const changed = updated.attrs.code !== current.attrs.code;
          current = updated;
          if (changed && !editing) redraw(String(updated.attrs.code ?? ''));
          return true;
        },
        stopEvent: (e: Event) => {
          const t = e.target as HTMLElement | null;
          return !!t && (!!t.closest?.('.canvas-mermaid__editor') || !!t.closest?.('button') || (e.type === 'dblclick'));
        },
        ignoreMutation: () => true,
        destroy() { observer.disconnect(); },
      };
    };
  },
});
