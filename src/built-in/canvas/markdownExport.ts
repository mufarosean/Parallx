// markdownExport.ts — TipTap JSON → Markdown converter for Canvas pages
//
// Handles all current block types: paragraph, heading, bulletList, orderedList,
// taskList, blockquote, codeBlock, horizontalRule, callout, details, table, image.
// Inline marks: bold, italic, strike, underline, code, link, highlight.
//
// No external dependencies — pure string transformation.

// ─── Types for TipTap JSON AST ──────────────────────────────────────────────

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert a TipTap JSON document to a Markdown string.
 *
 * @param doc — The TipTap JSON object (type: 'doc')
 * @param title — Optional page title to prepend as H1
 * @returns Markdown string
 */
export function tiptapJsonToMarkdown(doc: unknown, title?: string): string {
  const root = doc as TipTapNode;
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) {
    return title ? `# ${title}\n` : '';
  }

  const lines: string[] = [];

  if (title) {
    lines.push(`# ${title}`);
    lines.push('');
  }

  for (const node of root.content) {
    lines.push(renderNode(node, 0));
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ─── Node Rendering ──────────────────────────────────────────────────────────

function renderNode(node: TipTapNode, depth: number): string {
  switch (node.type) {
    case 'paragraph':
      return renderInlineContent(node.content) + '\n';

    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      const prefix = '#'.repeat(Math.min(level, 6));
      return `${prefix} ${renderInlineContent(node.content)}\n`;
    }

    case 'bulletList':
      return renderList(node, depth, 'bullet');

    case 'orderedList':
      return renderList(node, depth, 'ordered');

    case 'taskList':
      return renderList(node, depth, 'task');

    case 'listItem':
      return renderListItem(node, depth);

    case 'taskItem': {
      const checked = node.attrs?.checked ? 'x' : ' ';
      const indent = '  '.repeat(depth);
      // taskItem content is typically [paragraph, ...] — unwrap the first paragraph
      const children = node.content || [];
      const firstPara = children.find(c => c.type === 'paragraph');
      const content = firstPara
        ? renderInlineContent(firstPara.content)
        : renderInlineContent(children);
      return `${indent}- [${checked}] ${content}`;
    }

    case 'blockquote': {
      const inner = (node.content || [])
        .map(child => renderNode(child, depth))
        .join('')
        .trimEnd();
      return inner.split('\n').map(line => `> ${line}`).join('\n') + '\n';
    }

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) || '';
      const code = renderPlainText(node.content);
      return `\`\`\`${lang}\n${code}\n\`\`\`\n`;
    }

    case 'horizontalRule':
      return '---\n';

    case 'callout': {
      const iconLabel = (node.attrs?.emoji as string) || 'lightbulb';
      // Use a text prefix instead of emoji in markdown output
      const prefix = iconLabel === 'lightbulb' ? 'Note' : iconLabel.charAt(0).toUpperCase() + iconLabel.slice(1);
      const inner = (node.content || [])
        .map(child => renderNode(child, depth))
        .join('')
        .trimEnd();
      return inner.split('\n').map((line, i) => i === 0 ? `> **${prefix}:** ${line}` : `> ${line}`).join('\n') + '\n';
    }

    case 'details': {
      // Details block: first child is summary, rest is content
      const children = node.content || [];
      const summaryNode = children.find(c => c.type === 'detailsSummary');
      const contentNodes = children.filter(c => c.type === 'detailsContent');

      const summaryText = summaryNode ? renderInlineContent(summaryNode.content) : 'Details';
      const contentText = contentNodes
        .flatMap(cn => (cn.content || []).map(child => renderNode(child, depth)))
        .join('')
        .trimEnd();

      return `<details>\n<summary>${summaryText}</summary>\n\n${contentText}\n</details>\n`;
    }

    case 'detailsSummary':
      return renderInlineContent(node.content);

    case 'detailsContent':
      return (node.content || []).map(child => renderNode(child, depth)).join('');

    case 'table':
      return renderTable(node);

    case 'image': {
      const src = (node.attrs?.src as string) || '';
      const alt = (node.attrs?.alt as string) || '';
      return `![${alt}](${src})\n`;
    }

    default:
      // Fallback: render content inline if present
      if (node.content) {
        return (node.content).map(child => renderNode(child, depth)).join('');
      }
      return node.text ? renderTextWithMarks(node) : '';
  }
}

