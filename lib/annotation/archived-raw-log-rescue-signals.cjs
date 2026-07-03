'use strict';

const DEFAULT_RESCUE_KEYWORDS = Object.freeze(['决定', '结论', '修复', '偏好', '待办', 'memory-engine', 'OpenClaw']);

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function includesAny(value, patterns) {
  return patterns.some(pattern => pattern.test(value));
}

function inferBaseRescueSignals(text, keywords = DEFAULT_RESCUE_KEYWORDS) {
  const value = normalizeText(text);
  const lower = value.toLowerCase();
  const hits = keywords.filter(keyword => lower.includes(String(keyword).toLowerCase()));
  const signals = hits.map(hit => `keyword:${hit}`);

  if (/\b(memory-engine|Memory Engine)\b/i.test(value)) signals.push('project:memory-engine');
  if (/\bOpenClaw\b/i.test(value)) signals.push('project:openclaw');
  if (/决定|结论|最终选择|定下来|确认了/.test(value)) signals.push('decision_signal');
  if (/修复|实现|新增|完成|通过|测试/.test(value)) signals.push('project_progress_signal');
  if (/偏好|习惯|以后|下次|不要|需要/.test(value)) signals.push('preference_signal');
  if (/待办|后续|TODO|下一步/.test(value)) signals.push('todo_signal');
  if (/```|\b(stdout|stderr|exitCode|command ok|sqlite|SQLITE)\b/i.test(value)) signals.push('tool_output_or_code_signal');

  return signals;
}

function inferRefinedRescueSignals(text) {
  const value = normalizeText(text);
  const signals = [];

  const transientCronPrompt = includesAny(value, [
    /^\s*\[cron:[^\]]+\]/i,
    /运行脚本:/,
    /Reference UTC:/,
    /Current time:/,
  ]);
  if (transientCronPrompt) signals.push('transient_cron_prompt_signal');

  if (includesAny(value, [
    /硅基流动健康检查/,
    /healthcheck\.py/i,
    /health check/i,
    /健康检查脚本/,
  ])) signals.push('healthcheck_prompt_signal');

  if (includesAny(value, [
    /值班Telegram提醒/,
    /duty-check\.sh/i,
    /Sol值班/,
  ])) signals.push('duty_reminder_signal');

  if (includesAny(value, [
    /previous turn was interrupted/i,
    /gateway restart/i,
    /被中断/,
    /Gateway .*重启/,
  ])) signals.push('gateway_interruption_signal');

  if (includesAny(value, [
    /完整验证报告/,
    /验证结果/,
    /验证通过/,
    /全部通过/,
    /最终状态/,
    /状态更新/,
    /doctor/i,
    /plugins inspect/i,
    /openclaw plugins inspect/i,
    /openclaw doctor/i,
    /✅/,
  ])) signals.push('runtime_verification_signal');

  if (includesAny(value, [
    /node --test/,
    /tests?,\s*\d+\s*pass/i,
    /\d+\s+tests?,\s*\d+\s+pass/i,
    /#\s*pass\s+\d+/i,
    /0\s*fail/i,
    /全量测试/,
    /测试数解释/,
    /测试结果/,
  ])) signals.push('test_result_summary_signal');

  if (includesAny(value, [
    /四层架构/,
    /架构/,
    /索引层/,
    /工具层/,
    /Dreaming 系统/,
    /memory-core\s*(是|没有|注册|引用)/i,
    /本质区别/,
    /manifest/,
    /工具注册/,
    /slots\.memory/,
  ])) signals.push('architecture_explanation_signal');

  if (includesAny(value, [
    /MEMORY\.md/,
    /更新 MEMORY\.md/,
    /daily notes/i,
    /语义标签/,
    /\[决策\].*\[教训\].*\[偏好\].*\[待办\]/,
    /Mandatory recall step/i,
    /引用强化/,
    /memory_search/,
    /memory_get/,
    /memory_engine_get/,
    /confidence_mode/,
    /置信度/,
    /召回/,
  ])) signals.push('memory_policy_signal');

  if (includesAny(value, [
    /HEARTBEAT\.md/i,
    /OpenClaw heartbeat/i,
    /target:\s*["']last["']/i,
    /every:\s*["']0m["']/i,
    /heartbeat:\s*disabled/i,
    /config change detected/i,
    /hot reload applied/i,
    /心跳.*(关闭|配置|生效)/,
  ])) signals.push('openclaw_config_signal');

  if (includesAny(value, [
    /bin\/session-checkpoint\.js/,
    /lib\/checkpoint\//,
    /session-checkpoint/i,
    /config\/key 解析/,
    /getSFKey\(\)/,
    /getDSKey\(\)/,
    /getSFBaseUrl\(\)/,
    /getDSBaseUrl\(\)/,
    /符号全在/,
    /消费点/,
  ])) {
    signals.push('project:memory-engine');
    signals.push('memory_engine_code_audit_signal');
  }

  const engineeringPositive = signals.some(signal => [
    'runtime_verification_signal',
    'test_result_summary_signal',
    'architecture_explanation_signal',
    'memory_policy_signal',
    'openclaw_config_signal',
    'memory_engine_code_audit_signal',
  ].includes(signal));
  if (engineeringPositive) signals.push('engineering_evidence_signal');

  const transientNegative = signals.some(signal => [
    'transient_cron_prompt_signal',
    'healthcheck_prompt_signal',
    'duty_reminder_signal',
    'gateway_interruption_signal',
  ].includes(signal));
  if (transientNegative) signals.push('transient_runtime_noise_signal');

  if (
    /```|\b(stdout|stderr|exitCode|command ok|sqlite|SQLITE)\b/i.test(value) &&
    !engineeringPositive
  ) {
    signals.push('pure_tool_output_signal');
  }

  return unique(signals);
}

function inferArchivedRawLogRescueSignals(text, options = {}) {
  const keywords = Array.isArray(options.keywords) && options.keywords.length
    ? options.keywords
    : DEFAULT_RESCUE_KEYWORDS;
  return unique([
    ...inferBaseRescueSignals(text, keywords),
    ...inferRefinedRescueSignals(text),
  ]);
}

function describeSignalPolarity(signals = []) {
  const set = new Set(signals);
  return {
    positive_evidence: [
      'engineering_evidence_signal',
      'runtime_verification_signal',
      'test_result_summary_signal',
      'architecture_explanation_signal',
      'memory_policy_signal',
      'openclaw_config_signal',
      'memory_engine_code_audit_signal',
    ].filter(signal => set.has(signal)),
    negative_evidence: [
      'transient_runtime_noise_signal',
      'transient_cron_prompt_signal',
      'healthcheck_prompt_signal',
      'duty_reminder_signal',
      'gateway_interruption_signal',
      'pure_tool_output_signal',
    ].filter(signal => set.has(signal)),
  };
}

module.exports = {
  DEFAULT_RESCUE_KEYWORDS,
  describeSignalPolarity,
  inferArchivedRawLogRescueSignals,
  inferBaseRescueSignals,
  inferRefinedRescueSignals,
};
