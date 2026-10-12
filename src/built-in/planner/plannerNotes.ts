// plannerNotes.ts — the notes field of a Planner task or event: the links in
// its text shown as chips under it (a web page, or a Parallx page with its
// title), and the toolbar that links a canvas page into it.

import { declareControl } from '../../ui/kit.js';
import { getIcon } from '../../ui/iconRegistry.js';
import { normalizeWebLink, extractLinks } from './plannerLinks.js';
import { LINK_WEB_SVG, LINK_DOC_SVG, LINK_PLUS_SVG, el } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

export class PlannerNotes {
  constructor(private readonly _pane: PlannerEditorPane) {}

  /**
   * Render any links found in a description as clickable chips below the
   * notes field, live-updating as the user types. Lets a description double
   * as a notes scratchpad with real, openable references — external study
   * URLs as well as internal `parallx://` links (e.g. a canvas page with
   * review notes), which resolve to the page's title + icon.
   */
  attachDescriptionLinks(body: HTMLElement, descInput: HTMLTextAreaElement): void {
    const row = el('div', 'planner-popover__links');
    body.appendChild(row);
    const render = () => {
      row.innerHTML = '';
      const links = extractLinks(descInput.value);
      if (links.length === 0) { row.style.display = 'none'; return; }
      row.style.display = '';
      for (const link of links) {
        const chip = el('button', 'planner-popover__linkchip');
        if (link.kind === 'internal') chip.classList.add('planner-popover__linkchip--internal');
        chip.type = 'button';
        chip.title = link.href;
        const labelSpan = el('span', 'planner-popover__linkchip-label');
        labelSpan.textContent = link.label;
        chip.innerHTML = link.kind === 'internal' ? LINK_DOC_SVG : LINK_WEB_SVG;
        chip.appendChild(labelSpan);
        if (link.kind === 'internal') {
          chip.addEventListener('click', () => void this._pane._api.links.open(link.href));
          // Resolve the page title/icon lazily so the chip reads naturally.
          void this._labelInternalChip(chip, labelSpan, link.href);
        } else {
          chip.addEventListener('click', () => void this._openExternalLink(link.href));
        }
        row.appendChild(chip);
      }
    };
    descInput.addEventListener('input', render);
    render();
  }

  /** Replace a raw internal-link chip label with the target's title + icon. */
  private async _labelInternalChip(chip: HTMLElement, labelSpan: HTMLElement, uri: string): Promise<void> {
    try {
      const meta = await this._pane._api.links.resolveMetadata(uri);
      if (!meta) { chip.classList.add('planner-popover__linkchip--missing'); return; }
      labelSpan.textContent = meta.title;
      chip.title = meta.title;
      if (meta.icon) {
        // LinkMetadata.icon is a registry icon id (system UI never uses
        // emoji). Unknown ids fall back to rendering the raw string so
        // legacy providers still show something.
        const iconSpan = el('span', 'planner-popover__linkchip-icon');
        const svg = getIcon(meta.icon);
        if (svg) iconSpan.innerHTML = svg;
        else iconSpan.textContent = meta.icon;
        chip.querySelector('svg')?.replaceWith(iconSpan);
      }
    } catch {
      // Leave the raw label in place on failure — chip is still clickable.
    }
  }

  /** Open an http/https link in the user's external browser, safely. */
  private async _openExternalLink(rawUrl: string): Promise<void> {
    const url = normalizeWebLink(rawUrl);
    if (!url) return;
    try {
      const shell = (window as { parallxElectron?: { shell?: { openExternal?: (u: string) => Promise<{ ok?: boolean; error?: string } | void> } } }).parallxElectron?.shell;
      if (shell?.openExternal) {
        const result = await shell.openExternal(url);
        if (result && typeof result === 'object' && result.ok === false) throw new Error(result.error || 'openExternal failed');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[PlannerEditorPane] open link failed:', err);
      await this._pane._api.window.showErrorMessage('Failed to open link.');
    }
  }

  /**
   * A compact toolbar below the notes field. Currently offers "Link canvas
   * page" — the bridge between study notes (canvas) and the plan (events
   * and tasks). Kept minimal so notes stay lightweight.
   */
  appendNotesToolbar(body: HTMLElement, descInput: HTMLTextAreaElement): void {
    const bar = el('div', 'planner-popover__notesbar');
    const linkBtn = el('button', 'planner-popover__notesbtn');
    linkBtn.type = 'button';
    linkBtn.innerHTML = `${LINK_PLUS_SVG}<span>Link canvas page</span>`;
    linkBtn.title = 'Attach a canvas page to these notes';
    declareControl(linkBtn, { id: 'planner.notes.attachPage', label: 'Attach a page', hint: linkBtn.title });
    linkBtn.addEventListener('click', () => void this._linkCanvasPage(descInput));
    bar.appendChild(linkBtn);
    body.appendChild(bar);
  }

  /**
   * Open the canvas page picker and append the chosen page's link to the
   * notes field. Decoupled from the canvas schema — the link contract and
   * the `canvas.pickPageLink` command do the resolution.
   */
  private async _linkCanvasPage(descInput: HTMLTextAreaElement): Promise<void> {
    let result: { uri: string; title: string; icon: string | null } | null = null;
    try {
      result = await this._pane._api.commands.executeCommand('canvas.pickPageLink');
    } catch (err) {
      console.error('[PlannerEditorPane] canvas.pickPageLink failed:', err);
      await this._pane._api.window.showErrorMessage('Could not open the canvas page picker.');
      return;
    }
    if (!result) return;
    const current = descInput.value;
    const sep = current.length === 0 ? '' : (current.endsWith('\n') ? '' : '\n');
    descInput.value = `${current}${sep}${result.uri}`;
    // Fire input so the link chips re-render and any caller-bound listeners run.
    descInput.dispatchEvent(new Event('input', { bubbles: true }));
    descInput.focus();
  }
}
