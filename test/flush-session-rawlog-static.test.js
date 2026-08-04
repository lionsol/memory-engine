import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const FLUSH_SCRIPT = new URL("../bin/flush-session-rawlog.js", import.meta.url);

function dateStr(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("flush-session-rawlog writes canonical session_flush input without creating Core or Engine DBs", () => {
  const home = mkdtempSync(join(tmpdir(), "memory-engine-flush-"));
  try {
    const timestamp = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const targetDate = dateStr(timestamp);
    const sessionPath = join(home, ".openclaw/agents/main/sessions/fixture.jsonl");
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, [
      JSON.stringify({
        type: "message",
        timestamp: timestamp.toISOString(),
        message: { role: "user", content: "remember the canonical flush fixture" },
      }),
      JSON.stringify({
        type: "message",
        timestamp: new Date(timestamp.getTime() + 1000).toISOString(),
        message: { role: "assistant", content: "fixture acknowledged" },
      }),
      "",
    ].join("\n"));
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(sessionPath, old, old);

    const result = spawnSync(process.execPath, [FLUSH_SCRIPT.pathname, "--checkpoint", "--target-date", targetDate], {
      cwd: home,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.mode, "checkpoint");
    assert.equal(output.targetDate, targetDate);
    assert.equal(output.sessionsScanned, 1);
    assert.equal(output.targetDateEntriesWritten, 1);
    assert.equal(output.outOfTargetDateGroupsSkipped, 0);
    assert.equal(output.results.length, 1);
    assert.equal(output.results[0].coreDbWriteDisabled, true);
    assert.equal(output.results[0].dbEntriesWritten, 0);

    const smartAddPath = join(home, `.openclaw/workspace/memory/smart-add/${targetDate}.md`);
    assert.equal(existsSync(smartAddPath), true);
    const content = readFileSync(smartAddPath, "utf8");
    assert.match(content, /Provenance: session_flush/);
    assert.match(content, /remember the canonical flush fixture/);

    assert.equal(existsSync(join(home, ".openclaw/memory/main.sqlite")), false);
    assert.equal(existsSync(join(home, ".openclaw/memory/memory-engine/memory-engine.sqlite")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("checkpoint flush writes only the target-date group from a multi-date session", () => {
  const home = mkdtempSync(join(tmpdir(), "memory-engine-flush-target-date-"));
  const targetDate = "2026-06-17";
  try {
    const sessionPath = join(home, ".openclaw/agents/main/sessions/multi-date.jsonl");
    mkdirSync(dirname(sessionPath), { recursive: true });
    const messages = [
      ["2026-06-16T12:00:00+08:00", "the day before target"],
      ["2026-06-17T12:00:00+08:00", "the target day"],
      ["2026-06-18T12:00:00+08:00", "the day after target"],
    ];
    writeFileSync(sessionPath, `${messages.map(([timestamp, content]) => JSON.stringify({
      type: "message",
      timestamp,
      message: { role: "user", content },
    })).join("\n")}\n`);
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(sessionPath, old, old);

    const result = spawnSync(process.execPath, [
      FLUSH_SCRIPT.pathname,
      "--checkpoint",
      "--target-date",
      targetDate,
    ], {
      cwd: home,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.targetDate, targetDate);
    assert.equal(output.sessionsScanned, 1);
    assert.equal(output.targetDateEntriesWritten, 1);
    assert.equal(output.outOfTargetDateGroupsSkipped, 2);
    assert.equal(output.results[0].outOfTargetDateGroupsSkipped, 2);

    const targetPath = join(home, `.openclaw/workspace/memory/smart-add/${targetDate}.md`);
    assert.equal(existsSync(targetPath), true);
    assert.match(readFileSync(targetPath, "utf8"), /Provenance: session_flush/);
    assert.equal(existsSync(join(home, ".openclaw/workspace/memory/smart-add/2026-06-16.md")), false);
    assert.equal(existsSync(join(home, ".openclaw/workspace/memory/smart-add/2026-06-18.md")), false);
    assert.equal(existsSync(join(home, ".openclaw/memory/main.sqlite")), false);
    assert.equal(existsSync(join(home, ".openclaw/memory/memory-engine/memory-engine.sqlite")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("checkpoint flush requires target date before scanning or writing", () => {
  const home = mkdtempSync(join(tmpdir(), "memory-engine-flush-required-date-"));
  try {
    const sessionPath = join(home, ".openclaw/agents/main/sessions/fixture.jsonl");
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, `${JSON.stringify({
      type: "message",
      timestamp: "2026-06-17T12:00:00+08:00",
      message: { role: "user", content: "must not flush without target" },
    })}\n`);
    const result = spawnSync(process.execPath, [FLUSH_SCRIPT.pathname, "--checkpoint"], {
      cwd: home,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /target-date required/i);
    assert.equal(existsSync(join(home, ".openclaw/workspace/memory/smart-add")), false);
    assert.equal(existsSync(join(home, ".openclaw/memory/openclaw-agent.sqlite")), false);
    assert.equal(existsSync(join(home, ".openclaw/memory/main.sqlite")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("checkpoint flush rejects invalid target dates without writing files", () => {
  for (const targetDate of ["2026-02-30", "invalid"]) {
    const home = mkdtempSync(join(tmpdir(), "memory-engine-flush-invalid-date-"));
    try {
      const sessionPath = join(home, ".openclaw/agents/main/sessions/fixture.jsonl");
      mkdirSync(dirname(sessionPath), { recursive: true });
      writeFileSync(sessionPath, `${JSON.stringify({
        type: "message",
        timestamp: "2026-06-17T12:00:00+08:00",
        message: { role: "user", content: "must not flush invalid date" },
      })}\n`);
      const result = spawnSync(process.execPath, [
        FLUSH_SCRIPT.pathname,
        "--checkpoint",
        "--target-date",
        targetDate,
      ], {
        cwd: home,
        env: { ...process.env, HOME: home },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /valid YYYY-MM-DD/i);
      assert.equal(existsSync(join(home, ".openclaw/workspace/memory/smart-add")), false);
      assert.equal(existsSync(join(home, ".openclaw/memory/main.sqlite")), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});
