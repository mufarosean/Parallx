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
const chatTools = new Map<string, any>();
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
  chat: {
    registerTool(name: string, def: any) {
      chatTools.set(name, def);
      return { dispose() { chatTools.delete(name); } };
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

  it('opening the lab shows the how-to guide and a card per module', async () => {
    await api.commands.executeCommand('conceptLab.open');
    await settle();
    const cards = paneHost!.querySelectorAll('.cl-card');
    expect(cards.length).toBe(MODULES.length);
    // The instructional: six interaction verbs above the module cards.
    const guide = paneHost!.querySelector('.cl-guide')!;
    expect(guide.textContent).toContain('How To Use The Lab');
    expect(guide.querySelectorAll('.cl-guide-item').length).toBe(6);
    expect(guide.textContent).toContain('Drag Anywhere');
    expect(guide.textContent).toContain('Hover To Trace');
  });

  it('clicking a card enters the module with sliders, scenes, and formula', async () => {
    const brosius = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Credibility Line'))! as HTMLElement;
    brosius.click();
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
      c.querySelector('.cl-card-title')?.textContent?.includes('MSE Valley'))! as HTMLElement;
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

  it('Prior To Posterior renders three densities and the credibility rail', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Prior To Posterior'))! as HTMLElement;
    card.click();
    await settle();
    // Story step 1 applies the normal-conjugate preset: z = 0.791.
    const curves = paneHost!.querySelectorAll('path.cl-curve');
    expect(curves.length).toBe(3);
    for (const c of curves) expect((c.getAttribute('d') || '').startsWith('M')).toBe(true);
    const values = [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    expect(values.some((v) => v === '0.791')).toBe(true);
    // The corrected-Gogol preset lands on the Correction Note figures.
    const gogol = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('Gogol'))! as HTMLElement;
    gogol.click();
    await wait(650);
    await settle();
    const after = [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    expect(after.some((v) => v === '0.782')).toBe(true);
    expect(after.some((v) => v === '51.9%')).toBe(true);
  });

  it('the Distribution Zoo switches families: curves for ranges, lattice bars for ODP', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Distribution Zoo'))! as HTMLElement;
    card.click();
    await settle();
    // Ranges mode: two curves, no bars, the 95th-percentile markers labeled.
    expect(paneHost!.querySelectorAll('rect.cl-bar').length).toBe(0);
    const tags = [...paneHost!.querySelectorAll('.cl-svg-tag')].map((e) => e.textContent);
    expect(tags.some((t) => t?.includes('LN 95th'))).toBe(true);
    const odp = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('Over-Dispersed'))! as HTMLElement;
    odp.click();
    await wait(650);
    await settle();
    // ODP mode: the phi lattice + Poisson comparison bars; sd slider hides.
    expect(paneHost!.querySelectorAll('rect.cl-bar').length).toBeGreaterThan(20);
    const rows = [...paneHost!.querySelectorAll('.cl-slider-row')] as HTMLElement[];
    const sdRow = rows.find((r) => r.textContent?.includes('Sd'))!;
    const phiRow = rows.find((r) => r.textContent?.includes('Dispersion'))!;
    expect(sdRow.style.display).toBe('none');
    expect(phiRow.style.display).toBe('');
  });

  // Real-time reveal animations put this test over the 5s default.
  it('the Validation Machine reveals samples and flips the verdict with the model defect', { timeout: 15000 }, async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Validation Machine'))! as HTMLElement;
    card.click();
    await settle();
    // The sampling reveal is animating: not all 100 points are on the p-p
    // plot yet, and the replay control exists.
    expect(paneHost!.querySelector('.cl-scene-btn')).toBeTruthy();
    await wait(2400); // let the reveal finish
    await settle();
    const readVerdict = () => {
      const cells = [...paneHost!.querySelectorAll('.cl-readouts > div')];
      const cell = cells.find((c) => c.textContent?.includes('Verdict'))!;
      return cell.querySelector('.cl-readout-value')!.textContent;
    };
    // Story step 1 is the correct model: it validates, with 100 p-p points.
    expect(readVerdict()).toBe('Validates');
    // Light-tailed preset gets rejected.
    const light = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('Light-Tailed'))! as HTMLElement;
    light.click();
    await wait(650 + 2400);
    await settle();
    expect(readVerdict()).toBe('Rejected');
  });

  it('the CSR fan collapses at gamma zero and opens at the Table 7.1 posterior', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Settlement-Rate'))! as HTMLElement;
    card.click();
    await settle();
    const readMisprice = () => {
      const cells = [...paneHost!.querySelectorAll('.cl-readouts > div')];
      const cell = cells.find((c) => c.textContent?.includes('Misprices'))!;
      return cell.querySelector('.cl-readout-value')!.textContent;
    };
    // Story step 1 is gamma = 0: CSR nests CRC, the naive average is exact.
    expect(readMisprice()).toBe('0.0%');
    const posterior = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('Table 7.1'))! as HTMLElement;
    posterior.click();
    await wait(650);
    await settle();
    expect(readMisprice()).not.toBe('0.0%');
    const values = [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    expect(values.some((v) => v === '40.1%')).toBe(true); // AY-10 lag-1 share
  });

  it('the MCMC watcher runs, accumulates draws, and pauses', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Posterior Form'))! as HTMLElement;
    card.click();
    await wait(400); // the chain auto-plays on mount
    await settle();
    const readDraws = () => {
      const cells = [...paneHost!.querySelectorAll('.cl-readouts > div')];
      const cell = cells.find((c) => c.textContent?.includes('Draws'))!;
      return cell.querySelector('.cl-readout-value')!.textContent;
    };
    const running = parseInt((readDraws() || '0').replace(/,/g, ''), 10);
    expect(running).toBeGreaterThan(0);
    const pause = [...paneHost!.querySelectorAll('.cl-scene-btn')].find((b) =>
      b.textContent?.includes('Pause'))! as HTMLElement;
    pause.click();
    await settle();
    const paused = readDraws();
    await wait(250);
    await settle();
    expect(readDraws()).toBe(paused);
    // The chain trail and contours rendered real geometry.
    expect(paneHost!.querySelectorAll('path.cl-curve').length).toBeGreaterThan(4);
  });

  it('Mack\'s Machinery reproduces the RAA numbers and stands the ribbon down off-vw', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Machinery'))! as HTMLElement;
    card.click();
    await settle();
    const values = () => [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    expect(values().some((v) => v === '2.999')).toBe(true);   // volume-weighted f_1
    expect(values().some((v) => v === '52,135')).toBe(true);  // total reserve
    const ribbon = paneHost!.querySelector('.cl-band') as SVGElement;
    expect(ribbon.style.display).not.toBe('none');
    const avg = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('Simple Average'))! as HTMLElement;
    avg.click();
    await wait(650);
    await settle();
    expect(values().some((v) => v === '8.206')).toBe(true);
    expect(ribbon.style.display).toBe('none'); // se machinery is vw-only
  });

  it('Clark\'s curves swap families and reprice the tail', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Growth Curves'))! as HTMLElement;
    card.click();
    await settle();
    const values = () => [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    // Loglogistic fit: LDF 1.295, ELR 59.8% (Cape Cod readout tracks the curve).
    expect(values().some((v) => v === '1.295')).toBe(true);
    const weibull = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('Weibull'))! as HTMLElement;
    weibull.click();
    await wait(650);
    await settle();
    expect(values().some((v) => v === '1.052')).toBe(true); // the tail contrast
  });

  // The process-vs-parameter width comparison is a seeded module check;
  // here we verify the live surface: point estimate, iterations, histogram.
  it('the bootstrap surface runs and builds the histogram', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Bootstrap'))! as HTMLElement;
    card.click();
    await wait(500); // simulation chunks run on the loop
    await settle();
    const readouts = () => {
      const out: Record<string, string> = {};
      for (const cell of paneHost!.querySelectorAll('.cl-readouts > div')) {
        out[cell.textContent || ''] = cell.querySelector('.cl-readout-value')!.textContent || '';
      }
      return out;
    };
    const values = () => [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    expect(values().some((v) => v === '18,680,856')).toBe(true); // the famous point estimate
    const doneCell = [...paneHost!.querySelectorAll('.cl-readouts > div')].find((c) =>
      c.textContent?.includes('Iterations Run'))!;
    const done = parseInt((doneCell.querySelector('.cl-readout-value')!.textContent || '0').replace(/,/g, ''), 10);
    expect(done).toBeGreaterThan(50);
    expect(paneHost!.querySelectorAll('rect.cl-bar').length).toBeGreaterThan(20);
    void readouts;
  });

  it('the Risk Margin Ladder consolidates to 8.7% and prices the printed flexes', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Risk Margin'))! as HTMLElement;
    card.click();
    await settle();
    const values = () => [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    expect(values().some((v) => v === '8.7%')).toBe(true);   // consolidated CoV
    expect(values().some((v) => v === '5.65%')).toBe(true);  // lognormal margin, unrounded chain
    const flex = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('Full Internal'))! as HTMLElement;
    flex.click();
    await wait(650);
    await settle();
    expect(values().some((v) => v === '6.33%')).toBe(true);  // printed sensitivity 6.3%
  });

  it('The Same Answer Twice reconciles the paper\'s cell both ways', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Same Answer'))! as HTMLElement;
    card.click();
    await settle();
    const values = () => [...paneHost!.querySelectorAll('.cl-readout-value')].map((e) => e.textContent);
    // The paper's own reconciliation: 1996 dev 3 gives 24,070 on BOTH routes.
    const cellVals = values().filter((v) => v === '24,070');
    expect(cellVals.length).toBeGreaterThanOrEqual(2);
    expect(values().some((v) => v === '173,225')).toBe(true); // alpha_1996
    expect(values().some((v) => v === '373,346')).toBe(true); // Table 3-2 total
  });

  it('the conceptLab_open chat tool routes the pane and applies the preset', async () => {
    const tool = chatTools.get('conceptLab_open');
    expect(tool).toBeTruthy();
    const bad = await tool.handler({ moduleId: 'nope' });
    expect(bad.isError).toBe(true);
    const res = await tool.handler({ moduleId: 'mse-valley', preset: 'example1' });
    expect(res.isError).toBeFalsy();
    await settle();
    expect(paneHost!.querySelector('.cl-title')?.textContent).toBe('The MSE Valley');
    expect(paneHost!.querySelector('.cl-preset-chip.cl-active')?.textContent).toContain('Example 1');
  });

  it('returning to an explored module preserves the user’s state', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const brosius = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Credibility Line'))! as HTMLElement;
    brosius.click();
    await settle();
    // Still on Table 1 (fit mode) with the pinned ghost — not reset to story 1.
    const active = paneHost!.querySelector('.cl-preset-chip.cl-active');
    expect(active?.textContent).toContain('Table 1');
    expect(paneHost!.querySelectorAll('.cl-ghost-chip').length).toBe(1);
  });
});

