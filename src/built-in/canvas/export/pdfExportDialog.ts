// pdfExportDialog.ts — the canvas "Export as PDF" dialog (M93).
//
// A Ctrl+P-style overlay: options on the left (paper size, orientation,
// margins, scale, title/page-number/background toggles), a REAL preview on
// the right. The preview is not an approximation — every settings change
// re-renders the actual PDF through the hidden-window `pdfExport:render`
// pipeline and paints its pages with pdf.js, so what you see is byte-for-byte
// what you save.

import './pdfExport.css';

import * as pdfjsLib from 'pdfjs-dist';
import { Dropdown } from '../../../ui/dropdown.js';
import { SegmentedControl } from '../../../ui/segmentedControl.js';
import {
  DEFAULT_PDF_SETTINGS,
  MARGIN_PRESETS,
  PAGE_SIZE_ITEMS,
  buildPdfRenderOptions,
  buildPrintHtml,
  sanitizeContentHtml,
  sanitizeFilename,
  type PdfExportSettings,
  type PdfMarginPresetId,
} from './printHtml.js';
import { resolveFontStack, getFontFaceCss } from '../config/fontRegistry.js';

// The PDF editor pane sets this too; set defensively so export previews work
// even when no PDF has ever been opened this session.
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = './dist/renderer/pdf.worker.min.mjs';
}

const PREVIEW_MAX_PAGES = 30;
const PREVIEW_DEBOUNCE_MS = 350;

interface PdfExportElectron {
  pdfExport?: {
    render(payload: {
      html: string;
      options: ReturnType<typeof buildPdfRenderOptions>;
      savePath?: string;
    }): Promise<{ ok: boolean; data?: string; error?: string }>;
  };
  dialog?: {
    saveFile(options: { filters?: { name: string; extensions: string[] }[]; defaultName?: string }): Promise<string | null>;
  };
  appPath?: string;
}

function getElectron(): PdfExportElectron | undefined {
  return (globalThis as unknown as { parallxElectron?: PdfExportElectron }).parallxElectron;
}

/**
 * Translate transport-level failures into something a person can act on.
 * The classic: the renderer hot-reloaded with this feature but the MAIN
 * process predates it — `ipcMain.handle('pdfExport:render')` only registers
 * at app startup, so the fix is a full quit + relaunch.
 */
function friendlyError(raw: string): string {
  if (raw.includes('No handler registered')) {
    return 'PDF export arrived in this update. Quit and relaunch Parallx to finish enabling it.';
  }
  return raw;
}

export interface PdfExportSource {
  readonly title: string;
  readonly iconHtml?: string;
  /** Canvas page font setting ('default' | 'serif' | 'mono'). */
  readonly fontFamily?: string;
  /** The live rendered content root (the `.ProseMirror` element). */
  getContentRoot(): HTMLElement | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

let _openDialog: HTMLElement | null = null;

/** Open the export dialog. A second call while open focuses the existing one. */
export function openPdfExportDialog(source: PdfExportSource): void {
  if (_openDialog && _openDialog.isConnected) {
    (_openDialog.querySelector('button') as HTMLButtonElement | null)?.focus();
    return;
  }

  const electron = getElectron();
  const contentRoot = source.getContentRoot();
  if (!electron?.pdfExport || !contentRoot) {
    console.warn('[Canvas] PDF export unavailable (no bridge or no content).');
    return;
  }

  let settings: PdfExportSettings = { ...DEFAULT_PDF_SETTINGS };
  let generation = 0;
  let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const disposables: { dispose(): void }[] = [];

  // ── Shell ──────────────────────────────────────────────────────────────

  const overlay = el('div', 'canvas-pdf-overlay');
  const dialog = el('div', 'canvas-pdf-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Export as PDF');
  overlay.appendChild(dialog);
  _openDialog = dialog;

  const close = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    generation++;
    void pdfDoc?.destroy().catch(() => { /* ignore */ });
    pdfDoc = null;
    for (const d of disposables) { try { d.dispose(); } catch { /* noop */ } }
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    _openDialog = null;
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKeydown, true);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  // ── Options column ─────────────────────────────────────────────────────

  const options = el('div', 'canvas-pdf-dialog__options');
  dialog.appendChild(options);

  const heading = el('h3', 'canvas-pdf-dialog__title');
  heading.textContent = 'Export as PDF';
  options.appendChild(heading);

  const field = (labelText: string): HTMLElement => {
    const label = el('div', 'canvas-pdf-dialog__label');
    label.textContent = labelText;
    options.appendChild(label);
    const host = el('div', 'canvas-pdf-dialog__field');
    options.appendChild(host);
    return host;
  };

