/**
 * import — reconstruct a `system.yaml` document from an existing pi-config
 * project's `.pi/settings.json` + `.pi/pi-config.json` (plus detected
 * skills/agents/MCP servers).
 *
 * Pure seam: `importSystem(settings, piConfig, detected) -> { system, report }`.
 * The import is conservative: the returned `system` maps everything the model
 * can express, and `report.flagged` lists settings the model cannot express
 * (never silently dropped). No filesystem or CLI work.
 */

const DEFAULT_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write", "subagent"];
const SPEC_LIFECYCLE_SKILLS = ["spec-new", "spec-start", "spec-review", "spec-close"];
const KNOWN_SETTINGS_KEYS = new Set([
  "defaultProvider", "defaultModel", "defaultThinkingLevel",
  "defaultTools", "subagents", "packages", "spec", "theme",
]);

const WORKFLOW_SPECS = [
  { name: "spec-new", description: "Discover and define a new spec or epic", approval: "publish-spec", verify: "the spec issue is published with a spec:ready label", agents: ["scout", "worker"] },
  { name: "spec-start", description: "Implement a ready spec on its branch, test-first", approval: "none", verify: "tests pass and the branch carries coherent checkpoint commits", agents: ["scout", "worker"] },
  { name: "spec-review", description: "Verify the implementation against acceptance criteria", approval: "none", verify: "the review passes the spec.checks", agents: ["reviewer"] },
  { name: "spec-close", description: "Merge the reviewed branch and close the spec", approval: "merge", verify: "the spec branch is merged and the label is spec:done", agents: ["worker", "reviewer"] },
];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** Resolve the tiers map from pi-config, or synthesize one from settings. */
function resolveTiers(piConfig, settings) {
  if (isPlainObject(piConfig) && isPlainObject(piConfig.tiers)) {
    return { ...piConfig.tiers };
  }
  const tiers = {};
  const provider = isPlainObject(settings) ? settings.defaultProvider : undefined;
  const model = isPlainObject(settings) ? settings.defaultModel : undefined;
  if (isNonEmptyString(provider) && isNonEmptyString(model)) {
    tiers.high = {
      model: `${provider}/${model}`,
      thinking: isNonEmptyString(settings.defaultThinkingLevel) ? settings.defaultThinkingLevel : undefined,
    };
  }
  return tiers;
}

/** Find the tier whose model ref matches `ref`. */
function tierForModelRef(tiers, ref) {
  for (const [name, tier] of Object.entries(tiers)) {
    if (isPlainObject(tier) && tier.model === ref) return name;
  }
  return undefined;
}

/**
 * @param {object} [settings] parsed `.pi/settings.json`.
 * @param {object} [piConfig] parsed `.pi/pi-config.json`.
 * @param {object} [detected] `{ name?, skills[], agents[], mcpServers{} }`.
 * @returns {{ system: object, report: { imported: string[], flagged: Array<{key, reason}> } }}
 */
