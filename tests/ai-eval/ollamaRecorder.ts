/**
 * Passthrough recorder for Ollama /api/chat traffic.
 *
 * Installs a Playwright route that forwards every /api/chat call to the
 * real Ollama daemon and records the request body + every streamed NDJSON
 * chunk. Exposes a parsed view of the conversation including tool calls,
 * thinking text, final assistant content, and per-turn latency.
 *
 * Each /api/chat request corresponds to ONE inference turn. A multi-step
 * tool-calling conversation produces multiple turns. Each turn has:
 *   - request.messages      (everything the model saw, including tool results)
 *   - request.tools         (the tool catalog at that moment)
 *   - response.thinking     (reasoning text if surfaced by the model)
 *   - response.content      (final text the model emitted this turn)
 *   - response.tool_calls   (tool calls the model emitted this turn, if any)
 *   - latencyMs
 */
import type { Page, Route } from '@playwright/test';

export interface OllamaToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface OllamaTurn {
  readonly index: number;
  readonly startedAt: number;
  readonly latencyMs: number;
  readonly model: string;
  readonly request: {
    readonly messages: ReadonlyArray<{ role: string; content: string; tool_call_id?: string; name?: string }>;
    readonly tools: ReadonlyArray<{ function?: { name: string } }>;
  };
  readonly response: {
    readonly thinking: string;
    readonly content: string;
    readonly toolCalls: ReadonlyArray<OllamaToolCall>;
    readonly raw: string;
  };
}

export class OllamaRecorder {
  private readonly _turns: OllamaTurn[] = [];
  private _installed = false;

  /** Install the route on a Page. Idempotent. */
  async attach(page: Page): Promise<void> {
    if (this._installed) return;
    this._installed = true;
    await page.route('**/api/chat', (route) => this._handleChat(route));
  }

  /** All turns captured so far. */
  getTurns(): ReadonlyArray<OllamaTurn> {
    return this._turns.slice();
  }

  /** Flat list of every tool call across all turns, in order. */
  getToolCalls(): ReadonlyArray<{ turn: number; name: string; arguments: Record<string, unknown> }> {
    const flat: { turn: number; name: string; arguments: Record<string, unknown> }[] = [];
    for (const t of this._turns) {
      for (const c of t.response.toolCalls) {
        flat.push({ turn: t.index, name: c.name, arguments: c.arguments });
      }
    }
    return flat;
  }

  /** Wipe captured turns (between sub-scenarios within one test). */
  reset(): void {
    this._turns.length = 0;
  }

  // ── internals ──────────────────────────────────────────────────────

  private async _handleChat(route: Route): Promise<void> {
    const started = Date.now();
    const req = route.request();
    let reqBody: any = {};
    try { reqBody = JSON.parse(req.postData() ?? '{}'); } catch { /* ignore */ }

    let resp;
    try {
      resp = await route.fetch();
    } catch (err) {
      try { await route.abort('failed'); } catch { /* ignore */ }
      return;
    }

    const buf = await resp.body();
    const raw = buf.toString('utf8');

    // Parse NDJSON streaming chunks. Each line is a JSON object with at least
    // `message: { role, content, thinking?, tool_calls? }` and a terminal
    // chunk with `done: true`.
    let thinking = '';
    let content = '';
    const toolCalls: OllamaToolCall[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      let obj: any;
      try { obj = JSON.parse(t); } catch { continue; }
      const msg = obj.message;
      if (msg && typeof msg === 'object') {
        if (typeof msg.thinking === 'string') thinking += msg.thinking;
        if (typeof msg.content === 'string') content += msg.content;
        if (Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            const fn = tc?.function ?? tc;
            const name = String(fn?.name ?? '');
            let args: any = fn?.arguments;
            if (typeof args === 'string') {
              try { args = JSON.parse(args); } catch { /* keep string */ }
            }
            if (name) toolCalls.push({ name, arguments: (args && typeof args === 'object') ? args : { _raw: args } });
          }
        }
      }
    }

    this._turns.push({
      index: this._turns.length,
      startedAt: started,
      latencyMs: Date.now() - started,
      model: String(reqBody.model ?? ''),
      request: {
        messages: Array.isArray(reqBody.messages) ? reqBody.messages : [],
        tools: Array.isArray(reqBody.tools) ? reqBody.tools : [],
      },
      response: { thinking, content, toolCalls, raw },
    });

    await route.fulfill({
      status: resp.status(),
      headers: resp.headers(),
      body: buf,
    });
  }
}
