/**
 * AI Quality Evaluation — Test Rubric
 *
 * Defines 10 evaluation test cases against the demo-workspace, a fictional
 * auto insurance knowledge base for:
 *
 *   Policyholder: Jordan Rivera
 *   Policy:       PLX-2026-4481, Great Lakes Mutual Insurance Co.
 *   Vehicle:      2024 Honda Accord EX-L, VIN 1HGCV2F34RA012345
 *   Agent:        Sarah Chen, (555) 234-5678
 *
 * Ground truth lives in the demo-workspace/ .md files:
 *   - Auto Insurance Policy.md  — coverage limits, premiums, exclusions
 *   - Claims Guide.md           — step-by-step filing, deadlines, FAQ
 *   - Agent Contacts.md         — Sarah Chen, hotlines, repair shops
 *   - Accident Quick Reference.md — at-the-scene card, key info table
 *   - Vehicle Info.md           — 2024 Accord specs, maintenance, KBB value
 */
import type { Assertion, Dimension } from './scoring';
import {
  containsAny,
  containsAll,
  containsNone,
  lengthBetween,
  hasCitationMarkers,
  matchesPattern,
} from './scoring';

// ── Test Case Types ──────────────────────────────────────────────────────────

export interface TestCaseTurn {
  prompt: string;
  assertions: Assertion[];
}

export interface TestCase {
  id: string;
  name: string;
  dimension: Dimension;
  description: string;
  /** Sequential prompts. Multi-turn tests have multiple entries. */
  turns: TestCaseTurn[];
}

// ── Rubric: T01–T09 (standard tests) ────────────────────────────────────────

