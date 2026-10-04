// domGeometry.ts — layout stubs every jsdom test gets.
//
// jsdom implements no layout, so `Range.getClientRects` and
// `Range.getBoundingClientRect` do not exist. ProseMirror (endOfTextblock)
// and CodeMirror (its deferred measure frame) call them; when that frame
// lands during a test the throw surfaces as an *unhandled* error and fails
// the run, at random, depending on timing. Zero rects make the measurement
// "unknown", the right answer for a headless DOM.
const RangeProto = (globalThis as { Range?: { prototype: Record<string, unknown> } }).Range?.prototype;
if (RangeProto && typeof RangeProto.getClientRects !== 'function') {
  RangeProto.getClientRects = () => [] as unknown as DOMRectList;
  RangeProto.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}
