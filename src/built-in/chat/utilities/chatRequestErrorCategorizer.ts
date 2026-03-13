export function categorizeChatRequestError(err: unknown): { message: string } {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { message: '' };
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return {
      message: 'Request timed out. The model may be loading or the Ollama server is unresponsive. Try again or check that Ollama is running.',
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('Failed to fetch') || message.includes('ECONNREFUSED') || message.includes('NetworkError') || message.includes('fetch failed')) {
    return {
      message: 'Ollama is not running. Install and start Ollama from https://ollama.com, then try again.',
    };
  }
  if (message.includes('model') && (message.includes('not found') || message.includes('404'))) {
    const modelMatch = message.match(/model\s+['"]?([^\s'"]+)/i);
    const modelName = modelMatch?.[1] ?? 'the requested model';
    return {
      message: `Model "${modelName}" not found. Run \`ollama pull ${modelName}\` to download it.`,
    };
  }

  return { message };
}