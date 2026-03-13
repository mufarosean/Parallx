import { test, expect, createTestWorkspace, cleanupTestWorkspace, openFolderViaMenu } from './fixtures';
import fs from 'fs/promises';
import path from 'path';

const ARTIFACT_DIR = path.join(process.cwd(), 'test-results', 'pdf-diagnostics');

type PdfLine = string | string[];

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function estimateSegmentAdvance(segment: string): number {
  return segment.length * 9 + 6;
}

function buildPdf(lines: PdfLine[]): Buffer {
  const contentLines = [
    'BT',
    '/F1 18 Tf',
    ...lines.flatMap((line, index) => {
      const y = 740 - index * 28;
      const segments = Array.isArray(line) ? line : [line];
      let x = 72;
      return segments.flatMap((segment) => {
        const commands = [`1 0 0 1 ${x} ${y} Tm`, `(${escapePdfText(segment)}) Tj`];
        x += estimateSegmentAdvance(segment);
        return commands;
      });
    }),
    'ET',
  ];
  const stream = contentLines.join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

async function openWorkspaceAndPdf(electronApp: any, window: any, workspacePath: string, fileName: string): Promise<void> {
  await openFolderViaMenu(electronApp, window, workspacePath, { force: true });
  const fileNode = window.locator('.tree-node .tree-node-label', { hasText: fileName }).first();
  await fileNode.click();
  await expect(window.locator('.pdf-editor-pane')).toBeVisible({ timeout: 10_000 });
}

function rectMatchesBitmap(state: any): boolean {
  const canvasRect = state?.canvas?.rect;
  const dpr = state?.devicePixelRatio ?? 1;
  const widthDelta = Math.abs((state?.canvas?.width ?? 0) - Math.round((canvasRect?.width ?? 0) * dpr));
  const heightDelta = Math.abs((state?.canvas?.height ?? 0) - Math.round((canvasRect?.height ?? 0) * dpr));
  return widthDelta <= 2 && heightDelta <= 2;
}

function canvasMatchesTextLayer(state: any): boolean {
  const canvasRect = state?.canvas?.rect;
  const textRect = state?.textLayer?.rect;
  if (!canvasRect || !textRect) {
    return false;
  }

  return Math.abs(canvasRect.width - textRect.width) <= 2
    && Math.abs(canvasRect.height - textRect.height) <= 2;
}

function rectsOverlap(a: any, b: any): boolean {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right - left > 1 && bottom - top > 1;
}

function hasOverlaps(rects: any[]): boolean {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i], rects[j])) {
        return true;
      }
    }
  }
  return false;
}

function rectWithinBounds(rect: any, bounds: any): boolean {
  return rect.left >= bounds.left - 2
    && rect.top >= bounds.top - 2
    && rect.left + rect.width <= bounds.left + bounds.width + 2
    && rect.top + rect.height <= bounds.top + bounds.height + 2;
}

