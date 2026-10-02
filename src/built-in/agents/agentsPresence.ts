// agentsPresence.ts — agents are visible from anywhere in the app.
//
// Three quiet signals, all driven by the same snapshot as the Agents view:
//   • a status bar entry: a breathing dot and what the agent is doing now,
//     or how many things need your OK, or that agents are paused;
//   • a count on the Agents icon for approvals waiting on you (a dot while
//     something runs);
//   • a toast for each new approval, answerable on the spot, shown only
//     when the Agents view isn't already in front of you.
// Clicking the status entry opens Agents.

import { type IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import type { IAgentsSnapshot } from './agentsModel.js';
import { answerApproval, onAnyChange, readSnapshot, resolveServices, type ParallxApi } from './agentsServices.js';

/** Status text for a snapshot, or null when there is nothing to say. Test seam. */
export function presenceLine(s: IAgentsSnapshot): { text: string; tone: 'working' | 'needs' | 'paused'; tooltip: string } | null {
  const needs = s.needsYou.length;
  const working = s.running.filter((r) => r.state === 'working');
  if (needs > 0) {
    return {
      text: needs === 1 ? `${s.needsYou[0].who} needs your OK` : `${needs} things need your OK`,
      tone: 'needs',
      tooltip: 'Open Agents to answer',
    };
  }
  if (working.length > 0) {
    const r = working[0];
    const more = working.length > 1 ? ` (+${working.length - 1})` : '';
    return { text: `${r.name}: ${r.step}${more}`, tone: 'working', tooltip: 'An agent is working. Open Agents to watch or pause it.' };
  }
  if (s.paused) return { text: 'Agents paused', tone: 'paused', tooltip: 'Background agents are paused. Open Agents to turn them back on.' };
  return null;
}

export function agentsViewInFront(): boolean {
  const v = document.querySelector('.agents-view') as HTMLElement | null;
  return !!v && v.offsetParent !== null && v.getBoundingClientRect().width > 0;
}

export function startAgentsPresence(api: ParallxApi): IDisposable {
  const el = $('span.agents-status');
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  const dot = $('span.agents-status__dot');
  const label = $('span.agents-status__text');
  el.append(dot, label);
  const open = (): void => { void api.commands.executeCommand('agents.show'); };
  el.addEventListener('click', open);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });

  const item = api.window.createStatusBarItem(1, 40);
  item.name = 'Agents';
  item.htmlElement = el;
  item.text = '';
  let shown = false;

  // Approvals already announced (or present at startup) never toast again.
  const announced = new Set<string>();
  let first = true;
  let disposed = false;
  let pending = false;
  let changeSub: IDisposable | undefined;

  const toast = (n: IAgentsSnapshot['needsYou'][number]): void => {
    void api.window.showInformationMessage(
      `${n.who} wants to ${n.what.charAt(0).toLowerCase()}${n.what.slice(1)}`,
      { title: 'Allow' }, { title: 'Reject' }, { title: 'Open Agents' },
    ).then((pick) => {
      if (!pick) return;
      if (pick.title === 'Allow') void answerApproval(n.taskId, n.requestId, 'approve-once');
      else if (pick.title === 'Reject') void answerApproval(n.taskId, n.requestId, 'deny');
      else open();
    });
  };

  const paint = (s: IAgentsSnapshot): void => {
    const line = presenceLine(s);
    if (line) {
      label.textContent = line.text;
      el.title = line.tooltip;
      el.setAttribute('aria-label', `Agents: ${line.text}`);
      el.className = `agents-status agents-status--${line.tone}`;
      if (!shown) { item.show(); shown = true; }
    } else if (shown) {
      item.hide(); shown = false;
    }

    const needs = s.needsYou.length;
    const running = s.running.some((r) => r.state === 'working');
    try {
      api.views.setBadge('agents-container', needs > 0 ? { count: needs } : running ? { dot: true } : undefined);
    } catch { /* the icon may not exist yet */ }

    const inFront = agentsViewInFront();
    for (const n of s.needsYou) {
      if (announced.has(n.requestId)) continue;
      announced.add(n.requestId);
      if (!first && !inFront) toast(n);
    }
    first = false;
  };

  const refresh = (): void => {
    if (pending || disposed) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (disposed) return;
      void readSnapshot(api).then((s) => { if (!disposed) paint(s); }).catch(() => undefined);
    }, 120);
  };

  const subscribe = (): void => {
    resolveServices(api);
    changeSub?.dispose();
    changeSub = onAnyChange(refresh);
  };
  subscribe();
  // Services that register after activation: subscribe again once they exist.
  const heal = setTimeout(() => { subscribe(); refresh(); }, 3000);
  const tick = setInterval(refresh, 30_000);
  refresh();

  return {
    dispose(): void {
      disposed = true;
      clearTimeout(heal);
      clearInterval(tick);
      changeSub?.dispose();
      item.dispose();
    },
  };
}
