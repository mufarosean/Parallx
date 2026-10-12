// canvasSidebarToast.ts — the sidebar's undo toast: one at a time, gone
// after five seconds or on Undo or dismiss.

import { $ } from '../../ui/dom.js';
import { declareControl } from '../../ui/kit.js';

export class UndoToast {
  private _el: HTMLElement | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  show(container: HTMLElement, label: string, undo: () => Promise<void>, onError: (err: unknown) => void): void {
    this.dismiss();
    const toast = $('div.canvas-sidebar-toast');
    const text = $('span.canvas-sidebar-toast-text');
    text.textContent = label;
    toast.appendChild(text);
    const btn = $('button.canvas-sidebar-toast-undo') as HTMLButtonElement;
    btn.type = 'button';
    btn.textContent = 'Undo';
    declareControl(btn, { id: 'canvas.sidebar.toast.undo', label: 'Undo', hint: label });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss();
      void undo().catch(onError);
    });
    toast.appendChild(btn);
    const closeBtn = $('button.canvas-sidebar-toast-close') as HTMLButtonElement;
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    declareControl(closeBtn, { id: 'canvas.sidebar.toast.dismiss', label: 'Dismiss', kind: 'iconButton' });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss();
    });
    toast.appendChild(closeBtn);
    container.appendChild(toast);
    this._el = toast;
    this._timer = setTimeout(() => this.dismiss(), 5000);
  }

  dismiss(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
  }
}
