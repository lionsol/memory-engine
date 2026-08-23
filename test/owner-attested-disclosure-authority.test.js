import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { composeCanonicalMemoryObject } from "../lib/canonical/memory-object.js";
import {
  ensureDisclosureAttestationsTable,
  ensureMemoryEngineTables,
} from "../lib/db/schema.js";
import {
  assertDisclosureAttestation,
  createDisclosureAttestationAuthorityProvider,
  deriveDisclosureAttestationBinding,
  getDisclosureAttestationById,
  validateDisclosureAttestationRecord,
} from "../lib/recall/disclosure/owner-attestation.js";
import {
  buildOwnerDisclosurePreview,
  projectCanonicalMemoryToOwnerDisclosureCardArtifact,
} from "../lib/recall/disclosure/owner-attestable-projection.js";
import { createOwnerDisclosureCommandHandler } from "../lib/recall/disclosure/owner-disclosure-command.js";

const MEMORY_ID = "owner-attestation-memory-001";
const LONG_SOURCE_TEXT = [
  "Owner-attestable disclosure preview content.",
  "This synthetic canonical source is deliberately longer than the bounded card summary.",
  "OWNER_ATTESTATION_SOURCE_SENTINEL_20260823",
  "The complete source must remain outside the preview response.",
].join(" ");

function canonicalMemory({ memoryId = MEMORY_ID, text = LONG_SOURCE_TEXT } = {}) {
  return composeCanonicalMemoryObject(
    {
      id: memoryId,
      path: "memory/projects/owner-attestation.md",
      source: "openclaw_core",
      start_line: 1,
      end_line: 4,
      hash: null,
      text,
      updated_at: 1755907200,
    },
    {
      chunk_id: memoryId,
      initial_confidence: 0.8,
      confidence: 0.8,
      last_confidence_update: 1755907200,
      base_tau: 90,
      hit_count: 0,
      is_archived: 0,
      is_protected: 0,
      conflict_flag: 0,
      category: "project",
    },
  );
}

function authContext(args) {
  return {
    args,
    isAuthorizedSender: true,
    senderIsOwner: true,
  };
}

function readReply(result) {
  assert.equal(typeof result?.text, "string");
  return JSON.parse(result.text);
}

function createCommandFixture() {
  const db = new Database(":memory:");
  ensureDisclosureAttestationsTable(db);
  let currentCanonical = canonicalMemory();
  let clock = 100;
  const calls = {
    canonical: 0,
    readonly: 0,
    writable: 0,
  };
  const handler = createOwnerDisclosureCommandHandler({
    getCanonicalMemoryById(memoryId) {
      calls.canonical += 1;
      if (memoryId !== currentCanonical.memory_id) return { ok: false, reason: "core_not_found" };
      return { ok: true, memory: currentCanonical };
    },
    withEngineDbReadonly(fn) {
      calls.readonly += 1;
      return fn(db);
    },
    withEngineDbWritable(fn) {
      calls.writable += 1;
      return fn(db);
    },
    now: () => clock,
  });
  return {
    db,
    calls,
    handler,
    get canonical() {
      return currentCanonical;
    },
    setCanonical(next) {
      currentCanonical = next;
    },
    setClock(next) {
      clock = next;
    },
  };
}

test("disclosure attestation schema is Engine-owned, isolated, and idempotent", () => {
  const coreDb = new Database(":memory:");
  const engineDb = new Database(":memory:");
  try {
    ensureDisclosureAttestationsTable(engineDb);
    ensureDisclosureAttestationsTable(engineDb);

    assert.equal(
      engineDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'disclosure_attestations'").get()?.name,
      "disclosure_attestations",
    );
    assert.equal(
      coreDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'disclosure_attestations'").get(),
      undefined,
    );
    assert.deepEqual(
      engineDb.prepare("PRAGMA database_list").all().map(row => row.name),
      ["main"],
    );

    const columns = engineDb.prepare("PRAGMA table_info(disclosure_attestations)").all().map(row => row.name);
    assert.ok(columns.includes("projection_kind"));
    assert.ok(columns.includes("projection_adapter_version"));
    assert.ok(columns.includes("authority_kind"));
    assert.ok(columns.includes("audience_scope"));
    assert.ok(columns.includes("state"));
  } finally {
    coreDb.close();
    engineDb.close();
  }
});

test("ensureMemoryEngineTables adds no inferred attestation rows", () => {
  const db = new Database(":memory:");
  try {
    ensureMemoryEngineTables(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM disclosure_attestations").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM memory_confidence").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM memory_events").get().count, 0);
  } finally {
    db.close();
  }
});

