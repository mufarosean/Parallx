// sandboxedHtml.ts — renders AI-authored HTML/CSS/JS inside a doubly-jailed
// iframe: the dashboard's Live widget, and chat's mini-apps (an app answer
// form, its page block, tab and dashboard widget).
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
// The frame's document is served from parallx-frame:// (electron/
// sandboxFrameBridge.cjs), never srcdoc, blob: or data:: Chromium gives those
// the policy of the page that made them, and the window's policy has no
// `'unsafe-inline'` in script-src, so the model's inline <script> would
// silently never run. A parallx-frame:// document carries only the policy
// above, inline scripts included (the window's `frame-src` allows the scheme;
// electron/index.html).

/**
 * The `--px-*` design tokens we forward into the frame so model-authored
 * visuals match the active theme. Resolved from the
 * host document at paint time and re-declared on the frame's :root.
 */
export const FORWARDED_THEME_TOKENS: readonly string[] = [
  '--px-bg', '--px-bg-elevated', '--px-bg-inset', '--px-surface-hover', '--px-surface-active', '--px-surface-selected',
  '--px-text', '--px-text-secondary', '--px-text-muted', '--px-text-faint',
  '--px-accent', '--px-accent-hover', '--px-accent-soft', '--px-accent-strong', '--px-accent-faint',
  '--px-accent-text', '--px-text-on-accent',
  '--px-border', '--px-border-strong', '--px-divider',
  '--px-danger', '--px-success', '--px-warning', '--px-info',
  '--px-radius-sm', '--px-radius-md', '--px-radius-lg', '--px-radius-xl',
  '--px-space-1', '--px-space-2', '--px-space-3', '--px-space-4', '--px-space-5', '--px-space-6', '--px-space-8',
  '--px-text-xs', '--px-text-sm', '--px-text-base', '--px-text-md', '--px-text-lg', '--px-text-xl',
  '--px-control-h', '--px-control-h-sm', '--px-focus-width',
];

/**
 * A mini-app's base look (appStyle): plain controls, tables and headings drawn
 * as the app draws them, so an app the model writes only has to lay them out.
 * The build-mini-app skill tells the model to rely on it.
 */
