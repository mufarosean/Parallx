// navigationArrows.ts — Back and Forward at the start of the bar under the tabs.
//
// Two of the kit's icon buttons, one record behind them (services/
// navigationHistory.ts). Each is named for where it goes ("Back to
// Calendar"), is disabled when there is nowhere to go, and lists the last
// few steps that way when held or right-clicked (or its menu key pressed).

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import { createIconButton } from '../ui/kit.js';
import { createBlock } from '../ui/block.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { navigationHistory } from '../services/navigationHistory.js';
import { GO_BACK_COMMAND, GO_FORWARD_COMMAND } from '../commands/navigationCommands.js';

/** How long a press is held before the list opens. */
const HOLD_MS = 500;

type Direction = 'back' | 'forward';

export class NavigationArrows extends Disposable {
  readonly domNode: HTMLElement;
  private readonly _buttons: Record<Direction, HTMLButtonElement>;
  /** The list open now (a finger's long press sends both a hold and a contextmenu: one list). */
  private _openList: ContextMenu | undefined;

  constructor(container: HTMLElement) {
    super();
    this.domNode = createBlock(container, 'div', { className: 'editor-nav-arrows' });
    this.domNode.setAttribute('role', 'group');
    this.domNode.setAttribute('aria-label', 'Back and Forward');
    this._buttons = {
      back: this._arrow('back', 'arrow-left'),
      forward: this._arrow('forward', 'arrow-right'),
    };
    this._register(navigationHistory.onDidChange(() => this.update()));
    this.update();
  }

  /** Name and enable each arrow for where it goes now. */
  update(): void {
    for (const dir of ['back', 'forward'] as const) {
      const btn = this._buttons[dir];
      const step = dir === 'back' ? navigationHistory.previous : navigationHistory.next;
      const word = dir === 'back' ? 'Back' : 'Forward';
      const name = step ? `${word} to ${step.label}` : word;
      btn.disabled = !step;
      btn.setAttribute('aria-label', name);
      btn.title = `${name} (${dir === 'back' ? 'Alt+Left' : 'Alt+Right'})`;
    }
  }

  private _arrow(dir: Direction, icon: string): HTMLButtonElement {
    const btn = createIconButton(this.domNode, {
      id: `editor.navigation.${dir}`,
      icon,
      title: dir === 'back' ? 'Back' : 'Forward',
      size: 'sm',
      command: dir === 'back' ? GO_BACK_COMMAND : GO_FORWARD_COMMAND,
    });
    btn.classList.add('editor-nav-arrow');

    // Right-click, or the menu key: the list.
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      this._showList(dir, btn, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined);
    };
    btn.addEventListener('contextmenu', onMenu);

    // Held (a mouse, a finger or a pen): the list, and the press that let go is not a click.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const onPress = (e: PointerEvent) => {
      if (e.button !== 0 || btn.disabled) return;
      cancel();
      // Held: the list. The arrow is disabled while it is open, so letting go is not also a click (a step).
      timer = setTimeout(() => { timer = undefined; if (this._showList(dir, btn)) btn.disabled = true; }, HOLD_MS);
    };
    btn.addEventListener('pointerdown', onPress);
    for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) btn.addEventListener(type, cancel);
    this._register({
      dispose: () => {
        cancel();
        btn.removeEventListener('contextmenu', onMenu);
        btn.removeEventListener('pointerdown', onPress);
        for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) btn.removeEventListener(type, cancel);
      },
    });
    return btn;
  }

  /** Open the list of steps that way; false when there are none. */
  private _showList(dir: Direction, btn: HTMLButtonElement, at?: { x: number; y: number }): boolean {
    const steps = navigationHistory.list(dir);
    if (!steps.length || this._openList) return false;
    const r = btn.getBoundingClientRect();
    const menu = ContextMenu.show({
      items: steps.map(({ step, offset }, i) => ({ id: String(offset), label: step.label, group: '1_steps', order: i })),
      anchor: at ?? { x: r.left, y: r.bottom },
      label: dir === 'back' ? 'Back to' : 'Forward to',
      autoSelectFirst: !at, // opened by the keyboard (the menu key): the keys on the nearest step
    });
    this._openList = menu;
    menu.onDidSelect(({ item }) => { void navigationHistory.go(Number(item.id)); });
    menu.onDidDismiss(() => { this._openList = undefined; this.update(); });
    return true;
  }
}

/**
 * The bar under the tabs: Back and Forward first, then what the tab puts
 * there (its trail, or a page's own ribbon) in `content`.
 */
export function createEditorRibbon(group: HTMLElement, keep: (d: IDisposable) => void): { outer: HTMLElement; content: HTMLElement } {
  const outer = createBlock(group, 'div', { className: 'editor-ribbon' });
  keep(new NavigationArrows(outer));
  const content = createBlock(outer, 'div', { className: 'editor-ribbon-content' });
  return { outer, content };
}
