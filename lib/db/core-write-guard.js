import coreWriteGuard from "./core-write-guard.cjs";

export const {
  CORE_WRITE_PROHIBITED,
  createCoreWriteProhibitedError,
  denyCoreWriteCapability,
} = coreWriteGuard;
