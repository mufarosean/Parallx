// commandService.ts — ICommandService interface + implementation//
// This module re-exports the CommandService implementation so it can be
// instantiated during workbench service registration (Phase 1).

export { CommandService } from '../commands/commandRegistry.js';