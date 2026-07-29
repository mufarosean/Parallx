// activityTaps.ts — where the app learns to speak.
//
// One wiring module subscribes the ActivityJournal to every existing choke
// point so the whole vocabulary lives in one file. Taps are read-only
// observers of emitters that already fire; nothing here changes behavior.
// Every subscription is optional — a missing service just means that verb
// stays silent.

import type { ServiceCollection } from '../services/serviceCollection.js';
import {
  ICommandService,
  IEditorService,
  ISettingsRegistryService,
  IRuntimeHookRegistry,
} from '../services/serviceTypes.js';
import { IChatService } from '../services/chatTypes.js';
import { IAutonomySignalService } from '../services/autonomySignalService.js';
import { IActivityJournalService } from '../services/activityJournalService.js';
import { ContextMenu } from '../ui/contextMenu.js';
import type { FocusTracker } from '../context/focusTracker.js';
import type { IThemeService } from '../services/serviceTypes.js';
import { DisposableStore } from '../platform/lifecycle.js';
import type { IDisposable } from '../platform/lifecycle.js';

/** Friendly names for editor typeIds so lines read "opened pdf 'x'". */
const EDITOR_KIND: Record<string, string> = {
  'parallx.editor.file': 'file',
  'parallx.editor.pdf': 'pdf',
  'parallx.editor.image': 'image',
  'parallx.editor.excel': 'spreadsheet',
  'parallx.editor.epub': 'book',
  'parallx.editor.word': 'document',
  'parallx.editor.untitled': 'untitled file',
  'parallx.editor.settings': 'settings',
  'parallx.editor.keybindings': 'keybindings',
  'parallx.editor.markdownPreview': 'markdown preview',
  'parallx.editor.readonlyMarkdown': 'markdown',
  'canvas': 'canvas page',
  'database': 'database',
};

function editorObject(typeId: string | undefined, name: string | undefined): string {
  // Open-editor descriptors carry no typeId — a bare quoted name reads better
  // than a generic "editor" prefix; active-editor changes DO carry typeId.
  const kind = typeId ? (EDITOR_KIND[typeId] ?? typeId.replace(/^parallx\.editor\./, '')) : undefined;
  if (kind && name) return `${kind} "${name}"`;
  if (name) return `"${name}"`;
  return kind ?? 'editor';
}

// Commands too chatty or too internal to narrate: getter-style commands other
// code executes programmatically (observed at boot in e2e 93), focus plumbing,
// status polls, and dispatch plumbing (signal emission, background-prompt
// routing) that subsystems fire on the user's behalf — those events are
// narrated by their OWN taps (signal bus, chat emitter); a second line here
// would mislabel machine traffic as a user gesture. The journal narrates
// intent, not implementation traffic.
const COMMAND_NOISE = [
  /^_/, /\.internal\./, /^workbench\.action\.focus/, /^parallx\.heartbeat\.status$/,
  /^chat\.get[A-Z]/, /^parallx\.mind\.status$/, /\.get[A-Z][a-zA-Z]*Provider$/,
  /^parallx\.autonomy\.signal$/, /^chat\.runBackgroundPrompt$/, /^chat\.submitPrompt$/,
];

export interface IActivityTapDeps {
  readonly services: ServiceCollection;
  readonly focusTracker?: FocusTracker;
  readonly themeService?: IThemeService;
  /** Human name of the opened workspace, for the session-start line. */
  readonly workspaceName?: string;
}

/**
 * Subscribe the journal to every narratable seam. Returns a disposable that
 * detaches all taps.
 */
