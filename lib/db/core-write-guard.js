import coreWriteGuard from "./core-write-guard.cjs";

export const {
  assertNoCoreWrites,
  isWriteSql,
  patchWriteGuards,
  writeTargetIsCore,
} = coreWriteGuard;