const APP_BASE_STYLE = `<style>
  body { padding: var(--px-space-3); }
  h1, h2, h3 { margin: 0 0 var(--px-space-2); font-weight: 600; color: var(--px-text); }
  h1 { font-size: var(--px-text-lg); } h2 { font-size: var(--px-text-md); } h3 { font-size: var(--px-text-base); }
  label { color: var(--px-text-secondary); font-size: var(--px-text-sm); }
  button { font: inherit; font-size: var(--px-text-sm); min-height: var(--px-control-h); padding: 0 var(--px-space-3);
    border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); background: var(--px-bg-elevated); color: var(--px-text); cursor: pointer; }
  button:hover { background: var(--px-surface-hover); }
  button.primary { background: var(--px-accent); border-color: var(--px-accent); color: var(--px-text-on-accent); }
  button.primary:hover { background: var(--px-accent-hover); }
  button:disabled { opacity: 0.5; cursor: default; }
  input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select { font: inherit; font-size: var(--px-text-base);
    min-height: var(--px-control-h); padding: 0 var(--px-space-2); box-sizing: border-box;
    color: var(--px-text); background: var(--px-bg-inset); border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); }
  textarea { padding: var(--px-space-2); }
  input[type=range], input[type=checkbox], input[type=radio] { accent-color: var(--px-accent); }
  :focus-visible { outline: var(--px-focus-width) solid var(--px-accent); outline-offset: 1px; }
  table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: var(--px-space-1) var(--px-space-3) var(--px-space-1) 0; text-align: left; border-bottom: 1px solid var(--px-divider); }
  th { font-weight: 600; border-bottom-color: var(--px-border-strong); }
</style>`;

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
export function buildSandboxDocument(bodyHtml: string, themeVars: string, opts: SandboxOptions = {}): string {
  const scheme = opts.scheme === 'light' ? 'light' : 'dark';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${scheme}">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<style>
  :root { color-scheme: ${scheme}; ${themeVars} }
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
${opts.appStyle ? APP_BASE_STYLE : ''}${opts.connect ? CONNECTOR : ''}
${bodyHtml}
${opts.reportHeight ? HEIGHT_REPORTER : ''}${opts.followTheme ? THEME_RECEIVER : ''}
</body>
</html>`;
}

export interface SandboxOptions {
  /** The frame's colour scheme; default dark (the Live widget's base). */
  readonly scheme?: 'dark' | 'light';
  /** The frame posts its content height to the host (watchFrameHeight). */
  readonly reportHeight?: boolean;
  /** Plain controls, tables and headings get the app's look (mini-apps). */
  readonly appStyle?: boolean;
  /** The frame takes new theme colours from the host (followHostTheme). */
  readonly followTheme?: boolean;
  /** The app may ask the host to use the person's tools: `parallx.call(tool, args)` (connectFrame). */
  readonly connect?: boolean;
}

/** Applies theme colours the host sends: the variables and the colour scheme, nothing else. */
const THEME_RECEIVER = `<script>addEventListener('message',function(e){var d=e.data&&e.data.parallxTheme;if(!d||e.source!==parent)return;`
  + `document.documentElement.style.cssText=String(d.vars)+';color-scheme:'+(d.scheme==='light'?'light':'dark');})</script>`;

/**
 * Send the host's theme into `frame` whenever the window's mode, contrast or
 * colours change, so an app keeps its state through a theme switch.
 */
export function followHostTheme(frame: HTMLIFrameElement): void {
  const doc = frame.ownerDocument;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (!frame.isConnected) { observer.disconnect(); return; }
    clearTimeout(timer);
    timer = setTimeout(() => frame.contentWindow?.postMessage({ parallxTheme: { vars: collectThemeVars(doc), scheme: hostColorScheme(doc) } }, '*'), 60);
  });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-px-mode', 'data-px-contrast', 'style', 'class'] });
}

/** Posts the document's height to the host whenever it changes: a number, nothing else. */
const HEIGHT_REPORTER = `<style>html, body { height: auto; }</style><script>(function(){var last=0;function send(){var b=document.body;var h=Math.ceil(Math.max(b.scrollHeight, b.getBoundingClientRect().height));`
  + `if(h!==last){last=h;parent.postMessage({parallxFrameHeight:h},'*');}}`
  + `if(window.ResizeObserver)new ResizeObserver(send).observe(document.body);addEventListener('load',send);send();})();</script>`;

/** The host window's colour scheme, for a frame that should follow it. */
export function hostColorScheme(doc: Document = document): 'dark' | 'light' {
  return doc.documentElement.getAttribute('data-px-mode') === 'light' ? 'light' : 'dark';
}

/**
 * Size `frame` to the height its document reports (reportHeight), within
 * [min, max]. Only a number from that frame's own window is read; the
 * listener goes when the frame leaves the page.
 */
/**
 * Inside the frame: `parallx.call(tool, args)` asks the host to use one of the
 * person's tools and resolves with `{ content, data }` (data: the content
 * parsed as JSON, when it is JSON). The frame itself still reaches nothing:
 * the host decides, and asks the person (appConnections).
 * The host's permission dialog takes focus and gives it back to the frame,
 * which then sits on its body: when the answer comes and the frame still has
 * focus, it goes back to the control that made the call.
 */
const CONNECTOR = `<script>(function(){var n=0,w={};addEventListener('message',function(e){var r=e.data&&e.data.parallxReply;`
  + `if(!r||e.source!==parent||!w[r.id])return;var p=w[r.id];delete w[r.id];var a=document.activeElement;`
  + `if(p.back&&p.back.isConnected&&document.hasFocus()&&(!a||a===document.body))p.back.focus();`
  + `if(r.ok)p.resolve(r.result);else p.reject(new Error(String(r.error)));});`
  + `window.parallx=Object.freeze({call:function(tool,args){return new Promise(function(resolve,reject){var id=++n;w[id]={resolve:resolve,reject:reject,back:document.activeElement!==document.body?document.activeElement:null};`
  + `parent.postMessage({parallxCall:{id:id,tool:String(tool),args:(args&&typeof args==='object')?JSON.parse(JSON.stringify(args)):{}}},'*');});}});})();</script>`;

/**
 * Answer `parallx.call` from `frame` with `handler` (the host's permission
 * gate). Only messages from that frame's own window are read; arguments are
 * plain data; a rejection reaches the app as an Error with the reason.
 */
export function connectFrame(frame: HTMLIFrameElement, handler: (tool: string, args: Record<string, unknown>) => Promise<unknown>): void {
  const win = frame.ownerDocument.defaultView;
  if (!win) return;
  const onMessage = (e: MessageEvent): void => {
    if (!frame.isConnected) { win.removeEventListener('message', onMessage); return; }
    if (e.source !== frame.contentWindow) return;
    const call = (e.data as { parallxCall?: { id?: unknown; tool?: unknown; args?: unknown } } | null)?.parallxCall;
    if (!call || typeof call.id !== 'number' || typeof call.tool !== 'string') return;
    const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args as Record<string, unknown> : {};
    const reply = (msg: Record<string, unknown>): void => { frame.contentWindow?.postMessage({ parallxReply: { id: call.id, ...msg } }, '*'); };
    handler(call.tool, args).then((result) => reply({ ok: true, result }), (err: unknown) => reply({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  };
  win.addEventListener('message', onMessage);
}

export function watchFrameHeight(frame: HTMLIFrameElement, min = 120, max = 900): void {
  const win = frame.ownerDocument.defaultView;
  if (!win) return;
  const onMessage = (e: MessageEvent): void => {
    if (!frame.isConnected) { win.removeEventListener('message', onMessage); return; }
    if (e.source !== frame.contentWindow) return;
    const h = Number((e.data as { parallxFrameHeight?: unknown } | null)?.parallxFrameHeight);
    if (Number.isFinite(h)) frame.style.height = `${Math.min(max, Math.max(min, Math.round(h)))}px`;
  };
  win.addEventListener('message', onMessage);
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
export function createSandboxFrame(bodyHtml: string, doc: Document = document, opts: SandboxOptions & { className?: string; title?: string } = {}): SandboxFrame {
  const html = buildSandboxDocument(bodyHtml, collectThemeVars(doc), opts);
  // Jail #1: opaque-origin sandbox. allow-scripts WITHOUT allow-same-origin —
  // the two together would let the frame remove its own sandbox, so we never
  // pair them. (Written as markup so the attributes are there from the start.)
  const frame = doc.createRange().createContextualFragment(
    '<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe>',
  ).firstElementChild as HTMLIFrameElement;
  frame.className = opts.className ?? 'dashboard-live__frame';
  if (opts.title) frame.title = opts.title;

  // In the app the document is served from parallx-frame:// (electron/
  // sandboxFrameBridge.cjs): a blob:, srcdoc or data: document takes the
  // window's policy, which allows no inline script, so the app's own script
  // would never run. The URL arrives a moment later; nothing to release.
  const bridge = (doc.defaultView as unknown as { parallxElectron?: { sandboxFrame?: { register(html: string): Promise<{ url?: string; error?: string }> } } } | null)
    ?.parallxElectron?.sandboxFrame;
  if (bridge) {
    void bridge.register(html).then((r) => { if (r?.url) frame.src = r.url; }).catch((err) => console.warn('[sandboxedHtml] frame not served:', err));
    return { frame, revoke: () => { /* the main process keeps the newest documents */ } };
  }
  // Outside the app (tests): a blob: URL.
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
