// manifest.ts — the Chat tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const CHAT_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.chat',
  required: true,
  name: 'Chat',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'AI Chat: local language model conversations powered by Ollama.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      // chat.switchMode and chat.selectModel are EXCLUDED (AI-settings
      // mutation policy — the AI must not steer its own invocation policy).
      // chat.show is NOT in the manifest; it's registered at runtime by
      // main.ts. Annotated there via the bridge if/when needed.
      { id: 'chat.toggle', title: 'Chat: Toggle Chat Panel',
        aiInvocable: true, aiDescription: 'Show or hide the chat view.' },
      { id: 'chat.show', title: 'Chat: Show',
        aiInvocable: true, aiDescription: 'Reveal the chat view (showing it first if hidden).' },
      { id: 'chat.newSession', title: 'Chat: New Session',
        aiInvocable: true, aiDescription: 'Start a new chat session.' },
      { id: 'chat.clearSession', title: 'Chat: Clear Session',
        aiInvocable: true, aiDescription: 'Clear the current chat session messages.' },
      { id: 'chat.stop', title: 'Chat: Stop Response',
        aiInvocable: true, aiDescription: 'Stop the current AI generation.' },
      { id: 'chat.focus', title: 'Chat: Focus Input',
        aiInvocable: true, aiDescription: 'Move focus into the chat input.' },
      // deliberately NOT aiInvocable — the model has plan_update
      // {clear:true}; this is the USER's escape hatch for stale plans.
      { id: 'chat.clearPlan', title: 'Chat: Clear Plan' },
    ],
    keybindings: [
      { command: 'chat.toggle', key: 'Ctrl+Shift+I' },
      { command: 'chat.focus', key: 'Ctrl+L' },
    ],
    viewContainers: [
      { id: 'chat-container', title: 'Chat', icon: 'px-ai-mark', location: 'auxiliaryBar' as const },
    ],
    views: [
      { id: 'view.chat', name: 'Chat', defaultContainerId: 'chat-container' },
    ],
    // Live chat.* keys the runtime reads (main.ts). Built-ins load from THIS
    // manifest, not parallx-manifest.json — these keys were declared only
    // there and therefore registered NOWHERE: stuck at their hardcoded
    // fallbacks and invisible in Settings. Deliberately EXCLUDED:
    // chat.defaultModel / chat.contextLength (legacy fallbacks superseded by
    // the unified AI config — registering them would duplicate the Model
    // section) and chat.agent.* (superseded by the permission model).
    configuration: [
      {
        title: 'Chat',
        properties: {
          'chat.ollama.baseUrl': {
            type: 'string',
            default: 'http://localhost:11434',
            description: 'Ollama server URL.',
          },
          'chat.defaultMode': {
            type: 'string',
            default: 'agent',
            description: 'Chat mode a new session starts in.',
            enum: ['ask', 'edit', 'agent'],
          },
          'chat.fontSize': {
            type: 'number',
            default: 13,
            description: 'Chat message font size in pixels.',
          },
          'chat.fontFamily': {
            type: 'string',
            default: '',
            description: 'Chat message font family (empty = app font).',
          },
        },
      },
    ],
  },
};
