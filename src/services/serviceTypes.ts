// serviceTypes.ts — every service interface, in one import.
//
// The interfaces live in services/types/, one file per area; this file
// re-exports them all, so the many importers of '../services/serviceTypes.js'
// read as before. A new interface goes in the area it belongs to.

export * from './types/shell.js';
export * from './types/workspace.js';
export * from './types/agents.js';
export * from './types/editors.js';
export * from './types/commands.js';
export * from './types/tools.js';
export * from './types/knowledge.js';
export * from './types/ai.js';
