/**
 * Diagnostic probe: sidebar sash-drag smoothness with a split editor
 * (PDF left, canvas right).
 *
 * Reported bug (2026-07-16): with a split view open, dragging the primary /
 * secondary sidebar sash sometimes "jumps" — the sidebar suddenly becomes
 * much larger or smaller than the cursor movement implies.
 *
 * Two candidate mechanisms this probe distinguishes:
 *   1. MODEL DESYNC — the grid's internal size bookkeeping drifts from the
 *      real sash position (startPos += appliedDelta going stale), so the
 *      sidebar lands where the cursor never was.  Signature: slow-drag
 *      residuals (domWidth − cursorImpliedWidth) grow, and the width does
 *      not settle back after returning the cursor to its origin.
 *   2. FRAME STARVATION — per-frame relayout of both heavy panes is so slow
 *      that paints happen 100ms+ apart and the sash visually teleports.
 *      Signature: large rAF gaps during the drag; residuals recover.
 *
 * Additionally checks FLEX DIVERGENCE: grid children are flex items whose
 * style.width is set by the model — if the flex algorithm redistributes
 * (sum mismatch), rect width ≠ style width and the model is lying to itself.
 *
 * This spec is a measurement probe: it always passes unless the layout is
 * fundamentally broken; results land in test-results/sash-drag-probe/.
 */
import { test, expect, openFolderViaMenu, setupCanvasPage, setContent, createTestWorkspace, cleanupTestWorkspace } from './fixtures';
import type { Page } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';

const ARTIFACT_DIR = path.join(process.cwd(), 'test-results', 'sash-drag-probe');

// ── Multi-page PDF builder (heavier than 19-pdf-diagnostics' single page) ──

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildMultiPagePdf(pageCount: number, linesPerPage: number): Buffer {
  const objects: string[] = [];
  const kids: string[] = [];
  for (let p = 0; p < pageCount; p++) kids.push(`${4 + p * 2} 0 R`);

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>\nendobj\n`);
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  for (let p = 0; p < pageCount; p++) {
    const contentLines = ['BT', '/F1 12 Tf'];
    for (let i = 0; i < linesPerPage; i++) {
      const y = 750 - i * 22;
      const text = escapePdfText(
        `Page ${p + 1} line ${i + 1} - Clark LDF Weibull loglogistic emergence G(x) theta omega MLE process variance`,
      );
      contentLines.push(`1 0 0 1 50 ${y} Tm`);
      contentLines.push(`(${text}) Tj`);
    }
    contentLines.push('ET');
    const stream = contentLines.join('\n');
    objects.push(
      `${4 + p * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] `
      + `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + p * 2} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${5 + p * 2} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

// ── Drag probe ──────────────────────────────────────────────────────────────

interface DragSample {
  phase: string;
  x: number;
  w: number;
  expected: number;
}

interface ProbeReport {
  label: string;
  w0: number;
  x0: number;
  frameCount: number;
  maxRafGapMs: number;
  rafGapsOver50: number;
  rafGapsOver100: number;
  maxSlowResidualPx: number;
  settleResidualPx: number;
  maxFlexDivergencePx: number;
  maxPerFrameWidthJumpPx: number;
  samples: DragSample[];
}

