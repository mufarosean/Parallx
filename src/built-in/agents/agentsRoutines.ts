// agentsRoutines.ts — Routines in Agents: everything that runs on its own.
//
// One list for everything that runs on its own. Every routine is a workflow
// (the step editor is how you see and change its steps); the only other
// entries are jobs an extension or Chat scheduled on the internal
// scheduler, labelled as such. Top to bottom: the heartbeat, routines the
// AI suggested (nothing runs until you add one), your routines (run now,
// edit steps, turn off, delete; click one for its last run), and ways to
// add one (New Routine, Build Steps, a template).

import { appDateTimeString } from '../../services/localTime.js';
import { formatRelativeTime } from '../../ui/relativeTime.js';
import { $ } from '../../ui/dom.js';
import { createButton, createIconButton, createSectionLabel, createSurface, createToggle, declareControl, sceneSlug } from '../../ui/kit.js';
import { ContextMenu } from '../../ui/contextMenu.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { describeSchedule } from '../../openclaw/cronScheduleSpec.js';
import type { ICronJob } from '../../openclaw/openclawCronService.js';
import { FLAG_CRON_ENABLED } from '../../services/autonomyFeatureFlags.js';
import type { WorkflowDoc, WorkflowRun } from '../../services/workflows/workflowTypes.js';
import { isTriggerNode } from '../../services/workflows/workflowTypes.js';
import { describeTriggerNode } from '../../services/workflows/workflowGraph.js';
import { WORKFLOW_TEMPLATES } from '../../services/workflows/workflowLibrary.js';
import { formatWhen } from './agentsModel.js';
import { describeRoutineCron } from './agentsRoutine.js';
import { isPaused, svc, type ParallxApi } from './agentsServices.js';

/** The routine whose last run is unfolded (survives repaints). */
let openRoutine: string | null = null;

function every(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `every ${min} min`;
  const h = Math.round(min / 60);
  return h === 1 ? 'every hour' : `every ${h} hours`;
}

function runWords(run: WorkflowRun): string {
  switch (run.status) {
    case 'ok': return 'ran fine';
    case 'error': return 'failed';
    case 'gated': return 'waiting for your OK';
    case 'cooldown': return 'held (cooling down)';
    case 'held': return 'held (too many interruptions today)';
    case 'running': return 'running';
  }
}

function triggerWords(wf: WorkflowDoc): string {
  const triggers = wf.nodes.filter(isTriggerNode);
  if (triggers.length === 0) return 'Draft, no trigger yet';
  return triggers.map((t) => (t.kind === 'trigger.schedule' && t.spec.kind === 'cron'
    ? describeRoutineCron(t.spec.expr) ?? describeTriggerNode(t)
    : describeTriggerNode(t))).join(' · ');
}

/** Who owns a job left on the internal scheduler: an extension (its id is
 *  namespaced, `flashcards.daily`) or Chat (the AI scheduled it). */
function jobOwner(job: ICronJob): string {
  const m = /^([\w-]+)\./.exec(job.name);
  if (m && !/\s/.test(job.name)) return `From ${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}`;
  return 'Made By Chat';
}

function jobWords(job: ICronJob): string {
  return describeRoutineCron(job.schedule.cron) ?? describeSchedule(job.schedule);
}

