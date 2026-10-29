import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpFromIntegrations } from "../mcp-gen.mjs";

test("stdio and http entries are emitted as mcpServers", () => {
  const mcp = [
    { name: "openseo", config: { url: "http://localhost:3002/mcp" } },
    { name: "gh", config: { command: "npx", args: ["-y", "gh-mcp"] } },
  ];
  assert.deepEqual(mcpFromIntegrations(mcp, undefined), {
    openseo: { url: "http://localhost:3002/mcp" },
    gh: { command: "npx", args: ["-y", "gh-mcp"] },
  });
});

test("enforced hide lists become excludeTools", () => {
  const mcp = [{ name: "openseo", config: { url: "http://localhost:3002/mcp" } }];
  const policies = { enforced: [{ mcp: "openseo", hide: ["publish_*", "delete_*"] }] };
  const servers = mcpFromIntegrations(mcp, policies);
  assert.deepEqual(servers.openseo.excludeTools, ["publish_*", "delete_*"]);
});

test("excludeTools merges with a config's existing excludeTools", () => {
  const mcp = [{ name: "openseo", config: { url: "http://x", excludeTools: ["a"] } }];
  const policies = { enforced: [{ mcp: "openseo", hide: ["b"] }] };
  const servers = mcpFromIntegrations(mcp, policies);
  assert.deepEqual(servers.openseo.excludeTools, ["a", "b"]);
});

test("removing a server from the model drops it on the next materialization", () => {
  const first = mcpFromIntegrations(
    [{ name: "openseo", config: { url: "http://x" } }, { name: "gh", config: { command: "npx" } }],
    undefined,
  );
  assert.deepEqual(Object.keys(first).sort(), ["gh", "openseo"]);

  const second = mcpFromIntegrations([{ name: "openseo", config: { url: "http://x" } }], undefined);
  assert.deepEqual(Object.keys(second), ["openseo"], "gh is gone after removal");
});

test("a manually inserted undeclared server never survives", () => {
  // The old `existingServers` argument is gone: there is no path by which an
  // undeclared server can be merged back in. The only input is the declared list.
  const servers = mcpFromIntegrations([{ name: "openseo", config: { url: "http://x" } }], undefined);
  assert.deepEqual(Object.keys(servers), ["openseo"]);
});

test("repeated materialization is idempotent", () => {
  const mcp = [{ name: "openseo", config: { url: "http://x" } }];
  assert.deepEqual(mcpFromIntegrations(mcp, undefined), mcpFromIntegrations(mcp, undefined));
});

test("${ENV} references pass through, never substituted", () => {
  const mcp = [
    {
      name: "openseo",
      config: { url: "http://x", headers: { Authorization: "Bearer ${OPENSEO_TOKEN}" } },
    },
  ];
  const servers = mcpFromIntegrations(mcp, undefined);
  assert.equal(servers.openseo.headers.Authorization, "Bearer ${OPENSEO_TOKEN}");
});
