// engineBrokerPresence.ts — what the model engine broker learns from you.
// Typing in a chat box: you are about to send, so queued background work
// stays still a moment longer. Any key or press anywhere: you are here, so a
// model call made now is one you wait on (it may pause background work; one
// made while you are away does not).

import type { IDisposable } from '../../../platform/lifecycle.js';
import type { IModelEngineBroker } from '../../../services/modelEngineBroker.js';

export function wireEngineBrokerPresence(broker: Pick<IModelEngineBroker, 'noteUserActivity' | 'noteUserInput'>): IDisposable {
  const onInput = (e: Event) => {
    const t = e.target as Element | null;
    if (t?.classList?.contains('parallx-chat-input-textarea')) broker.noteUserActivity();
  };
  const onPresence = () => broker.noteUserInput();
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onPresence, { capture: true, passive: true });
  document.addEventListener('pointerdown', onPresence, { capture: true, passive: true });
  return {
    dispose: () => {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onPresence, true);
      document.removeEventListener('pointerdown', onPresence, true);
    },
  };
}
