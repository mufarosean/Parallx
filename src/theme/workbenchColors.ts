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

reg('foreground',                      'Default foreground color',                       '#cccccc', '#3b3b3b', '#ffffff', '#292929');
reg('focusBorder',                     'Border color for focused elements',              '#0078d4', '#0090f1', '#f38518', '#0090f1');
reg('widget.shadow',                   'Shadow for widgets (dropdowns, dialogs)',         '#0000005c', 'rgba(0, 0, 0, 0.16)', 'rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.16)');
reg('selection.background',            'Background of selected/highlighted items',        '#264f78', '#add6ff', '#f38518', '#0060c0');
reg('descriptionForeground',           'Foreground for descriptions/secondary text',     '#9d9d9d', '#717171', '#ffffff', '#292929');
reg('icon.foreground',                 'Default icon foreground',                         '#cccccc', '#424242', '#ffffff', '#292929');
reg('errorForeground',                 'Foreground for error text',                       '#f85149', '#a1260d', '#f48771', '#a1260d');
reg('sash.hoverBorder',                'Sash/resize handle on hover',                    '#0078d4', '#0078d4', '#6fc3df', '#0078d4');
reg('toolbar.hoverBackground',         'Toolbar item hover background',                  'rgba(90, 93, 94, 0.31)', 'rgba(0, 0, 0, 0.08)', 'rgba(255, 255, 255, 0.1)', 'rgba(0, 0, 0, 0.08)');

// ─── Titlebar ────────────────────────────────────────────────────────────────

reg('titleBar.activeBackground',       'Titlebar background (active window)',            '#181818', '#dddddd', '#000000', '#ffffff');
reg('titleBar.activeForeground',       'Titlebar foreground (active window)',            '#cccccc', '#333333', '#ffffff', '#292929');
reg('titleBar.inactiveBackground',     'Titlebar background (inactive window)',          '#181818', '#dddddd', '#000000', '#ffffff');
reg('titleBar.inactiveForeground',     'Titlebar foreground (inactive window)',          '#9d9d9d', 'rgba(51, 51, 51, 0.6)', 'rgba(255, 255, 255, 0.5)', 'rgba(41, 41, 41, 0.6)');

// ─── Menu ────────────────────────────────────────────────────────────────────

reg('menu.foreground',                 'Menu item foreground',                           '#cccccc', '#616161', '#ffffff', '#292929');
reg('menu.background',                 'Menu/dropdown background',                       '#1f1f1f', '#ffffff', '#000000', '#ffffff');
reg('menu.selectionBackground',        'Menu item hover/selection',                      '#0078d4', '#e8e8e8', '#0f4a85', '#b8d6ed');
reg('menu.selectionForeground',        'Menu item selection foreground',                 '#ffffff', '#333333', '#ffffff', '#292929');
reg('menu.border',                     'Menu border',                                    '#454545', '#d4d4d4', '#6fc3df', '#cecece');
reg('menu.separatorBackground',        'Menu separator color',                           '#454545', 'rgba(0, 0, 0, 0.1)', '#6fc3df', '#cecece');

// ─── Activity Bar ────────────────────────────────────────────────────────────

reg('activityBar.background',           'Activity bar background',                       '#181818', '#2c2c2c', '#000000', '#ffffff');
reg('activityBar.foreground',           'Active icon foreground',                        '#d7d7d7', '#ffffff', '#ffffff', '#292929');
reg('activityBar.inactiveForeground',   'Inactive icon foreground',                      '#868686', 'rgba(255, 255, 255, 0.4)', 'rgba(255, 255, 255, 0.4)', 'rgba(41, 41, 41, 0.4)');
reg('activityBar.border',               'Activity bar right border',                     '#2b2b2b', '#e0e0e0', '#6fc3df', '#cecece');
reg('activityBar.activeBorder',         'Active item indicator border',                   '#0078d4', '#333333', '#f38518', '#292929');
reg('activityBarBadge.background',      'Badge background',                              '#0078d4', '#007acc', '#007acc', '#007acc');
reg('activityBarBadge.foreground',      'Badge foreground',                              '#ffffff', '#ffffff', '#ffffff', '#ffffff');

// ─── Sidebar ─────────────────────────────────────────────────────────────────

reg('sideBar.background',               'Sidebar background',                            '#181818', '#f3f3f3', '#000000', '#ffffff');
reg('sideBar.foreground',               'Sidebar foreground',                            '#cccccc', '#616161', '#ffffff', '#292929');
reg('sideBar.border',                   'Sidebar border',                                '#2b2b2b', '#e0e0e0', '#6fc3df', '#cecece');
reg('sideBarTitle.foreground',           'Sidebar title text',                           '#cccccc', '#6f6f6f', '#ffffff', '#292929');
reg('sideBarSectionHeader.background',   'Section header background',                   '#181818', '#f3f3f3', '#000000', '#ffffff');
reg('sideBarSectionHeader.foreground',   'Section header foreground',                   '#cccccc', '#616161', '#ffffff', '#292929');
reg('sideBarSectionHeader.border',       'Section header border',                       '#2b2b2b', '#cccccc', '#6fc3df', '#cecece');

