import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateUsage,
  readProductVersion,
  configHash,
  readPiConfigCommit,
  collectProvenance,
  collectSubagentUsage,
  readCheckResults,
} from "../../extensions/project-state/metadata.mjs";

const temp = mkdtempSync(join(tmpdir(), "project-state-meta-"));

// ── 1. aggregateUsage returns null when nothing reports usage ──
assert.equal(aggregateUsage([]), null);
assert.equal(aggregateUsage([{ type: "message", message: { role: "user" } }]), null);
console.log("ok - aggregateUsage is null when no entry reports usage");

// ── 2. aggregateUsage sums assistant, compaction, and branch-summary usage ──
const usageOf = (n) => ({
  input: n,
  output: n * 2,
  cacheRead: n,
  cacheWrite: 0,
  totalTokens: n * 3,
  cost: { input: n, output: n * 2, cacheRead: n, cacheWrite: 0, total: n * 3 },
});
const entries = [
  { type: "message", message: { role: "assistant", usage: usageOf(10) } },
  { type: "message", message: { role: "assistant", usage: usageOf(5) } },
  { type: "compaction", summary: "x", usage: usageOf(2) },
  { type: "branch_summary", summary: "y", usage: usageOf(3) },
  // Nested tool/model usage is intentionally excluded (not the main agent).
  { type: "message", message: { role: "toolResult", usage: usageOf(100) } },
];
const total = aggregateUsage(entries);
assert.equal(total.input, 20);
assert.equal(total.output, 40);
assert.equal(total.cacheRead, 20);
assert.equal(total.totalTokens, 60);
assert.equal(total.cost.total, 60);
assert.equal(total.cost.input, 20);
console.log("ok - aggregateUsage sums main-agent usage and excludes nested tool usage");

// ── 3. aggregateUsage tolerates missing/partial fields ──
const partial = aggregateUsage([
  { type: "message", message: { role: "assistant", usage: { totalTokens: 7, cost: { total: 0.5 } } } },
]);
assert.equal(partial.input, 0);
assert.equal(partial.output, 0);
assert.equal(partial.totalTokens, 7);
assert.equal(partial.cost.total, 0.5);
assert.equal(partial.cost.input, null);
console.log("ok - aggregateUsage defaults missing token fields to zero and missing prices to null");

// ── 4. readProductVersion prefers the configured version file, falls back to package.json ──
const proj = join(temp, "proj");
mkdirSync(proj, { recursive: true });
writeFileSync(join(proj, "package.json"), JSON.stringify({ version: "1.2.3" }));
assert.equal(readProductVersion(proj, undefined), "1.2.3");
assert.equal(readProductVersion(proj, "package.json"), "1.2.3");

writeFileSync(join(proj, "pyproject.toml"), "version = \"9.9.9\"");
assert.equal(readProductVersion(proj, "package.json"), "1.2.3"); // explicit file wins

const empty = join(temp, "empty");
mkdirSync(empty, { recursive: true });
assert.equal(readProductVersion(empty, undefined), null);
console.log("ok - readProductVersion reads the product version and returns null when absent");

// ── 5. configHash is a stable digest over the active project configuration ──
const cfgPi = join(temp, "cfg-pi");
mkdirSync(cfgPi, { recursive: true });
writeFileSync(join(cfgPi, "pi-config.json"), JSON.stringify({ tiers: { high: "a" } }));
writeFileSync(join(cfgPi, "settings.json"), JSON.stringify({ spec: { baseBranch: "development" } }));
const h1 = configHash(cfgPi);
assert.match(h1, /^[0-9a-f]{64}$/);
assert.equal(configHash(cfgPi), h1);

// Same content, different directory → same hash (stable labels, not paths).
const cfgPi2 = join(temp, "cfg-pi-2");
mkdirSync(cfgPi2, { recursive: true });
writeFileSync(join(cfgPi2, "pi-config.json"), JSON.stringify({ tiers: { high: "a" } }));
writeFileSync(join(cfgPi2, "settings.json"), JSON.stringify({ spec: { baseBranch: "development" } }));
assert.equal(configHash(cfgPi2), h1);

writeFileSync(join(cfgPi, "settings.json"), JSON.stringify({ spec: { baseBranch: "main" } }));
assert.notEqual(configHash(cfgPi), h1);

const noCfg = join(temp, "no-cfg");
mkdirSync(noCfg, { recursive: true });
assert.equal(configHash(noCfg), null);
console.log("ok - configHash is a stable content digest, independent of directory, null when absent");

