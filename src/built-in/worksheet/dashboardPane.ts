// dashboardPane.ts — Worksheets: the Problem Bank dashboard tab.
//
// The workbook's Dashboard sheet, rebuilt from the bank: the two headline
// numbers it kept (attempted %, score), time and pace it could not keep,
// progress by paper weakest first, the timeline (its own history ahead of
// every rating given here), and four lists that answer "what next": what
// is due again, what keeps going wrong, the weakest papers, and the vendor's
// easy-and-likely problems never tried. Every row opens the problem or
// starts a quiz; the arithmetic lives in progressInsights.ts.
import { listItems, listCompletedAttempts, listProgressSnapshots, onWorksheetDataChanged } from './worksheetData.js';
import { computeInsights, type Insights, type PaperProgress, type InsightItem, type TimelinePoint } from './progressInsights.js';
import { paperLabel, ratingLabel, QUADRANT_LABELS } from './problemImport.js';

export interface DashboardActions {
  openItem(id: number, title: string): void;
  /** Start a quiz over exactly these problems, in this order. */
  startQuiz(ids: number[]): void;
  /** Open the quiz builder with these filters already chosen. */
  configureQuiz(preset: { papers?: string[]; state?: string }): void;
  importWorkbook(): void;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function btn(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className) as HTMLButtonElement;
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
const pct = (v: number): string => `${Math.round(v * 100)}%`;
export function fmtStudyTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return s === 0 ? '0m' : '<1m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
function fmtDay(day: string, withYear = false): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? ` ${y}` : ''}`;
}
function daysAgoLabel(n: number): string {
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function tile(label: string, value: string, sub: string): HTMLElement {
  const t = el('div', 'ws-dash__tile');
  t.appendChild(el('div', 'ws-dash__tilelabel', label));
  t.appendChild(el('div', 'ws-dash__tilevalue', value));
  t.appendChild(el('div', 'ws-dash__tilesub', sub));
  return t;
}

function card(title: string, hint: string): { root: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  const root = el('section', 'ws-dash__card');
  const head = el('div', 'ws-dash__cardhead');
  head.appendChild(el('div', 'ws-dash__cardtitle', title));
  head.appendChild(el('div', 'ws-dash__cardhint', hint));
  root.appendChild(head);
  const body = el('div', 'ws-dash__cardbody');
  root.appendChild(body);
  const foot = el('div', 'ws-dash__cardfoot');
  root.appendChild(foot);
  return { root, body, foot };
}

function problemRow(item: InsightItem, meta: string, dot: string, onOpen: () => void): HTMLElement {
  const row = btn('', 'ws-dash__row', onOpen);
  const d = el('span', `ws-bank__dot ${dot}`);
  row.appendChild(d);
  const text = el('span', 'ws-dash__rowtext');
  text.appendChild(el('span', 'ws-dash__rowtitle', item.title));
  text.appendChild(el('span', 'ws-dash__rowmeta', [paperLabel(item.paper), meta].filter(Boolean).join(' · ')));
  row.appendChild(text);
  row.title = `Open ${item.title}`;
  return row;
}

/** A floating tooltip that follows the pointer inside the pane. */
function makeTooltip(pane: HTMLElement): { show(x: number, y: number, lines: string[]): void; hide(): void } {
  const tip = el('div', 'ws-dash__tip');
  tip.hidden = true;
  pane.appendChild(tip);
  return {
    show(x, y, lines) {
      tip.replaceChildren();
      lines.forEach((line, i) => tip.appendChild(el('div', i === 0 ? 'ws-dash__tiphead' : 'ws-dash__tipline', line)));
      tip.hidden = false;
      const box = pane.getBoundingClientRect();
      const left = Math.min(x - box.left + 14, pane.clientWidth - tip.offsetWidth - 8);
      const top = y - box.top + pane.scrollTop - tip.offsetHeight - 10;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${Math.max(pane.scrollTop + 4, top)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

// ── Progress by paper: horizontal stacked bars, weakest first ───────────────

function paperBars(host: HTMLElement, papers: PaperProgress[], tip: ReturnType<typeof makeTooltip>, actions: DashboardActions): void {
  const legend = el('div', 'ws-dash__legend');
  for (const [cls, label] of [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['rest', 'Not Rated']]) {
    const item = el('span', 'ws-dash__legenditem');
    item.appendChild(el('span', `ws-dash__swatch ${cls}`));
    item.appendChild(document.createTextNode(label));
    legend.appendChild(item);
  }
  host.appendChild(legend);
  for (const p of papers) {
    const row = el('div', 'ws-dash__paperrow');
    const name = btn(paperLabel(p.paper), 'ws-dash__papername', () => actions.configureQuiz({ papers: [p.paper] }));
    name.title = `Quiz ${paperLabel(p.paper)}`;
    row.appendChild(name);
    const bar = el('div', 'ws-dash__bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${paperLabel(p.paper)}: ${p.easy} easy, ${p.medium} medium, ${p.hard} hard, ${p.total - p.rated} not rated`);
    const seg = (cls: string, n: number) => {
      if (n <= 0) return;
      const s = el('span', cls);
      s.style.flexGrow = String(n);
      bar.appendChild(s);
    };
    seg('easy', p.easy); seg('medium', p.medium); seg('hard', p.hard); seg('rest', p.total - p.rated);
    row.appendChild(bar);
    const label = p.rated > 0 ? `${p.rated}/${p.total} · ${pct(p.score)}` : `0/${p.total}`;
    row.appendChild(el('span', 'ws-dash__barlabel', label));
    const lines = [
      paperLabel(p.paper),
      `Easy ${p.easy} · Medium ${p.medium} · Hard ${p.hard} · Not rated ${p.total - p.rated}`,
      p.rated > 0 ? `Score ${pct(p.score)} over ${p.rated} rated` : 'Nothing rated yet',
      p.seconds > 0 ? `Time ${fmtStudyTime(p.seconds)}` : '',
    ].filter(Boolean);
    row.addEventListener('mousemove', (e) => tip.show(e.clientX, e.clientY, lines));
    row.addEventListener('mouseleave', () => tip.hide());
    host.appendChild(row);
  }
}

