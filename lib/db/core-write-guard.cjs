const CORE_WRITE_PROHIBITED = "CORE_WRITE_PROHIBITED";

function createCoreWriteProhibitedError(message = CORE_WRITE_PROHIBITED) {
  const error = new Error(String(message));
  error.code = CORE_WRITE_PROHIBITED;
  return error;
}

function denyCoreWriteCapability() {
  throw createCoreWriteProhibitedError();
}

module.exports = {
  CORE_WRITE_PROHIBITED,
  createCoreWriteProhibitedError,
  denyCoreWriteCapability,
};
