import { test } from "node:test";
import assert from "node:assert/strict";
import { importSystem } from "../import.mjs";
import { validateSystem } from "../validate.mjs";

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
  ],
  mcpServers: { cloudflare: { command: "npx", args: ["cloudflare-mcp", "--stdio"] } },
};

test("importSystem maps pi-config tiers and routing into models", () => {
  const { system } = importSystem(SETTINGS, PI_CONFIG, DETECTED);
  assert.deepEqual(system.models.tiers, PI_CONFIG.tiers);
  assert.equal(system.models.parentTier, "high");
  assert.deepEqual(system.models.subagents, {
    worker: "medium",
    scout: "small",
    reviewer: "small",
    oracle: "high",
  });
});

test("importSystem derives the orchestrator from settings defaults", () => {
  const { system } = importSystem(SETTINGS, PI_CONFIG, DETECTED);
  assert.equal(system.orchestrator.name, "orchestrator");
  assert.equal(system.orchestrator.model, "high", "defaultModel resolves to the high tier");
  assert.deepEqual(system.orchestrator.tools, SETTINGS.defaultTools);
});

test("importSystem emits agents, mcp integrations, and spec-lifecycle workflows", () => {
  const { system } = importSystem(SETTINGS, PI_CONFIG, DETECTED);

  assert.equal(system.agents.length, 2);
  assert.equal(system.agents[0].name, "scout");
  assert.equal(system.agents[0].model, "small", "model ref reverse-maps to a tier");

  assert.deepEqual(system.integrations.mcp, [
    { name: "cloudflare", config: { command: "npx", args: ["cloudflare-mcp", "--stdio"] } },
  ]);

  const skillNames = system.skills.map((s) => s.name);
  for (const wf of ["spec-new", "spec-start", "spec-review", "spec-close"]) {
    assert.ok(skillNames.includes(wf), `spec-lifecycle skill ${wf} declared`);
  }
  const workflowNames = system.workflows.map((w) => w.name);
  assert.deepEqual(workflowNames, ["spec-new", "spec-start", "spec-review", "spec-close"]);
  assert.ok(system.workflows.every((w) => skillNames.includes(w.skill)), "workflow skills reference declared skills");
});

test("importSystem flags unsupported settings instead of silently dropping them", () => {
  const settings = {
    ...SETTINGS,
    customExtensions: ["/tmp/my-ext"],
    exoticProviderOverride: { model: "x/y" },
  };
  const { system, report } = importSystem(settings, PI_CONFIG, DETECTED);

  const keys = report.flagged.map((f) => f.key);
  assert.ok(keys.includes("spec"), "spec block is flagged as preserved-not-modeled");
  assert.ok(keys.includes("customExtensions"), "unknown key is flagged");
  assert.ok(keys.includes("exoticProviderOverride"), "exotic override is flagged");
  assert.ok(report.flagged.every((f) => typeof f.reason === "string" && f.reason), "every flag has a reason");
  // The unsupported keys must NOT leak into the emitted model.
  assert.ok(!("customExtensions" in system));
});

test("importSystem output is a valid schema-v1 document", () => {
  const { system } = importSystem(SETTINGS, PI_CONFIG, DETECTED);
  const { ok, errors } = validateSystem(system);
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});
