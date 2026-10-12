// toolEditorTabs.ts — the Details and Status tabs of a tool's editor: what
// the manifest says and how the tool is doing, read-only.

import { $ } from '../../ui/dom.js';
import { appDateTimeString, appTimeString } from '../../services/localTime.js';
import type { ToolInfo } from './main.js';
import type { IIntrospectionService } from '../../services/introspectionService.js';

export function renderDetailsTab(container: HTMLElement, tool: ToolInfo): void {
  const section = $('div');
  section.classList.add('tool-editor-details');

  if (tool.description) {
    const desc = $('div');
    desc.classList.add('tool-editor-details-desc');
    desc.textContent = tool.description;
    section.appendChild(desc);
  }

  const fields: [string, string][] = [
    ['Publisher', tool.publisher],
    ['Version', tool.version],
    ['Tool ID', tool.id],
    ['Built-in', tool.isBuiltin ? 'Yes' : 'No'],
    ['State', tool.state],
    ['Path', tool.toolPath],
  ];

  const table = $('div');
  table.classList.add('tool-editor-details-table');
  for (const [label, value] of fields) {
    const row = $('div');
    row.classList.add('tool-editor-details-row');

    const lbl = $('span');
    lbl.classList.add('tool-editor-details-label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const val = $('span');
    val.classList.add('tool-editor-details-value');
    val.textContent = value;
    row.appendChild(val);

    table.appendChild(row);
  }
  section.appendChild(table);

  container.appendChild(section);
}

// ─── Feature Contributions Tab ───────────────────────────────────────────────


export function renderStatusTab(container: HTMLElement, tool: ToolInfo, getIntrospection: (() => IIntrospectionService | undefined) | undefined): void {
  const section = $('div');
  section.classList.add('tool-editor-status');

  // The runtime facts the audit found missing from this tab (Phase C):
  // WHEN the tool activated, how long that took, and what has failed —
  // joined for us by the introspection service.
  const runtime = getIntrospection?.()?.describeTools().find((t) => t.id === tool.id);

  const fields: [string, string][] = [
    ['State', tool.state],
    ['Activation Events', (tool.activationEvents ?? []).join(', ') || 'none'],
    ...(runtime?.activatedAt !== undefined
      ? [['Activated At', appTimeString(runtime.activatedAt)] as [string, string]]
      : []),
    ...(runtime?.activationDurationMs !== undefined
      ? [['Activation Took', `${Math.round(runtime.activationDurationMs)} ms`] as [string, string]]
      : []),
    ...(runtime
      ? [['Recorded Errors', String(runtime.errorCount)] as [string, string]]
      : []),
    ['Tool Path', tool.toolPath],
    ['Built-in', tool.isBuiltin ? 'Yes' : 'No'],
  ];

  for (const [label, value] of fields) {
    const row = $('div');
    row.classList.add('tool-editor-status-row');

    const lbl = $('span');
    lbl.classList.add('tool-editor-status-label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const val = $('span');
    val.classList.add('tool-editor-status-value');
    val.textContent = value;
    row.appendChild(val);

    section.appendChild(row);
  }

  // The most recent recorded error, in full — the count row says how many,
  // this says what.
  if (runtime?.lastError) {
    const err = $('div');
    err.classList.add('tool-editor-status-error');
    err.textContent = `Last error (${runtime.lastError.context}, ${appDateTimeString(runtime.lastError.timestamp)}): ${runtime.lastError.message}`;
    section.appendChild(err);
  }

  // State indicator
  const stateIndicator = $('div');
  stateIndicator.classList.add('tool-editor-status-indicator');
  const dot = $('span');
  dot.classList.add('tool-editor-status-dot');
  if (tool.state === 'activated') {
    dot.classList.add('tool-editor-status-dot-active');
  } else if (tool.state === 'deactivated' || tool.state === 'disposed') {
    dot.classList.add('tool-editor-status-dot-inactive');
  } else {
    dot.classList.add('tool-editor-status-dot-pending');
  }
  stateIndicator.appendChild(dot);
  const stateText = $('span');
  stateText.textContent = tool.state === 'activated' ? 'Active' :
    tool.state === 'deactivated' ? 'Inactive' :
    tool.state === 'disposed' ? 'Disposed' : 'Pending';
  stateIndicator.appendChild(stateText);
  section.insertBefore(stateIndicator, section.firstChild);

  container.appendChild(section);
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/** Render a collapsible contribution section with header and lazy content. */
