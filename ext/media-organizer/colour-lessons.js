// colour-lessons.js — what Colour Study says about colour: the note beside
// each row (one fact, then the paint to reach for, worked out from the colour
// in hand and the painter's paints) and the general rule behind it, opened
// with the row's ?. Kept short. Written once, here; nothing about any one
// painting.

/** The rows, in the order they are shown, with the rule each one teaches. */
export const MO_COLOUR_ROWS = [
  { id: 'value', title: 'Value', why: 'How light or dark a colour is, apart from its hue. Get it right and a colour reads true even when the hue is off.' },
  { id: 'light', title: 'Light to shadow', why: 'The lit side takes the colour of the light; the shadow keeps the object’s colour and goes the other way in temperature. Lit leaves go toward yellow, not white; their shadows go cool, not black.' },
  { id: 'tone', title: 'Intensity', why: 'Opposites on the painter’s wheel cancel. A little of the opposite greys a colour and keeps it alive; black deadens it.' },
  { id: 'temp', title: 'Warm and cool', why: 'Warm leans orange, cool leans blue. Warm comes forward, cool sits back.' },
  { id: 'twins', title: 'Value twins', why: 'Colours that feel different can share a value. Check in grey until the eye sees it alone.' },
];

const say = (v) => (Math.round(v * 10) / 10).toFixed(1);
const tube = (fix) => (fix && fix.action === 'add' ? fix.name : null);

/**
 * The note beside a row: `{ fact, advice: [[label, paint | null]], text }`. `c`: { value, light,
 * fixes: { bright, dark, light, warm, cool } }, each fix the engine's answer for the colour's own recipe
 * (or null). An advice line with a paint reads "label: paint"; without one it is the label alone.
 */
export function moRowNote(row, c) {
  const v = say(c.value), f = c.fixes || {}, cool = c.light === 'cool';
  const lines = (fact, ...advice) => {
    const kept = advice.filter((a) => a && (a[1] || a[1] === null));
    return { fact, advice: kept, text: [fact, ...kept.map(([l, p]) => (p ? `${l}: ${p}.` : l))].join(' ') };
  };
  if (row === 'value') return lines(`Yours is ${v}.`, tube(f.dark) && ['Lighter', tube(f.dark)], tube(f.light) && ['Darker', tube(f.light)]);
  if (row === 'light') return lines(`Lights take the light's ${cool ? 'blue' : 'yellow'}.`, [`Shadows go ${cool ? 'warmer' : 'cooler'}.`, null]);
  if (row === 'tone') return lines(`Greyer, still value ${v}.`, tube(f.bright) && ['Grey it', tube(f.bright)]);
  if (row === 'temp') return lines('Same value and strength.', tube(f.cool) && ['Warmer', tube(f.cool)], tube(f.warm) && ['Cooler', tube(f.warm)]);
  return lines(`All at value ${v}.`, ['Different colours, one grey.', null]);
}
