/**
 * policy — materialize the enforced-vs-advisory policy split.
 *
 * Pure module. `policies.enforced[]` is the capability boundary (least
 * privilege, no runtime guard needed): an agent's `tools` allowlist and an
 * MCP server's hidden tool list. `policies.advisory[]` is behavioral guidance
 * only. The two are kept visibly separate so prose is never mistaken for
 * enforcement.
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function enforcedEntries(policies) {
  if (!isPlainObject(policies)) return [];
  return Array.isArray(policies.enforced) ? policies.enforced : [];
}

/**
 * The effective tool allowlist for an agent: an enforced `{ agent, tools }`
 * rule is the authoritative capability ceiling and replaces the agent's
 * declared `tools`; otherwise the declared tools stand.
 *
 * @param {string} agentName
 * @param {object|undefined} policies the validated `policies` block.
 * @param {string[]} declaredTools the agent's `tools` from `agents[]`.
 * @returns {string[]}
 */
export function enforcedAgentTools(agentName, policies, declaredTools) {
  for (const rule of enforcedEntries(policies)) {
    if (isPlainObject(rule) && rule.agent === agentName && Array.isArray(rule.tools)) {
      return rule.tools;
    }
  }
  return Array.isArray(declaredTools) ? declaredTools : [];
}

/**
 * The list of tool-name globs to hide for an MCP server, from an enforced
 * `{ mcp, hide }` rule. Materialized as `excludeTools` (the pi-mcp-adapter
 * mechanism for making tools unreachable — see docs/agent-factory.md §C.5).
 *
 * @param {string} serverName
 * @param {object|undefined} policies
 * @returns {string[]}
 */
export function hiddenMcpTools(serverName, policies) {
  for (const rule of enforcedEntries(policies)) {
    if (isPlainObject(rule) && rule.mcp === serverName && Array.isArray(rule.hide)) {
      return rule.hide.filter((pattern) => typeof pattern === "string");
    }
  }
  return [];
}

/**
 * The advisory guidance strings, in order.
 *
 * @param {object|undefined} policies
 * @returns {string[]}
 */
export function advisoryText(policies) {
  if (!isPlainObject(policies) || !Array.isArray(policies.advisory)) return [];
  return policies.advisory.filter((line) => typeof line === "string");
}
