// introspectionService.ts — the app describing itself.
//
// Phase C of SYSTEM_INTEGRITY.md. The truth about the running app has
// always existed, one registry at a time: the tool registry knows the
// roster, the activator knows when each tool woke and how long it took,
// the error service knows what failed, enablement knows what is switched
// off, the keybinding service knows every binding WITH its source, the
// context service knows the 22 live workbench facts, the layout can
// serialize its own tree. Nothing joined them — there was no single
// answer to "what is running right now."
//
// This service is that join, and ONLY that join: read-only, no new state,
// no new registries, no caching. Every method resolves the underlying
// services lazily through the collection (a missing service degrades to
// an empty answer, never a throw) and returns plain serializable objects,
// so the same descriptions serve the Tool Gallery, the diagnostics
// checks, and the model's app__describe tool.

import { createServiceIdentifier } from '../platform/types.js';
import type { ServiceCollection } from './serviceCollection.js';
import {
  ICommandService,
  IContextKeyService,
  IEditorService,
  IKeybindingService,
  ISettingsRegistryService,
  IToolActivatorService,
  IToolEnablementService,
  IToolErrorService,
  IToolRegistryService,
  type OpenEditorDescriptor,
} from './serviceTypes.js';
import type { ContextKeyValue } from '../context/contextKey.js';

// ── Description shapes ──────────────────────────────────────────────────────

export interface IToolRuntimeDescription {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly builtin: boolean;
  readonly state: string;
  readonly enabled: boolean;
  readonly canChangeEnablement: boolean;
  readonly activationEvents: readonly string[];
  /** Epoch ms; present only while activated. */
  readonly activatedAt?: number;
  readonly activationDurationMs?: number;
  readonly errorCount: number;
  readonly lastError?: { readonly message: string; readonly context: string; readonly timestamp: number };
}

export interface ICommandDescription {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly keybinding?: string;
  readonly when?: string;
  readonly aiInvocable?: boolean;
}

export interface IKeybindingDescription {
  readonly key: string;
  readonly commandId: string;
  readonly when?: string;
  readonly source?: string;
}

export interface IKeyConflict {
  readonly key: string;
  readonly bindings: readonly IKeybindingDescription[];
}

export interface ILayoutDescription {
  readonly areas: {
    readonly left: readonly string[];
    readonly right: readonly string[];
    readonly bottom: readonly string[];
    readonly center: readonly string[];
  };
  readonly railIcons: readonly { readonly partId: string; readonly rail: 'left' | 'right' }[];
  /** One-paragraph narration of the same facts, for model prompts. */
  readonly prose: string;
}

export interface ISettingDescription {
  readonly key: string;
  readonly type: string;
  readonly scope: string;
  /** Compact rendering; secrets are never read, they render '[secret]'. */
  readonly value: string;
  readonly isDefault: boolean;
}

export interface IAppSnapshot {
  readonly tools: readonly IToolRuntimeDescription[];
  readonly commands: readonly ICommandDescription[];
  readonly keybindings: readonly IKeybindingDescription[];
  readonly keyConflicts: readonly IKeyConflict[];
  readonly layout: ILayoutDescription;
  readonly editors: readonly OpenEditorDescriptor[];
  readonly settings: readonly ISettingDescription[];
  readonly context: Record<string, ContextKeyValue>;
  readonly services: readonly string[];
}

/** The layout facts only the workbench can supply (not DI services). */
export interface IIntrospectionHost {
  bodyLeafViewIds(): readonly string[];
  areaOf(viewId: string): 'left' | 'right' | 'bottom' | 'center';
  railIconPlacements(): ReadonlyArray<{ partId: string; rail: 'left' | 'right' }>;
}

export interface IIntrospectionService {
  describeTools(): readonly IToolRuntimeDescription[];
  describeCommands(): readonly ICommandDescription[];
  describeKeybindings(): readonly IKeybindingDescription[];
  findKeyConflicts(): readonly IKeyConflict[];
  describeLayout(): ILayoutDescription;
  describeEditors(): readonly OpenEditorDescriptor[];
  describeSettings(): readonly ISettingDescription[];
  describeContext(): Record<string, ContextKeyValue>;
  describeServices(): readonly string[];
  snapshot(): IAppSnapshot;
}

export const IIntrospectionService =
  createServiceIdentifier<IIntrospectionService>('IIntrospectionService');

// ── Implementation ──────────────────────────────────────────────────────────

function compactValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return (s ?? String(v)).slice(0, 80);
  } catch {
    return String(v).slice(0, 80);
  }
}

export class IntrospectionService implements IIntrospectionService {
  constructor(
    private readonly _services: ServiceCollection,
    private readonly _host: IIntrospectionHost,
  ) {}

