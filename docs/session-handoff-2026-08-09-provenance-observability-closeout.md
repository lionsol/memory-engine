# Session Handoff — Provenance Observability Closeout — 2026-08-09

> Purpose: explicit user-requested migration handoff for starting a new ChatGPT session.
>
> This file is descriptive evidence only. It does not create execution authorization.

## Read order in the new session

Read these files before proposing any next stage:

1. `AGENTS.md`
2. `docs/current-state.md`
3. `docs/stabilization-plan.md`
4. latest 2026-08-09 section of `docs/devlog.md`
5. `docs/smoke-tests/auto-recall-provenance-natural-canary-retry-r3-stage-card-20260809.md`
6. local evidence report `reports/auto-recall-provenance-natural-canary-retry-r3/final-report.md` if present

Do not infer runtime state from this handoff alone; verify current source/runtime evidence when a claim depends on it.

## Role and authorization boundary

- Sol is owner and sole explicit authorizer.
- GPT is planner/reviewer/gate designer.
- Codex CLI codes/tests only after explicit Sol authorization.
- EDi performs OpenClaw runtime verification only after explicit runtime authorization.
- DevSpace is for bounded inspection/document work unless explicitly authorized otherwise.
- Commit authorization and runtime execution authorization are separate.
- Every runtime execution packet must bind exact Stage Card commit, exact repository HEAD, exact scope and finite execution count; default `MAX_EXECUTIONS=1`.
- Failed transactions remain immutable historical evidence and are not retried under the same identity.

Always distinguish `current_fact`, `accepted_design`, and `historical_record`.

## Repository state at handoff creation

`current_fact` at the moment this handoff was created:

```text
repository=/home/lionsol/.openclaw/workspace/plugins/memory-engine
HEAD=728a45fcd0d10404bc2378c1d71e2931efeb2dac
origin/main=4c7ef07a52d5f8c86a522bd00f7f9d2a942fdca7
branch=main
```

Important: the final provenance closeout commit had **not yet been created** at handoff creation time. The following three closeout documents were already staged:

```text
docs/current-state.md
docs/devlog.md
docs/stabilization-plan.md
```

This handoff file is the fourth intended file in the final session-closeout commit.

The new session must first verify the final commit actually exists, contains exactly these four files, and leaves the worktree clean. Do not assume the commit exists because this handoff describes it.

Recommended final commit message:

```text
docs(recall): close provenance observability session
```

No push or tag is implied.

## Provenance observability source/runtime result

### `historical_record` — source implementation

Bounded AutoRecall candidate provenance was implemented in source commit:

```text
1cd183ff12d055ba5c5ecd4bd0d9d1b98cdff23b
feat(recall): add bounded candidate provenance telemetry
```

Implementation is additive observability only:

- per-channel `channel_candidate_provenance` with bounded short IDs;
- max 32 IDs per channel;
- fusion `pre_rerank_ids` / `post_rerank_ids`, max 8 each;
- persistent projector excludes text/body/preview/path/prompt/query/exact fragments/arbitrary metadata;
- retrieval results/order/scores remained unchanged in source verification.

Focused/privacy tests passed 19/19; Node 24 full suite passed 1835, failed 0, skipped 8.

### `historical_record` — runtime deployment

The first provenance runtime-install attempt stopped during candidate construction because copied target files were sealed `0400` and overlay write failed. Gateway/runtime were not mutated; that failed candidate remains immutable historical evidence.

The bounded R2 deployment retry later closed `PASS_WITH_FINDINGS`. It installed a minimal overlay containing only the two provenance source-file differences and preserved unrelated retrieval semantics.

### `current_fact` — runtime baseline verified during session closeout

At the latest read-only closeout check:

```text
OpenClaw=2026.6.9
memory-engine plugin status=loaded
memory-engine version=0.8.22
AutoRecall.enabled=false
AutoRecall.topK=3
AutoRecall.timeoutMs=8000
Gateway=running/healthy
```

Active provenance runtime identity:

```text
sourcePath=/home/lionsol/.openclaw/backups/memory-engine/releases/provenance-overlay-1cd183ff-20260808-r2
installPath=/home/lionsol/.openclaw/extensions/memory-engine
hybrid-search.js sha256=4cc0e74ac587b3c38b86add5de4ca8e116ed2358091c58a828a0e326778a2cce
auto-recall-debug-metadata.js sha256=f0910a1f39484d6abcfb07e0b369b2a98e6de0165eb6403b1edef42a7cce3a07
openclaw.json sha256=f2f7de09371f2a143ff02139c763b5f8f87cee46b0b10f8c9c91889ce2143e7a
```

These runtime facts must be re-verified if the next session depends on them.

## Natural provenance canary chain

### `historical_record` — first natural-canary attempt

Outcome: `STOPPED` before AutoRecall enablement.

- exact dedicated `main` session bootstrap succeeded while AutoRecall=false;
- verifier mistakenly checked `id` instead of `sessionId`;
- closeout also exposed invalid multiline shell-test syntax and a false historical scope count because no fresh event baseline had yet been captured;
- no natural canary retrieval ran.

