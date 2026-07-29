// @vitest-environment jsdom
//
// chatEmptyState.test.ts — the chat landing page may not lie.
//
// The old empty state was an 8-card grid advertising "/edit", "/agent" and
// "/explain" (none of them registered commands — the parser stripped the word
// and the model never saw it), "Ctrl+L → Start a new chat session" (Ctrl+L is
// Focus Input; new-session has no binding), and "@canvas — Edit the current
// page with AI" (that lane is read-only). Half the descriptions also truncated
// mid-word. These tests pin the replacement: nothing hard-coded that could
// drift, and no clipping.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EMPTY_STATES } from '../../src/ui/emptyStates';

const ROOT = resolve(__dirname, '../..');
const widgetSrc = readFileSync(resolve(ROOT, 'src/built-in/chat/widgets/chatWidget.ts'), 'utf8');
const widgetCss = readFileSync(resolve(ROOT, 'src/built-in/chat/widgets/chatWidget.css'), 'utf8');
const runtimeSrc = readFileSync(resolve(ROOT, 'src/openclaw/openclawDefaultRuntimeSupport.ts'), 'utf8');

/** The slash commands the runtime will actually dispatch. */
function registeredCommands(): Set<string> {
  const block = runtimeSrc.slice(
    runtimeSrc.indexOf('const OPENCLAW_COMMANDS'),
    runtimeSrc.indexOf('export function createOpenclawCommandRegistry'),
  );
  return new Set([...block.matchAll(/name:\s*'([a-z][\w-]*)'/g)].map((m) => m[1]));
}

describe('chat empty state — advertises only what exists', () => {
  it('names no slash command that the runtime cannot dispatch', () => {
    const known = registeredCommands();
    expect(known.size).toBeGreaterThan(5); // registry actually parsed

    const emptyState = widgetSrc.slice(
      widgetSrc.indexOf('private _buildEmptyState()'),
      widgetSrc.indexOf('private _buildOfflineState()'),
    );
    const advertised = [...emptyState.matchAll(/\/([a-z][a-z0-9_]*)\b/g)]
      .map((m) => m[1])
      // Strip words that appear in prose/paths rather than as commands.
      .filter((w) => !['div', 'span', 'button', 'the', 'and'].includes(w));

    const fictional = advertised.filter((c) => !known.has(c));
    expect(fictional, `empty state names unregistered command(s): ${fictional.join(', ')}`).toEqual([]);
  });

  it('claims no keyboard shortcut (the old "Ctrl+L → new session" was wrong)', () => {
    const emptyState = widgetSrc.slice(
      widgetSrc.indexOf('private _buildEmptyState()'),
      widgetSrc.indexOf('private _buildOfflineState()'),
    );
    expect(/Ctrl\+[A-Z]/.test(emptyState)).toBe(false);
  });

  it('describes chat modes from the picker metadata, never a second hard-coded copy', () => {
    // MODE_META is the picker's own source of truth; the empty state reads it.
    expect(widgetSrc).toContain('MODE_META');
    const emptyState = widgetSrc.slice(
      widgetSrc.indexOf('_buildEmptyStateKeys()'),
      widgetSrc.indexOf('private _buildOfflineState()'),
    );
    expect(emptyState).toContain('MODE_META[mode]');
    // No parallel prose describing what a mode does.
    expect(emptyState).not.toContain('multi-step actions with your OK');
  });

  it('opens the live menus instead of pasting literal command text', () => {
    const emptyState = widgetSrc.slice(
      widgetSrc.indexOf('_buildEmptyStateKeys()'),
      widgetSrc.indexOf('private _buildOfflineState()'),
    );
    expect(emptyState).toContain("insertTrigger('/')");
    expect(emptyState).toContain("insertTrigger('@')");
    // setValue('/edit ') and friends are gone.
    expect(emptyState).not.toContain('setValue(');
  });
});

describe('chat empty state — cannot truncate', () => {
  it('the key strip has no nowrap+ellipsis clipping (what mangled the old cards)', () => {
    const strip = widgetCss.slice(
      widgetCss.indexOf('.parallx-chat-empty-keys {'),
      widgetCss.indexOf('.parallx-chat-widget--compact .parallx-chat-empty-state {'),
    );
    expect(strip.length).toBeGreaterThan(100); // block located
    expect(strip).not.toContain('text-overflow: ellipsis');
    // Labels stay whole; the strip wraps instead.
    expect(strip).toContain('flex-wrap: wrap');
  });

  it('the deleted card-grid styles are really gone', () => {
    expect(widgetCss).not.toContain('.parallx-chat-hint-item');
    expect(widgetCss).not.toContain('.parallx-chat-empty-state-hints');
  });
});

describe('chat empty state — voice registry', () => {
  it('headline and hint still come from the registry', () => {
    expect(widgetSrc).toContain("EMPTY_STATES['chat.newSession'].headline");
    expect(widgetSrc).toContain("EMPTY_STATES['chat.newSession'].hint");
  });

  it('the copy makes only claims the app can honour', () => {
    const { hint } = EMPTY_STATES['chat.newSession'];
    // Selection/canvas-block auto-attachment and file/page reach are real;
    // a standing-watch promise on the landing page was not actionable here.
    expect(hint).not.toMatch(/watch this for me/i);
    expect(hint.length).toBeLessThanOrEqual(160);
  });
});