  describeTools(): readonly IToolRuntimeDescription[] {
    const registry = this._services.tryGet(IToolRegistryService);
    if (!registry) return [];
    const activator = this._services.tryGet(IToolActivatorService);
    const errors = this._services.tryGet(IToolErrorService);
    const enablement = this._services.tryGet(IToolEnablementService);

    return registry.getAll().map(({ description, state }) => {
      const m = description.manifest;
      const activated = activator?.getActivated(m.id);
      const toolErrors = errors?.getToolErrors(m.id) ?? [];
      const last = toolErrors[toolErrors.length - 1];
      return {
        id: m.id,
        name: m.name,
        version: m.version,
        publisher: m.publisher,
        builtin: description.isBuiltin,
        state,
        enabled: enablement?.isEnabled(m.id) ?? true,
        canChangeEnablement: enablement?.canChangeEnablement(m.id) ?? false,
        activationEvents: m.activationEvents ?? [],
        activatedAt: activated?.activatedAt,
        activationDurationMs: activated?.activationDurationMs,
        errorCount: toolErrors.length,
        lastError: last
          ? { message: last.message, context: last.context, timestamp: last.timestamp }
          : undefined,
      };
    });
  }

  describeCommands(): readonly ICommandDescription[] {
    const commands = this._services.tryGet(ICommandService);
    if (!commands) return [];
    return [...commands.getCommands().values()].map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      keybinding: d.keybinding,
      when: d.when,
      aiInvocable: d.aiInvocable,
    })).sort((a, b) => a.id.localeCompare(b.id));
  }

  describeKeybindings(): readonly IKeybindingDescription[] {
    const kb = this._services.tryGet(IKeybindingService);
    return kb?.getAllKeybindings() ?? [];
  }

  findKeyConflicts(): readonly IKeyConflict[] {
    const byKey = new Map<string, IKeybindingDescription[]>();
    for (const b of this.describeKeybindings()) {
      const bucket = byKey.get(b.key) ?? [];
      bucket.push(b);
      byKey.set(b.key, bucket);
    }
    const conflicts: IKeyConflict[] = [];
    for (const [key, bindings] of byKey) {
      // Same key bound to more than one DISTINCT command is a conflict
      // candidate; distinct when-clauses may legitimately partition it,
      // so the clauses ride along for the reader to judge.
      const distinctCommands = new Set(bindings.map((b) => b.commandId));
      if (distinctCommands.size > 1) conflicts.push({ key, bindings });
    }
    return conflicts.sort((a, b) => a.key.localeCompare(b.key));
  }

  describeLayout(): ILayoutDescription {
    const areas = { left: [] as string[], right: [] as string[], bottom: [] as string[], center: [] as string[] };
    for (const viewId of this._host.bodyLeafViewIds()) {
      areas[this._host.areaOf(viewId)].push(viewId);
    }
    const railIcons = this._host.railIconPlacements();
    const part = (ids: readonly string[]): string => (ids.length ? ids.join(', ') : 'nothing');
    const prose =
      `Left of the editor: ${part(areas.left)}. Right: ${part(areas.right)}. ` +
      `Below: ${part(areas.bottom)}. Center: ${part(areas.center)}.` +
      (railIcons.length
        ? ` Relocated part icons: ${railIcons.map((r) => `${r.partId} on the ${r.rail} rail`).join(', ')}.`
        : '');
    return { areas, railIcons, prose };
  }

  describeEditors(): readonly OpenEditorDescriptor[] {
    const editors = this._services.tryGet(IEditorService);
    try {
      return editors?.getOpenEditors() ?? [];
    } catch {
      return [];
    }
  }

  describeSettings(): readonly ISettingDescription[] {
    const settings = this._services.tryGet(ISettingsRegistryService);
    if (!settings) return [];
    return settings.getAllSchemas().map((schema) => {
      let value: string;
      let isDefault: boolean;
      if (schema.secret) {
        // Never read secrets, even to compare — presence is not our business.
        value = '[secret]';
        isDefault = false;
      } else {
        let v: unknown;
        try { v = settings.getValue(schema.key); } catch { v = undefined; }
        value = compactValue(v);
        isDefault = compactValue(schema.default) === value;
      }
      return { key: schema.key, type: schema.type, scope: schema.scope, value, isDefault };
    });
  }

  describeContext(): Record<string, ContextKeyValue> {
    const ctx = this._services.tryGet(IContextKeyService);
    if (!ctx) return {};
    return Object.fromEntries(ctx.getAllContext());
  }

  describeServices(): readonly string[] {
    return this._services.keys();
  }

  snapshot(): IAppSnapshot {
    return {
      tools: this.describeTools(),
      commands: this.describeCommands(),
      keybindings: this.describeKeybindings(),
      keyConflicts: this.findKeyConflicts(),
      layout: this.describeLayout(),
      editors: this.describeEditors(),
      settings: this.describeSettings(),
      context: this.describeContext(),
      services: this.describeServices(),
    };
  }
}
