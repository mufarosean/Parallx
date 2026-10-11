# services

Service interfaces and implementations. `serviceTypes.ts` declares the
interfaces and service ids the app wires through dependency injection;
the implementations sit beside it, one per file: files, editors, layout,
settings (`settingsRegistryService.ts`), indexing and search
(`indexingPipeline.ts`, `vectorStoreService.ts`, `retrievalService.ts`),
embeddings and language models, agents and autonomy, policies.

`localTime.ts` and `keybindingUtils.ts` are utilities on their way to
`platform`; new utilities go there, not here.

May import: anything below the tools and the workbench.
May not import: a built-in tool, the workbench.