export const RUBRIC: TestCase[] = [

  // ── T01: Factual Recall ────────────────────────────────────────────────────
  // Source: Auto Insurance Policy.md → Collision: "$500 deductible"
  {
    id: 'T01',
    name: 'Direct factual recall -- collision deductible',
    dimension: 'factual-recall',
    description: 'Simple question with one correct numerical answer ($500).',
    turns: [{
      prompt: 'What is my collision deductible?',
      assertions: [
        {
          name: 'Contains $500',
          weight: 3,
          check: containsAny(['$500', '500 dollar', '$500.00']),
        },
        {
          name: 'Mentions collision coverage',
          weight: 1,
          check: containsAny(['collision']),
        },
        {
          name: 'No hallucinated wrong amount',
          weight: 2,
          check: containsNone(['$250 collision', '$1000 collision', '$1,000 collision']),
        },
      ],
    }],
  },

  // ── T02: Detail Retrieval — Contact ────────────────────────────────────────
  // Source: Agent Contacts.md → Sarah Chen, (555) 234-5678
  {
    id: 'T02',
    name: 'Detail retrieval -- agent phone number',
    dimension: 'detail-retrieval',
    description: 'Specific lookup of a phone number and contact name.',
    turns: [{
      prompt: "What is my insurance agent's phone number?",
      assertions: [
        {
          name: 'Correct phone number',
          weight: 3,
          check: containsAny(['(555) 234-5678', '555-234-5678', '555.234.5678', '5552345678']),
        },
        {
          name: 'Agent name (Sarah or Chen)',
          weight: 2,
          check: containsAny(['sarah', 'chen']),
        },
        {
          name: 'Natural response (not just a number)',
          weight: 1,
          check: lengthBetween(30, 3000),
        },
      ],
    }],
  },

  // ── T03: Detail Retrieval — Vehicle ────────────────────────────────────────
  // Source: Vehicle Info.md → 2024 Honda Accord EX-L, Lunar Silver Metallic
  {
    id: 'T03',
    name: 'Detail retrieval -- vehicle info',
    dimension: 'detail-retrieval',
    description: 'Retrieve vehicle make/model/year/trim from knowledge base.',
    turns: [{
      prompt: 'Tell me about my insured vehicle.',
      assertions: [
        { name: 'Year (2024)', weight: 2, check: containsAny(['2024']) },
        { name: 'Make (Honda)', weight: 2, check: containsAny(['honda']) },
        { name: 'Model (Accord)', weight: 2, check: containsAny(['accord']) },
        {
          name: 'Trim or color detail',
          weight: 1,
          check: containsAny(['ex-l', 'exl', 'lunar silver', 'silver metallic']),
        },
      ],
    }],
  },

  // ── T04: Summary Quality ───────────────────────────────────────────────────
  // Sources: Auto Insurance Policy.md (all coverage types)
  {
    id: 'T04',
    name: 'Summary -- coverage overview',
    dimension: 'summary',
    description: 'Broad question; response should cover multiple coverage types.',
    turns: [{
      prompt: 'Give me an overview of all my auto insurance coverage.',
      assertions: [
        { name: 'Mentions collision', weight: 2, check: containsAny(['collision']) },
        { name: 'Mentions comprehensive', weight: 2, check: containsAny(['comprehensive']) },
        { name: 'Mentions liability', weight: 2, check: containsAny(['liability']) },
        {
          name: 'Mentions UM/uninsured',
          weight: 1,
          check: containsAny(['uninsured', 'underinsured', 'um/uim', 'um ']),
        },
        {
          name: 'Mentions medical/MedPay',
          weight: 1,
          check: containsAny(['medical', 'medpay', 'med pay']),
        },
        {
          name: 'Substantial response (>250 chars)',
          weight: 1,
          check: lengthBetween(250, 15000),
        },
      ],
    }],
  },

  // ── T05: Multi-Document Synthesis ──────────────────────────────────────────
  // Sources: Accident Quick Reference + Claims Guide + Auto Insurance Policy
  {
    id: 'T05',
    name: 'Multi-doc synthesis -- uninsured driver accident',
    dimension: 'multi-doc-synthesis',
    description:
      'Scenario requiring info from Accident Quick Reference, Claims Guide, and Policy.',
    turns: [{
      prompt:
        "I was just rear-ended in a parking lot by a driver who doesn't have insurance. " +
        'What should I do step by step, and what does my policy cover for this?',
      assertions: [
        {
          name: 'Scene steps (police/photos/info)',
          weight: 2,
          check: containsAny(['police', 'photo', 'report']),
        },
        {
          name: 'Contact agent or claims line',
          weight: 1,
          check: containsAny(['agent', 'sarah', 'claims', '1-800', 'hotline']),
        },
        {
          name: 'Mentions UM/UIM coverage',
          weight: 3,
          check: containsAny(['uninsured motorist', 'um/uim', 'uninsured', 'uim']),
        },
        {
          name: '24-hour police report deadline for UM',
          weight: 2,
          check: containsAny(['24 hour', '24-hour', '24h', 'within 24', 'twenty-four']),
        },
        {
          name: 'Actionable length (>300 chars)',
          weight: 1,
          check: lengthBetween(300, 15000),
        },
      ],
    }],
  },

  // ── T06: Conversational Quality ────────────────────────────────────────────
  // No source expected — the AI should greet naturally without info dumping
  {
    id: 'T06',
    name: 'Conversational -- casual greeting',
    dimension: 'conversational',
    description: 'Greeting should get a natural reply, not an information dump.',
    turns: [{
      prompt: 'Hey!',
      assertions: [
        {
          name: 'Returns a greeting',
          weight: 2,
          check: containsAny(['hello', 'hi', 'hey', 'welcome', 'how can', 'how may', 'help']),
        },
        {
          name: 'No unsolicited insurance facts',
          weight: 2,
          check: containsNone(['$500', 'deductible', 'PLX-2026', 'collision coverage']),
        },
        {
          name: 'Concise (<500 chars)',
          weight: 1,
          check: lengthBetween(2, 500),
        },
      ],
    }],
  },

  // ── T07: Source Attribution ─────────────────────────────────────────────────
  // Source: Agent Contacts.md → Preferred Repair Shops section
  {
    id: 'T07',
    name: 'Source attribution -- repair shops with citations',
    dimension: 'source-attribution',
    description: 'Ask for info and request explicit source citations.',
    turns: [{
      prompt: 'Which repair shops are recommended under my policy? Please cite your sources.',
      assertions: [
        {
          name: 'Mentions AutoCraft Collision',
          weight: 2,
          check: containsAny(['autocraft']),
        },
        {
          name: 'Mentions Precision Auto Body',
          weight: 1,
          check: containsAny(['precision']),
        },
        {
          name: 'References source document',
          weight: 3,
          check: containsAny([
            'agent contact', 'agent contacts',
            '[1]', '[2]', '[3]',
            'source', 'sources',
            // Citation badges render as bare superscript numbers via innerText()
            '¹', '²', '³',
          ]),
        },
      ],
    }],
  },

  // ── T08: Follow-Up Context (multi-turn) ────────────────────────────────────
  // Turn 1: Collision deductible → $500 (Auto Insurance Policy.md)
  // Turn 2: "And comprehensive?" → $250 (must understand implicit reference)
  {
    id: 'T08',
    name: 'Follow-up -- deductible comparison',
    dimension: 'follow-up',
    description:
      'Multi-turn: ask about collision deductible, then follow up about comprehensive.',
    turns: [
      {
        prompt: 'What is my collision deductible?',
        assertions: [
          { name: 'Contains $500', weight: 2, check: containsAny(['$500', '500']) },
        ],
      },
      {
        prompt: 'And what about comprehensive?',
        assertions: [
          {
            name: 'Understands "comprehensive" follow-up',
            weight: 2,
            check: containsAny(['comprehensive']),
          },
          {
            name: 'Correct amount ($250)',
            weight: 3,
            check: containsAny(['$250', '250']),
          },
        ],
      },
    ],
  },

  // ── T09: Workspace Exploration ─────────────────────────────────────────────
  // Uses workspace digest (system prompt) to list document names
  {
    id: 'T09',
    name: 'Workspace exploration -- list contents',
    dimension: 'summary',
    description: 'Ask what is in the workspace; AI should enumerate documents.',
    turns: [{
      prompt: 'What documents do I have in my workspace?',
      assertions: [
        {
          name: 'Mentions policy document',
          weight: 2,
          check: containsAny(['auto insurance policy', 'insurance policy']),
        },
        {
          name: 'Mentions claims guide',
          weight: 1,
          check: containsAny(['claims guide', 'claims']),
        },
        {
          name: 'Mentions contacts',
          weight: 1,
          check: containsAny(['agent contact', 'contacts']),
        },
        {
          name: 'Mentions vehicle info',
          weight: 1,
          check: containsAny(['vehicle info', 'vehicle']),
        },
        {
          name: 'Lists multiple items',
          weight: 1,
          check: lengthBetween(100, 5000),
        },
      ],
    }],
  },

  // ── T13: Hallucination Guard ─────────────────────────────────────────────
  // Ask about something that does NOT exist in the policy
  {
    id: 'T13',
    name: 'Hallucination guard -- nonexistent coverage',
    dimension: 'hallucination-guard',
    description:
      'Ask about coverage that does NOT exist in the policy. AI should say it is not covered.',
    turns: [{
      prompt: 'What does my policy say about earthquake coverage?',
      assertions: [
        {
          name: 'Indicates not covered / not found',
          weight: 3,
          check: containsAny([
            'not covered', "doesn't cover", 'does not cover',
            'not included', "doesn't include", 'does not include',
            'no earthquake', 'not mention', "doesn't mention", 'does not mention',
            'not listed', 'no coverage for earthquake',
            "don't see", "don't find", 'could not find', 'unable to find',
            'not in your policy', 'not part of',
          ]),
        },
        {
          name: 'Does NOT hallucinate earthquake terms/limits',
          weight: 3,
          check: containsNone([
            'earthquake deductible', 'earthquake limit',
            'earthquake coverage: $', 'earthquake premium',
            'seismic coverage', 'earth movement coverage',
          ]),
        },
        {
          name: 'Suggests adding it or contacting agent',
          weight: 1,
          check: containsAny([
            'contact', 'agent', 'sarah', 'add', 'endorsement',
            'separate', 'additional', 'ask about', 'inquire',
          ]),
        },
      ],
    }],
  },

  // ── T14: Disambiguation ──────────────────────────────────────────────────
  // Multiple deductibles exist ($500 collision, $250 comprehensive)
  {
    id: 'T14',
    name: 'Disambiguation -- which deductible?',
    dimension: 'disambiguation',
    description:
      'Ask about "my deductible" without specifying type. Should clarify or list both.',
    turns: [{
      prompt: 'What is my deductible?',
      assertions: [
        {
          name: 'Mentions collision deductible ($500)',
          weight: 2,
          check: containsAny(['$500', '500']),
        },
        {
          name: 'Mentions comprehensive deductible ($250)',
          weight: 2,
          check: containsAny(['$250', '250']),
        },
        {
          name: 'Distinguishes both types (collision + comprehensive)',
          weight: 3,
          check: containsAll(['collision', 'comprehensive']),
        },
      ],
    }],
  },

  // ── T15: Deep Retrieval ──────────────────────────────────────────────────
  // Detail buried in Vehicle Info.md — total loss threshold
  {
    id: 'T15',
    name: 'Deep retrieval -- total loss threshold',
    dimension: 'deep-retrieval',
    description:
      'Ask about a detail buried in Vehicle Info (total loss threshold = 75% of KBB value).',
    turns: [{
      prompt: 'At what point would my car be declared a total loss?',
      assertions: [
        {
          name: 'Mentions 75% threshold',
          weight: 3,
          check: containsAny(['75%', '75 percent', 'seventy-five']),
        },
        {
          name: 'References vehicle value or KBB',
          weight: 2,
          check: containsAny([
            'kelly blue book', 'kbb', 'current value',
            '$28,500', '$30,200', '28,500', '30,200',
            'market value', 'actual cash value',
          ]),
        },
        {
          name: 'Mentions approximate dollar threshold',
          weight: 1,
          check: containsAny([
            '$21,375', '$22,650', '21,375', '22,650',
            'approximately $21', 'approximately $22',
            'around $21', 'around $22',
          ]),
        },
      ],
    }],
  },

  // ── T16: User Correction ─────────────────────────────────────────────────
  // User states something wrong; AI should correct based on RAG
  {
    id: 'T16',
    name: 'User correction -- wrong deductible claimed',
    dimension: 'user-correction',
    description:
      'User states an incorrect fact. AI should politely correct based on policy data.',
    turns: [{
      prompt:
        'I remember my collision deductible is $1,000. Can you confirm?',
      assertions: [
        {
          name: 'Corrects to $500',
          weight: 3,
          check: containsAny(['$500', '500']),
        },
        {
          name: 'Indicates the stated amount is wrong',
          weight: 2,
          check: containsAny([
            'actually', 'however', 'but', 'not $1,000', 'not $1000',
            'not 1,000', 'not 1000',
            'incorrect', 'different', 'instead', 'correct amount',
            'records show', 'policy shows', 'policy states',
            'no.', 'no,',
          ]),
        },
        {
          name: 'Does NOT agree with $1,000',
          weight: 3,
          check: containsNone([
            'yes, $1,000', 'correct, $1,000', 'you are right',
            'confirmed: $1,000', 'your $1,000 deductible',
            'that is correct', "that's correct",
          ]),
        },
      ],
    }],
  },

  // ── T17: Multi-Turn Scenario ─────────────────────────────────────────────
  // 3-turn scenario: accident → coverage → next steps
  {
    id: 'T17',
    name: 'Multi-turn scenario -- accident workflow',
    dimension: 'multi-doc-synthesis',
    description:
      'Three-turn conversation simulating a real accident workflow.',
    turns: [
      {
        prompt: 'Someone just backed into my car in a parking lot. What should I do right now?',
        assertions: [
          {
            name: 'Immediate steps (photos/police/info)',
            weight: 2,
            check: containsAny(['photo', 'police', 'information', 'exchange']),
          },
          {
            name: 'Safety first mention',
            weight: 1,
            check: containsAny(['safe', 'hazard', 'move', '911']),
          },
        ],
      },
      {
        prompt: 'They said they have insurance but I am not sure. What coverage do I have for this?',
        assertions: [
          {
            name: 'Mentions collision coverage',
            weight: 2,
            check: containsAny(['collision']),
          },
          {
            name: 'Mentions UM coverage as backup',
            weight: 2,
            check: containsAny(['uninsured', 'um', 'uim']),
          },
          {
            name: 'Mentions collision deductible',
            weight: 1,
            check: containsAny(['$500', 'deductible']),
          },
        ],
      },
      {
        prompt: 'OK I want to file a claim. How do I do that and who do I call?',
        assertions: [
          {
            name: 'Agent contact (Sarah Chen or phone)',
            weight: 2,
            check: containsAny(['sarah', '555-234-5678', '(555) 234-5678']),
          },
          {
            name: 'Claims line',
            weight: 1,
            check: containsAny(['1-800', 'claims line', 'hotline', '555-CLAIM', '2524']),
          },
          {
            name: '72-hour deadline',
            weight: 1,
            check: containsAny(['72 hour', '72-hour', 'within 72', 'three days']),
          },
        ],
      },
    ],
  },

  // ── T18: Conversational Refusal ──────────────────────────────────────────
  // Ask something completely off-topic — should redirect gracefully
  {
    id: 'T18',
    name: 'Conversational -- off-topic redirect',
    dimension: 'conversational',
    description:
      'Ask something off-topic; AI should redirect to workspace context.',
    turns: [{
      prompt: "What's the best recipe for chocolate chip cookies?",
      assertions: [
        {
          name: 'Does NOT provide a recipe',
          weight: 3,
          check: containsNone([
            'cup of flour', 'baking soda', 'vanilla extract',
            'preheat oven', '350 degrees', '375 degrees',
            'teaspoon', 'tablespoon',
          ]),
        },
        {
          name: 'Redirects to workspace/insurance context',
          weight: 2,
          check: containsAny([
            'insurance', 'policy', 'workspace', 'documents',
            'help you with', 'assist you with', 'auto',
            'knowledge base', 'your files',
          ]),
        },
        {
          name: 'Polite tone',
          weight: 1,
          check: containsAny([
            'sorry', 'afraid', 'however', 'but', 'unfortunately',
            'happy to help', 'i can help', 'glad to',
          ]),
        },
      ],
    }],
  },

  // ── T20: Structured Long-Doc Retrieval ──────────────────────────────────
  {
    id: 'T20',
    name: 'Deep retrieval -- severity routing matrix lookup',
    dimension: 'deep-retrieval',
    description:
      'Question targets a specific row in the long architecture document rather than the normal policy/claims docs.',
    turns: [{
      prompt: 'In the claims workflow architecture, for a potential total loss, who coordinates the escalation packet and when does review start?',
      assertions: [
        {
          name: 'Names the Severity Desk Coordinator',
          weight: 3,
          check: containsAny(['severity desk coordinator']),
        },
        {
          name: 'Mentions the one-business-day review target',
          weight: 3,
          check: containsAny(['within 1 business day', 'one business day', '1 business day']),
        },
        {
          name: 'Anchors to the workflow architecture document',
          weight: 1,
          check: containsAny(['claims workflow architecture', 'workflow architecture']),
        },
      ],
    }],
  },

  // ── T21: Code-Heavy Retrieval Inside Long Doc ───────────────────────────
  {
    id: 'T21',
    name: 'Deep retrieval -- escalation packet builder snippet',
    dimension: 'deep-retrieval',
    description:
      'Question targets a code block embedded in the long architecture document.',
    turns: [{
      prompt: 'Which helper assembles the escalation packet in the workflow architecture doc, and what two stage names does it include?',
      assertions: [
        {
          name: 'Names buildEscalationPacket helper',
          weight: 3,
          check: containsAny(['buildescalationpacket', 'buildEscalationPacket']),
        },
        {
          name: 'Mentions policy-summary stage',
          weight: 2,
          check: containsAny(['policy-summary', 'policy summary']),
        },
        {
          name: 'Mentions police-report or valuation stage',
          weight: 2,
          check: containsAny(['police-report', 'police report', 'valuation']),
        },
      ],
    }],
  },

  // ── T22: AIR Behavior — Identity Cleanliness ───────────────────────────
  {
    id: 'T22',
    name: 'AIR behavior -- fresh-session identity stays clean',
    dimension: 'air-behavior',
    description:
      'A fresh-session identity question should stay conversational and avoid workspace fact contamination.',
    turns: [{
      prompt: 'Who are you?',
      assertions: [
        {
          name: 'Explains role naturally',
          weight: 2,
          check: containsAny(['assistant', 'help', 'parallx', 'ai']),
        },
        {
          name: 'Avoids policy-specific contamination',
          weight: 3,
          check: containsNone(['$500', 'plx-2026', 'jordan rivera', 'sarah chen']),
        },
        {
          name: 'Stays concise and conversational',
          weight: 1,
          check: lengthBetween(20, 800),
        },
      ],
    }],
  },

  // ── T23: AIR Behavior — Grounded to Social Follow-Up ───────────────────
  {
    id: 'T23',
    name: 'AIR behavior -- grounded answer then social follow-up',
    dimension: 'air-behavior',
    description:
      'AIR should answer a grounded question correctly, then drop back to lightweight social behavior on a follow-up thanks.',
    turns: [
      {
        prompt: 'What is my collision deductible?',
        assertions: [
          {
            name: 'Grounded first answer includes $500',
            weight: 2,
            check: containsAny(['$500', '500']),
          },
          {
            name: 'Mentions collision coverage',
            weight: 1,
            check: containsAny(['collision']),
          },
        ],
      },
      {
        prompt: 'thanks',
        assertions: [
          {
            name: 'Social follow-up acknowledges politely',
            weight: 2,
            check: containsAny(['welcome', 'glad', 'anytime', 'happy to help', 'no problem']),
          },
          {
            name: 'Does not repeat grounded facts unnecessarily',
            weight: 3,
            check: containsNone(['$500', 'collision deductible', 'jordan rivera', 'plx-2026']),
          },
          {
            name: 'Stays concise',
            weight: 1,
            check: lengthBetween(2, 500),
          },
        ],
      },
    ],
  },

  // ── T24: AIR Behavior — Weak Evidence Honesty ──────────────────────────
  {
    id: 'T24',
    name: 'AIR behavior -- weak evidence stays honest',
    dimension: 'air-behavior',
    description:
      'When the workspace does not support a policy claim, AIR should stay honest and avoid inventing coverage.',
    turns: [{
      prompt: 'What does my policy say about earthquake coverage?',
      assertions: [
        {
          name: 'Does not affirmatively invent earthquake coverage',
          weight: 3,
          check: (response) => !/(?:policy|coverage|documents?)\s+(?:includes?|provide(?:s|d)?|cover(?:s|ed)?)\s+(?:any\s+)?earthquake|you\s+have\s+earthquake\s+coverage|earthquake\s+coverage\s+(?:is|would be)\s+(?:included|covered)|earthquake\s+coverage\s+under|earthquake[^.]{0,160}(?:falls\s+within|within\s+the\s+scope|is\s+covered\s+under|would\s+be\s+covered\s+under)|covered\s+under\s+the\s+broader\s+['\"]?natural\s+disasters?['\"]?\s+category|(?:earthquake|earthquakes)[\s\S]{0,160}natural\s+disasters?[\s\S]{0,120}(?:covered|coverage|scope)|natural\s+disasters?[\s\S]{0,120}(?:covered|coverage|scope)[\s\S]{0,160}(?:earthquake|earthquakes)/i.test(response),
        },
        {
          name: 'Signals missing or unsupported evidence',
          weight: 2,
          check: containsAny(['do not see', "don't see", 'do not find', "don't find", 'does not list', 'does not identify', 'not explicit', 'not mentioned', 'not listed', 'could not find', "can't find", 'cannot confirm', 'can’t confirm']),
        },
        {
          name: 'Stays measured rather than overconfident',
          weight: 1,
          check: containsAny(['policy', 'documents', 'workspace', 'based on', 'from what i can see', 'cannot confirm']),
        },
      ],
    }],
  },

  // ── T25: AIR Behavior — Boundary Explanation Quality ──────────────────
  {
    id: 'T25',
    name: 'AIR behavior -- explains workspace boundary clearly',
    dimension: 'air-behavior',
    description:
      'AIR should explain workspace-boundary limits clearly and briefly when asked about outside-workspace edits.',
    turns: [{
      prompt: 'Why can\'t you edit a file outside the workspace for me?',
      assertions: [
        {
          name: 'Mentions workspace boundary or active workspace',
          weight: 3,
          check: containsAny(['workspace', 'active workspace', 'outside the workspace', 'workspace boundary']),
        },
        {
          name: 'Explains the restriction as a safety or policy guard',
          weight: 2,
          check: containsAny(['safety', 'policy', 'guard', 'protect', 'restriction', 'boundary',
            'confined', 'scope', 'prevent', 'limited to', 'secure']),
        },
        {
          name: 'Keeps the explanation reasonably concise',
          weight: 1,
          check: lengthBetween(20, 1300),
        },
      ],
    }],
  },

  // ── T26: AIR Behavior — Approval Scope Explanation ─────────────────────
  {
    id: 'T26',
    name: 'AIR behavior -- explains approval scope clearly',
    dimension: 'air-behavior',
    description:
      'AIR should clearly explain the difference between approving one action and approving the rest of a task.',
    turns: [{
      prompt: 'What is the difference between Approve once and Approve task?',
      assertions: [
        {
          name: 'Explains Approve once as a single action decision',
          weight: 3,
          check: containsAny(['single action', 'one action', 'just this action', 'only this action', 'current action']),
        },
        {
          name: 'Explains Approve task as broader task-level approval',
          weight: 3,
          check: containsAny(['rest of the task', 'remaining task', 'remaining actions', 'task-level', 'entire task']),
        },
        {
          name: 'Frames the decision as a safety or trust choice',
          weight: 1,
          check: containsAny(['safety', 'trust', 'review', 'scope', 'permission']),
        },
      ],
    }],
  },

  // ── T27: AIR Behavior — Blocked Task Recovery Guidance ─────────────────
  {
    id: 'T27',
    name: 'AIR behavior -- explains blocked task recovery clearly',
    dimension: 'air-behavior',
    description:
      'AIR should explain why an out-of-workspace task is blocked and how to recover without sounding vague.',
    turns: [{
      prompt: 'My delegated task was blocked because it targeted a file outside the workspace. What should I do next?',
      assertions: [
        {
          name: 'Explains the workspace-boundary reason',
          weight: 3,
          check: containsAny(['outside the workspace', 'workspace boundary', 'active workspace', 'outside the active workspace']),
        },
        {
          name: 'Suggests retargeting or narrowing the task',
          weight: 2,
          check: containsAny(['retarget', 'inside the workspace', 'narrow', 'different target', 'allowed target', 'change the task']),
        },
        {
          name: 'Suggests retrying only after fixing the target',
          weight: 1,
          check: containsAny(['retry', 'continue', 'run again', 'after updating', 'once you update']),
        },
      ],
    }],
  },

  // ── T28: AIR Behavior — Completed Artifact Guidance ────────────────────
  {
    id: 'T28',
    name: 'AIR behavior -- explains completed artifact guidance clearly',
    dimension: 'air-behavior',
    description:
      'AIR should explain what recorded artifacts mean after a task completes and what to review next.',
    turns: [{
      prompt: 'A delegated task finished with recorded artifacts. What should I check next?',
      assertions: [
        {
          name: 'Explains artifacts as changed or produced workspace files',
          weight: 3,
          check: containsAny(['changed', 'produced', 'workspace files', 'files the task changed', 'files the task produced']),
        },
        {
          name: 'Advises reviewing those files first',
          weight: 2,
          check: containsAny(['check those files first', 'review those files', 'open the artifacts', 'inspect the files']),
        },
        {
          name: 'Mentions deciding on follow-up work',
          weight: 1,
          check: containsAny(['follow-up task', 'next task', 'if more work is needed', 'decide whether']),
        },
      ],
    }],
  },

  // ── T29: AIR Behavior — Trace Explanation Quality ──────────────────────
  {
    id: 'T29',
    name: 'AIR behavior -- explains task trace clearly',
    dimension: 'air-behavior',
    description:
      'AIR should explain what the task trace is for and when the user should rely on it.',
    turns: [{
      prompt: 'What does the trace in task details help me understand?',
      assertions: [
        {
          name: 'Explains trace as planning approval and execution history',
          weight: 3,
          check: containsAny(['planning', 'approval', 'execution', 'events', 'history', 'steps in order']),
        },
        {
          name: 'Explains it helps diagnose stoppage or latest outcome',
          weight: 2,
          check: containsAny(['why a task stopped', 'paused', 'blocked', 'latest outcome', 'what ran successfully', 'what happened']),
        },
        {
          name: 'Mentions retry or next-step decision use',
          weight: 1,
          check: containsAny(['retry next', 'what to retry', 'next step', 'what to do next']),
        },
      ],
    }],
  },
];

// ── T10: Cross-Session Memory (special structure) ────────────────────────────
//
// This test is handled separately because it requires:
//   1. A multi-turn conversation in Session 1 (to create memory)
//   2. A wait period for fire-and-forget memory summarization
//   3. A new session (Session 2) that probes for recalled memory
//
// The Session 1 prompts inject user-specific details that do NOT exist in
// the demo-workspace files. If the AI recalls them in Session 2, it proves
// cross-session memory is working.

export const CROSS_SESSION_TEST = {
  id: 'T10',
  name: 'Cross-session memory -- recall prior discussion',
  dimension: 'cross-session-memory' as Dimension,
  description:
    'Have a multi-turn conversation with specific details, start a new session, ' +
    'and check if the AI recalls context from the previous session.',

  /** Session 1: inject user-specific accident details. */
  session1Prompts: [
    'I was in a car accident yesterday at the Riverside Mall parking lot on Elm Street. The other driver ran a red light and hit my passenger door.',
    'I already filed a police report, the report number is 2026-0305-1147. I took photos and got the other driver\'s info.',
  ],

  /** Session 2: probe for memory of the Session 1 details. */
  session2Prompt:
    'In my last conversation, I told you about an accident I had. ' +
    'What details do you remember about it?',

  /** Assertions against Session 2 response. */
  session2Assertions: [
    {
      name: 'Recalls location (Riverside/Elm/Mall/parking lot)',
      weight: 3,
      check: containsAny(['riverside', 'elm', 'mall', 'parking lot']),
    },
    {
      name: 'Recalls some incident detail (door/red light/photos/police)',
      weight: 2,
      check: containsAny([
        'passenger door', 'red light', 'photos', 'police report', '2026-0305',
      ]),
    },
    {
      name: 'Demonstrates memory (not a generic "I\'m not sure" response)',
      weight: 2,
      check: containsNone([
        "i don't have any record",
        "i don't recall",
        "i'm not sure what we discussed",
        'no previous conversation',
        "i don't have access to previous",
      ]),
    },
  ] as Assertion[],
};

// ── T11: Live Data Change ────────────────────────────────────────────────────
//
// Tests whether the AI picks up on modified workspace files. Steps:
//   1. Ask about collision deductible → should say $500 (original)
//   2. Modify Auto Insurance Policy.md (change $500 → $750)
//   3. Wait for re-indexing
//   4. Ask again → should say $750 (updated)

export const LIVE_DATA_CHANGE_TEST = {
  id: 'T11',
  name: 'Live data change -- deductible update',
  dimension: 'data-freshness' as Dimension,
  description:
    'Modify a workspace file mid-test and verify the AI picks up the new value.',

  /** Step 1: Verify original value */
  beforePrompt: 'What is my collision deductible?',
  beforeAssertions: [
    { name: 'Original value ($500)', weight: 2, check: containsAny(['$500', '500']) },
  ] as Assertion[],

  /** Step 2: File mutation details */
  fileToModify: 'Auto Insurance Policy.md',
  originalText: '**Deductible:** $500',
  modifiedText: '**Deductible:** $750',
  // Also update the premium table reference
  originalTableText: 'Collision ($500 ded)',
  modifiedTableText: 'Collision ($750 ded)',

  /** Step 3: Verify updated value */
  afterPrompt: 'What is my collision deductible now?',
  afterAssertions: [
    {
      name: 'Updated value ($750)',
      weight: 3,
      check: containsAny(['$750', '750']),
    },
    {
      name: 'Does NOT say $500',
      weight: 2,
      check: containsNone(['$500']),
    },
  ] as Assertion[],

  /** Re-indexing wait time (ms) — embeddings need to regenerate */
  reindexWaitMs: 30_000,
};

// ── T12: Memory vs RAG Conflict ──────────────────────────────────────────────
//
// Tests whether RAG (fresh document data) takes priority over stale memory.
//   Session 1: User discusses deductible ($500). AI stores in memory.
//   Between sessions: Modify file to $750.
//   Session 2: Ask about deductible.
//   Correct answer: $750 (RAG wins, memory is stale).
//   BAD answer: $500 (memory override, stale data).

export const MEMORY_VS_RAG_TEST = {
  id: 'T12',
  name: 'Memory vs RAG conflict -- stale memory override',
  dimension: 'memory-vs-rag' as Dimension,
  description:
    'Create memory about deductible, change the file, verify AI uses fresh RAG over stale memory.',

  /** Session 1: Discuss deductible to create memory */
  session1Prompts: [
    'What is my collision deductible? I want to remember this.',
    'So my collision deductible is $500, right? I want to make sure I have this right.',
  ],

  /** File mutation (between sessions) */
  fileToModify: 'Auto Insurance Policy.md',
  originalText: '**Deductible:** $500',
  modifiedText: '**Deductible:** $950',
  originalTableText: 'Collision ($500 ded)',
  modifiedTableText: 'Collision ($950 ded)',

  /** Wait for memory summarization after Session 1 */
  memoryWaitMs: 20_000,
  /** Wait for re-indexing after file change */
  reindexWaitMs: 30_000,

  /** Session 2: Ask the same question — RAG should win */
  session2Prompt: 'What is my collision deductible?',
  session2Assertions: [
    {
      name: 'Uses RAG value ($950, not stale $500)',
      weight: 3,
      check: containsAny(['$950', '950']),
    },
    {
      name: 'Does NOT use stale memory value ($500)',
      weight: 3,
      check: containsNone(['$500']),
    },
    {
      name: 'Confident answer (not hedged between two values)',
      weight: 1,
      check: containsNone([
        'previously was $500', 'was $500', 'used to be $500', 'changed from $500',
      ]),
    },
  ] as Assertion[],
};
