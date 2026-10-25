const https = require("node:https");
const zlib = require("node:zlib");
const { StringDecoder } = require("node:string_decoder");
const checkpointConfig = require("./config");
const { buildFactPrompt, buildSummarySelection, validateAndRenderFacts, SUMMARY_SELECTION } = require("./ordinary-summary-facts");
const DEFAULT_MODELS = {
  deepseek: "deepseek-chat",
  siliconflow: "deepseek-ai/DeepSeek-V3.2",
};
const LLM_TIMEOUT_PAYLOAD = {
  smart_memories: [],
  episode_summary: "",
  configs: [],
  error: "llm超时",
};

function llmComplete(prompt, systemPrompt, options = {}) {
  const { provider = "siliconflow" } = options;
  const keyFn = provider === "deepseek" ? checkpointConfig.getDSKey : checkpointConfig.getSFKey;
  const baseFn = provider === "deepseek" ? checkpointConfig.getDSBaseUrl : checkpointConfig.getSFBaseUrl;
  const defaultModel = DEFAULT_MODELS[provider];

  return new Promise((resolve, reject) => {
    const apiKey = keyFn();
    if (!apiKey) return reject(new Error(`${provider} API key not found`));

    const baseUrl = baseFn();
    const url = new URL("/chat/completions", baseUrl);
    const model = options.model || defaultModel;
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.maxTokens ?? 1024;
    const requestTimeoutMs = options.timeoutMs ?? 45000;
    const responseLimitChars = options.maxResponseChars ? options.maxResponseChars * 8 + 4096 : null;
    const outputBudgetError = (message, budgetKind, observedResponseChars, content, finishReason) =>
      Object.assign(new Error(message), {
        code: "output_budget", budgetKind,
        outputLimitChars: options.maxResponseChars ?? null, responseLimitChars,
        observedResponseChars,
        observedOutputChars: typeof content === "string" ? content.length : null,
        providerFinishReason: ["stop", "length", "content_filter", "tool_calls", "function_call"].includes(finishReason)
          ? finishReason : null,
      });

    const body = JSON.stringify({
      model,
      messages: [
        ...(systemPrompt
          ? [{ role: "system", content: systemPrompt }]
          : []),
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false,
    });

    if (options.signal?.aborted) return reject(new Error("LLM request cancelled"));
    let settled = false;
    let wallTimer;
    let responseStream;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(value);
    };
    const onAbort = () => {
      req.destroy();
      responseStream?.destroy?.();
      finish(new Error("LLM request cancelled"));
    };
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let data = "";
        const decoder = new StringDecoder("utf8");
        const isGzip = res.headers["content-encoding"] === "gzip";
        const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
        responseStream = stream;
        stream.on("error", error => finish(error));
        stream.on("data", (chunk) => {
          if (settled) return;
          data += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          // Bound decompressed response memory as well as returned model text.
          if (responseLimitChars && data.length > responseLimitChars) {
            req.destroy();
            stream.destroy?.();
            finish(outputBudgetError("LLM response envelope limit exceeded", "response_envelope", data.length));
          }
        });
        stream.on("end", () => {
          if (settled) return;
          try {
            data += decoder.end();
            const parsed = JSON.parse(data);
            if (parsed.error) return finish(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            const content = parsed.choices?.[0]?.message?.content ?? "";
            const finishReason = parsed.choices?.[0]?.finish_reason;
            if (typeof content !== "string" || (options.maxResponseChars && content.length > options.maxResponseChars)) {
              return finish(outputBudgetError("LLM output limit exceeded",
                typeof content === "string" ? "content" : "content_type", data.length, content, finishReason));
            }
            if (options.maxResponseChars && finishReason === "length") {
              return finish(outputBudgetError("LLM token limit reached", "provider_tokens", data.length, content, finishReason));
            }
            finish(null, content);
          } catch (e) {
            finish(new Error(`Parse failed: ${e.message} responseChars=${data.length}`));
          }
        });
      }
    );
    req.setTimeout(requestTimeoutMs, () => {
      req.destroy();
      finish(new Error(`LLM request timed out after ${requestTimeoutMs}ms`));
    });
    req.on("error", error => finish(error));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) { onAbort(); return; }
    wallTimer = setTimeout(() => {
      req.destroy();
      responseStream?.destroy?.();
      finish(new Error("LLM wall deadline exceeded"));
    }, requestTimeoutMs);
    req.write(body);
    req.end();
  });
}

// Ordinary summaries use a source-bound fact protocol; instructions and data
// are separate chat messages. The segmented protocol is intentionally unchanged.

function quickHealthCheck(provider) {
  const keyFn = provider === "deepseek" ? checkpointConfig.getDSKey : checkpointConfig.getSFKey;
  if (!keyFn()) return false;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);
    llmComplete("回复 OK 即可", null, {
      provider,
      model: provider === "deepseek" ? "deepseek-chat" : "deepseek-ai/DeepSeek-V3.2",
      maxTokens: 10,
      timeoutMs: 10000,
    })
      .then(() => { clearTimeout(timeout); resolve(true); })
      .catch(() => { clearTimeout(timeout); resolve(false); });
  });
}

