// workbenchColors.ts — registers all workbench color tokens
//
// Import this file during workbench startup to ensure all color tokens
// are registered before theme application.
//
// Token names match VS Code's workbench.colorCustomizations keys exactly.
// Dark defaults match the values previously hardcoded in workbench.css / ui.css / explorer.css.
// Light and HC defaults are best-effort for M5 — only Dark Modern ships.

import { colorRegistry } from './colorRegistry.js';

// Helper — shorthand for registering a color with all 4 theme defaults
function reg(id: string, description: string, dark: string, light: string, hcDark: string, hcLight: string): void {
  colorRegistry.registerColor(id, description, { dark, light, hcDark, hcLight });
}

// ─── Core / Shared ───────────────────────────────────────────────────────────

reg('foreground',                      'Default foreground color',                       '#cccccc', '#616161', '#ffffff', '#292929');
reg('focusBorder',                     'Border color for focused elements',              '#007fd4', '#0090f1', '#f38518', '#0090f1');
reg('widget.shadow',                   'Shadow for widgets (dropdowns, dialogs)',         'rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.16)', 'rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.16)');
reg('selection.background',            'Background of selected/highlighted items',        '#04395e', '#add6ff', '#f38518', '#0060c0');
reg('descriptionForeground',           'Foreground for descriptions/secondary text',     '#999999', '#717171', '#ffffff', '#292929');
reg('icon.foreground',                 'Default icon foreground',                         '#c5c5c5', '#424242', '#ffffff', '#292929');
reg('errorForeground',                 'Foreground for error text',                       '#f14c4c', '#a1260d', '#f48771', '#a1260d');
reg('sash.hoverBorder',                'Sash/resize handle on hover',                    '#007acc', '#007acc', '#6fc3df', '#007acc');
reg('toolbar.hoverBackground',         'Toolbar item hover background',                  'rgba(255, 255, 255, 0.1)', 'rgba(0, 0, 0, 0.08)', 'rgba(255, 255, 255, 0.1)', 'rgba(0, 0, 0, 0.08)');

// ─── Titlebar ────────────────────────────────────────────────────────────────

reg('titleBar.activeBackground',       'Titlebar background (active window)',            '#323233', '#dddddd', '#000000', '#ffffff');
reg('titleBar.activeForeground',       'Titlebar foreground (active window)',            'rgba(255, 255, 255, 0.7)', '#333333', '#ffffff', '#292929');
reg('titleBar.inactiveBackground',     'Titlebar background (inactive window)',          '#323233', '#dddddd', '#000000', '#ffffff');
reg('titleBar.inactiveForeground',     'Titlebar foreground (inactive window)',          'rgba(255, 255, 255, 0.5)', 'rgba(51, 51, 51, 0.6)', 'rgba(255, 255, 255, 0.5)', 'rgba(41, 41, 41, 0.6)');

// ─── Menu ────────────────────────────────────────────────────────────────────

reg('menu.foreground',                 'Menu item foreground',                           '#cccccc', '#616161', '#ffffff', '#292929');
reg('menu.background',                 'Menu/dropdown background',                       '#252526', '#ffffff', '#000000', '#ffffff');
reg('menu.selectionBackground',        'Menu item hover/selection',                      '#04395e', '#e8e8e8', '#0f4a85', '#b8d6ed');
reg('menu.selectionForeground',        'Menu item selection foreground',                 '#ffffff', '#333333', '#ffffff', '#292929');
reg('menu.border',                     'Menu border',                                    '#454545', '#d4d4d4', '#6fc3df', '#cecece');
reg('menu.separatorBackground',        'Menu separator color',                           'rgba(255, 255, 255, 0.1)', 'rgba(0, 0, 0, 0.1)', '#6fc3df', '#cecece');

// ─── Activity Bar ────────────────────────────────────────────────────────────

reg('activityBar.background',           'Activity bar background',                       '#333333', '#2c2c2c', '#000000', '#ffffff');
reg('activityBar.foreground',           'Active icon foreground',                        '#ffffff', '#ffffff', '#ffffff', '#292929');
reg('activityBar.inactiveForeground',   'Inactive icon foreground',                      'rgba(255, 255, 255, 0.4)', 'rgba(255, 255, 255, 0.4)', 'rgba(255, 255, 255, 0.4)', 'rgba(41, 41, 41, 0.4)');
reg('activityBar.border',               'Activity bar right border',                     '#3c3c3c', '#e0e0e0', '#6fc3df', '#cecece');
reg('activityBar.activeBorder',         'Active item indicator border',                   '#ffffff', '#333333', '#f38518', '#292929');
reg('activityBarBadge.background',      'Badge background',                              '#007acc', '#007acc', '#007acc', '#007acc');
reg('activityBarBadge.foreground',      'Badge foreground',                              '#ffffff', '#ffffff', '#ffffff', '#ffffff');

// ─── Sidebar ─────────────────────────────────────────────────────────────────

