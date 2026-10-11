# configuration

Settings a tool contributes through its manifest: `configurationRegistry.ts`
holds the schemas, `configurationService.ts` reads and writes values,
`toolMemento.ts` is per-tool storage with a quota.

May import: `platform`, service interfaces.
