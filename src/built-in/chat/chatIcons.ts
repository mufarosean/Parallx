// chatIcons.ts — SVG icons for the chat UI
//
// Thin wrapper over the central Lucide icon registry (src/ui/iconRegistry.ts).
// All actual SVG data lives in iconRegistry.generated.ts — this file only
// maps the chat-specific property names to registry keys so that the 11+
// consumer files can keep using `chatIcons.send`, `chatIcons.chevronDown`, etc.
//
// Usage: element.innerHTML = chatIcons.newChat;

import { getIcon } from '../../ui/iconRegistry.js';

// Helper: getIcon returns string|undefined, but every key below is guaranteed
// to exist in the generated registry, so the `!` assertion is safe here.
const g = (id: string): string => getIcon(id)!;

/** All chat SVG icons — backed by the central Lucide registry. */
export const chatIcons = {

  // ── Header actions ──
  newChat:          g('plus'),
  history:          g('history'),
  trash:            g('trash'),
  refresh:          g('refresh'),
  search:           g('search'),
  gear:             g('gear'),

  // ── Input actions ──
  send:             g('send'),
  stop:             g('stop'),
  attach:           g('attach'),

  // ── Scroll ──
  chevronDown:      g('chevron-down'),

  // ── Empty state / welcome ──
  sparkle:          g('sparkle'),
  chatBubble:       g('chat-bubble'),
  pencil:           g('pencil'),
  agent:            g('agent'),
  atSign:           g('at-sign'),
  canvas:           g('page'),
  keyboard:         g('keyboard'),
  wand:             g('wand'),
  lightbulb:        g('lightbulb'),

  // ── Sidebar ──
  chevronRight:     g('chevron-right'),
  sectionExpanded:  g('section-expanded'),

  // ── Message actions ──
  copy:             g('copy'),
  check:            g('check'),
  wrench:           g('wrench'),
  tools:            g('tools'),
  person:           g('person'),
  sparkleSmall:     g('sparkles'),

  // ── Context attachments ──
  file:             g('file'),
  close:            g('close'),
  folder:           g('folder'),
  image:            g('image'),
  selection:        g('selection'),
};
