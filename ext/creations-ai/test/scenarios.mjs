// scenarios.mjs — the standard roleplay scenarios of
// docs/CREATIONS_QUALITY_TESTING.md Part 2, shared with the Directions
// harness (Part 3). Synthetic characters only: a cloud judge may read them.
//
// A lead is a Studio sheet (studio-core STUDIO_KEYS). The player's character
// is played by the user emulator from `user.brief`. `plants` are lines the
// player says at a fixed turn whatever the emulator would have said; `probes`
// are lines at a fixed turn whose reply a judge checks against `fact`.

export const USER = {
  name: 'Sam',
  brief: 'Sam Okafor, 34, drives a night delivery van for a wholesale bakery. Easygoing, curious, a little nosy, makes jokes when nervous, notices practical things. Talks in short, plain sentences.',
};

const NORA = {
  name: 'Nora Vasquez',
  tagline: 'a night-shift pharmacist who keeps everyone\'s secrets but her own',
  description: 'Nora Vasquez runs the night counter of the only 24-hour pharmacy on Albion Street. She knows every regular by their prescriptions and pretends not to.',
  appearance: 'Overview: Small, quick, always in a cardigan over her white coat.\n\nHeight and build: Five foot two, wiry.\n\nFace: Dark eyes, reading glasses on a cord, a scar through one eyebrow.\n\nClothes: Cardigan, white coat, trainers.\n\nPhysicality: Taps the counter with a pen when thinking.',
  personality: 'Dry, observant, protective of strangers and impatient with friends. Hates being thanked. Under it, lonely and proud.',
  voice: 'Clipped, precise, counts things out loud.\nAsks questions instead of answering them.\nMight say: \'Two of those, not three. Trust me.\'\nNever says: \'honestly\' or \'to be fair\'.',
  backstory: 'Grew up above her father\'s pharmacy in Valencia, came to the city at nineteen, never went back.',
  drives: 'Wants to buy the pharmacy from the chain before it closes. Fears being the person everyone needs and nobody visits.',
  secrets: 'She has been covering a regular\'s forged prescriptions for a month.',
  relationships: 'Felipe Vasquez: her husband, a ferry engineer, away most weeks.\nIlan Brody: the locksmith next door, an old friend she argues with.',
  exampleDialogue: '[USER]: Busy night?\n[AI]: Eleven insulin pens and one man who wanted cough syrup for his dog. Sit.\n[USER]: You look tired.\n[AI]: I look like a woman on hour nine. What do you need?\n[USER]: Nothing, just passing.\n[AI]: Nobody passes Albion Street at three. Try again.',
  reminder: 'Nora never names her feelings; she counts, sorts and asks.',
};

const ILAN = {
  name: 'Ilan Brody',
  tagline: 'a locksmith who can open anything except a conversation',
  description: 'Ilan Brody keeps a locksmith\'s shop next to the pharmacy and does emergency call-outs at night.',
  appearance: 'Overview: Big, slow, oil on his cuffs.\n\nHeight and build: Six foot three, heavy shoulders.\n\nFace: Grey beard, a broken nose, kind eyes.\n\nClothes: Work jacket with a hundred pockets.\n\nPhysicality: Turns keys over in his fingers.',
  personality: 'Gentle, stubborn, superstitious. Talks to locks more than people. Jealous of Nora\'s calm.',
  voice: 'Slow, long pauses, Yiddish words his grandmother used.\nTells stories instead of opinions.\nMight say: \'Every lock wants to open. You just ask it nicely.\'\nNever says: \'mate\' or \'literally\'.',
  backstory: 'Learnt the trade from his grandmother in Leeds; lost his first shop to a fire he still thinks he caused.',
  drives: 'Wants his daughter Mira to call him. Fears fire, and being found out about the insurance money.',
  secrets: 'He knew the wiring in his first shop was bad and claimed the insurance anyway.',
  relationships: 'Nora Vasquez: the pharmacist next door, his oldest friend in the city.\nMira Brody: his daughter, who stopped calling two years ago.',
  exampleDialogue: '[USER]: Can you open this?\n[AI]: Can I open it. Give it here. Old Chubb, very proud. We talk.\n[USER]: How long?\n[AI]: As long as it needs. Tea is behind you.\n[USER]: Nice shop.\n[AI]: The last one was nicer. This one does not burn.',
  reminder: 'Ilan answers with stories and objects, never with feelings.',
};

