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
  refresh:          g('refresh'),
  search:           g('search'),
  gear:             g('gear'),
  scrollText:       g('scroll-text'),

  // ── Input actions ──
  // Send is arrow-up, not the paper plane — the modern assistant convention.
  send:             g('arrow-up'),
  stop:             g('stop'),
  attach:           g('attach'),

  // ── Scroll ──
  chevronDown:      g('chevron-down'),

  // ── Empty state / welcome ──
  // The AI wears the brand mark, never the sparkle (see brandIcons.ts).
  sparkle:          g('px-ai-mark'),
  pencil:           g('pencil'),
  // Agent mode is the AI acting; it wears the mark, not a robot.
  agent:            g('px-ai-mark'),
  atSign:           g('at-sign'),
  canvas:           g('page'),
  keyboard:         g('keyboard'),
  lightbulb:        g('lightbulb'),

  // ── Sidebar ──
  chevronRight:     g('chevron-right'),
  sectionExpanded:  g('section-expanded'),
  trash:            g('trash'),

  // ── Message actions ──
  copy:             g('copy'),
  check:            g('check'),
  wrench:           g('wrench'),
  tools:            g('tools'),
  person:           g('person'),
  sparkleSmall:     g('px-ai-mark'),

  // ── Context attachments ──
  file:             g('file'),
  close:            g('close'),
  folder:           g('folder'),
  image:            g('image'),
  selection:        g('selection'),
};
