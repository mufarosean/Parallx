// modelCallsView.ts — the dialog AI: Show Model Calls opens.
//
// It reads the call ledger (services/modelCallLedger.ts) and lists, newest
// first, every model call it keeps: when, who asked, the model, prompt and
// answer tokens, time to the first token, total time and how it ended; above
// them, the session's totals by caller. It follows the ledger while open.
// Nothing here names a tool: a call made through `parallx.lm` shows the
// calling tool's name as the registry gives it.
//
// Built from the kit and the shared overlay (Escape, a press outside and
// Close all close it; Tab stays inside; focus goes back where it was).

import { Overlay } from '../ui/overlay.js';
import { createButton, createEmptyState, createPageHeader, createRow, createSection } from '../ui/kit.js';
import { formatLocalTime } from '../platform/localTime.js';
import type { IDisposable } from '../platform/lifecycle.js';
import { MAX_MODEL_CALLS } from '../services/modelCallLedger.js';
import type { IModelCallLedger, IModelCallRecord, IModelCallTotals } from '../services/modelCallLedger.js';
import './modelCalls.css';

/** A tool's display name from its id; the id when the registry does not know it. */
export type ToolNameOf = (toolId: string) => string | undefined;

/** "850 ms", "3.2 s", "2 min 5 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

const count = (n: number): string => n.toLocaleString('en-US');

/** "120 in, 45 out" when the provider reported them. */
function tokensText(promptTokens: number | undefined, answerTokens: number | undefined): string {
  if (promptTokens === undefined && answerTokens === undefined) return 'tokens not reported';
  return `${promptTokens === undefined ? '?' : count(promptTokens)} in, ${answerTokens === undefined ? '?' : count(answerTokens)} out`;
}

/** Who asked, in words: a tool's name for its id, with the call's own label first when it has one. */
export function callerText(record: Pick<IModelCallRecord, 'caller' | 'source'>, nameOf: ToolNameOf): string {
  if (!record.source) return record.caller;
  const tool = nameOf(record.source) ?? record.source;
  return record.caller === record.source ? tool : `${record.caller} (${tool})`;
}

function outcomeText(record: IModelCallRecord): string {
  switch (record.outcome) {
    case 'running': return 'Running…';
    case 'stopped': return 'Stopped';
    case 'error': return `Error: ${record.error ?? 'unknown'}`;
    default: return record.cutOff ? 'Done, cut off at the limit' : 'Done';
  }
}

/** One call as a row: who asked over the time, model, tokens, timings and outcome. */
export function formatCallRow(record: IModelCallRecord, nameOf: ToolNameOf, timeZone?: string): { name: string; detail: string } {
  const parts = [
    formatLocalTime(record.startedAt, { seconds: true, timeZone }),
    record.modelId,
    tokensText(record.promptTokens, record.answerTokens),
    `first token ${record.firstTokenMs === undefined ? '-' : formatDuration(record.firstTokenMs)}`,
    `total ${record.totalMs === undefined ? '-' : formatDuration(record.totalMs)}`,
    outcomeText(record),
  ];
  return { name: callerText(record, nameOf), detail: parts.join(' · ') };
}

/** A caller's session totals as a row. */
export function formatTotalsRow(t: IModelCallTotals): { name: string; detail: string } {
  const parts = [
    `${count(t.calls)} ${t.calls === 1 ? 'call' : 'calls'}`,
    tokensText(t.promptTokens, t.answerTokens),
    `${formatDuration(t.totalMs)} in all`,
  ];
  if (t.errors) parts.push(`${count(t.errors)} ${t.errors === 1 ? 'error' : 'errors'}`);
  return { name: t.caller, detail: parts.join(' · ') };
}

let _open: { overlay: Overlay; dispose(): void } | undefined;

/** Opens the dialog, or brings the open one to the front. */
export function showModelCallsDialog(ledger: IModelCallLedger, nameOf: ToolNameOf): void {
  if (_open) { _open.overlay.contentElement.focus(); return; }
  const overlay = new Overlay(document.body, { contentClass: 'px-model-calls', label: 'Model Calls', centered: true });
  const dialog = overlay.contentElement;
  dialog.tabIndex = -1;

  const header = createPageHeader(dialog, {
    title: 'Model Calls',
    subtitle: `The last ${MAX_MODEL_CALLS} calls this session. Prompts and answers are not kept.`,
  });
  createButton(header, { id: 'modelCalls.clear', label: 'Clear', icon: 'eraser', kind: 'secondary', size: 'sm', command: 'chat.clearModelCalls' });
  createButton(header, { id: 'modelCalls.close', label: 'Close', kind: 'primary', size: 'sm', command: 'chat.closeModelCalls' });

  const totals = createSection(dialog, 'By caller', 'px-model-calls__totals');
  const recent = createSection(dialog, 'Recent calls', 'px-model-calls__recent');
  // The list scrolls on its own; a keyboard reaches it to scroll it.
  recent.tabIndex = 0;
  recent.setAttribute('aria-label', 'Recent calls');

  const emptyOut = (section: HTMLElement): void => {
    while (section.childElementCount > 1) section.lastElementChild!.remove();
  };
  const render = (): void => {
    emptyOut(totals);
    emptyOut(recent);
    const rows = ledger.entries();
    const sums = ledger.totals();
    totals.hidden = sums.length === 0;
    for (const t of sums) createRow(totals, formatTotalsRow(t));
    if (rows.length === 0) {
      createEmptyState(recent, { icon: 'activity', headline: 'No model calls yet', hint: 'Each call to the model shows here as it is made.' });
      return;
    }
    for (const r of rows) createRow(recent, formatCallRow(r, nameOf));
  };
  render();

  const sub: IDisposable = ledger.onDidChange(render);
  _open = {
    overlay,
    dispose: () => { sub.dispose(); overlay.dispose(); },
  };
  overlay.onDidClose(() => { const o = _open; _open = undefined; o?.dispose(); });
  overlay.show();
  dialog.focus();
}

/** Closes the dialog if it is open. */
export function closeModelCallsDialog(): void {
  _open?.overlay.hide();
}
