// browserAutomationBridge.ts — `parallx.browser`, for the Browser extension only.
//
// docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md section 2. The Browser registers
// as the host of the assistant's browser automation: it shows the tabs the
// main-process broker creates and displays the run's state. The registration is
// tied to the extension's lifetime (pushed onto its subscriptions), so a
// disabled or deactivated Browser takes its tools, host and leases with it. The
// host cannot create ownership or dispatch page actions; only the core service
// and the broker do.

import type { IDisposable } from '../../platform/lifecycle.js';
import {
  BROWSER_OWNER_TOOL_ID,
  type IBrowserAutomationService,
  type IBrowserAutomationHost,
  type IBrowserAutomationHostRegistration,
} from '../../services/browserAutomationTypes.js';

export class BrowserAutomationBridge {
  constructor(
    private readonly _toolId: string,
    private readonly _service: IBrowserAutomationService,
    private readonly _subscriptions: IDisposable[],
  ) {}

  /** Only the Browser extension gets `parallx.browser`. */
  static isHostTool(toolId: string): boolean {
    return toolId === BROWSER_OWNER_TOOL_ID;
  }

  registerAutomationHost(host: IBrowserAutomationHost): IBrowserAutomationHostRegistration {
    if (this._toolId !== BROWSER_OWNER_TOOL_ID) throw new Error('Only the Browser can host browser automation.');
    const registration = this._service.registerHost(host, this._toolId);
    this._subscriptions.push(registration);
    return registration;
  }
}
