// src/services/documentExtractionService.ts — Docling-powered document extraction
//
// Manages document extraction via the Docling bridge (primary path) with
// automatic fallback to legacy extractors (pdf-parse, mammoth, SheetJS).
//
// Reference: docs/Parallx_Milestone_21.md Phase A — Task A.4

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type {
  IDocumentExtractionService,
  DocumentExtractionResult,
  DoclingBridgeStatus,
  ExtractionPipeline,
} from './serviceTypes.js';

// ─── Electron Bridge Typing ─────────────────────────────────────────────────

interface DoclingAPI {
  status(): Promise<{
    status: string;
    port: number | null;
    pythonPath: string | null;
    doclingInstalled: boolean;
  }>;
  start(): Promise<{ ok: boolean; status?: string; error?: string }>;
  convert(filePath: string, options?: { ocr?: boolean }): Promise<{
    ok: boolean;
    markdown?: string;
    page_count?: number;
    tables_found?: number;
    elapsed_ms?: number;
    diagnostics?: string[];
    error?: string;
  }>;
  convertBatch(files: { path: string; ocr?: boolean }[]): Promise<{
    ok: boolean;
    results?: any[];
    error?: string;
  }>;
}

interface DocumentAPI {
  extractText(filePath: string): Promise<{
    text?: string;
    format?: string;
    metadata?: Record<string, unknown>;
    error?: { code: string; message: string; path: string };
  }>;
}

function getDoclingAPI(): DoclingAPI | undefined {
  return (window as any).parallxElectron?.docling;
}

function getDocumentAPI(): DocumentAPI | undefined {
  return (window as any).parallxElectron?.document;
}

// ─── Service Implementation ─────────────────────────────────────────────────

export class DocumentExtractionService extends Disposable implements IDocumentExtractionService {

  private _isDoclingAvailable = false;
  private _bridgeStatus: DoclingBridgeStatus = 'unavailable';
  private _initialized = false;
  private _fallbackWarningShown = false;

  private readonly _onDidChangeAvailability = this._register(new Emitter<boolean>());
  readonly onDidChangeAvailability: Event<boolean> = this._onDidChangeAvailability.event;

  private readonly _onDidChangeBridgeStatus = this._register(new Emitter<DoclingBridgeStatus>());
  readonly onDidChangeBridgeStatus: Event<DoclingBridgeStatus> = this._onDidChangeBridgeStatus.event;

  get isDoclingAvailable(): boolean {
    return this._isDoclingAvailable;
  }

  get bridgeStatus(): DoclingBridgeStatus {
    return this._bridgeStatus;
  }

  // ── Initialization ──────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    const api = getDoclingAPI();
    if (!api) {
      console.log('[DocumentExtractionService] Docling API not available in preload');
      this._setBridgeStatus('unavailable');
      return;
    }

    // Check current status
    try {
      const status = await api.status();
      if (status.status === 'available') {
        this._setBridgeStatus('available');
        this._setDoclingAvailable(true);
        return;
      }
    } catch {
      // Not started yet — try to start
    }

    // Attempt to start the bridge
    try {
      this._setBridgeStatus('starting');
      const result = await api.start();
      if (result.ok) {
        this._setBridgeStatus('available');
        this._setDoclingAvailable(true);
      } else {
        this._setBridgeStatus('unavailable');
        this._setDoclingAvailable(false);
        console.log('[DocumentExtractionService] Docling bridge not available:', result.error ?? 'unknown reason');
      }
    } catch (err) {
      this._setBridgeStatus('unavailable');
      this._setDoclingAvailable(false);
      console.log('[DocumentExtractionService] Failed to start Docling bridge:', err);
    }
  }

  // ── Document Extraction ─────────────────────────────────────────────────

  async extractDocument(
    filePath: string,
    options?: { ocr?: boolean },
  ): Promise<DocumentExtractionResult> {
    // Try Docling first
    if (this._isDoclingAvailable) {
      try {
        return await this._extractViaDocling(filePath, options);
      } catch (err) {
        console.warn(
          '[DocumentExtractionService] Docling extraction failed for "%s", falling back to legacy: %s',
          filePath, err,
        );
        // Fall through to legacy
      }
    }

    // Fallback to legacy extractors
    return this._extractViaLegacy(filePath);
  }

  // ── Docling Path ────────────────────────────────────────────────────────

  private async _extractViaDocling(
    filePath: string,
    options?: { ocr?: boolean },
  ): Promise<DocumentExtractionResult> {
    const api = getDoclingAPI();
    if (!api) {
      throw new Error('Docling API not available');
    }

    const result = await api.convert(filePath, { ocr: options?.ocr ?? false });

    if (!result.ok) {
      throw new Error(result.error ?? 'Docling conversion failed');
    }

    const pipeline: ExtractionPipeline = options?.ocr ? 'docling-ocr' : 'docling';

    return {
      markdown: result.markdown ?? '',
      pageCount: result.page_count ?? 0,
      tablesFound: result.tables_found ?? 0,
      elapsedMs: result.elapsed_ms ?? 0,
      diagnostics: result.diagnostics ?? [],
      pipeline,
    };
  }

  // ── Legacy Path ─────────────────────────────────────────────────────────

  private async _extractViaLegacy(filePath: string): Promise<DocumentExtractionResult> {
    const api = getDocumentAPI();
    if (!api) {
      throw new Error('Legacy document extraction API not available');
    }

    if (!this._fallbackWarningShown) {
      this._fallbackWarningShown = true;
      console.warn(
        '[DocumentExtractionService] Using legacy extractors. Install Docling for better document quality: pip install docling',
      );
    }

    const start = performance.now();
    const result = await api.extractText(filePath);

    if (result?.error) {
      throw new Error(result.error.message || 'Legacy extraction failed');
    }

    const elapsedMs = Math.round(performance.now() - start);

    return {
      markdown: result.text ?? '',
      pageCount: (result.metadata?.pageCount as number) ?? 0,
      tablesFound: 0,
      elapsedMs,
      diagnostics: ['Legacy extractor used'],
      pipeline: 'legacy',
    };
  }

  // ── Internal State Updates ──────────────────────────────────────────────

  private _setDoclingAvailable(available: boolean): void {
    if (this._isDoclingAvailable === available) return;
    this._isDoclingAvailable = available;
    this._onDidChangeAvailability.fire(available);
  }

  private _setBridgeStatus(status: DoclingBridgeStatus): void {
    if (this._bridgeStatus === status) return;
    this._bridgeStatus = status;
    this._onDidChangeBridgeStatus.fire(status);
  }
}
