import fs from 'fs/promises';
import path from 'path';

export interface BooksSourceGroundTruth {
  id: string;
  title: string;
  relativePath: string;
  aliases: string[];
  expectedFacts: string[];
}

export const BOOKS_SOURCE_TRUTH: Record<string, BooksSourceGroundTruth> = {
  dailyStoic: {
    id: 'dailyStoic',
    title: 'The Daily Stoic 366 Meditations on Wisdom, Perseverance, and the Art of Living.pdf',
    relativePath: 'Stoicism/The Daily Stoic 366 Meditations on Wisdom, Perseverance, and the Art of Living.pdf',
    aliases: [
      'The Daily Stoic',
      'Daily Stoic',
      'The Daily Stoic 366 Meditations on Wisdom, Perseverance, and the Art of Living',
    ],
    expectedFacts: [
      '366 meditations',
      'Ryan Holiday',
      'Stephen Hanselman',
    ],
  },
  fsiShona: {
    id: 'fsiShona',
    title: 'FSI - Shona Basic Course - Student Text.pdf',
    relativePath: 'Zimbabwe/FSI - Shona Basic Course - Student Text.pdf',
    aliases: [
      'FSI - Shona Basic Course - Student Text',
      'FSI Shona',
      'Shona Basic Course',
      'Foreign Service Institute Shona',
    ],
    expectedFacts: [
      'Foreign Service Institute',
      '1965',
      'Zezuru',
      'Manyika',
      'Korekore',
    ],
  },
  howChangeHappens: {
    id: 'howChangeHappens',
    title: 'How Change Happens.pdf',
    relativePath: 'Activism/How Change Happens.pdf',
    aliases: [
      'How Change Happens',
      'Duncan Green',
    ],
    expectedFacts: [
      'Duncan Green',
      'power',
      'politics',
      'institutions',
    ],
  },
  blackSkinWhiteMasks: {
    id: 'blackSkinWhiteMasks',
    title: 'Black Skin, White Masks.pdf',
    relativePath: 'Activism/Black Skin, White Masks.pdf',
    aliases: [
      'Black Skin, White Masks',
    ],
    expectedFacts: [],
  },
  freedomConstantStruggle: {
    id: 'freedomConstantStruggle',
    title: 'Freedom Is a Constant Struggle.pdf',
    relativePath: 'Activism/Freedom Is a Constant Struggle.pdf',
    aliases: [
      'Freedom Is a Constant Struggle',
    ],
    expectedFacts: [],
  },
  nihilismNegritude: {
    id: 'nihilismNegritude',
    title: 'Nihilism and Negritude.pdf',
    relativePath: 'Activism/Nihilism and Negritude.pdf',
    aliases: [
      'Nihilism and Negritude',
    ],
    expectedFacts: [],
  },
  saraAhmed: {
    id: 'saraAhmed',
    title: 'Sara Ahmed Trying to Transform.pdf',
    relativePath: 'Activism/Sara Ahmed Trying to Transform.pdf',
    aliases: [
      'Sara Ahmed Trying to Transform',
      'Trying to Transform',
    ],
    expectedFacts: [],
  },
  slacktivism: {
    id: 'slacktivism',
    title: 'Slacktivism.pdf',
    relativePath: 'Activism/Slacktivism.pdf',
    aliases: [
      'Slacktivism',
    ],
    expectedFacts: [],
  },
  shonaDictionary: {
    id: 'shonaDictionary',
    title: 'Shona-English English-Shona (ChiShona) Dictionary and Phrasebook ( PDFDrive.com ).pdf',
    relativePath: 'Zimbabwe/Shona-English English-Shona (ChiShona) Dictionary and Phrasebook ( PDFDrive.com ).pdf',
    aliases: [
      'Shona-English English-Shona',
      'Dictionary and Phrasebook',
      'ChiShona Dictionary',
    ],
    expectedFacts: [
      'dictionary',
      'phrasebook',
    ],
  },
  tsumo: {
    id: 'tsumo',
    title: 'Tsumo - Shumo _ Shona proverbial lore and wisdom ( PDFDrive.com ).pdf',
    relativePath: 'Zimbabwe/Tsumo - Shumo _ Shona proverbial lore and wisdom ( PDFDrive.com ).pdf',
    aliases: [
      'Tsumo',
      'Shona proverbial lore and wisdom',
    ],
    expectedFacts: [
      'proverbial',
      'wisdom',
    ],
  },
  richEpub: {
    id: 'richEpub',
    title: 'I Will Teach You to Be Rich_ No Guilt, No Excuses - Just a 6-Week Programme That Works.epub',
    relativePath: 'Philosophy/I Will Teach You to Be Rich_ No Guilt, No Excuses - Just a 6-Week Programme That Works.epub',
    aliases: [
      'I Will Teach You to Be Rich',
      'I Will Teach You to Be Rich epub',
    ],
    expectedFacts: [
      'epub',
    ],
  },
};

export const ACTIVISM_SOURCE_IDS = [
  'blackSkinWhiteMasks',
  'freedomConstantStruggle',
  'howChangeHappens',
  'nihilismNegritude',
  'saraAhmed',
  'slacktivism',
] as const;

export function normalizeMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.pdf\b|\.epub\b|\.docx\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function responseMentionsAlias(responseText: string, aliases: readonly string[]): boolean {
  const normalizedResponse = normalizeMatchText(responseText);
  return aliases.some((alias) => normalizedResponse.includes(normalizeMatchText(alias)));
}

export function containsAllNormalized(phrases: readonly string[]): (responseText: string) => boolean {
  return (responseText: string) => {
    const normalizedResponse = normalizeMatchText(responseText);
    return phrases.every((phrase) => normalizedResponse.includes(normalizeMatchText(phrase)));
  };
}

export function containsAnyNormalized(phrases: readonly string[]): (responseText: string) => boolean {
  return (responseText: string) => {
    const normalizedResponse = normalizeMatchText(responseText);
    return phrases.some((phrase) => normalizedResponse.includes(normalizeMatchText(phrase)));
  };
}

export async function validateBooksWorkspaceGroundTruth(workspacePath: string): Promise<void> {
  const missing: string[] = [];

  for (const source of Object.values(BOOKS_SOURCE_TRUTH)) {
    const absolutePath = path.join(workspacePath, source.relativePath);
    const exists = await fs.stat(absolutePath).then((stat) => stat.isFile()).catch(() => false);
    if (!exists) {
      missing.push(source.relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Books workspace is missing ${missing.length} required benchmark files:\n` +
      missing.map((entry) => `- ${entry}`).join('\n'),
    );
  }
}