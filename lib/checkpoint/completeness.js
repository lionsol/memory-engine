function getAllNonEmptyLogs(rawLogs) {
  return (rawLogs || []).filter((l) => l && l.text && l.text.trim());
}

function getConversationLogs(rawLogs) {
  return (rawLogs || []).filter((l) => l && l.text && l.text.trim() && l.source === "conversation");
}

function buildCombinedText(allLogs) {
  return (allLogs || [])
    .map((l) => l.text.trim())
    .join("\n---\n");
}

function assessCheckpointCompleteness(rawLogs) {
  const sourceLogs = Array.isArray(rawLogs) ? rawLogs : [];
  const allLogs = getAllNonEmptyLogs(sourceLogs);
  const conversationLogs = getConversationLogs(sourceLogs);
  const combinedText = buildCombinedText(allLogs);
  const rawCount = sourceLogs.length;
  const allCount = allLogs.length;
  const conversationCount = conversationLogs.length;
  const noteCount = allCount - conversationCount;

  if (rawCount === 0) {
    return {
      status: "no_raw_logs",
      shouldCallLlm: false,
      rawCount,
      allCount,
      conversationCount,
      noteCount,
      allLogs,
      conversationLogs,
      combinedText,
    };
  }

  if (!combinedText.trim()) {
    return {
      status: "all_logs_empty",
      shouldCallLlm: false,
      rawCount,
      allCount,
      conversationCount,
      noteCount,
      allLogs,
      conversationLogs,
      combinedText,
    };
  }

  if (conversationCount === 0) {
    return {
      status: "no_conversation",
      shouldCallLlm: false,
      rawCount,
      allCount,
      conversationCount,
      noteCount,
      allLogs,
      conversationLogs,
      combinedText,
    };
  }

  return {
    status: "ok",
    shouldCallLlm: true,
    rawCount,
    allCount,
    conversationCount,
    noteCount,
    allLogs,
    conversationLogs,
    combinedText,
  };
}

module.exports = {
  getAllNonEmptyLogs,
  getConversationLogs,
  buildCombinedText,
  assessCheckpointCompleteness,
};
