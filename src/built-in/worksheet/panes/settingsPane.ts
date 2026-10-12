// Worksheets: the settings pane.

import { createButton, createFilterChip, createPageHeader, createSectionLabel, createSegmented } from '../../../ui/kit.js';
import { listItems, onWorksheetDataChanged, getCampaign, startCampaign, endCampaign, listAttemptHistory } from '../worksheetData.js';
import { planCampaign, campaignProgress, addDays, spanDays, workingDays, restDaysLabel, isCampaignProblem, WEEKDAY_LABELS } from '../campaign.js';
import { DISPLAY_DECIMALS_CHOICES } from '../displayNumbers.js';
import { dayKey } from '../progressInsights.js';
import { fmtShortDay } from '../labels.js';
import { BACK_TO_HOME } from '../actions.js';
import { IDLE_MINUTES_CHOICES, getDisplayDecimalsSetting, getExamDate, getIdleMinutes, getSheetAppearance, getXpCashRate, setDisplayDecimalsSetting, setExamDate, setIdleMinutes, setSheetAppearance, setXpCashRate, state, type SheetAppearance } from '../state.js';
import { el } from '../widgets.js';

// ── Settings (instanceId 'settings') ────────────────────────────────────────

export function createSettingsPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-settings');
  container.appendChild(root);
  let disposed = false;
  const disposables: { dispose(): void }[] = [];

  const render = async () => {
    if (disposed) return;
    const [items, campaign, attempts] = await Promise.all([
      listItems().catch(() => []),
      getCampaign().catch(() => null),
      listAttemptHistory().catch(() => []),
    ]);
    if (disposed) return;
    for (const d of disposables.splice(0)) d.dispose();
    root.replaceChildren();
    createPageHeader(root, { back: BACK_TO_HOME, title: 'Worksheets Settings' });
    const body = el('div', 'ws-settings__body');
    root.appendChild(body);

    // The app's settings layout: what a setting does on the left, the control on the right.
    const card = (label: string) => {
      createSectionLabel(body, label);
      const c = el('div', 'ws-setcard');
      body.appendChild(c);
      return c;
    };
    const row = (host: HTMLElement, title: string, desc: string, control?: HTMLElement, labelFor?: string) => {
      const r = el('div', 'ws-setrow');
      const text = el('div', 'ws-setrow__text');
      const t = el(labelFor ? 'label' : 'div', 'ws-setrow__title', title);
      if (labelFor) (t as HTMLLabelElement).htmlFor = labelFor;
      text.appendChild(t);
      if (desc) text.appendChild(el('div', 'ws-setrow__desc', desc));
      r.appendChild(text);
      if (control) { control.classList.add('ws-setrow__control'); r.appendChild(control); }
      host.appendChild(r);
      return r;
    };
    const switchOf = (ariaLabel: string, items: { value: string; label: string }[], value: string, onChange: (v: string) => void) => {
      const seg = createSegmented(null, { ariaLabel, items, value, onChange });
      disposables.push(seg);
      return seg.element;
    };

    // The campaign: every problem in the bank in N days.
    const camp = card('Campaign');
    // Essay sheets stay out: they are flashcards now.
    const problems = items.filter(isCampaignProblem);
    if (!campaign) {
      // Length as days or as a last day (either edits the other), and the
      // weekdays that carry no quota.
      const today = dayKey(Date.now());
      const rest = new Set<number>();
      const perDay = el('span');
      const daysIn = el('input', 'ws-input ws-input--count') as HTMLInputElement;
      daysIn.type = 'number'; daysIn.min = '1'; daysIn.max = '365'; daysIn.value = '18';
      daysIn.id = 'ws-camp-days';
      const endIn = el('input', 'ws-input ws-input--date') as HTMLInputElement;
      endIn.type = 'date'; endIn.min = today;
      endIn.id = 'ws-camp-end';
      const readDays = () => Math.max(1, Math.min(365, parseInt(daysIn.value, 10) || 18));
      const sync = () => {
        const d = readDays();
        const endDay = addDays(today, d - 1);
        endIn.value = endDay;
        const plan = planCampaign(problems.length, d, Date.now(), [...rest]);
        const working = workingDays(today, d, plan.restDays);
        const off = restDaysLabel(plan.restDays);
        perDay.textContent = working === 0
          ? 'Every day in that span is a rest day.'
          : `${plan.dailyTarget} a day over ${working} working ${working === 1 ? 'day' : 'days'}, ending ${fmtShortDay(endDay)}${off ? `, ${off}` : ''}.`;
      };
      daysIn.addEventListener('input', sync);
      endIn.addEventListener('change', () => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(endIn.value)) daysIn.value = String(Math.max(1, Math.min(365, spanDays(today, endIn.value))));
        sync();
      });
      const start = createButton(null, {
        label: 'Start Campaign', kind: 'primary', disabled: problems.length === 0,
        title: problems.length === 0 ? 'Import a workbook first.' : `${problems.length} problems, every one but the essay sheets, from today.`,
        onClick: () => { void startCampaign(planCampaign(problems.length, readDays(), Date.now(), [...rest])); },
      });
      row(camp, 'No campaign running', 'Every problem in the bank in a set number of days, drawn across all papers. Each day gets its own draw, every rating earns XP, a full day keeps the streak.', start);
      row(camp, 'Days', '', daysIn, daysIn.id);
      row(camp, 'Last day', '', endIn, endIn.id);
      const weekdays = el('div', 'ws-chips');
      weekdays.setAttribute('role', 'group');
      weekdays.setAttribute('aria-label', 'Rest days');
      for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
        createFilterChip(weekdays, {
          label: WEEKDAY_LABELS[wd].slice(0, 3),
          title: `${WEEKDAY_LABELS[wd]}s carry no quota; the streak and the pace step over them`,
          onToggle: (on) => { if (on && rest.size < 6) rest.add(wd); else rest.delete(wd); sync(); },
        });
      }
      const restRow = row(camp, 'Rest days', '', weekdays);
      restRow.querySelector('.ws-setrow__text')!.appendChild(el('div', 'ws-setrow__desc')).appendChild(perDay);
      sync();
    } else {
      const p = campaignProgress(campaign, items, attempts);
      const off = restDaysLabel(campaign.restDays);
      const end = createButton(null, {
        label: 'End Campaign…', kind: 'danger',
        title: 'Stops the campaign. Ratings and attempts stay; the streak, XP and draws are dropped.',
        onClick: () => {
          void (async () => {
            const ok = await state.api?.window?.showConfirmModal?.({
              message: 'End the campaign?',
              detail: 'Ratings, attempts and study time stay on the problems. The streak, the XP and the daily draws are dropped. This cannot be undone.',
              confirmLabel: 'End Campaign',
              danger: true,
            }) ?? false;
            if (ok && !disposed) await endCampaign();
          })();
        },
      });
      row(camp, `Day ${p.dayIndex} of ${campaign.days}`, `${p.done} of ${p.total} done · ${p.target} a day${off ? ` · ${off}` : ''} · ends ${fmtShortDay(addDays(campaign.startDay, campaign.days - 1))}`, end);
    }

    // The exam: the Dashboard counts the days to it.
    const examWrap = el('div', 'ws-setrow__inline');
    const examIn = el('input', 'ws-input ws-input--date') as HTMLInputElement;
    examIn.type = 'date';
    examIn.id = 'ws-exam-date';
    examIn.value = getExamDate();
    examIn.addEventListener('change', () => { void setExamDate(examIn.value).then(() => render()); });
    examWrap.appendChild(examIn);
    if (getExamDate()) createButton(examWrap, { label: 'Clear', kind: 'ghost', size: 'sm', onClick: () => { void setExamDate('').then(() => render()); } });
    row(camp, 'Exam date', 'The Dashboard counts down to it.', examWrap, examIn.id);

    // XP as cash: what the campaign's points are worth, paid to yourself.
    const cashWrap = el('div', 'ws-setrow__inline');
    cashWrap.appendChild(el('span', 'ws-hint', '$'));
    const cashIn = el('input', 'ws-input ws-input--count') as HTMLInputElement;
    cashIn.type = 'number';
    cashIn.id = 'ws-xp-cash';
    cashIn.min = '0';
    cashIn.step = '0.25';
    cashIn.value = String(getXpCashRate() || 0);
    cashIn.addEventListener('change', () => { const v = Math.max(0, Number(cashIn.value) || 0); void setXpCashRate(v).then(() => render()); });
    cashWrap.appendChild(cashIn);
    row(camp, 'XP to cash', 'Dollars per 100 XP. The Dashboard then shows what your XP and each reward are worth, and Cash Out records what you paid yourself. 0 turns it off.', cashWrap, cashIn.id);

    // The sheet's look, independent of the app theme.
    const sheet = card('Practice sheet');
    row(sheet, 'Sheet appearance', 'Light matches the exam tool. Follow app uses the workbench theme.',
      switchOf('Sheet appearance', [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'app', label: 'Follow app' }], getSheetAppearance(), (v) => { void setSheetAppearance(v as SheetAppearance); }));
    row(sheet, 'Decimals shown', 'A cell without a number format shows at most this many. The value and the cell editor keep full precision, and a format set on a cell always wins.',
      switchOf('Decimals shown', DISPLAY_DECIMALS_CHOICES.map((v) => ({ value: v, label: v === 'full' ? 'Full' : v })), getDisplayDecimalsSetting(), (v) => { void setDisplayDecimalsSetting(v); }));

    // The study clock: when a stretch without input stops being study.
    const clock = card('Study clock');
    row(clock, 'Stop counting after', 'Time counts while a problem or quiz is on screen and you are active. After this long with no input, the stretch is taken back, so a break with the tab up counts for nothing.',
      switchOf('Stop counting after', IDLE_MINUTES_CHOICES.map((v) => ({ value: String(v), label: `${v} min` })), String(getIdleMinutes()), (v) => { void setIdleMinutes(Number(v)); }));
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());
  return { dispose: () => { disposed = true; sub.dispose(); for (const d of disposables) d.dispose(); root.remove(); } };
}
