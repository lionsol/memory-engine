# B8-A7-R6.2 Host Activation Boundary Compatibility

> **Status: Implemented / EDI verification pending**
>
> Date: 2026-07-21
>
> Source baseline: installed OpenClaw `2026.6.9` and reviewed memory-engine commit `16b912f`

## Purpose

R6.1 found that OpenClaw cold inspection reported bundled `active-memory` disabled because it was excluded from a non-empty `plugins.allow`, while memory-engine's local boundary resolver reported it enabled by runtime default.

The disagreement was caused by a stale memory-engine model. The resolver examined only:

```text
plugins.entries.active-memory.enabled
plugins.entries.active-memory.config.enabled
```

It ignored the host activation policy that OpenClaw applies before bundled default enablement.

R6.2 aligns the read-only memory-engine boundary report with the installed OpenClaw activation ordering. It does not modify OpenClaw configuration, installed plugin files, Gateway process state, native dependencies, databases, AutoRecall, production evidence, or an evidence epoch.

## Audited OpenClaw Activation Order

The installed OpenClaw `2026.6.9` runtime resolves plugin activation in this relevant order:

```text
1. plugins.enabled=false
2. plugin id present in plugins.deny
3. plugins.entries.<id>.enabled=false
4. workspace/default selection rules and selected slots
5. non-empty plugins.allow excluding the plugin id
6. explicit activation
7. automatic or bundled default enablement
```

For bundled `active-memory`, exclusion from a non-empty `plugins.allow` disables the plugin before bundled default enablement is considered.

OpenClaw cold inspection of the current environment reported:

```text
id=active-memory
enabled=false
activated=false
activation_source=disabled
activation_reason=not in allowlist
status=disabled
```

The live config contains a non-empty `plugins.allow` that includes `memory-engine` and excludes `active-memory`.

## Implemented Resolver Contract

`lib/recall/hybrid/sustained-runtime-boundary.js` now validates and models:

```text
plugins object shape
plugins.enabled boolean
plugins.allow string array
plugins.deny string array
plugins.entries object
active-memory entry shape
active-memory entry enabled boolean
active-memory plugin config enabled boolean
```

The memory-engine boundary order is:

```text
plugins.enabled=false
  -> disabled_by_plugins_global

active-memory in plugins.deny
  -> disabled_by_plugins_denylist

plugins.entries.active-memory.enabled=false
  -> disabled_by_plugin_entry

plugins.allow non-empty and active-memory absent
  -> disabled_by_plugins_allowlist

plugins.entries.active-memory.config.enabled=false
  -> disabled_by_plugin_config

entry/config explicitly enabled
  -> enabled_by_explicit_or_default_plugin_config

otherwise
  -> enabled_by_active_memory_runtime_default
```

The plugin-specific `config.enabled=false` check remains supported as an internal behavior boundary even though generic OpenClaw activation may still load the bundled plugin wrapper.

## Reduced Report Fields

The report retains its existing fields and adds only reduced host-policy facts:

```text
active_memory_plugins_enabled
active_memory_allowlist_configured
active_memory_allowlisted
active_memory_denylisted
```

No raw configuration contents, allowlist contents, secrets, tokens, environment values, or unrelated plugin entries are copied into the report.

## Fail-Closed Validation

Malformed activation policy remains invalid rather than being normalized into a safe result.

Examples:

```text
plugins.enabled="false"
  -> invalid_boolean:plugins.enabled

plugins.allow="active-memory"
  -> invalid_array:plugins.allow

plugins.allow=[""]
  -> invalid_string:plugins.allow

plugins.entries.active-memory.enabled="false"
  -> invalid_boolean:plugins.entries.active-memory.enabled
```

An invalid report returns:

```text
status=invalid
active_memory_enabled=null
blockers=<validation errors>
```

## Test Matrix

The focused R6.2 test matrix covers:

```text
no allowlist and no active-memory entry -> bundled runtime default conflict
non-empty allowlist excluding active-memory -> clean
allowlist containing active-memory -> bundled runtime default conflict
global plugins disable -> clean
denylist overrides allowlist and explicit entry -> clean
entry enabled=false -> clean
plugin config enabled=false -> clean
malformed plugins.enabled -> invalid
malformed plugins.allow -> invalid
malformed active-memory entry -> invalid
CLI output remains reduced and secret-free
downstream config-backup, preflight, authorization, monitor, activation, and rollback contracts remain green
```

Focused verification:

```text
37 tests passed
0 failed
```

## Live Read-Only Cross-Check

The updated source resolver was executed read-only against:

```text
/home/lionsol/.openclaw/openclaw.json
```

Result at `2026-07-21T08:10:56.000Z`:

```text
status=clean
active_memory_enabled=false
active_memory_resolution=disabled_by_plugins_allowlist
active_memory_entry_present=false
active_memory_plugins_enabled=true
active_memory_allowlist_configured=true
active_memory_allowlisted=false
active_memory_denylisted=false
blockers=[]
```

The Gateway remained:

```text
PID=676
state=active/running
start timestamp unchanged
```

No install, reload, Gateway restart, config mutation, or database command was performed.

## Effect on R6.1 Decision

R6.2 resolves one R6.1 blocker at the reviewed-source tooling layer:

```text
active-memory host state=disabled
boundary resolver=false conflict fixed
```

R6.1 remains `BASELINE BLOCKED` because the installed runtime is still older than the reviewed source:

```text
source_runtime_equal=false
difference_count=28
memoryEngine.sustainedRuntimePreflight missing
production healthcheck source missing
loaded tool catalog evidence incomplete
```

The live installed extension does not contain the R6.2 fix until a separately authorized installation/synchronization and reload occurs. This source-level live-config cross-check is not a claim that the installed runtime has changed.

## Next Gate

R6.3 and the R6.4 offline rehearsal are closed. The next gate is R6.5, which may authorize one exact live transaction only after independently verifying the ephemeral candidate and refreshing live recovery artifacts.

R6.5 must bind:

```text
reviewed source commit
frozen candidate path, tree hash, and build identity
fresh C0/R0/H0 evidence
quiesced D0 created after an authorized Gateway stop
stable working directory outside replaced paths
install-time pre/post data identity gate
Gateway Node 24 installation environment
exact install/synchronization action
exact stop/start action
post-install source/runtime parity=zero
loaded preflight and healthcheck methods
loaded tool registration evidence
rollback procedure
explicit operator approval
```

R6.5 remains separate from sustained-runtime activation.

## Current Boundary

```text
B8-A7-R6.1 read-only baseline execution=PASSED
B8-A7-R6.1 baseline decision=BASELINE BLOCKED
B8-A7-R6.2 host activation boundary compatibility=PASSED / CLOSED
B8-A7-R6.3 runtime-remediation authorization design=PASSED / CLOSED
B8-A7-R6.4 offline candidate and rollback rehearsal=PASSED / CLOSED
B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED
R6.5 live execution=NOT AUTHORIZED
explicit operator approval=NOT RECEIVED
offline candidate artifact=VALIDATED / FROZEN / EPHEMERAL
live configuration mutation=NOT AUTHORIZED
live plugin install/reload=NOT AUTHORIZED
live Gateway stop/start/restart=NOT AUTHORIZED
live native dependency build=NOT AUTHORIZED
AutoRecall activation=NOT AUTHORIZED
production evidence activation=NOT AUTHORIZED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```
