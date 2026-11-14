// pdfReadingPanel.ts — the Reading side of the PDF view's panel.
//
// Beside Outline and Pages: how the document reader read the open document
// (when, from its own text or from its pixels, how many pages), what it
// found on it (its tables and captioned figures, each a link to its place,
// framed), and Read Again. The reader itself (set up, size, remove) lives in
// Settings; this side is about this one document.
//
// - A document the reader has not read yet offers Read Now.
// - Read Again reads it the way it was read before; a document never read is
//   read from its pixels when it is a scan, from its own text otherwise.
// - A reading in flight, whoever asked for it (this side, or the view reading
//   a scan as it opens), shows as one line and takes the button away.
// - With no reader set up, it says so and offers the way to Settings.
//
// A found table or figure is an ordinary link to a place in the file
// (parallx://explorer/file, its page and the words that find it), so it goes
// the road a citation goes: the page, the words washed, the block framed.

import { createBlock, createButton, createSectionLabel } from '../../../ui/kit.js';
import { createLink } from '../../../ui/link.js';
import type { IDisposable } from '../../../platform/lifecycle.js';
import { formatRelativeTime } from '../../../ui/relativeTime.js';
import { fetchDocumentReading, type IDocumentReading } from '../../../services/documentReading.js';
import { documentReaderEngine, type ReaderPhase } from '../../../services/documentReaderEngine.js';
import { listReadingFindings, type IReadingFinding } from '../../../services/readingLocate.js';
import './pdfReadingPanel.css';

export interface IPdfReadingPanelHost {
  /** The file on screen. */
  fsPath(): string | undefined;
  /** Is the open document a scan: do most of its pages have no text of their own? */
  isScan(): Promise<boolean>;
  /** The reader has read the open document again: its pages take the new reading's text. */
  readingArrived(reading: IDocumentReading): Promise<unknown> | void;
}

/** The command that reads the document in the pane that has the focus (commands/doclingCommands.ts). */
export const READ_AGAIN_COMMAND = 'pdf.readAgain';
const SET_UP_COMMAND = 'parallx.installDocling';

/** A reader in one of these phases can be asked to read. */
const CAN_READ: ReadonlySet<ReaderPhase> = new Set(['ready', 'starting', 'running']);

/** A link to a found table or figure: its page, and the words that find it there. */
export function findingHref(fsPath: string, finding: IReadingFinding): string {
  const params = new URLSearchParams({ path: fsPath.replace(/\\/g, '/'), page: String(finding.page) });
  if (finding.quote) params.set('quote', finding.quote.slice(0, 160));
  return `parallx://explorer/file?${params.toString()}`;
}

/** The facts of a reading, as name and value. */
export function readingFacts(reading: IDocumentReading, findings: readonly IReadingFinding[], now: number = Date.now()): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  if (reading.readAt) facts.push(['Read', formatRelativeTime(reading.readAt, 'long', now)]);
  facts.push(['How', reading.ocr ? 'From its pixels' : 'From its own text']);
  facts.push(['Pages', String(reading.pages.length)]);
  facts.push(['Tables', String(reading.tables.length)]);
  const figures = findings.filter((f) => f.kind === 'figure').length;
  if (figures > 0) facts.push(['Figures', String(figures)]);
  const formulas = reading.blocks.filter((b) => b.label === 'formula').length;
  if (formulas > 0) facts.push(['Formulas', String(formulas)]);
  return facts;
}

export class PdfReadingPanel implements IDisposable {
  private readonly _root: HTMLElement;
  private readonly _listening: IDisposable;
  /** Counts refreshes, so an answer for an earlier document is dropped. */
  private _turn = 0;
  private _error: string | null = null;
  private _showing = false;

  constructor(container: HTMLElement, private readonly _host: IPdfReadingPanelHost) {
    this._root = createBlock(container, 'div', { className: 'pdf-reading' });
    this._listening = documentReaderEngine.onDidChangeReading((fsPath) => {
      if (this._showing && fsPath.toLowerCase() === this._host.fsPath()?.toLowerCase()) void this.refresh();
    });
  }

  /** The side is shown, or hidden: nothing is asked for a side nobody is looking at. */
  setShowing(showing: boolean): void {
    if (this._showing === showing) return;
    this._showing = showing;
    if (showing) void this.refresh();
  }

