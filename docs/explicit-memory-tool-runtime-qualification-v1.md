# Explicit Memory Tool Runtime Qualification v1

Status: `PASS / RUNTIME QUALIFIED / CLOSED`

Date: 2026-08-25

## Qualified authorities

- OpenClaw source and deployed build: `ba0edf98d1617b92296e7b834ee7a5a82cc2a18e`
- memory-engine source: `cd80a25f089a7eb7b5e0d89c476fb4dc86b0e4cb`
- deployed memory-engine target files:
  - `lib/tools/register-memory-engine-tools.js` SHA-256 `b3000993272e22536a9537c27f158e57dc2c1a8cdba88f8af1210e628e2372e5`
  - `lib/tools/memory-engine-actions.js` SHA-256 `a36e6f68e76fb74b263a23161e5aec234b3de4def3f61eb5f685cfb8319ab166`
- OpenClaw version: `2026.6.9`

## Decision

The follow-up finding `EXPLICIT_MEMORY_TOOL_DISCLOSURE_BOUNDARY_NOT_UNIFIED` is closed.

The qualified production contracts are:

```text
memory_engine_search
= ACCEPTED_SEPARATE_CAPABILITY
= bounded untrusted retrieval output
= no Owner requirement
= no disclosure-authority claim

memory_engine_get
= OWNER_ONLY_EXPLICIT_FULL_CONTENT_RETRIEVAL
= exact current conversational Owner authority required
= direct Gateway/operator authority is not conversational Owner authority
```

This qualification does not reopen DIRECT_CARD, does not authorize `RAW_DISCLOSABLE`, and does not productionize `INTERNAL_AGENT_CONTEXT`.

## Runtime evidence

### 1. Coordinated deployment

The authorized deployment was bound to the exact OpenClaw and memory-engine authorities above.

Preflight proved:

- OpenClaw repository HEAD matched `ba0edf98...`;
- memory-engine repository HEAD matched `cd80a25...`;
- OpenClaw `dist/build-info.json.commit` matched the exact OpenClaw HEAD;
- both repositories were clean;
- the active OpenClaw build was the prior `755ff5d...` baseline before mutation;
- the two active memory-engine target files matched their expected prior hashes;
- Gateway connectivity was healthy.

The Gateway was stopped once, OpenClaw `dist/` was synchronized, the two reviewed memory-engine runtime files were synchronized, and the Gateway was started once. Post-sync parity matched the exact source hashes and the Gateway reached `Connectivity probe: ok` after three seconds.

Result:

```text
DEPLOYMENT=PASS
```

### 2. Direct Gateway get fails closed

A real Gateway RPC `tools.invoke` call requested `memory_engine_get` for an existing memory prefix under the normal operator/admin Gateway capability.

Observed plugin result:

```json
{
  "found": false,
  "error": "owner_authorization_required",
  "code": "MEMORY_GET_OWNER_AUTH_REQUIRED"
}
```

No memory content, path, source, line range, or existence-sensitive memory payload was returned.

This proves the corrective H3 authority-domain split: existing Gateway/core `senderIsOwner` semantics do not populate the plugin conversational Owner authority.

### 3. Conversational Owner reaches the get executor

A normal WebChat `main` Owner turn called `memory_engine_get` with the guaranteed-missing ID:

```text
qualification-owner-missing-ba0edf98-20260825
```

Observed tool result:

```text
found=false
id=qualification-owner-missing-ba0edf98-20260825
error=not found
code=absent
```

The result is the ordinary get-executor miss, not `MEMORY_GET_OWNER_AUTH_REQUIRED`. It therefore proves the positive current-turn conversational Owner authority path reached the real get executor.

The qualification intentionally used a missing ID rather than a successful existing-memory read so the test did not trigger get-success bookkeeping. Full-content success behavior remains covered by the repository get-executor tests.

### 4. Deployed search output is bounded

The deployed active memory-engine artifact was exercised non-live with an injected Hybrid result and no real memory database query. The specialized `memory_engine_search` executor returned only:

```text
{ results: [...] }
```

The qualification proved:

- `text` was truncated to exactly 240 characters;
- `sources` retained only string labels;
- `pool`, `channels`, `channel_sizes`, and `debug` were absent;
- arbitrary/internal candidate fields were absent.

Result:

```text
ACTIVE_SEARCH_BOUNDED=PASS
```

The management `memory_engine action=search` compatibility envelope remains a separate contract and was not changed by this qualification.

## Mutation boundary

The qualification was deliberately structured to avoid memory-content/confidence or qualification-only persistent memory-event mutation:

- the direct Gateway get was denied before lookup success;
- the conversational Owner get used a missing ID and therefore did not trigger get-success bookkeeping;
- the search projection was exercised non-live against the deployed artifact with injected retrieval output and without real memory DB access.

No AutoRecall or card-first enablement, disclosure attestation creation, configuration change, memory-content mutation, confidence mutation, or OpenSpec 4.4 work was performed.

## Final runtime baseline

Read-only closeout confirmed:

```text
OpenClaw active commit = ba0edf98d1617b92296e7b834ee7a5a82cc2a18e
Gateway = running
Connectivity probe = ok
AutoRecall.enabled = false
AutoRecall.topK = 3
cardFirstRuntime.enabled = false
sessionAllowlist = []
agentAllowlist = ["main"]
triggerAllowlist = ["user"]
chatTypeAllowlist = ["interactive_user_chat"]
messageRoleAllowlist = ["user"]
```

The recurring `installs.json.migrated` archive-exists migration warning was non-causal: it did not affect deployment parity, Gateway readiness, or tool-authority behavior.

## Final adjudication

```text
H3_TOOL_FACTORY_OWNER_AUTHORITY
= PASS / DEPLOYED / RUNTIME QUALIFIED

MEMORY_ENGINE_GET_OWNER_BOUNDARY
= PASS / DEPLOYED / RUNTIME QUALIFIED

MEMORY_ENGINE_SEARCH_BOUNDED_OUTPUT
= PASS / DEPLOYED / RUNTIME QUALIFIED

EXPLICIT_MEMORY_TOOL_DISCLOSURE_BOUNDARY_NOT_UNIFIED
= CLOSED

DIRECT_CARD / OpenSpec 4.3
= REMAINS PASS / RUNTIME QUALIFIED / CLOSED

RAW_DISCLOSABLE / OpenSpec 4.4
= NOT STARTED

INTERNAL_AGENT_CONTEXT
= HOLD / RESEARCH_ONLY
```
