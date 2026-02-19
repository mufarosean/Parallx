// toolEnablement.ts — tool enablement types
//
// Defines the enablement state model for Parallx tools.
// Tools can be enabled or disabled globally. Per-workspace scoping
// is supported by the enum but not implemented until needed.
//
// VS Code reference:
//   src/vs/workbench/services/extensionManagement/common/extensionManagement.ts
//   — EnablementState enum (simplified from 8 states to 2 for M6)

export { ToolEnablementState } from './toolTypes.js';
export type { ToolEnablementChangeEvent, IToolEnablementService } from './toolTypes.js';
