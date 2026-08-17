// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatContextAttachments } from '../../src/built-in/chat/input/chatContextAttachments';
import { isAttachableFsPath } from '../../src/built-in/chat/utilities/chatWidgetAttachmentAdapter';

const MB = 1024 * 1024;

/** Minimal IAttachmentServices stub with a spyable warning sink. */
function stubServices(notifyWarning = vi.fn()) {
  return {
    services: {
      getOpenEditorFiles: () => [],
      getActiveEditorFile: () => undefined,
      onDidChangeOpenEditors: (() => ({ dispose() { /* noop */ } })) as any,
      notifyWarning,
    },
    notifyWarning,
  };
}

function makeRibbon() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ribbon = new ChatContextAttachments(container);
  return {
    container,
    ribbon,
    cleanup: () => {
      ribbon.dispose();
      container.remove();
    },
  };
}

const originalDownscale = (ChatContextAttachments as any)._downscaleToFit;

afterEach(() => {
  (ChatContextAttachments as any)._downscaleToFit = originalDownscale;
  delete (window as any).parallxElectron;
});

describe('ChatContextAttachments', () => {
  it('keeps pasted images disabled until vision support is enabled', async () => {
    const { container, ribbon, cleanup } = makeRibbon();
    const imageFile = new File([Uint8Array.from([137, 80, 78, 71])], 'clipboard.png', { type: 'image/png' });

    await ribbon.addPastedImage(imageFile);

    expect(ribbon.hasAttachments()).toBe(true);
    expect(ribbon.getAttachments()).toHaveLength(0);
    expect(container.textContent).toContain('Vision required');

    ribbon.setVisionSupported(true);

    expect(ribbon.getAttachments()).toHaveLength(1);
    expect(ribbon.getAttachments()[0].kind).toBe('image');

    cleanup();
  });

  it('downscales an oversized pasted image in memory instead of rejecting it', async () => {
    const { ribbon, cleanup } = makeRibbon();
    (ChatContextAttachments as any)._downscaleToFit = vi.fn(async () => ({ data: 'scaled-bytes', mimeType: 'image/jpeg' }));

    const bigFile = new File([new Uint8Array(11 * MB)], 'huge.png', { type: 'image/png' });
    await ribbon.addPastedImage(bigFile);
    ribbon.setVisionSupported(true);

    const attachments = ribbon.getAttachments();
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe('image');
    expect((attachments[0] as any).data).toBe('scaled-bytes');
    expect((attachments[0] as any).mimeType).toBe('image/jpeg');
    expect((ChatContextAttachments as any)._downscaleToFit).toHaveBeenCalledOnce();

    cleanup();
  });

  it('warns and attaches nothing when an oversized paste cannot be downscaled', async () => {
    const { ribbon, cleanup } = makeRibbon();
    const { services, notifyWarning } = stubServices();
    ribbon.setServices(services as any);
    (ChatContextAttachments as any)._downscaleToFit = vi.fn(async () => null);

    const bigFile = new File([new Uint8Array(11 * MB)], 'huge.png', { type: 'image/png' });
    await ribbon.addPastedImage(bigFile);

    expect(ribbon.hasAttachments()).toBe(false);
    expect(notifyWarning).toHaveBeenCalledOnce();
    expect(notifyWarning.mock.calls[0][0]).toContain('could not be downscaled');

    cleanup();
  });

  it('warns instead of attaching a junk file chip when an image file cannot be read', async () => {
    const { ribbon, cleanup } = makeRibbon();
    const { services, notifyWarning } = stubServices();
    ribbon.setServices(services as any);
    (window as any).parallxElectron = {
      fs: { readFile: async () => ({ error: { code: 'EACCES', message: 'Read path is outside the allowed roots' } }) },
    };

    await ribbon.addAttachment({ name: 'photo.jpg', fullPath: 'C:\\pics\\photo.jpg' });

    // The old behavior silently attached kind:'file' — the model then saw
    // "(Unable to read file content.)". Now: no attachment, loud warning.
    expect(ribbon.hasAttachments()).toBe(false);
    expect(notifyWarning).toHaveBeenCalledOnce();
    expect(notifyWarning.mock.calls[0][0]).toContain('photo.jpg');

    cleanup();
  });

  it('attaches an oversized image file as a downscaled in-memory copy, never as a file chip', async () => {
    const { ribbon, cleanup } = makeRibbon();
    (ChatContextAttachments as any)._downscaleToFit = vi.fn(async () => ({ data: 'scaled-bytes', mimeType: 'image/jpeg' }));
    (window as any).parallxElectron = {
      fs: { readFile: async () => ({ content: 'original-bytes', encoding: 'base64', size: 22 * MB }) },
    };

    await ribbon.addAttachment({ name: 'photo.jpg', fullPath: 'A:\\Archive\\Gallery\\Pics\\photo.jpg' });
    ribbon.setVisionSupported(true);

    const attachments = ribbon.getAttachments();
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe('image');
    expect((attachments[0] as any).data).toBe('scaled-bytes');
    expect((attachments[0] as any).mimeType).toBe('image/jpeg');

    cleanup();
  });

  it('attaches an in-cap image file byte-identical with no downscale', async () => {
    const { ribbon, cleanup } = makeRibbon();
    const downscale = vi.fn(async () => ({ data: 'scaled-bytes', mimeType: 'image/jpeg' }));
    (ChatContextAttachments as any)._downscaleToFit = downscale;
    (window as any).parallxElectron = {
      fs: { readFile: async () => ({ content: 'original-bytes', encoding: 'base64', size: 2 * MB }) },
    };

    await ribbon.addAttachment({ name: 'photo.jpg', fullPath: 'C:\\pics\\photo.jpg' });
    ribbon.setVisionSupported(true);

    const attachments = ribbon.getAttachments();
    expect(attachments).toHaveLength(1);
    expect((attachments[0] as any).data).toBe('original-bytes');
    expect((attachments[0] as any).mimeType).toBe('image/jpeg');
    expect(downscale).not.toHaveBeenCalled();

    cleanup();
  });

  it('still attaches non-image files as plain file chips', async () => {
    const { ribbon, cleanup } = makeRibbon();

    await ribbon.addAttachment({ name: 'notes.txt', fullPath: 'C:\\docs\\notes.txt' });

    const attachments = ribbon.getAttachments();
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe('file');

    cleanup();
  });
});

describe('isAttachableFsPath', () => {
  it('accepts real filesystem paths', () => {
    expect(isAttachableFsPath('C:\\Users\\me\\photo.jpg')).toBe(true);
    expect(isAttachableFsPath('A:/Archive/Gallery/Pics/photo.jpg')).toBe(true);
    expect(isAttachableFsPath('/home/me/photo.jpg')).toBe(true);
    expect(isAttachableFsPath('\\\\server\\share\\photo.jpg')).toBe(true);
  });

  it('rejects tool-editor descriptions and other non-paths', () => {
    expect(isAttachableFsPath('Tool editor: media-organizer-grid')).toBe(false);
    expect(isAttachableFsPath('Tool editor: canvas')).toBe(false);
    expect(isAttachableFsPath('New Chat')).toBe(false);
    expect(isAttachableFsPath('')).toBe(false);
  });
});