test.describe('PDF diagnostics', () => {
  let workspacePath: string;
  let pdfPath: string;

  test.beforeAll(async () => {
    workspacePath = await createTestWorkspace();
    pdfPath = path.join(workspacePath, 'diagnostic.pdf');
    await fs.writeFile(pdfPath, buildPdf([
      'PDF diagnostics baseline',
      ['Real-world ', 'loss ', 'data ', 'is ', 'subject ', 'to ', 'noise.'],
      'Selection should align with this text at 100 percent.',
      ['II. ', 'Least ', 'Squares ', 'Method'],
      'Lower zoom should not introduce CSP or font-load failures.',
    ]));
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(workspacePath);
  });

  test('captures PDF viewer runtime state, screenshots, and console errors', async ({ window, electronApp }, testInfo) => {
    const consoleMessages: Array<{ type: string; text: string }> = [];
    const pageErrors: string[] = [];

    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    window.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });
    window.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await openWorkspaceAndPdf(electronApp, window, workspacePath, 'diagnostic.pdf');

    const pdfPane = window.locator('.pdf-editor-pane');
    await expect(pdfPane).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.pdf-editor-pane .pdfViewer .page')).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.pdf-editor-pane .pdfViewer .page canvas')).toBeVisible({ timeout: 10_000 });
    await window.waitForFunction(() => typeof (window as any).__parallxPdfDebug?.getState === 'function', { timeout: 10_000 });
    await window.waitForTimeout(1500);

    await window.waitForFunction(() => {
      const state = (window as any).__parallxPdfDebug.getState();
      return state?.pageView?.renderingState === 3 && state?.textLayer?.rect?.width > 0;
    }, { timeout: 10_000 });

    const initialState = await window.evaluate(() => (window as any).__parallxPdfDebug.getState());
    await window.screenshot({ path: path.join(ARTIFACT_DIR, 'pdf-page-fit.png'), fullPage: true });

    const scale100ImmediateState = await window.evaluate(() => {
      return (window as any).__parallxPdfDebug.setNumericScale(1);
    });

    await window.waitForFunction(() => {
      const state = (window as any).__parallxPdfDebug.getState();
      return state?.pageView?.renderingState === 3 && state?.textLayer?.rect?.width > 0;
    }, { timeout: 10_000 });

    const scale100SettledState = await window.evaluate(() => (window as any).__parallxPdfDebug.getState());
    await window.screenshot({ path: path.join(ARTIFACT_DIR, 'pdf-100-percent.png'), fullPage: true });

    const postScrollState = await window.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.pdf-viewer-container');
      if (scroller) {
        scroller.scrollTop += 8;
        scroller.dispatchEvent(new Event('scroll'));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      return (window as any).__parallxPdfDebug.getState();
    });

    const selectionState = await window.evaluate(async () => {
      const spans = Array.from(document.querySelectorAll<HTMLElement>('.pdf-editor-pane .textLayer span'))
        .filter((span) => (span.textContent || '').trim().length > 0);
      const startIndex = spans.findIndex((span) => (span.textContent || '').includes('Real-world'));
      const targetSpans = startIndex >= 0 ? spans.slice(startIndex, startIndex + 5) : [];

      const first = targetSpans[0];
      const last = targetSpans[targetSpans.length - 1];
      if (!first || !last || !first.firstChild || !last.firstChild) {
        return null;
      }

      const range = document.createRange();
      range.setStart(first.firstChild, 0);
      range.setEnd(last.firstChild, (last.textContent || '').length);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      await new Promise<void>((resolve) => {
        const check = () => {
          const state = (window as any).__parallxPdfDebug.getState();
          if ((state?.selectionOverlay?.boxCount ?? 0) > 0) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });

      const spanRect = first.getBoundingClientRect();
      const rangeRects = Array.from(range.getClientRects()).map((rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }));
      const overlayBoxes = Array.from(document.querySelectorAll<HTMLElement>('.pdf-selection-overlay-box')).map((box) => {
        const rect = box.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      });
      const endOfContent = document.querySelector<HTMLElement>('.pdf-editor-pane .textLayer .endOfContent');

      return {
        text: selection?.toString() ?? '',
        spanRect: {
          left: spanRect.left,
          top: spanRect.top,
          width: spanRect.width,
          height: spanRect.height,
        },
        rangeRects,
        overlayBoxes,
        overlayRootCount: document.querySelectorAll('.pdf-selection-overlay-root').length,
        endOfContent: endOfContent ? {
          parentClassName: endOfContent.parentElement?.className ?? null,
          widthStyle: endOfContent.style.width || null,
          heightStyle: endOfContent.style.height || null,
        } : null,
      };
    });

    const headingSelectionState = await window.evaluate(async () => {
      const spans = Array.from(document.querySelectorAll<HTMLElement>('.pdf-editor-pane .textLayer span'))
        .filter((span) => (span.textContent || '').trim().length > 0);
      const startIndex = spans.findIndex((span) => (span.textContent || '').includes('II.'));
      const targetSpans = startIndex >= 0 ? spans.slice(startIndex, startIndex + 4) : [];

      const first = targetSpans[0];
      const last = targetSpans[targetSpans.length - 1];
      if (!first || !last || !first.firstChild || !last.firstChild) {
        return null;
      }

      const range = document.createRange();
      range.setStart(first.firstChild, 0);
      range.setEnd(last.firstChild, (last.textContent || '').length);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      selection?.addRange(range);

      await new Promise<void>((resolve) => {
        const check = () => {
          const state = (window as any).__parallxPdfDebug.getState();
          const firstBox = state?.selectionOverlay?.boxes?.[0];
          const headingRect = first.getBoundingClientRect();
          if ((state?.selectionOverlay?.boxCount ?? 0) > 0 && firstBox && Math.abs(firstBox.top - headingRect.top) <= 8) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });

      return {
        text: selection?.toString() ?? '',
        overlayBoxes: Array.from(document.querySelectorAll<HTMLElement>('.pdf-selection-overlay-box')).map((box) => {
          const rect = box.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          };
        }),
      };
    });

    const zoomedSelectionState = await window.evaluate(async () => {
      (window as any).__parallxPdfDebug.setNumericScale(1.25);
      await new Promise<void>((resolve) => {
        const check = () => {
          const state = (window as any).__parallxPdfDebug.getState();
          if (state?.pageView?.renderingState === 3 && (state?.selectionOverlay?.boxCount ?? 0) > 0) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
      return (window as any).__parallxPdfDebug.getState();
    });
    await window.waitForTimeout(250);
    await window.screenshot({ path: path.join(ARTIFACT_DIR, 'pdf-selection.png'), fullPage: true });

    const blockedFontOrCspErrors = consoleMessages.filter((entry) => {
      const text = entry.text.toLowerCase();
      return text.includes('content security policy') || text.includes('refused to load the font') || text.includes('font-src');
    });

    const diagnostic = {
      pdfPath,
      initialState,
      scale100ImmediateState,
      scale100SettledState,
      postScrollState,
      selectionState,
      headingSelectionState,
      zoomedSelectionState,
      consoleMessages,
      pageErrors,
      blockedFontOrCspErrors,
    };

    const jsonPath = path.join(ARTIFACT_DIR, 'pdf-diagnostic.json');
    await fs.writeFile(jsonPath, JSON.stringify(diagnostic, null, 2), 'utf8');
    await testInfo.attach('pdf-diagnostic', { path: jsonPath, contentType: 'application/json' });

    expect(blockedFontOrCspErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect((initialState as any)?.canvas?.rect?.width ?? 0).toBeGreaterThan(0);
    expect((scale100SettledState as any)?.canvas?.rect?.width ?? 0).toBeGreaterThan(0);
    expect((postScrollState as any)?.canvas?.rect?.width ?? 0).toBeGreaterThan(0);
    expect(selectionState).not.toBeNull();
    expect(headingSelectionState).not.toBeNull();
    expect((selectionState as any)?.rangeRects?.length ?? 0).toBeGreaterThan(0);
    expect((selectionState as any)?.overlayRootCount ?? 0).toBeGreaterThan(0);
    expect((selectionState as any)?.overlayBoxes?.length ?? 0).toBeGreaterThan(0);
    expect((selectionState as any)?.rangeRects?.length ?? 0).toBeGreaterThan((selectionState as any)?.overlayBoxes?.length ?? 0);
    expect(hasOverlaps((selectionState as any)?.overlayBoxes ?? [])).toBe(false);
    expect((headingSelectionState as any)?.overlayBoxes?.length ?? 0).toBe(1);
    expect(hasOverlaps((headingSelectionState as any)?.overlayBoxes ?? [])).toBe(false);
    expect((scale100SettledState as any)?.selectionOverlay?.boxCount ?? 0).toBe(0);
    expect((zoomedSelectionState as any)?.selectionOverlay?.boxCount ?? 0).toBeGreaterThan(0);
    expect(hasOverlaps((zoomedSelectionState as any)?.selectionOverlay?.boxes ?? [])).toBe(false);

    const zoomedTextRect = (zoomedSelectionState as any)?.textLayer?.rect;
    for (const rect of (zoomedSelectionState as any)?.selectionOverlay?.boxes ?? []) {
      expect(rectWithinBounds(rect, zoomedTextRect)).toBe(true);
    }

    expect(rectMatchesBitmap(initialState)).toBe(true);
    expect(canvasMatchesTextLayer(initialState)).toBe(true);
    expect(rectMatchesBitmap(scale100SettledState)).toBe(true);
    expect(canvasMatchesTextLayer(scale100SettledState)).toBe(true);
  });
});