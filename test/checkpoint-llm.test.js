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

function createLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      log: (...args) => entries.push({ level: "log", message: args.join(" ") }),
      warn: (...args) => entries.push({ level: "warn", message: args.join(" ") }),
      error: (...args) => entries.push({ level: "error", message: args.join(" ") }),
    },
  };
}

function withPatchedConsole(logger, fn) {
  return withPatched(console, "log", logger.log, () =>
    withPatched(console, "warn", logger.warn, () =>
      withPatched(console, "error", logger.error, fn)));
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

test("llmNightlyExtract prompt tells model to prefer later verified status", async () => {
  let observedPrompt = "";
  await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
    primaryProvider: "deepseek",
    fallbackProvider: "none",
    warnings: [],
  }), async () => {
    await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
      maxInputChars: 45000,
      maxTokens: 4096,
      timeoutMs: 120000,
      warnings: [],
    }), async () => {
    await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
      await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
        await withPatched(https, "request", createRequestStub(({ callback, req }) => {
          observedPrompt = JSON.parse(req.body).messages.at(-1).content;
          emitJsonResponse(callback, {
            choices: [{ message: { content: "{\"episode_summary\":\"ok\",\"smart_memories\":[],\"configs\":[]}" } }],
          });
        }), async () => {
          const result = await checkpointLlm.llmNightlyExtract("09:00 需修复\n10:00 已修复并验证");
          assert.equal(result.episode_summary, "ok");
        });
      });
    });
    });
  });

  assert.match(observedPrompt, /以时间顺序中更晚的验证结果、测试结果或用户确认作为当前状态/);
  assert.match(observedPrompt, /不要把较早的“待修复\/需修复”覆盖较晚的“已修复\/已验证”/);
});

test("llmNightlyExtract keeps default deepseek then siliconflow order", async () => {
  const calls = [];
  await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
    primaryProvider: "deepseek",
    fallbackProvider: "siliconflow",
    warnings: [],
  }), async () => {
    await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
      maxInputChars: 45000,
      maxTokens: 4096,
      timeoutMs: 120000,
      warnings: [],
    }), async () => {
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
    });
  });

  assert.deepEqual(calls, [
    "https://ds.example/chat/completions",
    "https://sf.example/chat/completions",
  ]);
});

test("llmNightlyExtract does not call fallback when primary succeeds", async () => {
  const calls = [];
  await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
    primaryProvider: "deepseek",
    fallbackProvider: "siliconflow",
    warnings: [],
  }), async () => {
    await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
      maxInputChars: 45000,
      maxTokens: 4096,
      timeoutMs: 120000,
      warnings: [],
    }), async () => {
    await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
      await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
        await withPatched(https, "request", createRequestStub(({ url, callback }) => {
          calls.push(String(url));
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

  assert.deepEqual(calls, ["https://ds.example/chat/completions"]);
});

test("llmNightlyExtract returns timeout payload when fallback is none", async () => {
  const calls = [];
  const { entries, logger } = createLogger();
  await withPatchedConsole(logger, async () => {
    await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
      primaryProvider: "deepseek",
      fallbackProvider: "none",
      warnings: [],
    }), async () => {
      await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
        maxInputChars: 45000,
        maxTokens: 4096,
        timeoutMs: 120000,
        warnings: [],
      }), async () => {
      await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
        await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
          await withPatched(https, "request", createRequestStub(({ url, callback }) => {
            calls.push(String(url));
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
  });

  assert.deepEqual(calls, ["https://ds.example/chat/completions"]);
  assert.ok(entries.some((entry) => entry.message.includes("LLM fallback disabled primary=deepseek fallback=none")));
});

test("llmNightlyExtract only attempts once when primary and fallback are the same", async () => {
  const calls = [];
  const { entries, logger } = createLogger();
  await withPatchedConsole(logger, async () => {
    await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
      primaryProvider: "deepseek",
      fallbackProvider: "deepseek",
      warnings: [],
    }), async () => {
      await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
        maxInputChars: 45000,
        maxTokens: 4096,
        timeoutMs: 120000,
        warnings: [],
      }), async () => {
      await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
        await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
          await withPatched(https, "request", createRequestStub(({ url, callback }) => {
            calls.push(String(url));
            emitJsonResponse(callback, { error: { message: "ds failed" } });
          }), async () => {
            const result = await checkpointLlm.llmNightlyExtract("body");
            assert.equal(result.error, "llm超时");
          });
        });
      });
      });
    });
  });

  assert.deepEqual(calls, ["https://ds.example/chat/completions"]);
  assert.ok(entries.some((entry) => entry.message.includes("LLM fallback skipped primary=deepseek fallback=deepseek reason=same-provider")));
});

