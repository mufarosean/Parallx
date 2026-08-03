// pythonSettingsPanel.ts — the workspace Python runtime panel (M94).
//
// The flat schema registry already renders the `python.*` keys as rows. This
// panel exists for everything a key/value row cannot express: whether an
// environment actually exists on disk, what it weighs, which packages are in
// it, and what the last few runs did.
//
// A note on the copy in here. It would be easy to write "sandboxed" on this
// screen and it would be a lie: packages, caches and temp files are genuinely
// workspace-local, but a running Python process is an ordinary child process
// with the user's own permissions and unrestricted network. The panel says so
// plainly, once, near the switch — because a security claim the software
// cannot keep is worse than no claim at all.

import { DisposableStore, type IDisposable } from '../../platform/lifecycle.js';
import type { ISettingsPanel } from '../../services/settingsPanelRegistry.js';
import type {
  IPythonEnvService,
  IPythonPackage,
} from '../../services/pythonEnvService.js';
import { InputBox } from '../../ui/inputBox.js';
import { Toggle } from '../../ui/toggle.js';
import { rafThrottle } from '../../platform/rafThrottle.js';
import './pythonSettings.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return '<1 MB';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

class PythonSettingsPanel implements IDisposable {
  private readonly _store = new DisposableStore();
  private readonly _root: HTMLElement;

  // Sections re-rendered independently so a package install does not blow away
  // the run log the user is reading.
  private readonly _statusHost: HTMLElement;
  private readonly _packagesHost: HTMLElement;
  private readonly _runsHost: HTMLElement;

  /**
   * Live output from pip / venv, shown where the button was pressed.
   *
   * The Terminal panel mirrors the same stream (it subscribes to onDidProgress
   * too), but this copy stays: the user who clicked Install here should not
   * have to switch panels to see whether it worked.
   */
  private readonly _logHost: HTMLElement;
  private readonly _logPre: HTMLElement;

  private _busy = false;
  /** Last known env size, reused while an operation is in flight. */
  private _lastSize: { sizeBytes: number; fileCount: number } = { sizeBytes: 0, fileCount: 0 };

  constructor(container: HTMLElement, private readonly _service: IPythonEnvService) {
    this._root = el('div', 'pysettings');
    container.appendChild(this._root);

    this._root.appendChild(this._buildConsent());
    this._statusHost = el('div', 'pysettings__section');
    this._packagesHost = el('div', 'pysettings__section');

    this._logHost = el('div', 'pysettings__section pysettings__log');
    this._logHost.hidden = true;
    const logTitle = el('div', 'pysettings__log-title', 'Output');
    this._logPre = el('pre', 'pysettings__log-body');
    this._logHost.append(logTitle, this._logPre);

    this._runsHost = el('div', 'pysettings__section');
    this._root.append(this._statusHost, this._packagesHost, this._logHost, this._runsHost);

    this._store.add(this._service.onDidProgress((p) => this._appendLog(p.chunk)));

    this._store.add(this._service.onDidChangeStatus(() => {
      void this._refreshStatus();
      void this._refreshPackages();
      this._refreshRuns();
    }));
    // Live output while a script runs. Only the affected run's output node is
    // touched: the old version rebuilt the entire run list on EVERY stdout
    // chunk, which flickered, destroyed scroll position mid-read, and cost a
    // full DOM teardown per print statement.
    this._store.add(this._service.onDidRunData((p) => this._updateRunOutput(p.runId)));
    this._store.add(this._service.onDidRunExit(() => this._refreshRuns()));

    void this._refreshStatus();
    void this._refreshPackages();
    this._refreshRuns();
  }

  // ── Consent ──

