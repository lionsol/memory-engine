# Retrieval / Answering Policy

## Date-Specific Recap

适用问题类型：

- `昨天做了什么`
- `某天做了什么`
- `上周做了什么`
- 其他显式按日期、按自然日、按时间窗口追问“做了什么/讨论了什么/发生了什么”的 recap 问题

这类问题属于 `date-specific recap`。回答时必须区分原始证据与派生摘要，不能把 generated summary 当成同等级事实源。

### 证据优先级

1. `raw session / raw_log`
   - 这是 date-specific recap 的 primary source。
   - 包括 targetDate 范围内的原始对话、原始 session transcript、targetDate bounded DB raw_log。
2. `manual / agent_smart_add`
   - 这是 secondary source。
   - 只能作为补充说明、线索交叉验证或帮助定位原始对话。
3. `episode`
   - 这是 tertiary summary。
   - 只能作为摘要线索，不是日期事实的最高依据。

### 冲突处理

- 如果 `episode` 与 `raw_log` 冲突，以 `raw_log` 为准。
- 如果 `manual` / `agent_smart_add` 与 `raw_log` 冲突，也以 `raw_log` 为准，除非能够明确证明 raw_log 缺失或截断。

### Legacy-Risk 限制

- `legacy-risk episode` 只能作为线索，不能作为最终事实依据。
- 尤其是曾经通过 legacy `session-checkpoint` 路径生成、且存在跨日污染风险的 episode，不得单独支撑“某天做了什么”的最终回答。

### 明确排除的非事实源

以下路径或内容类型不参与 date-specific recap 的事实回答：

- `memory/generated-smart-add/`
- `memory/quarantined-*`
- `memory/legacy-daily-mirrors/`

这些内容可以用于审计、排查、人工复核，但不能作为最终事实回答的证据。

### 禁止的回答方式

对于 date-specific recap，禁止：

- 只根据 `episode` 单独作答
- 只根据 `legacy-risk episode` 单独作答
- 只根据 `generated-smart-add`、`quarantined`、`legacy mirror` 作答
- 在缺少 `raw session / raw_log` 时，把 episode 文案重述成确定事实而不标注不确定性

### 最低回答要求

如果 `raw session / raw_log` 可用：

- 应优先基于 raw 证据组织回答
- `episode` 只可用于补充概括，不可覆盖 raw 事实

如果 `raw session / raw_log` 不足：

- 必须明确说明证据不足
- 可以把 `manual / agent_smart_add` 或 `episode` 作为线索描述
- 但不能把它们包装成确定的 date-specific factual recap
