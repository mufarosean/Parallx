// canvasStructuralInvariants.ts — structural invariant validation + diagnostics
//
// Provides a schema-aware, model-driven validation layer for Canvas documents.
// These checks are intentionally conservative and focus on stable structural
// guarantees rather than transient UI behavior.

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface CanvasInvariantIssue {
  code: string;
  message: string;
  path: string;
  nodeType: string;
  suggestion: string;
}

interface TraversalContext {
  node: ProseMirrorNode;
  parent: ProseMirrorNode | null;
  path: number[];
}

const CANVAS_DEV_MODE = (() => {
  if (typeof window !== 'undefined' && (window as any).parallxElectron?.testMode) {
    return true;
  }
  const proc = (globalThis as any).process;
  if (proc?.env?.NODE_ENV) {
    return proc.env.NODE_ENV !== 'production';
  }
  return true;
})();

function pathToString(path: number[]): string {
  return path.length ? path.join('.') : 'root';
}

function pushIssue(
  issues: CanvasInvariantIssue[],
  ctx: TraversalContext,
  code: string,
  message: string,
  suggestion: string,
): void {
  issues.push({
    code,
    message,
    path: pathToString(ctx.path),
    nodeType: ctx.node.type.name,
    suggestion,
  });
}

function traverse(
  node: ProseMirrorNode,
  parent: ProseMirrorNode | null,
  path: number[],
  visit: (ctx: TraversalContext) => void,
): void {
  visit({ node, parent, path });
  node.forEach((child, _offset, index) => {
    traverse(child, node, [...path, index], visit);
  });
}

function validateColumnList(ctx: TraversalContext, issues: CanvasInvariantIssue[]): void {
  const { node } = ctx;

  if (node.childCount < 2) {
    pushIssue(
      issues,
      ctx,
      'PX-COL-001',
      'columnList has fewer than 2 columns and should be dissolved.',
      'Run/ensure dissolve normalization after column mutations.',
    );
  }

  node.forEach((child, _offset, index) => {
    if (child.type.name !== 'column') {
      issues.push({
        code: 'PX-COL-002',
        message: `columnList child at index ${index} must be a column node.`,
        path: pathToString([...ctx.path, index]),
        nodeType: child.type.name,
        suggestion: 'Only insert column nodes into columnList containers.',
      });
    }
  });
}

function validateColumn(ctx: TraversalContext, issues: CanvasInvariantIssue[]): void {
  const { parent } = ctx;

  if (!parent || parent.type.name !== 'columnList') {
    pushIssue(
      issues,
      ctx,
      'PX-COL-003',
      'column must be a direct child of columnList.',
      'Move/unwrap column content into a valid parent and remove orphan columns.',
    );
  }
}

function validateDetails(ctx: TraversalContext, issues: CanvasInvariantIssue[]): void {
  const { node } = ctx;

  if (node.childCount !== 2) {
    pushIssue(
      issues,
      ctx,
      'PX-DET-001',
      'details must contain exactly 2 children: detailsSummary + detailsContent.',
      'Normalize details node shape during conversion/migration.',
    );
    return;
  }

  if (node.child(0).type.name !== 'detailsSummary') {
    issues.push({
      code: 'PX-DET-002',
      message: 'details first child must be detailsSummary.',
      path: pathToString([...ctx.path, 0]),
      nodeType: node.child(0).type.name,
      suggestion: 'Ensure detailsSummary is first child in details containers.',
    });
  }

  if (node.child(1).type.name !== 'detailsContent') {
    issues.push({
      code: 'PX-DET-003',
      message: 'details second child must be detailsContent.',
      path: pathToString([...ctx.path, 1]),
      nodeType: node.child(1).type.name,
      suggestion: 'Ensure detailsContent is second child in details containers.',
    });
  }
}

function validateToggleHeading(ctx: TraversalContext, issues: CanvasInvariantIssue[]): void {
  const { node } = ctx;
  const level = node.attrs?.level;

  if (![1, 2, 3].includes(level)) {
    pushIssue(
      issues,
      ctx,
      'PX-TGL-001',
      `toggleHeading level must be 1, 2, or 3 (found: ${String(level)}).`,
      'Clamp toggleHeading level to [1..3] during insertion and migration.',
    );
  }

  if (node.childCount !== 2) {
    pushIssue(
      issues,
      ctx,
      'PX-TGL-002',
      'toggleHeading must contain exactly 2 children: toggleHeadingText + detailsContent.',
      'Normalize toggleHeading node shape during conversion/migration.',
    );
    return;
  }

  if (node.child(0).type.name !== 'toggleHeadingText') {
    issues.push({
      code: 'PX-TGL-003',
      message: 'toggleHeading first child must be toggleHeadingText.',
      path: pathToString([...ctx.path, 0]),
      nodeType: node.child(0).type.name,
      suggestion: 'Ensure toggleHeadingText is first child in toggleHeading nodes.',
    });
  }

  if (node.child(1).type.name !== 'detailsContent') {
    issues.push({
      code: 'PX-TGL-004',
      message: 'toggleHeading second child must be detailsContent.',
      path: pathToString([...ctx.path, 1]),
      nodeType: node.child(1).type.name,
      suggestion: 'Ensure detailsContent is second child in toggleHeading nodes.',
    });
  }
}

