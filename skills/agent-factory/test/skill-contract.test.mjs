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

test("SKILL.md reuses the graded interview and previews before applying", () => {
  assert.ok(skill.includes("decisionThreshold"), "references the interview threshold");
  assert.ok(skill.includes("grill-me") && skill.includes("grill-with-docs"), "references grill-me/grill-with-docs");
  assert.ok(skill.includes("--dry-run"), "references the preview-before-apply dry-run");
});

test("SKILL.md recommends not-installed capabilities with install instructions", () => {
  assert.ok(skill.includes("knownIntegrations"), "names the discovery source for not-installed candidates");
  assert.ok(/not-installed/.test(skill), "recommends not-installed items");
  assert.ok(/install\s+instructions/.test(skill), "promises install instructions");
});

test("SKILL.md states the enforced-vs-advisory split and the ownership contract", () => {
  assert.ok(skill.includes("Enforced"), "states the enforced category");
  assert.ok(skill.includes("Advisory"), "states the advisory category");
  assert.ok(skill.includes("excludeTools"), "names the enforced MCP mechanism");
  assert.ok(skill.includes("never silently overwritten"), "states the conflict contract");
  assert.ok(/never write a secret/i.test(skill), "states the credential-safety rule");
});
