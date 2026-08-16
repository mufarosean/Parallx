// @vitest-environment jsdom
//
// conceptLabBehavior.test.ts — drives the REAL activate() through a fake api
// (flashcardsBehavior pattern): mounts the pane, walks home → module, drags
// sliders, applies presets, pins ghosts, and switches modules. Module state
// in main.js is a singleton, so this file is one sequential story.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// jsdom (non-visual) has no rAF; the animator and throttles depend on it.
(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
  setTimeout(() => cb(performance.now()), 0) as unknown as number;
(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

// @ts-expect-error — plain-JS extension module with no types
import { activate, deactivate, __testables } from '../../ext/concept-lab/main.js';

const { MODULES } = __testables;

function settle(turns = 8): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < turns; i++) {
    p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  }
  return p;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Fake api ---------------------------------------------------------------

const commands = new Map<string, (...args: unknown[]) => unknown>();
const editorProviders = new Map<string, any>();
const viewProviders = new Map<string, any>();
let paneHost: HTMLElement | null = null;
let paneHandle: any = null;

const api = {
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
      commands.set(id, handler);
      return { dispose() { commands.delete(id); } };
    },
    async executeCommand(id: string, ...args: unknown[]) {
      return commands.get(id)?.(...args);
    },
  },
  editors: {
    registerEditorProvider(typeId: string, provider: any) {
      editorProviders.set(typeId, provider);
      return { dispose() { editorProviders.delete(typeId); } };
    },
    async openEditor({ typeId, instanceId }: any) {
      if (paneHost) return; // already open — the host just focuses it
      paneHost = document.createElement('div');
      document.body.appendChild(paneHost);
      paneHandle = editorProviders.get(typeId)?.createEditorPane(paneHost, {
        id: `tool:${typeId}:${instanceId}`,
        instanceId,
      });
    },
  },
  views: {
    registerViewProvider(viewId: string, provider: any) {
      viewProviders.set(viewId, provider);
      return { dispose() { viewProviders.delete(viewId); } };
    },
  },
  ui: {
    rafThrottle(fn: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => fn(...args);
      (wrapped as any).dispose = () => {};
      (wrapped as any).flush = () => {};
      return wrapped;
    },
    renderMarkdown(md: string) {
      const div = document.createElement('div');
      div.className = 'px-markdown';
      div.textContent = md;
      return div;
    },
  },
  icons: {
    createIconHtml: () => '',
  },
};

const context = { subscriptions: [] as any[] };

beforeAll(async () => {
  await activate(api as any, context as any);
});

afterAll(async () => {
  await deactivate();
});

// --- The story --------------------------------------------------------------

