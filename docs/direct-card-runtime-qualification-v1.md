# D.3-D.4 DIRECT_CARD Deployment and Runtime Qualification v1

Status: **`PASS / RUNTIME QUALIFIED / OPEN SPEC 4.3 CLOSED`**
Date: **2026-08-24**

This is the bounded deployment/runtime qualification record for the
`DIRECT_CARD` path. It records the separately authorized qualification and its
cleanup baseline; this documentation closeout performs no Gateway, runtime,
configuration, database, data, or attestation operation.

## Authority and final production baseline

The source authorities used by the qualification are:

- memory-engine source: `ae95fa25fed03c4fb414d38db9e010c0157c0a15`
  `fix(recall): expose bounded direct card runtime diagnostics`
- OpenClaw H2 deployed source: `755ff5d396102c5a93baacf2d3bf6187a4fea713`
  `fix(plugins): preserve owner audience on normal prompt path`
- OpenClaw version: `2026.6.9`

After qualification cleanup, the final production baseline was:

| Setting | Value |
| --- | --- |
| `autoRecall.enabled` | `false` |
| `topK` | `3` |
| `timeoutMs` | `8000` |
| `sessionAllowlist` | `[]` |
| `cardFirstRuntime.enabled` | `false` |
| `agentAllowlist` | `["main"]` |
| `triggerAllowlist` | `["user"]` |
| `chatTypeAllowlist` | `["interactive_user_chat"]` |
| `messageRoleAllowlist` | `["user"]` |
| active disclosure attestations | `0` |
| Gateway | `READY` |

## Same-run 0 → 1 → 0 evidence

The three observations used the same real Owner WebChat session, memory, and
natural query.

Memory identity:

- full `memory_id`: `50e5f893c075ac67b56e0416040162af67f8d1192fc4dadcecb10e1bb51a83bb`
- event short id: `50e5f893c075ac67`
- `canonical_id`: `cmem:core:50e5f893c075ac67b56e0416040162af67f8d1192fc4dadcecb10e1bb51a83bb`
- `projection_hash`: `55ec2b69523bdd0c1a5ffa14b47a1a3cbf2ff3329bf2ef177139e6d01b4fe142`
- `attestation_id`: `datt_b0d6141152df6f9a378cb2deab88c15ce126661ab8d07ba42a45eea70c309853`

Exact natural query:

> memory-engine installPath，H5 验收环境。当时 active-memory 和安装后的 runtime 配置是什么？不要调用工具。

### FINAL A — no attestation

Trace: `8eed5c12-cd74-405c-90ca-5ec0f960afea`

The target was retrieved and passed the generic gate (`before_gate=3`,
`after_gate=1`, `target generic gate injected/pass=1`, `card_first_runtime=1`),
but active attestations were `0`. A read-only production-boundary replay
returned `capability=RETRIEVAL_ONLY`, `reason=attestation_missing`, and
`selection=WITHHOLD`; `memory_injected` was absent and
`recall_completed.injected_count=0`.

Adjudication: **PASS — no-attestation fail-closed baseline.**

### FINAL B — exact active Owner attestation

Trace: `69d74408-8199-42e2-a373-ee7eaa6ac73f`

The exact active authority was `OWNER_EXPLICIT_ATTESTATION` with
`OWNER_SELF`. Evidence was:

- `before_gate=3`, `after_gate=1`, `card_first_runtime=1`
- `direct_card_event_sender_is_owner=1`
- `direct_card_owner_audience_authenticated=1`
- capability: `CARD_DISCLOSABLE`, reason `all_direct_card_authorities_pass`
- selection: `DISCLOSE_CARD`, reason `card_capability_and_retrieval_evidence_pass`
- `direct_card_selected_count=1`
- `memory_injected` for `memory_id=50e5f893c075ac67`
- `recall_completed.injected_count=1`
- `memory_cited` and `memory_reinforced` observed

Adjudication: **PASS — exact active Owner attestation caused actual
DIRECT_CARD prompt injection.**

The initial exact-count SQL compared the full 64-character `memory_id` with
`memory_events.memory_id`, which stores the 16-character event ID and
incorrectly returned `0`. The read-only recheck using
`50e5f893c075ac67` returned `count=1`. This is a qualification query-shape
defect, not a product failure.

### FINAL C — same attestation revoked

Trace: `956d50a3-9dc4-4ea0-8143-83e0459583f7`

The same Owner audience remained authenticated and the target remained
retrieved; the generic gate still passed, but the attestation was revoked and
active attestations were `0`. The boundary returned
`capability=RETRIEVAL_ONLY`, `reason=attestation_missing`, and
`decision=WITHHOLD`; `direct_card_selected_count=0`, target injection count
was `0`, and `recall_completed.injected_count=0`.

