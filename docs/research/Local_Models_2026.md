# Local AI Models — Effective Use (research notes, 2026-07-20)

> **Status: RESEARCH ONLY. Nothing here is built or scheduled.** Captured at
> Mufaro's request ("document the research, we will not do anything with it
> for now"). This is a reference for a future decision, not a plan. Verify
> every Parallx-specific claim against current code before acting — some are
> inferred from memory, not re-read here.

Parallx runs **local models via Ollama** (no cloud unless an API key is
entered; embeddings = `nomic-embed-text`). These notes are the 2026 state of
the art for running local models effectively, with the Parallx implication
called out for each.

---

## 1. The landscape shifted to Mixture-of-Experts (MoE)

- Qwen3 is the 2026 local **agentic** leader; the frontier open models
  (Qwen3.5/3.6, Gemma 4, Kimi K2.x, Llama 4, Mistral Large 3) are MoE.
- MoE = large total params, small **active** params per token.
  Qwen3-30B-A3B = 30B total / ~3B active: runs (latency, VRAM) like a 3B,
  reasons closer to a much larger model. Qwen3.5 reportedly beats
  GPT-5-mini on most benchmarks on a 64GB Mac.
- Small-class leaders: Qwen3-7/8B tops HumanEval under 8B; Llama 3.2 3B for
  4GB RAM; Phi-4 Mini 3.8B for 8GB. Coding: Qwen3-Coder-30B (MoE, 3.3B
  active, ~19GB Q4_K_M, 256K ctx).

**Parallx implication:** `resolveModelTier` bins small/medium/large by RAW
param count (≤8B / 9–32B / >32B). MoE breaks this — a 30B-A3B model tiers as
medium/large (heavier system prompt) but has ~3B latency/brittleness. Tier
should key on ACTIVE params or a capability probe, not total.

## 2. Tool-calling reliability (highest-leverage finding)

- **Small models pick the RIGHT tool much less reliably than they FORMAT the
  call.** Consistent 2026 guidance: keep tool counts LOW (3–5) with sharp,
  distinct descriptions.
- **Tool calling is structured output in disguise.** Ollama supports
  grammar-constrained decoding (llama.cpp GBNF via XGrammar) through the
  `format` parameter — you can GUARANTEE valid tool-call JSON / any schema
  at the decoder, not hope-then-retry. Works on Llama 3.1+, Qwen 2.5+,
  Mistral.
- Production pattern: constrained decoding whenever the CONSUMER is a
  program (tool calls, extraction), not a human.

**Parallx implication:** this is direct evidence for the PENDING "thin tools"
prompt phase — reframed from prompt-economy to ACCURACY. And: constrain
tool-call + structured-extraction output via Ollama `format` to kill the
"unparseable small-model output" failure class at the decoder. (Verify
whether Parallx already uses `format`-constrained output.)

## 3. Thinking mode — per-task, never per-model

- Qwen3 (and kin) split thinking / non-thinking. **Non-thinking for
  agentic/tool tasks** — faster, more predictable, "stops second-guessing
  and just executes." **Thinking only for hard reasoning** (math, complex
  planning); it burns 2–5× tokens.
- "Non-thinking is fine in ~95% of real-world cases."

**Parallx implication:** aligns with the existing rule *no hardcoded
per-model skip-think lists; expose via UX* ([[feedback-no-hardcoded-model-behavior]]).
Sharpened: thinking = per-MODE/per-TASK toggle (agent tool-loops →
non-thinking; "reason this through" chat → thinking), surfaced as a control.
Also why the M87 heartbeat DETERMINISTIC lane was right — no model
second-guessing a threshold.

## 4. Context window — small models use far less than advertised

- `num_ctx` **defaults to 4096** and silently truncates — a classic trap.
  Set it explicitly per model.
- Reliable working window scales with size, WELL below the advertised max:
  3B ≈ 8–16K, **7–8B ≈ 16–32K**, 70B ≈ 64K. Mainstream local tops out at
  128K but is unreliable well before that.
