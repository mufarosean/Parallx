// @vitest-environment jsdom
// notificationA11y.test.ts — prompts, input boxes and quick picks behave as
// dialogs for a keyboard and screen-reader user: they take focus, keep Tab
// inside, close on Escape, and give focus back. docs/ACCESSIBILITY.md, section 1.

import { describe, it, expect, afterEach } from 'vitest';
import { scene } from '../../src/ui/scene.js';
import { NotificationService, showInputBoxModal, showQuickPickModal } from '../../src/api/notificationService.js';

const settle = () => new Promise<void>((r) => setTimeout(r, 30));
const key = (k: string, shift = false) => {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};
const opener = () => { const b = document.createElement('button'); b.textContent = 'Open'; document.body.appendChild(b); b.focus(); return b; };

afterEach(() => { document.body.innerHTML = ''; scene.reset(); });

describe('dialogs for the keyboard', () => {
  it('a warning prompt is a modal alert dialog, focuses Cancel, keeps Tab on its buttons, and gives focus back', async () => {
    const back = opener();
    const svc = new NotificationService();
    svc.attach(document.body);
    const answer = svc.warn('Move the page to Trash?', { title: 'Move to Trash' }, { title: 'Cancel' });
    const prompt = document.querySelector('[role=alertdialog]') as HTMLElement;
    expect(prompt.getAttribute('aria-modal')).toBe('true');
    expect(prompt.getAttribute('aria-label')).toBe('Move the page to Trash?');
    expect(document.activeElement?.textContent).toBe('Cancel');
    key('Tab');
    expect(document.activeElement?.textContent).toBe('Move to Trash');
    key('Tab');
    expect(document.activeElement?.textContent).toBe('Cancel');
    key('Escape');
    expect((await answer)?.title).toBe('Cancel');
    expect(document.activeElement).toBe(back);
    svc.dispose();
  });

  it('an ordinary toast is announced politely', () => {
    const svc = new NotificationService();
    svc.attach(document.body);
    void svc.info('Saved.');
    expect(document.querySelector('.parallx-notifications-container')?.getAttribute('aria-live')).toBe('polite');
    expect(document.querySelector('.parallx-notification')?.getAttribute('role')).toBe('status');
    svc.dispose();
  });

  it('an input box keeps Tab inside, closes on Escape from a button, and gives focus back', async () => {
    const back = opener();
    const answer = showInputBoxModal(document.body, { prompt: 'Page title', value: 'Notes' });
    await settle();
    const box = document.querySelector('[role=dialog]') as HTMLElement;
    expect(box.getAttribute('aria-modal')).toBe('true');
    (box.querySelector('input') as HTMLInputElement).focus();
    key('Tab'); key('Tab');
    expect(document.activeElement?.textContent).toBe('OK');
    key('Tab');
    expect(document.activeElement?.tagName).toBe('INPUT');
    key('Tab');
    key('Escape');
    expect(await answer).toBeUndefined();
    expect(document.activeElement).toBe(back);
  });

  it('a quick pick names the highlighted row and gives focus back', async () => {
    const back = opener();
    const answer = showQuickPickModal(document.body, [{ label: 'Alpha' }, { label: 'Beta' }], { placeholder: 'Pick a page' });
    await settle();
    const input = document.querySelector('[role=combobox]') as HTMLInputElement;
    input.focus();
    expect(document.getElementById(input.getAttribute('aria-activedescendant') ?? '-')?.textContent).toBe('Alpha');
    key('ArrowDown');
    const input2 = document.querySelector('[role=combobox]') as HTMLInputElement;
    expect(document.getElementById(input2.getAttribute('aria-activedescendant') ?? '-')?.textContent).toBe('Beta');
    expect(key('Tab').defaultPrevented).toBe(true);
    key('Escape');
    expect(await answer).toBeUndefined();
    expect(document.activeElement).toBe(back);
  });
});
