const { performance } = require("node:perf_hooks");
const { llmComplete, DEFAULT_MODELS } = require("./llm");
const config = require("./config");

const LIMITS = Object.freeze({
  source: 26000, segment: 6000, overlap: 400, segments: 5,
  mapPrompt: 800, mapInput: 6800, mapOutput: 600,
  otherContext: 1400, reducerMetadata: 1000, reducerPrompt: 800,
  reducerInput: 6200, summary: 4000, logicalCalls: 6, attempts: 12,
  input: 80000, output: 14000, retained: 7000,
  requestMs: 30000, stageMs: 60000, roundMs: 450000,
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// Owns *all* attempts. The injected transport is a single request, never an
// adapter with internal retry/fallback. Output is reserved even on failed or
// cancelled requests, whose remote generated text may not be observable.
function createSummaryProvider({ transport = llmComplete, providers,
  signal, now = () => performance.now(), parentDeadline = Infinity } = {}) {
  const configured = providers || config.resolveCheckpointProviders();
  const chain = [configured.primaryProvider, configured.fallbackProvider]
    .filter((value, index, values) => value && value !== "none" && values.indexOf(value) === index);
  if (!chain.length || chain.length > 2) throw fail("provider_configuration");
  const deadline = Math.min(now() + LIMITS.roundMs, parentDeadline);
  const ledger = { logical_calls: 0, attempts: 0, input_chars: 0,
    output_chars: 0, output_reserved: 0, calls: [] };
  function check() {
    if (signal?.aborted) throw fail("cancelled");
    if (now() >= deadline) throw fail("round_deadline");
  }
  async function complete(prompt, { kind, outputLimit }) {
    check();
    const inputLimit = kind === "map" ? LIMITS.mapInput : LIMITS.reducerInput;
    if (prompt.length > inputLimit || ledger.logical_calls >= LIMITS.logicalCalls) throw fail("logical_budget");
    ledger.logical_calls++;
    const stageDeadline = Math.min(deadline, now() + LIMITS.stageMs);
    for (const provider of chain) {
      check();
      if (now() >= stageDeadline) throw fail("stage_deadline");
      if (ledger.attempts >= LIMITS.attempts || ledger.input_chars + prompt.length > LIMITS.input
        || ledger.output_reserved + outputLimit > LIMITS.output) throw fail("attempt_budget");
      ledger.attempts++;
      ledger.input_chars += prompt.length;
      ledger.output_reserved += outputLimit;
      const model = DEFAULT_MODELS[provider];
      const call = { kind, provider, model, status: "started", input_chars: prompt.length, output_reserved: outputLimit };
      ledger.calls.push(call);
      console.log(`[checkpoint] Summary attempt kind=${kind} provider=${provider} attempt=${ledger.attempts}`);
      const controller = new AbortController();
      const attemptStarted = now();
      const attemptDeadline = Math.min(attemptStarted + LIMITS.requestMs, stageDeadline);
      const timeoutMs = Math.max(1, attemptDeadline - attemptStarted);
      let timer;
      let abort;
      try {
        const boundary = new Promise((_, reject) => {
          abort = () => { controller.abort(); reject(fail("cancelled")); };
          signal?.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => {
            const code = timeoutMs < LIMITS.requestMs
              ? (stageDeadline === deadline ? "round_deadline" : "stage_deadline")
              : "request_deadline";
            controller.abort();
            reject(fail(code));
          }, timeoutMs);
        });
        if (signal?.aborted) abort();
        const result = await Promise.race([
          boundary,
          Promise.resolve().then(() => {
            check();
            return transport(prompt, null, { provider, model, timeoutMs,
              maxTokens: outputLimit, maxResponseChars: outputLimit, signal: controller.signal });
          }),
        ]);
        check();
        if (now() >= stageDeadline) throw fail("stage_deadline");
        if (now() >= attemptDeadline) throw fail("request_deadline");
        if (typeof result !== "string" || result.length > outputLimit) {
          if (typeof result === "string") call.observed_output_chars = result.length;
          throw fail("output_budget");
        }
        ledger.output_chars += result.length;
        call.status = "completed";
        call.output_chars = result.length;
        return result;
      } catch (error) {
        call.status = "failed";
        // Never include raw provider errors or source text in the ledger.
        call.reason = ["cancelled", "round_deadline", "stage_deadline", "request_deadline", "output_budget"].includes(error.code)
          ? error.code : "transport_error";
        if (error.code === "output_budget") call.output_limit_exceeded = true;
        if (signal?.aborted || ["cancelled", "round_deadline", "stage_deadline", "output_budget"].includes(error.code)) throw error;
      } finally {
        call.elapsed_ms = Math.max(0, now() - attemptStarted);
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.abort();
      }
    }
    throw fail("provider_attempts_exhausted");
  }
  return { complete, check, ledger, deadline };
}
module.exports = { LIMITS, createSummaryProvider, fail };
