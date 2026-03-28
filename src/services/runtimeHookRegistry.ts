// D4: Runtime Hook Registry — tool observer + message observer composition with error isolation
// Upstream pattern: Observer-based hook system for runtime extensibility

import type { IChatRuntimeToolInvocationObserver, IChatRuntimeToolMetadata } from './chatRuntimeTypes.js';
import type { IToolResult } from './chatTypes.js';
import type { IChatRuntimeMessageObserver } from './serviceTypes.js';
import type { IDisposable } from '../platform/lifecycle.js';

/**
 * Centralized registry for runtime hooks.
 * Supports registration of tool invocation observers and message observers.
 * Composes multiple observers into a single composite that fires all registered
 * callbacks with error isolation (one observer's failure doesn't crash others).
 */
export class RuntimeHookRegistry {
  private readonly _toolObservers = new Set<IChatRuntimeToolInvocationObserver>();
  private readonly _messageObservers = new Set<IChatRuntimeMessageObserver>();

  registerToolObserver(observer: IChatRuntimeToolInvocationObserver): IDisposable {
    this._toolObservers.add(observer);
    return { dispose: () => { this._toolObservers.delete(observer); } };
  }

  registerMessageObserver(observer: IChatRuntimeMessageObserver): IDisposable {
    this._messageObservers.add(observer);
    return { dispose: () => { this._messageObservers.delete(observer); } };
  }

  getCompositeToolObserver(): IChatRuntimeToolInvocationObserver {
    return {
      onValidated: (metadata: IChatRuntimeToolMetadata) => {
        for (const obs of this._toolObservers) {
          try { obs.onValidated?.(metadata); } catch (e) { console.warn('[RuntimeHookRegistry] Tool observer onValidated error:', e); }
        }
      },
      onApprovalRequested: (metadata: IChatRuntimeToolMetadata) => {
        for (const obs of this._toolObservers) {
          try { obs.onApprovalRequested?.(metadata); } catch (e) { console.warn('[RuntimeHookRegistry] Tool observer onApprovalRequested error:', e); }
        }
      },
      onApprovalResolved: (metadata: IChatRuntimeToolMetadata, approved: boolean) => {
        for (const obs of this._toolObservers) {
          try { obs.onApprovalResolved?.(metadata, approved); } catch (e) { console.warn('[RuntimeHookRegistry] Tool observer onApprovalResolved error:', e); }
        }
      },
      onExecuted: (metadata: IChatRuntimeToolMetadata, result: IToolResult) => {
        for (const obs of this._toolObservers) {
          try { obs.onExecuted?.(metadata, result); } catch (e) { console.warn('[RuntimeHookRegistry] Tool observer onExecuted error:', e); }
        }
      },
    };
  }

  getCompositeMessageObserver(): IChatRuntimeMessageObserver {
    return {
      onBeforeModelCall: (messages: readonly { role: string; content: string }[], model: string) => {
        for (const obs of this._messageObservers) {
          try { obs.onBeforeModelCall?.(messages, model); } catch (e) { console.warn('[RuntimeHookRegistry] Message observer onBeforeModelCall error:', e); }
        }
      },
      onAfterModelCall: (messages: readonly { role: string; content: string }[], model: string, durationMs: number) => {
        for (const obs of this._messageObservers) {
          try { obs.onAfterModelCall?.(messages, model, durationMs); } catch (e) { console.warn('[RuntimeHookRegistry] Message observer onAfterModelCall error:', e); }
        }
      },
    };
  }
}
