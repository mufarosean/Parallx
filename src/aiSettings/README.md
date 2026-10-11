# aiSettings

The AI configuration and its settings panel. `unifiedAIConfigService.ts`
keeps presets and profiles (`unifiedConfigTypes.ts` is their shape;
`'unified-ai.presets'` and `implementation: 'openclaw'` are persisted
values, never renamed); `ui/` is the panel and its sections.

May import: `platform`, `ui`, `services`.
