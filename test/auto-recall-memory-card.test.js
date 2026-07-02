import test from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_CARD_SCHEMA_VERSION,
  MEMORY_OBJECT_SCHEMA_VERSION,
  isInjectableMemoryCard,
  normalizeCandidateToMemoryObject,
  projectCandidateToMemoryCard,
  projectMemoryObjectToCard,
} from "../lib/recall/auto-recall-memory-card.js";

function projectCandidate(overrides = {}, options = {}) {
  return projectCandidateToMemoryCard({
    id: "abc123def4567890",
    text: "Category: project\nP3 freeze completed with replay, feedback, expansion, commit, and observation.",
    path: "memory/projects/memory-engine.md",
    start_line: 12,
    end_line: 18,
    category: "project",
    confidence: 0.82,
    final_score: 0.74,
    sources: ["fts", "kg"],
    ...overrides,
  }, {
    agentScope: "edi",
    traceId: "trace_p4",
    retrievalRank: 1,
    ...options,
  });
}

test("active recall candidate projects to memory object and injectable card", () => {
  const { memory_object: object, memory_card: card, side_effects } = projectCandidate();

  assert.equal(object.schema_version, MEMORY_OBJECT_SCHEMA_VERSION);
  assert.equal(object.object_id, "memobj_abc123def4567890");
  assert.equal(object.memory_id, "abc123def4567890");
  assert.equal(object.source.path, "memory/projects/memory-engine.md");
  assert.equal(object.source.line_start, 12);
  assert.equal(object.source.line_end, 18);
  assert.equal(object.source.bucket, "projects");
  assert.equal(object.classification.category, "project");
  assert.equal(object.classification.kind, "project_state");
  assert.equal(object.classification.scope, "project_state");
  assert.equal(object.classification.agent_scope, "edi");
  assert.equal(object.classification.lifecycle_state, "active");
  assert.equal(object.policy.disclosure_level, "memory_card");
  assert.equal(object.policy.can_inject_card, true);
  assert.equal(object.policy.can_get_full_content, true);
  assert.equal(object.policy.can_reinforce_on_citation, true);
  assert.deepEqual(object.confidence.signals, ["fts", "kg"]);
  assert.equal(object.debug.retrieval_rank, 1);
  assert.equal(object.debug.trace_id, "trace_p4");

  assert.equal(card.schema_version, MEMORY_CARD_SCHEMA_VERSION);
  assert.equal(card.card_id, "memcard_abc123def4567890");
  assert.equal(card.memory_id, "abc123def4567890");
  assert.equal(card.source_hint, "memory/projects/memory-engine.md:12-18");
  assert.equal(card.category, "project");
  assert.equal(card.kind, "project_state");
  assert.equal(card.confidence_score, 0.82);
  assert.equal(card.disclosure_level, "memory_card");
  assert.equal(card.get_token, "memory_engine_get:abc123def4567890");
  assert.equal(isInjectableMemoryCard(card), true);

  assert.deepEqual(side_effects, {
    db_writes: false,
    memory_file_mutation: false,
    dataset_file_mutation: false,
    retrieval: false,
    injection: false,
    cleanup_apply: false,
    archive: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
    runtime_report_files: false,
  });
});

test("projection is deterministic for the same candidate", () => {
  const first = projectCandidate();
  const second = projectCandidate();

  assert.deepEqual(first.memory_object, second.memory_object);
  assert.deepEqual(first.memory_card, second.memory_card);
});

test("raw-log-like candidates get safe withheld card text instead of raw body", () => {
  const { memory_object: object, memory_card: card } = projectCandidate({
    id: "rawlog1234567890",
    path: "memory/smart-add/2026-07-01.md",
    category: "raw_log",
    text: "2026-07-01 10:00:00 ERROR request failed\nTraceback at Object.handle (/tmp/runtime/index.js:42)",
    confidence: 0.6,
  });

  assert.equal(object.source.bucket, "smart_add");
  assert.equal(object.classification.kind, "diagnostic");
  assert.equal(object.card.risk_flags.includes("raw_log_like"), true);
  assert.equal(object.card.risk_flags.includes("tool_output_like"), true);
  assert.match(card.summary, /withheld/i);
  assert.doesNotMatch(card.summary, /Traceback|Object\.handle|2026-07-01 10:00:00/);
  assert.equal(card.get_token, "memory_engine_get:rawlog1234567890");
});