async function runDragProbe(window: Page, label: string): Promise<ProbeReport> {
  const sash = window.locator('.workbench-hgrid > .grid-sash[data-sash-index="0"]');
  const sidebar = window.locator('[data-part-id="workbench.parts.sidebar"]');
  await expect(sash).toBeVisible({ timeout: 5_000 });
  await expect(sidebar).toBeVisible({ timeout: 5_000 });

  // Start an in-page rAF recorder that samples the sidebar box every frame.
  await window.evaluate(() => {
    const sidebarEl = document.querySelector('[data-part-id="workbench.parts.sidebar"]') as HTMLElement;
    const probe: { frames: { t: number; rectW: number; styleW: number | null }[]; running: boolean } = {
      frames: [],
      running: true,
    };
    (window as any).__sashProbe = probe;
    const tick = (t: number) => {
      const r = sidebarEl.getBoundingClientRect();
      const sw = sidebarEl.style.width;
      probe.frames.push({ t, rectW: r.width, styleW: sw ? parseFloat(sw) : null });
      if (probe.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const sbb = (await sash.boundingBox())!;
  const wbb = (await sidebar.boundingBox())!;
  const x0 = sbb.x + sbb.width / 2;
  const y = sbb.y + sbb.height / 2;
  const w0 = wbb.width;

  const samples: DragSample[] = [];
  const record = async (phase: string, x: number): Promise<void> => {
    const bb = (await sidebar.boundingBox())!;
    samples.push({ phase, x, w: bb.width, expected: w0 + (x - x0) });
  };

  await window.mouse.move(x0, y);
  await window.mouse.down();

  // Phase 1 — slow drag right +120px in 5px steps, 40ms apart. A correct
  // model tracks the cursor within a frame or two at this speed.
  for (let i = 1; i <= 24; i++) {
    const x = x0 + i * 5;
    await window.mouse.move(x, y);
    await window.waitForTimeout(40);
    await record('slow-right', x);
  }

  // Phase 2 — fast wiggle ±(120→−60)px, no waits: elicits frame starvation
  // and event-coalescing behavior.
  for (let k = 0; k < 3; k++) {
    for (let i = 1; i <= 3; i++) {
      const x = x0 + 120 - i * 60;
      await window.mouse.move(x, y);
      await record('fast-left', x);
    }
    for (let i = 1; i <= 3; i++) {
      const x = x0 - 60 + i * 60;
      await window.mouse.move(x, y);
      await record('fast-right', x);
    }
  }

  // Phase 3 — return to origin and settle. A desynced model will NOT land
  // back on w0.
  await window.mouse.move(x0, y);
  await window.waitForTimeout(250);
  await record('settle', x0);
  await window.mouse.up();
  await window.waitForTimeout(100);

  const frames = await window.evaluate(() => {
    const p = (window as any).__sashProbe;
    p.running = false;
    return p.frames as { t: number; rectW: number; styleW: number | null }[];
  });

  // ── Analysis ──
  let maxRafGapMs = 0;
  let rafGapsOver50 = 0;
  let rafGapsOver100 = 0;
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].t - frames[i - 1].t;
    maxRafGapMs = Math.max(maxRafGapMs, gap);
    if (gap > 50) rafGapsOver50++;
    if (gap > 100) rafGapsOver100++;
  }

  const slowResiduals = samples.filter((s) => s.phase === 'slow-right').map((s) => Math.abs(s.w - s.expected));
  const maxSlowResidualPx = slowResiduals.length ? Math.max(...slowResiduals) : -1;

  const settleSample = samples[samples.length - 1];
  const settleResidualPx = Math.abs(settleSample.w - w0);

  const divergences = frames
    .filter((f) => f.styleW != null)
    .map((f) => Math.abs(f.rectW - (f.styleW as number)));
  const maxFlexDivergencePx = divergences.length ? Math.max(...divergences) : -1;

  let maxPerFrameWidthJumpPx = 0;
  for (let i = 1; i < frames.length; i++) {
    maxPerFrameWidthJumpPx = Math.max(maxPerFrameWidthJumpPx, Math.abs(frames[i].rectW - frames[i - 1].rectW));
  }

  return {
    label,
    w0,
    x0,
    frameCount: frames.length,
    maxRafGapMs,
    rafGapsOver50,
    rafGapsOver100,
    maxSlowResidualPx,
    settleResidualPx,
    maxFlexDivergencePx,
    maxPerFrameWidthJumpPx,
    samples,
  };
}

function summarize(r: ProbeReport): string {
  return [
    `── ${r.label} ──`,
    `  sidebar w0=${r.w0.toFixed(1)}px, frames=${r.frameCount}`,
    `  rAF gaps: max=${r.maxRafGapMs.toFixed(1)}ms, >50ms: ${r.rafGapsOver50}, >100ms: ${r.rafGapsOver100}`,
    `  slow-drag max residual (dom vs cursor): ${r.maxSlowResidualPx.toFixed(1)}px`,
    `  settle residual (returned to origin): ${r.settleResidualPx.toFixed(1)}px`,
    `  flex divergence (rect vs style.width): ${r.maxFlexDivergencePx.toFixed(1)}px`,
    `  max per-frame width jump: ${r.maxPerFrameWidthJumpPx.toFixed(1)}px`,
  ].join('\n');
}

// ── The test ────────────────────────────────────────────────────────────────

test.describe('Sash drag probe (split pdf|canvas)', () => {
  // Diagnostic probe — launches a visible Electron window, which disrupts
  // active app use. Excluded from the normal suite; run explicitly with:
  //   PARALLX_PROBE=1 npx playwright test tests/e2e/91-sash-drag-probe.spec.ts
  test.skip(!process.env.PARALLX_PROBE, 'diagnostic probe — set PARALLX_PROBE=1 to run');

  let workspacePath: string;

  test.beforeAll(async () => {
    workspacePath = await createTestWorkspace();
    await fs.writeFile(
      path.join(workspacePath, 'stress.pdf'),
      buildMultiPagePdf(24, 30),
    );
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(workspacePath);
  });

  test('measure sidebar sash drag: baseline vs split view', async ({ window, electronApp }) => {
    test.setTimeout(180_000);

    await openFolderViaMenu(electronApp, window, workspacePath, { force: true });

    // ── Probe A: baseline (explorer sidebar, single empty editor group) ──
    const baseline = await runDragProbe(window, 'A-baseline-no-split');
    console.log(summarize(baseline));

    // ── Build the user's layout: canvas page + heavy content ──
    await setupCanvasPage(window, electronApp, workspacePath);
    const blocks: any[] = [];
    for (let i = 0; i < 40; i++) {
      blocks.push({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: `Section ${i + 1}: Expected Loss Emergence` }],
      });
      blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', text: 'Clark uses a parameterized growth curve for expected loss emergence. '.repeat(6) }],
      });
    }
    await setContent(window, blocks);

    // Switch the sidebar back to Explorer (setupCanvasPage left it on Canvas)
    await window.getByRole('tab', { name: 'Explorer' }).click();
    await window.waitForSelector('.tree-node', { timeout: 10_000 });

    // Open the PDF (same group; PDF becomes active)
    const pdfNode = window.locator('.tree-node .tree-node-label', { hasText: 'stress.pdf' }).first();
    await pdfNode.click();
    await expect(window.locator('.pdf-editor-pane')).toBeVisible({ timeout: 15_000 });
    await window.waitForTimeout(1_000);

    // Split Editor Right via command palette (real user path)
    await window.keyboard.press('Control+Shift+p');
    const paletteInput = window.locator('.command-palette-input');
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill('');
    await paletteInput.pressSequentially('>Split Editor Right', { delay: 20 });
    await window.waitForTimeout(400);
    await window.keyboard.press('Enter');

    await expect(window.locator('.editor-group')).toHaveCount(2, { timeout: 10_000 });
    await window.waitForTimeout(1_000);

    // In group 1, activate the canvas tab (the non-pdf tab) so the layout is
    // canvas | pdf like the user's screenshot.
    const group1Tabs = window.locator('.editor-group').first().locator('.ui-tab');
    const tabCount = await group1Tabs.count();
    for (let i = 0; i < tabCount; i++) {
      const text = (await group1Tabs.nth(i).textContent()) ?? '';
      if (!text.includes('stress.pdf')) {
        await group1Tabs.nth(i).click();
        break;
      }
    }
    await window.waitForTimeout(500);

    await window.screenshot({ path: path.join(ARTIFACT_DIR, 'layout-before-drag.png') });

    // ── Probe B: split view (canvas | pdf) ──
    const split = await runDragProbe(window, 'B-split-canvas-pdf');
    console.log(summarize(split));

    await window.screenshot({ path: path.join(ARTIFACT_DIR, 'layout-after-drag.png') });

    const report = { baseline, split, when: new Date().toISOString() };
    await fs.writeFile(
      path.join(ARTIFACT_DIR, 'report.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    );

    // Probe assertions are deliberately loose — this test gathers evidence.
    // A settle residual > 40px or flex divergence > 8px means the model is
    // genuinely desynced (bug class 1) and should fail loudly once fixed.
    expect(baseline.frameCount).toBeGreaterThan(10);
    expect(split.frameCount).toBeGreaterThan(10);
  });
});
