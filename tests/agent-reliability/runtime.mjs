// Runs in the renderer via page.evaluate. Uses production services; only the
// deterministic provider and the bounded failure tool are test implementations.
export async function installRuntime({ mode, modelId, script = [], pressure = false, forbidWait = false }) {
  const services = window.__parallx_workbench__._services;
  const lm = services.get({ id: 'ILanguageModelsService' });
  const tools = services.get({ id: 'ILanguageModelToolsService' });
  const chat = services.get({ id: 'IChatService' });
  const state = window.__reliabilityRuntime = { requests: [], calls: [], script: [...script], pressure, pending: false, errors: [], summaries: 0 };
  const allowed = new Set(['fs_read_file', 'fs_list_files', 'fs_write_file', 'plan_update', 'reliability_checkpoint']);
  for (const tool of tools.getTools()) tools.setToolEnabled(tool.name, allowed.has(tool.name));
  tools.onDidChangeTools(() => {
    for (const tool of tools.getTools()) if (!allowed.has(tool.name) && tools.isToolEnabled(tool.name)) tools.setToolEnabled(tool.name, false);
  });
  if (!tools.getTools().some(t => t.name === 'reliability_checkpoint')) tools.registerTool({
    name: 'reliability_checkpoint', description: 'Test fixture checkpoint. Call only when the user explicitly requests it.',
    parameters: { type: 'object', properties: { kind: { type: 'string' }, sequence: { type: 'number' } }, required: ['kind'] },
    requiresConfirmation: false, permissionLevel: 'always-allowed',
    handler: async (args, token) => {
      state.calls.push({ name: 'reliability_checkpoint', args, at: Date.now() });
      if (args.kind === 'fail') return { content: 'Transient fixture failure. No output was written. Retry this checkpoint once with kind=ok.', isError: true };
      if (args.kind === 'wait') {
        if (forbidWait) {
          state.errors.push('Cancelled checkpoint replayed after restart');
          return { content: 'Cancelled checkpoint replayed after restart.', isError: true };
        }
        state.pending = true;
        await new Promise(resolve => { if (token.isCancellationRequested) resolve(); else token.onCancellationRequested(resolve); });
        state.pending = false;
        return { content: 'Checkpoint cancelled. No output was written.', isError: true };
      }
      if (args.kind === 'pressure') return { content: Array.from({ length: 3200 }, (_, i) => `Fixture observation ${i}: preserve the pending inventory task.\n`).join('') };
      return { content: 'Checkpoint succeeded.' };
    },
  });
  const originalInvoke = tools.invokeToolWithRuntimeControl.bind(tools);
  tools.invokeToolWithRuntimeControl = async (...args) => {
    const at = Date.now();
    const result = await originalInvoke(...args);
    state.calls.push({ name: args[0], args: args[1], result, at, doneAt: Date.now() });
    return result;
  };
  if (mode === 'deterministic') {
    const info = { id: 'reliability-scripted', displayName: 'Reliability fixture', family: 'fixture', parameterSize: '27B', quantization: 'none', contextLength: 16384, capabilities: ['completion', 'tools'] };
    lm.registerProvider({
      id: 'reliability', displayName: 'Reliability fixture',
      listModels: async () => [info], checkAvailability: async () => ({ available: true }), getModelInfo: async () => info,
      async *sendChatRequest(_id, messages, options, signal) {
        state.requests.push({ messages: JSON.parse(JSON.stringify(messages)), options, at: Date.now() });
        if (signal?.aborted) return;
        if (!options?.tools?.length) {
          if (messages[0]?.content.startsWith('You are compacting an agent conversation')) state.summaries++;
          // Extractive fixture summary: preserves user directions and tool
          // outcomes while removing the synthetic pressure payload.
          const text = messages.map(m => m.content).join('\n').replace(/Fixture observation \d+: preserve the pending inventory task\.\n/g, '');
          yield { content: 'Mission and continuation state:\n' + text.slice(-18000), done: true, promptEvalCount: Math.ceil(text.length / 4), evalCount: 500 };
          return;
        }
        const action = state.script.shift();
        const promptEvalCount = Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
        if (action?.tool) yield { content: action.text ?? 'Executing the next fixture step.', toolCalls: [{ function: { name: action.tool, arguments: action.args } }], done: true, promptEvalCount, evalCount: 40 };
        else yield { content: action?.text ?? 'The planned step is finished.', done: true, promptEvalCount, evalCount: 30 };
      },
    });
    await lm.getModels();
    // registerProvider refresh is asynchronous; wait for the public list.
    for (let i = 0; i < 100 && !(await lm.getModels()).some(m => m.id === info.id); i++) await new Promise(r => setTimeout(r, 10));
    lm.setActiveModel(info.id);
    modelId = info.id;
  } else {
    const info = await lm.getModelInfo(modelId);
    if (!info.capabilities.includes('tools')) throw new Error(`Model does not advertise tools: ${modelId}`);
    lm.setActiveModel(modelId);
    state.modelInfo = info;
    // Observe at the provider boundary; do not alter model request behavior.
    for (const provider of lm.getProviders()) {
      const original = provider.sendChatRequest.bind(provider);
      provider.sendChatRequest = async function* (id, messages, options, signal) {
        const trace = { model: id, messages: JSON.parse(JSON.stringify(messages)), options, at: Date.now(), chunks: [] };
        state.requests.push(trace);
        if (messages[0]?.content.startsWith('You are compacting an agent conversation')) state.summaries++;
        for await (const chunk of original(id, messages, options, signal)) { trace.chunks.push(chunk); yield chunk; }
        trace.doneAt = Date.now();
      };
    }
  }
  state.modelId = modelId;
  state.start = async (text, sessionId) => {
    const session = sessionId ? chat.getSession(sessionId) : chat.createSession('agent', modelId);
    if (!session) throw new Error(`Session not restored: ${sessionId}`);
    state.sessionId = session.id;
    state.done = false;
    state.startedAt = Date.now();
    state.turnPromise = chat.sendRequest(session.id, text).then(result => { state.result = result; }, error => { state.errors.push(String(error)); }).finally(() => { state.done = true; state.finishedAt = Date.now(); });
    return session.id;
  };
  state.snapshot = () => ({ requests: state.requests, calls: state.calls, errors: state.errors, summaries: state.summaries, session: chat.getSession(state.sessionId), sessions: chat.getSessions().map(s => ({ id: s.id, plan: s.plan })), result: state.result, modelInfo: state.modelInfo });
  return { modelId, tools: tools.getToolDefinitions().map(t => t.name) };
}
