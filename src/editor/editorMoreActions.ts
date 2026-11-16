// editorMoreActions.ts — the More Actions button of the text and code panes.
//
// Running tools add entries to an editor pane's More Actions through the
// `editor/title` menu location (when: activeEditor == '<typeId>', and
// resourceExtname for the file's kind). The PDF pane lists them in its own
// toolbar menu; the text and code panes, which have no toolbar of their own
// to hold one, put this button in their status line. The pane names no tool:
// it lists what is there, with the tool's name at the right, and the button
// is hidden while nothing is, so no pane offers a menu that holds nothing.
//
// The button runs a command (editor.showMoreActions) rather than a handler of
// its own, so the same menu is in the palette for the active editor.

import type { IDisposable } from '../platform/lifecycle.js';
import type { URI } from '../platform/uri.js';
import type { CommandDescriptor } from '../commands/commandTypes.js';
import { createIconButton } from '../ui/kit.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { getEditorTitleActions, onDidChangeEditorTitleActions, type IEditorTitleTarget } from '../contributions/menuContribution.js';

export const EDITOR_MORE_ACTIONS_COMMAND = 'editor.showMoreActions';

/** What the button hands its command: where to open the menu, and for which file. */
export interface IEditorMoreActionsRequest {
  readonly anchor: HTMLElement | undefined;
  target(): IEditorTitleTarget | undefined;
}

/** The target for an editor typeId and the file it shows; undefined for an editor with no file. */
export function editorTitleTargetOf(typeId: string, uri: URI | undefined): IEditorTitleTarget | undefined {
  if (!uri || uri.scheme !== 'file') return undefined;
  return { typeId, uri: uri.toString(), fsPath: uri.fsPath, extname: uri.extname.toLowerCase(), filename: uri.basename, scheme: uri.scheme };
}

export interface IEditorMoreActions extends IDisposable {
  readonly element: HTMLButtonElement;
  /** Show or hide the button for the file the pane shows now. */
  refresh(): void;
}

/** Add the button to `host` (a pane's status line). `target` is read each time: a pane is given another file. */
export function mountEditorMoreActions(host: HTMLElement, target: () => IEditorTitleTarget | undefined): IEditorMoreActions {
  const request: { anchor: HTMLElement | undefined; target: () => IEditorTitleTarget | undefined } = { anchor: undefined, target };
  const element = createIconButton(host, { id: 'editor.moreActions', icon: 'ellipsis', title: 'More Actions', size: 'sm', command: EDITOR_MORE_ACTIONS_COMMAND, args: [request] });
  element.classList.add('editor-more-actions');
  request.anchor = element;
  const refresh = (): void => {
    const t = target();
    element.hidden = !t || getEditorTitleActions(t).length === 0;
  };
  const sub = onDidChangeEditorTitleActions(refresh);
  refresh();
  return { element, refresh, dispose: () => { sub.dispose(); element.remove(); } };
}

interface ICommandRunner { executeCommand(id: string, ...args: unknown[]): Promise<unknown> }
interface IActiveEditorSource { readonly activeEditor?: { readonly typeId: string; readonly uri?: URI } }

/** The request for the active editor (from the palette): its pane's button when one is on screen. */
function activeRequest(editors: IActiveEditorSource | undefined): IEditorMoreActionsRequest | undefined {
  const editor = editors?.activeEditor;
  const t = editor ? editorTitleTargetOf(editor.typeId, editor.uri) : undefined;
  if (!t) return undefined;
  const button = document.querySelector<HTMLElement>('.editor-group--active .editor-more-actions:not([hidden])') ?? undefined;
  return { anchor: button, target: () => t };
}

/** Open the menu for `request`; selecting an entry runs its command with `{ uri, fsPath }`. Null when there is nothing to list. */
export function showEditorMoreActions(commands: ICommandRunner, request: IEditorMoreActionsRequest): ContextMenu | null {
  const t = request.target();
  const actions = t ? getEditorTitleActions(t) : [];
  if (!t || !actions.length) return null;
  const r = (request.anchor ?? document.querySelector<HTMLElement>('.editor-group--active') ?? document.body).getBoundingClientRect();
  const menu = ContextMenu.show({
    // The contributing tool's name goes in the muted right-hand slot, as the PDF pane's menu does.
    items: actions.map((a) => ({ id: a.commandId, label: a.label, keybinding: a.toolName })),
    anchor: r,
    anchorPosition: 'above',
    label: 'More Actions',
  });
  menu.onDidSelect((e) => {
    void commands.executeCommand(e.item.id, { uri: t.uri, fsPath: t.fsPath })
      .catch((err) => console.error(`[EditorMoreActions] "${e.item.id}" failed:`, err));
  });
  return menu;
}

const showMoreActions: CommandDescriptor = {
  id: EDITOR_MORE_ACTIONS_COMMAND,
  title: 'Show Editor Actions',
  category: 'Editor',
  handler(ctx, arg) {
    const commands = ctx.getService<ICommandRunner>('ICommandService');
    const given = arg as Partial<IEditorMoreActionsRequest> | undefined;
    const request = given && typeof given.target === 'function' ? given as IEditorMoreActionsRequest : activeRequest(ctx.getService<IActiveEditorSource>('IEditorService'));
    if (commands && request) showEditorMoreActions(commands, request);
  },
};

export const ALL_EDITOR_MORE_ACTIONS_COMMANDS: readonly CommandDescriptor[] = [showMoreActions];
