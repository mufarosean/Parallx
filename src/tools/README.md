# tools

The extension host. `toolManifest.ts` and `parallx-manifest.schema.json`
define a manifest; `toolValidator.ts` checks one; `toolScanner.ts` finds
extensions on disk; `toolModuleLoader.ts` loads one (it resolves relative
imports, so an extension may be many files); `activationEventService.ts`
decides when a tool activates; `toolActivator.ts` runs `activate()` with
`toolErrorIsolation.ts` around it; `toolRegistry.ts` and
`toolEnablementService.ts` track what is installed and turned on.
each built-in tool's manifest is `src/built-in/<tool>/manifest.ts`, listed
in `src/workbench/builtinManifests.ts`.

May import: `platform`, `api`, `configuration`, service interfaces.
