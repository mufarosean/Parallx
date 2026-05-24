/**
 * M82 Slice A characterization: a page containing a contributed block id
 * survives the canvas storage round-trip (encode → decoded envelope → decode)
 * without losing the node, even when the registry is consulted later.
 *
 * Closes the §22 characterization gate promised in
 * `docs/Parallx_Milestone_82.md` (`canvasContributedBlockRoundtrip.test.ts`).
 *
 * What this guards:
 *   - `encodeCanvasContentFromDoc` / `decodeCanvasContent` are node-type
 *     agnostic. Any contributed block id placed in `doc.content[]` survives
 *     verbatim through JSON encode → decode.
 *   - The `CanvasBlockTypeRegistry` is independent of the storage layer; a
 *     page can be saved with a registered id, the registry can be cleared
 *     (extension uninstalled), and the doc itself still loads — only the
 *     editor falls back to Tiptap's unknown-node placeholder, which is the
 *     existing behaviour and the property our recovery story relies on.
 *
 * This test does NOT mount Tiptap; it does the pure data-model roundtrip
 * the Manifest §17 baseline requires. The full editor characterization is
 * deferred to system fitness (M84).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  decodeCanvasContent,
  encodeCanvasContentFromDoc,
  CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
} from '../../src/built-in/canvas/contentSchema';
import { CanvasBlockTypeRegistry } from '../../src/services/canvasBlockTypeRegistry';
import type { BlockDefinition } from '../../src/built-in/canvas/config/blockRegistry';

const CONTRIBUTED_ID = 'example.embeddedIframe';

function makeContributedDefinition(): BlockDefinition {
  return {
    id: CONTRIBUTED_ID,
    name: CONTRIBUTED_ID,
    label: 'Embedded iframe',
    icon: 'browser',
    source: 'custom',
    kind: 'atom',
    capabilities: {} as any,
    extension: () => ({ name: CONTRIBUTED_ID } as any),
  } as BlockDefinition;
}

function makeDocWithContributedNode(): any {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
      {
        type: CONTRIBUTED_ID,
        attrs: { src: 'https://example.test/embed', height: 240 },
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
    ],
  };
}

describe('canvas contributed block roundtrip (M82)', () => {
  let registry: CanvasBlockTypeRegistry;

  beforeEach(() => {
    registry = new CanvasBlockTypeRegistry();
  });

  it('encodes a doc containing a contributed block id and decodes it intact', () => {
    const doc = makeDocWithContributedNode();
    const { storedContent, schemaVersion } = encodeCanvasContentFromDoc(doc);
    expect(schemaVersion).toBe(CURRENT_CANVAS_CONTENT_SCHEMA_VERSION);

    const decoded = decodeCanvasContent(storedContent);
    expect(decoded.needsRepair).toBe(false);
    expect(decoded.schemaVersion).toBe(CURRENT_CANVAS_CONTENT_SCHEMA_VERSION);
    expect(decoded.doc.type).toBe('doc');
    expect(decoded.doc.content).toHaveLength(3);
    const middle = decoded.doc.content[1];
    expect(middle.type).toBe(CONTRIBUTED_ID);
    expect(middle.attrs.src).toBe('https://example.test/embed');
    expect(middle.attrs.height).toBe(240);
  });

  it('survives a second roundtrip (encode → decode → encode → decode) byte-for-byte', () => {
    const doc = makeDocWithContributedNode();
    const first = encodeCanvasContentFromDoc(doc);
    const second = encodeCanvasContentFromDoc(decodeCanvasContent(first.storedContent).doc);
    expect(second.storedContent).toBe(first.storedContent);
  });

  it('registry decision (registered vs not registered) does not affect storage shape', () => {
    const doc = makeDocWithContributedNode();
    const beforeReg = encodeCanvasContentFromDoc(doc).storedContent;

    const disposable = registry.register(makeContributedDefinition());
    expect(registry.has(CONTRIBUTED_ID)).toBe(true);
    const whileReg = encodeCanvasContentFromDoc(doc).storedContent;

    disposable.dispose();
    expect(registry.has(CONTRIBUTED_ID)).toBe(false);
    const afterUnreg = encodeCanvasContentFromDoc(doc).storedContent;

    expect(whileReg).toBe(beforeReg);
    expect(afterUnreg).toBe(beforeReg);
  });

  it('a stored page from a registered block decodes after the contributing extension is uninstalled', () => {
    const disposable = registry.register(makeContributedDefinition());
    const { storedContent } = encodeCanvasContentFromDoc(makeDocWithContributedNode());
    disposable.dispose();
    expect(registry.has(CONTRIBUTED_ID)).toBe(false);

    const decoded = decodeCanvasContent(storedContent);
    expect(decoded.doc.type).toBe('doc');
    expect(decoded.doc.content[1].type).toBe(CONTRIBUTED_ID);
    expect(decoded.reason).toBeUndefined();
  });

  it('an unknown contributed id in stored content is still preserved on decode (recovery via Tiptap placeholder)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'unregistered.block', attrs: { foo: 'bar' } },
      ],
    };
    const { storedContent } = encodeCanvasContentFromDoc(doc);
    const decoded = decodeCanvasContent(storedContent);
    expect(decoded.doc.content[1].type).toBe('unregistered.block');
    expect(decoded.doc.content[1].attrs.foo).toBe('bar');
  });

  it('a doc without any contributed nodes is unaffected', () => {
    const plain = { type: 'doc', content: [{ type: 'paragraph' }] };
    const { storedContent } = encodeCanvasContentFromDoc(plain);
    const decoded = decodeCanvasContent(storedContent);
    expect(decoded.doc).toEqual(plain);
    expect(decoded.needsRepair).toBe(false);
  });
});
