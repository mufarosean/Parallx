// chrome.js — the graph's own small DOM helpers: a styled element, the
// toolbar's text and icon buttons, and the sidebar's mini buttons.

export function _el(tag, style) {
  const el = document.createElement(tag);
  if (style) el.style.cssText = style;
  return el;
}

export function _btn(text) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;height:var(--px-control-h-sm);padding:0 10px;white-space:nowrap;flex-shrink:0;background:var(--px-bg-elevated);color:var(--px-text);border:1px solid var(--px-border);border-radius:var(--px-radius-sm);font-size:var(--px-text-sm);cursor:pointer;font-family:var(--parallx-fontFamily-ui);';
  btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--px-surface-hover)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--px-bg-elevated)'; });
  return btn;
}

// Toolbar actions are icons with a tooltip: seven text buttons wrapped onto
// three lines at ordinary widths. Text stays for the two things a label
// actually explains (the view switch and the AI refresh).
export function _iconBtn(api, icon, title) {
  const btn = document.createElement('button');
  btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:var(--px-control-h-sm);height:var(--px-control-h-sm);padding:0;flex-shrink:0;background:transparent;color:var(--px-text-secondary);border:1px solid transparent;border-radius:var(--px-radius-sm);cursor:pointer;';
  btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--px-surface-hover)'; btn.style.color = 'var(--px-text)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = 'var(--px-text-secondary)'; });
  _setIconBtn(api, btn, icon, title);
  return btn;
}

export function _setIconBtn(api, btn, icon, title) {
  const html = api && api.icons && api.icons.createIconHtml ? api.icons.createIconHtml(icon, 15) : '';
  if (html) btn.innerHTML = html; else btn.textContent = title;
  btn.title = title;
  btn.setAttribute('aria-label', title);
}

export function _miniBtn(text) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = 'background:none;border:none;color:var(--vscode-descriptionForeground,#666);cursor:pointer;font-size:14px;padding:2px 4px;font-family:var(--parallx-fontFamily-ui);';
  btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--vscode-editor-foreground,#aaa)'; });
  btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--vscode-descriptionForeground,#666)'; });
  return btn;
}
