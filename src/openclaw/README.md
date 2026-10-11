# openclaw

The chat runtime (the name is the project it was modelled on). A turn
runs through `openclawTurnRunner.ts` (retries, compaction) and
`openclawAttempt.ts` (streams the model, runs tools); `openclawContextEngine.ts`
assembles the prompt; `participants/` are the entry points (default, canvas,
workspace); `commands/` are the slash commands, one file each; `mcp/`
connects MCP servers; `openclawCronService.ts` and `openclawHeartbeatRunner.ts`
run routines; `mind/` is the agent's persistent model; `agents/` the
sub-agent registry.

May import: `platform`, `services`, `agent`.
May not import: a built-in tool, the workbench.
