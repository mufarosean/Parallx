// index.ts — barrel export for src/ui/ component library
//
// All reusable UI primitives are exported from here.
// Feature code should import from 'ui/index.js' or specific component files.

// DOM utilities
export { $, append, clearNode, addDisposableListener, hide, show, toggleClass, isAncestorOfActiveElement } from './dom.js';

// Components
export { Button, type IButtonOptions } from './button.js';
export { InputBox, type IInputBoxOptions } from './inputBox.js';
export { TabBar, type ITabBarItem, type ITabBarOptions, type TabReorderEvent } from './tabBar.js';
export { Overlay, type IOverlayOptions } from './overlay.js';
export { FilterableList, type IListItem, type IFilterableListOptions } from './list.js';
export { ActionBar, type IAction } from './actionBar.js';
export { CountBadge, type ICountBadgeOptions } from './countBadge.js';
export { ContextMenu, type IContextMenuItem, type IContextMenuAnchor, type IContextMenuOptions, type IContextMenuSelectEvent } from './contextMenu.js';
