# Release and Version Policy

> **Status: Current release policy**

This document defines how memory-engine distinguishes an official release from unreleased work on top of that release.

## Release baseline

When this policy was introduced, the current official release line was `v0.8.22-memory-process-boundary-audit`, with semantic release number `0.8.22`.

This is a historical adoption baseline, not a permanently hardcoded current-version declaration. Resolve the current release with `npm run version:status`.

Commits after the latest reachable release tag, including local or unpushed commits, are **unreleased changes**. They do not create a new release number by themselves.

## Authoritative release identity

Release identity is derived from the nearest release tag that is reachable from the current commit.

Use:

```bash
git describe --tags --match 'v[0-9]*' --abbrev=0
```

This ancestry rule is required because the repository contains older `v1.0.x` tags on a different, non-ancestor history. Selecting the numerically largest tag across all refs would incorrectly identify the current release line.

A release tag must start with a semantic version and may include a descriptive suffix:

```text
v<major>.<minor>.<patch>
v<major>.<minor>.<patch>-<release-description>
```

Examples:

```text
v0.8.22-memory-process-boundary-audit
v0.8.23
```

The semantic version is the leading `major.minor.patch` portion.

## Manifest policy

`package.json.version` and the root package versions in `package-lock.json` record the latest official release number.

While unreleased commits exist after the latest reachable release tag:

- the manifest version remains equal to that latest released version;
- Git commit identity and dirty state distinguish the working build from the release commit;
- unreleased work must not silently increment the manifest version;
- README headings must not embed the version number.

Before creating the next release tag, update both manifests to the intended semantic version in the same reviewed release change.

## Build identity

Use the following distinction:

| Identity | Meaning | Source |
| --- | --- | --- |
| Release version | Latest official release on the current ancestry | Reachable Git release tag |
| Manifest version | Latest official release number | `package.json` and `package-lock.json` |
| Build identity | Exact checked-out code, including commits after release and dirty state | `git describe --tags --always --dirty` |

For example, a checkout several commits after `v0.8.22-memory-process-boundary-audit` is still release version `0.8.22`, but its build identity includes the additional commit distance and commit hash.

## Required checks

Run:

```bash
npm run version:status
npm run version:check
```

`version:status` reports:

- nearest reachable release tag;
- semantic release version;
- manifest versions;
- number of commits after the release tag;
- current commit;
- dirty state;
- full build identity.

`version:check` fails when:

- no reachable release tag can be resolved;
- the tag does not begin with a valid semantic version;
- `package.json.version` differs from the reachable release version;
- either root version in `package-lock.json` differs from the reachable release version.

Unreleased commits and a dirty working tree are reported but do not fail the check.

## Release procedure

1. Confirm the intended next semantic version.
2. Update `package.json.version` and both root `package-lock.json` version fields.
3. Run targeted tests, `npm test`, `npm run check`, and `npm run version:check`.
4. Commit the release change.
5. Create a tag beginning with the same semantic version.
6. Push the commit and tag.
7. Verify that `npm run version:status` reports zero commits after the new tag on the released commit.

Do not create a new version number merely because local development has advanced beyond the latest tag.
