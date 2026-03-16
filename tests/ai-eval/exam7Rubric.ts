import type { Assertion, Dimension, RetrievalExpectation } from './scoring';
import {
  containsAny,
  containsAll,
  containsNone,
  lengthBetween,
  hasCitationMarkers,
} from './scoring';
import type { PipelineExpectation } from './exam7Scoring';
import {
  EXAM7_SOURCE_TRUTH,
  RF_GUIDE_SOURCE_IDS,
  containsAllNormalized,
  containsAnyNormalized,
} from './exam7GroundTruth';

export interface Exam7TestCaseTurn {
  prompt: string;
  assertions: Assertion[];
  retrievalExpectation?: RetrievalExpectation;
  pipelineExpectation?: PipelineExpectation;
}

export interface Exam7TestCase {
  id: string;
  name: string;
  dimension: Dimension;
  description: string;
  turns: Exam7TestCaseTurn[];
}

export const EXAM7_RUBRIC: Exam7TestCase[] = [
  {
    id: 'E701',
    name: 'Exact retrieval -- reading list page count',
    dimension: 'detail-retrieval',
    description: 'Retrieve which paper has 82 pages from the Exam 7 reading list.',
    turns: [{
      prompt: 'According to the Exam 7 Reading List, which paper has 82 pages? Cite the source.',
      assertions: [
        { name: 'Mentions Mack', weight: 2, check: containsAnyNormalized(['Mack']) },
        { name: 'Mentions 1994 or Chain Ladder context', weight: 2, check: containsAnyNormalized(['1994', 'Chain Ladder']) },
        { name: 'Mentions 82 pages', weight: 2, check: containsAnyNormalized(['82']) },
        { name: 'Has citation markers', weight: 2, check: hasCitationMarkers() },
      ],
      retrievalExpectation: {
        expectedSources: [EXAM7_SOURCE_TRUTH.readingList.title],
        requiredTerms: ['Mack', '82'],
        requireCitation: true,
      },
      pipelineExpectation: {
        expectedSources: [EXAM7_SOURCE_TRUTH.readingList.title],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    }],
  },
  {
    id: 'E702',
    name: 'Exact retrieval -- study guide table of contents',
    dimension: 'detail-retrieval',
    description: 'Retrieve the paper that comes immediately after Clark in the Study Guide table of contents.',
    turns: [{
      prompt: 'In the Exam 7 Study Guide table of contents, which paper comes immediately after Clark? Cite the source.',
      assertions: [
        { name: 'Mentions Mack', weight: 2, check: containsAnyNormalized(['Mack']) },
        { name: 'Mentions Chain-Ladder', weight: 3, check: containsAnyNormalized(['Chain-Ladder', 'Chain Ladder']) },
        { name: 'Has citation markers', weight: 2, check: hasCitationMarkers() },
      ],
      retrievalExpectation: {
        expectedSources: [EXAM7_SOURCE_TRUTH.studyGuide.title],
        requiredTerms: ['Clark', 'Mack', 'Chain-Ladder'],
        requireCitation: true,
      },
      pipelineExpectation: {
        expectedSources: [EXAM7_SOURCE_TRUTH.studyGuide.title],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    }],
  },
  {
    id: 'E703',
    name: 'Content understanding -- Mack Chain Ladder abstract',
    dimension: 'source-attribution',
    description: 'Retrieve the decisive tool and its use from the Mack Chain Ladder abstract.',
    turns: [{
      prompt: 'According to the abstract of Mack_Chain Ladder.pdf, what tool is described as decisive for quantifying reserve variability, and what can it be used to construct? Cite the source.',
      assertions: [
        { name: 'Mentions standard error', weight: 3, check: containsAnyNormalized(['standard error']) },
        { name: 'Mentions confidence interval', weight: 3, check: containsAnyNormalized(['confidence interval']) },
        { name: 'Has citation markers', weight: 2, check: hasCitationMarkers() },
      ],
      retrievalExpectation: {
        expectedSources: [EXAM7_SOURCE_TRUTH.mackChainLadder.title],
        requiredTerms: ['standard error', 'confidence interval'],
        requireCitation: true,
      },
      pipelineExpectation: {
        expectedSources: [EXAM7_SOURCE_TRUTH.mackChainLadder.title],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    }],
  },
  {
    id: 'E704',
    name: 'Spreadsheet retrieval -- Benktander workbook facts',
    dimension: 'detail-retrieval',
    description: 'Retrieve facts from the Benktander practice workbook.',
    turns: [{
      prompt: 'In the Mack - Benktander practice problem workbook, what expected loss ratio is given, and which accident year has earned premium of 6,000? Cite the source.',
      assertions: [
        { name: 'Mentions 70 percent', weight: 3, check: containsAnyNormalized(['70%', '70 percent']) },
        { name: 'Mentions accident year 2023', weight: 3, check: containsAnyNormalized(['2023']) },
        { name: 'Has citation markers', weight: 2, check: hasCitationMarkers() },
      ],
      retrievalExpectation: {
        expectedSources: [EXAM7_SOURCE_TRUTH.benktanderWorkbook.title],
        requiredTerms: ['70', '2023', '6000'],
        requireCitation: true,
      },
      pipelineExpectation: {
        expectedSources: [EXAM7_SOURCE_TRUTH.benktanderWorkbook.title],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    }],
  },
  {
    id: 'E705',
    name: 'Workspace exploration -- duplicate Clark file',
    dimension: 'multi-doc-synthesis',
    description: 'Confirm Clark appears in both RF Guides and Source Material.',
    turns: [{
      prompt: 'Do both the RF Guides folder and the Source Material folder contain a Clark paper? Answer directly and cite the sources.',
      assertions: [
        { name: 'Affirms both are present', weight: 3, check: containsAnyNormalized(['yes', 'both']) },
        { name: 'Mentions Clark', weight: 2, check: containsAnyNormalized(['Clark']) },
        { name: 'Mentions RF Guides', weight: 2, check: containsAnyNormalized(['RF Guides']) },
        { name: 'Mentions Source Material', weight: 2, check: containsAnyNormalized(['Source Material']) },
        { name: 'Has citation markers', weight: 1, check: hasCitationMarkers() },
      ],
      pipelineExpectation: {
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        requireRetrievalAttempted: true,
        minReturnedSources: 2,
      },
    }],
  },
  {
    id: 'E706',
    name: 'Coverage job -- summarize each RF Guide',
    dimension: 'deep-retrieval',
    description: 'The assistant should treat this as an exhaustive coverage job for the RF Guides folder.',
    turns: [{
      prompt: 'Can you provide a one paragraph summary for each of the files in the RF Guides folder?',
      assertions: [
        { name: 'Mentions Brosius', weight: 1, check: containsAnyNormalized(['Brosius']) },
        { name: 'Mentions Clark', weight: 1, check: containsAnyNormalized(['Clark']) },
        { name: 'Mentions Friedland', weight: 1, check: containsAnyNormalized(['Friedland']) },
        { name: 'Mentions Hurlimann', weight: 1, check: containsAnyNormalized(['Hurlimann', 'Hürlimann']) },
        { name: 'Mentions MackBenktander', weight: 1, check: containsAnyNormalized(['MackBenktander', 'Benktander']) },
        { name: 'Mentions MackChainLadder', weight: 1, check: containsAnyNormalized(['MackChainLadder', 'Chain Ladder']) },
        { name: 'Mentions Marshall', weight: 1, check: containsAnyNormalized(['Marshall']) },
        { name: 'Mentions Meyers', weight: 1, check: containsAnyNormalized(['Meyers']) },
        { name: 'Mentions Sahasrabuddhe', weight: 1, check: containsAnyNormalized(['Sahasrabuddhe']) },
        { name: 'Mentions Shapland', weight: 1, check: containsAnyNormalized(['Shapland']) },
        { name: 'Mentions Siewert', weight: 1, check: containsAnyNormalized(['Siewert']) },
        { name: 'Mentions TaylorMcGuire', weight: 1, check: containsAnyNormalized(['Taylor McGuire', 'TaylorMcGuire']) },
        { name: 'Mentions TengPerkins', weight: 1, check: containsAnyNormalized(['Teng Perkins', 'TengPerkins']) },
        { name: 'Mentions VenterFactors', weight: 1, check: containsAnyNormalized(['Venter Factors', 'VenterFactors']) },
        { name: 'Mentions Verrall', weight: 1, check: containsAnyNormalized(['Verrall']) },
        { name: 'Substantial multi-file response', weight: 3, check: lengthBetween(500, 20000) },
        { name: 'Does not claim unavailable content', weight: 2, check: containsNone(['i do not have the content', 'not available in the current context', 'cannot summarize this file', 'files not available for summarisation', 'files not available for summarization', 'not present in the retrieved content', 'cannot be provided', 'content not read', 'summary unavailable', 'were not accessed']) },
      ],
      pipelineExpectation: {
        expectedRouteKind: 'grounded',
        expectedIntent: 'exploration',
        expectedCoverageMode: 'exhaustive',
        requireRetrievalAttempted: false,
      },
    }],
  },
  {
    id: 'E707',
    name: 'Hallucination guard -- no cookie paper in RF Guides',
    dimension: 'hallucination-guard',
    description: 'The assistant should refuse unsupported claims instead of inventing an off-topic paper in RF Guides.',
    turns: [{
      prompt: 'In the RF Guides folder, which paper is about baking chocolate chip cookies? If none, say that none of the RF Guides papers appear to be about that.',
      assertions: [
        { name: 'States there is no support', weight: 3, check: containsAnyNormalized(['none of the rf guides papers', 'none appear to be about that', 'no evidence']) },
        { name: 'Does not hallucinate a cookie paper', weight: 3, check: containsNone(['cookie recipe', 'chocolate chip cookie', 'baking paper']) },
        { name: 'Keeps response concise', weight: 1, check: lengthBetween(20, 800) },
      ],
    }],
  },
  {
    id: 'E708',
    name: 'Coverage job -- summarize RF Guides with variant phrasing',
    dimension: 'deep-retrieval',
    description: 'The assistant should preserve exhaustive folder-summary behavior under a natural phrasing variant.',
    turns: [{
      prompt: 'Please summarize each paper in the RF Guides folder in one paragraph.',
      assertions: [
        { name: 'Mentions Clark', weight: 1, check: containsAnyNormalized(['Clark']) },
        { name: 'Mentions Mack or Chain Ladder', weight: 1, check: containsAnyNormalized(['Mack', 'Chain Ladder']) },
        { name: 'Mentions Verrall', weight: 1, check: containsAnyNormalized(['Verrall']) },
        { name: 'Substantial multi-file response', weight: 3, check: lengthBetween(500, 20000) },
        { name: 'Does not claim unavailable content', weight: 2, check: containsNone(['i do not have the content', 'not available in the current context', 'cannot summarize this file', 'not present in the retrieved content', 'content not read', 'summary unavailable']) },
      ],
      pipelineExpectation: {
        expectedRouteKind: 'grounded',
        expectedIntent: 'exploration',
        expectedCoverageMode: 'exhaustive',
        requireRetrievalAttempted: false,
      },
    }],
  },
];