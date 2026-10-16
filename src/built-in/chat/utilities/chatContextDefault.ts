// chatContextDefault.ts — the context size a chat runs at. A chat's own size
// (picked in the chat) wins; a chat without one runs at the workspace's default
// for new chats (Settings › Model, model.contextSize); without that, 0, which
// the provider reads as the model's own length.

export function chatContextSize(own: number | undefined, workspaceDefault: number | undefined): number {
  const pick = Math.max(0, Math.floor(own ?? 0));
  return pick || Math.max(0, Math.floor(workspaceDefault ?? 0));
}
