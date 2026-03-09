import type { Assertion, Dimension } from './scoring';
import {
  containsAny,
  containsAll,
  containsNone,
  lengthBetween,
  hasCitationMarkers,
} from './scoring';

export interface BooksTestCaseTurn {
  prompt: string;
  assertions: Assertion[];
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
    id: 'B01',
    name: 'Workspace overview -- top-level categories',
    dimension: 'summary',
    description: 'Summarize the main top-level folders in the Books workspace.',
    turns: [{
      prompt: 'What are some of the main top-level folders in this Books workspace?',
      assertions: [
        { name: 'Mentions Activism', weight: 1, check: containsAny(['activism']) },
        { name: 'Mentions Art', weight: 1, check: containsAny(['art']) },
        { name: 'Mentions Data Science', weight: 1, check: containsAny(['data science']) },
        { name: 'Mentions Philosophy or Stoicism', weight: 1, check: containsAny(['philosophy', 'stoicism']) },
        { name: 'Mentions Zimbabwe or Shona area', weight: 1, check: containsAny(['zimbabwe', 'shona']) },
        { name: 'Substantial overview', weight: 1, check: lengthBetween(60, 4000) },
      ],
    }],
  },
  {
    id: 'B02',
    name: 'Detail retrieval -- activism titles',
    dimension: 'detail-retrieval',
    description: 'Retrieve specific book titles from the Activism folder.',
    turns: [{
      prompt: 'Name two books in the Activism folder.',
      assertions: [
        {
          name: 'Mentions any two known Activism titles',
          weight: 4,
          check: (responseText: string) => {
            const normalized = responseText.toLowerCase();
            const titles = [
              'black skin, white masks',
              'freedom is a constant struggle',
              'how change happens',
              'nihilism and negritude',
              'slacktivism',
              'sara ahmed trying to transform',
            ];
            return titles.filter((title) => normalized.includes(title)).length >= 2;
          },
        },
        { name: 'Not just one title', weight: 1, check: lengthBetween(40, 3000) },
      ],
    }],
  },
  {
    id: 'B03',
    name: 'Source attribution -- Shona and Zimbabwe books',
    dimension: 'source-attribution',
    description: 'Answer a category query with source citations.',
    turns: [{
      prompt: 'What books do I have about Shona language or culture? Please cite sources.',
      assertions: [
        { name: 'Mentions a Shona dictionary or phrasebook', weight: 2, check: containsAny(['shona-english', 'dictionary', 'phrasebook']) },
        { name: 'Mentions Tsumo or Broken roots or FSI Shona', weight: 2, check: containsAny(['tsumo', 'broken roots', 'fsi']) },
        { name: 'Has citation markers', weight: 2, check: hasCitationMarkers },
      ],
    }],
  },
  {
    id: 'B04',
    name: 'Format awareness -- epub files',
    dimension: 'detail-retrieval',
    description: 'Identify EPUB content in the workspace.',
    turns: [{
      prompt: 'Do I have any EPUB files in this Books workspace?',
      assertions: [
        { name: 'Mentions EPUB format', weight: 1, check: containsAny(['epub']) },
        { name: 'Mentions Dramatic Color in the Landscape or I Will Teach You to Be Rich', weight: 3, check: containsAny(['dramatic color in the landscape', 'i will teach you to be rich']) },
        { name: 'Does not claim there are no EPUB files', weight: 1, check: containsNone(['no epub', 'no epub files', 'none']) },
      ],
    }],
  },
  {
    id: 'B05',
    name: 'Detail retrieval -- docx file',
    dimension: 'detail-retrieval',
    description: 'Find the DOCX file in the Art subtree.',
    turns: [{
      prompt: 'Is there a DOCX file anywhere in this workspace?',
      assertions: [
        { name: 'Mentions DOCX format', weight: 1, check: containsAny(['docx']) },
        { name: 'Mentions oil_painting_guide_final', weight: 3, check: containsAny(['oil_painting_guide_final']) },
        { name: 'Mentions Art or Chat GPT folder context', weight: 1, check: containsAny(['art', 'chat gpt']) },
      ],
    }],
  },
  {
    id: 'B06',
    name: 'Multi-doc synthesis -- duplicate titles across folders',
    dimension: 'multi-doc-synthesis',
    description: 'Identify titles that appear in more than one folder.',
    turns: [{
      prompt: 'Do any book titles appear in more than one folder? Give me a couple of examples.',
      assertions: [
        { name: 'Mentions Black Skin, White Masks duplicate', weight: 2, check: containsAll(['black skin', 'white masks']) },
        { name: 'Mentions another duplicate title', weight: 2, check: containsAny(['freedom is a constant struggle', 'nihilism and negritude']) },
        { name: 'Mentions both Activism and Black Consciousness', weight: 2, check: containsAll(['activism', 'black consciousness']) },
      ],
    }],
  },
  {
    id: 'B07',
    name: 'Follow-up -- stoicism drill-down',
    dimension: 'follow-up',
    description: 'Handle a folder query and then a follow-up narrowing to a title detail.',
    turns: [
      {
        prompt: 'What books are in the Stoicism folder?',
        assertions: [
          { name: 'Mentions The Daily Stoic', weight: 2, check: containsAll(['daily', 'stoic']) },
        ],
      },
      {
        prompt: 'Which one mentions 366 meditations?',
        assertions: [
          { name: 'Resolves follow-up to The Daily Stoic', weight: 3, check: containsAll(['daily', 'stoic']) },
          { name: 'Mentions 366 meditations', weight: 2, check: containsAny(['366', 'meditations']) },
        ],
      },
    ],
  },
  {
    id: 'B08',
    name: 'Deep retrieval -- cross-category comparison',
    dimension: 'deep-retrieval',
    description: 'Compare two large categories using grounded example titles.',
    turns: [{
      prompt: 'Compare the Art and Data Science folders at a high level using example titles from each.',
      assertions: [
        { name: 'Mentions Art folder', weight: 1, check: containsAny(['art']) },
        { name: 'Mentions Data Science folder', weight: 1, check: containsAny(['data science']) },
        { name: 'Includes an Art example title', weight: 2, check: containsAny(['how to draw', 'dynamic bible', 'landscape painting', 'morpho']) },
        { name: 'Includes a Data Science example title', weight: 2, check: containsAny(['python cookbook', 'ggplot2', 'gis in r', 'statistical analysis with excel']) },
      ],
    }],
  },
  {
    id: 'B09',
    name: 'Conversational -- off-topic redirect in Books workspace',
    dimension: 'conversational',
    description: 'Off-topic prompts should redirect back to the Books workspace context.',
    turns: [{
      prompt: "What's the best recipe for chocolate chip cookies?",
      assertions: [
        { name: 'Does not provide a recipe', weight: 3, check: containsNone(['cup of flour', 'baking soda', 'vanilla extract', 'preheat oven', '350 degrees', '375 degrees']) },
        { name: 'Redirects to books or workspace context', weight: 2, check: containsAny(['workspace', 'books', 'files', 'documents']) },
        { name: 'Polite tone', weight: 1, check: containsAny(['sorry', 'can help', 'happy to help', 'however']) },
      ],
    }],
  },
];