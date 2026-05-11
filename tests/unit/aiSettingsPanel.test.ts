// @vitest-environment jsdom
// tests/unit/aiSettingsPanel.test.ts — M61 Phase 5: trimmed sidebar tests.
//
// The AI Settings sidebar is now a managers-only deep-link target for
// action rows in the unified Settings overlay. Persona / Chat / Model /
// Retrieval / Indexing / Suggestions / Heartbeat / Advanced / Preview
// sections and the PresetSwitcher have been deleted; the panel renders
// only Agent, Cron (Scheduled jobs), Tools, and MCP. These tests cover:
//   - createSettingRow helper
//   - SettingsSection base class (via ToolsSection, still alive)
//   - AISettingsPanel shell (4 nav items, 4 sections, no preset switcher)
//   - built-in activation (registerViewProvider + ai-settings.open)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AISettingsProfile } from '../../src/aiSettings/aiSettingsTypes';
import { DEFAULT_PROFILE, BUILT_IN_PRESETS } from '../../src/aiSettings/aiSettingsDefaults';
import { Emitter } from '../../src/platform/events';
import { createSettingRow } from '../../src/aiSettings/ui/sectionBase';
import { AISettingsPanel } from '../../src/aiSettings/ui/aiSettingsPanel';
import { ToolsSection } from '../../src/aiSettings/ui/sections/toolsSection';
import { activate, deactivate } from '../../src/built-in/ai-settings/main';

// ─── Mock IAISettingsService ─────────────────────────────────────────────────

function createMockService(overrides?: Partial<AISettingsProfile>) {
  const profile: AISettingsProfile = {
    ...structuredClone(DEFAULT_PROFILE),
    ...overrides,
    persona: { ...DEFAULT_PROFILE.persona, ...overrides?.persona },
    chat: { ...DEFAULT_PROFILE.chat, ...overrides?.chat },
    model: { ...DEFAULT_PROFILE.model, ...overrides?.model },
    suggestions: { ...DEFAULT_PROFILE.suggestions, ...overrides?.suggestions },
  };

  const profiles: AISettingsProfile[] = structuredClone(BUILT_IN_PRESETS) as AISettingsProfile[];
  const onDidChangeEmitter = new Emitter<AISettingsProfile>();

  return {
    getActiveProfile: vi.fn(() => structuredClone(profile)),
    getAllProfiles: vi.fn(() => [...profiles]),
    setActiveProfile: vi.fn(async () => {}),
    updateActiveProfile: vi.fn(async () => {}),
    createProfile: vi.fn(async (name: string) => ({
      ...structuredClone(DEFAULT_PROFILE),
      id: `custom-${Date.now()}`,
      presetName: name,
      isBuiltIn: false,
    })),
    deleteProfile: vi.fn(async () => {}),
    renameProfile: vi.fn(async () => {}),
    resetSection: vi.fn(async () => {}),
    resetAll: vi.fn(async () => {}),
    runPreviewTest: vi.fn(async (msg: string) => `Echo: ${msg}`),
    onDidChange: onDidChangeEmitter.event,
    dispose: vi.fn(),
    _fireChange: (p?: AISettingsProfile) => onDidChangeEmitter.fire(p ?? profile),
    _emitter: onDidChangeEmitter,
  };
}

