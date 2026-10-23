#!/usr/bin/env node
/**
 * factory — the deterministic Agent Factory CLI (Node ESM).
 *
 * Commands:
 *   validate <dir>             parse + migrate + validate <dir>/.pi/system.yaml
 *   generate <dir> [--dry-run] materialize a Pi project from system.yaml
 *   discover [dir]             print a read-only capability inventory as JSON
 *   modify <dir> [--dry-run] [--yes]  diff project vs model, apply confirmed changes
 *   import <dir>               reconstruct system.yaml from an existing project
 *
 * Exit codes:
 *   0  valid / generated / discovered / modified / imported (reported conflicts do not fail)
 *   1  invalid, missing, or unparseable system.yaml; or an unknown command
 *
 * Later specs add nothing further; import completes the MVP command surface.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { join, resolve, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseSystem } from "./parse.mjs";
import { migrate } from "./migrate.mjs";
import { validateSystem } from "./validate.mjs";
import { generateProject, managedPaths } from "./generate.mjs";
import { modifyPlan } from "./modify.mjs";
import { indent, diffLines } from "./diff.mjs";
import { parseMcpFile, probeClis, scanSkills } from "./discover.mjs";
import { loadYaml } from "./yaml-loader.mjs";
import { importSystem } from "./import.mjs";
import { declareDependencies } from "./deps.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CURATED_CLIS = ["gh", "wrangler", "railway", "stripe", "npx", "git", "node"];
const KNOWN_INTEGRATION_SKILLS = [
  "use-railway",
  "cloudflare",
  "stripe-best-practices",
  "turnstile-spin",
  "owlie",
];

const USAGE = `Usage: factory <command> [options]

Commands:
  validate <dir>             validate <dir>/.pi/system.yaml against schema v1
  generate <dir> [--dry-run] generate the project from system.yaml
  discover [dir]             print a read-only capability inventory as JSON
  modify <dir> [--dry-run] [--yes]
                             diff project vs model and apply confirmed changes
  import <dir>               reconstruct <dir>/.pi/system.yaml from an existing
                             pi-config project (settings + pi-config + detected)

Exit codes:
  0  valid / generated / discovered / modified / imported
  1  invalid, missing, or unparseable input; or an unknown command
`;

const RUNTIME_PACKAGES = ["pi-subagents", "pi-mcp-adapter", "pi-web-access"];


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

function listFiles(dir, predicate) {
  const out = [];
  const walk = (current) => {
    if (!existsSync(current)) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && predicate(entry.name, path)) out.push(path);
    }
  };
  walk(dir);
  return out;
}

function readMcpFile(path) {
  if (!existsSync(path)) return {};
  try {
    return parseMcpFile(readFileSync(path, "utf-8")).mcpServers;
  } catch {
    return {};
  }
}

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: "", body: text };
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

function kebabName(name) {
  const kebab = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return kebab || "imported-system";
}

function detectAgents(dir) {
  const agents = [];
  for (const path of listFiles(join(dir, ".pi", "agents"), (name) => name.endsWith(".md"))) {
    let text;
    try { text = readFileSync(path, "utf-8"); } catch { continue; }
    const { frontmatter, body } = splitFrontmatter(text);
    let fm = {};
    if (frontmatter) {
      try { fm = parseSystem(frontmatter); } catch { fm = {}; }
    }
    if (!isObject(fm) || typeof fm.name !== "string" || !fm.name) continue;
    agents.push({
      name: fm.name,
      description: typeof fm.description === "string" ? fm.description : "",
      tools: Array.isArray(fm.tools) ? fm.tools : [],
      model: typeof fm.model === "string" ? fm.model : "",
      prompt: typeof fm.systemPrompt === "string" ? fm.systemPrompt : body,
    });
  }
  return agents;
}

function detectSkills(dir) {
  const skillFiles = {};
  for (const path of listFiles(join(dir, ".pi", "skills"), (name) => name === "SKILL.md")) {
    try { skillFiles[path] = readFileSync(path, "utf-8"); } catch { /* unreadable */ }
  }
  return scanSkills(skillFiles);
}

function gitRevParseHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function readPiPackages() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
    return Array.isArray(pkg?.pi?.packages) ? pkg.pi.packages : [];
  } catch {
    return [];
  }
}

function runDiscover(dir) {
  const target = resolve(dir ?? process.cwd());

  const mcpServers = {};
  for (const path of [
    join(homedir(), ".pi", "agent", "mcp.json"),
    join(homedir(), ".config", "mcp", "mcp.json"),
    join(target, ".mcp.json"),
    join(target, ".pi", "mcp.json"),
  ]) {
    Object.assign(mcpServers, readMcpFile(path));
  }

  const skillFiles = {};
  for (const dir of [
    join(REPO_ROOT, "skills"),
    join(homedir(), ".pi", "agent", "skills"),
    join(target, ".pi", "skills"),
  ]) {
    for (const path of listFiles(dir, (name) => name === "SKILL.md")) {
      try {
        skillFiles[path] = readFileSync(path, "utf-8");
      } catch {
        // unreadable — skip
      }
    }
  }

  const subagents = listFiles(join(target, ".pi", "agents"), (name) => name.endsWith(".md"))
    .map((path) => basename(path, ".md"));

  const skills = scanSkills(skillFiles);
  const seenSkills = new Set();
  const dedupedSkills = skills.filter((skill) => {
    if (seenSkills.has(skill.dir)) return false;
    seenSkills.add(skill.dir);
    return true;
  });

  const inventory = {
    skills: dedupedSkills,
    mcpServers,
    clis: probeClis(CURATED_CLIS),
    subagents,
    knownIntegrations: KNOWN_INTEGRATION_SKILLS,
  };

  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  process.exitCode = 0;
}

