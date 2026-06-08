import lancedb from "@lancedb/lancedb";

export const DEFAULT_LANCEDB_READY_TIMEOUT_MS = 400;

export function createLanceDbRuntime({
  dbPath,
  disabled = process.env.MEMORY_ENGINE_DISABLE_LANCEDB === "1",
  readyTimeoutMs = DEFAULT_LANCEDB_READY_TIMEOUT_MS,
  logger = console,
} = {}) {
  let lancedbTable = null;
  let lancedbReadyPromise = null;
  const lancedbReadyState = {
    state: disabled ? "disabled" : "pending",
    error: null,
  };

  async function initLanceDB() {
    if (lancedbReadyState.state === "disabled") {
      lancedbTable = null;
      return false;
    }
    lancedbReadyState.state = "pending";
    lancedbReadyState.error = null;
    try {
      const db = await lancedb.connect(dbPath);
      const tableNames = await db.tableNames();
      if (tableNames.includes("chunks")) {
        lancedbTable = await db.openTable("chunks");
      } else {
        lancedbTable = await db.createTable("chunks", [
          { id: crypto.randomUUID(), text: "", vector: new Array(2560).fill(0), timestamp: Date.now() },
        ]);
      }
      lancedbReadyState.state = "ready";
      logger.log("[memory-engine] LanceDB initialized at", dbPath);
      return true;
    } catch (e) {
      lancedbReadyState.state = "failed";
      lancedbReadyState.error = e?.message ? String(e.message) : String(e);
      lancedbTable = null;
      logger.warn("[memory-engine] LanceDB init skipped:", e.message);
      return false;
    }
  }

  function ensureLanceDBReady() {
    if (lancedbReadyState.state === "disabled") return Promise.resolve(false);
    if (!lancedbReadyPromise) {
      lancedbReadyPromise = initLanceDB()
        .catch(() => false)
        .finally(() => {
          // Keep the settled promise for later callers.
        });
    }
    return lancedbReadyPromise;
  }

  async function getLanceDBRuntime({ timeoutMs = readyTimeoutMs } = {}) {
    if (lancedbReadyState.state === "disabled") {
      return { table: null, readyState: "disabled", initError: null, timedOut: false };
    }

    let timedOut = false;
    const readyPromise = ensureLanceDBReady();
    if (lancedbReadyState.state === "pending") {
      await Promise.race([
        readyPromise,
        new Promise(resolve => setTimeout(() => {
          timedOut = true;
          resolve();
        }, Math.max(0, Number(timeoutMs) || 0))),
      ]);
    } else {
      await readyPromise;
    }

    return {
      table: lancedbReadyState.state === "ready" ? lancedbTable : null,
      readyState: lancedbReadyState.state,
      initError: lancedbReadyState.error || null,
      timedOut,
    };
  }

  return {
    ensureLanceDBReady,
    getLanceDBRuntime,
    getLancedbTable: () => lancedbTable,
    readyState: lancedbReadyState,
  };
}
