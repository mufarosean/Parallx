// navigationWiring.ts — gives Back and Forward (services/navigationHistory.ts)
// the editor area and the places point, and the mouse's side buttons.
//
// A step is the tab in front; for a tool's place tab, the place too. The
// record starts once the last session's tabs are back, so putting them back
// is not a walk through them.

import { toDisposable, type IDisposable } from '../platform/lifecycle.js';
import { navigationHistory, type NavigationStep } from '../services/navigationHistory.js';
import { places, focusPageTitle, parsePlaceAddress } from '../services/places.js';
import { deserializeEditorInput, canReopenEditorType } from '../editor/editorInputDeserializer.js';
import { afterStartup } from '../services/startupDone.js';
import { GO_BACK_COMMAND, GO_FORWARD_COMMAND } from '../commands/navigationCommands.js';
import { yieldKeysToPage } from '../services/keybindingService.js';
import type { EditorPart } from '../parts/editorPart.js';
import type { IEditorService, ICommandService, IKeybindingService, IFileService } from '../services/serviceTypes.js';

/** The mouse's side buttons (MouseEvent.button): back and forward. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

export function wireNavigation(
  editorPart: EditorPart,
  editorService: IEditorService,
  commands: () => ICommandService | undefined,
  keybindings: () => IKeybindingService | undefined,
  files: () => IFileService | undefined,
): IDisposable {
  navigationHistory.setHost({
    current(): NavigationStep | undefined {
      const group = editorPart.activeGroup;
      const input = group?.model.activeEditor;
      if (!group || !input) return undefined;
      const place = places.placeOfTab(input.id);
      let reopen: NavigationStep['reopen'];
      try {
        const saved = input.serialize();
        reopen = { typeId: saved.typeId, data: saved.data };
      } catch { /* a tab that cannot say how to open it again is skipped once closed */ }
      return { editorId: input.id, groupId: group.id, label: place?.title ?? input.name, place: place?.address, reopen };
    },
    isOpen: (editorId) => editorPart.groups.some((g) => g.model.editors.some((e) => e.id === editorId)),
    async focus(editorId, groupId) {
      const group = editorPart.groups.find((g) => g.id === groupId && g.model.editors.some((e) => e.id === editorId))
        ?? editorPart.groups.find((g) => g.model.editors.some((e) => e.id === editorId));
      if (!group) return false;
      editorPart.activateGroup(group.id);
      group.model.setActive(group.model.editors.findIndex((e) => e.id === editorId));
      return true;
    },
    async reopen(saved, groupId) {
      const input = deserializeEditorInput(saved.typeId, saved.data);
      if (!input) return false;
      // A file deleted since its tab closed is not opened again (as an empty tab or an error).
      const fs = files();
      if (input.uri?.scheme === 'file' && fs && !(await fs.exists(input.uri).catch(() => false))) { input.dispose?.(); return false; }
      await editorService.openEditor(input, { pinned: true }, groupId && editorPart.getGroup(groupId) ? groupId : undefined);
      return editorPart.activeGroup?.model.activeEditor?.id === input.id;
    },
    openPlace: (address, editorId) => places.openAddress(address, editorId ? { tabId: editorId } : {}),
    focusTitle() {
      const group = editorPart.activeGroup;
      const container = group?.element.querySelector<HTMLElement>('.editor-pane-container');
      if (!group || !container) return;
      // A page with the kit's header: the keys on its title (a place's move already put them there).
      if (container.querySelector('.px-page-header__title')) { focusPageTitle(container); return; }
      group.activePane?.focus();
    },
  });

  const subs: IDisposable[] = [];
  // Alt+Left moves what has the keys in a keyboard's drag; only a press nothing took goes back.
  subs.push(yieldKeysToPage(GO_BACK_COMMAND), yieldKeysToPage(GO_FORWARD_COMMAND));
  subs.push(editorService.onDidActiveEditorChange(() => navigationHistory.note()));
  subs.push(places.onDidMoveTab((id) => { if (editorPart.activeGroup?.model.activeEditor?.id === id) navigationHistory.note(); }));
  afterStartup(() => navigationHistory.start());

  // A tool turned off: its places and tabs leave the record (not only once a press stumbles on them).
  const isOpen = (id: string) => editorPart.groups.some((g) => g.model.editors.some((e) => e.id === id));
  const prune = () => navigationHistory.prune((step) => {
    if (isOpen(step.editorId) && !step.place) return true;
    if (step.place) { const tool = parsePlaceAddress(step.place)?.tool; return !!tool && places.list().some((t) => t.id === tool); }
    return !!step.reopen && canReopenEditorType(step.reopen.typeId);
  });
  subs.push(places.onDidChange(prune), editorService.onDidChangeOpenEditors(prune));

  // The side buttons do what Alt+Left and Alt+Right do here: Back and Forward,
  // or a tab's own Back (the Browser's) while it holds those keys.
  const onSideButton = (e: MouseEvent) => {
    if (e.button !== MOUSE_BACK && e.button !== MOUSE_FORWARD) return;
    e.preventDefault();
    const back = e.button === MOUSE_BACK;
    const command = keybindings()?.commandForKey(back ? 'Alt+Left' : 'Alt+Right') ?? (back ? GO_BACK_COMMAND : GO_FORWARD_COMMAND);
    void commands()?.executeCommand(command);
  };
  window.addEventListener('auxclick', onSideButton, true);
  subs.push(toDisposable(() => window.removeEventListener('auxclick', onSideButton, true)));
  return toDisposable(() => { for (const d of subs.splice(0)) d.dispose(); });
}
