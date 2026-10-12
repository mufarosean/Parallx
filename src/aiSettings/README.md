# aiSettings

The AI configuration and its settings panel. `unifiedAIConfigService.ts`
keeps the global AI settings and each workspace's overrides
(`unifiedConfigTypes.ts` is their shape; `'unified-ai.config'`, the
`'unified-ai.presets'` it was read from once, and
`implementation: 'openclaw'` are persisted values, never renamed); `ui/`
is the panel and its sections.

May import: `platform`, `ui`, `services`.
