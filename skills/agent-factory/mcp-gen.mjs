/**
 * mcpGen — materialize `integrations.mcp[]` into `.pi/mcp.json` `mcpServers`.
 *
 * Pure module. Standard `mcpServers` entries are emitted verbatim from the
 * model's opaque `config` object (stdio `command`/`args`/`env`/`cwd`, or HTTP
 * `url`/`headers`/`oauth`). Enforced `hide` lists become `excludeTools` on the
 * server (the pi-mcp-adapter mechanism that makes a tool unreachable). Secrets
 * are always `${ENV}` references declared in the model — this module never
 * substitutes or inlines literal values. `system.yaml` is authoritative:
 * `mcpServers` is built strictly from declared `integrations.mcp[]`; an
 * undeclared server never survives regeneration.
 */
import { hiddenMcpTools } from "./policy.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function mergeUnique(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item !== "string" || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * @param {Array} mcpList the validated `integrations.mcp[]` entries.
 * @param {object|undefined} policies the validated `policies` block.
 * @returns {Record<string, object>} the `mcpServers` map, strictly declared.
 */
export function mcpFromIntegrations(mcpList, policies) {
  const servers = {};

  if (Array.isArray(mcpList)) {
    for (const entry of mcpList) {
      if (!isPlainObject(entry) || !isNonEmptyString(entry.name)) continue;

      const config = isPlainObject(entry.config) ? { ...entry.config } : {};
      const hide = hiddenMcpTools(entry.name, policies);
      if (hide.length > 0) {
        config.excludeTools = mergeUnique(config.excludeTools, hide);
      }
      servers[entry.name] = config;
    }
  }

  return servers;
}
