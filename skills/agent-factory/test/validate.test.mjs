import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSystem } from "../validate.mjs";

const TIERS = {
  high: { model: "openai-codex/gpt-5.6-terra", thinking: "medium" },
  medium: { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  small: { model: "deepseek/deepseek-v4-flash", thinking: "low" },
};

function validDoc(overrides = {}) {
  return {
    schema: 1,
    name: "seo-agent-system",
    description: "SEO analysis + drafting",
    models: {
      tiers: TIERS,
      parentTier: "high",
      subagents: { worker: "medium", scout: "small", reviewer: "small", oracle: "high" },
    },
    orchestrator: {
      name: "orchestrator",
      description: "Primary agent",
      prompt: "Coordinate the system.",
      model: "high",
      tools: ["read", "grep", "bash", "subagent"],
    },
    agents: [
      { name: "seo-analyst", description: "Analyzes SEO", tools: ["read"], model: "small", prompt: "Analyze." },
      { name: "article-writer", tools: ["write"], model: "medium" },
    ],
    skills: [
      { name: "analyze-and-draft", description: "Workflow", body: "# Analyze\n..." },
    ],
    integrations: {
      mcp: [{ name: "openseo", config: { url: "http://localhost:3002/mcp" } }],
      env: [{ name: "OPENSEO_URL", secret: false }],
    },
    workflows: [
      {
        name: "analyze-and-draft",
        skill: "analyze-and-draft",
        trigger: { kind: "manual" },
        entry: "orchestrator",
        agents: ["seo-analyst", "article-writer"],
        inputs: ["data/opportunities/*.md"],
        outputs: ["data/articles/"],
        approval: "publish",
        verify: "a draft exists",
      },
    ],
    policies: {
      enforced: [
        { agent: "seo-analyst", tools: ["read"] },
        { mcp: "openseo", hide: ["publish_*"] },
      ],
      advisory: ["Publishing requires human confirmation"],
    },
    ...overrides,
  };
}

test("validateSystem accepts a valid document", () => {
  assert.deepEqual(validateSystem(validDoc()), { ok: true, errors: [] });
});

test("validateSystem rejects a non-object document", () => {
  const { ok, errors } = validateSystem("just a string");
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("mapping")));
});

test("validateSystem rejects unknown top-level and nested keys", () => {
  const { errors } = validateSystem(
    validDoc({ bogus: true, models: { tiers: TIERS, parentTier: "high", subagents: {}, extra: 1 } }),
  );
  assert.ok(errors.some((e) => e.includes('unknown key "bogus"')));
  assert.ok(errors.some((e) => e.includes('document.models has unknown key "extra"')));
});

test("validateSystem rejects a missing/invalid schema", () => {
  const { errors } = validateSystem(validDoc({ schema: undefined }));
  assert.ok(errors.some((e) => e.includes("document.schema is required")));
  const newer = validateSystem(validDoc({ schema: 2 }));
  assert.ok(newer.errors.some((e) => e.includes("document.schema must be 1")));
});

test("validateSystem rejects a non-kebab-case name", () => {
  const { errors } = validateSystem(validDoc({ name: "Bad_Name" }));
  assert.ok(errors.some((e) => e.includes("kebab-case")));
});

test("validateSystem rejects a bad tier reference (orchestrator.model)", () => {
  const { errors } = validateSystem(validDoc({ orchestrator: { name: "orchestrator", model: "missing" } }));
  assert.ok(errors.some((e) => e.includes('orchestrator.model references tier "missing"')));
});

test("validateSystem rejects a workflow referencing an undeclared skill", () => {
  const doc = validDoc();
  doc.workflows[0].skill = "does-not-exist";
  const { errors } = validateSystem(doc);
  assert.ok(errors.some((e) => e.includes('workflows[0].skill references "does-not-exist"')));
});

test("validateSystem rejects a workflow referencing an undeclared agent", () => {
  const doc = validDoc();
  doc.workflows[0].agents = ["ghost-agent"];
  const { errors } = validateSystem(doc);
  assert.ok(errors.some((e) => e.includes('workflows[0].agents[0] references "ghost-agent"')));
});

test("validateSystem rejects a malformed workflow (no skill or entry)", () => {
  const doc = validDoc();
  doc.workflows[0] = { name: "lonely", agents: [] };
  const { errors } = validateSystem(doc);
  assert.ok(errors.some((e) => e.includes('workflows[0] must declare at least one of "skill" or "entry"')));
});

test("validateSystem rejects an incompatible policy (undeclared mcp)", () => {
  const doc = validDoc();
  doc.policies.enforced = [{ mcp: "not-there", hide: ["x"] }];
  const { errors } = validateSystem(doc);
  assert.ok(errors.some((e) => e.includes('policies.enforced[0].mcp references "not-there"')));
});

test("validateSystem rejects duplicate agent names", () => {
  const doc = validDoc();
  doc.agents.push({ name: "seo-analyst", model: "small" });
  const { errors } = validateSystem(doc);
  assert.ok(errors.some((e) => e.includes('duplicates name "seo-analyst"')));
});

test("validateSystem rejects a policy rule with neither agent nor mcp", () => {
  const doc = validDoc();
  doc.policies.enforced = [{ tools: ["read"] }];
  const { errors } = validateSystem(doc);
  assert.ok(errors.some((e) => e.includes('exactly one of "agent" or "mcp"')));
});

test("validateSystem rejects duplicate enforced rules for the same agent or mcp", () => {
  const doc = validDoc();
  doc.policies.enforced.push({ agent: "seo-analyst", tools: ["read", "write"] });
  const { errors } = validateSystem(doc);
  assert.ok(errors.some((e) => e.includes("duplicate agent rule")), "duplicate agent rule rejected");

  const doc2 = validDoc();
  doc2.policies.enforced.push({ mcp: "openseo", hide: ["delete_*"] });
  const errors2 = validateSystem(doc2).errors;
  assert.ok(errors2.some((e) => e.includes("duplicate mcp rule")), "duplicate mcp rule rejected");
});
