// localTime.ts — kept so the sixty importers of the old path keep working.
//
// The clock lives in src/platform/localTime.ts now (it depends on nothing, and
// src/ui needs it too). New code imports it from there.

export * from '../platform/localTime.js';
