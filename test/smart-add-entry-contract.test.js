import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  appendSmartAdd as appendToolSmartAdd,
  readSmartAddFingerprints as readToolSmartAddFingerprints,
} from "../smart-add.js";
import { buildSmartAddFingerprint as buildToolSmartAddFingerprint } from "../smart-add-fingerprint.js";

const require = createRequire(import.meta.url);
const contract = require("../lib/smart-add-entry-contract.cjs");
const checkpointSmartAddWriter = require("../lib/checkpoint/smart-add-writer.js");
const checkpointRuntime = require("../lib/checkpoint/runtime");
const rawLog = require("../lib/checkpoint/raw-log.js");
const smartAddIdentity = require("../lib/checkpoint/smart-add-entry-identity.js");

function makeRoot(prefix = "memory-engine-smart-add-contract-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function canonical(text, category, isProtected) {
  return contract.buildSmartAddFingerprint(text, category, isProtected);
}

test("tool and checkpoint adapters share the canonical 16-character fingerprint contract", () => {
  const text = "  line one\rline two\r\n  ";
  const category = " Preference ";
  const expected = canonical(text, category, true);

  assert.equal(buildToolSmartAddFingerprint(text, category, true), expected);
  assert.equal(
    checkpointSmartAddWriter.smartAddFingerprint({
      text,
      category,
      protected: true,
      provenance: "different",
      entryId: "different-entry",
      kg_data: "different metadata",
    }),
    expected,
  );
  assert.match(expected, /^[a-f0-9]{16}$/);
  assert.equal(canonical("line one\nline two", "preference", true), expected);
  assert.equal(canonical("line one\nline two", "PREFERENCE", true), expected);
  assert.notEqual(canonical("line one\nline two", "preference", false), expected);
});

test("canonical renderer is heading-first and both parsers retain entry identity", () => {
  const entry = contract.renderSmartAddEntry({
    entryId: "entry-1",
    category: " Preference ",
    isProtected: true,
    provenance: "Agent_Smart_Add",
    text: "line one\rline two",
    kg_data: '{"source":"test"}',
  });
  const content = `# Smart Added Memory\n\n${entry}`;
  const headingIndex = entry.indexOf("## entry-1");
  const fingerprintIndex = entry.indexOf("<!-- smart-add-fingerprint:");
  assert.equal(headingIndex >= 0, true);
  assert.equal(fingerprintIndex > headingIndex, true);
  assert.equal(entry.indexOf("Provenance: agent_smart_add") < fingerprintIndex, true);

  const parsedEntries = rawLog.parseSmartAddEntries(content);
  assert.equal(parsedEntries.length, 1);
  assert.deepEqual(parsedEntries[0], {
    entryId: "entry-1",
    category: "preference",
    provenance: "agent_smart_add",
    isProtected: true,
    fingerprint: parsedEntries[0].fingerprint,
    kg_data: '{"source":"test"}',
    text: "line one\nline two",
    raw: parsedEntries[0].raw,
  });
  assert.match(parsedEntries[0].fingerprint, /^[a-f0-9]{16}$/);

  const blocks = smartAddIdentity.parseCanonicalSmartAddBlocks(content);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].entryId, "entry-1");
  assert.equal(blocks[0].category, "preference");
  assert.equal(blocks[0].provenance, "agent_smart_add");
  assert.equal(blocks[0].startLine, 3);
  assert.equal(blocks[0].endLine > blocks[0].startLine, true);
});

test("production and checkpoint writers render the same canonical entry body", async () => {
  const root = makeRoot();
  const toolDir = resolve(root, "tool");
  const checkpointDir = resolve(root, "checkpoint");
  const toolPath = resolve(toolDir, "2026-06-18.md");
  const text = "shared writer body";
  const category = "preference";
  const isProtected = true;
  const fingerprint = canonical(text, category, isProtected);

  const toolResult = await appendToolSmartAdd({
    fileDir: toolDir,
    filePath: toolPath,
    entryId: "shared-entry",
    category,
    isProtected,
    text,
    provenance: "agent_smart_add",
    syncCli: false,
  });
  assert.equal(toolResult.appended, true);

  await checkpointRuntime.withRuntime({
    smartAddDir: checkpointDir,
    generatedSmartAddDir: resolve(root, "generated"),
    coreDbPath: resolve(root, "core.sqlite"),
    engineDbPath: resolve(root, "engine.sqlite"),
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    const entryId = checkpointSmartAddWriter.appendSmartAdd(text, category, {
      entryId: "shared-entry",
      protected: isProtected,
      provenance: checkpointSmartAddWriter.SMART_ADD_PROVENANCE.AGENT_SMART_ADD,
    });
    assert.equal(entryId, "shared-entry");
  });

  const toolEntry = rawLog.parseSmartAddEntries(readFileSync(toolPath, "utf8"))[0];
  const checkpointEntry = rawLog.parseSmartAddEntries(
    readFileSync(resolve(checkpointDir, "2026-06-18.md"), "utf8"),
  )[0];
  assert.equal(toolEntry.raw, checkpointEntry.raw);
  assert.equal(toolEntry.fingerprint, fingerprint);
});

