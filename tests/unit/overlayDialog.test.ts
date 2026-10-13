// @vitest-environment jsdom
// overlayDialog.test.ts — an overlay (Settings is one) is a named modal
// dialog to a screen reader, and closing it gives focus back to where it
// was. docs/ACCESSIBILITY.md, section 1.

import { describe, it, expect, afterEach } from 'vitest';
import { Overlay } from '../../src/ui/overlay.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('overlay as a dialog', () => {
  it('is a named modal dialog and hands focus back on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const overlay = new Overlay(document.body, { label: 'Settings' });
    const field = document.createElement('input');
    overlay.contentElement.appendChild(field);
    overlay.show();
    field.focus();
    expect(overlay.contentElement.getAttribute('role')).toBe('dialog');
    expect(overlay.contentElement.getAttribute('aria-modal')).toBe('true');
    expect(overlay.contentElement.getAttribute('aria-label')).toBe('Settings');
    overlay.hide();
    expect(document.activeElement).toBe(opener);
    overlay.dispose();
  });

  it('leaves focus alone when something else took it while open', () => {
    const opener = document.createElement('button');
    const other = document.createElement('button');
    document.body.append(opener, other);
    opener.focus();
    const overlay = new Overlay(document.body);
    overlay.show();
    other.focus();
    overlay.hide();
    expect(document.activeElement).toBe(other);
    overlay.dispose();
  });
});
