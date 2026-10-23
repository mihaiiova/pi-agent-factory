import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importSystem } from "../import.mjs";
import { generateProject } from "../generate.mjs";
import { modifyPlan } from "../modify.mjs";
import { validateSystem } from "../validate.mjs";
import { declareDependencies } from "../deps.mjs";
import { parseSystem } from "../parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const SETTINGS = {
  defaultProvider: "openai-codex",
  defaultModel: "gpt-5.6-terra",
  defaultThinkingLevel: "medium",
  defaultTools: ["read", "grep", "find", "ls", "bash", "edit", "write", "subagent"],
  subagents: {
    agentOverrides: {
      oracle: { model: "openai-codex/gpt-5.6-terra" },
      reviewer: { model: "deepseek/deepseek-v4-flash" },
      scout: { model: "deepseek/deepseek-v4-flash" },
      worker: { model: "deepseek/deepseek-v4-pro" },
    },
  },
  spec: { baseBranch: "development", releaseBranch: "master", tagPrefix: "v", versionFile: "package.json" },
};

const PI_CONFIG = {
  tiers: {
    high: { model: "openai-codex/gpt-5.6-terra", thinking: "medium" },
    medium: { model: "deepseek/deepseek-v4-pro", thinking: "high" },
    small: { model: "deepseek/deepseek-v4-flash", thinking: "high" },
  },
  parentTier: "high",
  subagentTiers: { worker: "medium", scout: "small", reviewer: "small", oracle: "high" },
};

const DETECTED = {
  name: "coding-agent-system",
  skills: [],
  agents: [
    { name: "scout", description: "Read-only discovery", tools: ["read", "grep", "find", "ls"], model: "deepseek/deepseek-v4-flash", prompt: "Investigate.\n" },
    { name: "worker", description: "Single writer", tools: ["read", "bash", "edit", "write"], model: "deepseek/deepseek-v4-pro", prompt: "Implement.\n" },
    { name: "reviewer", description: "Read-only review", tools: ["read", "grep", "find", "ls", "bash"], model: "deepseek/deepseek-v4-flash", prompt: "Review.\n" },
    { name: "oracle", description: "High-tier reasoning", tools: ["read", "grep", "find", "ls"], model: "openai-codex/gpt-5.6-terra", prompt: "Reason.\n" },
  ],
  mcpServers: { cloudflare: { command: "npx", args: ["cloudflare-mcp", "--stdio"] } },
};

const PINS = declareDependencies(
  ["npm:pi-mcp-adapter@2.32.1", "npm:pi-subagents@0.65.0", "npm:pi-web-access@0.27.0"],
  "0000000000000000000000000000000000000000",
  ["pi-subagents", "pi-mcp-adapter", "pi-web-access"],
);

test("round-trip: import → generate preserves subagent routing, skills, workflows", () => {
  const { system } = importSystem(SETTINGS, PI_CONFIG, DETECTED);
  const { ok, errors } = validateSystem(system);
  assert.equal(ok, true, `imported system must validate: ${errors.join("; ")}`);

  const { files } = generateProject(system, {}, { packages: PINS });

  const settings = JSON.parse(files.find((f) => f.path === ".pi/settings.json").content);
  assert.deepEqual(settings.subagents.agentOverrides, {
    oracle: { model: "openai-codex/gpt-5.6-terra" },
    reviewer: { model: "deepseek/deepseek-v4-flash" },
    scout: { model: "deepseek/deepseek-v4-flash" },
    worker: { model: "deepseek/deepseek-v4-pro" },
  }, "subagent routing survives import+generate");
  assert.deepEqual(settings.packages, PINS, "pinned packages survive");

  const agentPaths = files.filter((f) => f.path.startsWith(".pi/agents/")).map((f) => f.path);
  assert.equal(agentPaths.length, 4, "four specialist agents materialize");

  const localSkills = files.filter((f) => f.path.includes("/SKILL.md"));
  assert.equal(localSkills.length, 0, "spec-lifecycle skills are package-provided (external), not duplicated locally");
  const declaredSkills = system.skills.map((s) => s.name);
  for (const wf of ["spec-new", "spec-start", "spec-review", "spec-close"]) {
    assert.ok(declaredSkills.includes(wf), `spec-lifecycle skill ${wf} is declared`);
  }

  assert.ok(files.some((f) => f.path === ".pi/mcp.json" && f.content.includes("cloudflare")), "MCP integration survives");
});

test("round-trip: modify adds an agent and preserves unrelated authored content", () => {
  const { system } = importSystem(SETTINGS, PI_CONFIG, DETECTED);

  // First generate, then simulate a user edit to an authored file.
  const first = generateProject(system, {}, { packages: PINS });
  const existing = Object.fromEntries(first.files.map((f) => [f.path, f.content]));
  const appendMarker = existing[".pi/APPEND_SYSTEM.md"].split("\n", 1)[0];
  existing[".pi/APPEND_SYSTEM.md"] = `${appendMarker}\nUser-added orchestrator line.\n`;

  // Modify: add a new agent.
  const changed = {
    ...system,
    agents: [...system.agents, { name: "researcher", description: "Researches", tools: ["read"], model: "deepseek/deepseek-v4-pro", prompt: "Research.\n" }],
  };
  const plan = modifyPlan(changed, existing);

  const researcher = plan.files.find((f) => f.path === ".pi/agents/researcher.md");
  assert.equal(researcher.action, "create", "the added agent is scaffolded");

  const append = plan.files.find((f) => f.path === ".pi/APPEND_SYSTEM.md");
  assert.equal(append.action, "none", "unrelated authored edit is preserved, not overwritten");
});

test("coding-agent template generates the expected native files with pinned packages", () => {
  const templateModel = parseSystem(
    readFileSync(resolve(here, "../templates/coding-agent/.pi/system.yaml"), "utf-8"),
  );
  const { ok, errors } = validateSystem(templateModel);
  assert.equal(ok, true, `template must validate: ${errors.join("; ")}`);

  const { files } = generateProject(templateModel, {}, { packages: PINS });
  const settings = JSON.parse(files.find((f) => f.path === ".pi/settings.json").content);

  assert.equal(settings.packages[0], "git:github.com/mihaiiova/pi-config@0000000000000000000000000000000000000000");
  assert.ok(settings.packages.includes("npm:pi-subagents@0.65.0"));
  assert.ok(files.some((f) => f.path === ".pi/APPEND_SYSTEM.md"));
  assert.ok(files.filter((f) => f.path.startsWith(".pi/agents/")).length === 4);
  assert.ok(!files.some((f) => f.path.includes("/SKILL.md")), "package-provided skills are not duplicated locally");
});