// ─── List Rendering ──────────────────────────────────────────────────────────

function renderList(node: TipTapNode, depth: number, style: 'bullet' | 'ordered' | 'task'): string {
  const items = node.content || [];
  const lines: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const indent = '  '.repeat(depth);

    if (style === 'task' || item.type === 'taskItem') {
      lines.push(renderNode({ ...item, type: 'taskItem' }, depth));
    } else {
      const prefix = style === 'ordered' ? `${i + 1}.` : '-';
      const content = renderListItemContent(item, depth);
      lines.push(`${indent}${prefix} ${content}`);
    }
  }

  return lines.join('\n') + '\n';
}

function renderListItem(node: TipTapNode, depth: number): string {
  return renderListItemContent(node, depth);
}

function renderListItemContent(node: TipTapNode, depth: number): string {
  if (!node.content) return '';

  const parts: string[] = [];
  for (const child of node.content) {
    if (child.type === 'paragraph') {
      parts.push(renderInlineContent(child.content));
    } else if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
      parts.push('\n' + renderList(child, depth + 1, child.type === 'orderedList' ? 'ordered' : child.type === 'taskList' ? 'task' : 'bullet'));
    } else {
      parts.push(renderNode(child, depth));
    }
  }

  return parts.join('').trimEnd();
}

// ─── Inline Content Rendering ────────────────────────────────────────────────

function renderInlineContent(content: TipTapNode[] | undefined): string {
  if (!content) return '';
  return content.map(renderTextWithMarks).join('');
}

function renderTextWithMarks(node: TipTapNode): string {
  if (node.type === 'hardBreak') return '\n';

  // Non-text nodes embedded inline (e.g. image in paragraph)
  if (node.type === 'image') {
    const src = (node.attrs?.src as string) || '';
    const alt = (node.attrs?.alt as string) || '';
    return `![${alt}](${src})`;
  }

  let text = node.text || '';
  if (!text) return '';

  const marks = node.marks || [];
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        text = `**${text}**`;
        break;
      case 'italic':
        text = `*${text}*`;
        break;
      case 'strike':
        text = `~~${text}~~`;
        break;
      case 'underline':
        text = `<u>${text}</u>`;
        break;
      case 'code':
        text = `\`${text}\``;
        break;
      case 'link': {
        const href = (mark.attrs?.href as string) || '';
        text = `[${text}](${href})`;
        break;
      }
      case 'highlight':
        text = `==${text}==`;
        break;
      // Color and other marks — no standard markdown equivalent, skip
    }
  }

  return text;
}

function renderPlainText(content: TipTapNode[] | undefined): string {
  if (!content) return '';
  return content.map(node => node.text || '').join('');
}

// ─── Table Rendering ─────────────────────────────────────────────────────────

function renderTable(node: TipTapNode): string {
  const rows = node.content || [];
  if (rows.length === 0) return '';

  const tableData: string[][] = [];

  for (const row of rows) {
    const cells: string[] = [];
    for (const cell of row.content || []) {
      const cellText = (cell.content || [])
        .map(child => renderInlineContent(child.content))
        .join(' ')
        .replace(/\n/g, ' ')
        .trim();
      cells.push(cellText);
    }
    tableData.push(cells);
  }

  if (tableData.length === 0) return '';

  // Calculate column widths
  const colCount = Math.max(...tableData.map(r => r.length));
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    colWidths.push(Math.max(3, ...tableData.map(r => (r[c] || '').length)));
  }

  const lines: string[] = [];

  // Header row
  const header = tableData[0];
  lines.push('| ' + header.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ') + ' |');

  // Separator
  lines.push('| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |');

  // Body rows
  for (let r = 1; r < tableData.length; r++) {
    const row = tableData[r];
    lines.push('| ' + colWidths.map((w, i) => (row[i] || '').padEnd(w)).join(' | ') + ' |');
  }

  return lines.join('\n') + '\n';
}
