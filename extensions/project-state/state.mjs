/**
 * project-state persistence — atomic mutable state and write-once session records
 *
 * Pure filesystem module with no Pi dependency so it can be exercised with
 * `node:assert/strict` in isolated temporary directories. All paths are passed
 * in explicitly; the caller resolves the project config directory.
 */

import { hash } from "./accounting.mjs";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  SCHEMA_VERSION,
  SchemaError,
  createSessionDocument,
  migrateDocument,
} from "./schema.mjs";

const STATE_FILE = "state.json";
const SESSIONS_DIR = "sessions";

/** Path to the mutable state projection inside a config directory. */
export function statePath(piDir) {
  return join(piDir, STATE_FILE);
}

/** Path to the immutable session-records directory inside a config directory. */
export function sessionsDir(piDir) {
  return join(piDir, SESSIONS_DIR);
}

/** Path to a final session record by filesystem-safe id. */
export function sessionRecordPath(piDir, sessionId) {
  return join(sessionsDir(piDir), `${sessionId}.json`);
}

/** `JSON.stringify` with recursively sorted keys, producing stable bytes. */
export function stableStringify(value) {
  return `${JSON.stringify(value, sortedKeysReplacer, 2)}\n`;
}

function sortedKeysReplacer(_key, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) sorted[k] = value[k];
    return sorted;
  }
  return value;
}

/**
 * Normalize a session id into a stable, filesystem-safe filename stem.
 * Unavailable or empty ids fall back to a `session-<timestamp>-<random>` stem.
 */
export function sanitizeSessionId(id) {
  if (typeof id === "string" && id.trim()) {
    const cleaned = id
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (cleaned) return cleaned;
  }
  return `session-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/** Create a mutable, in-memory session record (not yet written to disk). */
export function createSession({ sessionId, cwd, piSessionFile, startedAt }) {
  const safe = sanitizeSessionId(sessionId);
  return createSessionDocument({
    sessionId: safe,
    piSessionId: typeof sessionId === "string" && sessionId.trim() ? sessionId : null,
    cwd: typeof cwd === "string" ? cwd : null,
    piSessionFile: typeof piSessionFile === "string" ? piSessionFile : null,
    startedAt: typeof startedAt === "string" ? startedAt : new Date().toISOString(),
  });
}

/**
 * Load the mutable state projection. Returns `undefined` when the file is
 * absent. Throws `SchemaError` when it exists but is malformed, missing a
 * `schemaVersion`, or newer than the current schema.
 */
export function loadState(piDir) {
  const path = statePath(piDir);
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return undefined;
    throw err;
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw new SchemaError(`state.json is not valid JSON: ${err.message}`);
  }
  return migrateDocument(doc);
}

/**
 * Atomically write (overwrite) the mutable state projection, creating the
 * config directory if needed. The document is validated and re-serialized in
 * stable key order before the temporary-file/rename publish.
 */
export function writeStateAtomic(piDir, state) {
  const doc = migrateDocument(state);
  mkdirSync(piDir, { recursive: true });
  writeFileAtomic(statePath(piDir), stableStringify(doc));
  return statePath(piDir);
}

/**
 * Finalize a session record with write-once semantics. An existing final
 * record for the same `sessionId` is never overwritten: the call returns
 * `{ status: "exists" }` instead. New records are published atomically via a
 * temporary file plus hard-link so a concurrent writer cannot clobber a
 * just-created record.
 */
export function finalizeSession(piDir, session) {
  const doc = migrateDocument(session);
  if (typeof doc.sessionId !== "string" || !doc.sessionId) {
    throw new SchemaError("session record is missing a sessionId");
  }
  const dir = sessionsDir(piDir);
  mkdirSync(dir, { recursive: true });
  const target = sessionRecordPath(piDir, doc.sessionId);
  if (existsSync(target)) return { status: "exists", path: target };

  const finalized = {
    ...doc,
    finalizedAt: doc.finalizedAt ?? new Date().toISOString(),
  };
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, stableStringify(finalized), "utf-8");
  try {
    linkSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore secondary cleanup failure
    }
    if (err && err.code === "EEXIST") return { status: "exists", path: target };
    throw err;
  }
  try {
    unlinkSync(tmp);
  } catch {
    // ignore secondary cleanup failure
  }
  return { status: "created", path: target };
}

/** Append an immutable revision when a native session gains observations on resume.
 * Existing snapshots are retained; retries of the same content are idempotent.
 */
export function checkpointSession(piDir, session) {
  const nativeId = session.piSessionId ?? session.sessionId;
  const previous = listSessions(piDir).find(r => (r.piSessionId ?? r.sessionId) === nativeId);
  const fingerprint = value => {
    const { finalizedAt, snapshotRevision, snapshotFingerprint, sessionId, ...rest } = value;
    return hash(rest);
  };
  const key = fingerprint(session);
  if (previous && (previous.snapshotFingerprint ?? fingerprint(previous)) === key) {
    return { status: "exists", path: sessionRecordPath(piDir, previous.sessionId) };
  }
  const record = { ...session,
    sessionId: previous || existsSync(sessionRecordPath(piDir, session.sessionId)) ? `${sanitizeSessionId(nativeId)}--${key.slice(0, 24)}` : session.sessionId,
    snapshotRevision: (previous?.snapshotRevision ?? 0) + 1,
    snapshotFingerprint: key,
    finalizedAt: new Date(Math.max(Date.now(), (Date.parse(previous?.finalizedAt ?? "") || 0) + 1)).toISOString(),
  };
  return finalizeSession(piDir, record);
}

/**
 * Read every finalized session record, newest-first by `startedAt`
 * (falling back to `finalizedAt`). Malformed or unsupported records are
 * skipped rather than throwing.
 */
export function listSessions(piDir, { limit, allSnapshots = false } = {}) {
  const dir = sessionsDir(piDir);
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  const records = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(readFileSync(join(dir, name), "utf-8"));
      records.push(migrateDocument(doc));
    } catch {
      // Skip malformed/unsupported records without failing the listing.
    }
  }
  records.sort((a, b) => {
    const at = a.finalizedAt ?? a.startedAt ?? "";
    const bt = b.finalizedAt ?? b.startedAt ?? "";
    return bt < at ? -1 : bt > at ? 1 : 0;
  });
  const latest = allSnapshots ? records : [...new Map([...records].reverse().map(r => [r.piSessionId ?? r.sessionId, r])).values()]
    .sort((a, b) => (b.finalizedAt ?? b.startedAt ?? "").localeCompare(a.finalizedAt ?? a.startedAt ?? ""));
  return typeof limit === "number" && limit > 0 ? latest.slice(0, limit) : latest;
}

function writeFileAtomic(target, content) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  try {
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore secondary cleanup failure
    }
    throw err;
  }
}

