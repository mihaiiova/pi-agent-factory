import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpFromIntegrations } from "../mcp-gen.mjs";

test("stdio and http entries are emitted as mcpServers", () => {
  const mcp = [
    { name: "openseo", config: { url: "http://localhost:3002/mcp" } },
    { name: "gh", config: { command: "npx", args: ["-y", "gh-mcp"] } },
  ];
  assert.deepEqual(mcpFromIntegrations(mcp, {}, undefined), {
    openseo: { url: "http://localhost:3002/mcp" },
    gh: { command: "npx", args: ["-y", "gh-mcp"] },
  });
});

test("enforced hide lists become excludeTools", () => {
  const mcp = [{ name: "openseo", config: { url: "http://localhost:3002/mcp" } }];
  const policies = { enforced: [{ mcp: "openseo", hide: ["publish_*", "delete_*"] }] };
  const servers = mcpFromIntegrations(mcp, {}, policies);
  assert.deepEqual(servers.openseo.excludeTools, ["publish_*", "delete_*"]);
});

test("excludeTools merges with a config's existing excludeTools", () => {
  const mcp = [{ name: "openseo", config: { url: "http://x", excludeTools: ["a"] } }];
  const policies = { enforced: [{ mcp: "openseo", hide: ["b"] }] };
  const servers = mcpFromIntegrations(mcp, {}, policies);
  assert.deepEqual(servers.openseo.excludeTools, ["a", "b"]);
});

test("unknown existing servers are preserved", () => {
  const existing = { legacy: { command: "x" } };
  const mcp = [{ name: "openseo", config: { url: "http://x" } }];
  assert.deepEqual(mcpFromIntegrations(mcp, existing, undefined), {
    legacy: { command: "x" },
    openseo: { url: "http://x" },
  });
});

test("${ENV} references pass through, never substituted", () => {
  const mcp = [
    {
      name: "openseo",
      config: { url: "http://x", headers: { Authorization: "Bearer ${OPENSEO_TOKEN}" } },
    },
  ];
  const servers = mcpFromIntegrations(mcp, {}, undefined);
  assert.equal(servers.openseo.headers.Authorization, "Bearer ${OPENSEO_TOKEN}");
});
