import fs from 'fs/promises';
import path from 'path';

export interface Exam7SourceGroundTruth {
  id: string;
  title: string;
  relativePath: string;
  aliases: string[];
  expectedFacts: string[];
}

export const EXAM7_SOURCE_TRUTH: Record<string, Exam7SourceGroundTruth> = {
  readingList: {
    id: 'readingList',
    title: 'Exam 7 Reading List.pdf',
    relativePath: 'Exam 7 Reading List.pdf',
    aliases: [
      'Exam 7 Reading List',
      'Reading List',
    ],
    expectedFacts: [
      'Mack (1994)',
      '82',
      'Hurlimann',
      'Clark',
    ],
  },
  studyGuide: {
    id: 'studyGuide',
    title: 'Study Guide - CAS Exam 7 RF.pdf',
    relativePath: 'Study Guide - CAS Exam 7 RF.pdf',
    aliases: [
      'Study Guide - CAS Exam 7 RF',
      'Exam 7 Study Guide',
      'Study Guide',
    ],
    expectedFacts: [
      'Advanced Estimation of Claims Liabilities',
      'Mack – Chain-Ladder',
      'Clark',
    ],
  },
  mackChainLadder: {
    id: 'mackChainLadder',
    title: 'Mack_Chain Ladder.pdf',
    relativePath: 'Source Material/Mack_Chain Ladder.pdf',
    aliases: [
      'Mack Chain Ladder',
      'Mack_Chain Ladder',
      'Measuring the Variability of Chain Ladder Reserve Estimates',
    ],
    expectedFacts: [
      'standard error',
      'confidence interval',
      'outstanding claims reserve',
    ],
  },
  benktanderWorkbook: {
    id: 'benktanderWorkbook',
    title: 'Mack - Benktander.xlsx',
    relativePath: 'Practice Problems/Mack - Benktander.xlsx',
    aliases: [
      'Mack - Benktander',
      'Benktander workbook',
      'Mack Benktander',
    ],
    expectedFacts: [
      '70%',
      '2023',
      '6,000',
    ],
  },
  rfClark: {
    id: 'rfClark',
    title: 'Clark.pdf',
    relativePath: 'RF Guides/Clark.pdf',
    aliases: [
      'Clark',
      'Clark.pdf',
    ],
    expectedFacts: [],
  },
  sourceClark: {
    id: 'sourceClark',
    title: 'Clark.pdf',
    relativePath: 'Source Material/Clark.pdf',
    aliases: [
      'Clark',
      'Clark.pdf',
    ],
    expectedFacts: [],
  },
};

export const RF_GUIDE_SOURCE_IDS = [
  'Brosius.pdf',
  'Clark.pdf',
  'Friedland.pdf',
  'Hurlimann.pdf',
  'MackBenktander.pdf',
  'MackChainLadder.pdf',
  'Marshall.pdf',
  'Meyers.pdf',
  'Sahasrabuddhe.pdf',
  'Shapland.pdf',
  'Siewert.pdf',
  'TaylorMcGuire.pdf',
  'TengPerkins.pdf',
  'VenterFactors.pdf',
  'Verrall.pdf',
] as const;

export function normalizeMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.(pdf|epub|docx|xlsx|xlsm|xls|csv)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export async function validateExam7WorkspaceGroundTruth(workspacePath: string): Promise<void> {
  const missing: string[] = [];

  for (const source of Object.values(EXAM7_SOURCE_TRUTH)) {
    const absolutePath = path.join(workspacePath, source.relativePath);
    const exists = await fs.stat(absolutePath).then((stat) => stat.isFile()).catch(() => false);
    if (!exists) {
      missing.push(source.relativePath);
    }
  }

  for (const relativePath of RF_GUIDE_SOURCE_IDS.map((name) => `RF Guides/${name}`)) {
    const absolutePath = path.join(workspacePath, relativePath);
    const exists = await fs.stat(absolutePath).then((stat) => stat.isFile()).catch(() => false);
    if (!exists) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Exam 7 workspace is missing ${missing.length} required benchmark files:\n`
      + missing.map((entry) => `- ${entry}`).join('\n'),
    );
  }
}