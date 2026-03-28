// D3: Diagnostics service — reusable check framework
// Upstream pattern: OpenClaw runtime health checks extracted as a service

import { Emitter } from '../platform/events.js';
import type { IDiagnosticResult, IDiagnosticCheckProducer, IDiagnosticCheckDeps } from './serviceTypes.js';

export class DiagnosticsService {
  private readonly _onDidChange = new Emitter<readonly IDiagnosticResult[]>();
  readonly onDidChange = this._onDidChange.event;

  private _lastResults: readonly IDiagnosticResult[] = [];
  private readonly _checks: IDiagnosticCheckProducer[] = [];
  private _deps: IDiagnosticCheckDeps;

  constructor(deps: IDiagnosticCheckDeps, checks: readonly IDiagnosticCheckProducer[]) {
    this._deps = deps;
    this._checks = [...checks];
  }

  /**
   * Merge additional deps into the check context.
   * Called by chat/main.ts once OllamaProvider + dataService are available.
   */
  updateDeps(patch: Partial<IDiagnosticCheckDeps>): void {
    this._deps = { ...this._deps, ...patch };
  }

  async runChecks(): Promise<readonly IDiagnosticResult[]> {
    const results = await Promise.all(
      this._checks.map(check =>
        check(this._deps).catch((err): IDiagnosticResult => ({
          name: 'Unknown Check',
          status: 'fail',
          detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        })),
      ),
    );
    this._lastResults = results;
    this._onDidChange.fire(results);
    return results;
  }

  getLastResults(): readonly IDiagnosticResult[] {
    return this._lastResults;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
