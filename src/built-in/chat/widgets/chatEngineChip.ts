// chatEngineChip.ts — the model and how much the chat remembers, in one chip.
//
// The composer used to carry three controls: a model dropdown, a context
// dropdown of eleven sizes, and a usage ring. The chip shows them as one
// ("Qwen3 14B · 16K" with the ring inside) and opens one popover:
//   • Model: the installed models, their size and the most they can hold.
//   • How much it remembers: a slider over the sizes that fit the model, and
//     a plain line on whether this chat fits and what a size costs.
//   • This chat: what is using the space, as one bar; Details opens the full
//     breakdown.
// It changes nothing itself: picks go through the same services the old
// pickers used (the widget passes them in), and usage comes from the token
// meter, which keeps computing in the background.

import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { $, layoutPopup, attachPopupDismiss } from '../../../ui/dom.js';
import type { IEngineStatus, IEngineStatusServices, IModelPickerServices } from '../chatTypes.js';
import type { ITokenBreakdown } from './chatTokenStatusBar.js';

/** The sizes offered, in tokens. 0 = the model's own default. */
const SIZES: readonly number[] = [4_096, 8_192, 16_384, 32_768, 65_536, 131_072, 262_144];

export interface IEngineChipOptions {
  readonly models: IModelPickerServices;
  /** Pick a model: the widget applies it exactly as the old picker did. */
  readonly onSelectModel: (modelId: string) => void;
  /** The session's context override (undefined = model default). */
  readonly getContextOverride: () => number | undefined;
  /** Pick a size (0 = model default). */
  readonly onPickContext: (tokens: number) => void;
  readonly getUsage: () => ITokenBreakdown | undefined;
  readonly openUsageDetails: (anchor: HTMLElement) => void;
  /** Background runs waiting for the model, and where it sits. */
  readonly engineStatus?: IEngineStatusServices;
}

/** The engine in words, for the popover. Test seam. */
export function engineLines(s: IEngineStatus | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.where === 'gpu') out.push('On the graphics card');
  else if (s.where === 'partial') out.push('Partly on the CPU, so slower. A smaller size may fit on the graphics card.');
  else if (s.where === 'cpu') out.push('On the CPU, so slow');
  if (s.waiting > 0) out.push(`${s.waiting === 1 ? '1 background run waits' : `${s.waiting} background runs wait`} until your chat is done`);
  return out;
}