/** One status card: a dot, a name, a line, at most one action, and its switch. */
function statusCard(host: HTMLElement, state: 'on' | 'off' | 'paused', name: string, line: string, action?: { id: string; command?: string; label: string; icon?: string; run: () => void }, onSwitch?: (on: boolean) => void): HTMLElement {
  const card = $(`div.agents-rt__status.agents-rt__status--${state}`);
  card.appendChild($('span.agents-dot'));
  const text = $('div.agents-rt__status-text');
  const n = $('div.agents-rt__name'); n.textContent = name;
  const l = $('div.agents-rt__line'); l.textContent = line;
  text.append(n, l);
  card.appendChild(text);
  if (action) createButton(card, { id: action.id, command: action.command, label: action.label, icon: action.icon, kind: 'secondary', size: 'sm', onClick: action.run });
  if (onSwitch) createToggle(card, { id: `agents.${sceneSlug(name)}.enabled`, label: name, checked: state === 'on', onChange: onSwitch });
  host.appendChild(card);
  return card;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function renderRoutines(host: HTMLElement, api: ParallxApi, openNewRoutine: () => void, repaint: () => void): void {
  const run = (id: string, ...args: unknown[]): void => { void api.commands.executeCommand(id, ...args).catch(() => undefined); };
  const paused = isPaused();
  const setHeartbeat = (on: boolean): void => { void svc.config?.updateConfig({ heartbeat: { enabled: on } }); };

  // ── Running on their own ──
  const top = $('section.agents-section');
  createSectionLabel(top, 'Running on their own');
  const hb = svc.config?.getEffectiveConfig().heartbeat;
  if (paused) {
    statusCard(top, 'paused', 'Heartbeat', 'Paused with everything else');
  } else if (hb?.enabled) {
    const card = statusCard(top, 'on', 'Heartbeat', `Looks over your workspace ${every(hb.intervalMs)}`, { id: 'parallx.wakeAgent', command: 'parallx.wakeAgent', label: 'Wake Now', icon: 'play', run: () => run('parallx.wakeAgent') }, setHeartbeat);
    void api.commands.executeCommand<{ lastRunMs?: number; nextDueMs?: number }>('parallx.heartbeat.status').then((s) => {
      const line = card.querySelector('.agents-rt__line');
      if (!s || !line) return;
      const parts = [`Looks over your workspace ${every(hb.intervalMs)}`];
      if (s.lastRunMs) parts.push(`last ${formatRelativeTime(s.lastRunMs, 'short')}`);
      if (s.nextDueMs && s.nextDueMs > Date.now()) parts.push(`next ${formatWhen(s.nextDueMs, Date.now())}`);
      line.textContent = parts.join(' · ');
    }).catch(() => undefined);
  } else {
    statusCard(top, 'off', 'Heartbeat', 'Off. It can look over your workspace now and then and suggest things.', undefined, setHeartbeat);
  }
  const cronOn = svc.flags?.isEnabled(FLAG_CRON_ENABLED) ?? false;
  const level = svc.config?.getEffectiveConfig().heartbeat.autonomy;
  const foot = $('div.agents-rt__level');
  const lv = $('span'); lv.textContent = level ? `How much it may do alone: ${level.replace(/-/g, ' ')}` : '';
  foot.appendChild(lv);
  createButton(foot, { id: 'agents.heartbeatSettings', command: 'agents.openSettings', label: 'Heartbeat Settings…', kind: 'ghost', size: 'sm', onClick: () => run('agents.openSettings', 'schema:Agents / Heartbeat') });
  top.appendChild(foot);
  host.appendChild(top);

  const flows = svc.workflows?.workflows ?? [];

  // ── Suggested by the AI ──
  const suggested = flows.filter((w) => w.source === 'suggested');
  if (suggested.length) {
    const sec = $('section.agents-section.agents-section--needs');
    createSectionLabel(sec, 'Suggested by the AI');
    const hint = $('div.agents-rt__hint');
    hint.textContent = 'Habits it noticed and ideas it drafted. Nothing runs until you add one.';
    sec.appendChild(hint);
    for (const wf of suggested) {
      const card = $('div.agents-card');
      createSurface(card, { id: 'agents.suggestion', owner: 'agents', label: wf.name, instance: wf.id });
      const name = $('div.agents-card__name'); name.textContent = wf.name;
      const det = $('div.agents-card__detail'); det.textContent = wf.description ?? triggerWords(wf);
      const bar = $('div.agents-card__actions');
      createButton(bar, { id: 'agents.suggestion.add', label: 'Add', kind: 'primary', size: 'sm', title: 'Keep it and turn it on', onClick: () => { try { svc.workflows?.updateWorkflow(wf.id, { source: 'user', enabled: true }); } catch (err) { void api.window.showErrorMessage(`Could not add "${wf.name}": ${errorText(err)}`); } } });
      createButton(bar, { id: 'agents.suggestion.review', command: 'workflows.openEditor', label: 'Review', kind: 'secondary', size: 'sm', onClick: () => run('workflows.openEditor', wf.id) });
      createButton(bar, { id: 'agents.suggestion.dismiss', label: 'Dismiss', kind: 'ghost', size: 'sm', title: 'Delete the suggestion; this habit is not suggested again', onClick: () => { try { svc.workflows?.removeWorkflow(wf.id); } catch (err) { void api.window.showErrorMessage(`Could not dismiss "${wf.name}": ${errorText(err)}`); } } });
      card.append(name, det, bar);
      sec.appendChild(card);
    }
    host.appendChild(sec);
  }

  // ── Your routines ──
  const mine = flows.filter((w) => w.source !== 'suggested');
  const migrated = new Set(flows.map((w) => w.migratedFromCronId).filter(Boolean));
  const jobs = (svc.cron?.jobs ?? []).filter((j) => !migrated.has(j.id));
  const sec = $('section.agents-section');
  createSectionLabel(sec, 'Your routines');
  if (!mine.length && !jobs.length) {
    const empty = $('div.agents-rt__hint');
    empty.textContent = 'None yet. A routine runs on a schedule or when something happens, and everything it does shows up in History.';
    sec.appendChild(empty);
  }

  for (const wf of mine) {
    const service = svc.workflows!;
    const runs = service.getRuns(wf.id);
    const last = runs[runs.length - 1];
    const next = wf.enabled ? service.nextRunAt(wf.id) : null;
    const row = routineRow(sec, {
      key: `wf:${wf.id}`,
      on: wf.enabled,
      name: wf.name,
      line: [triggerWords(wf), last ? `last ${runWords(last)} ${formatRelativeTime(last.startedAt, 'short')}` : '', next ? `next ${formatWhen(next, Date.now())}` : ''].filter(Boolean).join(' · '),
      failed: last?.status === 'error',
      chips: [wf.class === 'destructive' ? 'Asks First' : ''].filter(Boolean),
      trace: last ? [`${appDateTimeString(new Date(last.startedAt))} · ${last.trigger.summary}`, ...last.nodes.map((n) => `${n.label}: ${n.status}${n.error ? `, ${n.error}` : n.summary ? `, ${n.summary}` : ''}`)] : undefined,
      repaint,
    });
    const bar = row.querySelector('.agents-card__actions') as HTMLElement;
    onOff(row, wf.name, wf.enabled, (on) => { try { service.setEnabled(wf.id, on); } catch { /* repaint */ } });
    createButton(bar, { id: 'agents.routine.runNow', label: 'Run Now', icon: 'play', kind: 'secondary', size: 'sm', onClick: () => { void service.runNow(wf.id).catch((err) => console.warn('[Agents] workflow run failed:', err)).finally(repaint); } });
    moreMenu(bar, [
      { id: 'edit', label: 'Edit Steps', run: () => run('workflows.openEditor', wf.id) },
      { id: 'delete', label: 'Delete…', run: () => {
        void api.window.showWarningMessage(`Delete "${wf.name}"? Its run history goes with it.`, { title: 'Delete' }, { title: 'Cancel' })
          .then((res) => { if (res?.title === 'Delete') service.removeWorkflow(wf.id); });
      } },
    ]);
  }

  for (const job of jobs) {
    const cron = svc.cron!;
    const runs = cron.getJobRuns(job.id);
    const last = runs[runs.length - 1];
    const row = routineRow(sec, {
      key: `job:${job.id}`,
      on: job.enabled,
      name: job.name,
      line: [jobWords(job), last ? `last ${last.success ? 'ran fine' : 'failed'} ${formatRelativeTime(last.firedAt, 'short')}` : '',
        !cronOn && job.enabled ? 'waits until Scheduled Jobs is on in Settings'
          : job.enabled && job.nextRunAt ? `next ${formatWhen(job.nextRunAt, Date.now())}` : ''].filter(Boolean).join(' · '),
      failed: last ? !last.success : false,
      chips: [jobOwner(job)],
      trace: job.description || job.payload.agentTurn ? [job.description || job.payload.agentTurn || ''] : undefined,
      repaint,
    });
    const bar = row.querySelector('.agents-card__actions') as HTMLElement;
    onOff(row, job.name, job.enabled, (on) => { try { cron.updateJob(job.id, { enabled: on }); } catch { /* repaint */ } });
    createButton(bar, { id: 'agents.routine.runNow', label: 'Run Now', icon: 'play', kind: 'secondary', size: 'sm', onClick: () => { void cron.runJob(job.id).catch((err) => console.warn('[Agents] routine run failed:', err)).finally(repaint); } });
    moreMenu(bar, [
      { id: 'delete', label: 'Delete…', run: () => {
        void api.window.showWarningMessage(`Delete the routine "${job.name}"?`, { title: 'Delete' }, { title: 'Cancel' })
          .then((res) => { if (res?.title === 'Delete') cron.removeJob(job.id); });
      } },
    ]);
  }
  host.appendChild(sec);

  // ── Add a routine ──
  const add = $('section.agents-section');
  createSectionLabel(add, 'Add a routine');
  const choices = $('div.agents-rt__add');
  createButton(choices, { id: 'agents.routines.new', command: 'agents.newRoutine', label: 'New Routine…', kind: 'primary', size: 'sm', title: 'Say what to do and when', onClick: openNewRoutine });
  if (svc.workflows) createButton(choices, { id: 'workflows.new', command: 'workflows.new', label: 'Build Steps…', kind: 'secondary', size: 'sm', title: 'Draw the steps yourself: triggers, context, agents, notifications', onClick: () => run('workflows.new') });
  add.appendChild(choices);
  if (svc.workflows) {
    const hint = $('div.agents-rt__hint'); hint.textContent = 'Or start from one of these:';
    add.appendChild(hint);
    for (const t of WORKFLOW_TEMPLATES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'agents-rt__tpl';
      declareControl(b, { id: `agents.template.${sceneSlug(t.key)}`, label: t.name, hint: t.description });
      const trig = t.nodes.find((n) => n.kind.startsWith('trigger.'));
      const thumb = createIconElement(trig?.kind === 'trigger.schedule' ? 'calendar-clock' : trig?.kind === 'trigger.event' ? 'radio' : 'play', 16);
      thumb.classList.add('agents-rt__tpl-icon');
      const text = $('span.agents-rt__tpl-text');
      const n = $('span.agents-rt__name'); n.textContent = t.name;
      const d = $('span.agents-rt__line'); d.textContent = t.description;
      text.append(n, d);
      b.append(thumb, text);
      b.addEventListener('click', () => {
        try { const doc = svc.workflows!.installTemplate(t.key); run('workflows.openEditor', doc.id); }
        catch (err) { console.warn('[Agents] template install failed:', err); }
      });
      add.appendChild(b);
    }
  }
  host.appendChild(add);
}

interface IRoutineRow {
  readonly key: string;
  readonly on: boolean;
  readonly name: string;
  readonly line: string;
  readonly failed: boolean;
  readonly chips: readonly string[];
  /** Lines shown when the row is opened: the last run, or what it does. */
  readonly trace?: readonly string[];
  readonly repaint: () => void;
}

/** Turn Off / Turn On for one routine; in the scene, pressed while it is on. */
/** On or off: a switch at the end of the card's top line (not a button whose words flip). */
function onOff(card: HTMLElement, name: string, on: boolean, set: (on: boolean) => void): void {
  const head = card.querySelector('.agents-card__top') as HTMLElement;
  createToggle(head, { id: 'agents.routine.enabled', label: `${name}, on`, checked: on, onChange: set }).element.classList.add('agents-rt__switch');
}

/** The rarer actions (edit, delete) behind one More Actions button. */
function moreMenu(bar: HTMLElement, items: { id: string; label: string; run: () => void }[]): void {
  const btn = createIconButton(bar, {
    id: 'agents.routine.more', icon: 'ellipsis', title: 'More Actions', size: 'sm',
    onClick: () => {
      const r = btn.getBoundingClientRect();
      const menu = ContextMenu.show({ items: items.map((i) => ({ id: i.id, label: i.label })), anchor: { x: r.left, y: r.bottom + 2 } });
      menu.onDidSelect(({ item }) => items.find((i) => i.id === item.id)?.run());
    },
  });
}

function routineRow(host: HTMLElement, r: IRoutineRow): HTMLElement {
  const card = $(`div.agents-card.agents-rt__row${r.on ? '' : '.agents-rt__row--off'}`);
  createSurface(card, { id: 'agents.routine', owner: 'agents', label: r.name, instance: r.key });
  const head = $('div.agents-card__top');
  head.appendChild($(`span.agents-dot${r.on ? '' : '.agents-dot--off'}`));
  const name = $('span.agents-card__name'); name.textContent = r.name;
  head.appendChild(name);
  for (const c of r.chips) { const chip = $('span.agents-rt__chip'); chip.textContent = c; head.appendChild(chip); }
  if (r.trace) {
    const chev = createIconElement(openRoutine === r.key ? 'chevron-down' : 'chevron-right', 14);
    chev.classList.add('agents-rt__chev');
    head.appendChild(chev);
  }
  card.appendChild(head);
  const line = $(`div.agents-card__step${r.failed ? '.agents-rt__line--failed' : ''}`);
  line.textContent = r.line;
  card.appendChild(line);
  if (r.trace && openRoutine === r.key) {
    const trace = $('div.agents-rt__trace');
    for (const t of r.trace) { const l = $('div'); l.textContent = t; trace.appendChild(l); }
    card.appendChild(trace);
  }
  const bar = $('div.agents-card__actions');
  bar.addEventListener('click', (e) => e.stopPropagation());
  card.appendChild(bar);
  if (r.trace) {
    card.classList.add('agents-rt__row--openable');
    declareControl(head, { id: 'agents.routine.open', label: r.name, hint: 'Show the last run', state: () => ({ kind: 'pressed', value: openRoutine === r.key }) });
    head.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.agents-rt__switch')) return; // the switch, not the unfold
      openRoutine = openRoutine === r.key ? null : r.key; r.repaint();
    });
  }
  host.appendChild(card);
  return card;
}
