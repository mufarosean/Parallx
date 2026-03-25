import type {
  IChatRuntimeMemoryCheckpoint,
  IChatRuntimeTrace,
} from '../chatTypes.js';

type IRuntimeTraceSeed = Pick<IChatRuntimeTrace, 'route' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady'>;

export interface IChatRuntimeCheckpointSink {
  recordMemoryCheckpoint(checkpoint: IChatRuntimeMemoryCheckpoint): void;
  recordOutcome(
    checkpoint: string,
    runState: IChatRuntimeTrace['runState'],
    note?: string,
  ): void;
}

export function createChatRuntimeCheckpointSink(options: {
  runtimeTraceSeed?: IRuntimeTraceSeed;
  reportRuntimeTrace?: (trace: IChatRuntimeTrace) => void;
}): IChatRuntimeCheckpointSink {
  const report = (patch: Partial<IChatRuntimeTrace> & { checkpoint: string }): void => {
    if (!options.runtimeTraceSeed || !options.reportRuntimeTrace) {
      return;
    }

    options.reportRuntimeTrace({
      ...options.runtimeTraceSeed,
      ...patch,
    });
  };

  return {
    recordMemoryCheckpoint: (checkpoint) => {
      report({
        checkpoint: checkpoint.checkpoint,
        note: checkpoint.note,
      });
    },
    recordOutcome: (checkpoint, runState, note) => {
      report({
        checkpoint,
        runState,
        note,
      });
    },
  };
}