type ModelRow = { id: string; displayName: string; parameterSize: string; contextLength: number };

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) { const m = tokens / 1_000_000; return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`; }
  const k = tokens / 1024;
  return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
}

/** A short name for the chip: the model id without its tag noise. */
export function shortModelName(id: string | undefined): string {
  if (!id) return 'No Model';
  const base = id.replace(/^.*\//, '').replace(/:latest$/, '');
  return base.length > 22 ? `${base.slice(0, 21)}…` : base;
}

/** The plain line under the slider. */
export function contextHint(size: number, used: number): string {
  const fit = used > size * 0.9 ? 'Too small for this chat: older messages will be left out'
    : used > size * 0.7 ? 'Getting full: older messages will be summarized soon'
      : 'Room to spare';
  const speed = size <= 8_192 ? 'fastest' : size <= 32_768 ? 'quick' : 'slower to start and uses more memory';
  return `${fit} · ${speed}`;
}

export class ChatEngineChip extends Disposable {
  private readonly _chip: HTMLButtonElement;
  private readonly _ring: SVGCircleElement;
  private readonly _label: HTMLSpanElement;
  private readonly _queue: HTMLSpanElement;
  private _pop: HTMLElement | undefined;
  private _detach: (() => void) | undefined;
  private _models: readonly ModelRow[] = [];

  constructor(container: HTMLElement, private readonly _o: IEngineChipOptions) {
    super();
    this._chip = document.createElement('button');
    this._chip.type = 'button';
    this._chip.className = 'parallx-chat-engine-chip';
    this._chip.setAttribute('aria-haspopup', 'dialog');
    this._chip.setAttribute('aria-expanded', 'false');
    this._chip.innerHTML = '<svg class="parallx-chat-engine-ring" width="16" height="16" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="14" fill="none" stroke-width="5" class="parallx-chat-engine-ring-track"></circle><circle cx="18" cy="18" r="14" fill="none" stroke-width="5" stroke-linecap="round" transform="rotate(-90 18 18)" class="parallx-chat-engine-ring-fill"></circle></svg>';
    this._ring = this._chip.querySelector('.parallx-chat-engine-ring-fill') as SVGCircleElement;
    this._label = document.createElement('span');
    this._chip.appendChild(this._label);
    this._queue = document.createElement('span');
    this._queue.className = 'parallx-chat-engine-queue';
    this._queue.hidden = true;
    this._chip.appendChild(this._queue);
    container.appendChild(this._chip);
    this._register(toDisposable(() => { this._close(); this._chip.remove(); }));
    this._chip.addEventListener('click', () => { if (this._pop) this._close(); else void this._open(); });
    this._register(_o.models.onDidChangeModels(() => this.refresh()));
    if (_o.engineStatus) this._register(_o.engineStatus.onDidChange(() => this.refresh()));
    this.refresh();
  }

  /** The chip's label and ring, from the current model, size and usage. */
  refresh(): void {
    const active = this._o.models.getActiveModel();
    const size = this._effectiveSize();
    this._label.textContent = size ? `${shortModelName(active)} · ${formatTokens(size)}` : shortModelName(active);
    const usage = this._o.getUsage();
    const pct = usage && usage.contextLength > 0 ? Math.min(1, usage.total / usage.contextLength) : 0;
    const c = 2 * Math.PI * 14;
    this._ring.setAttribute('stroke-dasharray', `${(pct * c).toFixed(1)} ${c.toFixed(1)}`);
    this._chip.classList.toggle('parallx-chat-engine-chip--warn', pct > 0.7 && pct <= 0.9);
    this._chip.classList.toggle('parallx-chat-engine-chip--full', pct > 0.9);
    const engine = this._o.engineStatus?.get();
    const waiting = engine?.waiting ?? 0;
    this._queue.hidden = waiting === 0;
    this._queue.textContent = waiting > 0 ? `${waiting} waiting` : '';
    this._chip.classList.toggle('parallx-chat-engine-chip--slow', engine?.where === 'partial' || engine?.where === 'cpu');
    const base = usage
      ? `${shortModelName(active)}: ${formatTokens(usage.total)} of ${formatTokens(usage.contextLength)} used`
      : 'Model and context size';
    const lines = engineLines(engine);
    this._chip.title = lines.length ? `${base}\n${lines.join('\n')}` : base;
    if (this._pop) this._renderUsage(this._pop);
  }

  private _effectiveSize(): number {
    const override = this._o.getContextOverride();
    if (override && override > 0) return override;
    const usage = this._o.getUsage();
    if (usage?.contextLength) return usage.contextLength;
    const active = this._models.find((m) => m.id === this._o.models.getActiveModel());
    return active?.contextLength ?? 0;
  }

  private async _open(): Promise<void> {
    let models: readonly ModelRow[] = [];
    try { models = await this._o.models.getModels(); } catch { models = []; }
    this._models = models;
    const pop = $('div.parallx-chat-engine-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Model and context');
    this._renderModels(pop);
    pop.appendChild($('div.parallx-chat-engine-ctx'));
    pop.appendChild($('div.parallx-chat-engine-usage'));
    this._renderContext(pop);
    this._renderUsage(pop);
    document.body.appendChild(pop);
    this._pop = pop;
    this._chip.setAttribute('aria-expanded', 'true');
    layoutPopup(pop, this._chip.getBoundingClientRect(), { position: 'above', gap: 6, margin: 8 });
    this._detach = attachPopupDismiss([pop, this._chip], () => this._close());
  }

  private _close(): void {
    this._detach?.();
    this._detach = undefined;
    this._pop?.remove();
    this._pop = undefined;
    this._chip.setAttribute('aria-expanded', 'false');
  }

  private _renderModels(pop: HTMLElement): void {
    const sec = $('div.parallx-chat-engine-sec');
    sec.appendChild($('div.parallx-chat-engine-title', 'Model'));
    const active = this._o.models.getActiveModel();
    if (this._models.length === 0) {
      sec.appendChild($('div.parallx-chat-engine-empty', 'No models yet. Start Ollama, or add a cloud model in AI Settings.'));
    }
    for (const m of this._models) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'parallx-chat-engine-model';
      row.setAttribute('aria-pressed', m.id === active ? 'true' : 'false');
      const check = $('span.parallx-chat-engine-check', m.id === active ? '✓' : '');
      const text = $('span.parallx-chat-engine-model-text');
      text.appendChild($('span.parallx-chat-engine-model-name', m.displayName || m.id));
      const bits = [m.parameterSize, m.contextLength > 0 ? `holds up to ${formatTokens(m.contextLength)}` : ''].filter(Boolean).join(' · ');
      if (bits) text.appendChild($('span.parallx-chat-engine-model-meta', bits));
      row.append(check, text);
      row.addEventListener('click', () => {
        this._o.onSelectModel(m.id);
        this._close();
        this.refresh();
      });
      sec.appendChild(row);
    }
    pop.appendChild(sec);
  }

  private _renderContext(pop: HTMLElement): void {
    const host = pop.querySelector('.parallx-chat-engine-ctx') as HTMLElement;
    host.replaceChildren();
    const active = this._models.find((m) => m.id === this._o.models.getActiveModel());
    const max = active?.contextLength || SIZES[SIZES.length - 1];
    const sizes = SIZES.filter((s) => s <= max);
    if (sizes.length === 0) return;
    const override = this._o.getContextOverride();
    const current = override && override > 0 ? override : 0;
    const head = $('div.parallx-chat-engine-row');
    head.appendChild($('span.parallx-chat-engine-title', 'How much it remembers'));
    const value = $('span.parallx-chat-engine-value', current ? formatTokens(current) : 'Model default');
    head.appendChild(value);
    host.appendChild(head);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(sizes.length); // 0 = model default
    slider.step = '1';
    slider.className = 'parallx-chat-engine-slider';
    slider.setAttribute('aria-label', 'Context size');
    const idx = current ? Math.max(1, sizes.findIndex((s) => s >= current) + 1) : 0;
    slider.value = String(idx);
    host.appendChild(slider);
    const ticks = $('div.parallx-chat-engine-ticks');
    ticks.appendChild($('span', 'Default'));
    for (const s of sizes) ticks.appendChild($('span', formatTokens(s)));
    host.appendChild(ticks);
    const hint = $('div.parallx-chat-engine-hint');
    host.appendChild(hint);
    const show = (i: number): void => {
      const size = i === 0 ? (active?.contextLength || this._o.getUsage()?.contextLength || 0) : sizes[i - 1];
      value.textContent = i === 0 ? `Model default${size ? ` (${formatTokens(size)})` : ''}` : formatTokens(size);
      const used = this._o.getUsage()?.total ?? 0;
      hint.textContent = size ? contextHint(size, used) : '';
    };
    show(idx);
    slider.addEventListener('input', () => show(Number(slider.value)));
    slider.addEventListener('change', () => {
      const i = Number(slider.value);
      this._o.onPickContext(i === 0 ? 0 : sizes[i - 1]);
      this.refresh();
    });
  }

  private _renderUsage(pop: HTMLElement): void {
    const host = pop.querySelector('.parallx-chat-engine-usage') as HTMLElement | null;
    if (!host) return;
    host.replaceChildren();
    const u = this._o.getUsage();
    for (const line of engineLines(this._o.engineStatus?.get())) {
      host.appendChild($('div.parallx-chat-engine-hint.parallx-chat-engine-status', line));
    }
    const head = $('div.parallx-chat-engine-row');
    head.appendChild($('span.parallx-chat-engine-title', 'This chat'));
    head.appendChild($('span.parallx-chat-engine-value', u && u.contextLength ? `${u.isReal ? '' : '~'}${formatTokens(u.total)} of ${formatTokens(u.contextLength)} used` : 'Nothing yet'));
    host.appendChild(head);
    if (!u || !u.contextLength) return;
    const bar = $('div.parallx-chat-engine-bar');
    const parts: Array<[string, number, string]> = [
      ['Instructions', u.categories.systemInstructions, 'a'],
      ['Tools', u.categories.toolDefinitions, 'b'],
      ['Messages', u.categories.messages + u.categories.toolResults, 'c'],
      ['Files and pages', u.categories.files, 'd'],
    ];
    const legend = $('div.parallx-chat-engine-legend');
    for (const [label, n, k] of parts) {
      if (n <= 0) continue;
      const seg = $(`span.parallx-chat-engine-seg.parallx-chat-engine-seg--${k}`);
      seg.style.width = `${Math.min(100, (n / u.contextLength) * 100).toFixed(2)}%`;
      bar.appendChild(seg);
      const item = $('span.parallx-chat-engine-legend-item');
      item.appendChild($(`span.parallx-chat-engine-swatch.parallx-chat-engine-seg--${k}`));
      item.appendChild(document.createTextNode(`${label} ${formatTokens(n)}`));
      legend.appendChild(item);
    }
    host.append(bar, legend);
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'parallx-chat-engine-link';
    details.textContent = 'Details…';
    details.addEventListener('click', () => { this._close(); this._o.openUsageDetails(this._chip); });
    host.appendChild(details);
  }
}
