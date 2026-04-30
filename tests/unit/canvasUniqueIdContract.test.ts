// canvasUniqueIdContract.test.ts — M60 Phase δ T3 C2
//
// Stable block IDs are persisted by `@tiptap/extension-unique-id`, wired
// in `src/built-in/canvas/config/tiptapExtensions.ts` via
// `UNIQUE_ID_BLOCK_TYPES`. M60 §6.3 acceptance criterion: every block in
// every page has an immutable blockId. This test pins the contract:
//   - the wired list contains all core block-level types,
//   - the list is non-empty and contains no duplicates,
//   - inline-only types (text, hardBreak, inlineMath) are NOT in the list
//     (they don't need persistent ids).

import { describe, it, expect } from 'vitest';
import { UNIQUE_ID_BLOCK_TYPES } from '../../src/built-in/canvas/config/tiptapExtensions';

describe('UNIQUE_ID_BLOCK_TYPES contract (M60 §6.3 C2)', () => {
  it('contains every required block type', () => {
    const required = [
      'paragraph', 'heading',
      'bulletList', 'orderedList', 'listItem',
      'blockquote', 'horizontalRule',
      'codeBlock', 'image',
      'taskList', 'taskItem',
      'callout', 'mathBlock',
      'toggleHeading', 'toggleHeadingText',
      'details', 'detailsSummary', 'detailsContent',
      'bookmark', 'pageBlock', 'tableOfContents',
      'video', 'audio', 'fileAttachment',
      'table', 'tableRow', 'tableCell', 'tableHeader',
      'columnList', 'column',
      // M60 Phase δ — dataview block.
      'dataview',
    ];
    for (const t of required) {
      expect(UNIQUE_ID_BLOCK_TYPES, `missing required type: ${t}`).toContain(t);
    }
  });

  it('excludes inline-only types', () => {
    expect(UNIQUE_ID_BLOCK_TYPES).not.toContain('text');
    expect(UNIQUE_ID_BLOCK_TYPES).not.toContain('hardBreak');
    expect(UNIQUE_ID_BLOCK_TYPES).not.toContain('inlineMath');
  });

  it('is non-empty and contains no duplicates', () => {
    expect(UNIQUE_ID_BLOCK_TYPES.length).toBeGreaterThan(0);
    expect(new Set(UNIQUE_ID_BLOCK_TYPES).size).toBe(UNIQUE_ID_BLOCK_TYPES.length);
  });
});
