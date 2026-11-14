// document-reader-probe.mjs: the document reader's place in Settings, through
// every state, in a hidden copy of the app on a throwaway workspace.
//
// Nothing is downloaded and no engine is touched. The main process's answers
// about the reader's engine are replaced, in this hidden copy only, by a
// stand-in that behaves like a set-up: it reports steps with a fraction and
// bytes, can be stopped part of the way and carried on, starts, and is
// removed. Everything on screen is the app's real path: the command that
// opens Settings on the panel, the panel's buttons and their commands, the
// progress drawn in place, the notice when a set-up ends with Settings
// closed, the question before removing, and the PDF view's Reading side when
// there is no reader.
//
// Usage: node tests/probes/document-reader-probe.mjs [outDir]
// Requires `npm run build` first (the app loads dist/). Run it from Bash.

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { launchApp, openFile, cmd, tinyPdf } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-document-reader'));
const GB = 1024 ** 3;

/** In the main process: stand-ins for the reader's engine. `world` is kept on globalThis so later calls can steer it. */
function standIn({ ipcMain, BrowserWindow }, GB) {
  const world = globalThis.__readerWorld = { state: 'absent', installed: false, status: 'unavailable', installing: false, cancelled: false, hold: false, removed: 0, installs: 0 };
  const send = (payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('runtimes:progress', { id: 'docling', kind: 'install', ...payload }); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const replace = (channel, fn) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_e, ...args) => fn(...args)); };
  replace('docling:status', () => ({ status: world.status, port: null, pythonPath: null, doclingInstalled: world.installed, engine: world.installed ? 'managed' : null }));
  replace('docling:engineStatus', (withSize) => ({ state: world.state, installing: world.installing, bytesOnDisk: withSize && world.state !== 'absent' ? (world.state === 'ready' ? 7.5 * GB : 3.1 * GB) : null, downloadBytes: 3.9 * GB, packageBytes: 3.2 * GB, machine: { ok: true, problems: [] }, engine: world.installed ? 'managed' : null, running: world.status === 'available' }));
  replace('docling:start', () => { if (!world.installed) return { ok: false, error: 'It is not set up.' }; world.status = 'available'; return { ok: true }; });
  replace('docling:cancelInstall', () => { world.cancelled = true; return true; });
  replace('docling:removeEngine', () => { world.removed++; world.state = 'absent'; world.installed = false; world.status = 'unavailable'; return { ok: true }; });
  replace('docling:reading', () => null);
  replace('docling:install', async () => {
    world.installs++;
    world.installing = true; world.cancelled = false;
    const stopped = () => { world.installing = false; world.state = 'partial'; send({ step: 'error', label: 'Stopped. Setting up again carries on from here.', fraction: 0, done: true }); return { ok: false, pythonPath: null, output: 'Setting up stopped.', alreadyInstalled: false, stopped: true }; };
    const steps = [
      { step: 'check', label: 'Checking this computer', fraction: 0 },
      { step: 'python', label: 'Installing Python', fraction: 0.05 },
      { step: 'packages', label: 'Installing its packages (the largest is about 3 GB)', fraction: 0.1 },
      ...[0.2, 0.5, 0.8, 1].map((k) => ({ step: 'files', label: 'Downloading layout.onnx', fraction: 0.4 + 0.55 * k, received: 3.9 * GB * k, total: 3.9 * GB })),
      { step: 'selftest', label: 'Checking it runs. The first run reads the model from disk, which can take a few minutes.', fraction: 0.97 },
    ];
    for (const s of steps) {
      send(s);
      // `hold` keeps the set-up on its download until the probe has looked at it.
      do { await wait(250); if (world.cancelled) return stopped(); } while (world.hold && s.step === 'files' && s.fraction < 0.9);
    }
    world.installing = false; world.state = 'ready'; world.installed = true;
    send({ step: 'done', label: 'Ready', fraction: 1 });
    return { ok: true, pythonPath: null, output: 'The document reader is set up.', alreadyInstalled: false, stopped: false };
  });
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-dr-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-dr-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  await fs.writeFile(path.join(workspace, 'hello.pdf'), tinyPdf('The selected tail factor is 1.05.'));

  const { app, page, errors } = await launchApp(appRoot);
  let failed = 0;
  const check = (ok, what) => { if (!ok) failed++; console.log(`[reader] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const shot = async (name) => {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.invalidate(); await new Promise((r) => setTimeout(r, 250)); await wc.capturePage(); await new Promise((r) => setTimeout(r, 400)); const img = await wc.capturePage(); return img.isEmpty() ? '' : img.toPNG().toString('base64'); });
    if (b64) { await fs.writeFile(path.join(outDir, name), Buffer.from(b64, 'base64')); console.log(`[reader] picture -> ${path.join(outDir, name)}`); }
  };
  const world = (patch) => app.evaluate((_e, patch) => Object.assign(globalThis.__readerWorld, patch ?? {}), patch ?? null);
  /** The panel as it stands: its facts, its buttons, its progress, what has the focus. */
  const panel = () => page.evaluate(() => {
    const r = document.querySelector('.reader-settings');
    const bar = r?.querySelector('[role="progressbar"]');
    return r ? {
      facts: Object.fromEntries([...r.querySelectorAll('th')].map((th) => [th.textContent, th.nextElementSibling?.textContent])),
      buttons: [...r.querySelectorAll('button')].map((b) => b.textContent),
      progress: bar ? Number(bar.getAttribute('aria-valuenow')) : null,
      notes: [...r.querySelectorAll('.reader-settings__note')].map((n) => n.textContent).filter(Boolean),
      alert: r.querySelector('[role="alert"]')?.textContent ?? '',
      focus: document.activeElement && r.contains(document.activeElement) ? document.activeElement.textContent : '',
    } : null;
  });
  const until = (fn, arg, ms = 20_000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const stateIs = (text, ms) => until((text) => [...document.querySelectorAll('.reader-settings th')].some((th) => th.textContent === 'State' && th.nextElementSibling?.textContent === text), text, ms);
  /** Press a button of the panel from the keyboard: the focus on it, then Enter. */
  const press = async (label) => {
    const ok = await page.evaluate((label) => { const b = [...document.querySelectorAll('.reader-settings button')].find((x) => x.textContent === label); b?.focus(); return !!b && document.activeElement === b; }, label);
    if (ok) await page.keyboard.press('Enter');
    return ok;
  };

  try {
    await app.evaluate(standIn, GB);

    // 1. Not set up: the command opens Settings on the panel, which says so and offers Set Up.
    await cmd(page, 'parallx.installDocling');
    check(await stateIs('Not set up'), 'Set Up Document Reader… opens Settings on the Document Reader panel, which says it is not set up');
    const absent = await panel();
    console.log(`[reader] not set up: ${JSON.stringify(absent)}`);
    check(absent?.facts.Size === 'Downloads about 7.1 GB once, for every workspace' && /processor/.test(absent?.facts['Runs on'] ?? ''), `it says what a set-up downloads and where the reader runs (${JSON.stringify(absent?.facts)})`);
    check(JSON.stringify(absent?.buttons) === '["Set Up"]', `it offers Set Up and nothing else (${JSON.stringify(absent?.buttons)})`);
    check(await page.evaluate(() => { const on = document.querySelector('.settings-editor__nav-item--active, .settings-editor__nav [aria-current], .settings-editor__nav [aria-selected="true"]'); return /Document Reader/.test(on?.textContent ?? ''); }), 'the list at the side marks Document Reader as the open panel');
    await shot('reader-not-set-up.png');

    // 2. Set Up, from the keyboard: progress in place, and Stop stays the same button under the focus.
    await world({ hold: true });
    check(await press('Set Up'), 'Set Up takes the keyboard\'s focus');
    check(await stateIs('Setting up'), 'pressing it starts the set-up');
    await until(() => Number(document.querySelector('.reader-settings [role="progressbar"]')?.getAttribute('aria-valuenow')) >= 40);
    const during = await panel();
    console.log(`[reader] setting up: ${JSON.stringify(during)}`);
    check(during?.progress >= 40 && during.notes.some((n) => /Downloading layout\.onnx/.test(n)) && during.notes.some((n) => /GB of 3\.9 GB/.test(n)), `the panel shows the step, how far along it is and the bytes (${during?.progress}%)`);
    check(JSON.stringify(during?.buttons) === '["Stop"]' && during?.focus === 'Stop', `Stop is the one button, and the keyboard's focus is on it (focus: "${during?.focus}")`);
    await shot('reader-setting-up.png');

    // 3. Stop: what is done is kept, and Carry On is offered where the focus is.
    await page.keyboard.press('Enter');
    check(await stateIs('Setting up stopped part of the way'), 'Stop stops the set-up part of the way');
    const partial = await panel();
    console.log(`[reader] stopped: ${JSON.stringify(partial)}`);
    check(JSON.stringify(partial?.buttons) === '["Carry On Setting Up","Remove…"]' && partial?.focus === 'Carry On Setting Up', `Carry On Setting Up and Remove… are offered, the focus on the first (${JSON.stringify(partial?.buttons)}, focus: "${partial?.focus}")`);
    check(!partial?.alert, 'stopping is not shown as an error');
    await shot('reader-stopped.png');

    // 4. Carry on, and close Settings while it runs: one notice says how it ended.
    await world({ hold: false });
    await page.keyboard.press('Enter');
    check(await stateIs('Setting up'), 'Carry On Setting Up carries on');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(await page.evaluate(() => !document.querySelector('.reader-settings')), 'Settings closes while the set-up runs');
    const told = await until(() => /The document reader is set up and running/.test(document.body.textContent ?? ''), null, 30_000);
    check(told, 'when it ends with Settings closed, a notice says the reader is set up and running');
    await shot('reader-notice.png');
    const after = await world();
    check(after.installs === 2 && after.state === 'ready' && after.status === 'available', `the set-up ran to its end and the reader was started (${JSON.stringify({ installs: after.installs, state: after.state, status: after.status })})`);

    // 5. Set up and running: its size, and Remove… alone.
    await cmd(page, 'parallx.installDocling');
    check(await stateIs('Set up and running'), 'the panel says the reader is set up and running');
    await until(() => /GB on this computer/.test(document.querySelector('.reader-settings')?.textContent ?? ''));
    const ready = await panel();
    check(ready?.facts.Size === '7.5 GB on this computer' && JSON.stringify(ready?.buttons) === '["Remove…"]', `it says what the reader takes on disk and offers Remove… (${JSON.stringify(ready?.facts)})`);

    // 6. The PDF view's Reading side follows the same reader: Read Now when it is there.
    await page.keyboard.press('Escape');
    await openFile(page, 'hello.pdf');
    await page.waitForTimeout(1_500);
    const pdf = page.locator('.pdf-editor-pane:visible').first();
    await pdf.locator('button[aria-label="Outline, Pages And Reading"]').click();
    await pdf.locator('.pdf-side-panel-header .ui-segmented-control__segment', { hasText: 'Reading' }).click();
    const sideHas = (label) => until((label) => [...document.querySelectorAll('.pdf-reading button')].some((b) => b.getClientRects().length && b.textContent === label), label, 15_000);
    check(await sideHas('Read Now'), 'with the reader set up, a PDF it has not read offers Read Now on its Reading side');

    // 7. Remove…: asked first, and only a yes removes.
    await cmd(page, 'parallx.installDocling');
    await stateIs('Set up and running');
    await until(() => /GB on this computer/.test(document.querySelector('.reader-settings')?.textContent ?? ''));
    await press('Remove…');
    await page.locator('.parallx-modal-box').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const asked = await page.evaluate(() => document.querySelector('.parallx-modal-box')?.textContent ?? '');
    check(/Remove the document reader\?/.test(asked) && /It frees 7\.5 GB\./.test(asked) && /What it has already read is kept\./.test(asked), `Remove… asks first and says what removing means (${JSON.stringify(asked.slice(0, 220))})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check((await world()).removed === 0 && await stateIs('Set up and running', 3_000), 'Escape answers no: nothing is removed');
    check((await panel())?.focus === 'Remove…', 'and the focus is back on Remove…');
    await press('Remove…');
    await page.locator('.parallx-modal-box').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await page.locator('.parallx-modal-box button', { hasText: /^Remove$/ }).click();
    check(await stateIs('Not set up'), 'a yes removes the reader, and the panel says it is not set up');
    check((await world()).removed === 1, 'it was removed once');
    await shot('reader-removed.png');

    // 8. With no reader, the Reading side says what that means and leads back to Settings.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // The side asks again when it is shown: switch away and back.
    await pdf.locator('.pdf-side-panel-header .ui-segmented-control__segment', { hasText: 'Pages' }).click();
    await pdf.locator('.pdf-side-panel-header .ui-segmented-control__segment', { hasText: 'Reading' }).click();
    check(await sideHas('Set Up Document Reader…'), 'with no reader, the Reading side offers Set Up Document Reader…');
    const sideText = await page.evaluate(() => { const p = [...document.querySelectorAll('.pdf-editor-pane')].find((x) => x.getClientRects().length); return p?.querySelector('.pdf-reading')?.textContent ?? ''; });
    check(/The document reader is not set up\. A PDF is read as plain text, and a scan is not read at all\./.test(sideText), `and says what that means (${JSON.stringify(sideText.slice(0, 160))})`);
    await shot('reading-side-no-reader.png');
    await pdf.locator('.pdf-reading button', { hasText: 'Set Up Document Reader…' }).click();
    check(await stateIs('Not set up'), 'its button opens Settings on the Document Reader panel');

    const faults = errors.filter((e) => !/Cannot connect to Ollama|ERR_CONNECTION_REFUSED|ERR_FAILED|Failed to fetch/.test(e));
    check(faults.length === 0, `no errors in the window${faults.length ? `: ${faults.slice(0, 3).join(' || ')}` : ''}`);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failed ? `[reader] ${failed} FAILED` : '[reader] 0 problems');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
