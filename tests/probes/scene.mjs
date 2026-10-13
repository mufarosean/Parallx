// scene.mjs: what every probe shares. Launching the hidden app, and driving
// it by the ids the kit declares (docs/SELF_DESCRIBING_UI_DESIGN.md
// section 7) instead of by CSS class names.
//
// import { launchApp, sceneOf, click, type, cmd } from './scene.mjs';

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** The hidden app's environment: test mode, its own data folder, no real workspace. */
export function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, {
    PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1',
    PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache'),
  });
  return env;
}

/**
 * Starts the app on `appRoot` and returns `{ app, page, errors }` once the
 * workbench is up. Software WebGL, because a container has no GPU. The
 * hidden copy never reaches the Ollama the real app uses.
 */
export async function launchApp(appRoot) {
  const errors = [];
  const app = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 400)}`));
  // The refused Ollama route above shows as a resource error; it is not one.
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(`console: ${m.text().slice(0, 400)}`); });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(2_500);
  return { app, page, errors };
}

/** Runs a command by id in the page. Resolves true, or the error's message. */
export async function cmd(page, id, ...args) {
  return page.evaluate(async ({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    if (!svc) return 'no command service';
    try { await svc.executeCommand(id, ...args); return true; } catch (e) { return String(e?.message || e); }
  }, { id, args });
}

/** Starts a command and returns at once: for one that opens a dialog and waits for its answer. */
export async function cmdNoWait(page, id, ...args) {
  await page.evaluate(({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    void svc?.executeCommand(id, ...args)?.catch?.(() => {});
  }, { id, args });
}

/**
 * Every tool the app knows: `{ id, builtin, required, enabled }`. With
 * setToolEnabled, the one other reach into the workbench besides cmd and
 * sceneOf: probes turn tools on and off through these, never directly.
 */
export async function toolList(page) {
  return page.evaluate(() => {
    const services = window.__parallx_workbench__?._services;
    const reg = services?.get?.({ id: 'IToolRegistryService' });
    const en = services?.get?.({ id: 'IToolEnablementService' });
    return (reg?.getAll?.() ?? []).map((t) => {
      const d = t.description ?? t;
      const m = d.manifest ?? d;
      return { id: m.id, builtin: !!d.isBuiltin, required: !!m.required, enabled: en?.isEnabled?.(m.id) ?? true };
    });
  });
}

/** Turns a tool on or off. Resolves true, or the error's message. */
export async function setToolEnabled(page, id, on) {
  return page.evaluate(async ({ id, on }) => {
    const en = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
    if (!en) return 'no enablement service';
    try { await en.setEnablement(id, on); return true; } catch (e) { return String(e?.message || e); }
  }, { id, on });
}

/**
 * Sets a setting as the Settings page would. Like toolList, a reach into the
 * workbench a probe makes only through this file.
 */
export async function setSetting(page, key, value) {
  return page.evaluate(async ({ key, value }) => {
    const c = window.__parallx_workbench__?._services?.get?.({ id: 'IConfigurationService' });
    if (!c) return 'no configuration service';
    try { await c._updateValue(key, value); return true; } catch (e) { return String(e?.message || e); }
  }, { key, value });
}

/** A registered setting as `key type [choices]`, or 'not registered'. */
export async function settingSchema(page, key) {
  return page.evaluate((key) => {
    const r = window.__parallx_workbench__?._services?.get?.({ id: 'ISettingsRegistryService' });
    const sc = r?.getSchema?.(key);
    return sc ? `${sc.key} ${sc.type} [${(sc.enumValues || sc.enum || []).join(',')}]` : 'not registered';
  }, key);
}

/** The messages the app showed since the last call, each with its actions; reading clears them. */
export async function messages(page) {
  return page.evaluate(() => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'INotificationService' });
    const out = (svc?.history ?? []).map((n) => n.message + (n.actions?.length ? ` [${n.actions.map((a) => a.title || a).join(' | ')}]` : ''));
    svc?.clearHistory?.();
    return out;
  });
}

/**
 * The topmost open context menu's rows, from the scene: `{ id, label, off,
 * checked, key, separatorBefore }`. The key and the group breaks are read
 * from the row's element. Null with no menu open.
 */
export async function menuRows(page) {
  const menus = (await sceneOf(page)).surfaces.filter((s) => s.id === 'contextMenu');
  const rows = menus[menus.length - 1]?.children ?? [];
  if (!menus.length) return null;
  const dom = await page.evaluate((ids) => ids.map((id) => {
    const els = Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`));
    const el = els[els.length - 1];
    const prev = el?.previousElementSibling;
    return { text: el?.textContent ?? '', sep: !!prev && !prev.hasAttribute('data-px-id') };
  }), rows.map((r) => r.id));
  return rows.map((r, i) => ({
    id: r.id,
    label: r.label,
    off: r.state?.kind === 'enabled' && r.state.value === false,
    checked: r.state?.kind === 'pressed' ? r.state.value : undefined,
    key: dom[i].text.replace(r.label, '').replace('✓', '').trim(),
    separatorBefore: i > 0 && dom[i].sep,
  }));
}

