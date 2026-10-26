import { test } from "node:test";
import assert from "node:assert/strict";
import { importSystem } from "../import.mjs";
import { validateSystem } from "../validate.mjs";

const SETTINGS = {
  defaultProvider: "provider-a",
  defaultModel: "model-large",
  defaultThinkingLevel: "medium",
  defaultTools: ["read", "grep", "find", "ls", "bash", "edit", "write", "subagent"],
  subagents: { agentOverrides: { worker: { model: "provider-a/model-medium" } } },
  spec: { baseBranch: "development", releaseBranch: "master", tagPrefix: "v", versionFile: "package.json" },
};

const DETECTED = {
  name: "coding-agent-system",
  skills: [{ name: "house-style", description: "Write plainly", source: "./.pi/skills/house-style" }],
  agents: [
    { name: "scout", description: "Read-only discovery", tools: ["read", "grep", "find", "ls"], model: "provider-b/model-small", thinking: "low", skills: ["house-style"], prompt: "Investigate.\n" },
    { name: "worker", description: "Single writer", tools: ["read", "bash", "edit", "write"], model: "provider-a/model-medium", prompt: "Implement.\n" },
  ],
  mcpServers: { cloudflare: { command: "npx", args: ["cloudflare-mcp", "--stdio"] } },
};

test("importSystem derives the orchestrator model and thinking from settings defaults", () => {
  const { system } = importSystem(SETTINGS, DETECTED);
  assert.equal(system.orchestrator.name, "orchestrator");
  assert.equal(system.orchestrator.model, "provider-a/model-large");
  assert.equal(system.orchestrator.thinking, "medium");
  assert.deepEqual(system.orchestrator.tools, SETTINGS.defaultTools);
  assert.equal(system.models, undefined, "no tiers");
});

test("importSystem keeps each agent's own model, thinking and skills", () => {
  const { system } = importSystem(SETTINGS, DETECTED);
  assert.deepEqual(system.agents.map((a) => [a.name, a.model, a.thinking, a.skills]), [
    ["scout", "provider-b/model-small", "low", ["house-style"]],
    ["worker", "provider-a/model-medium", undefined, undefined],
  ]);
});

test("importSystem declares only detected skills, by their own directory, and no workflows", () => {
  const { system } = importSystem(SETTINGS, DETECTED);
  assert.deepEqual(system.skills, [{ name: "house-style", description: "Write plainly", source: "./.pi/skills/house-style" }]);
  assert.equal(system.workflows, undefined, "no workflows are invented");
  assert.deepEqual(system.integrations.mcp, [
    { name: "cloudflare", config: { command: "npx", args: ["cloudflare-mcp", "--stdio"] } },
  ]);
});

test("importSystem flags missing models instead of inventing them", () => {
  const { system, report } = importSystem({}, { agents: [{ name: "helper", tools: [] }] });
  assert.equal(system.orchestrator.model, undefined);
  assert.equal(system.agents[0].model, undefined);
  const keys = report.flagged.map((f) => f.key);
  assert.ok(keys.includes("orchestrator.model"));
  assert.ok(keys.includes("agents.helper.model"));
});

test("importSystem flags unsupported settings instead of silently dropping them", () => {
  const settings = {
    ...SETTINGS,
    customExtensions: ["/tmp/my-ext"],
    exoticProviderOverride: { model: "x/y" },
  };
  const { system, report } = importSystem(settings, DETECTED);

  const keys = report.flagged.map((f) => f.key);
  assert.ok(keys.includes("spec"), "spec block is flagged as preserved-not-modeled");
  assert.ok(keys.includes("subagents.agentOverrides"), "routing overrides are flagged, not modeled");
  assert.ok(keys.includes("customExtensions"), "unknown key is flagged");
  assert.ok(keys.includes("exoticProviderOverride"), "exotic override is flagged");
  assert.ok(report.flagged.every((f) => typeof f.reason === "string" && f.reason), "every flag has a reason");
  assert.ok(!("customExtensions" in system));
});

test("importSystem output is a valid schema-v1 document", () => {
  const { system } = importSystem(SETTINGS, DETECTED);
  const { ok, errors } = validateSystem(system);
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});
