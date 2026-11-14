// documentReaderPanel.ts — the document reader in Settings.
//
// The reader as a thing on this computer: whether it is set up, what it
// takes on disk, setting it up (its progress shown here, in place), stopping
// a set-up, starting it, removing it. How one document was read is not here:
// that is the PDF view's Reading side.
//
// Every button runs a command (registerDocumentReaderCommands), and the
// state comes from the one place the app asks the reader's engine anything
// (services/documentReaderEngine.ts). Nothing is asked until the panel is
// shown, and a set-up carries on when Settings is closed: it then says in
// one notice how it ended.

import { createBlock, createButton } from '../../ui/kit.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { ISettingsPanel } from '../../services/settingsPanelRegistry.js';
import { documentReaderEngine, type DocumentReaderEngine, type IReaderEngineState, type IReaderSetUpResult } from '../../services/documentReaderEngine.js';
import './documentReaderPanel.css';

export const DOCUMENT_READER_PANEL_ID = 'document-reader';

export const READER_COMMANDS = {
  setUp: 'documentReader.setUp',
  stop: 'documentReader.stopSetUp',
  start: 'documentReader.start',
  remove: 'documentReader.remove',
  check: 'documentReader.checkAgain',
} as const;

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** What the State row says. */
export function stateLabel(state: IReaderEngineState): string {
  switch (state.phase) {
    case 'none': return 'Needs the desktop app';
    case 'unknown': return 'Checking…';
    case 'absent': return 'Not set up';
    case 'partial': return 'Setting up stopped part of the way';
    case 'installing': return 'Setting up';
    case 'ready': return 'Set up, not running';
    case 'starting': return 'Starting';
    case 'running': return state.engine === 'system' ? 'Running, from the Docling in this computer\'s own Python' : 'Set up and running';
    case 'unsupported': return 'Cannot be set up on this computer';
  }
}

/** What the Size row says; null when there is nothing to say (yet). */
export function sizeLabel(state: IReaderEngineState): string | null {
  if (state.bytesOnDisk && state.bytesOnDisk > 0) return `${gb(state.bytesOnDisk)} on this computer`;
  const notThere = state.phase === 'absent' || state.phase === 'partial' || state.phase === 'unsupported' || (state.phase === 'running' && state.engine === 'system');
  return notThere && state.downloadBytes > 0 ? `Downloads about ${gb(state.downloadBytes)} once, for every workspace` : null;
}

/** The buttons a state offers, first the one to press. */
export function actionsFor(state: IReaderEngineState): Array<{ id: keyof typeof READER_COMMANDS; label: string; icon: string; kind?: 'primary' | 'danger' }> {
  const remove = { id: 'remove', label: 'Remove…', icon: 'trash', kind: 'danger' } as const;
  switch (state.phase) {
    case 'absent': return [{ id: 'setUp', label: 'Set Up', icon: 'download', kind: 'primary' }];
    case 'partial': return [{ id: 'setUp', label: 'Carry On Setting Up', icon: 'download', kind: 'primary' }, remove];
    case 'installing': return [{ id: 'stop', label: 'Stop', icon: 'stop' }];
    case 'ready': return [{ id: 'start', label: 'Start', icon: 'play', kind: 'primary' }, remove];
    case 'running': return state.engine === 'system' ? [{ id: 'setUp', label: 'Set Up', icon: 'download' }] : [remove];
    case 'unsupported': return [{ id: 'check', label: 'Check Again', icon: 'refresh' }];
    default: return [];
  }
}

/** How a set-up that ended is told to someone who was not looking at the panel. */
export function setUpNotice(result: IReaderSetUpResult): { kind: 'info' | 'error'; text: string } {
  if (result.ok) return { kind: 'info', text: 'The document reader is set up and running. PDFs, Word files and scans are read with their tables and layout.' };
  if (result.stopped) return { kind: 'info', text: 'Setting up the document reader stopped. Settings carries it on from there.' };
  return { kind: 'error', text: `The document reader could not be set up. ${result.error ?? ''}`.trim() };
}

let _mounted = 0;
/** Is the panel on screen? A set-up that ends while it is not says so in a notice. */
export const documentReaderPanelShowing = (): boolean => _mounted > 0;

class DocumentReaderPanel implements IDisposable {
  private readonly _root: HTMLElement;
  private readonly _listening: IDisposable;
  /** While setting up: the parts progress changes, so Stop stays the same button under the finger. */
  private _live: { label: HTMLElement; bar: HTMLElement; fill: HTMLElement; bytes: HTMLElement } | null = null;

  constructor(container: HTMLElement, private readonly _engine: DocumentReaderEngine) {
    _mounted++;
    this._root = createBlock(container, 'div', { className: 'reader-settings' });
    this._listening = _engine.onDidChange(() => this._render());
    this._render();
    // The phase at once; what it takes on disk when it has been measured.
    void _engine.refresh().then(() => _engine.refresh(true));
  }

