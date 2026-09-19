# Q6-D3 Stable Session-Key Shadow Scope Stage Card — 2026-09-19

> **Status: OWNER AUTHORIZED / SOURCE IMPLEMENTED / ONE-SHOT DEPLOYMENT + STABLE-KEY OBSERVATION**
>
> Owner authorization was granted on 2026-09-19 for exactly one Q6-D3 deployment + stable-session-key real-host observation transaction. It authorizes one host-owned D3 publication, one exact stable-key shadow observation of at most six genuine natural turns, mandatory closeout, and at most one coherent rollback if publication/activation cannot be qualified. It does not authorize Q6-E, Q7, new provider families, memory-data mutation, push, or tag.

## 1. Decision

Use the stable OpenClaw `sessionKey` as the preferred exact shadow authorization identity while retaining runtime `sessionId` as the event/trace correlation identity.

The source contract is:

```text
stable sessionKey
= authorization/scope identity

runtime sessionId
= event/trace correlation identity
```

Q6-D3 does not change retrieval, rerank, topK, card-first selection, runtime gate policy or AutoRecall default behavior.

## 2. D2 finding that D3 repairs

Q6-D2 bound shadow to runtime session ID:

```text
d31f1b79-d9cb-476a-8d4e-f70f892b1500
```

The operator continued the same OpenClaw explicit chat identified by stable key:

```text
agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500
```

but the host refreshed its runtime session ID to:

```text
acd96a23-5472-4b88-a2cd-f15277d3e58b
```

The natural turn still executed AutoRecall and retrieved three candidates, but Q6 shadow did not activate because the old runtime ID no longer matched.

Q6-D2 closed:

```text
STOPPED / CONSUMED / CLEAN CLOSEOUT
STABLE SESSION KEY / ROTATING RUNTIME SESSION ID MISMATCH
```

Report:

```text
docs/memory-engine-q6-d2-shadow-autorecall-result-20260919.md
```

## 3. Host seam qualification

Read-only OpenClaw 2026.7.1-2 source/type review confirms `before_prompt_build` receives a hook context carrying:

```text
sessionKey?: string
```

The host prompt-build implementation passes `params.hookCtx` unchanged to `runBeforePromptBuild(...)`, and that context is already used by OpenClaw itself for session-scoped prompt behavior.

Therefore D3 does not invent a new host identity source.

## 4. Configuration compatibility

D3 does **not** add a new config property.

Existing shape remains:

```json
{
  "autoRecall": {
    "shadow": {
      "enabled": false,
      "sessionAllowlist": []
    }
  }
}
```

D3 extends the meaning of each exact allowlist string:

```text
accepted exact identity =
runtime sessionId
OR
stable OpenClaw sessionKey
```

No prefix, wildcard, regex or normalization match is introduced.

Existing runtime-session-ID configurations remain compatible.

Manifest description is updated only to reflect the broader exact-identity meaning.

## 5. Scope resolution

D3 resolves both values independently:

```text
sessionId =
event.sessionId
|| event.session_id
|| ctx.sessionId
|| event.sessionKey
|| ctx.sessionKey
|| ctx.runId
|| null

sessionKey =
event.sessionKey
|| event.session_key
|| ctx.sessionKey
|| ctx.session_key
|| null
```

Shadow resolution receives both.

Match precedence:

```text
1. exact sessionKey match
2. exact sessionId match
3. fail closed
```

Key precedence is intentional because a stable chat key may remain constant while the runtime session ID rotates.

A nonmatching key does not disable a valid exact runtime-ID match; backward compatibility remains.

## 6. Apply behavior

No D3 change is allowed to alter Q6 shadow apply semantics.

For an active shadow scope:

```text
decision path executes
Q6 bounded envelope may be written
prepend/apply is suppressed
memory_injected is not written for the shadow trace
reinforcement authority is not granted
recall_completed.injected_count=0
```

For a non-shadow scope, the pre-D3 active card-first behavior remains unchanged.

## 7. Persistent evidence boundary

Q6 persistent decision envelope remains:

```text
memory_engine_q6_shadow_autorecall_decision_v1
```

D3 does not add the full session key to persistent Q6 metadata.

The event's ordinary `session_id` remains the runtime session ID used for trace correlation.

This avoids introducing a new persistent stable-key identifier into the bounded Q6 envelope.

## 8. Runtime-session rotation evidence

The read-only helper:

```text
bin/q6-shadow-runtime-evidence.js
```

now accepts repeated:

```text
--session-id <runtime-id>
```

and treats the de-duplicated set as the bounded correlation identities for one stable-key observation transaction.

Example:

```bash
node bin/q6-shadow-runtime-evidence.js \
  --db <engine.sqlite> \
  --since-id <base> \
  --session-id <old-runtime-id> \
  --session-id <new-runtime-id> \
  --turns-sent 2 \
  --json
```

All Q6 envelopes outside the supplied bounded runtime-ID set remain foreign-scope violations.

