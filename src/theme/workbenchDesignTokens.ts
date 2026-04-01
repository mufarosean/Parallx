// workbenchDesignTokens.ts — registers all workbench design tokens
//
// Import this file during workbench startup to ensure all design tokens
// are registered before theme application.
//
// Token names use dot-separated categories matching the design system scale.

import { designTokenRegistry } from './designTokenRegistry.js';

// Helper — shorthand for registering a token with all 4 theme defaults
function reg(id: string, description: string, dark: string, light: string, hcDark: string, hcLight: string): void {
  designTokenRegistry.registerToken(id, description, { dark, light, hcDark, hcLight });
}

// ─── Font Family ─────────────────────────────────────────────────────────────

reg('fontFamily.ui',
  'UI font family for menus, labels, sidebar, status bar',
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
);

reg('fontFamily.editor',
  'Editor / canvas content font family',
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
);

reg('fontFamily.mono',
  'Monospace font family for code blocks, terminal, inline code',
  "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
  "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
  "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
  "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
);

// ─── Font Size ───────────────────────────────────────────────────────────────

reg('fontSize.xs',   'Extra small text (labels, badges)',     '10px', '10px', '10px', '10px');
reg('fontSize.sm',   'Small text (status bar, captions)',     '11px', '11px', '11px', '11px');
reg('fontSize.base', 'Base UI text size',                     '12px', '12px', '12px', '12px');
reg('fontSize.md',   'Medium text (sidebar items, menus)',    '13px', '13px', '13px', '13px');
reg('fontSize.lg',   'Large text (section headers)',          '14px', '14px', '14px', '14px');
reg('fontSize.xl',   'Extra large text (canvas body)',        '16px', '16px', '16px', '16px');
reg('fontSize.2xl',  'Heading text',                          '24px', '24px', '24px', '24px');
reg('fontSize.3xl',  'Large heading text',                    '36px', '36px', '36px', '36px');

// ─── Border Radius ───────────────────────────────────────────────────────────

reg('radius.none', 'No border radius',                       '0',     '0',     '0',     '0');
reg('radius.sm',   'Small radius (buttons, inputs)',          '3px',   '3px',   '3px',   '3px');
reg('radius.md',   'Medium radius (panels, sidebar items)',   '6px',   '6px',   '6px',   '6px');
reg('radius.lg',   'Large radius (cards, menus)',             '8px',   '8px',   '8px',   '8px');
reg('radius.xl',   'Extra large radius (chat bubbles)',       '12px',  '12px',  '12px',  '12px');
reg('radius.full', 'Full radius (pills, badges)',             '999px', '999px', '999px', '999px');

// ─── Spacing ─────────────────────────────────────────────────────────────────

reg('spacing.1',  '4px spacing unit',  '4px',  '4px',  '4px',  '4px');
reg('spacing.2',  '8px spacing unit',  '8px',  '8px',  '8px',  '8px');
reg('spacing.3',  '12px spacing unit', '12px', '12px', '12px', '12px');
reg('spacing.4',  '16px spacing unit', '16px', '16px', '16px', '16px');
reg('spacing.6',  '24px spacing unit', '24px', '24px', '24px', '24px');
reg('spacing.8',  '32px spacing unit', '32px', '32px', '32px', '32px');
reg('spacing.12', '48px spacing unit', '48px', '48px', '48px', '48px');
reg('spacing.16', '64px spacing unit', '64px', '64px', '64px', '64px');

// ─── Shadow ──────────────────────────────────────────────────────────────────

reg('shadow.sm',
  'Small shadow (tooltips, dropdowns)',
  '0 1px 3px rgba(0,0,0,0.3)',
  '0 1px 3px rgba(0,0,0,0.12)',
  '0 1px 3px rgba(0,0,0,0.4)',
  '0 1px 3px rgba(0,0,0,0.12)',
);

reg('shadow.md',
  'Medium shadow (menus, floating widgets)',
  '0 2px 8px rgba(0,0,0,0.36)',
  '0 2px 8px rgba(0,0,0,0.16)',
  '0 2px 8px rgba(0,0,0,0.5)',
  '0 2px 8px rgba(0,0,0,0.16)',
);

reg('shadow.lg',
  'Large shadow (dialogs, panels)',
  '0 4px 16px rgba(0,0,0,0.5)',
  '0 4px 16px rgba(0,0,0,0.2)',
  '0 4px 16px rgba(0,0,0,0.6)',
  '0 4px 16px rgba(0,0,0,0.2)',
);

// ─── Icon Size ───────────────────────────────────────────────────────────────

reg('icon.size.xs', 'Extra small icons (inline indicators)',  '14px', '14px', '14px', '14px');
reg('icon.size.sm', 'Small icons (tree items, badges)',       '16px', '16px', '16px', '16px');
reg('icon.size.md', 'Medium icons (action buttons)',          '18px', '18px', '18px', '18px');
reg('icon.size.lg', 'Large icons (activity bar, toolbar)',    '24px', '24px', '24px', '24px');
reg('icon.size.xl', 'Extra large icons (empty states)',       '32px', '32px', '32px', '32px');
