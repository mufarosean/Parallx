// Unit tests for canvas structural repair (M85 Fix A).
//
// Uses a minimal, permissive ProseMirror schema so we can *construct* the
// malformed docs the real canvas schema would forbid, then assert the repair
// normalizes them without dropping content.

import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { applyStructuralRepairs } from '../../src/built-in/canvas/plugins/structuralRepair';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    callout: { group: 'block', content: 'block*' },
    table: { group: 'block', content: 'block*' },
    tableRow: { group: 'block', content: 'block*' },
    pageBlock: { group: 'block', atom: true, attrs: { pageId: { default: '' } } },
    toggleHeading: { group: 'block', content: 'block*', attrs: { level: { default: 1 } } },
    toggleHeadingText: { group: 'block', content: 'inline*' },
    detailsContent: { group: 'block', content: 'block*' },
    details: { group: 'block', content: 'block*' },
    detailsSummary: { group: 'block', content: 'inline*' },
  },
});

const n = (type: string, attrs: any, ...children: any[]) =>
  schema.nodes[type].create(attrs, children.length ? children : undefined);
const para = (t?: string) => n('paragraph', null, ...(t ? [schema.text(t)] : []));

/** Run the repair on a doc; return the repaired doc + whether it changed. */
function repair(doc: any): { doc: any; changed: boolean } {
  const state = EditorState.create({ schema, doc });
  const tr = state.tr;
  const changed = applyStructuralRepairs(tr);
  return { doc: tr.doc, changed };
}

function typesOf(node: any): string[] {
  const out: string[] = [];
  node.forEach((c: any) => out.push(c.type.name));
  return out;
}

describe('applyStructuralRepairs', () => {
  it('inserts a paragraph into an empty callout', () => {
    const { doc, changed } = repair(n('doc', null, n('callout', null)));
    expect(changed).toBe(true);
    const callout = doc.child(0);
    expect(callout.type.name).toBe('callout');
    expect(callout.childCount).toBe(1);
    expect(callout.child(0).type.name).toBe('paragraph');
  });

  it('clamps an out-of-range toggleHeading level', () => {
    const tg = n('toggleHeading', { level: 7 }, n('toggleHeadingText', null), n('detailsContent', null, para('x')));
    const { doc, changed } = repair(n('doc', null, tg));
    expect(changed).toBe(true);
    expect(doc.child(0).attrs.level).toBe(3);
  });

  it('leaves a well-formed toggleHeading untouched', () => {
    const tg = n('toggleHeading', { level: 2 }, n('toggleHeadingText', null), n('detailsContent', null, para('x')));
    const { changed } = repair(n('doc', null, tg));
    expect(changed).toBe(false);
  });

  it('unwraps a malformed toggleHeading to its content (preserving text)', () => {
    // Wrong shape: a bare paragraph child instead of [toggleHeadingText, detailsContent].
    const tg = n('toggleHeading', { level: 1 }, para('kept text'));
    const { doc, changed } = repair(n('doc', null, tg));
    expect(changed).toBe(true);
    expect(doc.child(0).type.name).not.toBe('toggleHeading');
    expect(doc.textContent).toContain('kept text');
  });

  it('unwraps a malformed details, keeping inner content blocks', () => {
    const det = n('details', null, n('detailsContent', null, para('inner')));
    const { doc, changed } = repair(n('doc', null, det));
    expect(changed).toBe(true);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.textContent).toContain('inner');
  });

  it('leaves a well-formed details untouched', () => {
    const det = n('details', null, n('detailsSummary', null), n('detailsContent', null, para('x')));
    const { changed } = repair(n('doc', null, det));
    expect(changed).toBe(false);
  });

  it('removes a pageBlock with an empty pageId', () => {
    const { doc, changed } = repair(n('doc', null, para('a'), n('pageBlock', { pageId: '' }), para('b')));
    expect(changed).toBe(true);
    expect(typesOf(doc)).toEqual(['paragraph', 'paragraph']);
  });

  it('keeps a pageBlock with a valid pageId', () => {
    const { changed } = repair(n('doc', null, n('pageBlock', { pageId: 'page-123' })));
    expect(changed).toBe(false);
  });

  it('removes an empty table', () => {
    const { doc, changed } = repair(n('doc', null, para('a'), n('table', null)));
    expect(changed).toBe(true);
    expect(typesOf(doc)).toEqual(['paragraph']);
  });

  it('lifts an orphan detailsContent to its block children', () => {
    // detailsContent directly under doc (no details/toggle parent).
    const { doc, changed } = repair(n('doc', null, n('detailsContent', null, para('lifted'))));
    expect(changed).toBe(true);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.textContent).toContain('lifted');
  });

  it('is a no-op on a clean document', () => {
    const { changed } = repair(n('doc', null, para('hello'), para('world')));
    expect(changed).toBe(false);
  });
});
