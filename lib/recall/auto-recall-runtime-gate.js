function normalize(v) {
  return String(v || "").trim().toLowerCase();
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

export function evaluateAutoRecallRuntimeGate({ event, ctx, config = {} }) {
  const agentId = normalize(
    pick(event, ["agent_id", "agentId", "agent", "agentName"]) ||
    pick(ctx, ["agent_id", "agentId", "agent", "agentName"])
  );

  const chatType = normalize(
    pick(event, ["chat_type", "chatType", "chat"] )
  );

  const messageRole = normalize(
    pick(event, ["message_role", "messageRole", "role"])
  );

  const allowAgents = (config.agentAllowlist || config.agent_allowlist || ["edi"]).map(normalize);
  const allowChatTypes = (config.chatTypeAllowlist || config.chat_type_allowlist || ["interactive_user_chat"]).map(normalize);
  const allowRoles = (config.messageRoleAllowlist || config.message_role_allowlist || ["user"]).map(normalize);

  if (!agentId) {
    return { allowed: false, reason: "denied_missing_agent_id" };
  }

  if (!allowAgents.includes(agentId)) {
    return { allowed: false, reason: "denied_by_agent_allowlist", agentId };
  }

  if (allowChatTypes.length && !chatType) {
    return { allowed: false, reason: "denied_missing_chat_type" };
  }

  if (allowChatTypes.length && !allowChatTypes.includes(chatType)) {
    return { allowed: false, reason: "denied_by_chat_type_allowlist", chatType };
  }

  if (allowRoles.length && !messageRole) {
    return { allowed: false, reason: "denied_missing_message_role" };
  }

  if (allowRoles.length && !allowRoles.includes(messageRole)) {
    return { allowed: false, reason: "denied_by_message_role_allowlist", messageRole };
  }

  return { allowed: true, agentId, chatType, messageRole };
}