describe('curriculum layer', () => {
  it('home is the ladder: seven ordered levels, concept cards say what they feed', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const levels = paneHost!.querySelectorAll('.cl-level');
    expect(levels.length).toBe(7);
    expect(levels[0].querySelector('.cl-level-title')?.textContent).toBe('Probability & Random Variables');
    expect(levels[6].querySelector('.cl-level-title')?.textContent).toBe('The Reserving Problem');
    // A concept card's footer points forward instead of citing a paper.
    const claimCounter = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Claim Counter'))!;
    expect(claimCounter.querySelector('.cl-card-paper')?.textContent).toContain('Feeds');
  });

  it('the Claim Counter draws years and the empirical readouts move', async () => {
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Claim Counter'))! as HTMLElement;
    card.click();
    await settle();
    // Concept module: the header chip shows its level, not a paper.
    expect(paneHost!.querySelector('.cl-source-chip')?.textContent).toContain('Foundations');
    const readCell = (label: string) => {
      const cell = [...paneHost!.querySelectorAll('.cl-readouts > div')].find((c) =>
        c.textContent?.includes(label))!;
      return cell.querySelector('.cl-readout-value')!.textContent;
    };
    expect(readCell('Years Drawn')).toBe('0');
    const draw100 = [...paneHost!.querySelectorAll('.cl-scene-btn')].find((b) =>
      b.textContent?.includes('Draw 100'))! as HTMLElement;
    draw100.click();
    await settle();
    expect(readCell('Years Drawn')).toBe('100');
    expect(readCell('Empirical Mean')).not.toBe('—');
  });

  it('predict-then-reveal: the step asks first, marks the answer, then explains', async () => {
    // Step 2 of the Claim Counter is a predict step.
    const next = [...paneHost!.querySelectorAll('.cl-story-btn')].pop()! as HTMLElement;
    next.click();
    await settle();
    const opts = [...paneHost!.querySelectorAll('.cl-predict-opt')] as HTMLElement[];
    expect(opts.length).toBe(2);
    expect(paneHost!.querySelector('.cl-predict-explain')).toBeNull();
    opts[0].click(); // the wrong answer (ten draws are NOT plenty)
    await settle();
    const after = [...paneHost!.querySelectorAll('.cl-predict-opt')] as HTMLElement[];
    expect(after[0].classList.contains('cl-wrong')).toBe(true);
    expect(after[1].classList.contains('cl-right')).toBe(true);
    expect(paneHost!.querySelector('.cl-predict-explain')).toBeTruthy();
  });

  it('the connections rail walks the ladder: a bridge click opens the target module', async () => {
    const rows = [...paneHost!.querySelectorAll('.cl-conn-row')] as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    const fan = rows.find((r) => r.textContent?.includes('Fan Of Futures'))!;
    fan.click();
    await settle();
    expect(paneHost!.querySelector('.cl-title')?.textContent).toBe('The Fan Of Futures');
    // The hero fan rendered: unconditional lives plus the conditional brush.
    expect(paneHost!.querySelectorAll('path').length).toBeGreaterThan(30);
  });

  it('Meyers’ ladder: Mack-incurred is rejected, CCL validates', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('Model Ladder'))! as HTMLElement;
    card.click();
    await settle();
    const verdictText = () =>
      [...paneHost!.querySelectorAll('text')].map((t) => t.textContent || '').join(' ');
    expect(verdictText()).toContain('Rejected');
    const ccl = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('CCL'))! as HTMLElement;
    ccl.click();
    await wait(650);
    await settle();
    expect(verdictText()).toContain('Validates');
  });

  it('GLM anatomy: the p dial belongs to the Tweedie world only', async () => {
    (paneHost!.querySelector('.cl-back') as HTMLElement).click();
    await settle();
    const card = [...paneHost!.querySelectorAll('.cl-card')].find((c) =>
      c.querySelector('.cl-card-title')?.textContent?.includes('GLM, Piece By Piece'))! as HTMLElement;
    card.click();
    await settle();
    const pRow = () => ([...paneHost!.querySelectorAll('.cl-slider-row')] as HTMLElement[])
      .find((r) => r.textContent?.includes('Variance Power'))!;
    // Story opens in the classical corner: identity link, no p dial.
    expect(pRow().style.display).toBe('none');
    const odp = [...paneHost!.querySelectorAll('.cl-preset-chip')].find((c) =>
      c.textContent?.includes('ODP World'))! as HTMLElement;
    odp.click();
    await wait(650);
    await settle();
    expect(pRow().style.display).toBe('');
  });
});

describe('sidebar', () => {
  it('lists every module plus All Modules', () => {
    const host = document.createElement('div');
    const handle = viewProviders.get('conceptLab.modules').createView(host);
    const rows = host.querySelectorAll('.cl-side-row');
    expect(rows.length).toBe(MODULES.length + 1);
    expect(host.querySelectorAll('.cl-side-level').length).toBe(7);
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
