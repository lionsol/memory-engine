# P2 调参与观测指南

## 当前状态

已完成：

* P1-1 Config Centralization
* P1-2 Retrieval Diversity
* P1-3 Reinforcement Concentration
* P1-4 Recall Miss After Response

Console 已具备：

* Recall Diversity
* Recall Concentration
* Recall Miss
* Recall Trace
* Telemetry

memory-engine 已进入：

观测驱动阶段（Observation Driven Phase）

---

# P2 总目标

不要继续增加新功能。

先观察：

* Recall 是否有效
* Recall 是否稳定
* Recall 是否可解释

持续观察：

2~4 周

再决定是否继续改算法。

---

# 核心观测指标

## 1. Retrieval Diversity

回答：

> 召回是否来自足够多的记忆来源？

重点观察：

normalized_entropy

top1_share

distinct_count

---

### 理想区间

normalized_entropy

```text
0.4 ~ 0.8
```

说明：

既有聚焦

又有多样性

---

### 风险信号

过低：

```text
< 0.2
```

说明：

Recall 过于集中

总是同几个 category

---

### 调参方向

增加：

* vectorTopK
* topK

降低：

* recencyBoost
* categoryBoost

---

## 2. Reinforcement Concentration

回答：

> 是否总是同一批记忆在被反复召回？

重点观察：

top10_share

HHI

---

### 理想区间

HHI

```text
0.05 ~ 0.20
```

---

### 风险信号

HHI

```text
> 0.40
```

说明：

出现记忆垄断

少量记忆霸占 Recall

---

### 调参方向

降低：

confidenceBoost

降低：

externalBoost

降低：

recencyBoost

---

### 观察对象

Top Memories

重点看：

```text
memory_id
path
count
```

是否长期固定。

---

## 3. Recall Miss After Response

回答：

> 明明存在相关记忆，为什么没想起来？

重点观察：

miss_rate

---

### 理想区间

```text
0.10 ~ 0.40
```

---

### 风险信号

过低：

```text
< 0.05
```

说明：

Gate 太宽松

几乎全部注入

Prompt 污染风险增加

---

### 风险信号

过高：

```text
> 0.70
```

说明：

Gate 太保守

Recall 白做

---

### 调参方向

观察：

candidate_count

candidate_count_after_gate

injected_count

---

如果：

```text
candidate 多
injected 少
```

说明：

Gate 过严

---

如果：

```text
candidate 多
injected 多
```

说明：

Prompt 可能膨胀

---

# 推荐调参顺序

永远只调一个参数。

不要同时改多个。

---

第一优先级

MIN_CONFIDENCE

---

观察：

Recall Miss

HHI

Diversity

连续 3~7 天

---

第二优先级

vectorTopK

---

观察：

Diversity

Recall Miss

---

第三优先级

recencyBoost

---

观察：

HHI

top10_share

---

第四优先级

categoryBoost

---

观察：

Diversity

---

最后才动

RRF

排序公式

Gate 逻辑

---

# 建议建立周报

每周记录：

```text
Week

Retrieval Diversity
normalized_entropy

Reinforcement Concentration
HHI

Recall Miss
miss_rate

Top Memories
Top Categories
```

形成：

memory/stats-history.md

长期趋势。

---

# 暂缓事项

先不要做：

* 新 Recall 算法
* 新 Rerank 算法
* 新向量库
* 新 Embedding 模型
* KG 大改

原因：

目前缺的不是算法。

而是真实数据。

---

# P2 成功标准

连续两周观察后：

HHI 稳定

Recall Miss 稳定

Diversity 稳定

没有明显异常波动

即可认为：

memory-engine Recall 系统进入稳定运营阶段。

此时再考虑：

v0.9.0
→ v1.0.0
