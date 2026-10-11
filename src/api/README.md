# api

The `parallx.*` API a tool sees. `apiFactory.ts` builds it per tool;
`parallx.d.ts` is the public type; `bridges/` has one file per namespace
(`fileSystemBridge`, `chatBridge`, `languageModelBridge`, `canvasBlocksBridge`,
`dashboardBridge`, `mcpBridge`, ...) connecting calls to the services;
`notificationService.ts` shows toasts, input boxes and quick picks.

May import: `platform`, `ui`, `layout`, `views`, `editor`, `commands`,
`context`, `configuration`, service interfaces.
