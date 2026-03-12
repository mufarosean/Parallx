// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { ChatContextAttachments } from '../../src/built-in/chat/input/chatContextAttachments';

describe('ChatContextAttachments', () => {
  it('keeps pasted images disabled until vision support is enabled', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const ribbon = new ChatContextAttachments(container);
    const imageFile = new File([Uint8Array.from([137, 80, 78, 71])], 'clipboard.png', { type: 'image/png' });

    await ribbon.addPastedImage(imageFile);

    expect(ribbon.hasAttachments()).toBe(true);
    expect(ribbon.getAttachments()).toHaveLength(0);
    expect(container.textContent).toContain('Vision required');

    ribbon.setVisionSupported(true);

    expect(ribbon.getAttachments()).toHaveLength(1);
    expect(ribbon.getAttachments()[0].kind).toBe('image');

    ribbon.dispose();
    container.remove();
  });
});