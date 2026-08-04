# Post-H6 v2 Live-Install Template

This is a deployment-neutral template for a separately authorized transaction. The placeholders must be bound by the transaction owner before use. This document authorizes nothing by itself.

## Required bindings

```bash
REPO="<REPOSITORY_ROOT>"
NODE_RUNTIME="<NODE_RUNTIME>"
OPENCLAW_CLI="<OPENCLAW_CLI>"
BASELINE_RELEASE="<BASELINE_RELEASE>"
CANDIDATE_RELEASE="<CANDIDATE_RELEASE>"
SOURCE_COMMIT="<SOURCE_COMMIT>"
EVIDENCE_ROOT="<EVIDENCE_ROOT>"
```

Before any operation, verify that the reviewed source, baseline release, candidate release, and evidence root are the intended authorities. Keep all paths explicit and record the resolved paths in the private transaction evidence.

## Fail-closed installation contract

- The candidate install attempt is limited to one.
- Install only the reviewed candidate release through the explicitly bound CLI and runtime.
- Do not create D0, enable AutoRecall, or run an H6 canary as part of this template.
- Stop on any source, artifact, configuration, database, service, or evidence mismatch.
- A rollback target must be verified before the transaction begins and must remain available throughout the transaction.
- Production enablement remains a separate decision even when offline installation checks pass.

## Verification records

Record source commit, artifact comparison, configuration semantic comparison, rollback authority, service health, and data-operation status under the bound `<EVIDENCE_ROOT>`. Do not place credentials, raw prompts, session transcripts, or private-key material in the repository.