- **"Lost in the middle"**: models attend well to the START and END of
  context, poorly to the middle (up to ~40% degradation at scale).
- KV cache cost is real: a 7B Q4_K_M ≈ 6GB at 4K ctx, ≈14GB at 128K.

**Parallx implication:** validates compaction (don't let context grow) and
the memory index-always-loaded pattern (pin load-bearing content at a stable
position). Refinements: (a) audit that Parallx sets `num_ctx` explicitly
(not Ollama's 4K default); (b) treat ~24–32K as the real ceiling for the
default local model regardless of advertised max; (c) place the most
critical instructions at the very START and very END of the assembled
prompt.

## 5. Serving-layer wins (cheap, high-impact Ollama settings)

- **`keep_alive` / `OLLAMA_KEEP_ALIVE`** — Ollama unloads after 5 min idle;
  next turn eats a multi-second→minute cold reload. Set 30m (or keep the
  active model warm) to remove the latency cliff after every break.
- **Quantization: `Q4_K_M` is the near-universal sweet spot** — ~⅓ of FP16
  memory, quality loss "almost imperceptible." Q8_0 near-lossless but needs
  16GB+ VRAM for context headroom. `q4_0` is noticeably worse — avoid.
- **`OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE=q8_0`** — flash
  attention + quantized KV cache ≈ halves per-token context memory →
  longer effective window on the same card.
- Confirm 100% GPU offload (`ollama ps`) before tuning `num_batch`;
  `num_gpu 999` offloads max layers, reduce on OOM.

**Parallx implication:** candidate defaults/settings Parallx could set or
expose. Verify what Parallx pulls by default (quant level) and whether it
manages `keep_alive`.

## 6. Reliability & observability — Parallx is already ahead

- Playbook: retry-with-fallback (to a smaller/differently-quantized model on
  unparseable output); validate structured output before it propagates;
  **log every step (full prompt, raw output, parsed tool calls, results) to
  local SQLite** for LangSmith-style observability without external calls.
- GQA (Llama/Mistral/Gemma), PagedAttention (vLLM), KV-cache quant, sliding-
  window attention are the architectural KV-cache mitigations — mostly
  server-side, informational.

**Parallx implication:** the SQLite step-logging is exactly what M91
(autonomous transcripts) + the autonomy event log built — research confirms
the direction. Gap to consider: a **retry / model-fallback** layer when the
local model returns garbage (does a turn fail, or retry?).

---

## Candidate work items (NOT scheduled — for a future decision)

Rough leverage order:

1. **Thin the per-turn tool surface** (3–5 sharp tools) — biggest small-model
   accuracy win; already on the backlog (system-prompt-restructure).
2. **Grammar-constrain tool-call / extraction output** via Ollama `format`
   — eliminates a failure class at the decoder.
3. **Fix the model-tier heuristic for MoE** — active params, not total.
4. **Audit serving defaults** — `num_ctx`, `keep_alive`, KV-cache quant,
   flash attention.
5. **Retry/model-fallback** on unparseable local-model output.

## Sources

- https://www.morphllm.com/best-ollama-models
- https://whatllm.org/best-ollama-models
- https://eastondev.com/blog/en/posts/ai/20260410-ollama-performance-optimization/
- https://markaicode.com/benchmarks/ollama-quantization-benchmark/
- https://www.runaihome.com/blog/ollama-slow-speed-up-tokens-per-second-2026/
- https://docs.ollama.com/capabilities/structured-outputs
- https://ollama.com/blog/structured-outputs
- https://medium.com/@rosgluk/constraining-llms-with-structured-output-ollama-qwen3-python-or-go-2f56ff41d720
- https://fireworks.ai/blog/qwen-3-decoded
- https://www.buildmvpfast.com/blog/qwen-3-5-non-thinking-mode-local-agent-deployment-stable-2026
- https://www.promptquorum.com/local-llms/long-context-local-llms
- https://llmconfigurator.com/en/guides/context-window-guide
- https://www.sitepoint.com/the-complete-stack-for-local-autonomous-agents--from-ggml-to-orchestration/
