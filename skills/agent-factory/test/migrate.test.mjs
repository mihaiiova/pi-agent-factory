import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../migrate.mjs";

test("migrate sets schema 1 on a v0 document that omits schema", () => {
  const v0 = {
    name: "legacy-system",
    models: {
      tiers: { high: { model: "openai/gpt-5", thinking: "medium" } },
      parentTier: "high",
      subagentTiers: { worker: "high" },
    },
  };
  const doc = migrate(v0);
  assert.equal(doc.schema, 1);
  assert.deepEqual(doc.models.subagents, { worker: "high" });
  assert.equal(doc.models.subagentTiers, undefined);
});

test("migrate sets schema 1 on an explicit schema: 0 document", () => {
  const v0 = {
    schema: 0,
    name: "legacy-system",
    models: {
      tiers: { small: { model: "deepseek/deepseek-flash", thinking: "high" } },
      subagentTiers: { scout: "small" },
    },
  };
  const doc = migrate(v0);
  assert.equal(doc.schema, 1);
  assert.deepEqual(doc.models.subagents, { scout: "small" });
});

test("migrate preserves v1 documents (subagents already present)", () => {
  const v1 = {
    schema: 1,
    name: "demo",
    models: {
      tiers: { high: { model: "openai/gpt-5", thinking: "high" } },
      subagents: { worker: "high" },
    },
  };
  const doc = migrate(v1);
  assert.deepEqual(doc, v1);
  assert.equal(doc.models.subagentTiers, undefined);
});

test("migrate does not mutate the input document", () => {
  const v0 = {
    name: "legacy-system",
    models: { subagentTiers: { worker: "high" } },
  };
  const snapshot = JSON.stringify(v0);
  migrate(v0);
  assert.equal(JSON.stringify(v0), snapshot);
  assert.equal(v0.schema, undefined);
});

test("migrate passes non-objects through unchanged", () => {
  assert.equal(migrate("not a doc"), "not a doc");
  assert.equal(migrate(null), null);
});
