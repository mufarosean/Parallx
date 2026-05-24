// ext/example-chat-participant/main.js
//
// Reference extension for M82 Slice B (Extension Contribution Model).
//
// Demonstrates the manifest-declared → imperative-wired chat participant
// flow:
//   1. The manifest's `contributes.chat.participants[]` makes Parallx register
//      a stub participant up-front (so the participant id is reserved and the
//      chat UI can show it in `@`-mention pickers before activation).
//   2. On activation, the extension calls `api.chat.registerParticipant({ id,
//      handler })`. Parallx looks up the manifest stub by id and swaps the
//      real handler in place — no second registration, no duplicate id.
//
// Subscribing the disposable to `context.subscriptions` ensures the handler
// is unwired when the extension deactivates.

/**
 * @param {{ subscriptions: Array<{ dispose(): void }> }} context
 * @param {any} api
 */
async function activate(context, api) {
  if (!api?.chat?.registerParticipant) {
    console.warn('[example-chat-participant] api.chat.registerParticipant is not available — running on an older host.');
    return;
  }

  const disposable = api.chat.registerParticipant({
    id: 'parallx.example.echo',
    name: 'echo',
    fullName: 'Echo',
    description: 'Reference participant that echoes the user\'s prompt.',
    handler: async (request, _context, response, _token) => {
      const text = typeof request?.text === 'string' ? request.text : '';
      response.markdown(`echo: ${text}`);
      return {};
    },
  });

  context.subscriptions.push(disposable);
}

export { activate };