export function importSystem(settings, piConfig, detected) {
  const detectedObj = isPlainObject(detected) ? detected : {};
  const settingsObj = isPlainObject(settings) ? settings : {};

  const tiers = resolveTiers(piConfig, settingsObj);
  const parentTier =
    isPlainObject(piConfig) && isNonEmptyString(piConfig.parentTier)
      ? piConfig.parentTier
      : isPlainObject(tiers.high)
        ? "high"
        : undefined;
  const subagents =
    isPlainObject(piConfig) && isPlainObject(piConfig.subagentTiers)
      ? { ...piConfig.subagentTiers }
      : undefined;

  // Orchestrator: the primary session, derived from settings defaults.
  const provider = settingsObj.defaultProvider;
  const model = settingsObj.defaultModel;
  const defaultRef = isNonEmptyString(provider) && isNonEmptyString(model)
    ? `${provider}/${model}`
    : undefined;
  const orchestratorTier =
    defaultRef && tierForModelRef(tiers, defaultRef)
      ? tierForModelRef(tiers, defaultRef)
      : parentTier || Object.keys(tiers)[0];
  const orchestratorTools =
    Array.isArray(settingsObj.defaultTools) && settingsObj.defaultTools.length > 0
      ? settingsObj.defaultTools
      : DEFAULT_TOOLS;

  // Agents: reverse-map each detected model ref to a tier, adding a tier when
  // the ref is not already declared.
  const agents = [];
  for (const agent of Array.isArray(detectedObj.agents) ? detectedObj.agents : []) {
    if (!isPlainObject(agent) || !isNonEmptyString(agent.name)) continue;
    let tier = tierForModelRef(tiers, agent.model);
    if (!tier && isNonEmptyString(agent.model)) {
      tier = `tier-${agent.name}`;
      tiers[tier] = { model: agent.model };
    }
    agents.push({
      name: agent.name,
      description: isNonEmptyString(agent.description) ? agent.description : "",
      tools: Array.isArray(agent.tools) ? agent.tools : [],
      model: tier ?? parentTier ?? "high",
      prompt: isNonEmptyString(agent.prompt) ? agent.prompt : "",
    });
  }

  // Skills: detected skills plus the spec-lifecycle skills (provided by the
  // pinned pi-config package dependency, declared not copied).
  const skills = [];
  const seenSkills = new Set();
  for (const skill of Array.isArray(detectedObj.skills) ? detectedObj.skills : []) {
    if (!isPlainObject(skill) || !isNonEmptyString(skill.name)) continue;
    skills.push({
      name: skill.name,
      description: isNonEmptyString(skill.description) ? skill.description : "",
      body: isNonEmptyString(skill.body) ? skill.body : "",
    });
    seenSkills.add(skill.name);
  }
  for (const name of SPEC_LIFECYCLE_SKILLS) {
    if (seenSkills.has(name)) continue;
    skills.push({ name, description: `Spec lifecycle: ${name} (provided by the pinned pi-config package)` });
    seenSkills.add(name);
  }

  // Workflows: the spec-lifecycle set, each referencing its declared skill and
  // only the agents that are actually declared.
  const agentNames = new Set(agents.map((a) => a.name));
  const workflows = WORKFLOW_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    skill: spec.name,
    trigger: { kind: "manual" },
    entry: "orchestrator",
    agents: spec.agents.filter((a) => agentNames.has(a)),
    inputs: [],
    outputs: [],
    approval: spec.approval,
    verify: spec.verify,
  }));

  // Integrations: MCP servers detected from .pi/mcp.json.
  const mcp = [];
  for (const [name, config] of Object.entries(detectedObj.mcpServers ?? {})) {
    if (isPlainObject(config)) mcp.push({ name, config });
  }

  const system = {
    schema: 1,
    name: isNonEmptyString(detectedObj.name) ? detectedObj.name : "imported-system",
    description: "Imported pi-config system",
    models: { tiers, parentTier },
    orchestrator: {
      name: "orchestrator",
      description: "Primary interactive agent (imported)",
      model: orchestratorTier,
      tools: orchestratorTools,
    },
  };
  if (subagents && Object.keys(subagents).length > 0) system.models.subagents = subagents;
  if (agents.length > 0) system.agents = agents;
  system.skills = skills;
  if (mcp.length > 0) system.integrations = { mcp };
  system.workflows = workflows;

  // Report: imported categories + flagged unsupported settings.
  const report = { imported: ["models", "orchestrator", "skills", "workflows"], flagged: [] };
  if (agents.length > 0) report.imported.push("agents");
  if (mcp.length > 0) report.imported.push("integrations");

  if (settingsObj.spec !== undefined) {
    report.flagged.push({
      key: "spec",
      reason: "spec lifecycle block is preserved in .pi/settings.json but is not expressed in system.yaml",
    });
  }
  for (const key of Object.keys(settingsObj)) {
    if (!KNOWN_SETTINGS_KEYS.has(key)) {
      report.flagged.push({ key, reason: `unsupported setting "${key}" cannot be expressed in system.yaml` });
    }
  }
  if (isPlainObject(settingsObj.subagents)) {
    for (const key of Object.keys(settingsObj.subagents)) {
      if (key !== "agentOverrides") {
        report.flagged.push({ key: `subagents.${key}`, reason: "unsupported subagents block; only agentOverrides is modeled" });
      }
    }
  }

  return { system, report };
}
