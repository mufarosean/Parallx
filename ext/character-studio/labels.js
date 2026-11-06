// labels.js — names for the sliders, and how they are grouped into tabs.
//
// MakeHuman names a modifier like "nose-scale-horiz-decr-incr"; the panel
// shows "Width" under "Nose". The words at the end name the two directions
// ("decr-incr", "down-up"); the rest is the part and what changes.

/** The tabs and the MakeHuman groups each one shows, in order. */
export const DETAIL_TABS = [
  { id: 'face', label: 'Face', groups: ['head', 'forehead', 'eyebrows', 'eyes', 'nose', 'mouth', 'cheek', 'chin', 'ears', 'neck'] },
  { id: 'build', label: 'Build', groups: ['torso', 'breast', 'stomach', 'hip', 'pelvis', 'buttocks', 'arms', 'hands', 'legs', 'feet'] },
];

const GROUP_NAMES = {
  head: 'Head', forehead: 'Forehead', eyebrows: 'Eyebrows', eyes: 'Eyes', nose: 'Nose', mouth: 'Mouth', cheek: 'Cheeks',
  chin: 'Chin and jaw', ears: 'Ears', neck: 'Neck', torso: 'Torso', breast: 'Chest', stomach: 'Stomach', hip: 'Hips',
  pelvis: 'Pelvis', buttocks: 'Buttocks', arms: 'Arms', hands: 'Hands', legs: 'Legs', feet: 'Feet',
};
export const groupName = (g) => GROUP_NAMES[g] || sentence(g);

/** The two directions a modifier runs between, as they end its name. */
const ENDS = ['decr-incr', 'down-up', 'in-out', 'backward-forward', 'concave-convex', 'compress-uncompress', 'square-round', 'pointed-triangle'];

const WORDS = {
  upperarm: 'upper arm', lowerarm: 'forearm', upperleg: 'thigh', lowerleg: 'lower leg', upperlegs: 'thighs', lowerlegs: 'lower legs',
  upperlip: 'upper lip', lowerlip: 'lower lip', cupidsbow: "Cupid's bow", eyefold: 'eyelid fold', napetowaist: 'nape to waist',
  waisttohip: 'waist to hip', frontchest: 'front of chest', underbust: 'under the bust', septumangle: 'septum angle',
  vshape: 'V shape', fat: 'fat', circ: 'circumference', dist: 'distance', ext: 'outer edge', prognathism: 'jaw jut',
  nubian: 'brow ridge', epicanthus: 'inner eye fold', valgus: 'knock knees', dorsi: 'back muscle', pectoral: 'chest muscle',
  corner1: 'inner corner', corner2: 'outer corner', height1: 'upper lid', height2: 'lid middle', height3: 'lower lid',
  push1: 'upper lid depth', push2: 'lower lid depth', width1: 'upper width', width2: 'middle width', width3: 'lower width',
  bag: 'eye bags', 'bag-height': 'eye bag height', 'jaw-drop': 'jaw drop', 'laugh-lines': 'laugh lines',
  'muscle-pectoral': 'chest muscle', 'muscle-dorsi': 'back muscle', 'shoulder-muscle': 'shoulder muscle',
};
/** Moves and turns, named by the directions they run between. */
const MOVES = {
  trans: { 'down-up': 'vertical position', 'in-out': 'spacing', 'backward-forward': 'forward position' },
  rot: { 'backward-forward': 'tilt' },
};
const ASPECTS = {
  'scale-horiz': 'width', 'scale-vert': 'height', 'scale-depth': 'depth', scale: 'size', 'trans-down-up': 'up or down',
  'trans-in-out': 'in or out', 'trans-backward-forward': 'back or forward', 'rot-backward-forward': 'tilt', volume: 'volume',
  'volume-vert': 'fullness', muscle: 'muscle', tone: 'tone', angle: 'angle', length: 'length', diameter: 'thickness',
  distance: 'spacing', point: 'tip', 'point-width': 'tip width', 'back-scale-depth': 'back depth',
};

