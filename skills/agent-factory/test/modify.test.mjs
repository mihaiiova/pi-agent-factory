import { test } from "node:test";
import assert from "node:assert/strict";
import { generateProject } from "../generate.mjs";
import { modifyPlan } from "../modify.mjs";

const baseModel = {
  schema: 1,
  name: "seo-agent-system",
  description: "SEO",
  orchestrator: {
    name: "orchestrator",
    model: "a/high",
    thinking: "high",
    tools: ["read", "subagent"],
    prompt: "Coordinate.\n",
  },
  agents: [
    { name: "seo-analyst", description: "Analyst", tools: ["read"], model: "c/small", thinking: "low", prompt: "Analyze.\n" },
  ],
};

function byPath(files, path) {
  return files.find((f) => f.path === path);
}

/** The factory-written project as it would exist on disk before a modify. */
function baseline() {
  const { files } = generateProject(baseModel, {});
  return Object.fromEntries(files.map((f) => [f.path, f.content]));
}

test("add-agent: a new agents[] entry produces a create", () => {
  const existing = baseline();
  const model = {
    ...baseModel,
    agents: [
      ...baseModel.agents,
      { name: "article-writer", tools: ["write"], model: "b/medium", prompt: "Draft.\n" },
    ],
  };

  const { files } = modifyPlan(model, existing);
  const entry = byPath(files, ".pi/agents/article-writer.md");

  assert.equal(entry.action, "create");
  assert.equal(entry.diff, undefined, "create entries carry content, not a diff");
});

test("change-model: agent and orchestrator model changes produce writes with diffs", () => {
  const existing = baseline();
  const model = {
    ...baseModel,
    orchestrator: { ...baseModel.orchestrator, model: "d/other" },
    agents: [{ ...baseModel.agents[0], model: "b/medium" }],
  };

  const { files } = modifyPlan(model, existing);

  const agent = byPath(files, ".pi/agents/seo-analyst.md");
  assert.equal(agent.action, "write");
  assert.ok(agent.diff.includes("b/medium") && agent.diff.includes("c/small"),
    "agent diff shows the model ref change");

  const settings = byPath(files, ".pi/settings.json");
  assert.equal(settings.action, "write");
  assert.ok(settings.diff.includes('"defaultProvider": "a"') && settings.diff.includes('"defaultProvider": "d"'),
    "settings diff shows the primary-session model change");
});

test("preserve-unrelated-edit: hand-authored file and unknown settings key survive", () => {
  const existing = baseline();
  existing["README.md"] = "# My custom README\n"; // no factory marker → user-owned
  const parsedSettings = JSON.parse(existing[".pi/settings.json"]);
  existing[".pi/settings.json"] = JSON.stringify({ ...parsedSettings, theme: "dark" });

  const { files } = modifyPlan(baseModel, existing);

  assert.equal(byPath(files, "README.md").action, "none", "user-authored README untouched");

  const settings = byPath(files, ".pi/settings.json");
  assert.equal(JSON.parse(settings.content).theme, "dark", "unknown settings key preserved");
});

test("conflict-detection: user edit + model change on an authored file is a conflict", () => {
  const existing = baseline();
  const original = existing[".pi/APPEND_SYSTEM.md"];
  const marker = original.split("\n", 1)[0];
  const userEdited = `${marker}\nUser's own instructions.\n`;
  existing[".pi/APPEND_SYSTEM.md"] = userEdited;

  const model = {
    ...baseModel,
    orchestrator: { ...baseModel.orchestrator, prompt: "New prompt.\n" },
  };

  const { files, conflicts } = modifyPlan(model, existing);
  const append = byPath(files, ".pi/APPEND_SYSTEM.md");

  assert.equal(append.action, "conflict");
  assert.ok(conflicts.includes(append), "conflict is surfaced in the conflicts list");
  assert.equal(append.content, userEdited, "conflict must not overwrite the user edit");
  assert.ok(append.diff.length > 0, "conflict carries a diff (user vs model)");
});

test('modify previews missing gitignore entries without changing existing rules', () => {
  const existing = baseline();
  existing['.gitignore'] = 'node_modules\n.env\n';
  const file = byPath(modifyPlan(baseModel, existing).files, '.gitignore');
  assert.equal(file.action, 'write');
  assert.match(file.diff, /\+ # agent-factory: required ignores/);
  assert.match(file.diff, /\+ \.factory\//);
  assert.equal(existing['.gitignore'], 'node_modules\n.env\n');
});
