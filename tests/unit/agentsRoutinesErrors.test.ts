// @vitest-environment jsdom
// agentsRoutinesErrors.test.ts — when Add or Dismiss on a suggested routine
// fails, the user is told, instead of a button that seems to do nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderRoutines } from '../../src/built-in/agents/agentsRoutines';
import { svc, type ParallxApi } from '../../src/built-in/agents/agentsServices';

function fakeApi(): ParallxApi & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
    window: {
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn(async (message: string) => { errors.push(message); return undefined; }),
      createStatusBarItem: vi.fn(),
    },
    services: { has: () => false, get: () => undefined },
  } as unknown as ParallxApi & { errors: string[] };
}

const suggested = { id: 'wf-1', name: 'Morning review', source: 'suggested', enabled: false, nodes: [], edges: [] };

describe('suggested routine buttons', () => {
  let saved: Partial<typeof svc>;
  beforeEach(() => {
    saved = { ...svc };
    svc.workflows = {
      workflows: [suggested],
      runs: [],
      updateWorkflow: () => { throw new Error('disk full'); },
      removeWorkflow: () => { throw new Error('locked'); },
    } as unknown as typeof svc.workflows;
    svc.cron = undefined;
    svc.flags = undefined;
    svc.config = undefined;
  });
  afterEach(() => {
    for (const k of Object.keys(svc) as (keyof typeof svc)[]) delete svc[k];
    Object.assign(svc, saved);
  });

  function button(host: HTMLElement, label: string): HTMLButtonElement {
    const b = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);
    if (!b) throw new Error(`no "${label}" button`);
    return b;
  }

  it('Add that fails says why', () => {
    const api = fakeApi();
    const host = document.createElement('div');
    renderRoutines(host, api, () => undefined, () => undefined);
    button(host, 'Add').click();
    expect(api.errors).toEqual(['Could not add "Morning review": disk full']);
  });

  it('Dismiss that fails says why', () => {
    const api = fakeApi();
    const host = document.createElement('div');
    renderRoutines(host, api, () => undefined, () => undefined);
    button(host, 'Dismiss').click();
    expect(api.errors).toEqual(['Could not dismiss "Morning review": locked']);
  });
});
