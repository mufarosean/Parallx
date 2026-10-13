// planner-probe.mjs — the Planner pane in the real app, hidden, on a
// throwaway workspace with seeded tasks and events. Walks Today, Tasks
// (filters, a row's menu, the task popover) and Calendar (month, week and
// day; navigation; an event's popover; the calendars menu; drag-create;
// dragging an event an hour later), and reports what each shows plus any
// renderer error. No model calls.
//
// Usage: node tests/probes/planner-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/).

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-planner-probe'));
const log = (k, v) => console.log(`[planner] ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'cc') });
  return env;
}

const cmd = (page, id, ...args) => page.evaluate(async ({ id, args }) => {
  const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
  try { const r = await svc.executeCommand(id, ...args); return r === undefined ? true : r; } catch (e) { return `ERR ${e.message}`; }
}, { id, args });

async function repaint(page) {
  await page.evaluate(() => {
    let d = document.getElementById('__probe_repaint');
    if (!d) { d = document.createElement('div'); d.id = '__probe_repaint'; d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none'; document.body.appendChild(d); }
    d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01';
  });
  await page.screenshot({ timeout: 4_000 }).catch(() => {});
}
async function shot(page, name) {
  await repaint(page);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), timeout: 8_000 }).catch(() => {});
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-planner-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `parallx-planner-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(ws, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));

  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  // The hidden copy never reaches the Ollama the real app uses: indexing a
  // fresh workspace would load the embedding model into it.
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(2_500);

  try {
    // Seed: tasks overdue, today, later and done; a timed event today, an
    // all-day event over two days, and a weekly event.
    log('seed', await page.evaluate(async () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
      const reg = await svc.executeCommand('planner.getRegistry');
      const data = reg.data;
      const day = new Date(); day.setHours(0, 0, 0, 0);
      const at = (d, h, m = 0) => { const x = new Date(day); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.getTime(); };
      await data.createTask({ title: 'Probe overdue task', dueAt: at(-2, 9) });
      await data.createTask({ title: 'Probe task today', dueAt: at(0, 17) });
      await data.createTask({ title: 'Probe task next week', dueAt: at(6, 10), description: 'See https://example.com/notes' });
      const done = await data.createTask({ title: 'Probe finished task', dueAt: at(-1, 12) });
      await data.updateTask?.(done.id, { status: 'done' });
      const cals = await data.listCalendars();
      await data.createEvent({ title: 'Probe meeting', startAt: at(0, 10), endAt: at(0, 11), calendarId: cals[0]?.id ?? null });
      await data.createEvent({ title: 'Probe trip', startAt: at(1, 0), endAt: at(3, 0), allDay: true, calendarId: cals[0]?.id ?? null });
      await data.createEvent({ title: 'Probe weekly', startAt: at(0, 14), endAt: at(0, 15), recurrence: 'FREQ=WEEKLY', calendarId: cals[0]?.id ?? null });
      return `calendars=${cals.map((c) => c.name).join(',')}`;
    }));

    log('open', await cmd(page, 'planner.open'));
    await page.waitForSelector('.planner-pane', { timeout: 10_000 });
    await page.waitForTimeout(1_200);
    const tab = async (label) => {
      await page.evaluate((l) => Array.from(document.querySelectorAll('.planner-pane__tab')).find((t) => t.textContent.trim().startsWith(l))?.click(), label);
      await page.waitForTimeout(900);
    };
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.planner-pane__tab')).map((t) => t.textContent.trim()).join(' | '));
    log('tabs', tabs);

    // Today.
    await tab('Today');
    log('today', await page.evaluate(() => (document.querySelector('.planner-pane__body')?.textContent || '').replace(/\s+/g, ' ').slice(0, 300)));
    await shot(page, 'today');

    // Tasks: the filters, the rows, a row's menu, the task popover.
    await tab('Tasks');
    log('tasks nav', await page.evaluate(() => Array.from(document.querySelectorAll('.planner-tasks__navitem')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
    log('tasks rows', await page.evaluate(() => Array.from(document.querySelectorAll('.planner-task .planner-task__title')).map((t) => t.textContent.trim()).join(' | ')));
    log('task sections', await page.evaluate(() => Array.from(document.querySelectorAll('.planner-section__title')).map((t) => t.textContent.trim()).join(' | ')));
    await page.evaluate(() => document.querySelector('.planner-task .planner-task__more')?.click());
    await page.waitForTimeout(500);
    log('task menu', await page.evaluate(() => Array.from(document.querySelectorAll('.context-menu .context-menu-item')).map((x) => x.textContent.trim()).filter(Boolean).join(' | ') || 'none'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.evaluate(() => Array.from(document.querySelectorAll('.planner-task .planner-task__title')).find((t) => /next week/.test(t.textContent))?.click());
    await page.waitForTimeout(700);
    log('task popover', await page.evaluate(() => {
      const p = document.querySelector('.planner-popover');
      if (!p) return 'none';
      return `title="${p.querySelector('.planner-popover__title-input')?.value}" status=${Array.from(p.querySelectorAll('.planner-popover__statusbtn--active')).map((b) => b.textContent.trim()).join(',')} links=${p.querySelectorAll('.planner-popover__linkchip').length} rows=${Array.from(p.querySelectorAll('.planner-popover__rowlabel')).map((r) => r.textContent.trim()).join(',')}`;
    }));
    await shot(page, 'task-popover');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    log('task popover closed', await page.evaluate(() => !document.querySelector('.planner-popover')));

    // Calendar: month, week, day.
    await tab('Calendar');
    const view = async (name) => {
      await page.evaluate(() => document.querySelector('.planner-viewdrop')?.click());
      await page.waitForTimeout(400);
      await page.evaluate((n) => Array.from(document.querySelectorAll('.context-menu .context-menu-item, .ui-dropdown__list [role="option"]')).find((x) => x.textContent.trim().startsWith(n))?.click(), name);
      await page.waitForTimeout(900);
    };
    const calState = () => page.evaluate(() => {
      const bars = Array.from(document.querySelectorAll('.planner-week__event, .planner-day__event')).map((b) => b.textContent.replace(/\s+/g, ' ').trim().slice(0, 30));
      return `range="${document.querySelector('.planner-cdate')?.textContent?.trim()}" chips=${document.querySelectorAll('.planner-month__chip').length} bars=${bars.length} weekAllDay=${document.querySelectorAll('.planner-week__alldaybar').length} dayAllDay=${document.querySelectorAll('.planner-day__alldaybar').length} titles=[${[...new Set([...bars, ...Array.from(document.querySelectorAll('.planner-month__chiptext')).map((c) => c.textContent.trim())])].slice(0, 8).join('; ')}]`;
    });
    await view('Month');
    log('month', await calState());
    await shot(page, 'month');
    await view('Week');
    log('week', await calState());
    await shot(page, 'week');
    await page.evaluate(() => document.querySelectorAll('.planner-cnav button, .planner-cnav .planner-iconbtn')[1]?.click());
    await page.waitForTimeout(700);
    log('week next', await calState());
    await page.evaluate(() => document.querySelector('.planner-todaybtn')?.click());
    await page.waitForTimeout(700);
    await view('Day');
    log('day', await calState());
    await shot(page, 'day');

    // Pointer input reaches drag handlers only when dispatched in the hidden
    // window: press, move and release are sent to the element itself.
    const pointer = (selectorOrFind, steps) => page.evaluate(({ selectorOrFind, steps }) => {
      const el = selectorOrFind.text
        ? Array.from(document.querySelectorAll(selectorOrFind.sel)).find((b) => b.textContent.includes(selectorOrFind.text))
        : document.querySelector(selectorOrFind.sel);
      if (!el) return 'no element';
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      let y = r.top + (selectorOrFind.yFrac ?? 0.5) * Math.min(r.height, 40);
      const fire = (type, dy) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, clientX: x, clientY: y + dy, pointerType: 'mouse', isPrimary: true }));
      fire('pointerdown', 0);
      for (const dy of steps) fire('pointermove', dy);
      fire('pointerup', steps.length ? steps[steps.length - 1] : 0);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      return 'sent';
    }, { selectorOrFind, steps });

    // An event's popover: a press and release on the day view's bar.
    log('event click', await pointer({ sel: '.planner-day__event', text: 'Probe meeting' }, []));
    await page.waitForTimeout(700);
    log('event popover', await page.evaluate(() => {
      const p = document.querySelector('.planner-popover');
      if (!p) return 'none';
      return `title="${p.querySelector('.planner-popover__title-input')?.value}" rows=${Array.from(p.querySelectorAll('.planner-popover__rowlabel')).map((r) => r.textContent.trim()).join(',')} buttons=${Array.from(p.querySelectorAll('.planner-popover__btn')).map((b) => b.textContent.trim()).join(',')}`;
    }));
    await shot(page, 'event-popover');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('.planner-popover-overlay')?.remove());

    // Drag the event an hour later: its start and end move by an hour.
    const hourPx = await page.evaluate(() => document.querySelector('.planner-day__hour')?.getBoundingClientRect().height ?? 0);
    log('drag', await pointer({ sel: '.planner-day__event', text: 'Probe meeting', yFrac: 0.5 }, [hourPx / 3, hourPx * 2 / 3, hourPx]));
    await page.waitForTimeout(1_200);
    log('after drag', await page.evaluate(async () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
      const reg = await svc.executeCommand('planner.getRegistry');
      const evs = await reg.data.listEvents({ from: Date.now() - 86_400_000 * 2, to: Date.now() + 86_400_000 * 2 });
      const ev = evs.find((e) => e.title === 'Probe meeting');
      const hm = (ms) => `${new Date(ms).getHours()}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`;
      return ev ? `start=${hm(ev.startAt)} end=${hm(ev.endAt)}` : 'no event';
    }));

    // Drag-create on an empty cell: the new-event popover opens.
    log('drag-create send', await pointer({ sel: '.planner-day__cell:nth-child(20)' }, [12, 30]));
    await page.waitForTimeout(800);
    log('drag-create', await page.evaluate(() => { const p = document.querySelector('.planner-popover'); return p ? `popover title="${p.querySelector('.planner-popover__title-input')?.value}" heading="${p.querySelector('.planner-popover__title')?.textContent?.trim()}"` : 'no popover'; }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('.planner-popover-overlay')?.remove());
    // The calendars menu.
    await page.evaluate(() => Array.from(document.querySelectorAll('.planner-pane__actions button, .planner-iconbtn')).find((b) => /Calendars/i.test(b.getAttribute('aria-label') || b.title || b.textContent))?.click());
    await page.waitForTimeout(700);
    log('calendars menu', await page.evaluate(() => Array.from(document.querySelectorAll('.planner-cals-row .planner-cals-name')).map((n) => n.value).join(' | ') || 'none'));
    await shot(page, 'calendars');
    await page.keyboard.press('Escape');
  } catch (e) {
    log('FAILED', String(e).split('\n')[0]);
  } finally {
    const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama|11434/.test(e));
    console.log(`${real.length} renderer error(s)`);
    for (const e of real) console.log(`  ${e}`);
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
