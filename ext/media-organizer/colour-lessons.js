// colour-lessons.js — what Colour Study says about colour: the sentence under
// each row (worked out from the colour in hand and the painter's paints, so
// it names the tube to reach for) and the general rule behind it, opened with
// Why. Written once, here; nothing about any one painting.

/** The rows, in the order they are shown. */
export const MO_COLOUR_ROWS = [
  { id: 'value', title: 'Value', why: 'Value is how light or dark a colour is, apart from its hue. A painting reads from across the room by its values; hue only decorates them. Get the value right and a colour can be a long way off in hue and still look true.' },
  { id: 'light', title: 'Light to shadow', why: 'Light has a colour, and shadow takes the other side. Under warm light the lit side leans yellow and the shadow leans blue violet; under cool light it is the other way round. So lit leaves go toward yellow, not toward white, and their shadows go deep and cool, not toward black. Colour is strongest in the half tones: it drains from the deepest shadow and the brightest highlight.' },
  { id: 'tone', title: 'Intensity', why: 'Two colours opposite each other on the painter’s wheel cancel each other out. A little of the opposite greys a colour and leaves it a colour. Black greys it too, but darkens it and makes it look dead beside its neighbours. White or a dark earth then brings the value back to where it was.' },
  { id: 'temp', title: 'Warm and cool', why: 'Every colour has a warmer and a cooler version. Warm leans toward orange, cool toward blue: a warm green has more yellow in it, a cool green more blue. Warm colours come forward and cool colours sit back, so the same green can be near grass or far hills.' },
  { id: 'twins', title: 'Value twins', why: 'Colours that feel nothing alike can be the same value. Seen in grey they are one tone. Telling value from hue is the hard part of seeing as a painter, and it is a habit: squint, or check in grey, until the eye does it alone.' },
];

const say = (v) => (Math.round(v * 10) / 10).toFixed(1);
const tube = (fix) => (fix && fix.action === 'add' ? fix.name : null);

/**
 * The sentence under a row. `c`: { value, name, fixes: { bright, dark, light, warm, cool } } where each
 * fix is the engine's answer for the colour's own recipe (or null).
 */
export function moRowNote(row, c) {
  const v = say(c.value), f = c.fixes || {};
  if (row === 'value') {
    const up = tube(f.dark), down = tube(f.light);
    return `The same colour from dark to light. Yours is ${v}.${up ? ` To go lighter, add ${up}.` : ''}${down ? ` To go darker, add ${down}.` : ''}`;
  }
  if (row === 'light') return `How this colour turns in ${c.light === 'cool' ? 'cool' : 'warm'} light: the lights lean ${c.light === 'cool' ? 'blue' : 'yellow'}, the shadows ${c.light === 'cool' ? 'orange' : 'blue violet'}, and both ends lose colour.`;
  if (row === 'tone') {
    const t = tube(f.bright);
    return `Full strength down to grey, all at value ${v}.${t ? ` To move right, add ${t}: of your tubes it greys this colour best.` : ''}`;
  }
  if (row === 'temp') {
    const w = tube(f.cool), k = tube(f.warm);
    return `Cooler on the left, warmer on the right, all at value ${v}.${w ? ` ${w} warms it.` : ''}${k ? ` ${k} cools it.` : ''}`;
  }
  return `Different colours, one value: ${v}. Turn on Show in Grey and they become a single grey.`;
}