test("Owner projection uses the actual legacy_memory_card_v1 kind and is deterministic", () => {
  const canonical = canonicalMemory();
  const before = structuredClone(canonical);
  const first = buildOwnerDisclosurePreview(canonical);
  const second = buildOwnerDisclosurePreview(canonical);

  assert.deepEqual(first, second);
  assert.equal(first.artifact.surface, "DISCLOSURE_CARD");
  assert.equal(first.artifact.projection_kind, "legacy_memory_card_v1");
  assert.notEqual(first.artifact.projection_kind, "DISCLOSURE_CARD");
  assert.equal(first.artifact.provenance.adapter, "legacy_canonical_memory_card_v1");
  assert.equal(first.binding.projection_kind, "legacy_memory_card_v1");
  assert.equal(first.binding.projection_adapter_version, "legacy_canonical_memory_card_v1");
  assert.deepEqual(canonical, before);
  assert.equal(JSON.stringify(first).includes(canonical.source.text), false);
  assert.equal(Object.hasOwn(first.artifact.payload, "get_token"), false);
  assert.equal(Object.hasOwn(first.artifact.payload, "safe_to_disclose"), false);

  assert.doesNotThrow(() => projectCanonicalMemoryToOwnerDisclosureCardArtifact(canonical));
});

test("attestation assert, revoke, reassert, and exact-binding persistence are deterministic", () => {
  const db = new Database(":memory:");
  try {
    ensureDisclosureAttestationsTable(db);
    const canonical = canonicalMemory();
    const binding = buildOwnerDisclosurePreview(canonical).binding;

    const first = assertDisclosureAttestation(db, binding, { now: 100 });
    assert.equal(first.ok, true);
    assert.equal(first.changed, true);
    assert.equal(first.attestation.state, "active");
    assert.equal(first.attestation.projection_kind, "legacy_memory_card_v1");
    assert.equal(first.attestation.projection_adapter_version, "legacy_canonical_memory_card_v1");

    const repeat = assertDisclosureAttestation(db, binding, { now: 200 });
    assert.equal(repeat.changed, false);
    assert.equal(repeat.attestation.asserted_at, 100);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM disclosure_attestations").get().count, 1);

    const revoked = db.prepare("UPDATE disclosure_attestations SET state = 'revoked', revoked_at = 300, updated_at = 300 WHERE attestation_id = ?").run(binding.attestation_id);
    assert.equal(revoked.changes, 1);
    const reasserted = assertDisclosureAttestation(db, binding, { now: 400 });
    assert.equal(reasserted.changed, true);
    assert.equal(reasserted.attestation.state, "active");
    assert.equal(reasserted.attestation.asserted_at, 400);
    assert.equal(reasserted.attestation.revoked_at, null);

    const otherBinding = buildOwnerDisclosurePreview(canonicalMemory({ memoryId: "owner-attestation-memory-002" })).binding;
    assert.notEqual(otherBinding.attestation_id, binding.attestation_id);
    assert.equal(getDisclosureAttestationById(db, otherBinding.attestation_id), null);
  } finally {
    db.close();
  }
});

test("attestation validator fails closed for every binding, state, and artifact mismatch", () => {
  const db = new Database(":memory:");
  try {
    ensureDisclosureAttestationsTable(db);
    const canonical = canonicalMemory();
    const preview = buildOwnerDisclosurePreview(canonical);
    const asserted = assertDisclosureAttestation(db, preview.binding, { now: 100 }).attestation;

    const mutations = [
      ["memory_id", "wrong-memory"],
      ["canonical_id", "cmem:core:wrong"],
      ["source_content_hash", "sha256:wrong"],
      ["surface", "RAW_REFERENCE"],
      ["projection_schema_version", 99],
      ["projection_kind", "fake_projection_v1"],
      ["projection_kind", "DISCLOSURE_CARD"],
      ["projection_hash", "f".repeat(64)],
      ["projection_adapter_version", "fake_adapter_v1"],
      ["authority_kind", "CALLER_ASSERTION"],
      ["audience_scope", "SHARED"],
      ["attestation_schema_version", 99],
      ["policy_version", "old_policy_v0"],
    ];
    for (const [field, value] of mutations) {
      const result = validateDisclosureAttestationRecord(
        { ...asserted, [field]: value },
        preview.binding,
      );
      assert.equal(result.valid, false, `${field} must fail closed`);
      assert.ok(!result.reason.includes(LONG_SOURCE_TEXT));
    }

    assert.equal(
      validateDisclosureAttestationRecord({ ...asserted, state: "pending" }).valid,
      false,
    );
    assert.equal(
      validateDisclosureAttestationRecord({ ...asserted, state: "revoked", revoked_at: 200 }, preview.binding, { activeOnly: true }).valid,
      false,
    );
    assert.equal(
      deriveDisclosureAttestationBinding(canonical, {
        ...preview.artifact,
        payload: { ...preview.artifact.payload, text: LONG_SOURCE_TEXT },
      }).valid,
      false,
    );
    assert.equal(
      deriveDisclosureAttestationBinding(canonical, {
        ...preview.artifact,
        projection_schema_version: 99,
      }).valid,
      false,
    );
  } finally {
    db.close();
  }
});

