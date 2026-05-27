export async function detectOpenClawRuntime() {
  try {
    const runtimeModule = await import("openclaw/plugin-sdk/memory-core-engine-runtime");
    return {
      available: true,
      reason: null,
      module: runtimeModule,
    };
  } catch (error) {
    const reason = `skip: openclaw runtime unavailable (${String(error?.code || error?.message || error)})`;
    console.warn(`[test skip] ${reason}`);
    return {
      available: false,
      reason,
      module: null,
    };
  }
}

export async function hasOpenClawRuntime() {
  const status = await detectOpenClawRuntime();
  return status.available;
}
