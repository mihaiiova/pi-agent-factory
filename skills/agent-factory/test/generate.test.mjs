import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystem } from "../parse.mjs";
import { generateProject } from "../generate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "fixtures/generate/minimal");
const minimalYaml = readFileSync(resolve(fixtureRoot, ".pi/system.yaml"), "utf-8");
const model = parseSystem(minimalYaml);

const EXPECTED_PATHS = [
  ".env.example",
  ".gitignore",
  ".pi/APPEND_SYSTEM.md",
  ".pi/mcp.json",
  ".pi/settings.json",
  "README.md",
  "data/knowledge/.gitkeep",
];

function byPath(files, path) {
  return files.find((f) => f.path === path);
}

test("fresh generate creates the full single-agent tree", () => {
  const { files } = generateProject(model, {});

  assert.deepEqual(
    files.map((f) => f.path).sort(),
    EXPECTED_PATHS.slice().sort(),
  );
  for (const f of files) {
    assert.equal(f.action, "create", `${f.path} should be created fresh`);
  }

  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);
  assert.equal(settings.defaultProvider, "openai-codex");
  assert.equal(settings.defaultModel, "gpt-5.6-terra");
  assert.equal(settings.defaultThinkingLevel, "medium");
  assert.deepEqual(settings.defaultTools, [
    "read", "grep", "find", "ls", "bash", "edit", "write", "subagent",
  ]);
  assert.deepEqual(settings.subagents.agentOverrides, {
    oracle: { model: "openai-codex/gpt-5.6-terra" },
    reviewer: { model: "deepseek/deepseek-v4-flash" },
    scout: { model: "deepseek/deepseek-v4-flash" },
    worker: { model: "deepseek/deepseek-v4-pro" },
  });

  const mcp = JSON.parse(byPath(files, ".pi/mcp.json").content);
  assert.deepEqual(mcp, { mcpServers: {} });
});

test("re-running generate is a no-op (idempotent)", () => {
  const first = generateProject(model, {});
  const existing = Object.fromEntries(first.files.map((f) => [f.path, f.content]));

  const second = generateProject(model, existing);
  for (const f of second.files) {
    assert.equal(f.action, "none", `${f.path} should be unchanged on re-run`);
  }
});

test("unrelated keys in .pi/settings.json survive regeneration", () => {
  const existing = {
    ".pi/settings.json": JSON.stringify({ theme: "dark", defaultModel: "old/model" }),
  };

  const { files } = generateProject(model, existing);
  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);

  assert.equal(settings.theme, "dark", "unrelated key preserved");
  assert.equal(settings.defaultModel, "gpt-5.6-terra", "model-owned key overwritten");
});

test("orchestrator.model tier is authoritative for the primary session", () => {
  const changed = {
    ...model,
    orchestrator: { ...model.orchestrator, model: "small" },
  };

  const { files } = generateProject(changed, {});
  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);

  assert.equal(settings.defaultProvider, "deepseek");
  assert.equal(settings.defaultModel, "deepseek-v4-flash");
  assert.equal(settings.defaultThinkingLevel, "low");
});

test("unrelated keys in .pi/mcp.json survive regeneration", () => {
  const existing = {
    ".pi/mcp.json": JSON.stringify({
      mcpServers: { openseo: { url: "http://localhost:3002/mcp" } },
      extra: true,
    }),
  };

  const { files } = generateProject(model, existing);
  const mcp = JSON.parse(byPath(files, ".pi/mcp.json").content);

  assert.equal(mcp.extra, true, "unrelated key preserved");
  assert.deepEqual(mcp.mcpServers, { openseo: { url: "http://localhost:3002/mcp" } });
});

test("user edits to an authored file survive when the model is unchanged", () => {
  const first = generateProject(model, {});
  const original = byPath(first.files, ".pi/APPEND_SYSTEM.md").content;
  const markerLine = original.split("\n", 1)[0];
  const userEdited = `${markerLine}\nI added my own orchestrator instructions.\n`;

  const { files } = generateProject(model, { ".pi/APPEND_SYSTEM.md": userEdited });
  const entry = byPath(files, ".pi/APPEND_SYSTEM.md");

  assert.equal(entry.action, "none");
  assert.equal(entry.content, userEdited);
});

test("user-authored files without a factory marker are never touched", () => {
  const existing = { "README.md": "# My own README\n\nHand written.\n" };

  const { files } = generateProject(model, existing);
  const entry = byPath(files, "README.md");

  assert.equal(entry.action, "none");
  assert.equal(entry.content, existing["README.md"]);
});

test("conflict when a user edits an authored file AND the model changes it", () => {
  const first = generateProject(model, {});
  const original = byPath(first.files, ".pi/APPEND_SYSTEM.md").content;
  const markerLine = original.split("\n", 1)[0];
  const userEdited = `${markerLine}\nUser's own instructions.\n`;

  const changedModel = {
    ...model,
    orchestrator: { ...model.orchestrator, prompt: "A new orchestrator prompt.\n" },
  };

  const { files } = generateProject(changedModel, { ".pi/APPEND_SYSTEM.md": userEdited });
  const entry = byPath(files, ".pi/APPEND_SYSTEM.md");

  assert.equal(entry.action, "conflict");
  assert.equal(entry.content, userEdited, "conflict must not overwrite");
  assert.equal(entry.desired, changedModel.orchestrator.prompt);
});

test("authored scaffold carries an agent-factory marker and the scaffolded body", () => {
  const { files } = generateProject(model, {});
  const append = byPath(files, ".pi/APPEND_SYSTEM.md").content;
  assert.match(append, /^<!-- agent-factory:generated v1 sha256=[0-9a-f]{64} -->\n/);
  assert.ok(append.endsWith(model.orchestrator.prompt));

  const gitignore = byPath(files, ".gitignore").content;
  assert.match(gitignore, /^# agent-factory:generated v1 sha256=[0-9a-f]{64}\n/);
  assert.ok(gitignore.includes("data/"));
  assert.ok(gitignore.includes(".env\n"));
  assert.ok(gitignore.includes(".pi/state.json"));
  assert.ok(gitignore.includes(".pi/sessions/"));

  const readme = byPath(files, "README.md").content;
  assert.ok(readme.includes(`# ${model.name}`));
  assert.ok(readme.includes(model.description));
});

test("golden tree: minimal fixture produces the committed snapshot", () => {
  const goldenDir = resolve(fixtureRoot, "golden");
  const { files } = generateProject(model, {});

  const produced = new Map(files.map((f) => [f.path, f.content]));
  const goldenPaths = readdirSync(goldenDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      entry.parentPath === goldenDir
        ? entry.name
        : `${entry.parentPath.slice(goldenDir.length + 1)}/${entry.name}`,
    )
    .sort();

  assert.deepEqual([...produced.keys()].sort(), goldenPaths);
  for (const path of goldenPaths) {
    const expected = readFileSync(resolve(goldenDir, path), "utf-8");
    assert.equal(produced.get(path), expected, `golden mismatch: ${path}`);
  }
});

test("opts.packages are injected into the generated .pi/settings.json", () => {
  const pins = ["git:github.com/mihaiiova/pi-config@abc123", "npm:pi-subagents@0.65.0"];
  const { files } = generateProject(model, {}, { packages: pins });
  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);
  assert.deepEqual(settings.packages, pins);

  // Without opts, no packages key is added (backward-compatible).
  const plain = generateProject(model, {});
  const plainSettings = JSON.parse(byPath(plain.files, ".pi/settings.json").content);
  assert.equal(plainSettings.packages, undefined);
});