test("source and payload changes invalidate old exact authority without loose matching", () => {
  const db = new Database(":memory:");
  try {
    ensureDisclosureAttestationsTable(db);
    const original = canonicalMemory();
    const originalPreview = buildOwnerDisclosurePreview(original);
    assertDisclosureAttestation(db, originalPreview.binding, { now: 100 });
    const provider = createDisclosureAttestationAuthorityProvider({
      withEngineDbReadonly: fn => fn(db),
    });

    const changedSource = canonicalMemory({ text: `${LONG_SOURCE_TEXT} SOURCE_CHANGED` });
    const changedSourcePreview = buildOwnerDisclosurePreview(changedSource);
    assert.notEqual(changedSourcePreview.projection_hash, originalPreview.projection_hash);
    assert.equal(provider.getSafeToDiscloseEvidence({
      canonicalMemory: changedSource,
      projectionArtifact: changedSourcePreview.artifact,
    }).safe_to_disclose, false);

    const changedPayload = {
      ...originalPreview.artifact,
      payload: {
        ...originalPreview.artifact.payload,
        title: "Changed bounded title",
      },
    };
    const changedPayloadResult = provider.getSafeToDiscloseEvidence({
      canonicalMemory: original,
      projectionArtifact: changedPayload,
    });
    assert.equal(changedPayloadResult.safe_to_disclose, false);
    assert.ok(["attestation_missing", "projection_hash_mismatch"].includes(changedPayloadResult.reason));
  } finally {
    db.close();
  }
});

test("authority provider is fail-closed, read-only, exact, and never returns capability decisions", () => {
  const canonical = canonicalMemory();
  const preview = buildOwnerDisclosurePreview(canonical);
  const db = new Database(":memory:");
  try {
    let writableCalls = 0;
    const provider = createDisclosureAttestationAuthorityProvider({
      withEngineDbReadonly: fn => fn(db),
    });
    const unavailable = provider.getSafeToDiscloseEvidence({
      canonicalMemory: canonical,
      projectionArtifact: preview.artifact,
    });
    assert.equal(unavailable.safe_to_disclose, false);
    assert.equal(unavailable.reason, "attestation_store_unavailable");
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'disclosure_attestations'").get(), undefined);
    assert.equal(writableCalls, 0);

    ensureDisclosureAttestationsTable(db);
    const missing = provider.getSafeToDiscloseEvidence({
      canonicalMemory: canonical,
      projectionArtifact: preview.artifact,
    });
    assert.deepEqual(missing, { safe_to_disclose: false, reason: "attestation_missing" });

    assertDisclosureAttestation(db, preview.binding, { now: 100 });
    const positive = provider.getSafeToDiscloseEvidence({
      canonicalMemory: canonical,
      projectionArtifact: preview.artifact,
    });
    assert.equal(positive.safe_to_disclose, true);
    assert.equal(positive.authority.audience_scope, "OWNER_SELF");
    assert.equal(Object.hasOwn(positive, "capability"), false);
    assert.equal(Object.hasOwn(positive, "selector"), false);
    assert.equal(Object.hasOwn(positive.authority, "source"), false);

    db.prepare("UPDATE disclosure_attestations SET policy_version = 'tampered' WHERE attestation_id = ?").run(preview.binding.attestation_id);
    const malformed = provider.getSafeToDiscloseEvidence({
      canonicalMemory: canonical,
      projectionArtifact: preview.artifact,
    });
    assert.equal(malformed.safe_to_disclose, false);
    assert.equal(malformed.reason, "policy_version_mismatch");
  } finally {
    db.close();
  }
});

