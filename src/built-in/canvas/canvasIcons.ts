// canvasIcons.ts — SVG icon system for the Canvas tool
//
// Provides monochrome, theme-aware icons (uses currentColor) to replace
// all emoji usage. Icons render correctly in both light and dark themes.
//
// ⚠️  DO NOT import this file directly.
// Only config/iconRegistry.ts imports here (single gate).
// All other code gets icons through blockRegistry or canvasMenuRegistry.
//
// See docs/ICON_REGISTRY.md for the three-registry architecture.

// ─── Icon SVG Strings ────────────────────────────────────────────────────────
// All icons use viewBox="0 0 16 16" to match VS Code codicon convention.
// They use `currentColor` fill/stroke so they adapt to the theme automatically.

const ICONS: Record<string, string> = {
  // ── Document / Page ──
  'page': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.5 1H3.5C3.22 1 3 1.22 3 1.5V14.5C3 14.78 3.22 15 3.5 15H12.5C12.78 15 13 14.78 13 14.5V3.5L10.5 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 1V4H13" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  'page-filled': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.5 1H3.5C3.22 1 3 1.22 3 1.5V14.5C3 14.78 3.22 15 3.5 15H12.5C12.78 15 13 14.78 13 14.5V3.5L10.5 1Z" fill="currentColor" opacity="0.25" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 1V4H13" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',

  // ── Folder ──
  'folder': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 2.5H6L7.5 4H14.5V13.5H1.5V2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',

  // ── Chevron ──
  'chevron-right': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // ── Stars ──
  'star': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5L9.8 5.8L14.5 6.2L11 9.3L12 14L8 11.5L4 14L5 9.3L1.5 6.2L6.2 5.8L8 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  'star-filled': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5L9.8 5.8L14.5 6.2L11 9.3L12 14L8 11.5L4 14L5 9.3L1.5 6.2L6.2 5.8L8 1.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',

  // ── Add / Plus ──
  'plus': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',

  // ── Trash ──
  'trash': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14M5.5 4V2.5H10.5V4M6 6.5V12M8 6.5V12M10 6.5V12M3.5 4L4.5 14H11.5L12.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // ── Restore / Undo ──
  'restore': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 5.5L5 3M2.5 5.5L5 8M2.5 5.5H9.5C11.71 5.5 13.5 7.29 13.5 9.5C13.5 11.71 11.71 13.5 9.5 13.5H6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // ── Close / X ──
  'close': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',

  // ── Ellipsis / More ──
  'ellipsis': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="8" r="1.2" fill="currentColor"/></svg>',

  // ── Edit / Rename ──
  'edit': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.5 3.5L12.5 6.5" stroke="currentColor" stroke-width="1.2"/></svg>',

  // ── New Page / Subpage ──
  'new-page': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 1H3.5C3.22 1 3 1.22 3 1.5V14.5C3 14.78 3.22 15 3.5 15H12.5C12.78 15 13 14.78 13 14.5V4.5L9.5 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 7V12M5.5 9.5H10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',

  // ── Copy / Duplicate ──
  'duplicate': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 11V2.5C3 2.22 3.22 2 3.5 2H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',

  // ── Export / Download ──
  'export': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12V13.5C2 13.78 2.22 14 2.5 14H13.5C13.78 14 14 13.78 14 13.5V12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',

  // ── Lock ──
  'lock': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M5.5 7V5C5.5 3.07 7.07 1.5 9 1.5H8C9.93 1.5 11.5 3.07 11.5 5V7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',

  // ── Width / Expand ──
  'expand-width': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 8H15M1 8L4 5M1 8L4 11M15 8L12 5M15 8L12 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // ── Text size ──
  'text-size': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12L5.5 3H6.5L10 12M3.5 9H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 12L13 7H13.5L15.5 12M11.8 10.5H14.7" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // ── Image / Cover ──
  'image': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="6" r="1.5" stroke="currentColor" stroke-width="1"/><path d="M1.5 11L5 7.5L8 10.5L10.5 8L14.5 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // ── Smile face (for icon picker) ──
  'smile': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6.5" r="0.8" fill="currentColor"/><circle cx="10" cy="6.5" r="0.8" fill="currentColor"/><path d="M5.5 9.5C6 10.8 7 11.5 8 11.5C9 11.5 10 10.8 10.5 9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',

  // ── Link ──
  'link': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 9.5L9.5 6.5M4.5 9L2.8 10.7C2 11.5 2 12.8 2.8 13.6C3.6 14.4 4.9 14.4 5.7 13.6L7.5 11.8M8.5 4.2L10.3 2.4C11.1 1.6 12.4 1.6 13.2 2.4C14 3.2 14 4.5 13.2 5.3L11.5 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',

  // ── Search ──
  'search': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',

  // ── Open / Arrow ──
  'open': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3H3V13H13V10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 1H15V8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 1L7 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',

  // ── Page icon picker choices — simple monochrome icons ──
  'bookmark': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 2H12V14L8 11L4 14V2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  'lightbulb': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6C3.5 7.8 4.5 9.3 6 10V12H10V10C11.5 9.3 12.5 7.8 12.5 6C12.5 3.5 10.5 1.5 8 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 13.5H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'note': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2H13V11L10 14H3V2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 11V14L13 11H10Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 5.5H10.5M5.5 8H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'checklist': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5L3 4.5L5 2.5M2 7.5L3 8.5L5 6.5M2 11.5L3 12.5L5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 3.5H14M7 7.5H14M7 11.5H14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'calendar': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="12" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M2 6.5H14M5 1.5V4M11 1.5V4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'flag': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2V14M3 2H12L10 5.5L12 9H3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'heart': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 4.5C7 2 4 1.5 2.5 3.5C1 5.5 2 8 8 13C14 8 15 5.5 13.5 3.5C12 1.5 9 2 8 4.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  'target': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>',
  'bolt': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 1L3 9H8L7 15L13 7H8L9 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  'globe': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><ellipse cx="8" cy="8" rx="3" ry="6" stroke="currentColor" stroke-width="1"/><path d="M2.5 5.5H13.5M2.5 10.5H13.5" stroke="currentColor" stroke-width="1"/></svg>',
  'home': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 8L8 2L14 8M4 7V13.5H7V10H9V13.5H12V7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'inbox': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 10L4 2H12L14 10V13H2V10Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 10H5.5L6.5 11.5H9.5L10.5 10H14" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  'tag': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5H8L14.5 8L8 14.5L1.5 8V1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="5" cy="5" r="1.2" fill="currentColor"/></svg>',
  'code': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3L1 8L5 13M11 3L15 8L11 13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'rocket': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1C8 1 4 4 4 9L2 11L5 14L7 12C12 12 15 8 15 8C15 8 12 1 8 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="10" cy="6" r="1.2" fill="currentColor"/></svg>',
  'book': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5H6C7.1 2.5 8 3.4 8 4.5V14C8 13.2 7.3 12.5 6.5 12.5H2V2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M14 2.5H10C8.9 2.5 8 3.4 8 4.5V14C8 13.2 8.7 12.5 9.5 12.5H14V2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  'compass': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 5.5L9 9L5.5 10.5L7 7L10.5 5.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
  'puzzle': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 2V4C10 4 11 3 11 3C11 3 12 4 11 5H14V9C13 9 12 10 12 10C12 10 13 11 14 10V14H10C10 13 9 12 9 12C9 12 8 13 8 14H4V10C3 10 2 9 2 9C2 9 3 8 4 8V4H9V2Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
  'terminal': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M4 6L7 8.5L4 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 11H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'math': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3H5.5L8 13L11 5H14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 10H14.5M12.5 8V12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'math-block': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 5H6.5L8 11L10 6H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'database': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="8" cy="4" rx="6" ry="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 4V12C2 13.4 4.7 14.5 8 14.5C11.3 14.5 14 13.4 14 12V4" stroke="currentColor" stroke-width="1.2"/><path d="M2 8C2 9.4 4.7 10.5 8 10.5C11.3 10.5 14 9.4 14 8" stroke="currentColor" stroke-width="1.2"/></svg>',
  'grid': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="2" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="9" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/></svg>',
  'layers': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2L1.5 6L8 10L14.5 6L8 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M1.5 9L8 13L14.5 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'users': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 14C1 11.2 3.2 9 6 9C8.8 9 11 11.2 11 14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="11.5" cy="5.5" r="2" stroke="currentColor" stroke-width="1"/><path d="M15 14C15 11.7 13.5 9.7 11.5 9" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
  'pin': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 1.5L14.5 6L10 10.5L8.5 11L5 7.5L5.5 6L10 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5 11L2 14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'archive': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 2.5H14.5V5H1.5V2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.5 5V13.5H13.5V5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 8H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'music': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="4.5" cy="12" r="2" stroke="currentColor" stroke-width="1.2"/><circle cx="12.5" cy="10" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M6.5 12V3L14.5 1.5V10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'coffee': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 5H10V11C10 12.7 8.7 14 7 14H5C3.3 14 2 12.7 2 11V5Z" stroke="currentColor" stroke-width="1.2"/><path d="M10 6H12C13.1 6 14 6.9 14 8C14 9.1 13.1 10 12 10H10" stroke="currentColor" stroke-width="1.2"/><path d="M4 2V4M6 1V4M8 2V4" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
  'diamond': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1L15 8L8 15L1 8L8 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  'key': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="6" r="3.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 8L14 14M12 14L14 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // ── Slash menu block icons ──
  'bullet-list': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="3" cy="4" r="1.2" fill="currentColor"/><circle cx="3" cy="8" r="1.2" fill="currentColor"/><circle cx="3" cy="12" r="1.2" fill="currentColor"/><path d="M6.5 4H14M6.5 8H14M6.5 12H14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'numbered-list': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><text x="1.5" y="5.5" font-size="5" font-weight="600" fill="currentColor" font-family="sans-serif">1</text><text x="1.5" y="9.5" font-size="5" font-weight="600" fill="currentColor" font-family="sans-serif">2</text><text x="1.5" y="13.5" font-size="5" font-weight="600" fill="currentColor" font-family="sans-serif">3</text><path d="M6.5 4H14M6.5 8H14M6.5 12H14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'quote': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3V13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M5.5 5H13M5.5 8H11M5.5 11H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'divider': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 8H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 4H14M2 12H14" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" opacity="0.3"/></svg>',
  'columns': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="2" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9.5" y="2" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>',

  // ── Phase 3 block icons ──
  'toc': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3H14M4 6.5H12M4 10H13M2 13.5H14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'video': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M6.5 5.5V10.5L11 8L6.5 5.5Z" fill="currentColor"/></svg>',
  'audio': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 6V10H5L9 13V3L5 6H2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M11.5 5.5C12.3 6.3 12.8 7.1 12.8 8C12.8 8.9 12.3 9.7 11.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  'file-attachment': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 1H3.5C3.22 1 3 1.22 3 1.5V14.5C3 14.78 3.22 15 3.5 15H12.5C12.78 15 13 14.78 13 14.5V5L9 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 1V5H13" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
};

