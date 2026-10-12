// mcpAuthProgress.ts — what the user sees while an MCP server's sign-in runs.
//
// The main process opens the sign-in page in the browser and sends the URL
// and the helper's log lines to the window; this shows them under the
// server's row, so a sign-in that takes a minute does not sit silent and a
// blocked browser window can be worked around by copying the link.

import { $ } from '../../../ui/dom.js';

/** How many log lines the box keeps; the helper's output is mostly progress. */
const LOG_LINES_KEPT = 6;

export interface IMcpAuthProgress {
  readonly el: HTMLElement;
  /** The sign-in page's address, once the helper prints it. */
  setUrl(url: string): void;
  /** A line of the helper's output. */
  appendLog(text: string): void;
  /** Remove the box from the page. */
  dispose(): void;
}

/** A box under a server's row: "Opened your browser to sign in", the link, and the helper's last lines. */
export function createMcpAuthProgress(): IMcpAuthProgress {
  const el = $('div.ai-settings-mcp-auth');
  const status = $('div.ai-settings-mcp-auth__status');
  status.textContent = 'Waiting for the sign-in helper…';
  el.appendChild(status);

  const linkRow = $('div.ai-settings-mcp-auth__link');
  linkRow.hidden = true;
  const link = document.createElement('a');
  link.className = 'ai-settings-mcp-auth__url';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'ai-settings-mcp-btn';
  copy.textContent = 'Copy Link';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(link.href).then(() => { copy.textContent = 'Copied'; }).catch(() => { /* the link is still visible */ });
  });
  linkRow.append(link, copy);
  el.appendChild(linkRow);

  const log = $('pre.ai-settings-mcp-auth__log');
  log.hidden = true;
  el.appendChild(log);
  const lines: string[] = [];

  return {
    el,
    setUrl(url: string): void {
      status.textContent = 'Opened your browser to sign in. Finish there; this updates when the helper is done.';
      link.href = url;
      link.textContent = url;
      linkRow.hidden = false;
    },
    appendLog(text: string): void {
      for (const line of String(text).split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines.push(line);
      }
      if (lines.length > LOG_LINES_KEPT) lines.splice(0, lines.length - LOG_LINES_KEPT);
      log.textContent = lines.join('\n');
      log.hidden = lines.length === 0;
    },
    dispose(): void {
      el.remove();
    },
  };
}
