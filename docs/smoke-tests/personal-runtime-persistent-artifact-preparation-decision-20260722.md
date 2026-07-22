# B8-A7-R6.5.3A Offline Persistent Artifact Preparation Decision

> **Result: BLOCKED / NO PUBLICATION**
>
> Date: 2026-07-22

## Exact authorization received

The operator supplied the complete R6.5.3A authorization binding:

```text
reviewed source HEAD=b2bc851
resolved full HEAD=b2bc851d6dd2111344b4328ecc41b0a3b866acad
active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
persistent parent=/home/lionsol/.openclaw/backups/memory-engine/r6.5.3
Gateway PID=344
```

The abbreviated Git identity resolved uniquely to the current clean committed HEAD.

## Preparation performed

A staging root was created under the authorized persistent parent:

```text
/home/lionsol/.openclaw/backups/memory-engine/r6.5.3/.staging-20260722T032300Z-33b09b9b
```

Before the stop condition, the following gates passed:

```text
repository worktree clean
Gateway active as PID 344 under Node v24.8.0 / ABI 137
active runtime identity matched authorization
active-before artifact identity=bf0e9b53ce7e712d2a34f2ffc3584aa86c55f8c8a9e6a90e5160e9d5f3cde78e
active-after artifact identity=bf0e9b53ce7e712d2a34f2ffc3584aa86c55f8c8a9e6a90e5160e9d5f3cde78e
R0 pre-freeze artifact identity=bf0e9b53ce7e712d2a34f2ffc3584aa86c55f8c8a9e6a90e5160e9d5f3cde78e
active/R0 runtime difference_count=0
R0 SQLite and LanceDB native smoke=PASS
source archive SHA-256=8a62d85c0ed583af3b3c49fa9953ee397b30d16a98b5379b7ecf1864420328f8
candidate runtime identity=dc459f5e9c2d55a03ca8af9f7e8b417839f88062069cba1dc354a48dc489d718
source/candidate difference_count=0
candidate SQLite and LanceDB native smoke=PASS
better-sqlite3=11.10.0
@lancedb/lancedb=0.29.0
```

No OpenClaw install, reload, sourcePath mutation, Gateway stop/start/restart, configuration mutation, or memory-data mutation occurred.

## Stop condition

The packet requires both:

```text
R0 full-tree artifact identity=stable active full-tree artifact identity
R0 tree frozen read-only before publication
```

The canonical artifact identity includes permission modes. The active runtime contains owner-writable files and directories. Removing write bits from R0 would therefore change its artifact identity and make it no longer structure-for-structure identical to the active runtime.

A filesystem immutable-attribute probe returned:

```text
immutable_supported=no
execution user=lionsol uid=1000
```

Therefore the current host cannot make the copied R0 read-only without changing the exact artifact identity, and it cannot preserve exact mode identity while enforcing immutability through `chattr`.

Publishing by weakening either gate would violate the closed R6.5.3A packet. The mandated fail-closed result is:

```text
R6.5.3A PREPARATION BLOCKED / FREEZE MODEL REPAIR REQUIRED
```

## Cleanup and unchanged live state

The staging root was deleted in full. No `FINAL_ROOT` was created and no authority was published.

Final state:

```text
persistent parent exists=true
persistent parent mode=0700
persistent parent published children=0
staging root exists=false
FINAL_ROOT exists=false
Gateway service=active
Gateway PID=344
config SHA-256=da9e443c416979ed71763ccc7cd00106597bed7a7dfdb064a3b507627b2c6f2a
repository worktree clean before decision recording
installed-plugin sourcePath unchanged and still dangling
candidate active=false
```

The empty persistent parent may remain. It is not an authority root and contains no candidate, R0, configuration copy, database copy, or evidence payload.

## Authorization consumption

The supplied R6.5.3A authorization is consumed and is not reusable. It was evaluated against a specific HEAD, active runtime, Gateway PID, and staging transaction.

A replacement preparation requires a reviewed freeze-model repair and a new exact authorization.

The preferred repair direction is to separate the durable exact R0 authority from the later install-ready directory:

```text
persistent exact R0 archive preserving modes and content
read-only archive plus canonical manifest as durable authority
fresh extracted install staging created only inside the later R6.5.3B transaction
post-extraction full-tree identity must equal the archived exact R0 identity
```

This document records the direction only. It does not authorize or close that repair.

## Current boundary

```text
B8-A7-R6.5.3A authorization packet=PASSED / CLOSED
B8-A7-R6.5.3A execution=BLOCKED / NO PUBLICATION
R6.5.3A authorization=CONSUMED / NOT REUSABLE
persistent parent=EXISTS / EMPTY / MODE 0700
persistent authority root=NOT PUBLISHED
persistent candidate=NOT PUBLISHED
persistent R0=NOT PUBLISHED
staging root=REMOVED
installed-plugin recovery sourcePath=DANGLING
B8-A7-R6.5.3A.1 freeze-model repair=NOT STARTED
R6.5.3B recovery-source rebase execution=NOT AUTHORIZED
R6.5.3 candidate activation=NOT AUTHORIZED
Gateway stop/start/restart=NOT PERFORMED
OpenClaw install/reload=NOT PERFORMED
configuration mutation=NOT PERFORMED
memory-data mutation=NOT PERFORMED
B8-A7 sustained runtime authorization=WITHHELD / PERSONAL PROFILE REMEDIATION REQUIRED
B8-B removal=NOT AUTHORIZED
```