// ── 6. readPiConfigCommit returns HEAD in a git repo and null otherwise ──
const gitRepo = join(temp, "pi-config-repo");
mkdirSync(gitRepo, { recursive: true });
execFileSync("git", ["init", "-q", gitRepo]);
execFileSync("git", ["-C", gitRepo, "config", "user.email", "meta@example.invalid"]);
execFileSync("git", ["-C", gitRepo, "config", "user.name", "Meta Test"]);
writeFileSync(join(gitRepo, "x.txt"), "x");
execFileSync("git", ["-C", gitRepo, "add", "x.txt"]);
execFileSync("git", ["-C", gitRepo, "commit", "-q", "-m", "init"]);
const head = execFileSync("git", ["-C", gitRepo, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
assert.equal(readPiConfigCommit(gitRepo), head);
assert.equal(readPiConfigCommit(join(temp, "not-a-repo")), null);
console.log("ok - readPiConfigCommit returns HEAD sha or null");

// ── 7. collectProvenance assembles all fields with nulls for unavailable facts ──
const provenance = collectProvenance({
  piConfigRoot: gitRepo,
  cwd: proj,
  piDir: cfgPi,
  versionFile: undefined,
  piVersion: "0.0.0-test",
  piSessionFormatVersion: 3,
});
assert.equal(provenance.piConfigCommit, head);
assert.equal(provenance.piVersion, "0.0.0-test");
assert.equal(provenance.piSessionFormatVersion, 3);
assert.equal(provenance.productVersion, "1.2.3");
assert.equal(provenance.configHash, configHash(cfgPi)); // current config content

const minimal = collectProvenance({});
assert.equal(minimal.piConfigCommit, null);
assert.equal(minimal.piVersion, null);
assert.equal(minimal.piSessionFormatVersion, null);
assert.equal(minimal.productVersion, null);
assert.equal(minimal.configHash, null);
console.log("ok - collectProvenance fills reliable facts and leaves unavailable ones null");

// ── 8. collectSubagentUsage aggregates _meta.json per agent, nulls when absent ──
const sessDir = join(temp, "sess");
const artDir = join(sessDir, "subagent-artifacts");
mkdirSync(artDir, { recursive: true });
writeFileSync(
  join(artDir, "a_meta.json"),
  JSON.stringify({ parentSessionId: "test-owner", agent: "reviewer", exitCode: 0, model: "gpt-4", timestamp: 1, usage: { cost: 0.25 } }),
);
writeFileSync(
  join(artDir, "b_meta.json"),
  JSON.stringify({ parentSessionId: "test-owner", agent: "reviewer", exitCode: 0, model: "gpt-4", timestamp: 2, usage: { cost: 0.5 } }),
);
writeFileSync(
  join(artDir, "c_meta.json"),
  JSON.stringify({ parentSessionId: "test-owner", agent: "worker", exitCode: 1, model: "gpt-5", timestamp: 3, usage: { cost: 1.5 } }),
);
writeFileSync(join(artDir, "ignored.txt"), "not a meta file");
writeFileSync(join(artDir, "bad_meta.json"), "{ not json");
writeFileSync(join(artDir, "noagent_meta.json"), JSON.stringify({ parentSessionId: "test-owner", timestamp: 4, usage: { cost: 0.1 } }));

assert.equal(collectSubagentUsage(sessDir), null, "a directory alone is not ownership");
const sub = collectSubagentUsage(sessDir, { sessionId: "test-owner", entries: [] });
assert.equal(sub.agents.length, 3); // reviewer, worker, "subagent" fallback
assert.equal(sub.totalCost, 0.25 + 0.5 + 1.5 + 0.1);
const reviewer = sub.agents.find((a) => a.agent === "reviewer");
assert.equal(reviewer.runs, 2);
assert.equal(reviewer.cost, 0.75);
assert.equal(reviewer.status, "completed");
assert.equal(reviewer.model, "gpt-4");
const worker = sub.agents.find((a) => a.agent === "worker");
assert.equal(worker.runs, 1);
assert.equal(worker.cost, 1.5);
assert.equal(worker.status, "failed");
assert.equal(worker.model, "gpt-5");
const fallback = sub.agents.find((a) => a.agent === "subagent");
assert.equal(fallback.runs, 1);
assert.equal(fallback.cost, 0.1);
assert.equal(fallback.status, null);
assert.equal(fallback.model, null);

// Conflicting models across runs resolve to null — null beats wrong.
const conflictDir = join(temp, "sess-conflict");
const conflictArt = join(conflictDir, "subagent-artifacts");
mkdirSync(conflictArt, { recursive: true });
writeFileSync(join(conflictArt, "x_meta.json"), JSON.stringify({ parentSessionId: "test-owner", agent: "scout", exitCode: 0, model: "m-a", usage: { cost: 1 } }));
writeFileSync(join(conflictArt, "y_meta.json"), JSON.stringify({ parentSessionId: "test-owner", agent: "scout", exitCode: 0, model: "m-b", usage: { cost: 1 } }));
const conflict = collectSubagentUsage(conflictDir, { sessionId: "test-owner", entries: [] });
assert.equal(conflict.agents.length, 1);
assert.equal(conflict.agents[0].status, "completed");
assert.equal(conflict.agents[0].model, null);

// Mixed non-zero + missing exitCode → "failed" (a known failure wins).
const mixedDir = join(temp, "sess-mixed");
const mixedArt = join(mixedDir, "subagent-artifacts");
mkdirSync(mixedArt, { recursive: true });
writeFileSync(join(mixedArt, "a_meta.json"), JSON.stringify({ parentSessionId: "test-owner", agent: "worker", exitCode: 1, model: "m", usage: { cost: 1 } }));
writeFileSync(join(mixedArt, "b_meta.json"), JSON.stringify({ parentSessionId: "test-owner", agent: "worker", model: "m", usage: { cost: 1 } }));
const mixed = collectSubagentUsage(mixedDir, { sessionId: "test-owner", entries: [] });
assert.equal(mixed.agents.length, 1);
assert.equal(mixed.agents[0].status, "failed");
console.log("ok - collectSubagentUsage marks a known failure as failed despite a missing exitCode");

assert.equal(collectSubagentUsage("no-sess"), null);
assert.equal(collectSubagentUsage(null), null);
assert.equal(collectSubagentUsage(undefined), null);
assert.equal(collectSubagentUsage(""), null);
console.log("ok - collectSubagentUsage aggregates per-agent status/model/cost and nulls when absent");

// ── 9. readCheckResults reads the newest results.json, nulls when absent ──
const checksRoot = join(temp, "checks");
mkdirSync(join(checksRoot, "spec-review", "run-a"), { recursive: true });
mkdirSync(join(checksRoot, "spec-review", "run-b"), { recursive: true });
const resultsA = join(checksRoot, "spec-review", "run-a", "results.json");
const resultsB = join(checksRoot, "spec-review", "run-b", "results.json");
writeFileSync(resultsA, JSON.stringify({ unit: "passed" }));
writeFileSync(resultsB, JSON.stringify({ unit: "failed" }));
// Force a deterministic order: run-b is newer than run-a.
const now = Date.now();
utimesSync(resultsA, now / 1000, (now - 60_000) / 1000);
utimesSync(resultsB, now / 1000, (now - 1_000) / 1000);
assert.deepEqual(readCheckResults(checksRoot), { unit: "failed" });
console.log("ok - readCheckResults returns the newest results.json");

// Malformed and wrong-shape results.json → null.
const badRoot = join(temp, "checks-bad");
mkdirSync(badRoot, { recursive: true });
writeFileSync(join(badRoot, "results.json"), "{ not json");
assert.equal(readCheckResults(badRoot), null);
writeFileSync(join(badRoot, "results.json"), JSON.stringify(["not", "an", "object"]));
assert.equal(readCheckResults(badRoot), null);
console.log("ok - readCheckResults nulls on malformed or wrong-shape results.json");

// Values other than "passed"/"failed" → null (unrelated results.json files).
writeFileSync(join(badRoot, "results.json"), JSON.stringify({ unit: "passed", extra: 42 }));
assert.equal(readCheckResults(badRoot), null);
writeFileSync(join(badRoot, "results.json"), JSON.stringify({ numFailedTests: 0 }));
assert.equal(readCheckResults(badRoot), null);
console.log("ok - readCheckResults nulls when a value is not passed/failed");

// Absent results.json → null, and the `since` window filters stale results.
assert.equal(readCheckResults(join(temp, "no-checks")), null);
assert.deepEqual(readCheckResults(checksRoot, { since: now - 2000 }), { unit: "failed" });
assert.equal(readCheckResults(checksRoot, { since: now + 1 }), null);
assert.equal(readCheckResults(null), null);
assert.equal(readCheckResults(""), null);
console.log("ok - readCheckResults nulls when absent or outside the since window");

