// reading-cast-c.mjs — the third cast for the reading bench: cards the app
// wrote itself. run-card-standard.mjs sends the Studio's own sheet request
// for short concepts of the kind a person types and keeps the sheets in
// .card-standard-sheets.json; this module plays those cards, as written, on
// scenes of their own. The difference from cast b is who wrote the card: a
// person, to the standard, or the app, from a concept and the field
// requirements. The concept ids below are the ones in run-card-standard.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEETS_FILE = path.join(__dirname, '.card-standard-sheets.json');

function loadSheets() {
  if (!fs.existsSync(SHEETS_FILE)) throw new Error(`No generated cards at ${SHEETS_FILE}: run run-card-standard.mjs first.`);
  return JSON.parse(fs.readFileSync(SHEETS_FILE, 'utf8'));
}

/** The scenes, each leading with two concept ids; the cards come from the sheets file. */
export const SCENES_C = [
  {
    id: 'counter-comic', title: 'Night obs on the ward', catches: 'two concepts that said "always" (counts out loud, answers with a joke), written by the app as tendencies: how often each shows in play, and whether a question gets a straight answer',
    leadIds: ['rule-counter', 'rule-comic'], scene: { location: 'a four-bed bay on a medical ward', time: '3 a.m.', mood: 'the ward asleep, one lamp' },
    situation: 'A four-bed bay on a medical ward at 3 a.m. Bernie Glass was admitted after a fall outside a club where he had been doing an open spot; Beatrice Holloway is the nurse on nights, doing his observations. He has been asking since midnight when he can go home. Sam is the porter, waiting to take Bernie down for an X-ray.',
    opening: '*I park the wheelchair at the end of the bed.* X-ray is ready for him now, Beatrice. Is he good to go?',
    nudges: { 6: '*I check my phone.* They say if he is not down in ten minutes they take the next one.' },
  },
  {
    id: 'chatty-formal', title: 'A fare across the city', catches: 'a talker against a formal man; the anecdote tendency, the Latin tendency; a question answered across registers',
    leadIds: ['chatty', 'formal'], scene: { location: 'a taxi on the quays, Dublin', time: 'late afternoon', mood: 'traffic, rain on the windscreen' },
    situation: 'Paddy O\'Shea\'s taxi, stuck on the Dublin quays in rain at half four. Howard Finch is the fare, over from the States for a conference, due to give the opening address at six and in the wrong half of the city. Sam is Howard\'s daughter, in the back seat beside him, who booked the taxi.',
    opening: '*I look at the maps on my phone.* Paddy, it says forty minutes this way. Is there another road? Dad, your talk is at six.',
    nudges: { 6: '*I put the phone away.* Dad, tell him what the talk is about. He asked.' },
  },
  {
    id: 'child-villain', title: 'The lost-and-found and the landlord', catches: 'a child who stays a child against a smooth adult; a villain charming on the surface, with what is under it; the Reminder as a fact that is not said aloud',
    leadIds: ['child', 'villain'], scene: { location: 'the front step of a terraced house', time: 'Saturday morning', mood: 'a shoebox on the step, a car idling' },
    situation: 'The front step of a terraced house on Saturday morning. Leo Finch has his lost-and-found shoebox open on the step. Arthur Penhaligon, who owns most of the street and is quietly ending the leases on it, has stopped his car to ask about a set of keys lost on the street last week. Sam is Leo\'s father, in the doorway with a mug of tea.',
    opening: '*I lean on the door frame.* Morning, Mr Penhaligon. Leo, the gentleman is asking about some keys.',
    nudges: { 6: '*I sip the tea.* Mrs Higgins said she had a letter from your office, Mr Penhaligon. Is that right?' },
  },
  {
    id: 'terse-loud', title: 'A rail to weld before the weather', catches: 'a terse voice that still takes up and gives, a loud second-language voice that stays a person; two Reminders that are secrets, and whether the chat makes the scene about them',
    leadIds: ['terse', 'second-language'], scene: { location: 'the gallery of a lighthouse on a Norwegian island', time: 'noon', mood: 'wind rising, a supply boat at the jetty' },
    situation: 'The gallery of a lighthouse on a Norwegian island at noon. Andrzej Nowak has come over on the supply boat to weld a broken section of the gallery rail; Solveig Dahl keeps the light and wants the job done before the wind makes the jetty unusable. Sam is the supply boat skipper, come up the stairs to say how long the boat can wait.',
    opening: '*I come out onto the gallery.* Two hours, then I am leaving with or without him. How far along are you?',
    nudges: { 6: '*I look at the sky.* It is turning. Andrzej, can it be finished today or not?' },
  },
];

export function scenesForCastC() {
  const sheets = loadSheets();
  return SCENES_C.map((s) => ({
    ...s,
    leads: s.leadIds.map((id) => {
      const entry = sheets[id];
      if (!entry) throw new Error(`No generated card for concept "${id}".`);
      return entry.sheet;
    }),
  }));
}