test("production appendSmartAdd writes one file header before canonical entries", async () => {
  const root = makeRoot();
  const fileDir = resolve(root, "tool-header");
  const filePath = resolve(fileDir, "2026-06-18.md");
  let syncCalls = 0;

  const firstResult = await appendToolSmartAdd({
    fileDir,
    filePath,
    entryId: "first-entry",
    category: " Preference ",
    isProtected: false,
    text: "first body",
    provenance: "agent_smart_add",
    syncCli: false,
    syncRunner: async () => {
      syncCalls += 1;
    },
  });
  const secondResult = await appendToolSmartAdd({
    fileDir,
    filePath,
    entryId: "second-entry",
    category: "episodic",
    isProtected: false,
    text: "second body",
    provenance: "agent_smart_add",
    syncCli: false,
    syncRunner: async () => {
      syncCalls += 1;
    },
  });

  assert.equal(firstResult.appended, true);
  assert.equal(secondResult.appended, true);
  const content = readFileSync(filePath, "utf8");
  const header = "# Smart Added Memory\n\n";
  assert.equal(content.startsWith(header), true);
  assert.equal((content.match(/^# Smart Added Memory$/gm) || []).length, 1);
  assert.equal(content.indexOf("## first-entry") >= header.length, true);
  assert.equal(content.indexOf("## second-entry") > content.indexOf("## first-entry"), true);

  const entries = rawLog.parseSmartAddEntries(content);
  assert.deepEqual(entries.map(({ entryId, category, provenance, text }) => ({
    entryId,
    category,
    provenance,
    text,
  })), [
    {
      entryId: "first-entry",
      category: "preference",
      provenance: "agent_smart_add",
      text: "first body",
    },
    {
      entryId: "second-entry",
      category: "episodic",
      provenance: "agent_smart_add",
      text: "second body",
    },
  ]);
  assert.equal(syncCalls, 0);
});

test("historical fingerprint comments and layouts remain readable and dedupe without rewriting", async () => {
  const root = makeRoot();
  const toolPath = resolve(root, "tool-history.md");
  const checkpointDir = resolve(root, "checkpoint-history");
  const checkpointPath = resolve(checkpointDir, "2026-06-18.md");
  const toolCanonical = canonical("historical tool body", "preference", true);
  const oldCheckpointFingerprint = "ABCDEF12".repeat(8);
  const historicalTool = [
    "# Smart Added Memory",
    "",
    "## historical-tool",
    "",
    "Category: Preference | Protected",
    "Provenance: agent_smart_add",
    `<!-- smart-add-fingerprint: ${toolCanonical.toUpperCase()} -->`,
    "",
    "historical tool body",
    "",
  ].join("\n");
  const historicalCheckpoint = [
    "# Smart Added Memory",
    "",
    `<!-- smart-add-fingerprint: ${oldCheckpointFingerprint} -->`,
    "## historical-checkpoint",
    "",
    "Category: raw_log",
    "Provenance: checkpoint_generated",
    "",
    "historical checkpoint body",
    "",
  ].join("\n");
  mkdirSync(checkpointDir, { recursive: true });
  writeFileSync(toolPath, historicalTool);
  writeFileSync(checkpointPath, historicalCheckpoint);

  const parsedHistorical = rawLog.parseSmartAddEntries(historicalCheckpoint);
  assert.equal(parsedHistorical[0].entryId, "historical-checkpoint");
  assert.equal(parsedHistorical[0].category, "raw_log");
  assert.equal(parsedHistorical[0].provenance, "checkpoint_generated");
  assert.equal(parsedHistorical[0].text, "historical checkpoint body");

  const toolFingerprints = readToolSmartAddFingerprints(toolPath);
  assert.equal(toolFingerprints.has(toolCanonical), true);
  assert.equal(toolFingerprints.has(toolCanonical.toUpperCase().toLowerCase()), true);

  await checkpointRuntime.withRuntime({
    smartAddDir: resolve(root, "smart-add"),
    generatedSmartAddDir: checkpointDir,
    coreDbPath: resolve(root, "core.sqlite"),
    engineDbPath: resolve(root, "engine.sqlite"),
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    const before = readFileSync(checkpointPath, "utf8");
    const fingerprints = checkpointSmartAddWriter.readSmartAddFingerprints("2026-06-18", {
      provenance: checkpointSmartAddWriter.SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
    });
    const checkpointCanonical = canonical("historical checkpoint body", "raw_log", false);
    assert.equal(fingerprints.has(oldCheckpointFingerprint.toLowerCase()), true);
    assert.equal(fingerprints.has(checkpointCanonical), true);
    assert.equal(checkpointSmartAddWriter.appendSmartAdd(
      "historical checkpoint body",
      "raw_log",
      { entryId: "new-entry", provenance: checkpointSmartAddWriter.SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED },
    ), null);
    assert.equal(readFileSync(checkpointPath, "utf8"), before);
  });

  const beforeTool = readFileSync(toolPath, "utf8");
  const toolResult = await appendToolSmartAdd({
    fileDir: root,
    filePath: toolPath,
    entryId: "new-tool-entry",
    category: "preference",
    isProtected: true,
    text: "historical tool body",
    fingerprint: toolCanonical,
    syncCli: false,
  });
  assert.equal(toolResult.appended, false);
  assert.equal(toolResult.reason, "fingerprint");
  assert.equal(readFileSync(toolPath, "utf8"), beforeTool);
});

test("production writer rejects a supplied noncanonical fingerprint before touching the file", async () => {
  const root = makeRoot();
  const fileDir = resolve(root, "not-created");
  const filePath = resolve(fileDir, "2026-06-18.md");
  let syncCalls = 0;

  await assert.rejects(
    appendToolSmartAdd({
      fileDir,
      filePath,
      entryId: "mismatch-entry",
      category: "raw_log",
      isProtected: false,
      text: "mismatch body",
      fingerprint: "0000000000000000",
      syncCli: true,
      syncRunner: async () => {
        syncCalls += 1;
      },
    }),
    error => error.code === "SMART_ADD_FINGERPRINT_MISMATCH",
  );
  assert.equal(existsSync(fileDir), false);
  assert.equal(existsSync(filePath), false);
  assert.equal(syncCalls, 0);
});

test("writers dedupe across the shared canonical identity in both directions", async () => {
  const root = makeRoot();
  const sharedDir = resolve(root, "shared");
  const filePath = resolve(sharedDir, "2026-06-18.md");
  const text = "cross writer identity";
  const category = "raw_log";
  const fingerprint = canonical(text, category, false);

  const firstTool = await appendToolSmartAdd({
    fileDir: sharedDir,
    filePath,
    entryId: "tool-first",
    category,
    isProtected: false,
    text,
    fingerprint,
    syncCli: false,
  });
  assert.equal(firstTool.appended, true);
  await checkpointRuntime.withRuntime({
    smartAddDir: sharedDir,
    generatedSmartAddDir: resolve(root, "generated"),
    coreDbPath: resolve(root, "core.sqlite"),
    engineDbPath: resolve(root, "engine.sqlite"),
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(checkpointSmartAddWriter.appendSmartAdd(text, category, {
      entryId: "checkpoint-after-tool",
      provenance: checkpointSmartAddWriter.SMART_ADD_PROVENANCE.AGENT_SMART_ADD,
    }), null);
  });

  const reverseDir = resolve(root, "reverse");
  const reversePath = resolve(reverseDir, "2026-06-18.md");
  await checkpointRuntime.withRuntime({
    smartAddDir: reverseDir,
    generatedSmartAddDir: resolve(root, "reverse-generated"),
    coreDbPath: resolve(root, "core2.sqlite"),
    engineDbPath: resolve(root, "engine2.sqlite"),
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.equal(checkpointSmartAddWriter.appendSmartAdd(text, category, {
      entryId: "checkpoint-first",
      provenance: checkpointSmartAddWriter.SMART_ADD_PROVENANCE.AGENT_SMART_ADD,
    }), "checkpoint-first");
  });
  const reverseResult = await appendToolSmartAdd({
    fileDir: reverseDir,
    filePath: reversePath,
    entryId: "tool-after-checkpoint",
    category,
    isProtected: false,
    text,
    fingerprint,
    syncCli: false,
  });
  assert.equal(reverseResult.appended, false);
  assert.equal(reverseResult.reason, "fingerprint");
});