reg('sideBar.background',               'Sidebar background',                            '#252526', '#f3f3f3', '#000000', '#ffffff');
reg('sideBar.foreground',               'Sidebar foreground',                            '#cccccc', '#616161', '#ffffff', '#292929');
reg('sideBar.border',                   'Sidebar border',                                '#3c3c3c', '#e0e0e0', '#6fc3df', '#cecece');
reg('sideBarTitle.foreground',           'Sidebar title text',                           'rgba(255, 255, 255, 0.6)', '#6f6f6f', '#ffffff', '#292929');
reg('sideBarSectionHeader.background',   'Section header background',                   '#252526', '#f3f3f3', '#000000', '#ffffff');
reg('sideBarSectionHeader.foreground',   'Section header foreground',                   '#cccccc', '#616161', '#ffffff', '#292929');
reg('sideBarSectionHeader.border',       'Section header border',                       '#3c3c3c', '#cccccc', '#6fc3df', '#cecece');

// ─── Editor / Editor Groups ──────────────────────────────────────────────────

reg('editor.background',                'Editor background',                             '#1e1e1e', '#ffffff', '#000000', '#ffffff');
reg('editor.foreground',                'Editor foreground',                             '#d4d4d4', '#333333', '#ffffff', '#292929');
reg('editorGroupHeader.tabsBackground',  'Editor tab bar background',                   '#252526', '#f3f3f3', '#000000', '#ffffff');
reg('editorGroupHeader.tabsBorder',      'Editor tab bar bottom border',                '#1e1e1e', '#f3f3f3', '#000000', '#ffffff');
reg('tab.activeBackground',             'Active tab background',                         '#1e1e1e', '#ffffff', '#000000', '#ffffff');
reg('tab.activeForeground',             'Active tab foreground',                         '#ffffff', '#333333', '#ffffff', '#292929');
reg('tab.activeBorderTop',              'Active tab top accent border',                  'transparent', 'transparent', 'transparent', 'transparent');
reg('tab.activeBorder',                 'Active tab bottom border',                      '#007acc', '#f3f3f3', '#f38518', '#b8d6ed');
reg('tab.inactiveBackground',           'Inactive tab background',                       '#2d2d2d', '#ececec', '#000000', '#ffffff');
reg('tab.inactiveForeground',           'Inactive tab foreground',                       'rgba(255, 255, 255, 0.5)', '#999999', 'rgba(255, 255, 255, 0.5)', '#292929');
reg('tab.border',                       'Tab right separator border',                    '#1e1e1e', '#f3f3f3', '#6fc3df', '#cecece');
reg('tab.modifiedBorder',               'Dirty indicator on modified tabs',              '#e8e8e8', '#333333', '#ffffff', '#292929');
reg('tab.hoverBackground',              'Tab hover background',                          'rgba(255, 255, 255, 0.05)', 'rgba(0, 0, 0, 0.04)', 'rgba(255, 255, 255, 0.1)', 'rgba(0, 0, 0, 0.04)');

// ─── Panel ───────────────────────────────────────────────────────────────────

reg('panel.background',                 'Panel background',                              '#1e1e1e', '#ffffff', '#000000', '#ffffff');
reg('panel.border',                     'Panel top border',                              '#3c3c3c', '#e0e0e0', '#6fc3df', '#cecece');
reg('panelTitle.activeForeground',       'Active panel tab foreground',                  '#ffffff', '#333333', '#ffffff', '#292929');
reg('panelTitle.inactiveForeground',     'Inactive panel tab foreground',                'rgba(255, 255, 255, 0.5)', '#999999', 'rgba(255, 255, 255, 0.5)', '#292929');
reg('panelTitle.activeBorder',           'Active panel tab bottom border',               '#007acc', '#333333', '#f38518', '#292929');

// ─── Auxiliary Bar ───────────────────────────────────────────────────────────

reg('auxiliaryBar.background',           'Auxiliary sidebar background',                  '#252526', '#f3f3f3', '#000000', '#ffffff');
reg('auxiliaryBar.border',               'Auxiliary sidebar border',                      '#3c3c3c', '#e0e0e0', '#6fc3df', '#cecece');
reg('auxiliaryBar.headerForeground',     'Auxiliary bar header text',                    'rgba(255, 255, 255, 0.6)', '#6f6f6f', '#ffffff', '#292929');

// ─── Status Bar ──────────────────────────────────────────────────────────────

reg('statusBar.background',             'Status bar background',                         '#007acc', '#007acc', '#000000', '#ffffff');
reg('statusBar.foreground',             'Status bar foreground',                         '#ffffff', '#ffffff', '#ffffff', '#292929');
reg('statusBarItem.hoverBackground',     'Status bar item hover',                        'rgba(255, 255, 255, 0.12)', 'rgba(255, 255, 255, 0.12)', 'rgba(255, 255, 255, 0.12)', 'rgba(0, 0, 0, 0.08)');
reg('statusBarItem.hoverForeground',     'Status bar item hover foreground',             'inherit', 'inherit', 'inherit', 'inherit');
reg('statusBarItem.activeBackground',    'Status bar item active/pressed',               'rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.18)', 'rgba(0, 0, 0, 0.12)');

// ─── Lists and Trees ─────────────────────────────────────────────────────────