  private _buildConsent(): HTMLElement {
    const section = el('div', 'pysettings__section');
    const row = el('div', 'pysettings__toggle-row');

    const labelWrap = el('div', 'pysettings__toggle-label');
    labelWrap.appendChild(el('div', 'pysettings__toggle-title', 'Python in this workspace'));
    labelWrap.appendChild(el(
      'div',
      'pysettings__toggle-help',
      'Creates a private environment at .parallx/venv. Packages, caches, and temp ' +
      'files stay inside this workspace and are invisible to your other workspaces.',
    ));

    // The app's ONE toggle (src/ui/toggle.ts), not a local look-alike. The
    // first version hand-rolled a switch here, which is the same mistake as
    // budget's hand-rolled dropdown: a private copy that drifts from the house
    // look and never receives fixes.
    const toggleHost = el('div');
    const toggle = new Toggle(toggleHost, {
      checked: this._service.isEnabled,
      ariaLabel: 'Enable Python for this workspace',
    });
    this._store.add(toggle);
    this._store.add(toggle.onDidChange((on) => {
      void this._service.setEnabled(on);
    }));
    // Reflect changes made elsewhere (another panel instance, a settings edit).
    this._store.add(this._service.onDidChangeStatus(() => {
      toggle.checked = this._service.isEnabled;
    }));

    row.append(labelWrap, toggleHost);
    section.appendChild(row);

    // The honest caveat. Stated once, next to the decision it qualifies.
    const caveat = el('div', 'pysettings__caveat');
    caveat.appendChild(el('div', 'pysettings__caveat-title', 'What this does not do'));
    caveat.appendChild(el(
      'div',
      'pysettings__caveat-body',
      'A running script is a normal program on your computer: it can read and write ' +
      'files outside this workspace and reach the network, exactly like anything else ' +
      'you launch. Parallx keeps the environment local and records every install and ' +
      'run in the activity journal. It does not sandbox the script. Only enable this ' +
      'for workspaces whose scripts you would run yourself.',
    ));
    section.appendChild(caveat);

    if (!this._service.isAvailable) {
      section.appendChild(el('div', 'pysettings__notice', 'Python is only available in the desktop app.'));
    }

    return section;
  }

  // ── Status ──

  private async _refreshStatus(): Promise<void> {
    const status = await this._service.getStatus();
    // Skip the size walk while pip is running: the tree is actively growing,
    // the disk is already saturated, and the answer would be stale the instant
    // it arrived. The value refreshes when the operation finishes.
    const size = status.envExists && !this._busy
      ? await this._service.getEnvSize()
      : this._lastSize;
    this._lastSize = size;
    this._statusHost.replaceChildren();
    this._statusHost.appendChild(el('h3', 'pysettings__heading', 'Environment'));

    if (!status.interpreterFound) {
      const warn = el('div', 'pysettings__notice pysettings__notice--warn');
      warn.textContent =
        'No Python 3.10 or newer found on this machine. Install it from python.org, ' +
        'then reopen this panel.';
      this._statusHost.appendChild(warn);
      return;
    }

    const grid = el('div', 'pysettings__facts');
    const fact = (label: string, value: string) => {
      const f = el('div', 'pysettings__fact');
      f.appendChild(el('div', 'pysettings__fact-label', label));
      f.appendChild(el('div', 'pysettings__fact-value', value));
      grid.appendChild(f);
    };

    fact('System interpreter', `Python ${status.interpreterVersion ?? '?'}`);
    fact('Environment', status.envExists ? '.parallx/venv' : 'Not created yet');
    if (status.envExists) {
      fact('Built with', status.createdWith ? `Python ${status.createdWith}` : 'unknown');
      fact('On disk', `${formatBytes(size.sizeBytes)} · ${size.fileCount.toLocaleString()} files`);
      if (status.createdAt) {
        fact('Created', new Date(status.createdAt).toLocaleDateString());
      }
    }
    this._statusHost.appendChild(grid);

    const actions = el('div', 'pysettings__actions');
    if (!status.envExists) {
      const create = el('button', 'pysettings__btn pysettings__btn--primary', 'Create environment');
      create.type = 'button';
      create.disabled = !this._service.isEnabled || this._busy;
      create.addEventListener('click', () => void this._withBusy(create, 'Creating…', async () => {
        this._startLog('Creating the workspace environment…');
        const res = await this._service.createEnv();
        if (!res.ok) { this._appendLog(`\n${res.error ?? 'Failed.'}\n`); this._showError(this._statusHost, res.error); }
      }));
      actions.appendChild(create);
      if (!this._service.isEnabled) {
        actions.appendChild(el('span', 'pysettings__hint', 'Turn Python on above first.'));
      }
    } else {
      const remove = el('button', 'pysettings__btn pysettings__btn--danger', 'Delete environment');
      remove.type = 'button';
      remove.disabled = this._busy;
      remove.title = 'Removes .parallx/venv only. Your scripts and outputs are left alone.';
      remove.addEventListener('click', () => void this._withBusy(remove, 'Deleting…', async () => {
        const res = await this._service.removeEnv();
        if (!res.ok) this._showError(this._statusHost, res.error);
      }));
      actions.appendChild(remove);
      actions.appendChild(el('span', 'pysettings__hint', 'Deleting removes packages only. Scripts and outputs stay.'));
    }
    this._statusHost.appendChild(actions);
  }

  // ── Packages ──