test("Owner management command rejects unauthorized or bulk input before any read/write", async () => {
  const fixture = createCommandFixture();
  try {
    const before = { ...fixture.calls };
    const unauthorized = readReply(await fixture.handler({
      args: `preview ${MEMORY_ID}`,
      isAuthorizedSender: false,
      senderIsOwner: true,
    }));
    assert.deepEqual(unauthorized, { ok: false, reason: "owner_authorization_required" });
    assert.deepEqual(fixture.calls, before);

    const nonOwner = readReply(await fixture.handler({
      args: `preview ${MEMORY_ID}`,
      isAuthorizedSender: true,
      senderIsOwner: false,
    }));
    assert.deepEqual(nonOwner, { ok: false, reason: "owner_authorization_required" });
    assert.deepEqual(fixture.calls, before);

    const missingOwner = readReply(await fixture.handler({
      args: `preview ${MEMORY_ID}`,
      isAuthorizedSender: true,
    }));
    assert.deepEqual(missingOwner, { ok: false, reason: "owner_authorization_required" });
    assert.deepEqual(fixture.calls, before);

    const rejected = [
      `status all`,
      `preview *`,
      `assert ${MEMORY_ID} ${"f".repeat(64)} extra`,
      `status ${MEMORY_ID} extra`,
      `revoke all`,
    ];
    for (const args of rejected) {
      const result = readReply(await fixture.handler(authContext(args)));
      assert.equal(result.ok, false, args);
    }
    assert.deepEqual(fixture.calls, before);
  } finally {
    fixture.db.close();
  }
});

test("Owner management command previews, asserts exact hashes, reports status, revokes, and reasserts", async () => {
  const fixture = createCommandFixture();
  try {
    const preview = readReply(await fixture.handler(authContext(`preview ${MEMORY_ID}`)));
    assert.equal(preview.ok, true);
    assert.equal(preview.preview.surface, "DISCLOSURE_CARD");
    assert.equal(preview.preview.projection_kind, "legacy_memory_card_v1");
    assert.equal(preview.preview.projection_adapter_version, "legacy_canonical_memory_card_v1");
    assert.equal(JSON.stringify(preview).includes(LONG_SOURCE_TEXT), false);
    assert.equal(Object.hasOwn(preview.preview, "capability"), false);
    assert.equal(Object.hasOwn(preview.preview, "selector"), false);

    const writesBeforeWrongHash = fixture.calls.writable;
    const wrongHash = readReply(await fixture.handler(authContext(`assert ${MEMORY_ID} ${"f".repeat(64)}`)));
    assert.deepEqual(wrongHash, { ok: false, reason: "projection_hash_mismatch" });
    assert.equal(fixture.calls.writable, writesBeforeWrongHash);

    const asserted = readReply(await fixture.handler(authContext(
      `assert ${MEMORY_ID} ${preview.preview.projection_hash}`,
    )));
    assert.equal(asserted.ok, true);
    assert.equal(asserted.attestation.state, "active");
    assert.equal(asserted.attestation.projection_kind, "legacy_memory_card_v1");
    assert.equal(asserted.attestation.projection_adapter_version, "legacy_canonical_memory_card_v1");

    const status = readReply(await fixture.handler(authContext(`status ${MEMORY_ID}`)));
    assert.equal(status.ok, true);
    assert.equal(status.attestations.length, 1);
    assert.equal(status.attestations[0].attestation_id, preview.preview.attestation_id);

    const revoked = readReply(await fixture.handler(authContext(`revoke ${preview.preview.attestation_id}`)));
    assert.equal(revoked.ok, true);
    assert.equal(revoked.attestation.state, "revoked");

    fixture.setClock(200);
    const reasserted = readReply(await fixture.handler(authContext(
      `assert ${MEMORY_ID} ${preview.preview.projection_hash}`,
    )));
    assert.equal(reasserted.ok, true);
    assert.equal(reasserted.attestation.state, "active");
    assert.equal(reasserted.attestation.asserted_at, 200);

    const provider = createDisclosureAttestationAuthorityProvider({
      withEngineDbReadonly: fn => fn(fixture.db),
    });
    const evidence = provider.getSafeToDiscloseEvidence({
      canonicalMemory: fixture.canonical,
      projectionArtifact: buildOwnerDisclosurePreview(fixture.canonical).artifact,
    });
    assert.equal(evidence.safe_to_disclose, true);
  } finally {
    fixture.db.close();
  }
});

test("stale Owner preview hash produces no write", async () => {
  const fixture = createCommandFixture();
  try {
    const preview = readReply(await fixture.handler(authContext(`preview ${MEMORY_ID}`)));
    fixture.setCanonical(canonicalMemory({ text: `${LONG_SOURCE_TEXT} NEW_CANONICAL_VERSION` }));
    const writesBefore = fixture.calls.writable;
    const stale = readReply(await fixture.handler(authContext(
      `assert ${MEMORY_ID} ${preview.preview.projection_hash}`,
    )));
    assert.deepEqual(stale, { ok: false, reason: "projection_hash_mismatch" });
    assert.equal(fixture.calls.writable, writesBefore);
    assert.equal(fixture.calls.readonly, 0);
  } finally {
    fixture.db.close();
  }
});
