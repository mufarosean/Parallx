// chatWidgetService.test.ts — pin ChatWidgetService.
//
// Pins:
//   - registerWidget stores by widget.id; fires onDidAddWidget with full descriptor.
//   - disposable removes by id; fires onDidRemoveWidget with the id string.
//   - duplicate id overwrites (Map.set semantics) — verified by getWidgets length.
//   - getWidget queries by sessionId, returns first match; undefined when none.
//   - getWidgets returns a snapshot array (mutations to the returned array do not leak).

import { describe, it, expect, vi } from 'vitest';
import { ChatWidgetService } from '../../src/services/chatWidgetService';

function mkWidget(id: string, sessionId: string) {
  return {
    id,
    sessionId,
    focus: vi.fn(),
    layout: vi.fn(),
  };
}

describe('ChatWidgetService', () => {
  it('registerWidget stores by id and fires onDidAddWidget with descriptor', () => {
    const svc = new ChatWidgetService();
    const seen: any[] = [];
    svc.onDidAddWidget((w) => seen.push(w));
    const w = mkWidget('w1', 's1');
    svc.registerWidget(w);
    expect(seen).toEqual([w]);
    expect(svc.getWidgets().map((x) => x.id)).toEqual(['w1']);
  });

  it('disposable removes by id and fires onDidRemoveWidget with id string', () => {
    const svc = new ChatWidgetService();
    const removed: string[] = [];
    svc.onDidRemoveWidget((id) => removed.push(id));
    const d = svc.registerWidget(mkWidget('w1', 's1'));
    svc.registerWidget(mkWidget('w2', 's2'));
    d.dispose();
    expect(removed).toEqual(['w1']);
    expect(svc.getWidgets().map((x) => x.id)).toEqual(['w2']);
  });

  it('re-registering same id overwrites the previous entry (Map.set)', () => {
    const svc = new ChatWidgetService();
    svc.registerWidget(mkWidget('w1', 's1'));
    svc.registerWidget(mkWidget('w1', 's2'));
    expect(svc.getWidgets().length).toBe(1);
    expect(svc.getWidgets()[0].sessionId).toBe('s2');
  });

  it('getWidget queries by sessionId; returns undefined when no match', () => {
    const svc = new ChatWidgetService();
    svc.registerWidget(mkWidget('w1', 'sA'));
    svc.registerWidget(mkWidget('w2', 'sB'));
    expect(svc.getWidget('sA')?.id).toBe('w1');
    expect(svc.getWidget('sB')?.id).toBe('w2');
    expect(svc.getWidget('missing')).toBeUndefined();
  });

  it('getWidgets returns a snapshot array (mutating it does not affect registry)', () => {
    const svc = new ChatWidgetService();
    svc.registerWidget(mkWidget('w1', 's1'));
    const arr = svc.getWidgets() as any[];
    arr.push(mkWidget('ghost', 'g'));
    expect(svc.getWidgets().map((x) => x.id)).toEqual(['w1']);
  });
});