  private async _refreshPackages(): Promise<void> {
    const status = await this._service.getStatus();
    this._packagesHost.replaceChildren();
    if (!status.envExists) return;

    this._packagesHost.appendChild(el('h3', 'pysettings__heading', 'Packages'));

    const addRow = el('div', 'pysettings__add-row');
    const inputHost = el('div', 'pysettings__add-input');
    const input = new InputBox(inputHost, {
      placeholder: 'pandas, or pandas==2.1.0',
      ariaLabel: 'Package to install',
    });
    this._store.add(input);

    const addBtn = el('button', 'pysettings__btn pysettings__btn--primary', 'Install');
    addBtn.type = 'button';
    const doInstall = () => {
      const spec = input.value.trim();
      if (!spec) return;
      void this._withBusy(addBtn, 'Installing…', async () => {
        // Space-separated so "pandas matplotlib" in one go works as expected.
        const specs = spec.split(/\s+/).filter(Boolean);
        this._startLog(`Installing ${specs.join(', ')}…`);
        const res = await this._service.installPackages(specs);
        if (!res.ok) {
          this._appendLog(`\n${res.error ?? 'Install failed.'}\n`);
          this._showError(this._packagesHost, res.error);
        } else {
          input.value = '';
        }
      });
    };
    addBtn.addEventListener('click', doInstall);
    inputHost.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); doInstall(); }
    });

    addRow.append(inputHost, addBtn);
    this._packagesHost.appendChild(addRow);

    const packages = await this._service.listPackages();
    if (!packages.length) {
      this._packagesHost.appendChild(el('div', 'pysettings__empty', 'No packages installed yet.'));
      return;
    }

    const list = el('div', 'pysettings__list');
    for (const pkg of packages) {
      list.appendChild(this._buildPackageRow(pkg));
    }
    this._packagesHost.appendChild(list);
  }

  private _buildPackageRow(pkg: IPythonPackage): HTMLElement {
    const row = el('div', 'pysettings__row');
    row.appendChild(el('div', 'pysettings__pkg-name', pkg.name));
    row.appendChild(el('div', 'pysettings__pkg-version', pkg.version));

    const remove = el('button', 'pysettings__link-btn', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => void this._withBusy(remove, '…', async () => {
      this._startLog(`Removing ${pkg.name}…`);
      const res = await this._service.uninstallPackages([pkg.name]);
      if (!res.ok) this._showError(this._packagesHost, res.error);
    }));
    row.appendChild(remove);
    return row;
  }

  // ── Runs ──

  /** Live rows by runId, so streamed output updates in place. */
  private readonly _runRows = new Map<string, { row: HTMLElement; pre: HTMLElement | null }>();

  /**
   * Update one running row's output tail without touching the rest of the list.
   * A run this panel has not seen yet (started after the last rebuild) falls
   * back to a full refresh.
   */
  private _updateRunOutput(runId: string): void {
    const entry = this._runRows.get(runId);
    if (!entry) { this._refreshRuns(); return; }

    const run = this._service.recentRuns().find((r) => r.runId === runId);
    if (!run || !run.output.trim()) return;

    // Tail, not head — matches _refreshRuns. Setting textContent on a bounded
    // 4 KB node is cheap; the expensive thing was rebuilding every row.
    const tail = run.output.length > 4000 ? '…' + run.output.slice(-4000) : run.output;
    if (!entry.pre) {
      entry.pre = el('pre', 'pysettings__run-output');
      entry.row.appendChild(entry.pre);
    }
    entry.pre.textContent = tail;
    entry.pre.scrollTop = entry.pre.scrollHeight;
  }

  private _refreshRuns(): void {
    const runs = this._service.recentRuns();
    this._runsHost.replaceChildren();
    this._runRows.clear();
    if (!runs.length) return;

    this._runsHost.appendChild(el('h3', 'pysettings__heading', 'Recent runs'));
    const list = el('div', 'pysettings__list');

    for (const run of runs) {
      const row = el('div', 'pysettings__run');
      const head = el('div', 'pysettings__run-head');

      const running = run.exitCode === null;
      const dot = el('span', 'pysettings__dot');
      dot.classList.add(
        running ? 'pysettings__dot--running'
          : run.exitCode === 0 ? 'pysettings__dot--ok'
            : 'pysettings__dot--fail',
      );
      head.appendChild(dot);
      head.appendChild(el('span', 'pysettings__run-path', run.scriptPath.split(/[\\/]/).pop() ?? run.scriptPath));

      const meta = running
        ? 'running…'
        : `${run.error ? run.error : `exit ${run.exitCode}`} · ${formatDuration(run.durationMs)}`;
      head.appendChild(el('span', 'pysettings__run-meta', meta));

      if (running) {
        const cancel = el('button', 'pysettings__link-btn', 'Stop');
        cancel.type = 'button';
        cancel.addEventListener('click', () => void this._service.cancelRun(run.runId));
        head.appendChild(cancel);
      }
      row.appendChild(head);

      let pre: HTMLElement | null = null;
      if (run.output.trim()) {
        // Tail, not head: when a script fails the interesting part is the end.
        const tail = run.output.length > 4000 ? '…' + run.output.slice(-4000) : run.output;
        pre = el('pre', 'pysettings__run-output', tail);
        row.appendChild(pre);
      }
      this._runRows.set(run.runId, { row, pre });
      list.appendChild(row);
    }
    this._runsHost.appendChild(list);
  }

  // ── Helpers ──

  /**
   * Append streamed output, keeping the view pinned to the newest line.
   *
   * Two things here are deliberate, and the naive version of each was a real
   * source of jank during a long install on a slow disk:
   *
   * - The length is tracked in a field rather than read back from
   *   `textContent`. Reading it is O(n) over the whole buffer, so doing it per
   *   chunk makes appending O(n²).
   * - The scroll is coalesced to one per frame through the app's shared
   *   rafThrottle. Assigning `scrollTop = scrollHeight` forces a synchronous
   *   layout, and pip emits many small chunks.
   */
  private _logLength = 0;

  private readonly _pinScroll = rafThrottle(() => {
    this._logPre.scrollTop = this._logPre.scrollHeight;
  });

  private _appendLog(chunk: string): void {
    if (!chunk) return;
    this._logHost.hidden = false;
    // pip redraws with carriage returns when it thinks it has a terminal.
    // Collapsing them to newlines keeps the log readable instead of showing
    // one line of overwritten mush.
    const text = chunk.replace(/\r(?!\n)/g, '\n');
    this._logPre.appendChild(document.createTextNode(text));
    this._logLength += text.length;

    // Bound it: a big install prints a lot, and this is a settings pane.
    // Trimming drops whole leading nodes rather than reassigning textContent,
    // which would rebuild the entire buffer on every overflow.
    const MAX = 40_000;
    while (this._logLength > MAX && this._logPre.childNodes.length > 1) {
      const first = this._logPre.firstChild!;
      this._logLength -= (first.textContent ?? '').length;
      this._logPre.removeChild(first);
    }
    this._pinScroll();
  }

  private _startLog(header: string): void {
    this._logHost.hidden = false;
    this._logPre.replaceChildren();
    this._logLength = 0;
    this._appendLog(header.endsWith('\n') ? header : header + '\n');
  }

  private async _withBusy(button: HTMLButtonElement, busyLabel: string, work: () => Promise<void>): Promise<void> {
    if (this._busy) return;
    this._busy = true;
    const original = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
    try {
      await work();
    } finally {
      this._busy = false;
      button.textContent = original;
      button.disabled = false;
      void this._refreshStatus();
      void this._refreshPackages();
    }
  }

  private _showError(host: HTMLElement, message: string | undefined): void {
    const existing = host.querySelector('.pysettings__notice--error');
    if (existing) existing.remove();
    const err = el('div', 'pysettings__notice pysettings__notice--error');
    err.textContent = message ?? 'Something went wrong.';
    host.appendChild(err);
  }

  dispose(): void {
    this._store.dispose();
    this._root.remove();
  }
}

export function createPythonSettingsPanel(service: IPythonEnvService): ISettingsPanel {
  // The Settings tool activates after the global settings registry exists, so
  // this is the first reliable moment to make sure the `python.*` schemas are
  // in it — the service itself is constructed far earlier, before there is any
  // registry to register with. Without this the flat Settings list has no
  // Python rows at all.
  service.ensureSettingsRegistered();

  return {
    id: 'python',
    label: 'Python',
    order: 70,
    description: 'A private Python environment for this workspace, and the scripts that use it.',
    render(container: HTMLElement): IDisposable {
      service.ensureSettingsRegistered();
      try {
        return new PythonSettingsPanel(container, service);
      } catch (err) {
        // A panel that throws while building renders NOTHING — the hub shows
        // its heading and an empty body, which looks like a feature that was
        // never implemented rather than a crash. Say what happened instead.
        console.error('[PythonSettingsPanel] failed to render:', err);
        const notice = document.createElement('div');
        notice.className = 'pysettings__notice pysettings__notice--error';
        notice.textContent = `The Python settings failed to load: ${(err as Error).message}`;
        container.appendChild(notice);
        return { dispose: () => notice.remove() };
      }
    },
  };
}
