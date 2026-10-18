/**
 * project-state schema — document shapes, versioning, and migration dispatch
 *
 * Every persisted document (the mutable `.pi/state.json` projection and the
 * write-once `.pi/sessions/<id>.json` records) begins with `schemaVersion`.
 * Loaders route every read through `migrateDocument` so older documents
 * migrate forward and unsupported or malformed documents are rejected safely
 * instead of being half-read.
 */

/** Current schema version shared by state and session documents. */
export const SCHEMA_VERSION = 1;

/** Typed error for malformed or unsupported persisted documents. */
export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

/**
 * Registered migrations, keyed by the source `schemaVersion`. Each migrator
 * receives a document and must return a new document whose `schemaVersion` is
 * the next version.
 *
 * Empty at version 1: there is nothing older to migrate. Future changes add
 * entries here (for example `1: migrateV1ToV2`) without touching the
 * dispatcher.
 */
export const MIGRATIONS = Object.freeze({});

/**
 * Dispatch a persisted document through explicit version handling.
 *
 * - Rejects non-objects and missing/non-integer/non-positive `schemaVersion`.
 * - Rejects documents newer than the target version (unsupported).
 * - Applies registered migrations in order until the document reaches the
 *   target version, failing when a migration is missing or does not advance.
 *
 * `targetVersion` and `migrations` are injectable so tests can exercise future
 * migration dispatch without adding real migrations.
 */
export function migrateDocument(
  doc,
  { targetVersion = SCHEMA_VERSION, migrations = MIGRATIONS } = {},
) {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new SchemaError("document must be a plain object");
  }
  if (!Number.isInteger(doc.schemaVersion) || doc.schemaVersion < 1) {
    throw new SchemaError("missing or invalid schemaVersion");
  }
  if (doc.schemaVersion > targetVersion) {
    throw new SchemaError(
      `unsupported schemaVersion ${doc.schemaVersion} (current ${targetVersion})`,
    );
  }

  let current = doc;
  while (current.schemaVersion < targetVersion) {
    const migrate = migrations[current.schemaVersion];
    if (typeof migrate !== "function") {
      throw new SchemaError(
        `no migration registered from schemaVersion ${current.schemaVersion}`,
      );
    }
    const next = migrate(current);
    if (
      typeof next !== "object" ||
      next === null ||
      Array.isArray(next) ||
      !Number.isInteger(next.schemaVersion)
    ) {
      throw new SchemaError(
        `migration for schemaVersion ${current.schemaVersion} returned an invalid document`,
      );
    }
    if (next.schemaVersion <= current.schemaVersion) {
      throw new SchemaError(
        `migration for schemaVersion ${current.schemaVersion} did not advance the version`,
      );
    }
    current = next;
  }
  return current;
}

/**
 * Canonical shape for the mutable `.pi/state.json` resume projection. This is
 * a non-authoritative cache: git branch state and GitHub lifecycle labels win
 * on divergence and are re-derived at session boundaries.
 */
export function createStateDocument(fields = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    /** Current active spec, `{ number, title? }`, or null when unknown. */
    activeSpec: null,
    /** Lifecycle phase (`ready` | `in-progress` | `reviewed` | `done`) or null. */
    phase: null,
    /** Current git branch or null. */
    branch: null,
    /** Filesystem-safe id of the most recent finalized session, or null. */
    lastSessionId: null,
    /** Reliably known pending work, or null. */
    pendingWork: null,
    /** Reliably known verification commands (`{ [name]: command }`), or null. */
    checks: null,
    updatedAt: new Date().toISOString(),
    ...fields,
  };
}

/**
 * Canonical shape for a finalized, write-once session record.
 *
 * All optional facts default to `null` (or an empty collection) and are only
 * populated when the runtime reliably exposes them. Nothing is inferred or
 * fabricated.
 */
export function createSessionDocument(fields = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    /** Filesystem-safe, stable id used as the record filename stem. */
    sessionId: null,
    /** Raw Pi session id, when it differs from the sanitized id. */
    piSessionId: null,
    /** Pi session JSONL path, or null for ephemeral sessions. */
    piSessionFile: null,
    /** Project working directory, or null. */
    cwd: null,
    startedAt: null,
    finalizedAt: null,
    /** Concise summary, only when reliably available. */
    summary: null,
    /** Concise outcome, only when reliably available. */
    outcome: null,
    /** Lifecycle skill that drove the session, or null when undetectable. */
    workflow: null,
    /** Resolved active spec (`{ number, title? }`), or null. */
    activeSpec: null,
    /** Resolved lifecycle phase, or null. */
    phase: null,
    /** Resolved git branch, or null. */
    branch: null,
    /** Files changed during the session, when known. */
    changedFiles: [],
    /** Check results (`{ [name]: result }`), or null when not run. */
    checkResults: null,
    /** Aggregated Pi-reported usage, or null when unavailable. */
    usage: null,
    /** Verifiable observation ledger; legacy aggregates are not re-priced. */
    accounting: null,
    /** Active parent model (`{ provider, model, thinkingLevel }`), or null. */
    model: null,
    /** Subagent routing from settings agentOverrides, or null. */
    subagentModels: null,
    /** Per-agent subagent usage from reliable artifacts, or null. */
    subagentUsage: null,
    provenance: {
      /** pi-config repository commit SHA, or null. */
      piConfigCommit: null,
      /** Installed Pi package version, or null. */
      piVersion: null,
      /** Pi session-format version, or null. */
      piSessionFormatVersion: null,
      /** Product version from the project's version file, or null. */
      productVersion: null,
      /** Stable hash of the active project configuration, or null. */
      configHash: null,
    },
    ...fields,
  };
}

