// src/main.ts — Renderer entry point
// Boots the Parallx workbench inside the Electron renderer process.

import { Part } from './parts/part.js';
import { PartRegistry } from './parts/partRegistry.js';
import { PartId } from './parts/partTypes.js';
import { Orientation } from './layout/layoutTypes.js';

// Import all part descriptors
import { titlebarPartDescriptor } from './parts/titlebarPart.js';
import { sidebarPartDescriptor } from './parts/sidebarPart.js';
import { panelPartDescriptor } from './parts/panelPart.js';
import { editorPartDescriptor } from './parts/editorPart.js';
import { auxiliaryBarPartDescriptor } from './parts/auxiliaryBarPart.js';
import { statusBarPartDescriptor } from './parts/statusBarPart.js';
import { StatusBarPart, StatusBarAlignment } from './parts/statusBarPart.js';

// ── Electron window controls bridge ──

declare global {
  interface Window {
    parallxElectron?: {
      platform: string;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (cb: (maximized: boolean) => void) => void;
    };
  }
}

// ── Bootstrap ──

function bootstrap(): void {
  const container = document.getElementById('workbench');
  if (!container) {
    throw new Error('Missing #workbench element');
  }

  // 1. Create part registry and register all standard parts
  const registry = new PartRegistry();
  registry.registerMany([
    titlebarPartDescriptor,
    sidebarPartDescriptor,
    editorPartDescriptor,
    auxiliaryBarPartDescriptor,
    panelPartDescriptor,
    statusBarPartDescriptor,
  ]);

  // 2. Create all parts
  registry.createAll();

  // 3. Build the workbench DOM structure
  // Layout: Titlebar | [Sidebar | Editor | AuxBar] | Panel | StatusBar
  const titlebar = registry.requirePart(PartId.Titlebar) as Part;
  const sidebar = registry.requirePart(PartId.Sidebar) as Part;
  const editor = registry.requirePart(PartId.Editor) as Part;
  const auxiliaryBar = registry.requirePart(PartId.AuxiliaryBar) as Part;
  const panel = registry.requirePart(PartId.Panel) as Part;
  const statusBar = registry.requirePart(PartId.StatusBar) as Part;

  // Create structural wrappers
  const middleRow = document.createElement('div');
  middleRow.classList.add('workbench-middle');

  // Create and mount parts into the workbench
  titlebar.create(container);
  sidebar.create(middleRow);
  editor.create(middleRow);
  // AuxBar hidden by default — still create it so toggle works
  auxiliaryBar.create(middleRow);
  container.appendChild(middleRow);
  panel.create(container);
  statusBar.create(container);

  // 4. Populate the titlebar with window controls
  setupTitlebar(titlebar);

  // 5. Add placeholder content to demonstrate parts are alive
  addPlaceholderContent(sidebar, editor, panel);

  // 6. Add status bar entries
  setupStatusBar(statusBar as unknown as StatusBarPart);

  // 7. Initial layout
  doLayout(container, titlebar, middleRow, sidebar, editor, auxiliaryBar, panel, statusBar);

  // 8. Relayout on window resize
  window.addEventListener('resize', () => {
    doLayout(container, titlebar, middleRow, sidebar, editor, auxiliaryBar, panel, statusBar);
  });

  console.log('Parallx workbench started.');
}

// ── Layout ──

function doLayout(
  container: HTMLElement,
  titlebar: Part,
  middleRow: HTMLElement,
  sidebar: Part,
  editor: Part,
  auxiliaryBar: Part,
  panel: Part,
  statusBar: Part,
): void {
  const w = container.clientWidth;
  const h = container.clientHeight;

  const titleH = 30;
  const statusH = 22;
  const panelH = panel.visible ? 200 : 0;
  const middleH = h - titleH - statusH - panelH;
  const sidebarW = sidebar.visible ? 250 : 0;
  const auxBarW = auxiliaryBar.visible ? 250 : 0;
  const editorW = w - sidebarW - auxBarW;

  titlebar.layout(w, titleH, Orientation.Horizontal);
  middleRow.style.height = `${middleH}px`;
  sidebar.layout(sidebarW, middleH, Orientation.Vertical);
  editor.layout(editorW, middleH, Orientation.Vertical);
  auxiliaryBar.layout(auxBarW, middleH, Orientation.Vertical);
  panel.layout(w, panelH, Orientation.Horizontal);
  statusBar.layout(w, statusH, Orientation.Horizontal);
}

// ── Titlebar ──

