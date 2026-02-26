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
//   - polish/databaseTemplateService.ts
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
  IDatabaseTemplate,
  TemplatePropertyValue,
  TemplateDynamicValue,
  IViewDefaultTemplate,
  PropertyVisibility,
} from './databaseTypes.js';

export type { ICanvasDataService } from '../canvasTypes.js';

export {
  PageChromeController,
} from '../header/pageChrome.js';
export type {
  PageChromeHost,
  PageChromeOptions,
} from '../header/pageChrome.js';

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

// ─── View Host (shared engine) ───────────────────────────────────────────────

export { DatabaseViewHost } from './databaseViewHost.js';
export type { DatabaseViewHostSlots, DatabaseViewHostOptions } from './databaseViewHost.js';

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

// ─── Icon Access (gate-to-gate: databaseRegistry → iconRegistry) ─────────────
// Database children get icon functions through this gate instead of reaching
// into iconRegistry or blockRegistry directly.

import {
  svgIcon as _ir_svgIcon,
  PAGE_SELECTABLE_ICONS as _ir_PAGE_SELECTABLE_ICONS,
} from '../config/iconRegistry.js';

/** Get the raw SVG string for an icon ID (delegates to IconRegistry). */
export const svgIcon: (id: string) => string = _ir_svgIcon;
export const PAGE_SELECTABLE_ICONS: readonly string[] = _ir_PAGE_SELECTABLE_ICONS;

// ─── Templates, Color Rules, Locking, Unique ID, Visibility ─────────────────

export {
  resolveTemplateValue,
  applyTemplate,
  selectTemplate,
  createTemplate,
  evaluateColorRules,
  colorRuleToStyle,
  isDatabaseLocked,
  isViewLocked,
  assertDatabaseNotLocked,
  assertViewNotLocked,
  computeNextUniqueId,
  makeUniqueIdValue,
  formatUniqueId,
  isPropertyVisibleOnPage,
  getPropertyBarData,
} from './polish/databaseTemplateService.js';