Dedicated session identity retained for later retries:

```text
agentId=main
sessionId=ce1e425c-10f0-4393-8d76-75ec390dd58f
sessionKey=agent:main:explicit:provenance-canary-ce1e425c-10f0-4393-8d76-75ec390dd58f
```

### `historical_record` — natural-canary retry R2

Outcome: `STOPPED`.

R2 correctly enabled exact scoped AutoRecall, captured a fresh baseline, produced technically valid provenance and restored config, but the interactive harness used `bash -s <<'EOF'` plus plain `read`; `read` consumed the remaining heredoc script instead of waiting for Sol. The accidental prompt was:

```text
STAGE_RESULT="INSUFFICIENT_EVIDENCE"
```

That prompt is not natural-use evidence.

### `historical_record` — final natural-canary retry R3

Outcome: `PASS`.

Sol explicitly approved R3 as the final anti-drift exception. R3 separated script input from user input by running a temporary script file, passing `bash -n`, and reading the question from `/dev/tty`.

The genuine natural user question was about the creation date of the August duty schedule.

Fresh R3 baseline was event 190. The natural turn produced one trace:

```text
191 recall_started
192 hybrid_search_observation
193 auto_recall_debug
194 memory_candidate_retrieved
195 recall_completed
```

Independent read-only verification of event 193:

```text
skipped=false
candidate_count=1
injected_count=0
channel=vector
vector count=4
vector captured_count=4
vector truncated=false
fusion pre_rerank_ids=4
fusion post_rerank_ids=4
```

All provenance IDs were bounded short IDs and the new provenance objects contained only the frozen privacy-safe fields.

Scope isolation for `id > 190`:

```text
dedicated recall_started=1
foreign recall_started=0
```

Closeout restored the exact pre-canary config, returned AutoRecall to false/topK=3, preserved the R2 provenance runtime hashes, and left Gateway healthy.

Local execution evidence report:

```text
reports/auto-recall-provenance-natural-canary-retry-r3/final-report.md
sha256=ccc66c76913cede403f55bf5c72755aeeb2ae4a7150eb37e0ac3d1e6e970594c
```

`reports/*` is intentionally ignored by Git under current project convention; do not force-add the report merely because this handoff references it.

## Non-blocking findings from R3

1. The outer operator wrapper ended with `exit "$R3_RC"`; because Sol pasted it into an interactive WSL shell, the shell/window closed after successful closeout. This is an operator-wrapper UX defect, not a memory-engine runtime failure.
2. EDi's separate standard `memory_search` later timed out on its embedding/provider path while answering the duty-schedule question. That timeout happened after the AutoRecall provenance trace completed and is not evidence against the provenance stage.

Neither finding authorizes a new provenance canary or retrieval change.

## Current product decision

### `accepted_design`

Bounded candidate-provenance observability is closed as demonstrated on genuine natural-use runtime traffic.

Keep frozen unless a new evidence-supported product decision is explicitly approved:

- query shaping / focused-query behavior;
- FTS/vector/recent/KG collection policy;
- fusion/ranking/category weights;
- confidence/gate thresholds;
- Card/gate eligibility and projection behavior;
- capture/index/checkpoint behavior;
- provenance field schema and bounds;
- broad AutoRecall rollout.

AutoRecall remains disabled by default. R3 does not authorize broad rollout.

No R4 or additional dedicated provenance canary is planned.

## Next bounded decision

`accepted_design`: do **not** immediately tune retrieval and do **not** manufacture another canary.

The next eligible step exists only when there is a naturally occurring AutoRecall success/failure with independent answer-bearing evidence. At that point GPT may propose one bounded **read-only first-loss attribution** Stage Card to distinguish among:

1. channel/index collection loss;
2. fusion/preselection loss;
3. later selection/gating loss;
4. answer-bearing candidate was not lost.

If no independently answerable natural sample exists, remain on hold.

A first-loss result may justify a later product repair, but no repair is currently authorized.

## Deferred work

- Candidate-Builder authority publication / `npm.ci_candidate` timeout diagnosis remains deferred.
- The committed Candidate-Builder timeout policy remains 300000ms inner / 330000ms outer for `npm.ci_candidate`.
- Diagnostic/path-authority debt from the 2026-08-04 audit remains real but was non-causal to H6 and does not preempt the current product sequence.
- Historical B8-A7 sustained-production-evidence/removal work remains reference-only and is not the active roadmap.

## New-session startup rule

After reading the files listed at the top:

1. verify final Git HEAD/worktree and confirm the session-closeout commit exists;
2. classify any runtime claims as `current_fact` only after fresh read-only verification;
3. do not automatically create a Stage Card or begin first-loss attribution;
4. wait for Sol to choose the next product-level decision or provide a qualifying natural sample;
5. do not repeat questions whose answers are already present in this handoff/current-state/devlog.