  // Paper size.
  const sizeHost = field('Paper size');
  const sizeDropdown = new Dropdown(sizeHost, {
    items: PAGE_SIZE_ITEMS.map(p => ({ value: p.value, label: p.label })),
    selected: settings.pageSize,
    ariaLabel: 'Paper size',
  });
  disposables.push(sizeDropdown);
  disposables.push(sizeDropdown.onDidChange((v: string) => {
    settings = { ...settings, pageSize: v as PdfExportSettings['pageSize'] };
    scheduleRender();
  }));

  // Orientation — the workbench's own segmented control.
  const orientHost = field('Orientation');
  const orientControl = new SegmentedControl(orientHost, {
    segments: [
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' },
    ],
    selected: settings.landscape ? 'landscape' : 'portrait',
    ariaLabel: 'Orientation',
  });
  disposables.push(orientControl);
  disposables.push(orientControl.onDidChange((value: string) => {
    settings = { ...settings, landscape: value === 'landscape' };
    scheduleRender();
  }));

  // Margins.
  const marginHost = field('Margins');
  const marginDropdown = new Dropdown(marginHost, {
    items: MARGIN_PRESETS.map(p => ({ value: p.id, label: p.label })),
    selected: settings.marginPreset,
    ariaLabel: 'Margins',
  });
  disposables.push(marginDropdown);

  const customGrid = el('div', 'canvas-pdf-dialog__margin-grid');
  const marginInput = (side: 'top' | 'right' | 'bottom' | 'left'): HTMLInputElement => {
    const wrap = el('label', 'canvas-pdf-dialog__margin-cell');
    const cap = el('span');
    cap.textContent = side[0].toUpperCase() + side.slice(1);
    const input = el('input') as HTMLInputElement;
    input.type = 'number';
    input.min = '0';
    input.max = '80';
    input.step = '1';
    input.value = String(settings.customMarginsMm[side]);
    input.setAttribute('aria-label', `${side} margin (mm)`);
    input.addEventListener('change', () => {
      const v = Math.min(80, Math.max(0, Number(input.value) || 0));
      input.value = String(v);
      settings = { ...settings, customMarginsMm: { ...settings.customMarginsMm, [side]: v } };
      scheduleRender();
    });
    wrap.append(cap, input);
    customGrid.appendChild(wrap);
    return input;
  };
  marginInput('top'); marginInput('right'); marginInput('bottom'); marginInput('left');
  const mmNote = el('div', 'canvas-pdf-dialog__hint');
  mmNote.textContent = 'millimetres';
  customGrid.appendChild(mmNote);
  options.appendChild(customGrid);

  const syncCustomVisibility = (): void => {
    customGrid.style.display = settings.marginPreset === 'custom' ? '' : 'none';
  };
  disposables.push(marginDropdown.onDidChange((v: string) => {
    settings = { ...settings, marginPreset: v as PdfMarginPresetId };
    syncCustomVisibility();
    scheduleRender();
  }));
  syncCustomVisibility();

  // Scale.
  const scaleHost = field('Scale');
  scaleHost.classList.add('canvas-pdf-dialog__scale');
  const scaleSlider = el('input') as HTMLInputElement;
  scaleSlider.type = 'range';
  scaleSlider.min = '40';
  scaleSlider.max = '200';
  scaleSlider.step = '5';
  scaleSlider.value = String(settings.scalePercent);
  scaleSlider.setAttribute('aria-label', 'Scale percent');
  const scaleValue = el('span', 'canvas-pdf-dialog__scale-value');
  scaleValue.textContent = `${settings.scalePercent}%`;
  scaleSlider.addEventListener('input', () => {
    scaleValue.textContent = `${scaleSlider.value}%`;
  });
  scaleSlider.addEventListener('change', () => {
    settings = { ...settings, scalePercent: Number(scaleSlider.value) || 100 };
    scheduleRender();
  });
  scaleHost.append(scaleSlider, scaleValue);

  // Toggles.
  const toggles = el('div', 'canvas-pdf-dialog__toggles');
  const toggle = (labelText: string, get: () => boolean, set: (v: boolean) => void): void => {
    const wrap = el('label', 'canvas-pdf-dialog__toggle');
    const input = el('input') as HTMLInputElement;
    input.type = 'checkbox';
    input.checked = get();
    input.addEventListener('change', () => { set(input.checked); scheduleRender(); });
    const text = el('span');
    text.textContent = labelText;
    wrap.append(input, text);
    toggles.appendChild(wrap);
  };
  toggle('Include page title', () => settings.includeTitle, (v) => { settings = { ...settings, includeTitle: v }; });
  toggle('Page numbers', () => settings.pageNumbers, (v) => { settings = { ...settings, pageNumbers: v }; });
  toggle('Print backgrounds', () => settings.printBackground, (v) => { settings = { ...settings, printBackground: v }; });
  options.appendChild(toggles);

