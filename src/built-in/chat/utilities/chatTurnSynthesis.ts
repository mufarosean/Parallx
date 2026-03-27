// chatTurnSynthesis.ts — M14 response synthesis with session cancellation
//
// Handles the final synthesis step of a chat turn, linking the
// sessionCancellationSignal to abort streaming if the session ends.

/**
 * Synthesize final response, aborting if sessionCancellationSignal fires.
 */
export async function synthesizeResponse(
  sessionCancellationSignal: AbortSignal,
  streamChunks: AsyncIterable<{ content?: string; done?: boolean }>,
  emit: (text: string) => void,
): Promise<void> {
  // Link session cancellation to an internal abort
  const controller = new AbortController();
  sessionCancellationSignal.addEventListener('abort', () => controller.abort(), { once: true });

  for await (const chunk of streamChunks) {
    if (controller.signal.aborted) {
      break;
    }
    if (chunk.content) {
      emit(chunk.content);
    }
    if (chunk.done) {
      break;
    }
  }
}