// ─── Icon IDs (for type safety) ──────────────────────────────────────────────

/** All available icon IDs. */
export const ICON_IDS = Object.keys(ICONS);

/** Icon IDs specifically for the page icon picker. */
export const PAGE_ICON_IDS: string[] = [
  'page', 'page-filled', 'note', 'bookmark', 'folder',
  'checklist', 'calendar', 'flag', 'heart', 'target',
  'bolt', 'star', 'lightbulb', 'globe', 'home',
  'inbox', 'tag', 'code', 'rocket', 'book',
  'compass', 'puzzle', 'terminal', 'database', 'grid',
  'layers', 'users', 'pin', 'archive', 'music',
  'coffee', 'diamond', 'key', 'image', 'link',
  'smile', 'search',
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the raw SVG string for an icon ID.
 * Returns the 'page' icon if the ID is unknown.
 */
export function svgIcon(id: string): string {
  return ICONS[id] ?? ICONS['page'];
}

/**
 * Create a sized <span> element containing an SVG icon.
 * The span uses `display: inline-flex` and sets width/height.
 *
 * @param id — icon identifier
 * @param size — pixel size (both width and height), default 16
 * @returns HTMLElement span with the SVG inside
 */
export function createIconElement(id: string, size = 16): HTMLElement {
  const span = document.createElement('span');
  span.className = 'canvas-svg-icon';
  span.innerHTML = svgIcon(id);
  const svg = span.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  // Visual layout set in CSS (.canvas-svg-icon); only computed dimensions inline
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  return span;
}

/**
 * Render an SVG icon into an existing container element (replaces content).
 *
 * @param container — target element
 * @param id — icon identifier
 * @param size — pixel size, default 16
 */
export function renderIconInto(container: HTMLElement, id: string, size = 16): void {
  container.innerHTML = svgIcon(id);
  const svg = container.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
}

/**
 * Resolve a page's icon field to the appropriate icon ID.
 * If the icon is null/empty, returns 'page' (default).
 * If the icon is an emoji (legacy data), returns 'page' (fallback).
 * If the icon is a known ID, returns it.
 */
export function resolvePageIcon(icon: string | null | undefined): string {
  if (!icon) return 'page';
  if (ICONS[icon]) return icon;
  // Legacy emoji data — fall back to default page icon
  return 'page';
}
