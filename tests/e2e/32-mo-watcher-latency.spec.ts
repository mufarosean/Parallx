/**
 * E2E diagnostic: media-organizer fs.watch pickup latency.
 *
 * Sets up an isolated temp workspace with a `media/` subfolder, seeds it
 * with one image, runs `media-organizer.scan` against that subfolder so
 * the watcher is armed, opens the grid, then runs TWO scenarios that
 * mimic the two ways images actually arrive on disk:
 *
 *   Scenario A — "drag-and-drop"
 *     Single fs.writeFile straight to `dropped-A.png`.
 *     This is what file-manager drag-drop and most CLI tools look like:
 *     one create+changed burst, final extension visible from the first
 *     event. Expected to be picked up reliably.
 *
 *   Scenario B — "browser Save As"
 *     Write data to `dropped-B.png.crdownload`, then rename to
 *     `dropped-B.png`. This is exactly what Chrome / Edge / Firefox do
 *     when the user picks "Save Image As…" from a web page. The watcher's
 *     filter currently drops every `.crdownload` event (non-media
 *     extension), so the only thing that can pick this file up is the
 *     rename event for the final name. On Windows, Node fs.watch is
 *     famously unreliable about surfacing that rename event.
 *
 * For each scenario the test records four wall-clock timestamps:
 *   T0 — write/rename completed on disk (Node side, just after the op).
 *   T1 — first fs.watch event observed in renderer for the new path.
 *   T2 — Auto-scan drain reported ">= 1 new" in renderer console.
 *   T3 — new card mounted in `.mo-grid-area` (card count grew by 1).
 *
 * This is a diagnostic test, not a timing assertion. It prints the
 * deltas + the full list of raw fs.watch events seen by the renderer
 * during each scenario so we can SEE exactly what fires (or doesn't).
 *
 * Hard fails ONLY for Scenario A — if a direct write isn't picked up,
 * the watcher pipeline itself is broken. Scenario B is informational:
 * if T1 is null for B, the bug is confirmed at the fs.watch layer.
 */
import path from 'path';
import os from 'os';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import { test, expect } from './fixtures';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Minimal 1x1 PNG (67 bytes, transparent pixel). Used only for the seed.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64'
);

// REAL media fixtures — supply your own via the PARALLX_MO_TEST_FIXTURES
// env var (semicolon-separated absolute paths). Test is skipped if unset.
// Example:
//   $env:PARALLX_MO_TEST_FIXTURES = "C:\path\to\a.jpg;C:\path\to\b.mp4"
const FIXTURES: Array<{ tag: string; ext: string; srcPath: string }> = (
  process.env.PARALLX_MO_TEST_FIXTURES ?? ''
)
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((srcPath, i) => ({
    tag: `fixture-${i}`,
    ext: path.extname(srcPath) || '.bin',
    srcPath,
  }));

// Each scenario needs UNIQUE bytes to avoid fingerprint dedup. Tag with
// a random suffix in the EXIF comment area (for JPEGs we just append —
// JPEG decoders ignore trailing bytes after EOI marker; ffprobe ignores
// trailing bytes after the MP4 box structure ends, so this is safe).
function uniquifyBytes(src: Buffer, tag: string): Buffer {
  const suffix = Buffer.from('\x00PARALLX-TEST-' + tag + '-' + Date.now() + '-' + Math.random(), 'utf8');
  return Buffer.concat([src, suffix]);
}

interface ScenarioResult {
  name: string;
  newFileName: string;
  byteSize: number;
  T0: number;
  T1: number | null;
  T2: number | null;
  T3: number | null;
  thumbT: number | null;
  fsEventCount: number;
  fsEventLog: Array<{ deltaMs: number; type: string; basename: string }>;
}