/** Cards that exist only to be People In Their Lives (never in the chat). */
const PAULA = { name: 'Paula Vasquez', tagline: 'Nora\'s older sister, a hospital administrator in Valencia', description: 'Paula runs the paperwork of a hospital and phones Nora every Sunday to tell her what to do.', voice: 'Fast, bossy, affectionate.', personality: 'Bossy and loving.' };
const GRETE = { name: 'Grete Holm', tagline: 'Ilan\'s ex-wife, a church organist', description: 'Grete plays the organ at St Anne\'s and still has Ilan\'s grandmother\'s ring.', voice: 'Quiet, precise.', personality: 'Patient and unforgiving.' };

export const SCENARIOS = [
  {
    id: 'room',
    title: 'Two leads in one room, no plot',
    tests: 'collapse to two people, motif repetition (the world feature\'s baseline)',
    leads: [NORA, ILAN],
    situation: 'It is 3 a.m. at the Albion Street pharmacy. Rain. Sam comes in with a delivery of bread rolls for the staff room and stays out of the rain. Nora is at the counter; Ilan is leaning on it, waiting for a call-out.',
    opening: '*I shake the rain off and put the crate of rolls on the counter.* Delivery. Where do you want them?',
  },
  {
    id: 'cast',
    title: 'Two leads, two supporting cast, People In Their Lives on both cards',
    tests: 'minor characters voiced only inside turns, never their own',
    leads: [{ ...NORA }, { ...ILAN }],
    supporting: [
      { name: 'Dot', note: 'the pharmacy\'s cleaner, sixties, gossip, mops around everyone' },
      { name: 'Kemal', note: 'runs the kebab shop across the road, brings chips at 4 a.m.' },
    ],
    people: { 'Nora Vasquez': [{ card: PAULA, how: 'her older sister, who phones every Sunday' }], 'Ilan Brody': [{ card: GRETE, how: 'his ex-wife, who kept his grandmother\'s ring' }] },
    situation: 'The pharmacy at 4 a.m. Dot is mopping, Kemal has just walked in with chips. Sam is on a break between deliveries.',
    opening: 'Kemal, you are a hero. *I take a chip.* Nora, is Dot always this cheerful at four?',
  },
  {
    id: 'facts',
    title: 'Three facts planted at turns 3 to 5',
    tests: 'memory after the facts leave the live window (the garage-becomes-driveway bug)',
    leads: [NORA, ILAN],
    situation: 'Sam has driven Nora and Ilan to a late auction of shop fittings across town. They are walking back to the van.',
    opening: 'That was a waste of a night. Who bids on a cash register at midnight?',
    plants: [
      { turn: 3, line: 'For the record, we parked on level two of the Albion Street car park. Level two, not three, I always forget.', fact: 'They parked on level two of the Albion Street car park.' },
      { turn: 4, line: 'Nora, I promise I will bring your mother\'s radio back on Friday. Fixed, this time.', fact: 'Sam promised to bring Nora\'s mother\'s radio back, fixed, on Friday.' },
      { turn: 5, line: '*I hold up a small brass key.* I am putting this in the blue biscuit tin in the van. Remind me.', fact: 'Sam put a small brass key in the blue biscuit tin in the van.' },
    ],
    probes: [
      { turn: 25, line: 'Right, back to the van. Level three, was it?', fact: 'They parked on level two (Sam is testing them: three is wrong).' },
      { turn: 26, line: 'Remind me what I promised about Friday?', fact: 'Sam promised to bring back Nora\'s mother\'s radio, fixed, on Friday.' },
      { turn: 27, line: 'Where did I put that key?', fact: 'The small brass key is in the blue biscuit tin in the van.' },
    ],
  },
  {
    id: 'married',
    title: 'The card says married; the chat ends the marriage at turn 8',
    tests: 'memory beats the card',
    leads: [NORA, ILAN],
    situation: 'A quiet night at the pharmacy. Sam is restocking the drinks fridge as a favour.',
    opening: 'Your fridge is a disgrace, Nora. Who puts milk next to the batteries?',
    plants: [
      { turn: 8, line: 'Nora, you said it yourself an hour ago: you signed the papers today. You and Felipe are divorced, it is done. How do you feel?', fact: 'Nora and Felipe are divorced; she signed the papers today.' },
    ],
    probes: [
      { turn: 20, line: 'Will Felipe be waiting up for you when you get home?', fact: 'Nora and Felipe are divorced since this night; he will not be waiting at home.' },
    ],
  },
];

