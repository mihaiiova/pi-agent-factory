/**
 * import — reconstruct a `system.yaml` document from an existing Pi project's
 * `.pi/settings.json` plus detected agents, skills, and MCP servers.
 *
 * Pure seam: `importSystem(settings, detected) -> { system, report }`. The
 * import is conservative: the returned `system` maps everything the model can
 * express, and `report.flagged` lists settings the model cannot express or
 * facts the user must still supply (never silently dropped or invented). No
 * filesystem or CLI work.
 */

const DEFAULT_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write", "subagent"];
const KNOWN_SETTINGS_KEYS = new Set([
  "defaultProvider", "defaultModel", "defaultThinkingLevel",
  "defaultTools", "subagents", "packages", "spec", "theme",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {object} [settings] parsed `.pi/settings.json`.
 * @param {object} [detected] `{ name?, skills[], agents[], mcpServers{} }`;
 *   each detected skill carries the project-relative `source` of its directory.
 * @returns {{ system: object, report: { imported: string[], flagged: Array<{key, reason}> } }}
 */
export function importSystem(settings, detected) {
  const detectedObj = isPlainObject(detected) ? detected : {};
  const settingsObj = isPlainObject(settings) ? settings : {};
  const flagged = [];

  // Orchestrator: the primary session, derived from settings defaults.
  const orchestratorModel =
    isNonEmptyString(settingsObj.defaultProvider) && isNonEmptyString(settingsObj.defaultModel)
      ? `${settingsObj.defaultProvider}/${settingsObj.defaultModel}`
      : undefined;
  if (!orchestratorModel) {
    flagged.push({ key: "orchestrator.model", reason: "no defaultProvider/defaultModel in settings; choose a model from pi --list-models" });
  }
  const orchestrator = {
    name: "orchestrator",
    description: "Primary interactive agent (imported)",
    tools: Array.isArray(settingsObj.defaultTools) && settingsObj.defaultTools.length > 0
      ? settingsObj.defaultTools
      : DEFAULT_TOOLS,
  };
  if (orchestratorModel) orchestrator.model = orchestratorModel;
  if (isNonEmptyString(settingsObj.defaultThinkingLevel)) orchestrator.thinking = settingsObj.defaultThinkingLevel;

  // Agents keep the model their own definition names; none is invented.
  const agents = [];
  for (const agent of Array.isArray(detectedObj.agents) ? detectedObj.agents : []) {
    if (!isPlainObject(agent) || !isNonEmptyString(agent.name)) continue;
    const entry = {
      name: agent.name,
      description: isNonEmptyString(agent.description) ? agent.description : "",
      tools: Array.isArray(agent.tools) ? agent.tools : [],
      prompt: isNonEmptyString(agent.prompt) ? agent.prompt : "",
    };
    if (isNonEmptyString(agent.model)) entry.model = agent.model;
    else flagged.push({ key: `agents.${agent.name}.model`, reason: "the agent definition names no model; choose one from pi --list-models" });
    if (isNonEmptyString(agent.thinking)) entry.thinking = agent.thinking;
    if (Array.isArray(agent.skills) && agent.skills.length > 0) entry.skills = agent.skills;
    agents.push(entry);
  }

  // Skills already in the project are declared by their own directory.
  const skills = [];
  for (const skill of Array.isArray(detectedObj.skills) ? detectedObj.skills : []) {
    if (!isPlainObject(skill) || !isNonEmptyString(skill.name) || !isNonEmptyString(skill.source)) continue;
    const entry = { name: skill.name, source: skill.source };
    if (isNonEmptyString(skill.description)) entry.description = skill.description;
    skills.push(entry);
  }

  const mcp = [];
  for (const [name, config] of Object.entries(detectedObj.mcpServers ?? {})) {
    if (isPlainObject(config)) mcp.push({ name, config });
  }

  const system = {
    schema: 1,
    name: isNonEmptyString(detectedObj.name) ? detectedObj.name : "imported-system",
    description: "Imported Pi system",
    orchestrator,
  };
  if (agents.length > 0) system.agents = agents;
  if (skills.length > 0) system.skills = skills;
  if (mcp.length > 0) system.integrations = { mcp };

  const imported = ["orchestrator"];
  if (agents.length > 0) imported.push("agents");
  if (skills.length > 0) imported.push("skills");
  if (mcp.length > 0) imported.push("integrations");

  if (settingsObj.spec !== undefined) {
    flagged.push({ key: "spec", reason: "spec block is preserved in .pi/settings.json but is not expressed in system.yaml" });
  }
  if (settingsObj.theme !== undefined) {
    flagged.push({ key: "theme", reason: "theme is a settings-only cosmetic key, not expressible in system.yaml" });
  }
  if (settingsObj.packages !== undefined) {
    flagged.push({ key: "packages", reason: "packages are re-declared by the forge (deps.mjs) from its pinned runtime, not imported from settings" });
  }
  for (const key of Object.keys(settingsObj)) {
    if (!KNOWN_SETTINGS_KEYS.has(key)) {
      flagged.push({ key, reason: `unsupported setting "${key}" cannot be expressed in system.yaml` });
    }
  }
  if (isPlainObject(settingsObj.subagents)) {
    for (const key of Object.keys(settingsObj.subagents)) {
      flagged.push({
        key: `subagents.${key}`,
        reason: key === "agentOverrides"
          ? "routing overrides are not modeled; each agent declares its own model"
          : "unsupported subagents block",
      });
    }
  }

  return { system, report: { imported, flagged } };
}
