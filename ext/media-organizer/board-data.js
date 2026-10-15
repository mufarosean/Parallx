// board-data.js — a painting plan's board, as data: storing it, adding cards
// to it from the plan editor (Add To Board), and what the board needs from
// Media Organizer (moBoardContext). The surface itself is board.js.

import { moEl } from './dom.js';

export const KIND_NAME = { variation: 'Variation', palette: 'Palette', mix: 'Mix', photo: 'Photo', note: 'Note', frame: 'Frame', arrow: 'Arrow' };

// ── Storage ────────────────────────────────────────────────────────────────

export function normalize(b) {
  const o = b && typeof b === 'object' ? b : {};
  const view = Object.assign({ x: 40, y: 80, z: 0.75 }, o.view || {});
  const items = (Array.isArray(o.items) ? o.items : []).filter((it) => it && KIND_NAME[it.kind] && Number.isFinite(it.x) && Number.isFinite(it.y));
  return { v: 1, view, items, next: Math.max(Number(o.next) || 1, ...items.map((i) => i.id + 1), 1) };
}
export async function moBoardLoad(db, planId) {
  const row = await db.get('SELECT board_json FROM mo_plan_boards WHERE plan_id = ?', [planId]);
  try { return normalize(row ? JSON.parse(row.board_json) : null); } catch { return normalize(null); }
}
export async function moBoardSave(db, planId, board) {
  await db.run(`INSERT INTO mo_plan_boards (plan_id, board_json, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(plan_id) DO UPDATE SET board_json = excluded.board_json, updated_at = excluded.updated_at`, [planId, JSON.stringify(board)]);
}

// Places new cards in a fresh row under what the board already holds.
// specs: [{ kind, ...fields, w, h }]; with frame, the row sits in a frame of that title.
export async function moBoardAdd(db, planId, specs, frame) {
  const board = await moBoardLoad(db, planId);
  const bottom = board.items.length ? Math.max(...board.items.map((i) => i.y + i.h)) + 90 : 0;
  const left = board.items.length ? Math.min(...board.items.map((i) => i.x)) : 0;
  const pad = frame ? 28 : 0;
  let x = left + pad, rowH = 0;
  const placed = [];
  for (const s of specs) {
    const below = s.under != null ? placed[s.under] : null;
    const it = Object.assign({}, s, { id: board.next++ });
    delete it.under;
    if (below) { it.x = below.x; it.y = below.y + below.h + 24; it.w = below.w; }
    else { it.x = x; it.y = bottom + pad + (frame ? 12 : 0); x += it.w + 30; }
    rowH = Math.max(rowH, it.y + it.h - bottom);
    placed.push(it);
  }
  if (frame && placed.length) {
    const r = Math.max(...placed.map((i) => i.x + i.w));
    board.items.unshift({ id: board.next++, kind: 'frame', title: frame, x: left, y: bottom, w: r - left + pad, h: rowH + pad, z: -1 });
  }
  board.items.push(...placed);
  await moBoardSave(db, planId, board);
  document.dispatchEvent(new CustomEvent('mo:board-changed', { detail: { planId } }));
  return placed.length;
}

// What a board needs, built from Media Organizer's own pieces (deps from main.js).
export function moBoardContext(d, planId) {
  let src = null, image = null;
  const loadImage = async () => {
    if (image) return image;
    const data = await d.planLoad(planId);
    src = data ? await d.resolvePath({ type: 'photo', id: data.plan.photo_id }) : null;
    const url = src ? await d.fileUrl(src) : null;
    if (!url) throw new Error('The plan\u2019s photo is not on disk right now.');
    image = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('The photo could not be decoded.')); im.src = url; });
    return image;
  };
  return {
    api: d.api, db: d.db, planId, getSetting: d.getSetting, setSetting: d.setSetting,
    loadPlan: () => d.planLoad(planId),
    async renderVariant(recipe, max) {
      const im = await loadImage();
      const cv = moEl('canvas');
      const rr = d.planRenderer(cv);
      if (!rr) throw new Error('No WebGL for the board.');
      try {
        const rs = d.rotatedSize(im.naturalWidth, im.naturalHeight, recipe.rotate);
        const W = rs.w * recipe.crop.w, H = rs.h * recipe.crop.h, k = Math.min(1, max / Math.max(W, H));
        rr.setSource(im, recipe.blur > 0 ? (recipe.blur * Math.max(im.naturalWidth, im.naturalHeight)) / 100 : 0);
        const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
        if (recipe.show === 'colour' && d.massesOf) {
          const out = moEl('canvas'); out.width = w; out.height = h;
          out.getContext('2d').putImageData(new ImageData(d.massesOf(rr.render(recipe, { width: w, height: h, full: false, split: -1, read: true, aids: false }), w, h, recipe), w, h), 0, 0);
          return out.toDataURL('image/jpeg', 0.86);
        }
        rr.render(recipe, { width: w, height: h, full: false, split: -1, matte: recipe.show && recipe.show !== 'photo' ? 'grey' : null }); // Ignore background, as the plan shows it
        return cv.toDataURL('image/jpeg', 0.86);
      } finally { rr.dispose(); }
    },
    thumb: d.thumb, searchPhotos: d.searchPhotos, openPlan: () => d.openPlan(planId), ingest: d.ingest,
    sourcePath: async () => { await loadImage().catch(() => {}); return src; },
  };
}

// The plan editor's Add To Board menu. cur: the editor's state (plan, variants, variant).
export function moBoardMenuItems(d, planId, cur) {
  const a = cur.plan && cur.plan.canvas_w > 0 && cur.plan.canvas_h > 0 ? cur.plan.canvas_w / cur.plan.canvas_h : 0.8;
  const vSpec = (v) => ({ kind: 'variation', variantId: v.id, w: 290, h: Math.round(290 / (v.recipe && v.recipe.canvas ? v.recipe.canvas.w / v.recipe.canvas.h : a) + 44) });
  const pSpec = (v, under) => ({ kind: 'palette', variantId: v.id, w: 290, h: 110, under });
  const done = async (specs, frame, what) => {
    const n = await moBoardAdd(d.db, planId, specs, frame);
    const go = await d.api.window.showInformationMessage(`Added ${what} to the board.`, { title: 'Open Board' });
    if (go && go.title === 'Open Board') d.openBoard(planId);
    return n;
  };
  const v = cur.variant, all = cur.variants || [];
  return [
    { label: 'This Variation', disabled: !v, onSelect: () => void done([vSpec(v)], null, v.name) },
    { label: 'Every Variation With Its Palette', disabled: !all.length, onSelect: () => void done(all.flatMap((x, i) => [vSpec(x), pSpec(x, i * 2)]), 'Variations', `${all.length} variation${all.length === 1 ? '' : 's'} and their palettes`) },
    { label: 'This Palette', disabled: !v, onSelect: () => void done([pSpec(v)], null, `the ${v.name} palette`) },
    { label: 'The Reference Photo', disabled: !cur.plan, onSelect: () => void done([{ kind: 'photo', photoId: cur.plan.photo_id, title: 'Reference', w: 260, h: 300 }], null, 'the reference photo') },
  ];
}

