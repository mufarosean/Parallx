// chatIcons.ts — Minimalistic SVG icons for the chat UI
//
// Inline SVG strings styled to match VS Code's codicon aesthetic:
//   • 16×16 viewBox, 1.2px stroke, currentColor fill/stroke
//   • No emoji — clean vector paths only
//
// Usage: element.innerHTML = chatIcons.newChat;

/** All chat SVG icons, sized 16×16 with currentColor. */
export const chatIcons = {

  // ── Header actions ──

  /** Plus icon — new chat */
  newChat: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  /** Clock icon — history */
  history: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  /** Trash icon — clear/delete */
  trash: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.5 2.5h5M3.5 4h9M4.5 4v8a1 1 0 001 1h5a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6.5 6.5v4M9.5 6.5v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  /** Refresh icon — reload */
  refresh: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.5 6.5A4.5 4.5 0 004 5m-.5 4.5A4.5 4.5 0 0012 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M12.5 3.5v3h-3M3.5 12.5v-3h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  /** Search / filter icon */
  search: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.2"/>
    <path d="M10 10l3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  // ── Input actions ──

  /** Send / arrow-up icon */
  send: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 12V4M4.5 7.5L8 4l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  /** Stop / square icon */
  stop: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="4" width="8" height="8" rx="1"/>
  </svg>`,

  /** Paperclip icon — attach context */
  attach: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.5 4.5l-5 5a2.12 2.12 0 003 3l5.5-5.5a3.18 3.18 0 00-4.5-4.5L4 8a4.24 4.24 0 006 6l4.5-4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // ── Scroll ──

  /** Chevron-down icon — scroll to bottom */
  chevronDown: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // ── Empty state / welcome ──

  /** Sparkle icon — welcome */
  sparkle: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`,

  /** Chat bubble — ask mode hint */
  chatBubble: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.5 3.5h11a1 1 0 011 1v6a1 1 0 01-1 1H5l-2.5 2v-2h0a1 1 0 01-1-1v-6a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`,

  /** Pencil — edit mode hint */
  pencil: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.5 2.5l2 2-8.5 8.5H3v-2L11.5 2.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`,

  /** CPU / agent — agent mode hint */
  agent: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  /** At-sign — @workspace hint */
  atSign: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.2"/>
    <path d="M11 6.5v3a1.5 1.5 0 003 0V8A6 6 0 108 14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  /** Layers / canvas — @canvas hint */
  canvas: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 8l6-4 6 4-6 4-6-4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M2 10.5l6 4 6-4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  /** Keyboard — shortcut hint */
  keyboard: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="4" width="13" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M4.5 7h1M7 7h2M10.5 7h1M5 9.5h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  // ── Sidebar ──

  /** Small chevron-right (collapsed section) */
  chevronRight: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  /** Small chevron-down (expanded section) */
  sectionExpanded: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // ── Message actions ──

  /** Clipboard / copy icon */
  copy: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5.5" y="5.5" width="7" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/>
    <path d="M10.5 5.5V3.5a1 1 0 00-1-1h-6a1 1 0 00-1 1v8a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.2"/>
  </svg>`,

  /** Checkmark icon */
  check: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  /** Wrench / tool icon */
  wrench: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 2.5a3.5 3.5 0 00-3.3 4.7L3 11l1 1 1 1 3.8-3.7A3.5 3.5 0 0010 2.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`,

  /** Tools icon — wrench + screwdriver crossed */
  tools: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.7 9.3L2.3 12.7a1 1 0 000 1.4l0 0a1 1 0 001.4 0L7 10.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10.8 1.5a3 3 0 00-2.6 4.2L4 10l.7.7.7.7 4.3-4.2A3 3 0 0014 4.5l-1.8 1.8-1.5-.5-.5-1.5 1.8-1.8a3 3 0 00-1.2-.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`,

  /** Person silhouette — user avatar */
  person: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M3 13.5c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  /** Sparkle small — 16×16 for assistant avatar */
  sparkleSmall: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 1.5l1.5 4.5L14.5 8l-5 2-1.5 4.5L6.5 10 1.5 8l5-2L8 1.5z" stroke="currentColor" stroke-width="1.0" stroke-linejoin="round"/>
  </svg>`,

  // ── Context attachments ──

  /** File icon — document */
  file: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 2h5.5L13 5.5V13a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M9 2v4h4" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`,

  /** Close / × icon */
  close: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`,

  /** Folder icon */
  folder: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5H3A1 1 0 002 4.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`,

  /** Image / picture icon */
  image: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="5.5" cy="6.5" r="1.5" stroke="currentColor" stroke-width="1"/>
    <path d="M2 11l3-3 2.5 2.5L10 8l4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

} as const;