export function wireActivityTaps(deps: IActivityTapDeps): IDisposable {
  const store = new DisposableStore();
  const { services } = deps;
  if (!services.has(IActivityJournalService)) return store;
  const journal = services.get(IActivityJournalService);

  // ── Session boundary ──
  journal.note({
    actor: 'system', source: 'session', verb: 'started',
    object: deps.workspaceName ? `session in workspace "${deps.workspaceName}"` : 'session',
  });

  // ── Window focus: "left the app" / "returned" (coalesced by the journal) ──
  const onBlur = () => journal.note({ actor: 'user', source: 'window', verb: 'left', object: 'the app window' });
  const onFocus = () => journal.note({ actor: 'user', source: 'window', verb: 'returned to', object: 'the app window' });
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  store.add({ dispose: () => { window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); } });

  // ── Commands: palette, keybindings, menus, extensions, and the AI's
  //    app__run_command all funnel through this one emitter. ──
  if (services.has(ICommandService)) {
    const cmdSvc = services.get(ICommandService) as unknown as {
      onDidExecuteCommand?: (l: (e: { commandId: string; duration?: number }) => void) => IDisposable;
      getCommand?: (id: string) => { title?: string; category?: string } | undefined;
    };
    if (typeof cmdSvc.onDidExecuteCommand === 'function') {
      store.add(cmdSvc.onDidExecuteCommand((e) => {
        if (COMMAND_NOISE.some((re) => re.test(e.commandId))) return;
        const desc = cmdSvc.getCommand?.(e.commandId);
        const title = desc?.title
          ? (desc.category ? `${desc.category}: ${desc.title}` : desc.title)
          : e.commandId;
        journal.note({ actor: 'user', source: 'command', verb: 'ran', object: `"${title}"` });
      }));
    }
  }

  // ── Editors: opened / closed via open-set diff, switches via active-change.
  //    ref = the editor id (resource identity) so two files named the same
  //    thing stay distinguishable to a reader acting on the line. ──
  if (services.has(IEditorService)) {
    const editorService = services.get(IEditorService);
    let known = new Map<string, string>(); // id → rendered object
    const snapshot = () => {
      const next = new Map<string, string>();
      try {
        for (const d of editorService.getOpenEditors()) {
          next.set(d.id, editorObject((d as { typeId?: string }).typeId, d.name));
        }
      } catch { /* keep previous */ }
      return next;
    };
    known = snapshot();
    store.add(editorService.onDidChangeOpenEditors(() => {
      const next = snapshot();
      for (const [id, obj] of next) if (!known.has(id)) journal.note({ actor: 'user', source: 'editor', verb: 'opened', object: obj, ref: id });
      for (const [id, obj] of known) if (!next.has(id)) journal.note({ actor: 'user', source: 'editor', verb: 'closed', object: obj, ref: id });
      known = next;
    }));
    store.add(editorService.onDidActiveEditorChange((input) => {
      if (!input) return;
      const id = (input as { id?: string }).id;
      journal.note({
        actor: 'user', source: 'editor', verb: 'viewing',
        object: editorObject((input as { typeId?: string }).typeId, (input as { name?: string }).name),
        ref: typeof id === 'string' && id ? id : undefined,
      });
    }));
  }

  // ── View focus: "focused Chat view" (coalesced). ──
  if (deps.focusTracker) {
    store.add(deps.focusTracker.onDidFocusView((viewId) => {
      journal.note({ actor: 'user', source: 'focus', verb: 'focused', object: `${viewId} view` });
    }));
  }

  // ── Context menus: every menu selection app-wide, by label. ──
  store.add(ContextMenu.onDidSelectAny((e) => {
    const label = (e.item as { label?: string }).label || (e.item as { id?: string }).id || 'menu item';
    journal.note({ actor: 'user', source: 'menu', verb: 'chose', object: `"${label}" from a menu` });
  }));

  // ── Settings + theme. ──
  if (services.has(ISettingsRegistryService)) {
    const settings = services.get(ISettingsRegistryService);
    store.add(settings.onDidChange((c) => {
      // Values can be secrets-adjacent; log key + compact value only.
      const v = typeof c.value === 'string' || typeof c.value === 'number' || typeof c.value === 'boolean'
        ? String(c.value).slice(0, 60)
        : '(updated)';
      journal.note({ actor: 'user', source: 'settings', verb: 'changed setting', object: c.key, detail: v });
    }));
  }
  if (deps.themeService) {
    store.add(deps.themeService.onDidChangeTheme((t) => {
      journal.note({ actor: 'user', source: 'settings', verb: 'switched theme to', object: (t as { label?: string; id?: string }).label ?? (t as { id?: string }).id ?? 'theme' });
    }));
  }

  // ── Autonomy signals: extensions already narrate here — bridge them in so
  //    canvas "created page X", budget alerts etc. join the same stream. ──
  if (services.has(IAutonomySignalService)) {
    const bus = services.get(IAutonomySignalService);
    store.add(bus.onDidSignal((sig) => {
      // The publisher's actor stamp wins (a canvas page the AI created is the
      // assistant's action, not the user's); the source heuristic is only the
      // fallback for actor-blind publishers.
      const actor = sig.actor === 'agent' ? 'ai'
        : sig.actor === 'user' ? 'user'
        : (sig.source === 'canvas' || sig.source === 'planner' ? 'user' : `ext:${sig.source}`);
      journal.note({
        actor,
        source: `signal:${sig.source}`,
        verb: 'signal',
        object: sig.title,
        detail: sig.detail,
      });
    }));
  }

  // ── AI: user queries + assistant turns (via the new ChatService emitter). ──
  if (services.has(IChatService)) {
    const chat = services.get(IChatService) as unknown as {
      onDidSendUserRequest?: (l: (e: { sessionId: string; text: string; origin?: string }) => void) => IDisposable;
    };
    if (typeof chat.onDidSendUserRequest === 'function') {
      store.add(chat.onDidSendUserRequest((e) => {
        // Autonomous origins (heartbeat/cron/…) are the assistant talking to
        // itself — actor 'ai'; interactive sessions are the user.
        const autonomous = typeof e.origin === 'string' && e.origin.length > 0;
        journal.note({
          actor: autonomous ? 'ai' : 'user',
          source: autonomous ? `chat:${e.origin}` : 'chat',
          verb: autonomous ? 'began autonomous turn' : 'asked the assistant',
          object: autonomous ? `(${e.origin})` : `"${e.text.slice(0, 120)}"`,
        });
      }));
    }
  }

  // ── AI tool executions: the dormant observer seam, finally used. ──
  if (services.has(IRuntimeHookRegistry)) {
    const hooks = services.get(IRuntimeHookRegistry);
    store.add(hooks.registerToolObserver({
      onExecuted: (meta, result) => {
        const failed = (result as { isError?: boolean }).isError === true;
        journal.note({
          actor: 'ai',
          source: 'tool',
          verb: failed ? 'tool failed' : 'ran tool',
          object: meta.name,
        });
      },
    }));
  }

  return store;
}