test("llmNightlyExtract returns timeout payload when fallback also fails", async () => {
  await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
    primaryProvider: "deepseek",
    fallbackProvider: "siliconflow",
    warnings: [],
  }), async () => {
    await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
      maxInputChars: 45000,
      maxTokens: 4096,
      timeoutMs: 120000,
      warnings: [],
    }), async () => {
    await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
      await withPatched(checkpointConfig, "getSFKey", () => "sf-key", async () => {
        await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
          await withPatched(checkpointConfig, "getSFBaseUrl", () => "https://sf.example/v1", async () => {
            await withPatched(https, "request", createRequestStub(({ url, callback }) => {
              if (String(url).startsWith("https://ds.example")) {
                emitJsonResponse(callback, { error: { message: "ds failed" } });
                return;
              }
              emitJsonResponse(callback, { error: { message: "sf failed" } });
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
    });
  });
});

test("llmNightlyExtract keeps empty payload when response contains no JSON", async () => {
  const { entries, logger } = createLogger();
  await withPatchedConsole(logger, async () => {
    await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
      primaryProvider: "deepseek",
      fallbackProvider: "siliconflow",
      warnings: [],
    }), async () => {
      await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
        maxInputChars: 45000,
        maxTokens: 4096,
        timeoutMs: 120000,
        warnings: [],
      }), async () => {
      await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
        await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
          await withPatched(https, "request", createRequestStub(({ callback }) => {
            emitJsonResponse(callback, { choices: [{ message: { content: "plain text only with sensitive-looking content" } }] });
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
    });
  });

  const warnEntry = entries.find((entry) => entry.message.includes("LLM response did not contain JSON responseChars="));
  assert.ok(warnEntry);
  assert.doesNotMatch(warnEntry.message, /plain text only/);
  assert.doesNotMatch(warnEntry.message, /sensitive-looking content/);
});

test("llmNightlyExtract logs attempt failed and succeeded entries with provider and duration", async () => {
  const { entries, logger } = createLogger();
  await withPatchedConsole(logger, async () => {
    await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
      primaryProvider: "deepseek",
      fallbackProvider: "siliconflow",
      warnings: [],
    }), async () => {
      await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
        maxInputChars: 45000,
        maxTokens: 4096,
        timeoutMs: 120000,
        warnings: [],
      }), async () => {
      await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
        await withPatched(checkpointConfig, "getSFKey", () => "sf-key", async () => {
          await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
            await withPatched(checkpointConfig, "getSFBaseUrl", () => "https://sf.example/v1", async () => {
              await withPatched(https, "request", createRequestStub(({ url, callback }) => {
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
      });
    });
  });

  assert.ok(entries.some((entry) => entry.message.includes("LLM attempt provider=deepseek model=deepseek-chat chars=4 maxTokens=4096 timeoutMs=120000")));
  assert.ok(entries.some((entry) => entry.message.includes("LLM failed provider=deepseek model=deepseek-chat durationMs=") && entry.message.includes("error=ds failed")));
  assert.ok(entries.some((entry) => entry.message.includes("LLM attempt provider=siliconflow model=deepseek-ai/DeepSeek-V3.2 chars=4 maxTokens=4096 timeoutMs=120000")));
  assert.ok(entries.some((entry) => entry.message.includes("LLM succeeded provider=siliconflow durationMs=")));
  assert.ok(entries.some((entry) => entry.message.includes("LLM fallback succeeded provider=siliconflow durationMs=")));
  assert.ok(entries.every((entry) => !entry.message.includes("Bearer ")));
  assert.ok(entries.every((entry) => !entry.message.includes("plain text only")));
  assert.ok(entries.every((entry) => !entry.message.includes("sensitive-looking content")));
});

test("llmNightlyExtract uses default request budget values", async () => {
  let observedBody = null;
  let observedTimeoutMs = null;
  await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
    primaryProvider: "deepseek",
    fallbackProvider: "siliconflow",
    warnings: [],
  }), async () => {
    await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
      maxInputChars: 45000,
      maxTokens: 4096,
      timeoutMs: 120000,
      warnings: [],
    }), async () => {
      await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
        await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
          await withPatched(https, "request", createRequestStub(({ callback, req }) => {
            observedBody = JSON.parse(req.body);
            observedTimeoutMs = req.timeoutMs;
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

  assert.equal(observedBody.max_tokens, 4096);
  assert.equal(observedTimeoutMs, 120000);
});

test("llmNightlyExtract uses overridden request budget values", async () => {
  let observedBody = null;
  let observedTimeoutMs = null;
  const { entries, logger } = createLogger();
  await withPatchedConsole(logger, async () => {
    await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
      primaryProvider: "deepseek",
      fallbackProvider: "siliconflow",
      warnings: [],
    }), async () => {
      await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
        maxInputChars: 30000,
        maxTokens: 2048,
        timeoutMs: 90000,
        warnings: [],
      }), async () => {
        await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
          await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
            await withPatched(https, "request", createRequestStub(({ callback, req }) => {
              observedBody = JSON.parse(req.body);
              observedTimeoutMs = req.timeoutMs;
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
  });

  assert.equal(observedBody.max_tokens, 2048);
  assert.equal(observedTimeoutMs, 90000);
  assert.ok(entries.some((entry) => entry.message.includes("maxTokens=2048 timeoutMs=90000")));
});

test("llmNightlyExtract trims input to configured maxInputChars", async () => {
  let observedPrompt = "";
  const longInput = "x".repeat(50000);
  await withPatched(checkpointConfig, "resolveCheckpointProviders", () => ({
    primaryProvider: "deepseek",
    fallbackProvider: "siliconflow",
    warnings: [],
  }), async () => {
    await withPatched(checkpointConfig, "resolveCheckpointLlmRequestConfig", () => ({
      maxInputChars: 30000,
      maxTokens: 4096,
      timeoutMs: 120000,
      warnings: [],
    }), async () => {
      await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
        await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
          await withPatched(https, "request", createRequestStub(({ callback, req }) => {
            observedPrompt = JSON.parse(req.body).messages[0].content;
            emitJsonResponse(callback, {
              choices: [{ message: { content: "{\"episode_summary\":\"ok\",\"smart_memories\":[],\"configs\":[]}" } }],
            });
          }), async () => {
            const result = await checkpointLlm.llmNightlyExtract(longInput);
            assert.equal(result.episode_summary, "ok");
          });
        });
      });
    });
  });

  assert.ok(observedPrompt.endsWith("x".repeat(30000)));
  assert.equal(observedPrompt.includes("x".repeat(30001)), false);
});
