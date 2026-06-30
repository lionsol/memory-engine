#!/usr/bin/env node

const { appendFileSync, mkdirSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, resolve } = require("node:path");
const { llmComplete } = require("../lib/checkpoint/llm");

const VALID_PROVIDERS = new Set(["siliconflow", "deepseek"]);
const DEFAULT_PROVIDER = "siliconflow";
const DEFAULT_CHARS = 22000;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_LABEL = "checkpoint-size-healthcheck";
const DEFAULT_LOG_PATH = resolve(homedir(), ".openclaw/workspace/memory/checkpoint-size-health-log.jsonl");
const DEFAULT_MODELS = {
  siliconflow: "deepseek-ai/DeepSeek-V3.2",
  deepseek: "deepseek-chat",
};

function parsePositiveInteger(name, rawValue) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function validateProvider(provider) {
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error(`provider must be one of: siliconflow, deepseek`);
  }
  return provider;
}

function parseArgs(argv = []) {
  const options = {
    provider: DEFAULT_PROVIDER,
    model: null,
    chars: DEFAULT_CHARS,
    maxTokens: DEFAULT_MAX_TOKENS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    targetDate: null,
    label: DEFAULT_LABEL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--provider") {
      options.provider = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--provider=")) {
      options.provider = arg.slice("--provider=".length);
      continue;
    }
    if (arg === "--model") {
      options.model = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      options.model = arg.slice("--model=".length);
      continue;
    }
    if (arg === "--chars") {
      options.chars = parsePositiveInteger("chars", argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--chars=")) {
      options.chars = parsePositiveInteger("chars", arg.slice("--chars=".length));
      continue;
    }
    if (arg === "--max-tokens") {
      options.maxTokens = parsePositiveInteger("maxTokens", argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-tokens=")) {
      options.maxTokens = parsePositiveInteger("maxTokens", arg.slice("--max-tokens=".length));
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger("timeoutMs", argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parsePositiveInteger("timeoutMs", arg.slice("--timeout-ms=".length));
      continue;
    }
    if (arg === "--target-date") {
      options.targetDate = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--target-date=")) {
      options.targetDate = arg.slice("--target-date=".length);
      continue;
    }
    if (arg === "--label") {
      options.label = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--label=")) {
      options.label = arg.slice("--label=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function resolveDefaults(options = {}, env = process.env) {
  const provider = validateProvider(String(options.provider || DEFAULT_PROVIDER).trim());
  const model = String(options.model || "").trim() || DEFAULT_MODELS[provider];
  const label = String(options.label || DEFAULT_LABEL).trim() || DEFAULT_LABEL;
  const targetDate = options.targetDate ? String(options.targetDate).trim() : null;
  const logPath = String(env.MEMORY_ENGINE_CHECKPOINT_SIZE_HEALTH_LOG || "").trim() || DEFAULT_LOG_PATH;

  return {
    provider,
    model,
    chars: parsePositiveInteger("chars", options.chars || DEFAULT_CHARS),
    maxTokens: parsePositiveInteger("maxTokens", options.maxTokens || DEFAULT_MAX_TOKENS),
    timeoutMs: parsePositiveInteger("timeoutMs", options.timeoutMs || DEFAULT_TIMEOUT_MS),
    targetDate,
    label,
    logPath,
  };
}

function buildSyntheticPrompt(chars, options = {}) {
  const minimumChars = parsePositiveInteger("chars", chars);
  const targetDate = options.targetDate || "synthetic-target-date";
  const label = options.label || DEFAULT_LABEL;
  const header = [
    "你是我的个人记忆整理助手。以下是今天收集的各种碎片化记录，",
    "包括对话摘要、项目状态、配置笔记、后续事项与系统事件。",
    "",
    "请按 nightly checkpoint 的结构输出 JSON，不要输出额外解释。",
    "目标：模拟 20k~45k chars 的 checkpoint 负载，不包含任何真实用户记忆。",
    "",
    "JSON 结构：",
    "{",
    '  "episode_summary": "不超过 300 字的总结",',
    '  "smart_memories": [{"type": "profile|preference|entity|event|case|pattern", "text": "具体内容"}],',
    '  "configs": [{"key": "配置名", "value": "值", "context": "来源说明"}]',
    "}",
    "",
    `healthcheckLabel: ${label}`,
    `targetDate: ${targetDate}`,
    "source: synthetic_checkpoint_healthcheck",
    "",
    "今天的内容：",
    "---",
  ].join("\n");

  const template = [
    "[synthetic entry {n}] 03:{mm} User: 讨论 nightly checkpoint 的吞吐、延迟、fallback 与 timeout 预算，强调这里只是 synthetic healthcheck，不引用真实 raw logs。",
    "[synthetic entry {n}] 03:{mm} Assistant: 总结 provider={provider} model={model} charsBudget={chars}，并提醒输出必须保持 JSON 结构稳定。",
    "[synthetic entry {n}] 03:{mm} Note: 配置 candidate checkpoint.timeoutMs=120000, checkpoint.maxTokens=8192, rawLogWindow=targetDate bounded；这些字段仅用于 synthetic 负载模拟。",
    "[synthetic entry {n}] 03:{mm} Project: 回顾 memory-engine 的 recall、episodes、smart-add、DB guard 与 cron wrapper，避免包含任何真实会话文本。",
    "[synthetic entry {n}] 03:{mm} Follow-up: 如果 provider 超时，记录 healthcheck 结果到 JSONL，并保持 responsePreview 截断到 120 字以内。",
  ].join("\n");

  let body = "";
  let index = 1;
  while ((header.length + body.length + "\n---\nJSON:".length) < minimumChars) {
    const minute = String(index % 60).padStart(2, "0");
    const chunk = template
      .replaceAll("{n}", String(index))
      .replaceAll("{mm}", minute)
      .replaceAll("{provider}", "synthetic")
      .replaceAll("{model}", "synthetic-checkpoint-model")
      .replaceAll("{chars}", String(minimumChars));
    body += `${chunk}\n\n`;
    index += 1;
  }

  return `${header}\n${body}---\nJSON:`;
}

function truncatePreview(value, maxLength = 120) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength);
}

function buildLogEntry({
  timestamp = new Date().toISOString(),
  label,
  targetDate = null,
  provider,
  model,
  chars,
  maxTokens,
  timeoutMs,
  ok,
  durationMs,
  message,
  error = null,
  responseText = "",
} = {}) {
  return {
    timestamp,
    label,
    targetDate,
    provider,
    model,
    chars,
    maxTokens,
    timeoutMs,
    ok: ok === true,
    durationMs,
    message,
    error,
    responsePreview: truncatePreview(responseText, 120),
  };
}

function appendJsonLine(logPath, entry) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(entry, null, 0)}\n`);
}

async function runHealthcheck(options, deps = {}) {
  const effective = resolveDefaults(options, deps.env || process.env);
  const prompt = buildSyntheticPrompt(effective.chars, {
    targetDate: effective.targetDate,
    label: effective.label,
  });
  const startedAt = Date.now();
  const call = deps.llmCompleteImpl || llmComplete;

  try {
    const responseText = await call(prompt, null, {
      provider: effective.provider,
      model: effective.model,
      maxTokens: effective.maxTokens,
      timeoutMs: effective.timeoutMs,
      temperature: 0.1,
    });
    const durationMs = Date.now() - startedAt;
    const entry = buildLogEntry({
      ...effective,
      ok: true,
      durationMs,
      message: "request completed",
      error: null,
      responseText,
    });
    (deps.appendJsonLineImpl || appendJsonLine)(effective.logPath, entry);
    return { ok: true, summary: effective, durationMs, entry };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const entry = buildLogEntry({
      ...effective,
      ok: false,
      durationMs,
      message: "request failed",
      error: error && error.message ? error.message : String(error),
      responseText: "",
    });
    (deps.appendJsonLineImpl || appendJsonLine)(effective.logPath, entry);
    return { ok: false, summary: effective, durationMs, entry, error };
  }
}

function formatSummaryLine(result) {
  const { summary, durationMs, ok, entry } = result;
  if (ok) {
    return `[checkpoint-size-health] provider=${summary.provider} model=${summary.model} chars=${summary.chars} ok=true durationMs=${durationMs}`;
  }
  return `[checkpoint-size-health] provider=${summary.provider} model=${summary.model} chars=${summary.chars} ok=false durationMs=${durationMs} error=${JSON.stringify(entry.error)}`;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const parsed = parseArgs(argv);
    const result = await runHealthcheck(parsed);
    console.log(formatSummaryLine(result));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(`[checkpoint-size-health] ok=false error=${JSON.stringify(message)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  VALID_PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_CHARS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LABEL,
  DEFAULT_LOG_PATH,
  DEFAULT_MODELS,
  parseArgs,
  resolveDefaults,
  buildSyntheticPrompt,
  truncatePreview,
  buildLogEntry,
  appendJsonLine,
  runHealthcheck,
  formatSummaryLine,
  main,
};
