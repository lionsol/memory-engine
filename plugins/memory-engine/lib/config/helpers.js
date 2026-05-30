import { getMemoryEngineConfig } from "./runtime.js";

export function getSmartAddTimeZone(cfg = null) {
  const config = getMemoryEngineConfig(cfg);
  return process.env.MEMORY_ENGINE_TIME_ZONE || config.timezone.business;
}
