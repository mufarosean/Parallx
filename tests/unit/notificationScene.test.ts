// @vitest-environment jsdom
// notificationScene.test.ts — a toast, a confirm, an input box and a quick
// pick are surfaces of the scene with their controls, and leave it when they
// close. docs/SELF_DESCRIBING_UI_DESIGN.md section 11's frame-level item.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scene } from '../../src/ui/scene.js';
import { NotificationService, showConfirmModal, showInputBoxModal, showQuickPickModal } from '../../src/api/notificationService.js';

const settle = () => new Promise<void>((r) => setTimeout(r, 60));
const childIds = (id: string) => scene.describe(id).surfaces[0]?.children?.map((c) => c.id) ?? [];

beforeEach(() => {
  document.body.innerHTML = '';
  scene.reset();
});

afterEach(() => {
  document.body.innerHTML = '';
  scene.reset();
});

describe('notifications and modals in the scene', () => {
  it('a prompt toast is a surface with its actions and Dismiss', async () => {
    const svc = new NotificationService();
    svc.attach(document.body);
    void svc.warn('Empty the trash?', { title: 'Empty Trash' }, { title: 'Cancel' });
    await settle();
    expect(scene.find('notification')[0]?.label).toBe('Empty the trash?');
    expect(childIds('notification')).toEqual(['notification.empty-trash', 'notification.cancel', 'notification.dismiss']);
    svc.dispose();
  });

  it('a confirm names its buttons, and goes when answered', async () => {
    const answer = showConfirmModal(document.body, { message: 'Delete the project?', confirmLabel: 'Delete Project', danger: true });
    await settle();
    expect(scene.find('confirm')[0]?.label).toBe('Delete the project?');
    expect(scene.describe('confirm').surfaces[0]?.children?.map((c) => `${c.id}:${c.label}`)).toEqual(['confirm.cancel:Cancel', 'confirm.ok:Delete Project']);
    (document.querySelector('[data-px-id="confirm.ok"]') as HTMLButtonElement).click();
    expect(await answer).toBe(true);
    await settle();
    expect(scene.find('confirm')).toHaveLength(0);
  });

  it('an input box has its field with the value, and two buttons', async () => {
    const answer = showInputBoxModal(document.body, { prompt: 'Project name', value: 'Oil study' });
    await settle();
    expect(childIds('inputBox')).toEqual(['inputBox.input', 'inputBox.cancel', 'inputBox.ok']);
    expect(scene.find('inputBox.input')[0]?.state?.()).toEqual({ kind: 'value', value: 'Oil study' });
    (document.querySelector('[data-px-id="inputBox.ok"]') as HTMLButtonElement).click();
    expect(await answer).toBe('Oil study');
  });

  it('a quick pick has its filter and its rows as one list', async () => {
    const answer = showQuickPickModal(document.body, [{ label: 'Alpha' }, { label: 'Beta' }], { placeholder: 'Pick a page' });
    await settle();
    expect(scene.find('quickPick')[0]?.label).toBe('Pick a page');
    expect(childIds('quickPick')).toEqual(['quickPick.filter', 'quickPick.list']);
    expect(scene.find('quickPick.list')[0]?.state?.()).toEqual({ kind: 'selection', value: ['0'], count: 2 });
    const filter = document.querySelector('[data-px-id="quickPick.filter"]') as HTMLInputElement;
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await answer).toBeUndefined();
  });
});
