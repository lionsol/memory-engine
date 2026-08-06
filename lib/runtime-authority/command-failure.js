class CommandExecutionError extends Error {
  constructor({ operationId, exitCode = null, stdout = "", stderr = "", message = null, cause = null } = {}) {
    const operation = typeof operationId === "string" && operationId ? operationId : "unknown";
    const code = Number.isInteger(exitCode) ? exitCode : null;
    const errorMessage = message || `${operation} failed:${code}:${String(stderr || "")}`;
    super(errorMessage);
    this.name = "CommandExecutionError";
    this.commandFailure = Object.freeze({
      operation_id: operation,
      exit_code: code,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
    });
    if (cause) this.cause = cause;
  }
}

function commandFailureDetails(error) {
  const details = error && typeof error === "object" ? error.commandFailure : null;
  if (!details || typeof details !== "object") return null;
  return {
    operation_id: typeof details.operation_id === "string" ? details.operation_id : null,
    exit_code: Number.isInteger(details.exit_code) ? details.exit_code : null,
    stdout: String(details.stdout || ""),
    stderr: String(details.stderr || ""),
  };
}

module.exports = { CommandExecutionError, commandFailureDetails };
