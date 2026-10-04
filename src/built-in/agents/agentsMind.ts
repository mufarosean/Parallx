// agentsMind.ts — Mind in Agents: what the agent believes, and what it may
// do without asking.
//
// Replaces the Autonomy Log's Mind cell and Patterns tab. Every piece is
// visible and correctable: forget a belief, clear them all, revoke a
// standing approval. The meters are said in words; the numbers live in the
// tooltips.

import { appDateString } from '../../services/localTime.js';
import { $ } from '../../ui/dom.js';
import { createButton, createEmptyState, createSectionLabel } from '../../ui/kit.js';
import { showConfirmModal } from '../../api/notificationService.js';
import { svc, type ParallxApi } from './agentsServices.js';

interface IMindStatus {
  available?: boolean;
  fidelity?: number | null;
  beliefs?: { id: string; content: string; confidence: number }[];
  predictions?: { resolved?: unknown }[];
  audit?: { ok: boolean };
  capability?: { assistanceShare: number | null; deskillingRisk: boolean };
  habits?: { action: string; typicalTime: string | null; daysObserved: number }[];
}

/** Prediction accuracy in words (never a raw score). Test seam. */
export function accuracyWords(fidelity: number | null | undefined, graded: number): string | undefined {
  if (!graded || typeof fidelity !== 'number') return undefined;
  const grade = fidelity <= 0.1 ? 'sharp' : fidelity <= 0.25 ? 'fair' : 'rough';
  return `Its predictions so far: ${grade} (${graded} checked)`;
}

/** Who has been doing the work lately, in words. Test seam. */
export function balanceWords(cap: { assistanceShare: number | null; deskillingRisk: boolean } | undefined): string | undefined {
  if (!cap || typeof cap.assistanceShare !== 'number') return undefined;
  const share = cap.assistanceShare;
  const base = share <= 0.05 ? 'Recent work: all yours'
    : share < 0.35 ? 'Recent work: mostly yours'
      : share < 0.65 ? 'Recent work: split with the agent'
        : 'Recent work: mostly the agent';
  return cap.deskillingRisk ? `${base}, and growing; worth noticing` : base;
}

