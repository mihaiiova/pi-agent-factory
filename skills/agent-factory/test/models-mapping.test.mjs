import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModelSettings } from "../../../extensions/pi-config/generate-settings.mjs";

// The adapter spec 2 will use to map `system.yaml` `models` → .pi/settings.json.
// It is a rename adapter, NOT a fork: buildModelSettings reads `subagentTiers`
// while the schema spells it `subagents` (see migrate.mjs and schema.md).
function modelsToConfig(models) {
  return {
    tiers: models.tiers,
    parentTier: models.parentTier,
    subagentTiers: models.subagents,
  };
}

test("schema models block maps to buildModelSettings via the rename adapter", () => {
  const models = {
    tiers: {
      high: { model: "openai-codex/gpt-5.6-terra", thinking: "medium" },
      medium: { model: "deepseek/deepseek-v4-pro", thinking: "high" },
      small: { model: "deepseek/deepseek-v4-flash", thinking: "low" },
    },
    parentTier: "high",
    subagents: { worker: "medium", scout: "small", reviewer: "small", oracle: "high" },
  };

  const settings = buildModelSettings(modelsToConfig(models));

  assert.equal(settings.defaultProvider, "openai-codex");
  assert.equal(settings.defaultModel, "gpt-5.6-terra");
  assert.equal(settings.defaultThinkingLevel, "medium");
  // buildModelSettings sorts agent names; assert the full sorted overrides map.
  assert.deepEqual(settings.subagents.agentOverrides, {
    oracle: { model: "openai-codex/gpt-5.6-terra" },
    reviewer: { model: "deepseek/deepseek-v4-flash" },
    scout: { model: "deepseek/deepseek-v4-flash" },
    worker: { model: "deepseek/deepseek-v4-pro" },
  });
});

test("adapter honours a declared subagent tier over the DEFAULT fallback", () => {
  // buildModelSettings defaults worker to "high" when subagentTiers is absent;
  // the adapter must pass the declared mapping so `worker: medium` is kept.
  const models = {
    tiers: {
      high: { model: "a/high", thinking: "high" },
      medium: { model: "b/medium", thinking: "medium" },
    },
    parentTier: "high",
    subagents: { worker: "medium" },
  };

  const settings = buildModelSettings(modelsToConfig(models));

  assert.deepEqual(settings.subagents.agentOverrides, {
    worker: { model: "b/medium" },
  });
});
