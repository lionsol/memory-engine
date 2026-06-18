const https = require("node:https");
const zlib = require("node:zlib");
const checkpointConfig = require("./config");

function llmComplete(prompt, systemPrompt, options = {}) {
  const { provider = "siliconflow" } = options;
  const keyFn = provider === "deepseek" ? checkpointConfig.getDSKey : checkpointConfig.getSFKey;
  const baseFn = provider === "deepseek" ? checkpointConfig.getDSBaseUrl : checkpointConfig.getSFBaseUrl;
  const defaultModel = provider === "deepseek" ? "deepseek-chat" : "deepseek-ai/DeepSeek-V3.2";

  return new Promise((resolve, reject) => {
    const apiKey = keyFn();
    if (!apiKey) return reject(new Error(`${provider} API key not found`));

    const baseUrl = baseFn();
    const url = new URL("/chat/completions", baseUrl);
    const model = options.model || defaultModel;
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.maxTokens ?? 1024;
    const requestTimeoutMs = options.timeoutMs ?? 45000;

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
        const isGzip = res.headers["content-encoding"] === "gzip";
        const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
        stream.on("data", (chunk) => (data += chunk));
        stream.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            resolve(parsed.choices?.[0]?.message?.content || "");
          } catch (e) {
            reject(new Error(`Parse failed: ${e.message}\nRaw: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.setTimeout(requestTimeoutMs, () => {
      req.destroy();
      reject(new Error(`LLM request timed out after ${requestTimeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const NIGHTLY_PROMPT = `你是我的个人记忆整理助手。以下是今天收集的各种碎片化记录，
包括对话摘要、项目状态、梦境记录、配置笔记等。

请按以下结构输出今日摘要，并包含结构化记忆和配置信息。
注意：条目按时间顺序排列，请涵盖全天各时段的内容，确保最近新增的条目也被纳入摘要。
只输出 JSON，不要其他文字。

JSON 结构：
{
  "episode_summary": "一段话（不超过 300 字），按以下结构组织：\n1. 核心对话与决策：今天讨论了什么重要话题，做了什么决定\n2. 项目进展：哪些项目有更新或状态变化\n3. 个人记录：梦境、想法、笔记等零散内容\n4. 待办/后续：从今天内容中浮现出的后续事项",
  "smart_memories": [
    {"type": "profile|preference|entity|event|case|pattern", "text": "具体内容"}
  ],
  "configs": [
    {"key": "配置名", "value": "值", "context": "来源说明"}
  ]
}

注意事项：
- 配置笔记和推荐方案不应被描述为"讨论了..."
- 如果某类信息不存在，返回空数组/空字符串

今天的内容：
---
{chunks_text}
---

JSON:`;

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

async function llmNightlyExtract(combinedText) {
  const trimmed = combinedText.substring(0, 45000);

  console.log(`[checkpoint] Sending ${trimmed.length} chars to LLM (DeepSeek V4 Flash, 120s timeout)...`);
  let result;
  try {
    result = await llmComplete(NIGHTLY_PROMPT + trimmed, null, {
      provider: "deepseek",
      model: "deepseek-chat",
      temperature: 0.1,
      maxTokens: 8192,
      timeoutMs: 120000,
    });
  } catch (e) {
    console.warn(`[checkpoint] DeepSeek V4 Flash failed: ${e.message}`);

    if (!checkpointConfig.getSFKey()) {
      console.warn("[checkpoint] SiliconFlow API key not configured — skipping fallback");
      return { smart_memories: [], episode_summary: "", configs: [], error: "llm超时" };
    }

    console.log("[checkpoint] Falling back to SiliconFlow (DeepSeek-V3.2, 120s timeout)...");
    try {
      result = await llmComplete(NIGHTLY_PROMPT + trimmed, null, {
        temperature: 0.1,
        maxTokens: 8192,
        timeoutMs: 120000,
      });
      console.log("[checkpoint] Fallback succeeded via SiliconFlow");
    } catch (e2) {
      console.error(`[checkpoint] Fallback also failed: ${e2.message}`);
      return { smart_memories: [], episode_summary: "", configs: [], error: "llm超时" };
    }
  }

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[checkpoint] LLM response didn't contain JSON:", result.slice(0, 300));
    return { smart_memories: [], episode_summary: "", configs: [] };
  }

  return JSON.parse(jsonMatch[0]);
}

module.exports = {
  llmComplete,
  quickHealthCheck,
  quickDSHealthCheck,
  llmNightlyExtract,
};