export function renderMind(host: HTMLElement, api: ParallxApi, repaint: () => void): void {
  const mind = $('div.agents-mind');
  const loading = $('div.agents-hist__empty'); loading.textContent = 'Reading what it has learned…';
  mind.appendChild(loading);
  host.appendChild(mind);

  void api.commands.executeCommand<IMindStatus>('parallx.mind.status').then((s) => {
    mind.replaceChildren();
    if (!s || s.available === false) {
      const n = $('div.agents-rt__hint'); n.textContent = 'What it learns needs workspace storage, which is not available here.';
      mind.appendChild(n);
      return;
    }
    const beliefs = s.beliefs ?? [];
    const habits = s.habits ?? [];
    const graded = (s.predictions ?? []).filter((p) => p.resolved).length;

    const meters = [accuracyWords(s.fidelity, graded), balanceWords(s.capability)].filter((x): x is string => !!x);
    if (s.audit && !s.audit.ok) meters.unshift('Its records are damaged: the action ledger failed verification.');
    if (meters.length) {
      const box = $('div.agents-mind__meters');
      for (const m of meters) { const l = $('div'); l.textContent = m; box.appendChild(l); }
      if (typeof s.fidelity === 'number') box.title = `Mean Brier score ${s.fidelity.toFixed(2)} over ${graded} checked predictions (0 is perfect)`;
      mind.appendChild(box);
    }

    const sec = $('section.agents-section');
    createSectionLabel(sec, 'What it believes about you');
    if (!beliefs.length) {
      const n = $('div.agents-rt__hint'); n.textContent = 'Nothing yet. Beliefs form as it reviews your work, and fade unless they keep holding true.';
      sec.appendChild(n);
    }
    for (const b of beliefs) {
      const row = $('div.agents-mind__belief');
      const pct = Math.round((b.confidence ?? 0) * 100);
      const bar = $('span.agents-mind__bar');
      bar.title = `${pct}% sure. Fades unless it keeps holding true.`;
      const fill = $('span.agents-mind__fill');
      fill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
      bar.appendChild(fill);
      const text = $('span.agents-mind__text'); text.textContent = b.content;
      row.append(bar, text);
      createButton(row, {
        label: 'Forget', kind: 'ghost', size: 'sm', title: 'Tell the agent this is wrong',
        onClick: () => { void api.commands.executeCommand('parallx.mind.forget', { id: b.id }).then(repaint).catch(() => undefined); },
      });
      sec.appendChild(row);
    }
    if (beliefs.length) {
      const foot = $('div.agents-rt__add');
      createButton(foot, {
        label: `Forget All ${beliefs.length}…`, kind: 'ghost', size: 'sm',
        onClick: () => {
          void showConfirmModal(document.body, { message: `Forget all ${beliefs.length} of the agent’s beliefs?`, detail: 'This can’t be undone.', confirmLabel: 'Forget All', danger: true })
            .then((ok) => { if (ok) void api.commands.executeCommand('parallx.mind.clearAll').then(repaint).catch(() => undefined); });
        },
      });
      sec.appendChild(foot);
    }
    mind.appendChild(sec);

    if (habits.length) {
      const hs = $('section.agents-section');
      createSectionLabel(hs, 'Habits it has noticed');
      for (const h of habits.slice(0, 8)) {
        const row = $('div.agents-row');
        const text = $('span.agents-row__text');
        const n = $('span.agents-row__name'); n.textContent = h.action;
        const w = $('span.agents-row__what');
        w.textContent = h.typicalTime ? `Most days around ${h.typicalTime}, seen on ${h.daysObserved} days` : `Seen on ${h.daysObserved} days`;
        text.append(n, w);
        row.appendChild(text);
        hs.appendChild(row);
      }
      if (habits.length > 8) { const more = $('div.agents-rt__hint'); more.textContent = `And ${habits.length - 8} more, strongest first.`; hs.appendChild(more); }
      mind.appendChild(hs);
    }

    renderAllowed(mind, repaint);
  }).catch(() => {
    mind.replaceChildren();
    renderAllowed(mind, repaint);
  });
}

/** Standing approvals for helper agents: what it may start without asking. */
function renderAllowed(host: HTMLElement, repaint: () => void): void {
  const patterns = svc.patterns?.list() ?? [];
  const sec = $('section.agents-section');
  createSectionLabel(sec, 'Allowed without asking');
  if (!patterns.length) {
    createEmptyState(sec, {
      headline: 'Nothing yet',
      hint: 'When you approve a helper agent and choose to remember it, it shows up here and you can take it back.',
    });
  }
  for (const p of patterns) {
    const row = $('div.agents-row');
    const text = $('span.agents-row__text');
    const n = $('span.agents-row__name'); n.textContent = p.label || p.id;
    const w = $('span.agents-row__what');
    w.textContent = `Approved ${appDateString(new Date(p.approvedAt))} · used ${p.matchCount} time${p.matchCount === 1 ? '' : 's'}`;
    text.append(n, w);
    row.appendChild(text);
    createButton(row, { label: 'Revoke', kind: 'ghost', size: 'sm', title: 'Ask again next time', onClick: () => { void svc.patterns?.revoke(p.id).then(repaint); } });
    sec.appendChild(row);
  }
  if (patterns.length > 1) {
    const foot = $('div.agents-rt__add');
    createButton(foot, {
      label: 'Revoke All…', kind: 'ghost', size: 'sm',
      onClick: () => {
        void showConfirmModal(document.body, { message: 'Revoke every standing approval?', confirmLabel: 'Revoke All', danger: true })
          .then((ok) => { if (ok) void svc.patterns?.clear().then(repaint); });
      },
    });
    sec.appendChild(foot);
  }
  host.appendChild(sec);
}
