import type { IChatRuntimeTrace } from '../chatTypes.js';
import {
  queueChatMemoryWriteBack,
  type IChatMemoryWriteBackDeps,
  type IChatMemoryWriteBackOptions,
} from './chatMemoryWriteBack.js';
import { createChatRuntimeCheckpointSink } from './chatRuntimeCheckpointSink.js';

type IRuntimeTraceSeed = Pick<IChatRuntimeTrace, 'route' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady'>;

export interface IChatRuntimeLifecycle {
  queueMemoryWriteBack(
    deps: IChatMemoryWriteBackDeps,
    options: Omit<IChatMemoryWriteBackOptions, 'onCheckpoint'>,
  ): void;
  recordCompleted(note?: string): void;
  recordAborted(note?: string): void;
  recordFailed(note?: string): void;
}

export function createChatRuntimeLifecycle(options: {
  runtimeTraceSeed?: IRuntimeTraceSeed;
  reportRuntimeTrace?: (trace: IChatRuntimeTrace) => void;
  queueMemoryWriteBackImpl?: typeof queueChatMemoryWriteBack;
}): IChatRuntimeLifecycle {
  const checkpointSink = createChatRuntimeCheckpointSink({
    runtimeTraceSeed: options.runtimeTraceSeed,
    reportRuntimeTrace: options.reportRuntimeTrace,
  });
  const writeBack = options.queueMemoryWriteBackImpl ?? queueChatMemoryWriteBack;
  let pendingMemoryWriteBack:
    | { deps: IChatMemoryWriteBackDeps; options: Omit<IChatMemoryWriteBackOptions, 'onCheckpoint'> }
    | undefined;

  const flushPendingMemoryWriteBack = (): void => {
    if (!pendingMemoryWriteBack) {
      return;
    }

    const queuedWriteBack = pendingMemoryWriteBack;
    pendingMemoryWriteBack = undefined;
    writeBack(queuedWriteBack.deps, {
      ...queuedWriteBack.options,
      onCheckpoint: checkpointSink.recordMemoryCheckpoint,
    });
  };

  const clearPendingMemoryWriteBack = (): void => {
    pendingMemoryWriteBack = undefined;
  };

  return {
    queueMemoryWriteBack: (deps, lifecycleOptions) => {
      pendingMemoryWriteBack = {
        deps,
        options: lifecycleOptions,
      };
    },
    recordCompleted: (note) => {
      checkpointSink.recordOutcome('post-finalization', 'completed', note);
      flushPendingMemoryWriteBack();
    },
    recordAborted: (note) => {
      clearPendingMemoryWriteBack();
      checkpointSink.recordOutcome('run-aborted', 'aborted', note);
    },
    recordFailed: (note) => {
      clearPendingMemoryWriteBack();
      checkpointSink.recordOutcome('run-failed', 'failed', note);
    },
  };
}