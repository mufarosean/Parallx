// @vitest-environment jsdom
// mcpAuthProgress.test.ts — the sign-in box under an MCP server's row.
//
// While the sign-in helper runs, the box names what is happening, shows the
// sign-in link once the helper prints it (with a copy button for a blocked
// browser window), and keeps the helper's last few lines.

import { describe, it, expect, beforeEach } from 'vitest';
import { createMcpAuthProgress } from '../../src/aiSettings/ui/sections/mcpAuthProgress';

describe('createMcpAuthProgress', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('starts waiting, then shows the link once the helper prints it', () => {
    const box = createMcpAuthProgress();
    document.body.appendChild(box.el);
    expect(box.el.querySelector('.ai-settings-mcp-auth__status')!.textContent).toContain('Waiting for the sign-in helper');
    const linkRow = box.el.querySelector('.ai-settings-mcp-auth__link') as HTMLElement;
    expect(linkRow.hidden).toBe(true);

    box.setUrl('https://accounts.example.com/authorize?x=1');
    expect(linkRow.hidden).toBe(false);
    const a = box.el.querySelector('a.ai-settings-mcp-auth__url') as HTMLAnchorElement;
    expect(a.href).toBe('https://accounts.example.com/authorize?x=1');
    expect(a.textContent).toBe('https://accounts.example.com/authorize?x=1');
    expect(box.el.querySelector('.ai-settings-mcp-auth__status')!.textContent).toContain('Opened your browser to sign in');
    expect(box.el.querySelector('button')!.textContent).toBe('Copy Link');
  });

  it('keeps the helper\'s last six lines, skipping blank ones', () => {
    const box = createMcpAuthProgress();
    const log = box.el.querySelector('.ai-settings-mcp-auth__log') as HTMLElement;
    expect(log.hidden).toBe(true);
    box.appendLog('one\n\ntwo\n');
    expect(log.hidden).toBe(false);
    expect(log.textContent).toBe('one\ntwo');
    for (let i = 3; i <= 9; i++) box.appendLog(`line ${i}`);
    expect(log.textContent!.split('\n')).toEqual(['line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9']);
  });

  it('dispose takes the box off the page', () => {
    const box = createMcpAuthProgress();
    document.body.appendChild(box.el);
    expect(document.querySelector('.ai-settings-mcp-auth')).not.toBeNull();
    box.dispose();
    expect(document.querySelector('.ai-settings-mcp-auth')).toBeNull();
  });
});
