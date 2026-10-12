# built-in

The 18 first-party tools, one folder each, with `main.ts` as the
activation and `manifest.ts` as the manifest; those with `required: true`
are always on, the rest can be turned off.

Everything a tool adds goes through `api.*` while it runs: editors, views,
commands, menus, settings, page blocks, dashboard widgets, AI tools.

May import: the layers below, service interfaces.
May not import: another built-in, the workbench. Two tools that need each
other go through a contribution point.
