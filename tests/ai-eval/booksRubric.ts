import type { Assertion, Dimension, RetrievalExpectation } from './scoring';
import {
  containsAny,
  containsAll,
  containsNone,
  lengthBetween,
  hasCitationMarkers,
} from './scoring';
import type { PipelineExpectation } from './booksScoring';
import {
  ACTIVISM_SOURCE_IDS,
  BOOKS_SOURCE_TRUTH,
  containsAllNormalized,
  containsAnyNormalized,
} from './booksGroundTruth';

export interface BooksTestCaseTurn {
  prompt: string;
  assertions: Assertion[];
  retrievalExpectation?: RetrievalExpectation;
  pipelineExpectation?: PipelineExpectation;
}

export interface BooksTestCase {
  id: string;
  name: string;
  dimension: Dimension;
  description: string;
  turns: BooksTestCaseTurn[];
}

export const BOOKS_RUBRIC: BooksTestCase[] = [
  {
    id: 'BW01',
    name: 'Exact retrieval -- Daily Stoic identification',
    dimension: 'detail-retrieval',
    description: 'Identify the Stoicism book that explicitly says it contains 366 meditations.',
    turns: [{
      prompt: 'Which book in the Stoicism folder explicitly says it contains 366 meditations? Cite the source.',
      assertions: [
        { name: 'Mentions The Daily Stoic', weight: 3, check: containsAnyNormalized(BOOKS_SOURCE_TRUTH.dailyStoic.aliases) },
        { name: 'Mentions 366 meditations', weight: 2, check: containsAnyNormalized(['366 meditations', '366']) },
        { name: 'Has citation markers', weight: 2, check: hasCitationMarkers() },
        { name: 'Does not claim content is unavailable', weight: 2, check: containsNone(['i do not have the content', 'summary not available', 'not available in the current context']) },
      ],
      retrievalExpectation: {
        expectedSources: [BOOKS_SOURCE_TRUTH.dailyStoic.title],
        requiredTerms: ['daily stoic', '366'],
        requireCitation: true,
      },
      pipelineExpectation: {
        expectedSources: [BOOKS_SOURCE_TRUTH.dailyStoic.title],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    }],
  },
  {
    id: 'BW02',
    name: 'Exact retrieval -- FSI Shona dialects',
    dimension: 'detail-retrieval',
    description: 'Retrieve the dialects listed in the FSI Shona preface.',
    turns: [{
      prompt: 'According to the FSI Shona book, which dialects is the standardized form based on? Cite the source.',
      assertions: [
        { name: 'Mentions Zezuru', weight: 2, check: containsAnyNormalized(['Zezuru']) },
        { name: 'Mentions Manyika', weight: 2, check: containsAnyNormalized(['Manyika']) },
        { name: 'Mentions Korekore', weight: 2, check: containsAnyNormalized(['Korekore']) },
        { name: 'Has citation markers', weight: 2, check: hasCitationMarkers() },
        { name: 'Does not refuse coverage', weight: 1, check: containsNone(['do not have the content', 'cannot summarize']) },
      ],
      retrievalExpectation: {
        expectedSources: [BOOKS_SOURCE_TRUTH.fsiShona.title],
        requiredTerms: ['Zezuru', 'Manyika', 'Korekore'],
        requireCitation: true,
      },
      pipelineExpectation: {
        expectedSources: [BOOKS_SOURCE_TRUTH.fsiShona.title],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    }],
  },
  {
    id: 'BW03',
    name: 'Content understanding -- How Change Happens',
    dimension: 'source-attribution',
    description: 'Retrieve authorship and core theme from How Change Happens using explicit grounding.',
    turns: [{
      prompt: 'Who wrote How Change Happens, and what core idea is highlighted in its opening praise pages? Cite the source.',
      assertions: [
        { name: 'Mentions Duncan Green', weight: 2, check: containsAnyNormalized(['Duncan Green']) },
        { name: 'Mentions power or politics', weight: 2, check: containsAnyNormalized(['power', 'politics']) },
        { name: 'Mentions institutions or social change', weight: 2, check: containsAnyNormalized(['institutions', 'social change', 'change']) },
        { name: 'Has citation markers', weight: 2, check: hasCitationMarkers() },
        { name: 'Does not hallucinate another author', weight: 1, check: containsNone(['Ryan Holiday', 'Stephen Hanselman']) },
      ],
      retrievalExpectation: {
        expectedSources: [BOOKS_SOURCE_TRUTH.howChangeHappens.title],
        requiredTerms: ['Duncan Green', 'power'],
        requireCitation: true,
      },
      pipelineExpectation: {
        expectedSources: [BOOKS_SOURCE_TRUTH.howChangeHappens.title],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    }],
  },
  {
    id: 'BW04',
    name: 'Cross-folder duplicate title detection',
    dimension: 'multi-doc-synthesis',
    description: 'Confirm that known duplicate titles exist in both Activism and Black Consciousness.',
    turns: [{
      prompt: 'Do the titles Black Skin, White Masks and Freedom Is a Constant Struggle both appear in Activism and Black Consciousness? Answer directly and cite sources.',
      assertions: [
        { name: 'Mentions Black Skin, White Masks', weight: 2, check: containsAnyNormalized(['Black Skin, White Masks']) },
        { name: 'Mentions Freedom Is a Constant Struggle', weight: 2, check: containsAnyNormalized(['Freedom Is a Constant Struggle']) },
        { name: 'Mentions Activism', weight: 2, check: containsAnyNormalized(['Activism']) },
        { name: 'Mentions Black Consciousness', weight: 2, check: containsAnyNormalized(['Black Consciousness']) },
        { name: 'Has citation markers', weight: 1, check: hasCitationMarkers() },
      ],
      retrievalExpectation: {
        expectedSources: [
          BOOKS_SOURCE_TRUTH.blackSkinWhiteMasks.title,
          BOOKS_SOURCE_TRUTH.freedomConstantStruggle.title,
        ],
        requiredTerms: ['Activism', 'Black Consciousness'],
        requireCitation: true,
      },
      pipelineExpectation: {
        expectedSources: [
          BOOKS_SOURCE_TRUTH.blackSkinWhiteMasks.title,
          BOOKS_SOURCE_TRUTH.freedomConstantStruggle.title,
        ],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 2,
      },
    }],
  },
  {
    id: 'BW05',
    name: 'Coverage job -- summarize each file in Activism',
    dimension: 'deep-retrieval',
    description: 'The assistant should treat this as a coverage job, not a representative retrieval question.',
    turns: [{
      prompt: 'Read each file in the Activism folder and give me exactly one sentence per file. If coverage is incomplete, say that coverage is incomplete.',
      assertions: [
        { name: 'Mentions Black Skin, White Masks', weight: 1, check: containsAnyNormalized([BOOKS_SOURCE_TRUTH.blackSkinWhiteMasks.title]) },
        { name: 'Mentions Freedom Is a Constant Struggle', weight: 1, check: containsAnyNormalized([BOOKS_SOURCE_TRUTH.freedomConstantStruggle.title]) },
        { name: 'Mentions How Change Happens', weight: 1, check: containsAnyNormalized([BOOKS_SOURCE_TRUTH.howChangeHappens.title]) },
        { name: 'Mentions Nihilism and Negritude', weight: 1, check: containsAnyNormalized([BOOKS_SOURCE_TRUTH.nihilismNegritude.title]) },
        { name: 'Mentions Sara Ahmed Trying to Transform', weight: 1, check: containsAnyNormalized([BOOKS_SOURCE_TRUTH.saraAhmed.title]) },
        { name: 'Mentions Slacktivism', weight: 1, check: containsAnyNormalized([BOOKS_SOURCE_TRUTH.slacktivism.title]) },
        { name: 'Does not use unavailable-content excuse', weight: 3, check: containsNone(['i do not have the content', 'summary not available', 'not available in the current context', 'cannot summarize this file']) },
        { name: 'Substantial multi-file response', weight: 2, check: lengthBetween(200, 8000) },
      ],
      retrievalExpectation: {
        expectedSources: ACTIVISM_SOURCE_IDS.map((sourceId) => BOOKS_SOURCE_TRUTH[sourceId].title),
      },
      pipelineExpectation: {
        expectedSources: ACTIVISM_SOURCE_IDS.map((sourceId) => BOOKS_SOURCE_TRUTH[sourceId].title),
        expectedRouteKind: 'grounded',
        expectedIntent: 'exploration',
        expectedCoverageMode: 'exhaustive',
        requireRetrievalAttempted: true,
        minReturnedSources: 4,
      },
    }],
  },
  {
    id: 'BW06',
    name: 'Follow-up -- stoicism drill-down',
    dimension: 'follow-up',
    description: 'Handle a workspace query about Shona books and then narrow correctly on follow-up.',
    turns: [
      {
        prompt: 'Name three books in this workspace about Shona language or culture. Cite the sources.',
        assertions: [
          { name: 'Mentions FSI Shona', weight: 2, check: containsAnyNormalized(BOOKS_SOURCE_TRUTH.fsiShona.aliases) },
          { name: 'Mentions Shona dictionary', weight: 2, check: containsAnyNormalized(BOOKS_SOURCE_TRUTH.shonaDictionary.aliases) },
          { name: 'Mentions Tsumo', weight: 2, check: containsAnyNormalized(BOOKS_SOURCE_TRUTH.tsumo.aliases) },
          { name: 'Has citation markers', weight: 1, check: hasCitationMarkers() },
        ],
        retrievalExpectation: {
          expectedSources: [
            BOOKS_SOURCE_TRUTH.fsiShona.title,
            BOOKS_SOURCE_TRUTH.shonaDictionary.title,
            BOOKS_SOURCE_TRUTH.tsumo.title,
          ],
          requireCitation: true,
        },
        pipelineExpectation: {
          expectedSources: [
            BOOKS_SOURCE_TRUTH.fsiShona.title,
            BOOKS_SOURCE_TRUTH.shonaDictionary.title,
            BOOKS_SOURCE_TRUTH.tsumo.title,
          ],
          expectedRouteKind: 'grounded',
          expectedIntent: 'question',
          requireRetrievalAttempted: true,
          minReturnedSources: 2,
        },
      },
      {
        prompt: 'Which one is the 1965 Foreign Service Institute course?',
        assertions: [
          { name: 'Resolves follow-up to FSI Shona', weight: 3, check: containsAnyNormalized(BOOKS_SOURCE_TRUTH.fsiShona.aliases) },
          { name: 'Mentions 1965', weight: 2, check: containsAnyNormalized(['1965']) },
          { name: 'Does not switch to dictionary or Tsumo', weight: 1, check: containsNone(['dictionary and phrasebook', 'tsumo']) },
        ],
        retrievalExpectation: {
          expectedSources: [BOOKS_SOURCE_TRUTH.fsiShona.title],
          requiredTerms: ['1965', 'Foreign Service Institute'],
        },
        pipelineExpectation: {
          expectedSources: [BOOKS_SOURCE_TRUTH.fsiShona.title],
          expectedRouteKind: 'grounded',
          expectedIntent: 'question',
          requireRetrievalAttempted: true,
          minReturnedSources: 1,
        },
      },
    ],
  },
  {
    id: 'BW07',
    name: 'Honesty guard -- no support in Stoicism',
    dimension: 'hallucination-guard',
    description: 'The assistant should refuse unsupported claims instead of fabricating a stoicism/cookies match.',
    turns: [{
      prompt: 'In the Stoicism folder, which book is about baking chocolate chip cookies? If none, say that none of the Stoicism books appear to be about that.',
      assertions: [
        { name: 'States there is no support', weight: 3, check: containsAnyNormalized(['none of the stoicism books', 'no evidence', 'none appear to be about that']) },
        { name: 'Does not hallucinate a cookie book', weight: 3, check: containsNone(['the daily stoic is about baking', 'cookie recipe', 'chocolate chip cookie']) },
        { name: 'Keeps response concise', weight: 1, check: lengthBetween(30, 800) },
      ],
    }],
  },
  {
    id: 'BW08',
    name: 'Exact format/file-presence check -- EPUB and PDF pair',
    dimension: 'workspace-exploration',
    description: 'Confirm the workspace contains both EPUB and PDF versions of the same title.',
    turns: [{
      prompt: 'Do I have both an EPUB and a PDF copy of I Will Teach You to Be Rich in this workspace?',
      assertions: [
        { name: 'Mentions I Will Teach You to Be Rich', weight: 2, check: containsAnyNormalized(BOOKS_SOURCE_TRUTH.richEpub.aliases) },
        { name: 'Mentions EPUB', weight: 2, check: containsAnyNormalized(['epub']) },
        { name: 'Mentions PDF', weight: 2, check: containsAnyNormalized(['pdf']) },
        { name: 'Affirms both are present', weight: 2, check: containsAnyNormalized(['both', 'yes']) },
      ],
      retrievalExpectation: {
        expectedSources: [BOOKS_SOURCE_TRUTH.richEpub.title],
        requiredTerms: ['epub', 'pdf'],
      },
      pipelineExpectation: {
        expectedSources: [BOOKS_SOURCE_TRUTH.richEpub.title],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    }],
  },
];