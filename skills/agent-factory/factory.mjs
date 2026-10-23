#!/usr/bin/env node
/**
 * factory — the deterministic Agent Factory CLI (Node ESM).
 *
 * Commands:
 *   validate <dir>             parse + migrate + validate <dir>/.pi/system.yaml
 *   generate <dir> [--dry-run] materialize a single-agent Pi project
 *
 * Exit codes:
 *   0  valid / generated (conflicts are reported but do not fail the run)
 *   1  invalid, missing, or unparseable system.yaml; or an unknown command
 *
 * Later specs add discover, import, and modify.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { parseSystem } from "./parse.mjs";
import { migrate } from "./migrate.mjs";
import { validateSystem } from "./validate.mjs";
import { generateProject, managedPaths } from "./generate.mjs";

const USAGE = `Usage: factory <command> [options]

Commands:
  validate <dir>             validate <dir>/.pi/system.yaml against schema v1
  generate <dir> [--dry-run] generate the single-agent project from system.yaml

Exit codes:
  0  valid / generated (reported conflicts do not fail the run)
  1  invalid, missing, or unparseable system.yaml; or an unknown command
`;


function fail(message) {
  console.error(`error - ${message}`);
  process.exitCode = 1;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read, parse, migrate, and validate the model at `<dir>/.pi/system.yaml`. */
function loadModel(dir) {
  const systemPath = join(resolve(dir), ".pi", "system.yaml");

  let text;
  try {
    text = readFileSync(systemPath, "utf-8");
  } catch {
    return { systemPath, error: `no readable system.yaml at ${systemPath}` };
  }

  let doc;
  try {
    doc = parseSystem(text);
  } catch (err) {
    return { systemPath, error: `failed to parse ${systemPath}: ${err.message}` };
  }

  const needsMigration = isObject(doc) && (doc.schema === 0 || doc.schema === undefined);
  const normalized = needsMigration ? migrate(doc) : doc;
  const { ok, errors } = validateSystem(normalized);
  return { systemPath, normalized, ok, errors };
}

function readExisting(dir, model) {
  const existing = {};
  for (const rel of managedPaths(model)) {
    const path = join(resolve(dir), rel);
    if (existsSync(path)) {
      try {
        existing[rel] = readFileSync(path, "utf-8");
      } catch {
        // unreadable — treat as absent
      }
    }
  }
  return existing;
}

function runValidate(dir) {
  const { systemPath, error, ok, errors } = loadModel(dir);
  if (error) {
    fail(error);
    return;
  }
  if (ok) {
    console.log(`ok - ${systemPath} is a valid system.yaml (schema v1)`);
    process.exitCode = 0;
  } else {
    for (const e of errors) console.error(`error - ${e}`);
    process.exitCode = 1;
  }
}

function pad(action) {
  return action.padEnd(9, " ");
}

function indent(text, prefix) {
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function diffLines(oldText, newText) {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) {
    lines.push(`- ${a[i]}`);
    i++;
  }
  while (j < m) {
    lines.push(`+ ${b[j]}`);
    j++;
  }
  return lines.join("\n");
}

function runGenerate(dir, dryRun) {
  const { systemPath, error, normalized, ok, errors } = loadModel(dir);
  if (error) {
    fail(error);
    return;
  }
  if (!ok) {
    for (const e of errors) console.error(`error - ${e}`);
    process.exitCode = 1;
    return;
  }

  const existing = readExisting(dir, normalized);
  const { files } = generateProject(normalized, existing);
  const changes = files.filter((f) => f.action === "create" || f.action === "write");
  const conflicts = files.filter((f) => f.action === "conflict");

  if (dryRun) {
    console.log(`Planned changes (dry run — nothing written) for ${systemPath}:`);
    if (!existsSync(join(resolve(dir), ".pi", "agents"))) {
      console.log(`  ${pad("create")} .pi/agents/ (empty directory)`);
    }
    for (const f of files) {
      if (f.action === "none") continue;
      console.log(`  ${pad(f.action)} ${f.path}`);
      if (f.action === "create") {
        console.log(indent(f.content, "    + "));
      } else if (f.action === "write") {
        console.log(indent(diffLines(existing[f.path] ?? "", f.content), "    "));
      } else if (f.action === "conflict") {
        console.log(`    current (user):`);
        console.log(indent(existing[f.path] ?? "", "      "));
        console.log(`    proposed (model):`);
        console.log(indent(f.desired ?? "", "      "));
      }
    }
    process.exitCode = 0;
    return;
  }

  for (const f of changes) {
    const target = join(resolve(dir), f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, "utf-8");
    console.log(`wrote ${f.path} (${f.action})`);
  }
  mkdirSync(join(resolve(dir), ".pi", "agents"), { recursive: true });

  for (const c of conflicts) {
    console.error(`conflict - ${c.path}: user edit vs model change; not applied. Proposed:\n${c.desired}`);
  }
  process.exitCode = 0;
}

function main(argv) {
  const [command, dir, ...rest] = argv;
  const dryRun = rest.includes("--dry-run");

  if (command === "-h" || command === "--help" || command === undefined) {
    process.stdout.write(USAGE);
    process.exitCode = command === undefined ? 1 : 0;
    return;
  }

  if (command === "validate") {
    if (!dir) {
      fail("missing <dir> argument");
      process.stderr.write(USAGE);
      return;
    }
    runValidate(dir);
    return;
  }

  if (command === "generate") {
    if (!dir) {
      fail("missing <dir> argument");
      process.stderr.write(USAGE);
      return;
    }
    runGenerate(dir, dryRun);
    return;
  }

  fail(`unknown command "${command}"`);
  process.stderr.write(USAGE);
}

main(process.argv.slice(2));