function validateDetailSubnodes(ctx: TraversalContext, issues: CanvasInvariantIssue[]): void {
  const { node, parent } = ctx;

  if (node.type.name === 'detailsSummary') {
    if (!parent || parent.type.name !== 'details') {
      pushIssue(
        issues,
        ctx,
        'PX-DET-004',
        'detailsSummary must be a direct child of details.',
        'Reparent or rebuild malformed details structures.',
      );
    }
    return;
  }

  if (node.type.name === 'detailsContent') {
    const parentType = parent?.type.name;
    if (parentType !== 'details' && parentType !== 'toggleHeading') {
      pushIssue(
        issues,
        ctx,
        'PX-DET-005',
        'detailsContent must be a child of details or toggleHeading.',
        'Reparent detailsContent under a valid container.',
      );
    }
  }
}

function validateCallout(ctx: TraversalContext, issues: CanvasInvariantIssue[]): void {
  const { node } = ctx;

  if (node.childCount === 0) {
    pushIssue(
      issues,
      ctx,
      'PX-CAL-001',
      'callout must contain at least one block child.',
      'Insert a paragraph into empty callout nodes during normalization.',
    );
  }
}

function validateTable(ctx: TraversalContext, issues: CanvasInvariantIssue[]): void {
  const { node } = ctx;

  if (node.childCount === 0) {
    pushIssue(
      issues,
      ctx,
      'PX-TBL-001',
      'table must contain at least one row.',
      'Insert a default row into empty table nodes.',
    );
    return;
  }

  // First row cells should be tableHeader, not tableCell
  const firstRow = node.child(0);
  if (firstRow.type.name === 'tableRow' && firstRow.childCount > 0) {
    const firstCell = firstRow.child(0);
    if (firstCell.type.name !== 'tableHeader') {
      pushIssue(
        issues,
        ctx,
        'PX-TBL-002',
        'table first row should contain tableHeader cells, not tableCell.',
        'Convert first-row tableCells to tableHeader during table creation/migration.',
      );
    }
  }

  // All children must be tableRow
  node.forEach((child, _offset, index) => {
    if (child.type.name !== 'tableRow') {
      issues.push({
        code: 'PX-TBL-003',
        message: `table child at index ${index} must be a tableRow node.`,
        path: pathToString([...ctx.path, index]),
        nodeType: child.type.name,
        suggestion: 'Only insert tableRow nodes into table containers.',
      });
    }
  });
}

function validatePageBlock(ctx: TraversalContext, issues: CanvasInvariantIssue[]): void {
  const { node } = ctx;
  const pageId = node.attrs?.pageId;

  if (!pageId || (typeof pageId === 'string' && pageId.trim() === '')) {
    pushIssue(
      issues,
      ctx,
      'PX-PGB-001',
      'pageBlock must have a non-empty pageId attribute.',
      'Ensure pageBlock is created with a valid pageId from CanvasDataService.',
    );
  }
}

export function validateCanvasStructuralInvariants(doc: ProseMirrorNode): CanvasInvariantIssue[] {
  const issues: CanvasInvariantIssue[] = [];

  traverse(doc, null, [], (ctx) => {
    const nodeType = ctx.node.type.name;

    if (nodeType === 'columnList') {
      validateColumnList(ctx, issues);
    } else if (nodeType === 'column') {
      validateColumn(ctx, issues);
    } else if (nodeType === 'details') {
      validateDetails(ctx, issues);
    } else if (nodeType === 'toggleHeading') {
      validateToggleHeading(ctx, issues);
    } else if (nodeType === 'callout') {
      validateCallout(ctx, issues);
    } else if (nodeType === 'table') {
      validateTable(ctx, issues);
    } else if (nodeType === 'pageBlock') {
      validatePageBlock(ctx, issues);
    }

    if (nodeType === 'detailsSummary' || nodeType === 'detailsContent') {
      validateDetailSubnodes(ctx, issues);
    }
  });

  return issues;
}

export function issueFingerprint(issues: CanvasInvariantIssue[]): string {
  return issues
    .map((issue) => `${issue.code}@${issue.path}`)
    .sort()
    .join('|');
}

export function reportCanvasInvariantIssues(
  issues: CanvasInvariantIssue[],
  context: { source: string; docVersion: number },
): void {
  if (!CANVAS_DEV_MODE || issues.length === 0) return;

  const header = `[Canvas Invariants] ${issues.length} issue(s) after ${context.source} (doc version ${context.docVersion})`;

  console.groupCollapsed(header);
  for (const issue of issues.slice(0, 50)) {
    console.error(`${issue.code} [${issue.path}] ${issue.message} (${issue.nodeType})`);
    console.info(`Fix: ${issue.suggestion}`);
  }
  if (issues.length > 50) {
    console.warn(`[Canvas Invariants] ${issues.length - 50} additional issue(s) omitted from console output.`);
  }
  console.groupEnd();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('parallx:canvas-structural-invariants', {
      detail: {
        context,
        issues,
      },
    }));
  }
}