  /** Another document opened: what was said about the last one goes. */
  documentChanged(): void {
    this._error = null;
    this._turn++;
    this._root.replaceChildren();
    if (this._showing) void this.refresh();
  }

  /** Show where the open document's reading stands. */
  async refresh(): Promise<void> {
    const turn = ++this._turn;
    const fsPath = this._host.fsPath();
    const root = this._root;
    // No document on screen: nothing to say.
    if (!fsPath) { root.replaceChildren(); return; }
    const [reading, engine] = await Promise.all([fetchDocumentReading(fsPath), documentReaderEngine.refresh()]);
    if (turn !== this._turn) return;
    root.replaceChildren();
    const note = (text: string, kind = '', attrs?: Record<string, string>): void => {
      createBlock(root, 'p', { className: `pdf-reading__note${kind ? ` pdf-reading__${kind}` : ''}`, text, ...(attrs ? { attrs } : {}) });
    };
    const button = (id: string, label: string, icon: string, command: string): void => {
      createButton(createBlock(root, 'div', { className: 'pdf-reading__actions' }), { id, label, icon, size: 'sm', command });
    };
    const findings = listReadingFindings(reading);

    // How it was read.
    if (reading) {
      const facts = createBlock(createBlock(root, 'table', { className: 'pdf-reading__facts', attrs: { 'aria-label': 'How this document was read' } }), 'tbody');
      for (const [name, value] of readingFacts(reading, findings)) {
        const row = createBlock(facts, 'tr');
        createBlock(row, 'th', { text: name, attrs: { scope: 'row' } });
        createBlock(row, 'td', { text: value });
      }
    }

    // What can be done about it: one line, or one button.
    if (documentReaderEngine.isReading(fsPath)) {
      note('Reading this document…', 'busy', { role: 'status', 'aria-live': 'polite' });
    } else {
      if (this._error) note(this._error, 'error', { role: 'alert' });
      if (CAN_READ.has(engine.phase)) {
        if (!reading) note('The document reader has not read this document yet.');
        button('pdf.reading.read', reading ? 'Read Again' : 'Read Now', 'refresh', READ_AGAIN_COMMAND);
      } else if (engine.phase === 'none') {
        note('The document reader needs the desktop app.');
      } else if (engine.phase === 'installing') {
        note('The document reader is being set up.');
      } else {
        note('The document reader is not set up. A PDF is read as plain text, and a scan is not read at all.');
        button('pdf.reading.setUp', 'Set Up Document Reader…', 'download', SET_UP_COMMAND);
      }
    }

    // What it found: each a link to its place.
    if (findings.length > 0) {
      createSectionLabel(root, 'Tables and figures');
      const list = createBlock(root, 'ul', { className: 'pdf-reading__findings' });
      for (const finding of findings) {
        const row = createBlock(list, 'li', { className: 'pdf-reading__finding' });
        createLink(row, { id: null, href: findingHref(fsPath, finding), label: finding.label, title: `${finding.label} (page ${finding.page})`, external: false });
        createBlock(row, 'span', { className: 'pdf-reading__page', text: `Page ${finding.page}` });
      }
    }
  }

  /** Read the open document now (what Read Again and Read Now do). */
  async readAgain(): Promise<void> {
    const fsPath = this._host.fsPath();
    if (!fsPath || documentReaderEngine.isReading(fsPath)) return;
    this._error = null;
    const kept = await fetchDocumentReading(fsPath);
    // The way it was read before. A reading from pixels gives a scan's pages text, so the pages cannot be asked again.
    const ocr = kept?.ocr === true || await this._host.isScan();
    if (this._host.fsPath() !== fsPath) return;
    const result = await documentReaderEngine.read(fsPath, ocr);
    if (this._host.fsPath() !== fsPath) return;
    if (!result.ok) {
      this._error = result.error ?? 'The document could not be read.';
    } else {
      const reading = await fetchDocumentReading(fsPath);
      if (reading && this._host.fsPath() === fsPath) await this._host.readingArrived(reading);
    }
    if (this._showing) await this.refresh();
  }

  dispose(): void {
    this._turn++;
    this._listening.dispose();
    this._root.remove();
  }
}
