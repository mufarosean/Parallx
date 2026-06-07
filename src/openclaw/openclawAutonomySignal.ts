// openclawAutonomySignal.ts — bridges an autonomy signal onto the heartbeat's
// system-event queue. The signal type + validation live in the service layer
// (src/services/autonomySignalService.ts); this module only knows how to turn a
// signal into a heartbeat event (so the openclaw → services dependency direction
// stays correct). Re-exports the type/normalize for existing importers.

import type { IHeartbeatSystemEvent } from './openclawHeartbeatRunner.js';
import type { IAutonomySignal } from '../services/autonomySignalService.js';

export {
  normalizeAutonomySignal,
  type IAutonomySignal,
  type AutonomySignalSeverity,
} from '../services/autonomySignalService.js';

/** The system-event type used for extension signals on the heartbeat queue. */
export const AUTONOMY_SIGNAL_EVENT_TYPE = 'extension-signal';

/** Turn a normalized signal into a heartbeat system-event. */
export function signalToSystemEvent(sig: IAutonomySignal): IHeartbeatSystemEvent {
  return {
    type: AUTONOMY_SIGNAL_EVENT_TYPE,
    payload: {
      source: sig.source,
      kind: sig.kind,
      title: sig.title,
      ...(sig.detail ? { detail: sig.detail } : {}),
      severity: sig.severity,
    },
    timestamp: Date.now(),
  };
}
