import coreWriteGuard from "./core-write-guard.cjs";

export const {
  assertNoCoreWrites,
  CORE_WRITE_PROHIBITED,
  createCoreWriteProhibitedError,
  denyCoreWriteCapability,
  isWriteSql,
  patchWriteGuards,
  writeTargetIsCore,
} = coreWriteGuard;
