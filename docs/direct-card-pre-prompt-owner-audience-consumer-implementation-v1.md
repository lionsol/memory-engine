# D.3-D.4-H2-E DIRECT_CARD Pre-Prompt Owner Audience Consumer

## Result

`PASS / SOURCE IMPLEMENTED / REPOSITORY-TESTED` on 2026-08-23.

This stage changes only the memory-engine repository. It does not deploy,
reload, enable AutoRecall, mutate runtime configuration, write real Core or
Engine data, create a real attestation, or run EDi/live qualification.

## Host contract authority

The authoritative OpenClaw H2 source checkout was independently verified
read-only at:

`/home/lionsol/src/openclaw-h2`

`HEAD=2e67ab06b6f7f1cf7655d0a8d508fc2a2ad78176`, clean worktree.

Its `PluginHookBeforePromptBuildEvent` exposes:

~~~~ts
{
  prompt: string;
  messages: unknown[];
  senderIsOwner?: boolean;
}
~~~~

This is a later authoritative-source correction to the H1 design finding:
the `v2026.6.9` source does contain the CLI prompt-build path, and H2 covers
that path. The H1 record remains historical and is not rewritten.

## Production source flow

When `cardFirstRuntimeEnabled === true`:

~~~~text
before_prompt_build
  -> Hybrid search
  -> shouldInjectCandidate() coarse gate
  -> event.senderIsOwner === true short-circuit
  -> one bounded exact-memory_id Canonical batch read in the isolated
     Core-readonly / Engine-readonly Hybrid DB scope
  -> Canonical-source-derived owner_attestable_canonical_card_v1 artifact
  -> exact active OWNER_EXPLICIT_ATTESTATION / OWNER_SELF evidence
  -> lifecycle, scope, risk, and source hard-deny capability checks
  -> sufficient retrieval evidence
  -> selection-only DISCLOSE_CARD / WITHHOLD
  -> bounded direct-card formatter
  -> prependContext and selection-derived telemetry
~~~~

The card branch has no legacy card or raw-text fallback. With
`cardFirstRuntimeEnabled === false`, the existing legacy raw-text path remains
unchanged and outside this migration.

## Boundary properties

- `senderIsOwner` is accepted only as `event?.senderIsOwner === true`; false,
  absent, non-boolean, and Owner-like sender/session/channel context fail
  closed.
- Canonical acquisition uses exact `candidate.memory_id`, never the bounded
  compatibility `candidate.id`, and does not extend the Hybrid result with
  Canonical source text.
- Projection and attestation are both exact and current; source, identity,
  projection, adapter, policy, schema, state, or hash drift withholds.
- Lifecycle states, scope mismatches, unsafe categories/kinds/source paths,
  conflict/sensitive/cross-agent risk, and insufficient retrieval evidence
  withhold independently.
- Only selected cards contribute to `prependContext`, injected IDs,
  reinforcement IDs, `memory_injected`, completion counts, and turn state.

## Verification scope

Focused tests use only temporary/in-memory databases. Repository-wide static
and test validation is required before commit. Runtime/deployment qualification
is explicitly not part of H2-E; OpenSpec 4.3 and 4.4 remain unchecked.
