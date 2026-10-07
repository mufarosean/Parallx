// questionProviders.ts — questions one tool holds, offered to any tool that practises them
//
// A tool with a store of questions (a problem bank, practice cards, an
// imported exam paper) registers a provider while it runs; a tool that
// runs sessions over questions lists whatever providers it finds. Neither
// names the other: the core defines the shape and the tools fill it
// (CLAUDE.md, the first principle). Turned off, a tool's provider goes
// with its subscriptions and `onDidChangeQuestionProviders` fires, so a
// consumer drops its questions at once.
//
// Module-global registry (providers survive activation order). Built-ins
// import it; extensions reach the same live object through the core
// command `questions.getRegistry` (src/commands/questionCommands.ts),
// which returns `{ register, list, onDidChange }`.

import { Emitter, type Event } from '../platform/events.js';
import { toDisposable, type IDisposable } from '../platform/lifecycle.js';

export type QuestionKind = 'essay' | 'short' | 'quant' | 'mc' | 'other';

export interface IQuestionRubricPoint {
  readonly text: string;
  readonly required: boolean;
}

/** One question as a provider hands it over. `ref` is the provider's own key for `open`. */
export interface IQuestionItem {
  readonly ref: string;
  readonly question: string;
  readonly answer: string;
  readonly kind: QuestionKind;
  readonly rubric?: readonly IQuestionRubricPoint[];
  readonly paper?: string;
  readonly source?: string;
  readonly exam?: string;
  readonly sitting?: string;
  readonly number?: string;
  readonly part?: string;
  readonly label?: string;
  readonly sourceUri?: string;
  readonly sourcePage?: number;
  /** The passage the question was made from, when the provider kept one. */
  readonly sourceExcerpt?: string;
  readonly tags?: readonly string[];
}

export interface IQuestionProvider {
  /** Stable, unique across tools: `<tool>.<store>`. */
  readonly id: string;
  readonly displayName: string;
  /** The tool that registered it, for attribution in a consumer's UI. */
  readonly toolId: string;
  list(opts?: { limit?: number }): Promise<IQuestionItem[]>;
  /** Show the question where it lives. Resolves false when it could not. */
  open?(ref: string): Promise<boolean>;
}

/** The live object `questions.getRegistry` returns to extensions. */
export interface IQuestionProviderRegistry {
  register(provider: IQuestionProvider): IDisposable;
  list(): readonly IQuestionProvider[];
  onDidChange: Event<void>;
}

const _providers = new Map<string, IQuestionProvider>();
const _onDidChange = new Emitter<void>();

/** Fires when a provider is registered, replaced or disposed. */
export const onDidChangeQuestionProviders: Event<void> = _onDidChange.event;

export function listQuestionProviders(): readonly IQuestionProvider[] {
  return [..._providers.values()];
}

/**
 * Register a provider. The same id again replaces the earlier provider
 * (with a warning); disposing the earlier one afterwards leaves the
 * replacement in place.
 */
export function registerQuestionProvider(provider: IQuestionProvider): IDisposable {
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) {
    throw new Error('[questionProviders] A provider needs an id.');
  }
  if (typeof provider.list !== 'function') {
    throw new Error(`[questionProviders] Provider "${provider.id}" needs a list() function.`);
  }
  if (_providers.has(provider.id)) {
    console.warn(`[questionProviders] Provider "${provider.id}" registered twice; the later one replaces the earlier.`);
  }
  _providers.set(provider.id, provider);
  _onDidChange.fire();
  return toDisposable(() => {
    if (_providers.get(provider.id) !== provider) return;
    _providers.delete(provider.id);
    _onDidChange.fire();
  });
}

/** One live object, so a consumer holding it sees every later registration. */
export const questionProviderRegistry: IQuestionProviderRegistry = Object.freeze({
  register: registerQuestionProvider,
  list: listQuestionProviders,
  onDidChange: onDidChangeQuestionProviders,
});
