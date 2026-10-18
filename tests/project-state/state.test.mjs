import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  statePath,
  sessionsDir,
  sessionRecordPath,
  sanitizeSessionId,
  stableStringify,
  loadState,
  writeStateAtomic,
  createSession,
  finalizeSession,
  listSessions,
} from "../../extensions/project-state/state.mjs";
import { SchemaError, SCHEMA_VERSION } from "../../extensions/project-state/schema.mjs";

const temp = mkdtempSync(join(tmpdir(), "project-state-test-"));

// ── 1. Paths ──
assert.equal(statePath(join(temp, ".pi")), join(temp, ".pi", "state.json"));
assert.equal(sessionsDir(join(temp, ".pi")), join(temp, ".pi", "sessions"));
assert.equal(sessionRecordPath(join(temp, ".pi"), "a-b"), join(temp, ".pi", "sessions", "a-b.json"));
console.log("ok - path helpers point at .pi/state.json and .pi/sessions/<id>.json");

// ── 2. Missing .pi → loadState returns undefined without creating anything ──
assert.equal(loadState(join(temp, "missing-pi")), undefined);
assert.equal(existsSync(join(temp, "missing-pi")), false);
console.log("ok - loadState returns undefined for a missing .pi directory");

// ── 3. State write/read round-trips with schemaVersion, creating .pi ──
const piDir = join(temp, ".pi");
const state = {
  schemaVersion: SCHEMA_VERSION,
  branch: "spec/10-x",
  activeSpec: { number: 10 },
  phase: "in-progress",
  lastSessionId: null,
  pendingWork: null,
  checks: null,
  updatedAt: "2026-09-17T00:00:00.000Z",
};
writeStateAtomic(piDir, state);
const loaded = loadState(piDir);
assert.equal(loaded.branch, "spec/10-x");
assert.deepEqual(loaded.activeSpec, { number: 10 });
assert.equal(loaded.schemaVersion, 1);
console.log("ok - writeStateAtomic/loadState round-trip state with schemaVersion");

// ── 4. Atomic serialization is stable regardless of key insertion order ──
const a = { schemaVersion: 1, branch: "x", activeSpec: { number: 1 }, phase: null };
const b = { phase: null, activeSpec: { number: 1 }, schemaVersion: 1, branch: "x" };
assert.equal(stableStringify(a), stableStringify(b));
console.log("ok - stableStringify is deterministic regardless of key order");

// ── 5. Malformed state.json is rejected safely ──
const badPi = join(temp, "bad-pi");
mkdirSync(badPi, { recursive: true });
writeFileSync(statePath(badPi), "{ not json", "utf-8");
assert.throws(() => loadState(badPi), SchemaError);
writeFileSync(statePath(badPi), JSON.stringify({ branch: "x" }), "utf-8"); // no schemaVersion
assert.throws(() => loadState(badPi), SchemaError);
writeFileSync(statePath(badPi), JSON.stringify({ schemaVersion: 99, branch: "x" }), "utf-8");
assert.throws(() => loadState(badPi), SchemaError);
console.log("ok - loadState rejects malformed, missing-version, and unsupported state files");

// ── 6. Session creation produces a filesystem-safe, stable id ──
assert.equal(sanitizeSessionId("abc-123"), "abc-123");
// Dots are valid filename characters, so they survive; only separators collapse.
assert.equal(sanitizeSessionId("../../etc/passwd"), "..-..-etc-passwd");
assert.equal(sanitizeSessionId("a/b\\c:d*e?f"), "a-b-c-d-e-f");
assert.equal(sanitizeSessionId("  ").startsWith("session-"), true);
const session = createSession({ sessionId: "raw/session id!", cwd: "/repo", piSessionFile: "/sess.jsonl" });
assert.equal(session.schemaVersion, 1);
assert.equal(session.sessionId, "raw-session-id");
assert.equal(session.piSessionId, "raw/session id!");
assert.equal(session.cwd, "/repo");
assert.equal(session.piSessionFile, "/sess.jsonl");
assert.ok(session.startedAt);
assert.equal(session.finalizedAt, null);
console.log("ok - createSession sanitizes the filename id and keeps the raw Pi id");

// ── 7. Finalization writes once; a second finalize never overwrites ──
const first = finalizeSession(piDir, session);
assert.equal(first.status, "created");
assert.ok(first.path.endsWith("raw-session-id.json"));
assert.ok(existsSync(first.path));

const onDisk = JSON.parse(readFileSync(first.path, "utf-8"));
assert.equal(onDisk.sessionId, "raw-session-id");
assert.equal(onDisk.schemaVersion, 1);
assert.ok(onDisk.finalizedAt);

// Mutate the in-memory record and finalize again — the existing file must win.
session.summary = "should not be written";
const second = finalizeSession(piDir, session);
assert.equal(second.status, "exists");
assert.equal(second.path, first.path);
const after = JSON.parse(readFileSync(first.path, "utf-8"));
assert.equal(after.summary, null);
console.log("ok - finalizeSession is write-once and never overwrites an existing record");

// ── 8. Multiple sessions persist and list newest-first, tolerating bad files ──
finalizeSession(piDir, { ...createSession({ sessionId: "older", startedAt: "2026-01-01T00:00:00.000Z" }), finalizedAt: "2026-01-01T00:00:00.000Z" });
finalizeSession(piDir, { ...createSession({ sessionId: "newer", startedAt: "2026-06-01T00:00:00.000Z" }), finalizedAt: "2026-06-01T00:00:00.000Z" });
writeFileSync(join(sessionsDir(piDir), "broken.json"), "{ not json", "utf-8");

const records = listSessions(piDir);
assert.equal(records.length, 3); // raw-session-id, older, newer (broken skipped)
// raw-session-id was created at the current time, so it sorts ahead of the two dated records.
assert.equal(records[0].sessionId, "raw-session-id");
assert.equal(records[1].sessionId, "newer");
assert.equal(records[2].sessionId, "older");
const limited = listSessions(piDir, { limit: 1 });
assert.equal(limited.length, 1);
assert.equal(limited[0].sessionId, "raw-session-id");
console.log("ok - listSessions returns newest-first and skips malformed records");

// ── 9. Missing sessions directory lists empty ──
assert.deepEqual(listSessions(join(temp, "empty-pi")), []);
console.log("ok - listSessions returns an empty list for a missing sessions directory");

// ── 10. finalizeSession rejects a record without a sessionId ──
assert.throws(() => finalizeSession(piDir, { schemaVersion: 1 }), SchemaError);
console.log("ok - finalizeSession rejects a record missing sessionId");

