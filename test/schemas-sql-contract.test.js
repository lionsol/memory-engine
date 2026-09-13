import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schema = readFileSync(resolve("schemas.sql"), "utf8");

test("schemas.sql targets the Engine DB and never instructs applying Engine schema to Core main.sqlite", () => {
  assert.match(
    schema,
    /sqlite3 ~\/\.openclaw\/memory\/memory-engine\/memory-engine\.sqlite < schemas\.sql/,
  );
  assert.doesNotMatch(
    schema,
    /sqlite3 ~\/\.openclaw\/memory\/main\.sqlite < schemas\.sql/,
  );
  assert.match(schema, /never apply this schema to OpenClaw Core main\.sqlite/);
});
