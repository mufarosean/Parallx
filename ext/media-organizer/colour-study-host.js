// colour-study-host.js — what Colour Study needs from the rest of Atelier (the
// library's photos, a painting plan as it stands) and its two tabs. main.js
// hands in its own helpers once (`h`); nothing here knows the library's code.

import { moEl } from './dom.js';
import { moRenderColourSheet } from './colour-study.js';
import { moColourStudyActivate, moRenderColourHome } from './colour-study-home.js';
import { moBrowsePhotos } from './colour-study-picture.js';
import { moOpenPlace, moPlaceName } from './atelier-places.js';

let planInUse = null;
/** The plan whose editor was opened last: Open In Colour Study, run as a bare command, means that one. */
export function moColourPlanOpened(planId) { planInUse = planId; }

/**
 * h: { db, getSetting, setSetting, boardDeps(api), boardContext(deps, planId), planLoad(planId), planRecipe(raw),
 *   resolvePath(item), fileUrl(path), artGate(api, retry), artOn(), injectStyles() }
 */
export function moColourHost(api, h) {
  // Colour Study and each sheet are places in Atelier's one tab (atelier-places.js); a sheet sits over Colour Study.
  const openHome = () => { if (h.artGate(api, openHome)) void moOpenPlace(api, 'colour'); };
  const openSheet = (id, title) => { moPlaceName('sheet', id, title); return moOpenPlace(api, 'sheet', { id }); };
  const b = h.boardDeps(api);
  const deps = {
    api, db: h.db, getSetting: h.getSetting, setSetting: h.setSetting, openHome, openSheet,
    browsePhotos: (text, offset, limit) => moBrowsePhotos(h.db, text, offset, limit), thumb: b.thumb, planInUse: () => planInUse,
    photoTitle: async (id) => { const r = await h.db.get("SELECT COALESCE(NULLIF(p.title, ''), f.basename) AS title FROM mo_photos p JOIN mo_files f ON f.id = (SELECT file_id FROM mo_photos_files WHERE photo_id = p.id ORDER BY is_primary DESC LIMIT 1) WHERE p.id = ?", [id]).catch(() => null); return r ? r.title : ''; },
    // The original photo, to read colours from.
    photoUrl: async (id) => { const src = await h.resolvePath({ type: 'photo', id }); return src ? h.fileUrl(src) : null; },
    date: (iso) => { try { return api.ui.formatRelativeTime(iso); } catch { return ''; } },
    plans: () => h.db.all('SELECT id, title FROM mo_plans ORDER BY updated_at DESC'),
    // A photo from the library, small enough to keep with a sheet.
    async photoPicture(photoId, max) {
      const src = await h.resolvePath({ type: 'photo', id: photoId }), url = src ? await h.fileUrl(src) : null;
      if (!url) return null;
      const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('The photo could not be decoded.')); i.src = url; });
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = moEl('canvas');
      c.width = Math.max(8, Math.round(im.naturalWidth * k)); c.height = Math.max(8, Math.round(im.naturalHeight * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.92); // what is shown; colours are read from the original
    },
    // A plan as it stands (a named variation, its export variation, or its working picture): the picture and its colours.
    async planSnapshot(planId, variantId) {
      const data = await h.planLoad(planId);
      if (!data) return null;
      const v = data.variants.find((x) => x.id === variantId) || data.variants.find((x) => x.id === data.plan.variant_id);
      let r = v && v.recipe;
      if (!r) { try { r = h.planRecipe(JSON.parse(data.plan.draft_json || '{}')); } catch { r = null; } }
      if (!r) return { title: data.plan.title, picture: '', colours: [] };
      const colours = [...((r.palette && r.palette.swatches) || []).map((c) => (Array.isArray(c) ? c : c && c.rgb)), ...(r.saved || []).map((c) => c.rgb)].filter(Array.isArray);
      const picture = await h.boardContext(b, planId).renderVariant(r, 1600).catch(() => '');
      return { title: data.plan.title, picture: picture || '', colours };
    },
  };
  return {
    openHome,
    commands: () => moColourStudyActivate(api, deps),
    /** The editor pane for a `colour:` tab. */
    renderTab(container, input) {
      const id = (input && (input.instanceId || input.id)) || '';
      h.injectStyles();
      if (!h.artOn()) { container.appendChild(moEl('div', 'mo-practice-empty', { textContent: 'Turn on drawing and painting tools in Atelier settings to use Colour Study.' })); return { dispose() { container.replaceChildren(); } }; }
      return id.startsWith('colour:sheet:') ? moRenderColourSheet(container, api, parseInt(id.slice('colour:sheet:'.length), 10) || 0) : moRenderColourHome(container, api);
    },
  };
}
