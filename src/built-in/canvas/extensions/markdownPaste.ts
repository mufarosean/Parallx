// markdownPaste.ts — Markdown pasted as plain text becomes blocks.
//
// Copying from a chat (its Copy button), a .md file or a code editor gives
// the clipboard Markdown as plain text, and the page took it literally:
// "## Heading", "- item" and "**bold**" as characters, fixed by hand every
// day. When the clipboard has Markdown and no rich HTML of its own, it is
// read with the page's own parser (markdownImport.ts, the inverse of the
// Markdown export) and inserted as blocks. A rich paste stays as it was, and
// so does any paste into a code block.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { markdownToTiptapJson, type TipTapNode } from '../markdownImport.js';

/** Block syntax at the start of a line: a heading, list, quote, fence, math, table or rule. */
const BLOCK_LINE = /^(#{1,6}\s+\S|\s*[-*+]\s+\S|\s*\d+[.)]\s+\S|>\s?|```|\$\$|\s*\|.*\|\s*$|(-{3,}|\*{3,})\s*$)/m;
/** Inline syntax: bold, inline code, a link or inline math. */
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\$[^$\n]+\$)/;

/** Whether pasted plain text reads as Markdown worth turning into blocks. */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false;
  return BLOCK_LINE.test(text) || INLINE.test(text);
}

/**
 * The nodes to insert for a paste, or null to leave the paste alone: no
 * Markdown, or the clipboard carries rich HTML of its own (a browser or Word
 * copy). A code editor's HTML (VS Code puts its own data beside it) is only
 * styling, so its plain text counts.
 */
export function markdownPasteContent(types: readonly string[], text: string): TipTapNode[] | null {
  const rich = types.includes('text/html') && !types.includes('vscode-editor-data');
  if (rich || !looksLikeMarkdown(text)) return null;
  const blocks = markdownToTiptapJson(text).content ?? [];
  if (!blocks.length) return null;
  // One paragraph is inline text: it joins the line being typed instead of breaking it.
  return blocks.length === 1 && blocks[0].type === 'paragraph' ? (blocks[0].content ?? []) : blocks;
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('canvasMarkdownPaste'),
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data || view.state.selection.$from.parent.type.spec.code) return false;
            const types = Array.from(data.types ?? []);
            if (!types.includes('text/html') && data.getData('text/html')) types.push('text/html');
            const nodes = markdownPasteContent(types, data.getData('text/plain'));
            if (!nodes) return false;
            event.preventDefault();
            return editor.chain().focus().insertContent(nodes).run();
          },
        },
      }),
    ];
  },
});
