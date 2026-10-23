/**
 * workflowSkill — render a declared workflow's boundary fields into the body
 * of its orchestrating SKILL.md.
 *
 * Pure seam: `workflowSkill(workflow) -> { name, description, body }`. The
 * rendered body declares the workflow's boundaries (entry, available agents,
 * inputs, outputs, approval, verify) and authoring instructions to orchestrate
 * the named agents via `subagent` — but it deliberately does NOT prescribe a
 * fixed internal step graph. Execution decisions stay with the skill at
 * runtime, matching `docs/agent-factory.md` §C.3 ("declared boundaries,
 * dynamic decisions").
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function list(items) {
  if (!Array.isArray(items) || items.length === 0) return "none";
  return items.filter((item) => typeof item === "string").join(", ");
}

/**
 * @param {object} workflow a validated `workflows[]` entry.
 * @returns {{ name: string, description: string, body: string }}
 */
export function workflowSkill(workflow) {
  const wf = isPlainObject(workflow) ? workflow : {};
  const name = isNonEmptyString(wf.name) ? wf.name : "";
  const description = isNonEmptyString(wf.description) ? wf.description : "";

  const entry = isNonEmptyString(wf.entry) ? wf.entry : "orchestrator";
  const agents = list(wf.agents);
  const inputs = list(wf.inputs);
  const outputs = list(wf.outputs);
  const approval = isNonEmptyString(wf.approval) ? wf.approval : "none";
  const verify = isNonEmptyString(wf.verify) ? wf.verify : "none";

  const body = [
    `# ${name}`,
    "",
    description,
    "",
    "## Boundary",
    "",
    `Entry: ${entry}`,
    "",
    `Available agents: ${agents}`,
    "Coordinate the available agents as the task requires; this is a declared",
    "set of available specialists, not a fixed call sequence.",
    "",
    `Inputs: ${inputs}`,
    "",
    `Outputs: ${outputs}`,
    "",
    `Approval boundary: ${approval}`,
    "",
    `Verify: ${verify}`,
    "",
    "## Orchestration",
    "",
    "Orchestrate the available agents with the `subagent` tool (direct calls or",
    "a `workflowScript`). Decide the steps at runtime from the task and the",
    "boundaries above; this skill does not prescribe a fixed sequence of agent",
    "calls.",
    "",
    "## Trigger",
    "",
    "Manual trigger (`trigger: { kind: manual }`): run interactively with `pi`,",
    "or headless with `pi -p \"<prompt>\"`.",
    "",
    "## Outputs",
    "",
    "Write all produced artifacts under the declared outputs paths above.",
    "",
  ].join("\n");

  return { name, description, body };
}
