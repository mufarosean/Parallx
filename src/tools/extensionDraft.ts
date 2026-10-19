// extensionDraft.ts — an extension the AI wrote, read before anyone installs it.
//
// When the person asks the assistant to build a tool, the assistant hands
// over a draft (its manifest and its files). Nothing is written until the
// person presses Install. Before that, this reads the draft: it checks it
// against the extension rules (docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md
// the manifest, look and forbidden-things sections), and works out from its manifest and its code what it
// would add to the app and what it would reach. The review shows all three;
// a failed check goes back to the assistant to fix instead.
//
// What it reaches is read from the code. The checks refuse the ways out
// that code can name (network calls, the app's own bridge, other tools'
// commands, code built from strings), which is what the review can honestly
// claim, and it says so.

import { validateManifest } from './toolValidator.js';
import { actionLabelsInCode, lintActionLabels } from '../ui/styleLint.js';

/** The files a draft may hold, and their total size. */
const FILE_NAME = /^[a-z0-9][a-z0-9-]*\.(js|css|json|md)$/;
const MAX_BYTES = 512 * 1024;

export interface ExtensionDraft {
  readonly manifest: Record<string, unknown>;
  /** File name to text: main.js, and optionally a .css, .json or .md beside it. */
  readonly files: Readonly<Record<string, string>>;
}

export interface DraftCheck { readonly rule: string; readonly ok: boolean; readonly detail?: string }
export interface DraftAddition { readonly kind: string; readonly what: string }
export interface DraftReach { readonly what: string; readonly allowed: boolean }

export interface DraftReading {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly checks: readonly DraftCheck[];
  readonly passed: number;
  readonly adds: readonly DraftAddition[];
  readonly reach: readonly DraftReach[];
}