The helper output retains `session_id` for compatibility and adds:

```text
session_ids=[...]
```

## 9. Focused source proof

Required focused tests include:

1. legacy exact runtime-session-ID shadow match remains valid;
2. stable exact session-key shadow match succeeds when runtime session ID differs;
3. lifecycle receives refreshed runtime session ID plus stable session key and:
   - activates shadow;
   - executes retrieval/decision;
   - suppresses apply;
   - records Q6 event under the refreshed runtime session ID;
4. non-shadow sessions remain active card-first;
5. evidence helper aggregates two bounded runtime IDs;
6. Q6 envelope privacy/bounds remain unchanged;
7. manifest describes exact session identities rather than only IDs.

At source freeze these tests pass.

## 10. Source files

Runtime source changes are limited to:

```text
lib/recall/auto-recall-shadow.js
lib/recall/auto-recall-hook-lifecycle.js
openclaw.plugin.json
```

Read-only qualification helper change:

```text
bin/q6-shadow-runtime-evidence.js
```

Focused tests:

```text
test/q6-shadow-autorecall.test.js
test/q6-shadow-runtime-evidence.test.js
test/auto-recall-runtime-gate.test.js
```

No Core/Engine/LanceDB schema or retrieval implementation changes are part of D3.

## 11. Current source hashes

At this source stage:

```text
openclaw.plugin.json
4cee6de6ff2d44a3b043a1797580c6ffe2a44cf7f59d8d7835c1a774b0f635e5

lib/recall/auto-recall-shadow.js
5566d2f1f231c09e964eb3f9217e5260122568f6ac18fd8adec6d5389f21c01f

lib/recall/auto-recall-hook-lifecycle.js
3adf5a4e1d12ee1b52a805431f6213097d8d9d4ca624fba335652984865ff070

bin/q6-shadow-runtime-evidence.js
4455657e0ffcf500e2a91e7952c5efac84ffd125199a518b6bcf3e509a311814
```

These are source identities only. They are not claims about the currently loaded installed extension.

## 12. Deployment state

D3 is **not deployed at authorization time**.

The current installed extension remains the Q6-R1/Q6-D2 runtime. The authorized Q6-D3 transaction may publish D3 exactly once through the host-owned plugin lifecycle before stable-key shadow observation.

Therefore:

```text
repo D3 source != installed extension
```

is expected after the D3 source commit and must not be misclassified as an accidental split-brain.

The authorized D3 transaction must explicitly publish the D3 source through one host-owned `plugins install <repo> --force` lifecycle before attempting stable-key shadow observation. It must snapshot the pre-D3 managed extension first and may use that immutable snapshot for at most one coherent host-owned rollback if publication/activation fails before a usable D3 shadow runtime is reached.

Manual file copy and direct registry writes remain forbidden.

## 13. Authorized real-host observation shape

The authorized D3 live transaction binds exactly one stable key:

```text
agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500
```

The shadow config should use:

```json
{
  "enabled": true,
  "sessionAllowlist": [
    "agent:main:explicit:d31f1b79-d9cb-476a-8d4e-f70f892b1500"
  ]
}
```

Before each evidence collection step, the packet must resolve the current runtime session ID associated with that stable key and append any newly observed runtime ID to the bounded correlation set.

At most six genuine natural turns are permitted. The packet itself must not synthesize user traffic.

Transaction bounds:

```text
MAX_EXECUTIONS=1
MAX_FORWARD_INSTALLS=1
MAX_ROLLBACK_INSTALLS=1
MAX_TURNS=6
shadow stable keys=1
provider-family expansion=0
evaluation-provider calls=0
manual registry writes=0
manual installPath file copy=0
Core/Engine/LanceDB direct mutation=0
push/tag=0
```

The execution is consumed only after preflight has proved the current Q6-R1/D2 installed baseline, stable-key binding, config invariants, event baseline and rollback snapshot readiness. After consumption, any STOP/PASS/rollback outcome is non-reusable without new Owner authorization.

If D3 publication succeeds but observation later stops, closeout restores the post-install D3 default-off config and keeps D3 installed. If publication or activation cannot be qualified before `SHADOW_ACTIVE`, the packet may use its single rollback allowance to restore a coherent pre-D3 managed extension and exact pre-transaction config.

## 14. Authorization boundary

Current status:

```text
Q6-D3 =
OWNER AUTHORIZED
SOURCE IMPLEMENTED / FOCUSED VERIFIED
ONE-SHOT DEPLOYMENT + STABLE-KEY OBSERVATION AUTHORIZED
```

The authorization applies only to the exact stable key and bounded transaction described above. It becomes non-reusable once the committed packet crosses its explicit execution-consumed boundary.

Q6-E and Q7 remain unauthorized. Push/tag remain unauthorized.

## 15. Product interpretation

D3 is an identity-model correction, not a new recall policy.

It does not change the Q6-C conclusion and does not make any positive product-policy decision.

Q6-E remains not ready until stable-key real-host shadow evidence is collected.
