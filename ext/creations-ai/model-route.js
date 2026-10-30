// model-route.js — Creations AI's one way to the model.
//
// Every model call in Creations (chat turns, the director, memory, Act, the
// studio, stories, test drives) goes through here, so one set of rules holds
// for all of them instead of each part keeping its own:
//
// - No hidden token caps. A call never sets its own limit on how much the
//   model may write or think; the model stops when it is done. The only limit
//   is one the user chose (a character's "max tokens per message"), passed as
//   `userLimit`. Per-call caps were the bug: Act gave a thinking model 1800
//   tokens for its reasoning and its answer together, the reasoning took them
//   all, and Act failed with nothing written.
// - Thinking is the caller's choice (`think`), as is `format`, `temperature`
//   and the context window (`numCtx`).
// - `ask` waits for the whole answer. A reply with no answer in it (a model
//   that only reasoned, or a lone <think> block) is asked once more with
//   thinking off, the same way for every caller.
// - `stream` hands the chunks on as they come, for turns written live.

const THINK_BLOCK = /<think>[\s\S]*?(<\/think>|$)/gi;

/** The text of a reply with any <think> block taken out. */
export function answerText(text) {
  return String(text || '').replace(THINK_BLOCK, '').trim();
}

/** The options sent for a call: the caller's, with no token cap but the user's own. */
export function routeOptions(opts = {}) {
  const { userLimit, maxTokens: _ignored, ...rest } = opts || {};
  const out = { ...rest };
  if (Number(userLimit) > 0) out.maxTokens = Number(userLimit);
  if (!(Number(out.numCtx) > 0)) delete out.numCtx;
  return out;
}

export function createModelRoute(lm) {
  const stream = (modelId, messages, opts = {}, signal) => lm.sendChatRequest(modelId, messages, routeOptions(opts), signal);

  async function collect(modelId, messages, opts, signal, onText) {
    let text = '';
    for await (const chunk of stream(modelId, messages, opts, signal)) {
      if (chunk && chunk.content) { text += chunk.content; if (onText) onText(text); }
    }
    return text;
  }

  /** The whole reply. One with no answer is asked once more with thinking off. */
  async function ask(modelId, messages, opts = {}, { signal, onText } = {}) {
    const first = await collect(modelId, messages, opts, signal, onText);
    if (answerText(first) || opts.think === false || (signal && signal.aborted)) return first;
    return collect(modelId, messages, { ...opts, think: false }, signal, onText);
  }

  return { stream, ask };
}
