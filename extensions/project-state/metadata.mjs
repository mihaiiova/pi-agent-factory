/**
 * project-state metadata — reliable-only usage and version/config provenance
 *
 * Collects only facts the runtime actually exposes. Nothing here computes
 * pricing, guesses tokens, or fabricates attribution. Unavailable facts are
 * `null`.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sessionLedger, summarize, attachSubagents, agentSummary } from "./accounting.mjs";

/** Compatibility exports use the same observation ledger as all report commands. */
export function aggregateUsage(entries) {
  const ledger = sessionLedger({ entries, header: { id: "aggregate" } });
  return ledger.samples.length ? summarize(ledger.samples).usage : null;
}

export function collectSubagentUsage(sessionDir, options = {}) {
  // A directory is not an owner. Old callers cannot safely attribute its contents.
  if (!sessionDir || !options.sessionId || !Array.isArray(options.entries)) return null;
  const ledger = sessionLedger({ entries: options.entries, branch: options.branch,
    header: { id: options.sessionId }, sessionFile: options.sessionFile ?? "" });
  const artifacts = [];
  try {
    for (const name of readdirSync(join(sessionDir, "subagent-artifacts"))) {
      if (!name.endsWith("_meta.json")) continue;
      const path = join(sessionDir, "subagent-artifacts", name);
      try { artifacts.push({ path, meta: JSON.parse(readFileSync(path, "utf8")) }); } catch {}
    }
  } catch { return null; }
  attachSubagents([ledger], artifacts.filter(x => x.meta && typeof x.meta === "object"));
  return agentSummary(ledger.samples);
}

/**
 * Read the newest machine-readable check summary (`results.json`) under an
 * artifacts directory. `run-checks.sh` writes one alongside its logs.
 *
 * Returns the parsed `{ [checkName]: "passed" | "failed" }` object from the
 * newest `results.json` file (optionally restricted to files written at or
 * after `since`, an epoch-millisecond boundary), or `null` when none exists,
 * it is outside the window, or it is malformed/wrong-shaped (including any
 * value other than `"passed"`/`"failed"`).
 */
export function readCheckResults(artifactsRoot, { since } = {}) {
  if (typeof artifactsRoot !== "string" || !artifactsRoot) return null;
  const bound = Number.isFinite(since) ? since : null;
  const files = findResultsFiles(artifactsRoot, bound);
  if (files.length === 0) return null;
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(files[0].path, "utf-8"));
  } catch {
    return null;
  }
  return isCheckResults(parsed) ? parsed : null;
}

/** True for a `{ [name]: "passed" | "failed" }` object, false otherwise. */
function isCheckResults(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => v === "passed" || v === "failed");
}

/** Recursively collect `results.json` paths newer than (or at) `since`. */
function findResultsFiles(dir, since, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findResultsFiles(full, since, out);
    } else if (entry.name === "results.json") {
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (since == null || st.mtimeMs >= since) out.push({ path: full, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

/**
 * Read the product version from the project's configured version file,
 * falling back to `package.json`. Returns `null` when neither is available.
 */
export function readProductVersion(cwd, versionFile) {
  const candidates = [];
  if (typeof versionFile === "string" && versionFile) {
    candidates.push(join(cwd ?? "", versionFile));
  }
  candidates.push(join(cwd ?? "", "package.json"));
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8"));
      if (typeof parsed.version === "string" && parsed.version) return parsed.version;
    } catch {
      // Not a JSON file with a string version — try the next candidate.
    }
  }
  return null;
}

/**
 * Stable SHA-256 over the active project configuration (`pi-config.json` and
 * `settings.json`). Uses relative labels so the digest is independent of the
 * checkout path and never copies large configuration into records.
 *
 * Returns `null` when neither file exists.
 */
export function configHash(piDir) {
  const files = [
    ["pi-config.json", join(piDir ?? "", "pi-config.json")],
    ["settings.json", join(piDir ?? "", "settings.json")],
  ];
  const hash = createHash("sha256");
  let found = false;
  for (const [label, path] of files) {
    let raw;
    try {
      raw = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    found = true;
    hash.update(`${label}:${raw}\n`);
  }
  return found ? hash.digest("hex") : null;
}

/** Resolve the pi-config repository HEAD commit, or `null` when unavailable. */
export function readPiConfigCommit(piConfigRoot) {
  try {
    const out = execFileSync("git", ["-C", piConfigRoot, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Assemble the provenance block for a session record. Every field is either a
 * reliably observed fact or `null`.
 */
export function collectProvenance({
  piConfigRoot,
  cwd,
  piDir,
  versionFile,
  piVersion,
  piSessionFormatVersion,
}) {
  return {
    piConfigCommit: piConfigRoot ? readPiConfigCommit(piConfigRoot) : null,
    piVersion: piVersion ?? null,
    piSessionFormatVersion: piSessionFormatVersion ?? null,
    productVersion: cwd ? readProductVersion(cwd, versionFile) : null,
    configHash: piDir ? configHash(piDir) : null,
  };
}