function cont(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// ─── createSettingRow ────────────────────────────────────────────────────────

describe('createSettingRow', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('creates a row with label, description, and control slot', () => {
    const { row, controlSlot } = createSettingRow({
      label: 'Test Label',
      description: 'Test Description',
      key: 'test.key',
    });

    expect(row.classList.contains('ai-settings-row')).toBe(true);
    expect(row.dataset.settingKey).toBe('test.key');
    expect(row.dataset.searchLabel).toBe('test label');
    expect(row.dataset.searchDesc).toBe('test description');
    expect(row.querySelector('.ai-settings-row__label')?.textContent).toBe('Test Label');
    expect(row.querySelector('.ai-settings-row__description')?.textContent).toBe('Test Description');
    expect(row.querySelector('.ai-settings-row__control')).toBe(controlSlot);
  });

  it('includes reset button when onReset is provided', () => {
    const onReset = vi.fn();
    const { row } = createSettingRow({
      label: 'Resettable',
      description: 'Can reset',
      key: 'test.reset',
      onReset,
    });

    const resetBtn = row.querySelector('.ai-settings-row__reset') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    expect(resetBtn.title).toBe('Reset to default');
    resetBtn.click();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('omits reset button when no onReset', () => {
    const { row } = createSettingRow({
      label: 'No Reset',
      description: 'No handler',
      key: 'test.noreset',
    });
    expect(row.querySelector('.ai-settings-row__reset')).toBeNull();
  });
});

// ─── SettingsSection (via ToolsSection as concrete subclass) ────────────────

describe('SettingsSection (base class)', () => {
  let service: ReturnType<typeof createMockService>;

  beforeEach(() => {
    document.body.innerHTML = '';
    service = createMockService();
  });

  it('creates section with header and content elements', () => {
    const section = new ToolsSection(service as any);
    expect(section.element.classList.contains('ai-settings-section')).toBe(true);
    expect(section.element.dataset.sectionId).toBe('tools');
    expect(section.headerElement.id).toBe('ai-settings-section-tools');
    expect(section.contentElement.classList.contains('ai-settings-section__content')).toBe(true);
    section.dispose();
  });
});

// ─── AISettingsPanel ─────────────────────────────────────────────────────────

describe('AISettingsPanel', () => {
  let parent: HTMLElement;
  let service: ReturnType<typeof createMockService>;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = cont();
    service = createMockService();
  });

  it('renders two-column layout', () => {
    const panel = new AISettingsPanel(parent, service as any);
    expect(parent.querySelector('.ai-settings-panel')).toBeTruthy();
    expect(parent.querySelector('.ai-settings-panel__left')).toBeTruthy();
    expect(parent.querySelector('.ai-settings-panel__right')).toBeTruthy();
    panel.dispose();
  });

  it('renders navigation with the manager sections', () => {
    const panel = new AISettingsPanel(parent, service as any);
    const navItems = parent.querySelectorAll('.ai-settings-nav__item');
    expect(navItems.length).toBe(5);
    expect(Array.from(navItems).map((n) => n.textContent)).toEqual([
      'Agent',
      'Scheduled jobs',
      'Tools',
      'MCP Servers',
      'Web Research',
    ]);
    panel.dispose();
  });

  it('includes search bar', () => {
    const panel = new AISettingsPanel(parent, service as any);
    expect(parent.querySelector('.ai-settings-panel__search')).toBeTruthy();
    panel.dispose();
  });

  it('renders the manager sections in content area', () => {
    const panel = new AISettingsPanel(parent, service as any);
    const sections = parent.querySelectorAll('.ai-settings-section');
    expect(sections.length).toBe(5);
    const ids = Array.from(sections).map((s) => (s as HTMLElement).dataset.sectionId);
    expect(ids).toEqual(['agent', 'cron', 'tools', 'mcp', 'web-research']);
    panel.dispose();
  });

  it('does NOT include a preset switcher (M61 Phase 5)', () => {
    const panel = new AISettingsPanel(parent, service as any);
    const left = parent.querySelector('.ai-settings-panel__left');
    expect(left?.querySelector('.ai-settings-preset-switcher')).toBeNull();
    panel.dispose();
  });

  it('does not throw when onDidChange fires', () => {
    const panel = new AISettingsPanel(parent, service as any);
    const updated = {
      ...structuredClone(DEFAULT_PROFILE),
      persona: { ...DEFAULT_PROFILE.persona, name: 'New Name' },
    };
    service.getActiveProfile.mockReturnValue(updated);
    service._fireChange(updated);
    expect(parent.querySelector('.ai-settings-panel')).toBeTruthy();
    panel.dispose();
  });
});

// ─── Built-in main.ts (activate / deactivate) ───────────────────────────────

describe('AI Settings built-in activation', () => {
  let service: ReturnType<typeof createMockService>;
  let mockApi: any;
  let context: { subscriptions: { dispose(): void }[] };
  let disposables: { dispose(): void }[];

  beforeEach(() => {
    document.body.innerHTML = '';
    service = createMockService();
    disposables = [];

    mockApi = {
      views: {
        registerViewProvider: vi.fn((_id: string, _provider: any) => {
          const d = { dispose: vi.fn() };
          disposables.push(d);
          return d;
        }),
      },
      commands: {
        registerCommand: vi.fn((_id: string, _handler: any) => {
          const d = { dispose: vi.fn() };
          disposables.push(d);
          return d;
        }),
        executeCommand: vi.fn(async () => {}),
      },
      window: {
        createStatusBarItem: vi.fn(() => ({
          text: '',
          tooltip: undefined as string | undefined,
          command: undefined as string | undefined,
          name: undefined as string | undefined,
          show: vi.fn(),
          hide: vi.fn(),
          dispose: vi.fn(),
        })),
      },
      services: {
        get: vi.fn((token: { readonly id: string }) => {
          if (token.id === 'IAISettingsService') { return service; }
          return undefined;
        }),
        has: vi.fn((token: { readonly id: string }) => token.id === 'IAISettingsService'),
      },
    };

    context = { subscriptions: [] };
  });

  it('registers view provider for view.aiSettings', () => {
    activate(mockApi, context as any);
    expect(mockApi.views.registerViewProvider).toHaveBeenCalledWith(
      'view.aiSettings',
      expect.objectContaining({ createView: expect.any(Function) }),
    );
  });

  it('registers ai-settings.open command', () => {
    activate(mockApi, context as any);
    expect(mockApi.commands.registerCommand).toHaveBeenCalledWith(
      'ai-settings.open',
      expect.any(Function),
    );
  });

  it('pushes subscriptions to context', () => {
    activate(mockApi, context as any);
    expect(context.subscriptions.length).toBeGreaterThan(0);
  });

  it('deactivate() does not throw', () => {
    activate(mockApi, context as any);
    expect(() => deactivate()).not.toThrow();
  });

  it('view provider creates AISettingsPanel', () => {
    activate(mockApi, context as any);
    const providerArg = mockApi.views.registerViewProvider.mock.calls[0][1];

    const container = document.createElement('div');
    document.body.appendChild(container);
    const disposable = providerArg.createView(container);

    expect(container.querySelector('.ai-settings-panel')).toBeTruthy();
    expect(disposable).toBeTruthy();
    expect(typeof disposable.dispose).toBe('function');
    disposable.dispose();
  });
});
