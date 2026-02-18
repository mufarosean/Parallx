import { describe, expect, it } from 'vitest';
import {
  validateCanvasStructuralInvariants,
  type CanvasInvariantIssue,
} from '../../src/built-in/canvas/invariants/canvasStructuralInvariants';

type MockNode = {
  type: { name: string };
  attrs?: Record<string, unknown>;
  content: MockNode[];
  childCount: number;
  child(index: number): MockNode;
  forEach(cb: (child: MockNode, offset: number, index: number) => void): void;
};

function node(name: string, content: MockNode[] = [], attrs: Record<string, unknown> = {}): MockNode {
  return {
    type: { name },
    attrs,
    content,
    get childCount() {
      return content.length;
    },
    child(index: number) {
      return content[index];
    },
    forEach(cb) {
      let offset = 0;
      content.forEach((child, index) => {
        cb(child, offset, index);
        offset += 1;
      });
    },
  };
}

function makeValidDoc(): MockNode {
  return node('doc', [
    node('paragraph', [node('text')]),
    node('columnList', [
      node('column', [node('paragraph', [node('text')])]),
      node('column', [node('callout', [node('paragraph', [node('text')])])]),
    ]),
    node('details', [
      node('detailsSummary', [node('text')]),
      node('detailsContent', [node('paragraph', [node('text')])]),
    ]),
    node('toggleHeading', [
      node('toggleHeadingText', [node('text')]),
      node('detailsContent', [node('blockquote', [node('paragraph', [node('text')])])]),
    ], { level: 2 }),
  ]);
}

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function fromPlain(plain: any): MockNode {
  const content = (plain.content || []).map(fromPlain);
  return node(plain.type?.name ?? plain.type, content, plain.attrs || {});
}

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function mutateIntoInvalid(doc: MockNode): MockNode {
  const plain = cloneDeep(doc);
  const mode = randomInt(5);

  if (mode === 0) {
    // columnList with 1 child
    plain.content[1].content = [plain.content[1].content[0]];
  } else if (mode === 1) {
    // orphan column under doc
    plain.content.unshift({ type: { name: 'column' }, attrs: {}, content: [{ type: { name: 'paragraph' }, attrs: {}, content: [] }] });
  } else if (mode === 2) {
    // details wrong shape
    plain.content[2].content = [plain.content[2].content[1], plain.content[2].content[0]];
  } else if (mode === 3) {
    // toggle invalid level
    plain.content[3].attrs.level = 7;
  } else {
    // detailsContent under invalid parent
    plain.content.push({ type: { name: 'detailsContent' }, attrs: {}, content: [{ type: { name: 'paragraph' }, attrs: {}, content: [] }] });
  }

  return fromPlain(plain);
}

function hasCode(issues: CanvasInvariantIssue[], codePrefix: string): boolean {
  return issues.some((issue) => issue.code.startsWith(codePrefix));
}

describe('canvas structural invariants', () => {
  it('accepts a valid structural model sample', () => {
    const issues = validateCanvasStructuralInvariants(makeValidDoc() as any);
    expect(issues).toEqual([]);
  });

  it('detects known invalid structures', () => {
    const invalid = node('doc', [
      node('columnList', [
        node('column', [node('columnList', [node('column', [node('paragraph')])])]),
      ]),
      node('details', [
        node('detailsContent', [node('paragraph')]),
        node('detailsSummary', [node('text')]),
      ]),
      node('toggleHeading', [
        node('detailsContent', [node('paragraph')]),
        node('toggleHeadingText', [node('text')]),
      ], { level: 9 }),
    ]);

    const issues = validateCanvasStructuralInvariants(invalid as any);

    expect(issues.length).toBeGreaterThan(0);
    expect(hasCode(issues, 'PX-COL')).toBe(true);
    expect(hasCode(issues, 'PX-DET')).toBe(true);
    expect(hasCode(issues, 'PX-TGL')).toBe(true);
  });

  it('property-style fuzz: random invalid mutations always trigger issues', () => {
    const rounds = 100;

    for (let i = 0; i < rounds; i++) {
      const valid = makeValidDoc();
      const baseline = validateCanvasStructuralInvariants(valid as any);
      expect(baseline).toEqual([]);

      const mutated = mutateIntoInvalid(valid);
      const issues = validateCanvasStructuralInvariants(mutated as any);
      expect(issues.length).toBeGreaterThan(0);
    }
  });
});