// ─── Editor / Editor Groups ──────────────────────────────────────────────────

reg('editor.background',                'Editor background',                             '#1f1f1f', '#ffffff', '#000000', '#ffffff');
reg('editor.foreground',                'Editor foreground',                             '#cccccc', '#333333', '#ffffff', '#292929');
reg('editorGroupHeader.tabsBackground',  'Editor tab bar background',                   '#181818', '#f3f3f3', '#000000', '#ffffff');
reg('editorGroupHeader.tabsBorder',      'Editor tab bar bottom border',                '#2b2b2b', '#f3f3f3', '#000000', '#ffffff');
reg('tab.activeBackground',             'Active tab background',                         '#1f1f1f', '#ffffff', '#000000', '#ffffff');
reg('tab.activeForeground',             'Active tab foreground',                         '#ffffff', '#333333', '#ffffff', '#292929');
reg('tab.activeBorderTop',              'Active tab top accent border',                  '#0078d4', 'transparent', '#f38518', 'transparent');
reg('tab.activeBorder',                 'Active tab bottom border',                      '#1f1f1f', '#f3f3f3', '#f38518', '#b8d6ed');
reg('tab.inactiveBackground',           'Inactive tab background',                       '#181818', '#ececec', '#000000', '#ffffff');
reg('tab.inactiveForeground',           'Inactive tab foreground',                       '#9d9d9d', '#999999', 'rgba(255, 255, 255, 0.5)', '#292929');
reg('tab.border',                       'Tab right separator border',                    '#2b2b2b', '#f3f3f3', '#6fc3df', '#cecece');
reg('tab.modifiedBorder',               'Dirty indicator on modified tabs',              '#bb800966', '#333333', '#ffffff', '#292929');
reg('tab.hoverBackground',              'Tab hover background',                          '#1f1f1f', 'rgba(0, 0, 0, 0.04)', 'rgba(255, 255, 255, 0.1)', 'rgba(0, 0, 0, 0.04)');

// ─── Panel ───────────────────────────────────────────────────────────────────

reg('panel.background',                 'Panel background',                              '#181818', '#ffffff', '#000000', '#ffffff');
reg('panel.border',                     'Panel top border',                              '#2b2b2b', '#e0e0e0', '#6fc3df', '#cecece');
reg('panelTitle.activeForeground',       'Active panel tab foreground',                  '#cccccc', '#333333', '#ffffff', '#292929');
reg('panelTitle.inactiveForeground',     'Inactive panel tab foreground',                '#9d9d9d', '#999999', 'rgba(255, 255, 255, 0.5)', '#292929');
reg('panelTitle.activeBorder',           'Active panel tab bottom border',               '#0078d4', '#333333', '#f38518', '#292929');

// ─── Auxiliary Bar ───────────────────────────────────────────────────────────

reg('auxiliaryBar.background',           'Auxiliary sidebar background',                  '#181818', '#f3f3f3', '#000000', '#ffffff');
reg('auxiliaryBar.border',               'Auxiliary sidebar border',                      '#2b2b2b', '#e0e0e0', '#6fc3df', '#cecece');
reg('auxiliaryBar.headerForeground',     'Auxiliary bar header text',                    '#cccccc', '#6f6f6f', '#ffffff', '#292929');

// ─── Status Bar ──────────────────────────────────────────────────────────────

reg('statusBar.background',             'Status bar background',                         '#181818', '#007acc', '#000000', '#ffffff');
reg('statusBar.foreground',             'Status bar foreground',                         '#cccccc', '#ffffff', '#ffffff', '#292929');
reg('statusBarItem.hoverBackground',     'Status bar item hover',                        'rgba(90, 93, 94, 0.31)', 'rgba(255, 255, 255, 0.12)', 'rgba(255, 255, 255, 0.12)', 'rgba(0, 0, 0, 0.08)');
reg('statusBarItem.hoverForeground',     'Status bar item hover foreground',             'inherit', 'inherit', 'inherit', 'inherit');
reg('statusBarItem.activeBackground',    'Status bar item active/pressed',               'rgba(90, 93, 94, 0.45)', 'rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.18)', 'rgba(0, 0, 0, 0.12)');

// ─── Lists and Trees ─────────────────────────────────────────────────────────