/** Rules on the code, each a pattern that must not appear. */
const CODE_RULES: readonly { rule: string; re: RegExp }[] = [
  { rule: 'Reaches no network (no fetch, XMLHttpRequest, WebSocket, beacons or web addresses)', re: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection)\b|\bhttps?:\/\// },
  { rule: 'Stays out of the app itself (no parallxElectron, process, require or imports)', re: /\bparallxElectron\b|\bipcRenderer\b|\bprocess\s*\.|\brequire\s*\(|^\s*import\s|\bimport\s*\(/m },
  { rule: 'Runs no code built from text (no eval or Function)', re: /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/ },
  { rule: 'Starts no timers (setInterval, setTimeout)', re: /\bset(?:Interval|Timeout)\s*\(/ },
  { rule: 'Uses theme colours, never raw ones', re: /(?<!var\(--[\w-]+,\s*)(?:#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d)/ },
  { rule: 'Uses the app\'s type (no px font sizes or font families)', re: /font-size\s*:\s*\d+(?:\.\d+)?px|fontSize\s*=\s*['"]\d+px|font-family\s*:/i },
  { rule: 'No uppercase labels and no emoji', re: /text-transform\s*:\s*uppercase|textTransform\s*=\s*['"]uppercase|[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u },
  { rule: 'No browser dialogs or native selects (the kit has both)', re: /(?<![\w.])(?:window\.)?(?:confirm|alert|prompt)\s*\(|createElement\(\s*['"]select['"]\s*\)|<select\b/ },
  { rule: 'Stays in its own space (no fixed positions, viewport units or z-index)', re: /position\s*:\s*fixed|\d\s*v[hw]\b|z-index|zIndex/ },
  { rule: 'Uses --px tokens only (no --vscode or --parallx variables)', re: /--vscode-|--parallx-/ },
];

/** Every executeCommand call names one of the extension's own commands, as a literal. */
function foreignCommands(code: string, id: string): string[] {
  const out: string[] = [];
  const re = /executeCommand\s*\(\s*([^,)]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const arg = m[1].trim();
    const name = /^['"`]([^'"`$]+)['"`]$/.exec(arg)?.[1];
    if (!name || !name.startsWith(`${id}.`)) out.push(name ?? arg);
  }
  return out;
}

const literalsOf = (code: string, call: RegExp): string[] => {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(call.source, 'g');
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
};

/** The app's API as an extension gets it: namespace to its function names. */
export type ApiSurface = Readonly<Record<string, readonly string[]>>;

/**
 * What an installed extension gets that a built-in tool does not (apiFactory:
 * `database` is per extension, undefined for built-ins), so a built-in's own
 * API object plus these is the surface an extension sees.
 */
export const EXTENSION_ONLY_API: ApiSurface = {
  database: ['open', 'close', 'migrate', 'run', 'get', 'all', 'isOpen', 'runTransaction'],
};

/** The API a live object offers (each namespace's functions), for the API check. */
export function apiSurfaceOf(api: unknown): ApiSurface {
  const out: Record<string, string[]> = {};
  for (const [ns, value] of Object.entries((api ?? {}) as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    out[ns] = Object.keys(value).filter((k) => typeof (value as Record<string, unknown>)[k] === 'function');
  }
  return out;
}

/**
 * Calls on the API that do not exist, or that are made in a shape the app
 * does not take (a model writing against an API it is guessing at). Read
 * through the name activate() gives the API, as `api.ns.fn(`.
 */
function apiMisuse(code: string, surface: ApiSurface): string[] {
  const param = /export\s+(?:async\s+)?function\s+activate\s*\(\s*([A-Za-z_$][\w$]*)/.exec(code)?.[1] ?? 'api';
  const p = param.replace(/\$/g, '\\$');
  const out = new Set<string>();
  for (const m of code.matchAll(new RegExp(`\\b${p}\\.(\\w+)\\.(\\w+)\\s*\\(`, 'g'))) {
    if (!surface[m[1]]) out.add(`${param}.${m[1]} does not exist`);
    else if (!surface[m[1]].includes(m[2])) out.add(`${param}.${m[1]}.${m[2]} does not exist (it has ${surface[m[1]].join(', ')})`);
  }
  const firstArg = (fn: string, want: RegExp, shape: string): void => {
    for (const m of code.matchAll(new RegExp(`\\b${p}\\.${fn.replace('.', '\\.')}\\s*\\(\\s*(.)`, 'g'))) {
      if (!want.test(m[1])) out.add(`${param}.${fn} takes ${shape}`);
    }
  };
  firstArg('chat.registerTool', /['"`]/, "(name, { description, parameters, handler, requiresConfirmation })");
  firstArg('commands.registerCommand', /['"`]/, "('id', handler)");
  firstArg('editors.registerEditorProvider', /['"`]/, "('typeId', { createEditorPane(container, input) })");
  firstArg('editors.openEditor', /\{/, '({ typeId, title, instanceId })');
  firstArg('canvas.registerBlock', /\{/, '({ typeId, label, description, icon, defaultConfig, render })');
  firstArg('dashboard.registerWidgetType', /\{/, '({ typeId, displayName, category, defaultSize, defaultConfig, createWidget })');
  return [...out];
}

export function readExtensionDraft(draft: ExtensionDraft, surface?: ApiSurface): DraftReading {
  const manifest = (draft?.manifest && typeof draft.manifest === 'object' ? draft.manifest : {}) as Record<string, unknown>;
  const files = (draft?.files && typeof draft.files === 'object' ? draft.files : {}) as Record<string, string>;
  const id = String(manifest.id ?? '');
  const code = Object.entries(files).filter(([n]) => /\.(js|css)$/.test(n)).map(([, t]) => String(t)).join('\n');
  const checks: DraftCheck[] = [];
  const check = (rule: string, ok: boolean, detail?: string): void => { checks.push(ok ? { rule, ok } : { rule, ok, detail }); };

  const v = validateManifest(manifest);
  check('The manifest is valid', v.valid, v.errors.map((e) => `${e.path || 'manifest'}: ${e.message}`).join('; '));
  check('Its id is lowercase with exactly one dot (publisher.name)', /^[a-z0-9-]+\.[a-z0-9-]+$/.test(id), `"${id}"`);
  check('Its code is main.js, at the top of the extension', manifest.main === 'main.js' && typeof files['main.js'] === 'string', 'set "main": "main.js" and include main.js');
  const badNames = Object.keys(files).filter((n) => !FILE_NAME.test(n));
  const bytes = Object.values(files).reduce((n, t) => n + new TextEncoder().encode(String(t)).length, 0);
  check('Only its own small files (.js, .css, .json, .md; under 512 KB)', badNames.length === 0 && bytes <= MAX_BYTES,
    badNames.length ? `not allowed: ${badNames.join(', ')}` : `${Math.round(bytes / 1024)} KB`);
  check('It has an activate function', /export\s+(?:async\s+)?function\s+activate\b/.test(files['main.js'] ?? ''), 'export function activate(api, context)');
  for (const r of CODE_RULES) {
    const hit = r.re.exec(code);
    check(r.rule, !hit, hit ? `found "${hit[0].trim().slice(0, 40)}"` : undefined);
  }
  if (surface) {
    const misuse = apiMisuse(files['main.js'] ?? '', surface);
    check('Calls only the app API that exists, in the shapes it takes', misuse.length === 0, misuse.slice(0, 4).join('; '));
  }
  const labelIssues = lintActionLabels(actionLabelsInCode(code));
  check('Writes actions in Title Case, with no em dashes or three dots', labelIssues.length === 0, labelIssues.map((i) => `${i.rule}: ${i.detail}`).join('; '));
  const foreign = foreignCommands(code, id);
  check('Runs only its own commands (no other tool\'s)', foreign.length === 0, foreign.length ? `runs ${foreign.slice(0, 3).join(', ')}` : undefined);

  // What it adds: the manifest's contributions and what its code registers.
  const contributes = (manifest.contributes && typeof manifest.contributes === 'object' ? manifest.contributes : {}) as Record<string, unknown>;
  const list = (k: string): Record<string, unknown>[] => (Array.isArray(contributes[k]) ? contributes[k] as Record<string, unknown>[] : []);
  const adds: DraftAddition[] = [
    ...list('editors').map((e) => ({ kind: 'Editor tab', what: String(e.displayName ?? e.name ?? e.id ?? 'A tab') })),
    ...list('views').map((e) => ({ kind: 'Panel', what: String(e.name ?? e.id ?? 'A panel') })),
    ...list('commands').map((e) => ({ kind: 'Command', what: String(e.title ?? e.id ?? 'A command') })),
    ...literalsOf(code, /chat\.registerTool\(\s*['"`]([^'"`]+)['"`]/).map((n) => ({ kind: 'AI tool', what: `${n}, so chat can use it` })),
    ...literalsOf(code, /canvas\.registerBlock\(\s*\{[^}]*?label\s*:\s*['"`]([^'"`]+)['"`]/).map((n) => ({ kind: 'Page block', what: n })),
    ...literalsOf(code, /dashboard\.registerWidgetType\(\s*\{[^}]*?displayName\s*:\s*['"`]([^'"`]+)['"`]/).map((n) => ({ kind: 'Dashboard widget', what: n })),
    ...(/\bapi\.database\b/.test(code) ? [{ kind: 'Saved data', what: 'Its own table, kept when it is turned off' }] : []),
  ];

  // What it can reach, as its manifest and its code say.
  const fs = (manifest.capabilities as { fs?: { scope?: string; modes?: string[] } } | undefined)?.fs;
  const passes = (rule: string): boolean => checks.find((c) => c.rule === rule)?.ok ?? false;
  const reach: DraftReach[] = [
    fs && fs.scope !== 'extension-data'
      ? { what: `Workspace files (${(fs.modes ?? ['read']).includes('write') ? 'read and write' : 'read'})`, allowed: true }
      : { what: 'Your workspace files', allowed: /\bworkspace\.fs\b/.test(code) },
    ...(/\bapi\.lm\b/.test(code) ? [{ what: 'Your AI model', allowed: true }] : []),
    { what: 'The internet', allowed: !passes(CODE_RULES[0].rule) },
    { what: 'Other tools and their data', allowed: !passes('Runs only its own commands (no other tool\'s)') },
  ];

  return {
    id,
    name: String(manifest.name ?? id),
    description: String(manifest.description ?? ''),
    checks,
    passed: checks.filter((c) => c.ok).length,
    adds,
    reach,
  };
}

/** The checks that failed, as the assistant needs them to fix the draft. */
export function draftFailures(reading: DraftReading): string {
  return reading.checks.filter((c) => !c.ok).map((c) => `- ${c.rule}${c.detail ? ` (${c.detail})` : ''}`).join('\n');
}
