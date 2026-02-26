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
//   - relations/relationResolver.ts
//   - relations/rollupEngine.ts
//   - properties/formulaEngine.ts
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

export type { OpenEditorFn } from './databaseTypes.js';

export { ViewTabBar } from './views/viewTabBar.js';

export { BoardView } from './views/boardView.js';

export { ListView } from './views/listView.js';

export { GalleryView } from './views/galleryView.js';

export { CalendarView } from './views/calendarView.js';

export { TimelineView } from './views/timelineView.js';

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

// ─── Relations & Rollups ─────────────────────────────────────────────────────

export {
  resolveRelation,
  getRelationCandidates,
  addRelationLink,
  removeRelationLink,
  toggleRelationLink,
  createReciprocalRelation,
  syncReciprocal,
  setRelationWithSync,
  isSelfRelation,
  getSelfRelationCandidates,
} from './relations/relationResolver.js';
export type { IResolvedRelation, IRelationCandidate } from './relations/relationResolver.js';

export {
  evaluateRollupFunction,
  computeRollup,
  computeRollups,
  rollupResultToPropertyValue,
} from './relations/rollupEngine.js';
export type { RollupFunction, IRollupResult } from './relations/rollupEngine.js';

// ─── Relation editor candidate type re-export ────────────────────────────────

export type { IRelationCandidate as IRelationEditorCandidate } from './properties/propertyEditors.js';

// ─── Rendering individual renderers ──────────────────────────────────────────

export {
  renderRelation,
  renderRollup,
  renderFormula,
} from './properties/propertyRenderers.js';

// ─── Formula Engine ──────────────────────────────────────────────────────────

export {
  tokenize,
  parse as parseFormulaAST,
  evaluate as evaluateFormulaAST,
  buildPropertyResolver,
  evaluateFormula,
  parseFormula,
  inferOutputType,
  extractPropReferences,
  FormulaError,
} from './properties/formulaEngine.js';
export type {
  IToken,
  TokenType,
  ASTExpression,
  ASTNodeType,
  FormulaOutputType,
  IFormulaResult,
  PropertyResolver,
} from './properties/formulaEngine.js';
