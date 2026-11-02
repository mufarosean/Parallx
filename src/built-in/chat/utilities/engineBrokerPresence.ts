// engineBrokerPresence.ts — what the model engine broker learns from you.
// Typing in a chat box: you are about to send, so queued background work
// stays still a moment longer.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type { IModelEngineBroker } from '../../../services/modelEngineBroker.js';

export function wireEngineBrokerPresence(broker: Pick<IModelEngineBroker, 'noteUserActivity'>): IDisposable {
  const onInput = (e: Event) => {
    const t = e.target as Element | null;
    if (t?.classList?.contains('parallx-chat-input-textarea')) broker.noteUserActivity();
  };
  document.addEventListener('input', onInput, true);
  return { dispose: () => document.removeEventListener('input', onInput, true) };
}