describe('concept lab pane', () => {
  it('activation registers the command, editor, and sidebar view', () => {
    expect(commands.has('conceptLab.open')).toBe(true);
    expect(editorProviders.has('conceptLab')).toBe(true);
    expect(viewProviders.has('conceptLab.modules')).toBe(true);
  });

  it('opening the lab shows a card per module', async () => {
    await api.commands.executeCommand('conceptLab.open');
    await settle();
    const cards = paneHost!.querySelectorAll('.cl-card');
    expect(cards.length).toBe(MODULES.length);
  });

  it('clicking a card enters the module with sliders, scenes, and formula', async () => {
    (paneHost!.querySelector('.cl-card') as HTMLElement).click();
    await settle();
    expect(paneHost!.querySelector('.cl-title')?.textContent).toBe('The Credibility Line');
    expect(paneHost!.querySelectorAll('.cl-slider-row').length).toBeGreaterThan(3);
    expect(paneHost!.querySelectorAll('.cl-preset-chip').length).toBe(5);
    // The stage rendered real geometry.
    const curves = paneHost!.querySelectorAll('path.cl-curve');
    expect(curves.length).toBeGreaterThanOrEqual(4);
    for (const c of curves) {
      expect((c.getAttribute('d') || '').startsWith('M')).toBe(true);
    }
    // Live formula bar carries term values.
    expect(paneHost!.querySelectorAll('.cl-term').length).toBeGreaterThan(2);
  });

  it('story step 1 applied the Poisson preset (Z = 0.500)', async () => {
    await settle();
    const values = [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    expect(values.some((v) => v === '0.500')).toBe(true);
  });

  it('dragging the VHM slider moves Z and the formula values live', async () => {
    const rows = [...paneHost!.querySelectorAll('.cl-slider-row')];
    const vhmRow = rows.find((r) => r.textContent?.includes('Variance Of Hypothetical Means'))!;
    const input = vhmRow.querySelector('input') as HTMLInputElement;
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    // Z = 3/(3+1) = 0.75
    const values = [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    expect(values.some((v) => v === '0.750')).toBe(true);
  });

  it('the Table 1 preset switches to fit mode: data dots + hidden variance sliders', async () => {
    const chips = [...paneHost!.querySelectorAll('.cl-preset-chip')];
    const table1 = chips.find((c) => c.textContent?.includes('Table 1'))! as HTMLElement;
    table1.click();
    await wait(650); // preset transition tweens through parameter space
    await settle();
    expect(paneHost!.querySelectorAll('circle.cl-dot').length).toBeGreaterThanOrEqual(6);
    const rows = [...paneHost!.querySelectorAll('.cl-slider-row')] as HTMLElement[];
    const vhmRow = rows.find((r) => r.textContent?.includes('Variance Of Hypothetical Means'))!;
    expect(vhmRow.style.display).toBe('none');
    // The fitted line answers the paper's own query: L(40,490) ≈ 45,211.
    const readouts = [...paneHost!.querySelectorAll('.cl-term-val')].map((e) => e.textContent);
    expect(readouts.some((v) => v === '45,211' || v === '45,210')).toBe(true);
  });

  it('pinning a ghost snapshots the current line', async () => {
    const pin = [...paneHost!.querySelectorAll('.cl-ghost-btn')].find((b) => b.textContent === 'Pin Ghost')! as HTMLElement;
    pin.click();
    await settle();
    expect(paneHost!.querySelectorAll('.cl-ghost-chip').length).toBe(1);
    expect(paneHost!.querySelectorAll('.cl-ghost-curve').length).toBe(1);
  });

  it('back returns home; entering the MSE Valley renders both scenes', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    expect(paneHost!.querySelectorAll('.cl-card').length).toBe(MODULES.length);
    const valley = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.textContent?.includes('MSE Valley'))! as HTMLElement;
    valley.click();
    await settle();
    expect(paneHost!.querySelectorAll('.cl-scene').length).toBe(2);
    // Regime map regions + the current-position dot.
    expect(paneHost!.querySelectorAll('.cl-region').length).toBe(3);
    const active = paneHost!.querySelectorAll('.cl-region.cl-active-region');
    expect(active.length).toBe(1);
  });

  it('moving the c slider moves the current-error readout along the parabola', async () => {
    const rows = [...paneHost!.querySelectorAll('.cl-slider-row')];
    const cRow = rows.find((r) => r.textContent?.includes('Credibility Weight On CL'))!;
    const input = cRow.querySelector('input') as HTMLInputElement;

    const readErr = () => {
      const cells = [...paneHost!.querySelectorAll('.cl-readouts > div')];
      const cell = cells.find((c) => c.textContent?.includes('Error At Current c'))!;
      return cell.querySelector('.cl-readout-value')!.textContent;
    };

    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const atBF = readErr();
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const atCL = readErr();
    expect(atBF).not.toBe(atCL);
  });

  it('returning to the first module preserves the user’s explored state', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    ([...paneHost!.querySelectorAll('.cl-card')][0] as HTMLElement).click();
    await settle();
    // Still on Table 1 (fit mode) with the pinned ghost — not reset to story 1.
    const active = paneHost!.querySelector('.cl-preset-chip.cl-active');
    expect(active?.textContent).toContain('Table 1');
    expect(paneHost!.querySelectorAll('.cl-ghost-chip').length).toBe(1);
  });
});

describe('sidebar', () => {
  it('lists every module plus All Modules', () => {
    const host = document.createElement('div');
    const handle = viewProviders.get('conceptLab.modules').createView(host);
    const rows = host.querySelectorAll('.cl-side-row');
    expect(rows.length).toBe(MODULES.length + 1);
    handle.dispose();
  });
});

describe('content hygiene', () => {
  it('every story step references an existing preset', () => {
    for (const mod of MODULES) {
      for (const step of mod.story) {
        if (step.preset) {
          expect(
            mod.presets.some((p: any) => p.id === step.preset),
            `${mod.id}: story step "${step.title}" -> preset "${step.preset}"`,
          ).toBe(true);
        }
      }
    }
  });

  it('pane view-state hooks round-trip the route', () => {
    const saved = paneHandle.saveViewState();
    expect(saved.route.view).toBe('module');
    paneHandle.restoreViewState(saved);
  });
});