// ── Progress over time: one line per chart, a dashed target, a crosshair ────

interface ChartPoint { day: string; value: number; source: TimelinePoint['source'] }

function lineChart(host: HTMLElement, title: string, points: ChartPoint[], target: number, tip: ReturnType<typeof makeTooltip>): () => void {
  const wrap = el('div', 'ws-dash__chart');
  wrap.appendChild(el('div', 'ws-dash__charttitle', title));
  const svgHost = el('div', 'ws-dash__svghost');
  wrap.appendChild(svgHost);
  host.appendChild(wrap);
  if (points.length === 0) {
    svgHost.appendChild(el('div', 'ws-dash__chartempty', 'Rate a problem and the line starts here.'));
    return () => {};
  }
  const NS = 'http://www.w3.org/2000/svg';
  const H = 190; const TOP = 14; const BOTTOM = 24; const LEFT = 38; const RIGHT = 44;
  const t0 = dayMs(points[0].day); const t1 = dayMs(points[points.length - 1].day);
  const span = Math.max(1, t1 - t0);

  const draw = (width: number) => {
    const W = Math.max(160, Math.floor(width));
    const plotW = W - LEFT - RIGHT; const plotH = H - TOP - BOTTOM;
    const x = (day: string) => points.length === 1 ? LEFT + plotW / 2 : LEFT + ((dayMs(day) - t0) / span) * plotW;
    const y = (v: number) => TOP + (1 - Math.max(0, Math.min(1, v))) * plotH;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${title}: ${pct(points[points.length - 1].value)} on ${fmtDay(points[points.length - 1].day, true)}`);
    const mk = (name: string, attrs: Record<string, string | number>) => {
      const n = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      svg.appendChild(n);
      return n;
    };
    // Recessive grid and y labels.
    for (const g of [0, 0.5, 1]) {
      mk('line', { x1: LEFT, x2: W - RIGHT, y1: y(g), y2: y(g), class: 'ws-dash__gridline' });
      const t = mk('text', { x: LEFT - 6, y: y(g) + 4, class: 'ws-dash__axis', 'text-anchor': 'end' });
      t.textContent = pct(g);
    }
    // The target, dashed and neutral, named once.
    mk('line', { x1: LEFT, x2: W - RIGHT, y1: y(target), y2: y(target), class: 'ws-dash__target' });
    // Named at the left end, above the line, clear of the last value's label on the right.
    const tl = mk('text', { x: LEFT + 4, y: y(target) - 4, class: 'ws-dash__axis' });
    tl.textContent = `Target ${pct(target)}`;
    // X labels: first and last day, month starts between when there is room.
    const labels: { day: string; text: string }[] = [{ day: points[0].day, text: fmtDay(points[0].day) }];
    if (points.length > 1) {
      const first = new Date(t0); const last = new Date(t1);
      const cursor = new Date(first.getFullYear(), first.getMonth() + 1, 1);
      while (cursor.getTime() < t1) {
        const d = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
        labels.push({ day: d, text: MONTHS[cursor.getMonth()] });
        cursor.setMonth(cursor.getMonth() + 1);
      }
      labels.push({ day: points[points.length - 1].day, text: fmtDay(points[points.length - 1].day) });
      void last;
    }
    let lastX = -Infinity;
    for (const l of labels) {
      const lx = x(l.day);
      if (lx - lastX < 46) continue;
      const anchor = lx > W - RIGHT - 20 ? 'end' : lx < LEFT + 20 ? 'start' : 'middle';
      const t = mk('text', { x: lx, y: H - 6, class: 'ws-dash__axis', 'text-anchor': anchor });
      t.textContent = l.text;
      lastX = lx;
    }
    // The series: the workbook's history in the same line, its part dashed.
    const wb = points.filter((p) => p.source === 'workbook');
    const own = points.filter((p) => p.source === 'attempts');
    const path = (ps: ChartPoint[]) => ps.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    if (wb.length > 0) {
      const joined = own.length > 0 ? [...wb, own[0]] : wb;
      mk('path', { d: path(joined), class: 'ws-dash__series ws-dash__series--history' });
    }
    if (own.length > 0) mk('path', { d: path(own), class: 'ws-dash__series' });
    if (points.length === 1) mk('circle', { cx: x(points[0].day), cy: y(points[0].value), r: 4, class: 'ws-dash__marker' });
    // The last value, labeled directly.
    const last = points[points.length - 1];
    mk('circle', { cx: x(last.day), cy: y(last.value), r: 4, class: 'ws-dash__marker' });
    const lv = mk('text', { x: x(last.day) + 8, y: y(last.value) - 8, class: 'ws-dash__value', 'text-anchor': x(last.day) > W - RIGHT - 30 ? 'end' : 'start' });
    lv.textContent = pct(last.value);
    // Crosshair + tooltip.
    const cross = mk('line', { x1: 0, x2: 0, y1: TOP, y2: H - BOTTOM, class: 'ws-dash__cross' });
    const ring = mk('circle', { cx: 0, cy: 0, r: 5, class: 'ws-dash__ring' });
    cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden');
    const hit = mk('rect', { x: LEFT, y: 0, width: plotW, height: H, fill: 'transparent' });
    hit.addEventListener('mousemove', (e: MouseEvent) => {
      const box = svg.getBoundingClientRect();
      const px = e.clientX - box.left;
      let best = points[0]; let bestD = Infinity;
      for (const p of points) { const d = Math.abs(x(p.day) - px); if (d < bestD) { bestD = d; best = p; } }
      cross.setAttribute('x1', String(x(best.day))); cross.setAttribute('x2', String(x(best.day)));
      ring.setAttribute('cx', String(x(best.day))); ring.setAttribute('cy', String(y(best.value)));
      cross.setAttribute('visibility', 'visible'); ring.setAttribute('visibility', 'visible');
      tip.show(e.clientX, e.clientY, [fmtDay(best.day, true), `${title} ${pct(best.value)}`, best.source === 'workbook' ? 'From the workbook' : '']);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); tip.hide(); });
    svgHost.replaceChildren(svg);
  };

  draw(svgHost.clientWidth || 320);
  const ro = new ResizeObserver((entries) => { for (const en of entries) draw(en.contentRect.width); });
  ro.observe(svgHost);
  return () => ro.disconnect();
}

// ── The pane ────────────────────────────────────────────────────────────────

export function createDashboardPane(container: HTMLElement, actions: DashboardActions): { dispose(): void } {
  const pane = el('div', 'ws-pane ws-dash');
  container.appendChild(pane);
  const content = el('div', 'ws-dash__content');
  pane.appendChild(content);
  let disposed = false;
  let cleanups: (() => void)[] = [];
  const tip = makeTooltip(pane);

  const render = async () => {
    if (disposed) return;
    const [items, attempts, snapshots] = await Promise.all([
      listItems().catch(() => []),
      listCompletedAttempts().catch(() => []),
      listProgressSnapshots().catch(() => []),
    ]);
    if (disposed) return;
    for (const c of cleanups) c();
    cleanups = [];
    tip.hide();
    content.replaceChildren();
    const root = content;
    const ins: Insights = computeInsights(items, attempts, snapshots);

    const head = el('div', 'ws-dash__head');
    head.appendChild(el('div', 'ws-home__title', 'Dashboard'));
    head.appendChild(el('div', 'ws-hint', 'Every rating you give moves these numbers. The score counts Easy in full, Medium half, Hard nothing.'));
    root.appendChild(head);

    if (ins.totalProblems === 0) {
      const empty = el('div', 'ws-empty');
      empty.appendChild(el('div', 'ws-empty__headline', 'No problems in the bank yet.'));
      empty.appendChild(el('div', 'ws-empty__hint', 'Import your practice workbook and the dashboard fills in from its ratings and history.'));
      const b = btn('Import Workbook', 'ws-btn ws-btn--primary', () => actions.importWorkbook());
      b.style.marginTop = 'var(--px-space-3)';
      empty.appendChild(b);
      root.appendChild(empty);
      return;
    }

    // Headline numbers.
    const tiles = el('div', 'ws-dash__tiles');
    tiles.appendChild(tile('Attempted', pct(ins.attempted), `${ins.rated} of ${ins.totalProblems} problems rated`));
    tiles.appendChild(tile('Score', ins.rated > 0 ? pct(ins.score) : '–', ins.rated > 0 ? `over ${ins.rated} rated problems` : 'nothing rated yet'));
    const ownAttempts = attempts.filter((a) => !a.imported).length;
    tiles.appendChild(tile('Time Studied', fmtStudyTime(ins.seconds), ownAttempts > 0 ? `across ${ownAttempts} ${ownAttempts === 1 ? 'attempt' : 'attempts'} here` : 'timed from the first attempt here'));
    tiles.appendChild(tile('Rated This Week', String(ins.ratedThisWeek), 'ratings in the last 7 days'));
    root.appendChild(tiles);

    // What next.
    root.appendChild(el('div', 'ws-dash__sectiontitle', 'Work On Next'));
    const grid = el('div', 'ws-dash__grid');
    root.appendChild(grid);
    const LIMIT = 8;

    const due = card('Due Now', 'Hard comes back after 3 days, Medium after 7');
    if (ins.due.length === 0) due.body.appendChild(el('div', 'ws-dash__cardempty', 'Nothing is due. Rate something Hard or Medium and it returns here.'));
    for (const d of ins.due.slice(0, LIMIT)) {
      due.body.appendChild(problemRow(d.item, `${ratingLabel(d.rating)} ${daysAgoLabel(d.daysAgo)}`, d.rating, () => actions.openItem(d.item.id, d.item.title)));
    }
    if (ins.due.length > LIMIT) due.body.appendChild(el('div', 'ws-dash__more', `and ${ins.due.length - LIMIT} more`));
    if (ins.due.length > 0) due.foot.appendChild(btn(`Quiz Due Problems (${ins.due.length})`, 'ws-btn ws-btn--primary', () => actions.startQuiz(ins.due.map((d) => d.item.id))));
    grid.appendChild(due.root);

    const strug = card('Keeps Going Wrong', 'Rated Hard twice or more, still not Easy');
    if (ins.struggling.length === 0) strug.body.appendChild(el('div', 'ws-dash__cardempty', 'Nothing has been rated Hard twice.'));
    for (const s of ins.struggling.slice(0, LIMIT)) {
      strug.body.appendChild(problemRow(s.item, `Hard ${s.hardCount} of ${s.attempts} ${s.attempts === 1 ? 'attempt' : 'attempts'}`, 'hard', () => actions.openItem(s.item.id, s.item.title)));
    }
    if (ins.struggling.length > LIMIT) strug.body.appendChild(el('div', 'ws-dash__more', `and ${ins.struggling.length - LIMIT} more`));
    if (ins.struggling.length > 0) strug.foot.appendChild(btn('Quiz These', 'ws-btn', () => actions.startQuiz(ins.struggling.map((s) => s.item.id))));
    grid.appendChild(strug.root);

    const weak = card('Weakest Papers', 'Lowest score once three are rated, else least covered');
    for (const p of ins.weakestPapers.slice(0, 5)) {
      const row = el('div', 'ws-dash__paperline');
      const text = el('span', 'ws-dash__rowtext');
      text.appendChild(el('span', 'ws-dash__rowtitle', paperLabel(p.paper)));
      text.appendChild(el('span', 'ws-dash__rowmeta', p.rated >= 3 ? `Score ${pct(p.score)} · ${p.rated} of ${p.total} rated` : `${p.rated} of ${p.total} rated`));
      row.appendChild(text);
      row.appendChild(btn('Quiz', 'ws-btn ws-btn--small', () => actions.configureQuiz({ papers: [p.paper] })));
      weak.body.appendChild(row);
    }
    grid.appendChild(weak.root);

    const wins = card('Quick Wins', "The workbook's Easy & Likely problems never tried");
    const hasQuadrants = items.some((it) => it.quadrant > 0);
    if (!hasQuadrants) wins.body.appendChild(el('div', 'ws-dash__cardempty', 'The workbook did not carry quadrants for these problems.'));
    else if (ins.quickWins.length === 0) wins.body.appendChild(el('div', 'ws-dash__cardempty', `Every ${QUADRANT_LABELS[1]} problem has been tried.`));
    for (const q of ins.quickWins.slice(0, LIMIT)) {
      wins.body.appendChild(problemRow(q, 'Never tried', 'rest', () => actions.openItem(q.id, q.title)));
    }
    if (ins.quickWins.length > LIMIT) wins.body.appendChild(el('div', 'ws-dash__more', `and ${ins.quickWins.length - LIMIT} more`));
    if (ins.quickWins.length > 0) wins.foot.appendChild(btn(`Quiz Quick Wins (${Math.min(10, ins.quickWins.length)})`, 'ws-btn', () => actions.startQuiz(ins.quickWins.slice(0, 10).map((q) => q.id))));
    grid.appendChild(wins.root);

    // Papers, weakest first.
    root.appendChild(el('div', 'ws-dash__sectiontitle', 'Progress By Paper'));
    const papers = el('div', 'ws-dash__papers');
    paperBars(papers, ins.weakestPapers, tip, actions);
    root.appendChild(papers);

    // Over time.
    root.appendChild(el('div', 'ws-dash__sectiontitle', 'Progress Over Time'));
    const charts = el('div', 'ws-dash__charts');
    root.appendChild(charts);
    cleanups.push(lineChart(charts, 'Attempted', ins.timeline.map((p) => ({ day: p.day, value: p.attempted, source: p.source })), 0.8, tip));
    cleanups.push(lineChart(charts, 'Score', ins.timeline.map((p) => ({ day: p.day, value: p.score, source: p.source })), 0.8, tip));
  };

  void render();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const sub = onWorksheetDataChanged(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void render(); }, 300);
  });

  return {
    dispose: () => {
      disposed = true;
      sub.dispose();
      if (timer) clearTimeout(timer);
      for (const c of cleanups) c();
      pane.remove();
    },
  };
}