  private _render(): void {
    const state = this._engine.state;
    const step = state.step;
    if (state.phase === 'installing' && this._live && step) {
      const pct = Math.round(step.fraction * 100);
      this._live.label.textContent = step.label;
      this._live.fill.style.width = `${pct}%`;
      this._live.bar.setAttribute('aria-valuenow', String(pct));
      this._live.bytes.textContent = step.total ? `${gb(step.received ?? 0)} of ${gb(step.total)}` : '';
      return;
    }
    this._live = null;
    const root = this._root;
    const hadFocus = root.contains(document.activeElement);
    root.replaceChildren();

    const facts = createBlock(createBlock(root, 'table', { className: 'reader-settings__facts', attrs: { 'aria-label': 'The document reader on this computer' } }), 'tbody');
    const fact = (name: string, value: string): void => { const row = createBlock(facts, 'tr'); createBlock(row, 'th', { text: name, attrs: { scope: 'row' } }); createBlock(row, 'td', { text: value }); };
    fact('State', stateLabel(state));
    const size = sizeLabel(state);
    if (size) fact('Size', size);
    fact('Runs on', 'The processor. It takes no graphics memory.');

    if (state.phase === 'installing') {
      const pct = Math.round((step?.fraction ?? 0) * 100);
      const label = createBlock(root, 'p', { className: 'reader-settings__note', text: step?.label ?? 'Working', attrs: { 'aria-live': 'polite' } });
      const bar = createBlock(root, 'div', { className: 'reader-settings__progress', attrs: { role: 'progressbar', 'aria-label': 'Setting up the document reader', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) } });
      const fill = createBlock(bar, 'div', { className: 'reader-settings__progress-fill' });
      fill.style.width = `${pct}%`;
      const bytes = createBlock(root, 'p', { className: 'reader-settings__note reader-settings__note--quiet', text: step?.total ? `${gb(step.received ?? 0)} of ${gb(step.total)}` : '' });
      createBlock(root, 'p', { className: 'reader-settings__note', text: 'You can keep working, and close Settings. Stopping keeps what is done; setting up again carries on from there.' });
      this._live = { label, bar, fill, bytes };
    }
    for (const problem of state.problems) createBlock(root, 'p', { className: 'reader-settings__note', text: problem });
    if (state.error) createBlock(root, 'p', { className: 'reader-settings__note reader-settings__note--error', text: state.error, attrs: { role: 'alert' } });

    const actions = actionsFor(state);
    if (actions.length > 0) {
      const row = createBlock(root, 'div', { className: 'reader-settings__actions' });
      for (const a of actions) createButton(row, { id: `documentReader.${a.id}`, label: a.label, icon: a.icon, ...(a.kind ? { kind: a.kind } : {}), command: READER_COMMANDS[a.id] });
    }
    createBlock(root, 'p', { className: 'reader-settings__note reader-settings__note--quiet', text: 'How one document was read, and Read Again, are in the PDF view: open its side panel and choose Reading.' });

    // A press that changed the buttons must not drop the keyboard's place.
    if (hadFocus && !root.contains(document.activeElement)) root.querySelector<HTMLElement>('button')?.focus();
  }

  dispose(): void {
    _mounted = Math.max(0, _mounted - 1);
    this._listening.dispose();
    this._root.remove();
  }
}

export function createDocumentReaderPanel(engine: DocumentReaderEngine = documentReaderEngine): ISettingsPanel {
  return {
    id: DOCUMENT_READER_PANEL_ID,
    label: 'Document Reader',
    order: 72,
    description: 'Reads PDFs, Word files and scans on this computer, with their tables and layout. Nothing leaves the computer.',
    render: (container) => new DocumentReaderPanel(container, engine),
  };
}

/** What the panel's buttons run. `confirmRemove` asks before the engine is removed; `notify` tells how a set-up ended when the panel is not on screen. */
export function registerDocumentReaderCommands(
  commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable },
  host: { confirmRemove(detail: string): Promise<boolean>; notify(kind: 'info' | 'error', text: string): void },
  engine: DocumentReaderEngine = documentReaderEngine,
): IDisposable[] {
  return [
    commands.registerCommand(READER_COMMANDS.setUp, () => engine.setUp()),
    commands.registerCommand(READER_COMMANDS.stop, () => engine.stopSetUp()),
    commands.registerCommand(READER_COMMANDS.start, () => engine.start()),
    commands.registerCommand(READER_COMMANDS.check, () => engine.refresh(true)),
    commands.registerCommand(READER_COMMANDS.remove, async () => {
      const size = engine.state.bytesOnDisk ? ` It frees ${gb(engine.state.bytesOnDisk)}.` : '';
      if (!(await host.confirmRemove(`PDFs are read as plain text and scans are not read until it is set up again.${size} What it has already read is kept.`))) return false;
      return engine.remove();
    }),
    engine.onDidFinishSetUp((result) => {
      if (documentReaderPanelShowing()) return;
      const notice = setUpNotice(result);
      host.notify(notice.kind, notice.text);
    }),
  ];
}
