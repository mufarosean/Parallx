// @vitest-environment jsdom
/**
 * The Model Calls dialog (src/commands/modelCallsView.ts): it opens as a
 * named modal, lists the ledger's calls and totals, follows the ledger while
 * open, and its Clear and Close buttons run the commands.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ModelCallLedger } from '../../src/services/modelCallLedger';
import { ModelEngineBroker } from '../../src/services/modelEngineBroker';
import { closeModelCallsDialog, showModelCallsDialog } from '../../src/commands/modelCallsView';
import type { IChatResponseChunk } from '../../src/services/chatTypes';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function call(broker: ModelEngineBroker, label: string) {
  const it = broker.request({ engine: 'e', gated: false, modelId: 'm1', options: { engine: { label } } }, () => (async function* () {
    yield { content: 'hidden answer', done: true, promptEvalCount: 3, evalCount: 2 } as IChatResponseChunk;
  })());
  for await (const _ of it) { /* drain */ }
}

afterEach(() => closeModelCallsDialog());

describe('Model Calls dialog', () => {
  it('opens as a named dialog listing calls, totals and its two buttons', async () => {
    const ledger = new ModelCallLedger();
    const broker = new ModelEngineBroker(undefined, undefined, ledger);
    await call(broker, 'Naming a chat');
    showModelCallsDialog(ledger, () => undefined);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Model Calls');
    expect(dialog.querySelector('.px-model-calls__recent .px-row__name')?.textContent).toBe('Naming a chat');
    expect(dialog.querySelector('.px-model-calls__recent .px-row__detail')?.textContent).toContain('3 in, 2 out');
    expect(dialog.textContent).not.toContain('hidden answer');
    const buttons = [...dialog.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Clear', 'Close']);

    await call(broker, 'Linking pages');
    await tick();
    expect([...dialog.querySelectorAll('.px-model-calls__recent .px-row__name')].map((n) => n.textContent)).toEqual(['Linking pages', 'Naming a chat']);
    expect(dialog.querySelectorAll('.px-model-calls__totals .px-row')).toHaveLength(2);

    ledger.clear();
    await tick();
    expect(dialog.querySelector('.px-model-calls__recent .px-empty')).not.toBeNull();
    expect((dialog.querySelector('.px-model-calls__totals') as HTMLElement).hidden).toBe(true);

    closeModelCallsDialog();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
