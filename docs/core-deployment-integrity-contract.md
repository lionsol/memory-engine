# Core deployment integrity contract

Capture the current Core logical baseline before an authorized deployment:

```sh
node bin/core-deployment-logical-fingerprint.js --pretty --out /tmp/core-before.json
```

When a diagnostic whole-file hash is useful, add `--physical-sha256` to both capture and compare commands. Then perform the separately authorized install/reload and compare:

```sh
node bin/core-deployment-logical-fingerprint.js --compare /tmp/core-before.json --pretty --out /tmp/core-after.json
```

Hard PASS requires `comparison.deployment_invariant_equal=true`. A physical SHA mismatch is diagnostic only and never changes that result.

Allowed volatile changes are `schema_meta.updated_at`, `schema_meta.app_version`, SQLite WAL/checkpoint effects, and physical file metadata/page layout. Hard STOP conditions are changes to logical rows in `memory_index_chunks`, `memory_index_sources`, `memory_embedding_cache`, `memory_index_meta`, or `memory_index_state`; schema owner/version identity; `PRAGMA user_version`; or the memory-index schema surface.

This contract does not redesign Engine or LanceDB fingerprints. Continue using their existing before/after fingerprints; establish separate logical contracts only if equivalent physical-only noise is demonstrated.
