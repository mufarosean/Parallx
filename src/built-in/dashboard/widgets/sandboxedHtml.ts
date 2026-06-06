// sandboxedHtml.ts — renders AI-authored HTML/CSS/JS inside a doubly-jailed
// iframe, for the "Live" dashboard widget.
//
// Why this exists: every other widget paints into the main renderer DOM, which
// shares a window with `window.parallxElectron` (filesystem, tool install, …).
// Letting a model's code run there would hand it the keys to the app. So when a
// widget's content is HTML rather than Markdown, we run it in an iframe that is
// jailed two independent ways:
//
//   1. The frame element carries `sandbox="allow-scripts"` *without*
//      `allow-same-origin`. The document loads at a unique opaque origin: its
//      scripts run (charts, canvas, animation all work) but it cannot reach the
//      parent DOM, `window.parallxElectron`, cookies, or app storage.
//
//   2. We wrap the model's HTML in our own document shell whose <meta> CSP is
//      `default-src 'none'` plus a tight allowlist. That kills network egress
//      entirely (no `connect-src`, images only `data:`/`blob:`), so jailed code
//      still can't phone home or exfiltrate via a beacon image.
//
// The frame is fed through a `blob:` URL rather than `srcdoc` on purpose: a
// srcdoc document inherits the host page's CSP (which has no `'unsafe-inline'`
// in script-src), so the model's inline <script> would silently never run. A
// blob: document carries only the CSP we inject, so inline scripts execute
// under exactly the policy above — and `blob:` is already allowed by the host's
// `frame-src` (see electron/index.html).

/**
 * The `--px-*` design tokens we forward into the frame so model-authored
 * visuals match the active theme (M83: no hardcoded colors). Resolved from the
 * host document at paint time and re-declared on the frame's :root.
 */
export const FORWARDED_THEME_TOKENS: readonly string[] = [
  '--px-bg', '--px-bg-elevated', '--px-bg-inset', '--px-surface-hover',
  '--px-text', '--px-text-secondary', '--px-text-muted', '--px-text-faint',
  '--px-accent', '--px-accent-hover', '--px-accent-soft', '--px-accent-strong',
  '--px-border', '--px-border-strong', '--px-divider',
  '--px-danger', '--px-success', '--px-warning', '--px-info',
  '--px-radius-sm', '--px-radius-md', '--px-radius-lg', '--px-radius-xl',
  '--px-space-1', '--px-space-2', '--px-space-3', '--px-space-4', '--px-space-5', '--px-space-6',
  '--px-text-xs', '--px-text-sm', '--px-text-base', '--px-text-md', '--px-text-lg', '--px-text-xl',
];

/**
 * Read the forwarded tokens off the host document's :root and return them as a
 * CSS declaration block (`--px-bg: …; --px-text: …;`). Also derives a UI and a
 * monospace font-family var so the frame can match the app's typography.
 */
export function collectThemeVars(doc: Document = document): string {
  const decls: string[] = [];
  const rootStyle = doc.defaultView?.getComputedStyle(doc.documentElement);
  if (rootStyle) {
    for (const token of FORWARDED_THEME_TOKENS) {
      const value = rootStyle.getPropertyValue(token).trim();
      if (value) decls.push(`${token}: ${value};`);
    }
    // Typography isn't a --px token yet; forward the app's resolved fonts so
    // the frame doesn't fall back to Times New Roman.
    const mono = rootStyle.getPropertyValue('--vscode-editor-font-family').trim();
    if (mono) decls.push(`--px-font-mono: ${mono};`);
  }
  const bodyFont = doc.defaultView?.getComputedStyle(doc.body)?.fontFamily?.trim();
  if (bodyFont) decls.push(`--px-font-ui: ${bodyFont};`);
  return decls.join(' ');
}

/** The strict policy that runs inside the frame. Tight by construction. */
export const SANDBOX_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Wrap model-authored HTML in the document shell that enforces the CSP and
 * applies theme tokens + sane defaults. The model's content is dropped into
 * <body> verbatim — it may include its own <style> and <script>.
 */
export function buildSandboxDocument(bodyHtml: string, themeVars: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<style>
  :root { color-scheme: dark; ${themeVars} }
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; }
  /* Guarantee a dark base no matter what the model does — never the UA's
     default white canvas. The model paints on top of this. */
  html { background: var(--px-bg, #16171a); }
  body {
    background: transparent;
    color: var(--px-text, #e8eaee);
    font-family: var(--px-font-ui, system-ui, -apple-system, "Segoe UI", sans-serif);
    font-size: var(--px-text-base, 13px);
    line-height: 1.5;
    box-sizing: border-box;
    overflow: auto;
  }
  *, *::before, *::after { box-sizing: inherit; }
  a { color: var(--px-accent, #569cd6); }
  code, pre { font-family: var(--px-font-mono, ui-monospace, "SF Mono", Menlo, monospace); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--px-border-strong, #41454d); border-radius: 6px; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export interface SandboxFrame {
  /** The jailed iframe, ready to append to the DOM. */
  readonly frame: HTMLIFrameElement;
  /** Release the blob URL backing the frame. Call when replacing/removing it. */
  revoke(): void;
}

/**
 * Build a jailed iframe for the given model HTML. The caller owns the returned
 * `revoke()` and must call it when the frame is replaced or the widget is
 * disposed, to avoid leaking object URLs.
 */
export function createSandboxFrame(bodyHtml: string, doc: Document = document): SandboxFrame {
  const html = buildSandboxDocument(bodyHtml, collectThemeVars(doc));
  const frame = doc.createElement('iframe');
  frame.className = 'dashboard-live__frame';
  // Jail #1: opaque-origin sandbox. allow-scripts WITHOUT allow-same-origin —
  // the two together would let the frame remove its own sandbox, so we never
  // pair them.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('loading', 'lazy');

  // blob: so the frame carries only our injected CSP (see file header).
  const canBlob = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  if (canBlob) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    frame.src = url;
    return { frame, revoke: () => { try { URL.revokeObjectURL(url); } catch { /* noop */ } } };
  }
  // Fallback (e.g. test envs without createObjectURL): srcdoc. Scripts won't
  // run under the inherited host CSP, but static content still renders.
  frame.srcdoc = html;
  return { frame, revoke: () => { /* nothing to release */ } };
}
