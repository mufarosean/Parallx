// selectionActionHandlers.test.ts — pin built-in selection action handlers.
//
// Pins:
//   - AddSelectionToChatHandler: actionId/label/icon constants
//     - execute order: chatAccess.reveal() awaited BEFORE addSelectionAttachment, BEFORE focus
//     - attachment shape: kind='selection', isImplicit=false, copies fileName/filePath/selectedText/
//       surface/startLine/endLine/pageNumber from payload; id starts with "selection-"
//   - SendSelectionToCanvasHandler: actionId/label/icon constants
//     - executeCommand called with ('canvas.appendText', selectedText, fileName)
//   - createBuiltInActionHandlers returns [AddSelectionToChat, SendSelectionToCanvas] in that order

import { describe, it, expect, vi } from 'vitest';
import {
  AddSelectionToChatHandler,
  SendSelectionToCanvasHandler,
  createBuiltInActionHandlers,
} from '../../src/services/selectionActionHandlers';
import type {
  ISelectionActionPayload,
  IActionHandlerServices,
} from '../../src/services/selectionActionTypes';

function mkPayload(over: Partial<ISelectionActionPayload> = {}): ISelectionActionPayload {
  return {
    selectedText: 'hello world',
    surface: 'editor',
    source: {
      fileName: 'foo.ts',
      filePath: '/abs/foo.ts',
      startLine: 10,
      endLine: 12,
      pageNumber: undefined,
    },
    ...over,
  } as ISelectionActionPayload;
}

function mkServices(): IActionHandlerServices & {
  chatAccess: {
    reveal: ReturnType<typeof vi.fn>;
    addSelectionAttachment: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
  };
  executeCommand: ReturnType<typeof vi.fn>;
} {
  return {
    chatAccess: {
      reveal: vi.fn(async () => {}),
      addSelectionAttachment: vi.fn(),
      focus: vi.fn(),
    },
    executeCommand: vi.fn(async () => undefined),
  } as any;
}

describe('AddSelectionToChatHandler', () => {
  it('actionId/label/icon constants', () => {
    const h = new AddSelectionToChatHandler();
    expect(h.actionId).toBe('add-to-chat');
    expect(h.label).toBe('Add Selection to Chat');
    expect(h.icon).toBe('ui-message');
  });

  it('reveal awaited BEFORE addSelectionAttachment, focus called LAST', async () => {
    const order: string[] = [];
    const services = mkServices();
    services.chatAccess.reveal = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 0));
      order.push('reveal');
    });
    services.chatAccess.addSelectionAttachment = vi.fn(() => order.push('add'));
    services.chatAccess.focus = vi.fn(() => order.push('focus'));

    await new AddSelectionToChatHandler().execute(mkPayload(), services);
    expect(order).toEqual(['reveal', 'add', 'focus']);
  });

  it('attachment shape: kind=selection, fields copied, id prefixed', async () => {
    const services = mkServices();
    const payload = mkPayload({
      selectedText: 'snippet body',
      surface: 'pdf',
      source: {
        fileName: 'doc.pdf',
        filePath: '/abs/doc.pdf',
        startLine: 3,
        endLine: 7,
        pageNumber: 42,
      } as any,
    });
    await new AddSelectionToChatHandler().execute(payload, services);
    const attachment = services.chatAccess.addSelectionAttachment.mock.calls[0][0];
    expect(attachment.kind).toBe('selection');
    expect(attachment.isImplicit).toBe(false);
    expect(attachment.name).toBe('doc.pdf');
    expect(attachment.fullPath).toBe('/abs/doc.pdf');
    expect(attachment.selectedText).toBe('snippet body');
    expect(attachment.surface).toBe('pdf');
    expect(attachment.startLine).toBe(3);
    expect(attachment.endLine).toBe(7);
    expect(attachment.pageNumber).toBe(42);
    expect(typeof attachment.id).toBe('string');
    expect(attachment.id.startsWith('selection-')).toBe(true);
  });
});

describe('SendSelectionToCanvasHandler', () => {
  it('actionId/label/icon constants', () => {
    const h = new SendSelectionToCanvasHandler();
    expect(h.actionId).toBe('send-to-canvas');
    expect(h.label).toBe('Send to Canvas');
    expect(h.icon).toBe('ui-palette');
  });

  it('executeCommand called with (canvas.appendText, selectedText, fileName)', async () => {
    const services = mkServices();
    const payload = mkPayload({ selectedText: 'X', source: { fileName: 'F.md', filePath: '/a/F.md' } as any });
    await new SendSelectionToCanvasHandler().execute(payload, services);
    expect(services.executeCommand).toHaveBeenCalledTimes(1);
    expect(services.executeCommand).toHaveBeenCalledWith('canvas.appendText', 'X', 'F.md');
  });
});

describe('createBuiltInActionHandlers', () => {
  it('returns AddSelectionToChat THEN SendSelectionToCanvas (order pinned)', () => {
    const list = createBuiltInActionHandlers();
    expect(list.length).toBe(2);
    expect(list[0]).toBeInstanceOf(AddSelectionToChatHandler);
    expect(list[1]).toBeInstanceOf(SendSelectionToCanvasHandler);
  });

  it('each call returns FRESH instances (no shared singletons)', () => {
    const a = createBuiltInActionHandlers();
    const b = createBuiltInActionHandlers();
    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).not.toBe(b[1]);
  });
});