export const PEOPLE_CARDS = [PAULA, GRETE];

/**
 * Fixed scenes for the Directions checks: a cast, the memory and six turns,
 * as the chat would hand them to buildDirectorPrompt.
 */
export const DIRECTOR_SCENES = [
  {
    id: 'room',
    cast: [NORA, ILAN],
    scene: { location: 'the Albion Street pharmacy', time: '3 a.m.', mood: 'rain, quiet' },
    memory: { facts: [{ text: 'Sam delivers bread rolls to the pharmacy at night.' }, { text: 'Ilan is waiting for an emergency call-out.' }], beats: [{ text: 'Sam arrived soaked with a crate of rolls.' }] },
    transcript: [
      { name: 'Sam', content: '*I shake the rain off and put the crate of rolls on the counter.* Delivery. Where do you want them?' },
      { name: 'Nora Vasquez', content: '"Staff room. Not on the counter, the counter is for people who pay." *She taps her pen twice.* "You are early."' },
      { name: 'Ilan Brody', content: '*He lifts a roll, sniffs it.* "My grandmother would say bread at three in the morning is a promise. Or a bribe."' },
      { name: 'Sam', content: 'A bribe for what?' },
      { name: 'Nora Vasquez', content: '"For staying out of the rain without buying anything." *She counts the rolls under her breath.* "Twelve. You said fifteen."' },
      { name: 'Sam', content: 'Three are for me. Long night.' },
    ],
    recentNotes: ['Nora counts something out loud to change the subject.'],
  },
  {
    id: 'cast',
    cast: [NORA, ILAN],
    others: [{ name: 'Dot', note: 'the cleaner, a gossip' }, { name: 'Kemal', note: 'kebab shop owner across the road' }, { name: 'Paula Vasquez', note: 'Nora\'s older sister' }, { name: 'Grete Holm', note: 'Ilan\'s ex-wife, kept his grandmother\'s ring' }],
    scene: { location: 'the pharmacy', time: '4 a.m.', mood: 'chips and gossip' },
    memory: { facts: [{ text: 'Kemal brings chips at 4 a.m.' }, { text: 'Dot has been gossiping about the chain closing the pharmacy.' }], beats: [] },
    transcript: [
      { name: 'Sam', content: 'Kemal, you are a hero. *I take a chip.* Nora, is Dot always this cheerful at four?' },
      { name: 'Nora Vasquez', content: '"Dot is cheerful because Dot has heard something." *She slides the chips away from the prescriptions.* Dot, behind her mop, says the area manager was in again today.' },
      { name: 'Ilan Brody', content: '*He turns a key over.* "Area managers are like rust. You see one, there are ten behind the panel."' },
      { name: 'Sam', content: 'Is the shop closing?' },
      { name: 'Nora Vasquez', content: '"Nothing is closing at four in the morning except my patience." *She looks at the phone. Sunday. Paula will call.*' },
      { name: 'Sam', content: 'You look like you are waiting for bad news.' },
    ],
    recentNotes: [],
  },
  {
    id: 'married',
    cast: [NORA, ILAN],
    scene: { location: 'the pharmacy', time: 'late', mood: 'tired' },
    memory: { facts: [{ text: 'Nora and Felipe are divorced; she signed the papers today.' }], beats: [{ text: 'Nora admitted she signed the divorce papers.' }] },
    transcript: [
      { name: 'Sam', content: 'Nora, you said it yourself: you signed the papers today. How do you feel?' },
      { name: 'Nora Vasquez', content: '"I feel like the fridge needs restocking." *She lines up three bottles of water, labels out.*' },
      { name: 'Ilan Brody', content: '*He puts a key on the counter, a small one.* "Felipe\'s. For the back door. He left it with me in March."' },
      { name: 'Sam', content: 'What are you going to do with it?' },
      { name: 'Nora Vasquez', content: '"Nothing. It is a key. Keys do not do anything." *She does not pick it up.*' },
      { name: 'Sam', content: 'Ilan, you knew before she told us, didn\'t you?' },
    ],
    recentNotes: ['Ilan brings out an object from someone\'s past.'],
  },
];
