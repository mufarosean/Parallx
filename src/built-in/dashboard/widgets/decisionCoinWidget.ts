// decisionCoinWidget.ts — a coin for the decisions that don't deserve one.
//
// Tap the coin: it spins, lands on one of your answers, and commits you.
// Two answers make it a coin; more make it a tiny wheel of fate. The
// point is the ritual, not the randomness.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface DecisionConfig {
  readonly question: string;
  readonly answers: readonly string[];
}

const DEFAULT_CONFIG: DecisionConfig = {
  question: 'Should I?',
  answers: ['Yes', 'No'],
};

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4v-2"/><path d="M9.5 10.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5-2.5 2-2.5 3.5"/><circle cx="12" cy="16.5" r="0.5" fill="currentColor"/></svg>';

function normalizeConfig(raw: unknown): DecisionConfig {
  const cfg = (raw ?? {}) as Partial<DecisionConfig>;
  const answers = Array.isArray(cfg.answers)
    ? cfg.answers.filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim())
    : [];
  return {
    question: typeof cfg.question === 'string' ? cfg.question : '',
    answers: answers.length >= 2 ? answers : DEFAULT_CONFIG.answers,
  };
}

export const DECISION_COIN_WIDGET: WidgetTypeRegistration<DecisionConfig> = {
  typeId: 'parallx.dashboard.decision-coin',
  displayName: 'Decision Coin',
  description: 'Tap the coin when you cannot decide. It spins, lands on one of your answers, and commits you.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 3, rowSpan: 3 },
  chromeStyle: 'minimal',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      question: {
        type: 'string',
        label: 'The question',
        placeholder: 'Should I?',
      },
      answers: {
        type: 'string-list',
        label: 'Possible answers',
        description: 'Two answers make it a coin; more make it a wheel of fate.',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<DecisionConfig>): WidgetHandle {
    container.classList.add('dcw');
    let config = normalizeConfig(ctx.config);

    const question = document.createElement('div');
    question.className = 'dcw__question';
    const coin = document.createElement('button');
    coin.className = 'dcw__coin';
    coin.type = 'button';
    coin.setAttribute('aria-label', 'Flip the coin');
    const face = document.createElement('span');
    face.className = 'dcw__face';
    coin.appendChild(face);
    const hint = document.createElement('div');
    hint.className = 'dcw__hint';
    container.appendChild(question);
    container.appendChild(coin);
    container.appendChild(hint);

    let spinning = false;
    let spinTimer: ReturnType<typeof setTimeout> | undefined;

    function idle(): void {
      question.textContent = config.question || 'Should I?';
      face.textContent = '?';
      hint.textContent = 'Tap the coin.';
      coin.classList.remove('dcw__coin--spin', 'dcw__coin--landed');
    }

    coin.addEventListener('click', () => {
      if (spinning) return;
      spinning = true;
      face.textContent = '';
      hint.textContent = '';
      coin.classList.remove('dcw__coin--landed');
      coin.classList.add('dcw__coin--spin');
      spinTimer = setTimeout(() => {
        const answer = config.answers[Math.floor(Math.random() * config.answers.length)];
        coin.classList.remove('dcw__coin--spin');
        coin.classList.add('dcw__coin--landed');
        face.textContent = answer;
        hint.textContent = 'The coin has spoken. Tap to ask again.';
        spinning = false;
      }, 900);
    });

    idle();
    const sub = ctx.onDidChangeConfig((next) => {
      config = normalizeConfig(next);
      spinning = false;
      if (spinTimer) clearTimeout(spinTimer);
      idle();
    });

    return {
      dispose() {
        if (spinTimer) clearTimeout(spinTimer);
        sub.dispose();
      },
    };
  },
};
