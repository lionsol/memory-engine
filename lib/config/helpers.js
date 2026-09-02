import { getMemoryEngineConfig } from "./runtime.js";
import businessTime from "../business-time.cjs";

export function getSmartAddTimeZone(cfg = null, { explicitTimeZone, env = process.env } = {}) {
  const config = getMemoryEngineConfig(cfg);
  return businessTime.resolveBusinessTimeZone({
    explicitTimeZone,
    env,
    config,
  });
}
