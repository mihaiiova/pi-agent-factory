/**
 * capabilities — the deterministic effective-capability manifest for a
 * generated system, plus a consistency check against generated config.
 *
 * Pure module. `effectiveCapabilities(model)` derives the intended runtime
 * surface solely from `system.yaml` (orchestrator/subagent tools, skills, MCP
 * servers + exclusions, packages). `checkCapabilities(model, generated)`
 * verifies that generated `.pi/settings.json` + `.pi/mcp.json` match the
 * model. Subagent `tools:` allowlists are enforced by pi-subagents (a child
 * literally lacks unlisted tools); extension-provided tools are enforced by Pi
 * at runtime and are not assertable without a running process — the manifest
 * states this instead of claiming they are absent.
 */
import { hiddenMcpTools } from "./policy.mjs";
import { runtimePackages } from "./deps.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function sortUnique(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((v) => typeof v === "string"))].sort();
}

function arraysEqual(a, b) {
  const x = sortUnique(a);
  const y = sortUnique(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * @param {object} model the migrated, validated `system.yaml` document.
 * @param {object} [opts] `{ piPackages?: string[] }` for pinned runtime packages.
 * @returns {object} the intended capability surface.
 */
export function effectiveCapabilities(model, opts = {}) {
  const orchestrator = isPlainObject(model.orchestrator) ? model.orchestrator : {};
  const integrations = isPlainObject(model.integrations) ? model.integrations : {};
  const mcpList = Array.isArray(integrations.mcp) ? integrations.mcp : [];

  const { packages } = runtimePackages(opts?.piPackages, model?.packages);

  return {
    schema: model?.schema,
    name: model?.name,
    orchestratorTools: sortUnique(orchestrator.tools),
    agents: (Array.isArray(model.agents) ? model.agents : []).map((agent) => ({
      name: agent.name,
      tools: sortUnique(agent.tools),
      model: agent.model,
    })),
    skills: (Array.isArray(model.skills) ? model.skills : []).map((skill) => ({
      name: skill.name,
      external: skill.external === true,
    })),
    mcpServers: mcpList.map((entry) => ({
      name: entry.name,
      excludeTools: sortUnique(hiddenMcpTools(entry.name, model?.policies)),
    })),
    packages,
    extensions: [],
    notes: [
      "subagent tools are enforced by pi-subagents allowlists (a child lacks unlisted tools)",
      "orchestrator defaultTools bounds built-in tools; extension- and MCP-provided tools are enforced by Pi at runtime and are not assertable without a running process",
    ],
  };
}

/**
 * Verify generated `.pi/settings.json` + `.pi/mcp.json` match the model.
 *
 * @param {object} model the validated `system.yaml` document.
 * @param {object} generated `{ settings, mcpJson }` parsed JSON.
 * @param {object} [opts] `{ piPackages?: string[] }`.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkCapabilities(model, generated, opts = {}) {
  const errors = [];
  const caps = effectiveCapabilities(model, opts);
  const settings = isPlainObject(generated?.settings) ? generated.settings : {};
  const mcp = isPlainObject(generated?.mcpJson) ? generated.mcpJson : {};

  const actualTools = sortUnique(settings.defaultTools);
  if (!arraysEqual(caps.orchestratorTools, actualTools)) {
    errors.push(
      `settings.defaultTools mismatch: expected [${caps.orchestratorTools}] got [${actualTools}]`,
    );
  }

  const actualPackages = sortUnique(settings.packages);
  if (!arraysEqual(caps.packages, actualPackages)) {
    errors.push(
      `settings.packages mismatch: expected [${caps.packages}] got [${actualPackages}]`,
    );
  }

  const actualServers = isPlainObject(mcp.mcpServers) ? mcp.mcpServers : {};
  const expectedNames = caps.mcpServers.map((s) => s.name).sort();
  if (!arraysEqual(expectedNames, Object.keys(actualServers))) {
    errors.push(
      `mcpServers mismatch: expected [${expectedNames}] got [${Object.keys(actualServers).sort()}]`,
    );
  }
  for (const server of caps.mcpServers) {
    const actual = actualServers[server.name];
    const actualExclude = sortUnique(actual?.excludeTools);
    if (!arraysEqual(server.excludeTools, actualExclude)) {
      errors.push(
        `mcpServers.${server.name}.excludeTools mismatch: expected [${server.excludeTools}] got [${actualExclude}]`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}