function pad(action) {
  return action.padEnd(9, " ");
}

function printPlan(systemPath, dir, files, existing, label) {
  console.log(`${label} for ${systemPath}:`);
  if (!existsSync(join(resolve(dir), ".pi", "agents"))) {
    console.log(`  ${pad("create")} .pi/agents/ (empty directory)`);
  }
  for (const f of files) {
    if (f.action === "none") continue;
    console.log(`  ${pad(f.action)} ${f.path}`);
    if (f.action === "create") {
      console.log(indent(f.content, "    + "));
    } else if (f.action === "write") {
      console.log(indent(f.diff ?? diffLines(existing[f.path] ?? "", f.content), "    "));
    } else if (f.action === "conflict") {
      console.log(`    (user edit vs model change — proposed diff)`);
      console.log(indent(f.diff ?? diffLines(existing[f.path] ?? "", f.desired ?? ""), "    "));
    }
  }
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
  const packages = declareDependencies(
    readPiPackages(),
    process.env.FACTORY_PI_REV || gitRevParseHead(),
    RUNTIME_PACKAGES,
  );
  const { files } = generateProject(normalized, existing, { packages });
  const changes = files.filter((f) => f.action === "create" || f.action === "write");
  const conflicts = files.filter((f) => f.action === "conflict");

  if (dryRun) {
    printPlan(systemPath, dir, files, existing, "Planned changes (dry run — nothing written)");
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

function runImport(dir) {
  const target = resolve(dir);
  const settingsPath = join(target, ".pi", "settings.json");
  const piConfigPath = join(target, ".pi", "pi-config.json");

  let settings;
  let piConfig;
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch { fail(`unreadable ${settingsPath}`); return; }
  }
  if (existsSync(piConfigPath)) {
    try { piConfig = JSON.parse(readFileSync(piConfigPath, "utf-8")); } catch { fail(`unreadable ${piConfigPath}`); return; }
  }
  if (!settings && !piConfig) {
    fail(`no readable .pi/settings.json or .pi/pi-config.json at ${target}`);
    return;
  }

  const detected = {
    name: kebabName(basename(target)),
    skills: detectSkills(target),
    agents: detectAgents(target),
    mcpServers: readMcpFile(join(target, ".pi", "mcp.json")),
  };

  const { system, report } = importSystem(settings, piConfig, detected);

  const systemPath = join(target, ".pi", "system.yaml");
  if (existsSync(systemPath)) {
    console.error(`error - ${systemPath} already exists; not overwriting (delete it first or run in a fresh project).`);
    process.exitCode = 1;
    return;
  }

  let yamlText;
  try {
    yamlText = loadYaml().stringify(system);
  } catch (err) {
    fail(`failed to serialize system.yaml: ${err.message}`);
    return;
  }

  mkdirSync(dirname(systemPath), { recursive: true });
  writeFileSync(systemPath, yamlText, "utf-8");
  console.log(`wrote .pi/system.yaml (imported: ${report.imported.join(", ")})`);
  for (const flag of report.flagged) {
    console.error(`flagged - ${flag.key}: ${flag.reason}`);
  }
  process.exitCode = 0;
}

async function runModify(dir, dryRun, yes) {
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
  const { files, conflicts } = modifyPlan(normalized, existing);
  const changes = files.filter((f) => f.action === "create" || f.action === "write");

  // Always preview the full planned diff before touching anything.
  printPlan(systemPath, dir, files, existing, dryRun
    ? "Planned changes (dry run — nothing written)"
    : "Preview of changes to apply");

  if (dryRun) {
    process.exitCode = 0;
    return;
  }

  if (!yes && !process.stdin.isTTY) {
    console.error("error - non-interactive without --yes: no changes applied (preview only). Use --dry-run or --yes.");
    process.exitCode = 0;
    return;
  }

  const apply = (f) => {
    const target = join(resolve(dir), f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, "utf-8");
    console.log(`wrote ${f.path} (${f.action})`);
  };

  if (yes) {
    for (const f of changes) apply(f);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    for (const f of changes) {
      const answer = await rl.question(`Apply ${f.path}? [y/N] `);
      if (/^y(es)?$/i.test(answer.trim())) apply(f);
      else console.log(`skipped ${f.path}`);
    }
    rl.close();
  }

  mkdirSync(join(resolve(dir), ".pi", "agents"), { recursive: true });

  for (const c of conflicts) {
    console.error(`conflict - ${c.path}: user edit vs model change; not applied. Proposed:\n${c.desired}`);
  }
  process.exitCode = 0;
}

async function main(argv) {
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

  if (command === "discover") {
    runDiscover(dir);
    return;
  }

  if (command === "modify") {
    if (!dir) {
      fail("missing <dir> argument");
      process.stderr.write(USAGE);
      return;
    }
    await runModify(dir, dryRun, rest.includes("--yes"));
    return;
  }

  if (command === "import") {
    if (!dir) {
      fail("missing <dir> argument");
      process.stderr.write(USAGE);
      return;
    }
    runImport(dir);
    return;
  }

  fail(`unknown command "${command}"`);
  process.stderr.write(USAGE);
}

main(process.argv.slice(2));
