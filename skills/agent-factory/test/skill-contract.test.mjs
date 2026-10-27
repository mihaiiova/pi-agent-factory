import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(resolve(here, "../SKILL.md"), "utf-8");

test("SKILL.md routes factory/agent-system intents and documents force-invocation", () => {
  assert.ok(skill.includes("/skill:agent-factory"), "documents the force-invocation command");
  assert.ok(/agent system/i.test(skill), "describes the agent-system outcome it serves");
  assert.ok(/multi-agent/i.test(skill), "describes multi-agent systems");
});

test("SKILL.md drives the lifecycle through discover/generate/modify/validate", () => {
  assert.ok(skill.includes("factory discover"), "references factory discover");
  assert.ok(skill.includes("factory generate"), "references factory generate");
  assert.ok(skill.includes("factory modify"), "references factory modify");
  assert.ok(skill.includes("factory validate"), "references factory validate");
});

test("SKILL.md interviews without depending on host skills and previews before applying", () => {
  assert.ok(!/grill-me|grill-with-docs|decisionThreshold/.test(skill), "the interview is self-contained");
  assert.ok(skill.includes("--dry-run"), "references the preview-before-apply dry-run");
});

test("SKILL.md asks for each agent's model from the full Pi line-up", () => {
  assert.ok(skill.includes("pi --list-models"), "names the model catalog source");
  assert.ok(/ships no default models/.test(skill), "hardcodes no models");
  assert.ok(skill.includes("model: provider/id"), "records the choice on the agent");
  assert.ok(/"op":"assign"/.test(skill), "documents changing a model later");
});

test("SKILL.md suggests registry skills per agent and installs only the user's picks, project-locally", () => {
  assert.ok(/ships no skills of its own; each agent gets the\s+skills the user chooses for it/.test(skill));
  assert.ok(/search-skills/.test(skill) && /preview-skill/.test(skill), "searches and previews skills.sh skills");
  assert.ok(/project-local, never global/.test(skill), "never installs globally");
  assert.ok(!skill.includes("knownIntegrations"), "no built-in recommendation list");
  for (const form of ["npm:<name>@<version>", "./path", "agents[].skills", "skills:<owner>/<repo>/<dir>@<commit>"]) {
    assert.ok(skill.includes(form), `documents ${form}`);
  }
});

test("SKILL.md states the enforced-vs-advisory split and the ownership contract", () => {
  assert.ok(skill.includes("Enforced"), "states the enforced category");
  assert.ok(skill.includes("Advisory"), "states the advisory category");
  assert.ok(skill.includes("excludeTools"), "names the enforced MCP mechanism");
  assert.ok(skill.includes("never silently overwritten"), "states the conflict contract");
  assert.ok(/never write a secret/i.test(skill), "states the credential-safety rule");
});
