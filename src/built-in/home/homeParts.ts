// homeParts.ts — the pieces Home is made of: a tool's card, one thing in the
// feed with its picture, and a first step on a new workspace.

import type { HomeCard, HomeEntry, HomeItem } from '../../services/homeSources.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { formatRelativeTime } from '../../ui/relativeTime.js';
import { createBlock, createButton, createIconButton, sceneSlug } from '../../ui/kit.js';

/** How a thing in the feed is told from every other: its source, then itself. */
export const entryKey = (entry: HomeEntry): string => `${entry.source.id}\n${entry.item.id}`;

/** One tool's card: where it is from, its number, a line, its one action. */
export function drawCard(list: HTMLElement, card: HomeCard, first: boolean): void {
  const li = createBlock(list, 'li', { className: 'home-card' });
  const from = createBlock(li, 'div', { className: 'home-card__from' });
  if (card.icon) from.appendChild(createIconElement(card.icon, 13));
  createBlock(from, 'span', { text: card.from });
  if (card.number) {
    const number = createBlock(li, 'div', { className: 'home-card__number', text: card.number });
    if (card.unit) createBlock(number, 'small', { text: card.unit });
  }
  createBlock(li, 'p', { className: 'home-card__line', text: card.line });
  createButton(li, {
    id: `home.card.${sceneSlug(card.id)}`, label: card.action.label, icon: card.action.icon, size: 'sm',
    kind: first ? 'primary' : 'secondary', command: card.action.command, args: card.action.args,
  });
}

/**
 * A picture of the thing: its own image when it has one, or else a small
 * sheet of paper with its opening text set on it, as the thing would look
 * from across the room. Drawn for the eye only; the entry's words say it all.
 */
function drawPicture(host: HTMLElement, item: HomeItem): void {
  if (item.image) {
    createBlock(host, 'img', { className: 'home-thumb home-thumb--image', attrs: { src: item.image, alt: '' } });
    return;
  }
  const thumb = createBlock(host, 'div', { className: 'home-thumb', attrs: { role: 'img', 'aria-hidden': 'true' } });
  const text = (item.preview ?? item.summary ?? '').trim();
  createBlock(thumb, 'div', { className: 'home-thumb__title', text: item.title });
  if (text) createBlock(thumb, 'div', { className: 'home-thumb__text', text });
  else createBlock(thumb, 'div', { className: 'home-thumb__kind' }).appendChild(createIconElement(item.icon ?? 'file', 26));
}

/** One thing last worked on: its picture, title, place, opening words, tags, and a figure or the time at the right. */
export function drawEntry(list: HTMLElement, entry: HomeEntry, pinned: boolean): void {
  const { source, item } = entry;
  const title = item.title || 'Untitled';
  const li = createBlock(list, 'li', { className: 'home-entry', attrs: { 'data-key': entryKey(entry) } });
  drawPicture(li, item);

  const body = createBlock(li, 'div', { className: 'home-entry__body' });
  const open = createButton(body, { id: null, label: title, icon: item.icon ?? 'file', kind: 'ghost', command: 'home.openItem', args: [source.id, item.id] });
  open.className = 'home-entry__title';
  const where = [item.kind, item.where].filter(Boolean).join(' · ');
  if (where) createBlock(body, 'div', { className: 'home-entry__where', text: where });
  if (item.summary) createBlock(body, 'p', { className: 'home-entry__opening', text: item.summary });
  if (item.tags?.length) {
    const tags = createBlock(body, 'div', { className: 'home-entry__tags' });
    for (const t of item.tags.slice(0, 5)) createBlock(tags, 'span', { text: t });
  }

  const side = createBlock(li, 'div', { className: 'home-entry__side' });
  if (item.stat) {
    createBlock(side, 'strong', { text: item.stat.value });
    if (item.stat.unit) createBlock(side, 'span', { text: item.stat.unit });
  }
  createBlock(side, 'span', { className: 'home-entry__when', text: formatRelativeTime(item.touchedAt, 'short') });
  const pin = createIconButton(side, {
    id: null, icon: pinned ? 'pin-off' : 'pin', title: `${pinned ? 'Unpin' : 'Pin'} ${title}`, size: 'sm',
    command: 'home.pinItem', args: [source.id, item.id],
  });
  pin.classList.add('home-entry__pin');
  pin.setAttribute('aria-pressed', String(pinned));
}

export interface HomeStep {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly hint: string;
  readonly command: string;
}

/** A first step on a workspace with nothing in it yet: one action and what it brings. */
export function drawStep(list: HTMLElement, step: HomeStep): void {
  const li = createBlock(list, 'li', { className: 'home-card home-card--step' });
  createButton(li, { id: `home.step.${step.id}`, label: step.label, icon: step.icon, kind: 'secondary', command: step.command });
  createBlock(li, 'p', { className: 'home-card__line', text: step.hint });
}
