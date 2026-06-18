import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpointConfig = require("../lib/checkpoint/config.js");
const checkpointLlm = require("../lib/checkpoint/llm.js");

function withPatched(obj, key, value, fn) {
  const prev = obj[key];
  obj[key] = value;
  const finish = () => {
    obj[key] = prev;
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.finally(finish);
    }
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

function createRequestStub(handler) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.write = (chunk) => {
      req.body = String(chunk);
    };
    req.end = () => {
      handler({ url, options, callback, req });
    };
    req.setTimeout = (ms, onTimeout) => {
      req.timeoutMs = ms;
      req.onTimeout = onTimeout;
    };
    req.destroy = () => {
      req.destroyed = true;
    };
    return req;
  };
}

function emitJsonResponse(callback, payload, { statusCode = 200, headers = {} } = {}) {
  const res = new EventEmitter();
  res.headers = headers;
  res.statusCode = statusCode;
  callback(res);
  res.emit("data", JSON.stringify(payload));
  res.emit("end");
}

test("llmComplete rejects with provider-specific missing key error", async () => {
  await withPatched(checkpointConfig, "getDSKey", () => "", async () => {
    await assert.rejects(
      checkpointLlm.llmComplete("hi", null, { provider: "deepseek" }),
      /deepseek API key not found/,
    );
  });
});

test("llmComplete chooses Authorization, baseUrl, and default model by provider", async () => {
  await withPatched(checkpointConfig, "getSFKey", () => "sf-key", async () => {
    await withPatched(checkpointConfig, "getSFBaseUrl", () => "https://sf.example/v1", async () => {
      let observed = null;
      await withPatched(https, "request", createRequestStub(({ url, options, callback, req }) => {
        observed = {
          href: String(url),
          auth: options.headers.Authorization,
          body: JSON.parse(req.body),
        };
        emitJsonResponse(callback, { choices: [{ message: { content: "ok" } }] });
      }), async () => {
        const content = await checkpointLlm.llmComplete("hello", null, { provider: "siliconflow" });
        assert.equal(content, "ok");
      });

      assert.equal(observed.href, "https://sf.example/chat/completions");
      assert.equal(observed.auth, "Bearer sf-key");
      assert.equal(observed.body.model, "deepseek-ai/DeepSeek-V3.2");
    });
  });
});

test("llmComplete resolves choices[0].message.content", async () => {
  await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
    await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
      await withPatched(https, "request", createRequestStub(({ callback }) => {
        emitJsonResponse(callback, { choices: [{ message: { content: "parsed-content" } }] });
      }), async () => {
        const content = await checkpointLlm.llmComplete("hello", "system", { provider: "deepseek" });
        assert.equal(content, "parsed-content");
      });
    });
  });
});

test("llmComplete preserves non-2xx error-body behavior", async () => {
  await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
    await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
      await withPatched(https, "request", createRequestStub(({ callback }) => {
        emitJsonResponse(callback, { error: { message: "server said no" } }, { statusCode: 500 });
      }), async () => {
        await assert.rejects(
          checkpointLlm.llmComplete("hello", null, { provider: "deepseek" }),
          /server said no/,
        );
      });
    });
  });
});

test("llmNightlyExtract keeps DeepSeek primary then SiliconFlow fallback order", async () => {
  const calls = [];
  await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
    await withPatched(checkpointConfig, "getSFKey", () => "sf-key", async () => {
      await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
        await withPatched(checkpointConfig, "getSFBaseUrl", () => "https://sf.example/v1", async () => {
          await withPatched(https, "request", createRequestStub(({ url, callback }) => {
            calls.push(String(url));
            if (String(url).startsWith("https://ds.example")) {
              emitJsonResponse(callback, { error: { message: "ds failed" } });
              return;
            }
            emitJsonResponse(callback, {
              choices: [{ message: { content: "{\"episode_summary\":\"ok\",\"smart_memories\":[],\"configs\":[]}" } }],
            });
          }), async () => {
            const result = await checkpointLlm.llmNightlyExtract("body");
            assert.equal(result.episode_summary, "ok");
          });
        });
      });
    });
  });

  assert.deepEqual(calls, [
    "https://ds.example/chat/completions",
    "https://sf.example/chat/completions",
  ]);
});

test("llmNightlyExtract keeps timeout payload when DeepSeek fails and SiliconFlow has no key", async () => {
  await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
    await withPatched(checkpointConfig, "getSFKey", () => "", async () => {
      await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
        await withPatched(https, "request", createRequestStub(({ callback }) => {
          emitJsonResponse(callback, { error: { message: "ds failed" } });
        }), async () => {
          const result = await checkpointLlm.llmNightlyExtract("body");
          assert.deepEqual(result, {
            smart_memories: [],
            episode_summary: "",
            configs: [],
            error: "llm超时",
          });
        });
      });
    });
  });
});

test("llmNightlyExtract keeps empty payload when response contains no JSON", async () => {
  await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
    await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
      await withPatched(https, "request", createRequestStub(({ callback }) => {
        emitJsonResponse(callback, { choices: [{ message: { content: "plain text only" } }] });
      }), async () => {
        const result = await checkpointLlm.llmNightlyExtract("body");
        assert.deepEqual(result, {
          smart_memories: [],
          episode_summary: "",
          configs: [],
        });
      });
    });
  });
});
