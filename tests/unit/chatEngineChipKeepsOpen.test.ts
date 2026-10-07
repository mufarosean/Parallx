// @vitest-environment jsdom
// The engine chip's popover sets the model and the context size together: a
// model pick keeps it open and draws the sizes again for that model, and a
// size the new model cannot hold becomes its maximum.
import { describe, it, expect, afterEach } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { ChatEngineChip } from '../../src/built-in/chat/widgets/chatEngineChip';

afterEach(() => { document.body.innerHTML = ''; });

const MODELS = [
  { id: 'qwen3:14b', displayName: 'Qwen3 14B', parameterSize: '14B', contextLength: 40_960 },
  { id: 'llama3:8b', displayName: 'Llama 3 8B', parameterSize: '8B', contextLength: 8_192 },
];

function mount(override?: number) {
  let active = 'qwen3:14b';
  let ctx = override;
  const picks: number[] = [];
  const onDidChangeModels = new Emitter<void>();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const chip = new ChatEngineChip(host, {
    models: {
      getModels: async () => MODELS,
      getActiveModel: () => active,
      setActiveModel: (id: string) => { active = id; },
      onDidChangeModels: onDidChangeModels.event,
    } as never,
    onSelectModel: (id) => { active = id; },
    getContextOverride: () => ctx,
    onPickContext: (t) => { picks.push(t); ctx = t > 0 ? t : undefined; },
    getUsage: () => undefined,
    openUsageDetails: () => {},
  });
  return { chip, button: host.querySelector('button.parallx-chat-engine-chip') as HTMLButtonElement, picks, get active() { return active; } };
}

const pop = () => document.querySelector('.parallx-chat-engine-pop') as HTMLElement | null;
const ticks = () => Array.from(pop()!.querySelectorAll('.parallx-chat-engine-ticks span')).map((e) => e.textContent);
const modelRow = (name: string) => Array.from(pop()!.querySelectorAll('button.parallx-chat-engine-model')).find((b) => b.textContent!.includes(name)) as HTMLButtonElement;
const opened = async () => { for (let i = 0; i < 20 && !pop(); i++) await Promise.resolve(); return pop(); };

describe('engine chip popover', () => {
  it('stays open on a model pick and offers that model\'s sizes', async () => {
    const m = mount();
    m.button.click();
    expect(await opened()).not.toBeNull();
    expect(ticks()).toEqual(['Default', '4K', '8K', '16K', '32K', '40K']);
    modelRow('Llama 3 8B').click();
    expect(m.active).toBe('llama3:8b');
    expect(pop()).not.toBeNull();
    expect(document.querySelectorAll('.parallx-chat-engine-pop').length).toBe(1);
    expect(ticks()).toEqual(['Default', '4K', '8K']);
    expect(modelRow('Llama 3 8B').getAttribute('aria-pressed')).toBe('true');
    expect(modelRow('Qwen3 14B').getAttribute('aria-pressed')).toBe('false');
    expect(m.picks).toEqual([]);
    m.chip.dispose();
  });

  it('a size the new model cannot hold becomes its maximum', async () => {
    const m = mount(32_768);
    m.button.click();
    await opened();
    modelRow('Llama 3 8B').click();
    expect(m.picks).toEqual([8_192]);
    expect((pop()!.querySelector('.parallx-chat-engine-slider') as HTMLInputElement).value).toBe('2');
    m.chip.dispose();
  });
});