/**
 * Picks the topmost menu's row by label (a string matches exactly, a RegExp
 * tests), pressing it in the page: a menu opened at a card's corner can sit
 * where the hidden window takes no real click. Resolves whether one matched.
 */
export async function pickMenu(page, label) {
  const row = (await menuRows(page))?.find((r) => (typeof label === 'string' ? r.label === label : label.test(r.label)));
  if (!row) return false;
  await page.evaluate((id) => { const els = Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`)); els[els.length - 1]?.click(); }, row.id);
  return true;
}

/** `scene.describe(scope)` from the page, as plain data. */
export async function sceneOf(page, scope) {
  return page.evaluate(({ scope }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IIntrospectionService' });
    if (!svc) throw new Error('no introspection service');
    return svc.describeScene(scope);
  }, { scope });
}

/** Every node of a description, flattened, with its parent surface id. */
export function flatten(description) {
  const out = [];
  const walk = (node, parent) => {
    out.push({ ...node, parent });
    for (const c of node.children ?? []) walk(c, node.id);
  };
  for (const s of description.surfaces) walk(s, undefined);
  return out;
}

/**
 * The element with data-px-id === id. When several are mounted, the one
 * whose surface is visible; `opts.instance` picks a specific surface
 * instance. Throws naming the ids under the same surface when none is found.
 */
async function locate(page, id, opts = {}) {
  const selector = opts.instance
    ? `[data-px-instance="${opts.instance}"] [data-px-id="${id}"]`
    : `[data-px-id="${id}"]`;
  const all = page.locator(selector);
  const n = await all.count();
  if (n === 0) {
    const nodes = flatten(await sceneOf(page));
    const owner = id.includes('.') ? id.slice(0, id.indexOf('.')) : id;
    const near = nodes.filter((x) => x.id !== id && (x.parent === owner || x.id.startsWith(owner + '.'))).map((x) => x.id).slice(0, 20);
    throw new Error(`no control "${id}" on screen; near it: ${near.join(', ') || 'nothing'}`);
  }
  for (let i = 0; i < n; i++) {
    const one = all.nth(i);
    if (await one.isVisible()) return one;
  }
  return all.first();
}

/** A real click on the control with this id. */
export async function click(page, id, opts) {
  const el = await locate(page, id, opts);
  await el.click();
}

/** Focus the input with this id, select all, type, and blur. */
export async function type(page, id, text, opts) {
  const el = await locate(page, id, opts);
  const input = el.locator('input, textarea').first();
  const target = (await input.count()) ? input : el;
  await target.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await target.blur().catch(() => {});
}

/** Opens a workspace file by name through quick open, as a person would. */
export async function openFile(page, name) {
  await page.keyboard.press('Escape');
  await cmd(page, 'workbench.action.quickOpen');
  await page.waitForSelector('[data-px-id="quickAccess.input"]', { timeout: 5_000 });
  await page.keyboard.type(name);
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_500);
}

/**
 * A one-page PDF with a line of text, written by hand with a correct
 * cross-reference table, so a probe can open a real PDF without a browser
 * to print one.
 */
export function tinyPdf(text = 'Hello from Parallx') {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = `BT /F1 24 Tf 72 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  objects[3] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
