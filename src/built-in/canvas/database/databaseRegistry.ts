// databaseRegistry.ts — Single import gate for the database subsystem
//
// Every file inside database/ imports ONLY from this registry.
// The registry uses live `export { X } from '...'` re-export syntax
// so that circular module references resolve safely at runtime
// (the same pattern used by BlockRegistry ↔ BlockStateRegistry).
//
// Source files (NOT gated, registry imports FROM them):
//   - databaseTypes.ts    — type definitions
//   - databaseDataService.ts — service implementation (exempt)
//
// Gated children (import ONLY from this registry):
//   - properties/propertyRenderers.ts
//   - properties/propertyEditors.ts
//   - properties/propertyConfig.ts
//   - views/tableView.ts
//   - views/viewTabBar.ts
//   - databaseEditorProvider.ts

// ─── Types from databaseTypes ────────────────────────────────────────────────

export type {
  PropertyType,
  ISelectOption,
  IStatusGroup,
  IRichTextSegment,
  IFileReference,
  IPropertyValue,
  INumberPropertyConfig,
  ISelectPropertyConfig,
  IMultiSelectPropertyConfig,
  IStatusPropertyConfig,
  IRelationPropertyConfig,
  IRollupPropertyConfig,
  IFormulaPropertyConfig,
  IUniqueIdPropertyConfig,
  PropertyConfig,
  IDatabase,
  IDatabaseProperty,
  IDatabaseRow,
  ViewType,
  IDatabaseViewColumns,
  IDatabaseViewConfig,
  IDatabaseView,
  FilterOperator,
  IFilterRule,
  IFilterGroup,
  ISortRule,
  IColorRule,
  DatabaseUpdateData,
  PropertyUpdateData,
  ViewUpdateData,
  IDatabaseDataService,
  DatabaseChangeEvent,
  PropertyChangeEvent,
  RowChangeEvent,
  ViewChangeEvent,
} from './databaseTypes.js';

export {
  DatabaseChangeKind,
  FILTER_OPERATORS_BY_TYPE,
} from './databaseTypes.js';

// ─── Property rendering ─────────────────────────────────────────────────────

export { renderPropertyValue } from './properties/propertyRenderers.js';

// ─── Property editing ────────────────────────────────────────────────────────

export { createPropertyEditor } from './properties/propertyEditors.js';
export type { IPropertyEditor } from './properties/propertyEditors.js';

// ─── Property configuration UI ──────────────────────────────────────────────

export {
  showPropertyAddMenu,
  showPropertyHeaderMenu,
  startPropertyRename,
  showNumberFormatMenu,
  showOptionListEditor,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_ICONS,
} from './properties/propertyConfig.js';

// ─── Views ───────────────────────────────────────────────────────────────────

export { TableView } from './views/tableView.js';
export type { OpenEditorFn } from './views/tableView.js';

export { ViewTabBar } from './views/viewTabBar.js';

export { BoardView } from './views/boardView.js';

export { DatabaseToolbar } from './views/databaseToolbar.js';

// ─── Filters ─────────────────────────────────────────────────────────────────

export {
  evaluateFilter,
  applySorts,
  groupRows,
  applyViewDataPipeline,
} from './filters/filterEngine.js';
export type { IRowGroup } from './filters/filterEngine.js';

export { FilterPanel } from './filters/filterUI.js';