function quickDSHealthCheck() {
  if (!checkpointConfig.getDSKey()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);
    llmComplete("回复 OK 即可", null, { provider: "deepseek", model: "deepseek-chat", maxTokens: 10, timeoutMs: 10000 })
      .then(() => { clearTimeout(timeout); resolve(true); })
      .catch(() => { clearTimeout(timeout); resolve(false); });
  });
}

async function llmNightlyExtract(input) {
  const llmRequestConfig = checkpointConfig.resolveCheckpointLlmRequestConfig();
  const { prompt, system } = buildFactPrompt(input, llmRequestConfig.maxInputChars);
  const { primaryProvider, fallbackProvider } = checkpointConfig.resolveCheckpointProviders();
  const requestOptions = {
    temperature: 0.1,
    maxTokens: llmRequestConfig.maxTokens,
    timeoutMs: llmRequestConfig.timeoutMs,
    maxResponseChars: llmRequestConfig.maxTokens * 8,
  };

  async function attemptProvider(provider) {
    const model = DEFAULT_MODELS[provider];
    console.log(
      `[checkpoint] LLM attempt provider=${provider} model=${model} chars=${input.sources.reduce((sum, source) => sum + source.units.reduce((n, unit) => n + unit.text.length, 0), 0)} maxTokens=${requestOptions.maxTokens} timeoutMs=${requestOptions.timeoutMs}`,
    );
    const startedAt = Date.now();
    try {
      const result = await llmComplete(prompt, system, {
        provider,
        model,
        ...requestOptions,
      });
      const durationMs = Date.now() - startedAt;
      console.log(`[checkpoint] LLM succeeded provider=${provider} durationMs=${durationMs}`);
      return { ok: true, provider, model, durationMs, result };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      console.warn(`[checkpoint] LLM failed provider=${provider} model=${model} durationMs=${durationMs} error=${error.message}`);
      return { ok: false, provider, model, durationMs, error };
    }
  }

  async function finishExtraction(attempt) {
    const response = extractNightlyJson(attempt.result);
    const selectionPrompt = buildSummarySelection(response, input, llmRequestConfig.maxInputChars);
    if (!selectionPrompt) return response;
    console.log(`[checkpoint] LLM selector provider=${attempt.provider} model=${attempt.model} chars=${selectionPrompt.prompt.length}`);
    let result;
    try {
      result = await llmComplete(selectionPrompt.prompt, selectionPrompt.system, {
        provider: attempt.provider, model: attempt.model, ...requestOptions,
      });
    } catch (error) {
      if (error.code === "output_budget") throw error;
      throw Object.assign(new Error("summary_selection_llm_unavailable"), { code: "summary_selection_llm_unavailable" });
    }
    let selection;
    try { selection = JSON.parse(result); }
    catch (_) { throw Object.assign(new Error("summary_selection_response_json"), { code: "summary_selection_response_json" }); }
    validateAndRenderFacts(response, input, selection);
    // Internal annotation only; the provider's fact array and public v6 JSON remain unchanged.
    Object.defineProperty(response, SUMMARY_SELECTION, { value: selection });
    return response;
  }

  const primaryAttempt = await attemptProvider(primaryProvider);
  if (!primaryAttempt.ok) {
    if (primaryAttempt.error?.code === "output_budget") throw primaryAttempt.error;
    if (fallbackProvider === "none") {
      console.warn(`[checkpoint] LLM fallback disabled primary=${primaryProvider} fallback=none`);
      return { ...LLM_TIMEOUT_PAYLOAD };
    }
    if (fallbackProvider === primaryProvider) {
      console.warn(`[checkpoint] LLM fallback skipped primary=${primaryProvider} fallback=${fallbackProvider} reason=same-provider`);
      return { ...LLM_TIMEOUT_PAYLOAD };
    }

    const fallbackAttempt = await attemptProvider(fallbackProvider);
    if (!fallbackAttempt.ok) {
      if (fallbackAttempt.error?.code === "output_budget") throw fallbackAttempt.error;
      return { ...LLM_TIMEOUT_PAYLOAD };
    }
    console.log(`[checkpoint] LLM fallback succeeded provider=${fallbackProvider} durationMs=${fallbackAttempt.durationMs}`);
    return finishExtraction(fallbackAttempt);
  }

  return finishExtraction(primaryAttempt);
}

function extractNightlyJson(result) {
  try { return JSON.parse(result); }
  catch (_) { throw Object.assign(new Error("summary_response_json"), { code: "summary_response_json" }); }
}

module.exports = {
  DEFAULT_MODELS,
  llmComplete,
  quickHealthCheck,
  quickDSHealthCheck,
  llmNightlyExtract,
};
