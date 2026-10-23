import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveCapabilities, checkCapabilities } from "../capabilities.mjs";

const PI_PACKAGES = ["npm:pi-subagents@0.65.0", "npm:pi-mcp-adapter@2.32.1", "npm:pi-web-access@0.27.0"];

const MODEL = {
  schema: 1,
  name: "seo-system",
  models: { tiers: { small: { model: "m/s" } }, parentTier: "small" },
  orchestrator: { name: "orchestrator", model: "small", tools: ["read", "grep", "bash", "subagent"] },
  agents: [
    { name: "analyst", tools: ["read", "grep"], model: "small", prompt: "Analyze." },
  ],
  skills: [
    { name: "draft", description: "draft" },
    { name: "spec-start", description: "ext", external: true },
  ],
  integrations: {
    mcp: [{ name: "openseo", config: { url: "http://localhost:3002/mcp" } }],
  },
  policies: { enforced: [{ mcp: "openseo", hide: ["publish_*"] }] },
  packages: ["npm:extra@1.0.0"],
};

test("effectiveCapabilities derives the full intended surface", () => {
  const caps = effectiveCapabilities(MODEL, { piPackages: PI_PACKAGES });
  assert.deepEqual(caps.orchestratorTools, ["bash", "grep", "read", "subagent"]);
  assert.deepEqual(caps.agents, [{ name: "analyst", tools: ["grep", "read"], model: "small" }]);
  assert.deepEqual(caps.skills, [
    { name: "draft", external: false },
    { name: "spec-start", external: true },
  ]);
  assert.deepEqual(caps.mcpServers, [{ name: "openseo", excludeTools: ["publish_*"] }]);
  assert.deepEqual(caps.packages, [
    "npm:pi-subagents@0.65.0",
    "npm:pi-mcp-adapter@2.32.1",
    "npm:extra@1.0.0",
  ]);
  assert.ok(caps.notes.length >= 2, "states subagent + extension-tool enforcement notes");
});

test("checkCapabilities passes for consistent generated config", () => {
  const caps = effectiveCapabilities(MODEL, { piPackages: PI_PACKAGES });
  const generated = {
    settings: { defaultTools: MODEL.orchestrator.tools, packages: caps.packages },
    mcpJson: { mcpServers: { openseo: { url: "http://localhost:3002/mcp", excludeTools: ["publish_*"] } } },
  };
  const { ok, errors } = checkCapabilities(MODEL, generated, { piPackages: PI_PACKAGES });
  assert.equal(ok, true, `expected consistent: ${errors.join("; ")}`);
});

test("checkCapabilities flags a hand-added mcp server", () => {
  const caps = effectiveCapabilities(MODEL, { piPackages: PI_PACKAGES });
  const generated = {
    settings: { defaultTools: MODEL.orchestrator.tools, packages: caps.packages },
    mcpJson: { mcpServers: { openseo: {}, ghost: {} } },
  };
  const { ok, errors } = checkCapabilities(MODEL, generated, { piPackages: PI_PACKAGES });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("mcpServers mismatch")), "undeclared server flagged");
});

test("checkCapabilities flags a wrong defaultTools", () => {
  const caps = effectiveCapabilities(MODEL, { piPackages: PI_PACKAGES });
  const generated = {
    settings: { defaultTools: ["read"], packages: caps.packages },
    mcpJson: { mcpServers: {} },
  };
  const { ok, errors } = checkCapabilities(MODEL, generated, { piPackages: PI_PACKAGES });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("defaultTools mismatch")), "tool mismatch flagged");
});
