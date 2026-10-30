// chatTitle.ts — a chat's name.
//
// A chat was named by the first 47 characters of its first message, so the
// history list read "Can you look at the thing I pasted earlier and..." for
// half of it. The first message still names the chat at once; after the first
// answer, the chat's own model is asked, in the background, for a few words
// saying what the conversation is about, and the name is replaced. It is
// asked only while the chat still has its first-words name, so a name it has
// written is never asked for again, and an assistant's own runs (routines,
// heartbeats) keep the names they were given. Setting: chat.nameWithModel.

import { ChatContentPartKind } from './chatTypes.js';
import type { IChatMarkdownContent, IChatMessage, IChatRequestOptions, IChatResponseChunk, IChatSession } from './chatTypes.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import { isEphemeralSessionId } from './chatSessionPersistence.js';
import { capWithReasoningRoom } from './modelEngineBroker.js';

const GREETING = /^\s*(hi|hey|hello|howdy|yo|sup|what's up|hiya|good\s*(morning|afternoon|evening)|greetings)\s*[!.,?]*\s*$/i;
/** The longest name the model's answer is cut to. */
const MAX_TITLE = 60;
/** How much of the first question and answer the model reads. */
const EXCERPT = 1500;

/** The name a chat takes from its first message; undefined for a greeting, which names nothing. */
export function firstWordsTitle(message: string): string | undefined {
  if (GREETING.test(message)) return undefined;
  return message.length > 50 ? message.slice(0, 47) + '...' : message;
}

/** The model's answer as a name: one line, no quotes or markup, at most 60 characters; undefined when there is none. */
export function cleanModelTitle(raw: string): string | undefined {
  const text = raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return undefined;
  let title = line
    .replace(/^(#+\s*|\*\*|title\s*:\s*)/i, '')
    .replace(/\*\*/g, '')
    .replace(/^["'“‘`]+|["'”’`]+$/g, '')
    .replace(/[.!:;,]+$/, '')
    .trim();
  if (title.length > MAX_TITLE) {
    const cut = title.slice(0, MAX_TITLE);
    title = (cut.lastIndexOf(' ') > 20 ? cut.slice(0, cut.lastIndexOf(' ')) : cut) + '…';
  }
  return title || undefined;
}

/** The first exchange worth naming the chat by, when it is still named by its first words. */
export function exchangeToName(session: IChatSession): { question: string; answer: string } | undefined {
  if (isEphemeralSessionId(session.id) || session.origin) return undefined;
  for (const pair of session.messages) {
    const question = pair.request.text;
    if (!firstWordsTitle(question)) continue;
    if (session.title !== 'New Chat' && session.title !== firstWordsTitle(question)) return undefined;
    if (!pair.response.isComplete) return undefined;
    const answer = pair.response.parts
      .filter((p) => p.kind === ChatContentPartKind.Markdown)
      .map((p) => (p as IChatMarkdownContent).content).join('').trim();
    return answer ? { question, answer } : undefined;
  }
  return undefined;
}

/** What the model is asked. */
export function titleMessages(question: string, answer: string): IChatMessage[] {
  const clip = (t: string) => (t.length > EXCERPT ? t.slice(0, EXCERPT) + '…' : t);
  return [
    {
      role: 'system',
      content: 'You name conversations. Reply with only a title of 2 to 6 words that says what this conversation is about, '
        + 'in the language of the conversation, in Title Case. No quotes, no ending punctuation, nothing else.',
    },
    { role: 'user', content: `First message:\n${clip(question)}\n\nFirst answer:\n${clip(answer)}\n\nTitle:` },
  ];
}

export interface IChatTitleNamerDeps {
  readonly onDidCompleteRequest: Event<{ readonly sessionId: string }>;
  getSession(sessionId: string): IChatSession | undefined;
  setSessionTitle(sessionId: string, title: string): void;
  sendChatRequestForModel(modelId: string, messages: readonly IChatMessage[], options?: IChatRequestOptions, signal?: AbortSignal): AsyncIterable<IChatResponseChunk>;
  /** The setting: false keeps the first-words names. */
  enabled(): boolean;
}

/** After a chat's first answer, its model names it: one try per chat while the app runs. */
export function registerChatTitleNamer(deps: IChatTitleNamerDeps): IDisposable {
  const tried = new Set<string>();
  const sub = deps.onDidCompleteRequest(({ sessionId }) => {
    if (tried.has(sessionId) || !deps.enabled()) return;
    const session = deps.getSession(sessionId);
    const exchange = session && exchangeToName(session);
    if (!session || !exchange || !session.modelId) return;
    tried.add(sessionId);
    const before = session.title;
    void (async () => {
      let raw = '';
      for await (const chunk of deps.sendChatRequestForModel(session.modelId, titleMessages(exchange.question, exchange.answer),
        { temperature: 0.2, think: false, maxTokens: capWithReasoningRoom(40), engine: { priority: 'helper', label: 'Naming a chat' } })) {
        raw += chunk.content ?? '';
      }
      const title = cleanModelTitle(raw);
      // A name given meanwhile (another turn, the user) stands.
      if (title && deps.getSession(sessionId)?.title === before) deps.setSessionTitle(sessionId, title);
    })().catch(() => undefined); // a model that cannot answer leaves the first-words name
  });
  return { dispose: () => sub.dispose() };
}