reg('list.hoverBackground',             'List/tree item hover',                          '#2a2d2e', 'rgba(0, 0, 0, 0.04)', 'rgba(255, 255, 255, 0.08)', 'rgba(0, 0, 0, 0.04)');
reg('list.activeSelectionBackground',    'Selected item background',                     '#37373d', '#e8e8e8', '#0f4a85', '#b8d6ed');
reg('list.activeSelectionForeground',    'Selected item foreground',                     '#ffffff', '#333333', '#ffffff', '#292929');
reg('list.focusOutline',                 'Focus border for list items',                  '#0078d4', '#007acc', '#f38518', '#007acc');

// ─── Inputs ──────────────────────────────────────────────────────────────────

reg('input.background',                 'Text input background',                         '#313131', '#ffffff', '#000000', '#ffffff');
reg('input.foreground',                 'Text input foreground',                         '#cccccc', '#616161', '#ffffff', '#292929');
reg('input.border',                     'Text input border',                             '#3c3c3c', '#cecece', '#6fc3df', '#cecece');
reg('input.placeholderForeground',       'Placeholder text color',                       '#9d9d9d', '#a0a0a0', '#9d9d9d', '#a0a0a0');

// ─── Buttons ─────────────────────────────────────────────────────────────────

reg('button.background',                'Primary button background',                     '#0078d4', '#007acc', '#000000', '#007acc');
reg('button.foreground',                'Primary button foreground',                     '#ffffff', '#ffffff', '#ffffff', '#ffffff');
reg('button.hoverBackground',           'Primary button hover',                          '#026ec1', '#0062a3', '#0f4a85', '#0062a3');
reg('button.secondaryBackground',       'Secondary button background',                  '#313131', '#e0e0e0', '#313131', '#e0e0e0');
reg('button.secondaryForeground',       'Secondary button foreground',                  '#cccccc', '#333333', '#ffffff', '#292929');
reg('button.secondaryHoverBackground',   'Secondary button hover',                       '#3c3c3c', '#cccccc', '#3c3c3c', '#cccccc');

// ─── Notifications ───────────────────────────────────────────────────────────

reg('notifications.background',          'Notification toast background',                '#1f1f1f', '#ffffff', '#000000', '#ffffff');
reg('notifications.foreground',          'Notification text color',                      '#cccccc', '#616161', '#ffffff', '#292929');
reg('notifications.border',             'Notification border',                           '#2b2b2b', '#e0e0e0', '#6fc3df', '#cecece');
reg('notificationToast.border',          'Notification toast outer border',              '#2b2b2b', '#e0e0e0', '#6fc3df', '#cecece');
reg('notificationLink.foreground',       'Notification link color',                      '#2aaaff', '#006ab1', '#2aaaff', '#006ab1');
reg('notificationsInfoIcon.foreground',  'Info icon color',                              '#2aaaff', '#1a85ff', '#2aaaff', '#1a85ff');
reg('notificationsWarningIcon.foreground','Warning icon color',                           '#cca700', '#bf8803', '#cca700', '#bf8803');
reg('notificationsErrorIcon.foreground', 'Error icon color',                             '#f85149', '#a1260d', '#f85149', '#a1260d');

// ─── Quick Access ────────────────────────────────────────────────────────────

reg('quickInput.background',             'Quick access background',                      '#222222', '#ffffff', '#000000', '#ffffff');
reg('quickInput.foreground',             'Quick access text',                             '#cccccc', '#616161', '#ffffff', '#292929');
reg('quickInputList.focusBackground',    'Focused item in quick access',                 '#0078d4', '#e8e8e8', '#0f4a85', '#b8d6ed');
reg('quickInputTitle.background',        'Quick access header background',               '#2b2b2b', '#e0e0e0', '#000000', '#ffffff');

// ─── Drop Targets ────────────────────────────────────────────────────────────

reg('editorGroup.dropBackground',        'Editor group drop overlay',                    'rgba(0, 120, 212, 0.18)', 'rgba(0, 120, 212, 0.18)', 'rgba(0, 120, 212, 0.18)', 'rgba(0, 120, 212, 0.18)');
reg('editorGroup.dropBorder',            'Editor group drop border',                     'rgba(0, 120, 212, 0.5)', 'rgba(0, 120, 212, 0.5)', 'rgba(0, 120, 212, 0.5)', 'rgba(0, 120, 212, 0.5)');

// ─── Links ───────────────────────────────────────────────────────────────────

reg('textLink.foreground',              'Link color',                                    '#2aaaff', '#006ab1', '#2aaaff', '#006ab1');
reg('textLink.activeForeground',        'Active/hovered link color',                     '#2aaaff', '#006ab1', '#2aaaff', '#006ab1');

// ─── Scrollbar ───────────────────────────────────────────────────────────────

reg('scrollbar.shadow',                  'Scrollbar shadow on scroll',                    '#000000', 'rgba(0, 0, 0, 0.2)', 'rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.2)');

// ─── Window close button (platform convention — not theme-switchable) ────────
// Note: #e81123 for close-button hover is kept as a hardcoded CSS value
// because it is a Windows platform convention, not a theme color.
