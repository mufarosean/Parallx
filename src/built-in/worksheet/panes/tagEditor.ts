// tagEditor.ts — Worksheets: the tags line in a problem's note box.
//
// The problem's own tags, each a button that takes it off; a field that adds
// one on Enter; and the tags used elsewhere, each a button that puts it on.
// Its buttons run commands (worksheet.addTag, worksheet.removeTag), so the
// palette and the assistant can do the same.
import { createButton, createInput } from '../../../ui/kit.js';
import { escapeHtml } from '../../../ui/format.js';
import { htmlFragment } from '../../../ui/answerForms.js';
import { onWorksheetDataChanged } from '../worksheetData.js';
import { addItemTag, listAllItemTags, listItemTags } from '../tagData.js';

export const ADD_TAG_COMMAND = 'worksheet.addTag';
export const REMOVE_TAG_COMMAND = 'worksheet.removeTag';
/** How many other tags are offered under the field. */
const SUGGESTED = 8;

/** Seats the tags line at the end of `host` and keeps it current while it is on screen. */
export function mountTagEditor(host: HTMLElement, itemId: number): void {
  host.appendChild(htmlFragment('<div class="ws-tags"><span class="ws-tags__label">Tags</span><span class="ws-tags__own"></span><span class="ws-tags__field"></span><span class="ws-tags__more"></span></div>'));
  const root = host.lastElementChild as HTMLElement;
  const own = root.querySelector<HTMLElement>('.ws-tags__own')!;
  const more = root.querySelector<HTMLElement>('.ws-tags__more')!;
  const input = createInput(root.querySelector<HTMLElement>('.ws-tags__field'), { id: null, label: 'Add a tag', placeholder: 'Add a tag' });
  input.element.addEventListener('keydown', (e: KeyboardEvent) => {
    // The sheet and the quiz take keys of their own: these stay in the field.
    e.stopPropagation();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    const v = input.value;
    input.value = '';
    void addItemTag(itemId, v).catch(() => {});
  });
  let seq = 0;
  const paint = async () => {
    const mine = ++seq;
    const [tags, all] = await Promise.all([listItemTags(itemId).catch(() => [] as string[]), listAllItemTags().catch(() => [] as { tag: string; count: number }[])]);
    if (mine !== seq) return;
    own.replaceChildren();
    for (const t of tags) createButton(own, { id: null, label: t, icon: 'x', kind: 'ghost', size: 'sm', title: `Remove the tag ${t}`, command: REMOVE_TAG_COMMAND, args: [itemId, t] });
    more.replaceChildren();
    const others = all.filter((a) => !tags.includes(a.tag)).slice(0, SUGGESTED);
    for (const o of others) createButton(more, { id: null, label: o.tag, icon: 'plus', kind: 'ghost', size: 'sm', title: `Add the tag ${o.tag} (${o.count} ${o.count === 1 ? 'problem' : 'problems'})`, command: ADD_TAG_COMMAND, args: [itemId, o.tag] });
    if (!tags.length && !others.length) more.appendChild(htmlFragment(`<span class="ws-hint">${escapeHtml('A tag picks out a set: search it in the Problem Bank, or make it a roster.')}</span>`));
  };
  void paint();
  const sub = onWorksheetDataChanged(() => { if (!root.isConnected) { sub.dispose(); return; } void paint(); });
}