Adjudication: **PASS — revoke restores fail-closed behavior after prior
citation/reinforcement.**

The causal chain is therefore:

```text
attestation absent
  → RETRIEVAL_ONLY / WITHHOLD / injected=0
attestation active
  → CARD_DISCLOSABLE / DISCLOSE_CARD / injected=1
same attestation revoked
  → RETRIEVAL_ONLY / WITHHOLD / injected=0
```

This qualifies the `DIRECT_CARD` Owner-attested disclosure authority.

## OpenClaw H2 runtime finding and correction

`OPENCLAW_H2_NORMAL_TURN_OWNER_PROPAGATION_DEFECT` was observed on the same
post-restart Control UI/WebChat connection. The Owner slash command
`/memory-disclosure status ...` returned `ok=true`, proving the command path
had `ctx.senderIsOwner === true`, while the adjacent natural turn recorded
`direct_card_event_sender_is_owner=0` and
`reason=owner_audience_not_authenticated`.

The trusted Owner fact reached `runEmbeddedAgent()`, but
`runEmbeddedAgentInternal()` omitted `senderIsOwner` while assembling the
final `runEmbeddedAttempt({...})` parameters. OpenClaw H2 commit
`755ff5d396102c5a93baacf2d3bf6187a4fea713` corrected the seam with:

`senderIsOwner: params.senderIsOwner`

Regression coverage proved:

- internal WebChat plus `operator.admin` → `true`
- internal WebChat without `operator.admin` → `false`
- external provider even with `operator.admin` → `false`

Independent acceptance evidence was embedded e2e `21/21 PASS`, related H2
tests `148/148 PASS`, broader Codex H2 Owner/reply tests passing, and build
`PASS`.

The correction added no Owner inference, scope upgrade, cross-turn/session
cache, or positive authority for cron, heartbeat, or subagent paths. Non-owner
fail-closed behavior and slash-command semantics remain unchanged.

## Bounded telemetry corrective patch

Memory-engine commit
`ae95fa25fed03c4fb414d38db9e010c0157c0a15`
(`fix(recall): expose bounded direct card runtime diagnostics`) corrected the
observability gap in the card-first lifecycle path.

The bounded debug projection records only:

- strict Owner event/authenticated booleans
- selected count
- at most three capability results and selections
- 16-character memory IDs
- bounded capability, reason, decision, and error strings

It does not record card payload, title, summary, source hint, Canonical source,
attestation fields, or other content. This patch changed observability only;
disclosure semantics remained unchanged and boundary errors remained
fail-closed.

## Follow-up findings — non-blocking

These findings are retained without creating a new stage or expanding OpenSpec
4.3:

1. **`AUTO_RECALL_AGENT_ID_DEFAULT_MISMATCH`** — the historical baseline used
   `agentAllowlist=["edi"]`, while the actual EDi agent ID is `main`. The
   qualification used `agentAllowlist=["main"]`; cleanup intentionally keeps
   `main` and must not restore `edi`.
2. **`EXTERNAL_NULL_CONFIDENCE_COERCED_TO_ZERO`** — for external Canonical
   memories with `lifecycle.confidence=null`, `Number(null) === 0` can make the
   current unsafe-risk logic treat the value as below `0.2`. The observed
   candidate was `bfa822b9311fae0f3af74b4080f7403eae4beac16a0e446315d2c422bdfcb879`.
   This is a real follow-up product bug, not a 4.3 blocker; it is not fixed
   here.
3. **`EXPLICIT_MEMORY_TOOL_DISCLOSURE_BOUNDARY_NOT_UNIFIED`** —
   `memory_engine_search` / `memory_engine_get` remain a parallel explicit
   retrieval capability outside the `DIRECT_CARD` attestation boundary. This
   requires a future tool-authority/disclosure-boundary review.
4. **DIRECT_CARD telemetry observability gap** — resolved by the
   `ae95fa25...` source patch and its qualified deployment evidence.
5. **Retrieval fixture quality** — historical candidate
   `176961...` did not rank in the top eight because common runtime/version
   phrases were duplicated widely. The managed `50e5...` candidate with
   `installPath + H5 验收环境` supplied stable sufficient retrieval evidence;
   this is a fixture characteristic, not an authority/product defect.

## Scope closeout

- OpenSpec 4.3: **checked — `PASS / RUNTIME QUALIFIED / CLOSED`**.
- OpenSpec 4.4: **unchecked — `RAW_DISCLOSABLE` / raw-reference work remains
  out of scope**.
- No new runtime canary, Stage Card, retry chain, source/test change, Gateway
  operation, configuration mutation, database/data mutation, AutoRecall
  re-enable, or attestation creation is part of this documentation closeout.