function setupTitlebar(titlebar: Part): void {
  const el = titlebar.element;

  // Left: app name
  const leftSlot = el.querySelector('.titlebar-left') as HTMLElement;
  if (leftSlot) {
    const appName = document.createElement('span');
    appName.textContent = 'Parallx';
    appName.style.fontWeight = '600';
    appName.style.fontSize = '13px';
    appName.style.marginLeft = '12px';
    leftSlot.appendChild(appName);
  }

  // Right: window controls
  const rightSlot = el.querySelector('.titlebar-right') as HTMLElement;
  if (rightSlot) {
    const controls = document.createElement('div');
    controls.classList.add('window-controls');

    const makeBtn = (label: string, action: () => void, hoverColor?: string): HTMLElement => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.classList.add('window-control-btn');
      btn.addEventListener('click', action);
      if (hoverColor) {
        btn.addEventListener('mouseenter', () => btn.style.backgroundColor = hoverColor);
        btn.addEventListener('mouseleave', () => btn.style.backgroundColor = '');
      }
      return btn;
    };

    const api = window.parallxElectron;
    if (api) {
      controls.appendChild(makeBtn('─', () => api.minimize(), 'rgba(255,255,255,0.1)'));
      controls.appendChild(makeBtn('□', () => api.maximize(), 'rgba(255,255,255,0.1)'));
      controls.appendChild(makeBtn('✕', () => api.close(), '#e81123'));
    }

    rightSlot.appendChild(controls);
  }
}

// ── Placeholder content ──

function addPlaceholderContent(sidebar: Part, editor: Part, panel: Part): void {
  // Sidebar: explorer tree placeholder
  const sidebarContent = sidebar.element.querySelector('.sidebar-views') as HTMLElement;
  if (sidebarContent) {
    const header = document.createElement('div');
    header.textContent = 'EXPLORER';
    header.style.padding = '8px 12px';
    header.style.fontSize = '11px';
    header.style.fontWeight = '600';
    header.style.letterSpacing = '0.5px';
    header.style.color = 'rgba(255,255,255,0.6)';
    sidebarContent.appendChild(header);

    const items = ['src/', '  main.ts', '  parts/', '  layout/', 'index.html', 'package.json'];
    for (const item of items) {
      const el = document.createElement('div');
      el.textContent = item;
      el.style.padding = '2px 12px';
      el.style.fontSize = '13px';
      el.style.cursor = 'pointer';
      el.style.color = 'rgba(255,255,255,0.85)';
      el.addEventListener('mouseenter', () => el.style.backgroundColor = 'rgba(255,255,255,0.05)');
      el.addEventListener('mouseleave', () => el.style.backgroundColor = '');
      sidebarContent.appendChild(el);
    }
  }

  // Editor: watermark
  const watermark = editor.element.querySelector('.editor-watermark') as HTMLElement;
  if (watermark) {
    watermark.innerHTML = `
      <div style="text-align: center; color: rgba(255,255,255,0.25);">
        <div style="font-size: 48px; margin-bottom: 16px;">⊞</div>
        <div style="font-size: 14px;">Parallx Workbench</div>
        <div style="font-size: 12px; margin-top: 4px;">No editors open</div>
      </div>
    `;
  }

  // Panel: terminal placeholder
  const panelViews = panel.element.querySelector('.panel-views') as HTMLElement;
  if (panelViews) {
    const terminal = document.createElement('div');
    terminal.style.padding = '8px 12px';
    terminal.style.fontFamily = 'monospace';
    terminal.style.fontSize = '13px';
    terminal.style.color = 'rgba(255,255,255,0.75)';
    terminal.innerHTML = `
      <div style="color: rgba(255,255,255,0.4); margin-bottom: 4px;">TERMINAL</div>
      <div>$ parallx --version</div>
      <div style="color: #4ec9b0;">v0.1.0</div>
      <div>$ <span style="animation: blink 1s step-end infinite;">▋</span></div>
    `;
    panelViews.appendChild(terminal);
  }
}

// ── Status bar ──

function setupStatusBar(statusBar: StatusBarPart): void {
  statusBar.addEntry({
    id: 'branch',
    text: '⎇ master',
    alignment: StatusBarAlignment.Left,
    priority: 0,
    tooltip: 'Current branch',
  });
  statusBar.addEntry({
    id: 'errors',
    text: '⊘ 0  ⚠ 0',
    alignment: StatusBarAlignment.Left,
    priority: 10,
    tooltip: 'Errors and warnings',
  });
  statusBar.addEntry({
    id: 'line-col',
    text: 'Ln 1, Col 1',
    alignment: StatusBarAlignment.Right,
    priority: 100,
  });
  statusBar.addEntry({
    id: 'encoding',
    text: 'UTF-8',
    alignment: StatusBarAlignment.Right,
    priority: 90,
  });
}

// ── Start ──

document.addEventListener('DOMContentLoaded', bootstrap);