function sentence(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** The slider's name for a modifier category, without its group ("nose-scale-horiz-decr-incr" in "nose": "Width"). */
export function sliderName(category, group) {
  let rest = category; let ends = '';
  for (const end of ENDS) if (rest.endsWith(`-${end}`)) { rest = rest.slice(0, -end.length - 1); ends = end; break; }
  // Measurements: "measure-upperarm-circ" is "Upper arm circumference"
  if (rest.startsWith('measure-')) return sentence(rest.slice(8).split('-').map((w) => (w === 'height' ? 'length' : WORDS[w] || w)).join(' '));
  // Drop the group's own word at the front ("nose-", "ear-", "eye-", "mouth-")
  const lead = { eyes: 'eye', ears: 'ear', cheek: 'cheek', legs: 'leg', hands: 'hand', feet: 'foot', eyebrows: 'eyebrows' }[group] || group;
  let part = '';
  for (const p of [`${lead}-`, `${group}-`]) if (rest.startsWith(p)) { rest = rest.slice(p.length); break; }
  // A part named first ("upperarm-fat", "lowerlip-height"), then the aspect
  const first = rest.split('-')[0];
  if (WORDS[first] && !ASPECTS[rest] && !WORDS[rest]) { part = WORDS[first]; rest = rest.slice(first.length + 1); }
  let aspect = MOVES[rest] ? (MOVES[rest][ends] || rest) : (ASPECTS[rest] || WORDS[rest] || rest.split('-').map((w) => WORDS[w] || w).join(' '));
  if (rest === 'trans' && ends === 'in-out' && !['eyes', 'ears', 'cheek', 'feet', 'hands'].includes(group)) aspect = 'side position';
  if (!rest) aspect = '';
  // A modifier that ends in a direction pair but names nothing else ("eye-trans-down-up" is covered by ASPECTS)
  return sentence([part, aspect].filter(Boolean).join(' ') || group);
}

/** The directions at each end of the slider, for its value text ("Narrower" / "Wider" style kept plain: "Less" / "More"). */
export function sliderEnds(category) {
  if (/-down-up$/.test(category)) return ['Down', 'Up'];
  if (/-in-out$/.test(category)) return ['In', 'Out'];
  if (/-backward-forward$/.test(category)) return ['Back', 'Forward'];
  if (/-concave-convex$/.test(category)) return ['Concave', 'Convex'];
  if (/-compress-uncompress$/.test(category)) return ['Compressed', 'Open'];
  if (/-square-round$/.test(category)) return ['Square', 'Round'];
  if (/-pointed-triangle$/.test(category)) return ['Pointed', 'Triangular'];
  return ['Less', 'More'];
}

/** The detail sliders grouped for one tab: [{ group, name, sliders: [{ category, name, ends, left, right, unsided }] }]. */
export function detailSections(details, tab) {
  const sections = [];
  for (const group of tab.groups) {
    const byCategory = new Map();
    for (const d of details) {
      if (d.group !== group) continue;
      if (!byCategory.has(d.category)) byCategory.set(d.category, { category: d.category, name: sliderName(d.category, group), ends: sliderEnds(d.category) });
      byCategory.get(d.category)[d.side] = d.label;
    }
    const sliders = [...byCategory.values()];
    // Two sliders with one name (a navel in or out, and up or down): say which way each goes
    const seen = new Map();
    for (const sl of sliders) seen.set(sl.name, (seen.get(sl.name) || 0) + 1);
    for (const sl of sliders) if (seen.get(sl.name) > 1) sl.name = `${sl.name} (${sl.ends.join(' or ').toLowerCase()})`;
    if (sliders.length) sections.push({ group, name: groupName(group), sliders });
  }
  return sections;
}

/** The body sliders: id, name and what each end means. */
export const BODY = [
  { id: 'gender', name: 'Masculine to feminine', ends: ['Masculine', 'Feminine'] },
  { id: 'age', name: 'Age', ends: ['Baby', 'Old'] },
  { id: 'height', name: 'Height', ends: ['Shorter', 'Taller'] },
  { id: 'weight', name: 'Weight', ends: ['Lighter', 'Heavier'] },
  { id: 'muscle', name: 'Muscle', ends: ['Less', 'More'] },
  { id: 'proportions', name: 'Proportions', ends: ['Idealised', 'Ordinary'] },
];

/** A person's age in years from the age slider (Anny: 0 baby, 1/3 child, 2/3 young adult, 1 old). */
export function ageYears(age) {
  const stops = [[0, 1], [1 / 3, 11], [2 / 3, 25], [1, 90]];
  const a = Math.min(1, Math.max(0, age));
  for (let i = 1; i < stops.length; i++) if (a <= stops[i][0]) { const [x0, y0] = stops[i - 1]; const [x1, y1] = stops[i]; return Math.round(y0 + (y1 - y0) * (a - x0) / (x1 - x0)); }
  return 90;
}

/** Display names for the looks: "young_caucasian_female2" is "Young caucasian female 2". */
export function lookName(name) {
  return sentence(String(name).replace(/[_-]+/g, ' ').replace(/(\D)(\d+)$/, '$1 $2').replace(/\b0+(\d)/g, '$1'));
}