reg('list.hoverBackground',             'List/tree item hover',                          'rgba(255, 255, 255, 0.04)', 'rgba(0, 0, 0, 0.04)', 'rgba(255, 255, 255, 0.08)', 'rgba(0, 0, 0, 0.04)');
reg('list.activeSelectionBackground',    'Selected item background',                     'rgba(255, 255, 255, 0.1)', '#e8e8e8', '#0f4a85', '#b8d6ed');
reg('list.activeSelectionForeground',    'Selected item foreground',                     '#ffffff', '#333333', '#ffffff', '#292929');
reg('list.focusOutline',                 'Focus border for list items',                  '#007acc', '#007acc', '#f38518', '#007acc');

// ─── Inputs ──────────────────────────────────────────────────────────────────

reg('input.background',                 'Text input background',                         '#3c3c3c', '#ffffff', '#000000', '#ffffff');
reg('input.foreground',                 'Text input foreground',                         '#cccccc', '#616161', '#ffffff', '#292929');
reg('input.border',                     'Text input border',                             '#474747', '#cecece', '#6fc3df', '#cecece');
reg('input.placeholderForeground',       'Placeholder text color',                       '#888888', '#a0a0a0', '#888888', '#a0a0a0');

// ─── Buttons ─────────────────────────────────────────────────────────────────

reg('button.background',                'Primary button background',                     '#0e639c', '#007acc', '#000000', '#007acc');
reg('button.foreground',                'Primary button foreground',                     '#ffffff', '#ffffff', '#ffffff', '#ffffff');
reg('button.hoverBackground',           'Primary button hover',                          '#1177bb', '#0062a3', '#0f4a85', '#0062a3');
reg('button.secondaryBackground',       'Secondary button background',                  '#3a3d41', '#e0e0e0', '#3a3d41', '#e0e0e0');
reg('button.secondaryForeground',       'Secondary button foreground',                  '#cccccc', '#333333', '#ffffff', '#292929');
reg('button.secondaryHoverBackground',   'Secondary button hover',                       '#45494e', '#cccccc', '#45494e', '#cccccc');

// ─── Notifications ───────────────────────────────────────────────────────────

reg('notifications.background',          'Notification toast background',                '#252526', '#ffffff', '#000000', '#ffffff');
reg('notifications.foreground',          'Notification text color',                      '#cccccc', '#616161', '#ffffff', '#292929');
reg('notifications.border',             'Notification border',                           '#3c3c3c', '#e0e0e0', '#6fc3df', '#cecece');
reg('notificationToast.border',          'Notification toast outer border',              '#3c3c3c', '#e0e0e0', '#6fc3df', '#cecece');
reg('notificationLink.foreground',       'Notification link color',                      '#3794ff', '#006ab1', '#3794ff', '#006ab1');
reg('notificationsInfoIcon.foreground',  'Info icon color',                              '#3794ff', '#1a85ff', '#3794ff', '#1a85ff');
reg('notificationsWarningIcon.foreground','Warning icon color',                           '#cca700', '#bf8803', '#cca700', '#bf8803');
reg('notificationsErrorIcon.foreground', 'Error icon color',                             '#f14c4c', '#a1260d', '#f14c4c', '#a1260d');

// ─── Quick Access ────────────────────────────────────────────────────────────

reg('quickInput.background',             'Quick access background',                      '#252526', '#ffffff', '#000000', '#ffffff');
reg('quickInput.foreground',             'Quick access text',                             '#cccccc', '#616161', '#ffffff', '#292929');
reg('quickInputList.focusBackground',    'Focused item in quick access',                 '#04395e', '#e8e8e8', '#0f4a85', '#b8d6ed');
reg('quickInputTitle.background',        'Quick access header background',               '#3c3c3c', '#e0e0e0', '#000000', '#ffffff');

// ─── Drop Targets ────────────────────────────────────────────────────────────

reg('editorGroup.dropBackground',        'Editor group drop overlay',                    'rgba(0, 120, 212, 0.18)', 'rgba(0, 120, 212, 0.18)', 'rgba(0, 120, 212, 0.18)', 'rgba(0, 120, 212, 0.18)');
reg('editorGroup.dropBorder',            'Editor group drop border',                     'rgba(0, 120, 212, 0.5)', 'rgba(0, 120, 212, 0.5)', 'rgba(0, 120, 212, 0.5)', 'rgba(0, 120, 212, 0.5)');

// ─── Links ───────────────────────────────────────────────────────────────────

reg('textLink.foreground',              'Link color',                                    '#3794ff', '#006ab1', '#3794ff', '#006ab1');
reg('textLink.activeForeground',        'Active/hovered link color',                     '#3794ff', '#006ab1', '#3794ff', '#006ab1');

// ─── Scrollbar ───────────────────────────────────────────────────────────────

reg('scrollbar.shadow',                  'Scrollbar shadow on scroll',                    'rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.2)', 'rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.2)');

// ─── Window close button (platform convention — not theme-switchable) ────────
// Note: #e81123 for close-button hover is kept as a hardcoded CSS value
// because it is a Windows platform convention, not a theme color.