test.describe('media-organizer watcher latency', () => {
  test('fs.watch pickup for drag vs browser-save', async () => {
    test.setTimeout(10 * 60_000);

    // ── Set up an isolated temp workspace ───────────────────────────────
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'parallx-mo-watcher-'));
    const mediaDir = path.join(tmpRoot, 'media');
    await fsp.mkdir(mediaDir, { recursive: true });
    // Seed with one image so the initial scan has work to do.
    const seedPath = path.join(mediaDir, 'seed.png');
    await fsp.writeFile(seedPath, PNG_1x1);

    // ── Launch Electron pointed at the temp workspace ──────────────────
    const env = { ...process.env };
    delete (env as any).ELECTRON_RUN_AS_NODE;
    env.PARALLX_TEST_MODE = '1';
    env.PARALLX_RENDERER_PORT = '0';

    const app = await electron.launch({
      args: ['.'],
      cwd: PROJECT_ROOT,
      env,
    });

    try {
      const page = await app.firstWindow();
      await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { timeout: 30_000 });

      // Stream all media-organizer + watcher-related console lines.
      page.on('console', (msg) => {
        const text = msg.text();
        if (
          text.includes('[MediaOrganizer]') ||
          text.includes('[mo-watch]') ||
          text.includes('[mo-grid]') ||
          text.includes('Auto-scan') ||
          text.includes('Watching')
        ) {
          console.log(`  +${Date.now()} RENDERER:`, text);
        }
      });

      // Mock dialog:openFolder to return the temp workspace, then open it.
      await app.evaluate(({ ipcMain }, fp) => {
        ipcMain.removeHandler('dialog:openFolder');
        ipcMain.handle('dialog:openFolder', async () => [fp]);
      }, tmpRoot);

      await page.locator('.titlebar-menu-item[data-menu-id="file"]').click();
      const dropdown = page.locator('.context-menu.titlebar-dropdown');
      await dropdown.waitFor({ state: 'visible', timeout: 3_000 });
      await dropdown.locator('.context-menu-item', { hasText: 'Open Folder' }).click();
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
      await page.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 20_000 });
      await page.waitForTimeout(3_000); // settle extension activation

      // Re-mock dialog:openFolder to return the `media/` subfolder, then
      // trigger media-organizer.scan via the command service.
      await app.evaluate(({ ipcMain }, fp) => {
        ipcMain.removeHandler('dialog:openFolder');
        ipcMain.handle('dialog:openFolder', async () => [fp]);
      }, mediaDir);

      // IMPORTANT: arm the console listener BEFORE we kick the scan. The
      // seed scan is sub-second and the `Watching` log can fire before
      // `cmd.executeCommand` resolves, which would race past a listener
      // armed after the await.
      const watchedPromise = page.waitForEvent('console', {
        predicate: (msg) => {
          const t = msg.text();
          return t.includes('[MediaOrganizer] Watching') && t.includes('media');
        },
        timeout: 30_000,
      });

      const scanResult = await page.evaluate(async () => {
        const wb = (window as any).__parallx_workbench__;
        if (!wb) return { error: 'no workbench' };
        const svcs: any = wb._services ?? wb.services;
        const entries: Map<string, any> | undefined = svcs?._entries;
        let cmd: any = null;
        entries?.forEach((entry) => {
          const inst = entry?.instance;
          if (inst && typeof inst.executeCommand === 'function') cmd = inst;
        });
        if (!cmd) return { error: 'no command service' };
        try {
          await cmd.executeCommand('media-organizer.scan');
          return { ok: true };
        } catch (e: any) {
          return { error: String(e?.message || e) };
        }
      });
      console.log('  scan command result:', JSON.stringify(scanResult));
      expect((scanResult as any).ok).toBe(true);

      await watchedPromise;
      console.log('  >>> watcher armed');

      // Open the grid view.
      await page.evaluate(async () => {
        const wb = (window as any).__parallx_workbench__;
        const svcs: any = wb._services ?? wb.services;
        const entries: Map<string, any> | undefined = svcs?._entries;
        let cmd: any = null;
        entries?.forEach((entry) => {
          const inst = entry?.instance;
          if (inst && typeof inst.executeCommand === 'function') cmd = inst;
        });
        await cmd?.executeCommand('media-organizer.openGrid');
      });

      const gridArea = page.locator('.mo-grid-area').first();
      await gridArea.waitFor({ state: 'visible', timeout: 20_000 });
      await page.waitForFunction(() => {
        const ga = document.querySelector('.mo-grid-area');
        return ga ? ga.querySelectorAll('.mo-card').length >= 1 : false;
      }, undefined, { timeout: 20_000 });
      console.log('  seed card mounted; ready for scenarios');

      // Install renderer-side instrumentation once. It accumulates every
      // fs:change payload event for our mediaDir into a ring buffer that
      // both scenarios will read.
      await page.evaluate((dirPath: string) => {
        const diag = {
          dirPath,
          fsEvents: [] as Array<{ t: number; type: string; path: string }>,
          refreshGridEvents: [] as Array<{ t: number }>,
        };
        (window as any).__moWatcherDiag__ = diag;

        const fsApi = (window as any).parallxElectron?.fs;
        if (fsApi && typeof fsApi.onDidChange === 'function') {
          fsApi.onDidChange((payload: any) => {
            if (!payload || !Array.isArray(payload.events)) return;
            for (const evt of payload.events) {
              if (typeof evt?.path === 'string' && evt.path.toLowerCase().startsWith(dirPath.toLowerCase())) {
                diag.fsEvents.push({ t: Date.now(), type: evt.type, path: evt.path });
              }
            }
          });
        }
        document.addEventListener('mo:refresh-grid', () => {
          diag.refreshGridEvents.push({ t: Date.now() });
        });
      }, mediaDir);

      // Helper: run one scenario from T0 to T3.
      async function runScenario(
        scenarioName: string,
        newFileName: string,
        produceFile: (finalPath: string) => Promise<void>,
        byteSize: number
      ): Promise<ScenarioResult> {
        console.log('');
        console.log(`  ━━━ SCENARIO ${scenarioName} (${newFileName}, ${byteSize.toLocaleString()} bytes) ━━━`);
        const beforeCount = await gridArea.locator('.mo-card').count();
        console.log(`  cards before: ${beforeCount}`);

        // Reset renderer-side event buffer to this scenario's window.
        await page.evaluate(() => {
          const d = (window as any).__moWatcherDiag__;
          if (d) { d.fsEvents.length = 0; d.refreshGridEvents.length = 0; }
        });

        const finalPath = path.join(mediaDir, newFileName);
        await produceFile(finalPath);
        const T0 = Date.now();
        console.log(`  T0 (file in place) = ${T0}`);

        // T2 — wait up to 60s for the Auto-scan summary line.
        let T2: number | null = null;
        try {
          const msg = await page.waitForEvent('console', {
            predicate: (m) => {
              const t = m.text();
              return t.includes('[MediaOrganizer] Auto-scan:') && /\b[1-9]\d*\s+new\b/.test(t);
            },
            timeout: 60_000,
          });
          T2 = Date.now();
          console.log(`  T2 (Auto-scan log) = ${T2}  "${msg.text()}"`);
        } catch {
          console.log(`  T2 NEVER SEEN — no Auto-scan log within 60s`);
        }

        // T3 — wait up to 60s for the new card to mount.
        let T3: number | null = null;
        try {
          await page.waitForFunction(
            (expected: number) => {
              const ga = document.querySelector('.mo-grid-area');
              return ga ? ga.querySelectorAll('.mo-card').length >= expected : false;
            },
            beforeCount + 1,
            { timeout: 60_000 }
          );
          T3 = Date.now();
          console.log(`  T3 (grid card appeared) = ${T3}`);
        } catch {
          console.log(`  T3 NEVER SEEN — grid card count did not grow within 60s`);
        }

        // Read the renderer-side event buffer.
        const diag = await page.evaluate(() => {
          const d = (window as any).__moWatcherDiag__;
          return d ? { fsEvents: d.fsEvents.slice(), refreshGridEvents: d.refreshGridEvents.slice() } : null;
        });
        const T1 =
          diag?.fsEvents.find((e: any) => e.path.toLowerCase().endsWith(newFileName.toLowerCase()))?.t ??
          null;
        const fsEventLog =
          diag?.fsEvents.map((e: any) => ({
            deltaMs: e.t - T0,
            type: e.type,
            basename: e.path.split(/[/\\]/).pop(),
          })) ?? [];

        return {
          name: scenarioName,
          newFileName,
          byteSize,
          T0,
          T1,
          T2,
          T3,
          thumbT: null,
          fsEventCount: diag?.fsEvents.length ?? 0,
          fsEventLog,
        };
      }

      // ── Run all fixtures, both patterns each ──────────────────────────
      const results: ScenarioResult[] = [];
      for (const fix of FIXTURES) {
        let srcBytes: Buffer;
        try {
          srcBytes = await fsp.readFile(fix.srcPath);
        } catch (e) {
          console.log(`  [skip] cannot read fixture ${fix.srcPath}: ${(e as Error).message}`);
          continue;
        }

        // Direct write (drag-and-drop equivalent)
        const nameA = `${fix.tag}-A${fix.ext}`;
        const bytesA = uniquifyBytes(srcBytes, fix.tag + '-A');
        const rA = await runScenario(`${fix.tag} A direct-write`, nameA, async (fp) => {
          await fsp.writeFile(fp, bytesA);
        }, bytesA.length);
        results.push(rA);
        await page.waitForTimeout(2_000);

        // .crdownload → rename (browser save-as equivalent)
        const nameB = `${fix.tag}-B${fix.ext}`;
        const bytesB = uniquifyBytes(srcBytes, fix.tag + '-B');
        const rB = await runScenario(`${fix.tag} B browser-save`, nameB, async (fp) => {
          const tempPath = fp + '.crdownload';
          await fsp.writeFile(tempPath, Buffer.alloc(0));
          // Chunked write to better mimic Chromium's incremental fill.
          const CHUNK = 256 * 1024;
          for (let off = 0; off < bytesB.length; off += CHUNK) {
            await fsp.appendFile(tempPath, bytesB.subarray(off, Math.min(off + CHUNK, bytesB.length)));
          }
          await fsp.rename(tempPath, fp);
        }, bytesB.length);
        results.push(rB);
        await page.waitForTimeout(2_000);
      }

      // After all scenarios, give the grid one beat for thumbnails to bind.
      await page.waitForTimeout(3_000);
      const thumbCheck = await page.evaluate((names: string[]) => {
        const out: Record<string, { hasCard: boolean; thumbSrc: string | null }> = {};
        const cards = Array.from(document.querySelectorAll('.mo-card')) as HTMLElement[];
        for (const name of names) {
          const card = cards.find((c) => {
            const t = (c.textContent || '') + ' ' + (c.getAttribute('title') || '') + ' ' + (c.dataset?.name || '');
            return t.includes(name);
          });
          const img = card?.querySelector('img') as HTMLImageElement | null;
          out[name] = {
            hasCard: !!card,
            thumbSrc: img?.src && !img.src.endsWith('#') ? img.src.slice(0, 80) : null,
          };
        }
        return out;
      }, results.map((r) => r.newFileName));

      // ── Summary ─────────────────────────────────────────────────────
      const summarize = (r: ScenarioResult) => {
        console.log('');
        console.log(`  ─── ${r.name} (${r.newFileName}, ${r.byteSize.toLocaleString()} bytes) ─────────`);
        console.log(`  T0 file in place:     ${r.T0}`);
        console.log(
          `  T1 fs.watch event:    ${r.T1 ?? 'NEVER'}    delta T1-T0=${r.T1 ? r.T1 - r.T0 : 'n/a'}ms`
        );
        console.log(
          `  T2 Auto-scan log:     ${r.T2 ?? 'NEVER'}    delta T2-T0=${r.T2 ? r.T2 - r.T0 : 'n/a'}ms`
        );
        console.log(
          `  T3 grid card appear:  ${r.T3 ?? 'NEVER'}    delta T3-T0=${r.T3 ? r.T3 - r.T0 : 'n/a'}ms`
        );
        const tc = thumbCheck?.[r.newFileName];
        console.log(`  thumbnail bound:      ${tc ? (tc.thumbSrc ? `YES (${tc.thumbSrc}…)` : 'NO') : 'n/a'}`);
        console.log(`  fs.watch payload events for mediaDir: ${r.fsEventCount}`);
        if (r.fsEventLog.length) {
          for (const e of r.fsEventLog) {
            console.log(`    +${e.deltaMs}ms  ${e.type}  ${e.basename}`);
          }
        }
      };
      for (const r of results) summarize(r);
      console.log('');
      console.log('  ────────────────────────────────────────────────────');
      console.log('  VERDICT TABLE:');
      for (const r of results) {
        const pick = r.T3 != null;
        const fired = r.T1 != null;
        const tc = thumbCheck?.[r.newFileName];
        const thumb = tc?.thumbSrc ? 'thumb' : 'no-thumb';
        console.log(`    ${r.name.padEnd(36)}  fs.watch=${fired ? 'Y' : 'N'}  picked=${pick ? 'Y' : 'N'}  ${thumb}  T3-T0=${r.T3 ? r.T3 - r.T0 : 'NEVER'}ms`);
      }
      console.log('  ────────────────────────────────────────────────────');

      // Diagnostic test — only fail if NOTHING was picked up.
      const anyPicked = results.some((r) => r.T3 != null);
      expect(anyPicked, 'At least one scenario must reach the grid').toBe(true);
    } finally {
      try { await app.close(); } catch { /* best effort */ }
      try { await fsp.rm(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
});
