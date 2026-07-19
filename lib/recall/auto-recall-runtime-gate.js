function normalize(v) {
  return String(v || "").trim().toLowerCase();
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

function normalizeAllowlist(value, fallback) {
  const values = Array.isArray(value) ? value : fallback;
  return values.map(normalize);
}

function pickOptional(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return { present: true, value: normalize(obj[key]) };
    }
  }
  return { present: false, value: null };
}

export function evaluateAutoRecallRuntimeGate({ event, ctx, config = {} }) {
  const agentId = normalize(
    pick(event, ["agent_id", "agentId", "agent", "agentName"]) ||
    pick(ctx, ["agent_id", "agentId", "agent", "agentName"])
  );

  const trigger = normalize(
    pick(ctx, ["trigger"]) ?? pick(event, ["trigger"])
  );
  const chatType = pickOptional(
    event,
    ["chat_type", "chatType", "chat"]
  );
  const contextChatType = chatType.present
    ? chatType
    : pickOptional(ctx, ["chat_type", "chatType", "chat"]);
  const messageRole = pickOptional(
    event,
    ["message_role", "messageRole", "role"]
  );
  const contextMessageRole = messageRole.present
    ? messageRole
    : pickOptional(ctx, ["message_role", "messageRole", "role"]);

  const allowAgents = normalizeAllowlist(
    config.agentAllowlist ?? config.agent_allowlist,
    ["edi"],
  );
  const allowTriggers = normalizeAllowlist(
    config.triggerAllowlist ?? config.trigger_allowlist,
    ["user"],
  );
  const allowChatTypes = normalizeAllowlist(
    config.chatTypeAllowlist ?? config.chat_type_allowlist,
    ["interactive_user_chat"],
  );
  const allowRoles = normalizeAllowlist(
    config.messageRoleAllowlist ?? config.message_role_allowlist,
    ["user"],
  );

  if (!agentId) {
    return { allowed: false, reason: "denied_missing_agent_id" };
  }

  if (!allowAgents.includes(agentId)) {
    return { allowed: false, reason: "denied_by_agent_allowlist", agentId };
  }

  if (!trigger) {
    return { allowed: false, reason: "denied_missing_trigger", agentId };
  }

  if (!allowTriggers.includes(trigger)) {
    return { allowed: false, reason: "denied_by_trigger_allowlist", agentId, trigger };
  }

  if (contextChatType.present && allowChatTypes.length && !allowChatTypes.includes(contextChatType.value)) {
    return {
      allowed: false,
      reason: "denied_by_chat_type_allowlist",
      agentId,
      trigger,
      chatType: contextChatType.value,
    };
  }

  if (contextMessageRole.present && allowRoles.length && !allowRoles.includes(contextMessageRole.value)) {
    return {
      allowed: false,
      reason: "denied_by_message_role_allowlist",
      agentId,
      trigger,
      messageRole: contextMessageRole.value,
    };
  }

  return {
    allowed: true,
    agentId,
    trigger,
    chatType: contextChatType.value,
    messageRole: contextMessageRole.value,
  };
}