  // Status + footer.
  const status = el('div', 'canvas-pdf-dialog__status');
  options.appendChild(status);

  const foot = el('div', 'canvas-pdf-dialog__foot');
  const exportBtn = el('button', 'canvas-pdf-dialog__btn canvas-pdf-dialog__btn--primary');
  exportBtn.type = 'button';
  exportBtn.textContent = 'Export PDF';
  const cancelBtn = el('button', 'canvas-pdf-dialog__btn');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close());
  foot.append(exportBtn, cancelBtn);
  options.appendChild(foot);

  // ── Preview column ─────────────────────────────────────────────────────

  const preview = el('div', 'canvas-pdf-dialog__preview');
  const previewStatus = el('div', 'canvas-pdf-dialog__preview-status');
  previewStatus.textContent = 'Rendering preview…';
  const pagesHost = el('div', 'canvas-pdf-dialog__pages');
  preview.append(previewStatus, pagesHost);
  dialog.appendChild(preview);

  // ── Rendering ──────────────────────────────────────────────────────────

  const buildHtml = (): string | null => {
    const root = source.getContentRoot();
    if (!root) return null;
    return buildPrintHtml({
      title: source.title,
      iconHtml: source.iconHtml,
      contentHtml: sanitizeContentHtml(root),
      fontFamily: source.fontFamily,
      fontStack: resolveFontStack(source.fontFamily),
      fontFaceCss: getFontFaceCss(source.fontFamily),
      includeTitle: settings.includeTitle,
      appPath: electron.appPath,
    });
  };

  const renderPreview = async (): Promise<void> => {
    const gen = ++generation;
    previewStatus.textContent = 'Rendering preview…';
    previewStatus.style.display = '';

    const html = buildHtml();
    if (!html) {
      previewStatus.textContent = 'Nothing to export.';
      return;
    }

    try {
      const result = await electron.pdfExport!.render({ html, options: buildPdfRenderOptions(settings) });
      if (gen !== generation) return;
      if (!result.ok || !result.data) {
        previewStatus.textContent = `Preview failed: ${friendlyError(result.error ?? 'unknown error')}`;
        return;
      }

      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      const oldDoc = pdfDoc;
      const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      if (gen !== generation) { void doc.destroy().catch(() => { /* ignore */ }); return; }
      pdfDoc = doc;
      void oldDoc?.destroy().catch(() => { /* ignore */ });

      pagesHost.innerHTML = '';
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetWidth = Math.max(320, preview.clientWidth - 48);
      const pageCount = doc.numPages;
      const renderCount = Math.min(pageCount, PREVIEW_MAX_PAGES);

      for (let i = 1; i <= renderCount; i++) {
        if (gen !== generation) return;
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = targetWidth / base.width;
        const viewport = page.getViewport({ scale: scale * dpr });
        const canvas = el('canvas', 'canvas-pdf-dialog__page') as HTMLCanvasElement;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${targetWidth}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (gen !== generation) return;
        pagesHost.appendChild(canvas);
      }

      previewStatus.textContent = pageCount > renderCount
        ? `${pageCount} pages (showing first ${renderCount})`
        : `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
    } catch (err) {
      if (gen !== generation) return;
      previewStatus.textContent = `Preview failed: ${friendlyError(err instanceof Error ? err.message : String(err))}`;
    }
  };

  const scheduleRender = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { void renderPreview(); }, PREVIEW_DEBOUNCE_MS);
  };

  // ── Export ─────────────────────────────────────────────────────────────

  exportBtn.addEventListener('click', () => {
    void (async () => {
      const html = buildHtml();
      if (!html) return;
      if (!electron.dialog?.saveFile) {
        status.textContent = 'Save dialog unavailable in this build.';
        return;
      }
      const savePath = await electron.dialog.saveFile({
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        defaultName: `${sanitizeFilename(source.title)}.pdf`,
      });
      if (!savePath) return;

      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting…';
      status.textContent = '';
      try {
        const result = await electron.pdfExport!.render({
          html,
          options: buildPdfRenderOptions(settings),
          savePath,
        });
        if (result.ok) {
          status.textContent = `Saved to ${savePath}`;
          status.classList.remove('canvas-pdf-dialog__status--error');
          cancelBtn.textContent = 'Done';
        } else {
          status.textContent = `Export failed: ${friendlyError(result.error ?? 'unknown error')}`;
          status.classList.add('canvas-pdf-dialog__status--error');
        }
      } catch (err) {
        status.textContent = `Export failed: ${friendlyError(err instanceof Error ? err.message : String(err))}`;
        status.classList.add('canvas-pdf-dialog__status--error');
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = 'Export PDF';
      }
    })();
  });

  document.body.appendChild(overlay);
  void renderPreview();
}
