const LEGACY_ATTACHED_CORE_RETIRED = "LEGACY_ATTACHED_CORE_RETIRED";

function createLegacyAttachedCoreRetiredError() {
  const error = new Error(LEGACY_ATTACHED_CORE_RETIRED);
  error.code = LEGACY_ATTACHED_CORE_RETIRED;
  return error;
}

function denyLegacyAttachedCore() {
  throw createLegacyAttachedCoreRetiredError();
}

module.exports = {
  LEGACY_ATTACHED_CORE_RETIRED,
  createLegacyAttachedCoreRetiredError,
  denyLegacyAttachedCore,
};