test("dreaming, archived, quarantined, and stale candidates are not injectable", () => {
  const cases = [
    {
      name: "dreaming",
      candidate: {
        id: "dream123",
        path: "memory/dreaming/2026-07-01.md",
        category: "dreaming",
        text: "dreaming body should not be disclosed",
      },
      flag: "dreaming_artifact",
    },
    {
      name: "archived",
      candidate: {
        id: "arch123",
        path: "memory/projects/old.md",
        is_archived: 1,
        text: "archived body",
      },
      flag: "archived",
    },
    {
      name: "quarantined",
      candidate: {
        id: "quar123",
        path: "memory/projects/quarantine.md",
        is_quarantined: true,
        text: "quarantined body",
      },
      flag: "quarantined",
    },
    {
      name: "stale",
      candidate: {
        id: "stale123",
        path: "memory/daily.md",
        stale_index_candidate: true,
        text: "stale body",
      },
      flag: "stale_index_candidate",
    },
  ];

  for (const item of cases) {
    const { memory_object: object, memory_card: card } = projectCandidate(item.candidate);
    assert.equal(object.card.risk_flags.includes(item.flag), true, item.name);
    assert.equal(object.policy.disclosure_level, "none", item.name);
    assert.equal(object.policy.can_inject_card, false, item.name);
    assert.equal(object.policy.can_reinforce_on_citation, false, item.name);
    assert.equal(card.disclosure_level, "none", item.name);
    assert.equal(card.get_token, null, item.name);
    assert.equal(isInjectableMemoryCard(card), false, item.name);
  }
});

test("cross-agent scope is risk-flagged but shared scope is allowed", () => {
  const crossAgent = projectCandidate({
    id: "planner123",
    agent_scope: "task-planner",
    path: "memory/projects/planner.md",
    text: "Planner-only decision.",
  }, { agentScope: "edi" });

  assert.equal(crossAgent.memory_object.card.risk_flags.includes("cross_agent_scope"), true);
  assert.equal(crossAgent.memory_object.classification.agent_scope, "task-planner");

  const shared = projectCandidate({
    id: "shared123",
    agent_scope: "shared",
    path: "memory/projects/shared.md",
    text: "Shared project decision.",
  }, { agentScope: "edi" });

  assert.equal(shared.memory_object.card.risk_flags.includes("cross_agent_scope"), false);
  assert.equal(shared.memory_object.classification.agent_scope, "shared");
});

test("low confidence and conflict flags are carried into card risk flags", () => {
  const { memory_object: object, memory_card: card } = projectCandidate({
    id: "lowconflict123",
    confidence: 0.12,
    conflict_flag: 1,
    text: "Potentially stale conflicting memory.",
  });

  assert.equal(object.card.risk_flags.includes("low_confidence"), true);
  assert.equal(object.card.risk_flags.includes("conflict_flag"), true);
  assert.equal(card.risk_flags.includes("low_confidence"), true);
  assert.equal(card.risk_flags.includes("conflict_flag"), true);
});

test("projectMemoryObjectToCard is a strict card projection without full content", () => {
  const object = normalizeCandidateToMemoryObject({
    id: "fulltext1234567890",
    path: "memory/projects/full.md",
    text: "This is a long full memory body that should not be exposed beyond the compact summary projection.",
    category: "project",
    confidence: 0.9,
  }, { agentScope: "edi" });

  const card = projectMemoryObjectToCard(object);

  assert.equal(card.memory_id, "fulltext1234567890");
  assert.equal(card.get_token, "memory_engine_get:fulltext1234567890");
  assert.equal(Object.hasOwn(card, "text"), false);
  assert.equal(Object.hasOwn(card, "full_content"), false);
  assert.equal(Object.hasOwn(card, "content_ref"), false);
});
