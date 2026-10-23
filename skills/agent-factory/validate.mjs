/**
 * validate — strict schema validation for a `system.yaml` document (v1).
 *
 * Pure seam: `validateSystem(doc) -> { ok, errors[] }`. Every error is a
 * single, actionable sentence naming the offending path/key and what was
 * expected. No filesystem or CLI work; the document is already parsed.
 *
 * See `schema.md` for the field-by-field schema and validation rules.
 */

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const TOP_LEVEL_KEYS = [
  "schema", "name", "description", "models", "orchestrator",
  "agents", "skills", "integrations", "workflows", "policies",
];
const MODELS_KEYS = ["tiers", "parentTier", "subagents"];
const TIER_KEYS = ["model", "thinking"];
const ORCHESTRATOR_KEYS = ["name", "description", "prompt", "model", "tools"];
const AGENT_KEYS = ["name", "description", "tools", "model", "prompt", "inheritProjectContext", "inheritSkills"];
const SKILL_KEYS = ["name", "description", "body"];
const INTEGRATIONS_KEYS = ["mcp", "env"];
const MCP_KEYS = ["name", "config"];
const ENV_KEYS = ["name", "secret"];
const WORKFLOW_KEYS = [
  "name", "description", "skill", "trigger", "entry", "agents",
  "inputs", "outputs", "approval", "verify",
];
const TRIGGER_KEYS = ["kind"];
const POLICIES_KEYS = ["enforced", "advisory"];
const ENFORCED_KEYS = ["agent", "tools", "mcp", "hide"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function checkUnknownKeys(obj, allowed, path, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(
        `${path} has unknown key "${key}" (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

function checkNonEmptyString(value, path, errors) {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function checkStringArray(value, path, errors) {
  if (!isStringArray(value)) {
    errors.push(`${path} must be an array of strings`);
  }
}

function checkKebabCase(value, path, errors) {
  if (typeof value === "string" && value.length > 0 && !KEBAB_CASE.test(value)) {
    errors.push(
      `${path} must be kebab-case (lowercase letters, digits, single ` +
        `hyphens between segments, no leading/trailing hyphen)`,
    );
  }
}

/** Collect names from a list of named blocks, reporting duplicates. */
function collectNames(list, path, errors) {
  const names = new Set();
  if (list === undefined) return names;
  if (!Array.isArray(list)) {
    errors.push(`${path} must be an array`);
    return names;
  }
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!isPlainObject(item)) {
      errors.push(`${path}[${i}] must be an object`);
      continue;
    }
    if (isNonEmptyString(item.name)) {
      if (names.has(item.name)) {
        errors.push(`${path}[${i}] duplicates name "${item.name}"`);
      }
      names.add(item.name);
    }
  }
  return names;
}

/**
 * Validate a parsed `system.yaml` document.
 *
 * @param {unknown} doc parsed document (typically a plain object).
 * @returns {{ ok: boolean, errors: string[] }} result; `ok` is true when there
 *   are no errors.
 */
export function validateSystem(doc) {
  const errors = [];

  if (!isPlainObject(doc)) {
    return { ok: false, errors: ["document must be a YAML mapping (object)"] };
  }

  // ── Top-level ────────────────────────────────────────────────
  checkUnknownKeys(doc, TOP_LEVEL_KEYS, "document", errors);

  if (doc.schema !== 1) {
    errors.push(
      doc.schema === undefined
        ? 'document.schema is required (must be 1 for schema v1)'
        : `document.schema must be 1 (got ${JSON.stringify(doc.schema)}); ` +
          "older versions must be migrated first",
    );
  }

  if (!isNonEmptyString(doc.name)) {
    errors.push("document.name is required and must be a non-empty string");
  } else if (!KEBAB_CASE.test(doc.name)) {
    errors.push(
      `document.name must be kebab-case (lowercase letters, digits, single ` +
        `hyphens), got "${doc.name}"`,
    );
  }

  if (doc.description !== undefined && !isNonEmptyString(doc.description)) {
    errors.push("document.description must be a non-empty string");
  }

  // ── models ──────────────────────────────────────────────────
  const tierNames = new Set();
  if (doc.models !== undefined) {
    if (!isPlainObject(doc.models)) {
      errors.push("document.models must be an object");
    } else {
      checkUnknownKeys(doc.models, MODELS_KEYS, "document.models", errors);

      if (doc.models.tiers === undefined) {
        errors.push("document.models.tiers is required (a map of tier → {model})");
      } else if (!isPlainObject(doc.models.tiers)) {
        errors.push("document.models.tiers must be an object");
      } else {
        for (const [tierName, tier] of Object.entries(doc.models.tiers)) {
          tierNames.add(tierName);
          if (!isPlainObject(tier)) {
            errors.push(`document.models.tiers.${tierName} must be an object`);
            continue;
          }
          checkUnknownKeys(
            tier, TIER_KEYS, `document.models.tiers.${tierName}`, errors,
          );
          checkNonEmptyString(
            tier.model, `document.models.tiers.${tierName}.model`, errors,
          );
          if (tier.thinking !== undefined && typeof tier.thinking !== "string") {
            errors.push(
              `document.models.tiers.${tierName}.thinking must be a string`,
            );
          }
        }
      }

      if (
        doc.models.parentTier !== undefined &&
        !isNonEmptyString(doc.models.parentTier)
      ) {
        errors.push("document.models.parentTier must be a non-empty string");
      }

      if (doc.models.subagents !== undefined) {
        if (!isPlainObject(doc.models.subagents)) {
          errors.push("document.models.subagents must be an object");
        } else {
          for (const [agent, tierName] of Object.entries(doc.models.subagents)) {
            if (!isNonEmptyString(tierName)) {
              errors.push(
                `document.models.subagents.${agent} must be a non-empty tier name`,
              );
            }
          }
        }
      }
    }
  }

  // ── orchestrator ────────────────────────────────────────────
  let orchestratorName = null;
  if (doc.orchestrator !== undefined) {
    if (!isPlainObject(doc.orchestrator)) {
      errors.push("document.orchestrator must be an object");
    } else {
      checkUnknownKeys(doc.orchestrator, ORCHESTRATOR_KEYS, "document.orchestrator", errors);

      checkNonEmptyString(doc.orchestrator.name, "document.orchestrator.name", errors);
      if (isNonEmptyString(doc.orchestrator.name)) orchestratorName = doc.orchestrator.name;
      checkNonEmptyString(doc.orchestrator.model, "document.orchestrator.model", errors);

      if (
        doc.orchestrator.description !== undefined &&
        !isNonEmptyString(doc.orchestrator.description)
      ) {
        errors.push("document.orchestrator.description must be a non-empty string");
      }
      if (doc.orchestrator.prompt !== undefined && !isNonEmptyString(doc.orchestrator.prompt)) {
        errors.push("document.orchestrator.prompt must be a non-empty string");
      }
      if (doc.orchestrator.tools !== undefined) {
        checkStringArray(doc.orchestrator.tools, "document.orchestrator.tools", errors);
      }
    }
  }

  // ── agents ──────────────────────────────────────────────────
  const agentNames = collectNames(doc.agents, "document.agents", errors);
  if (doc.agents !== undefined && Array.isArray(doc.agents)) {
    doc.agents.forEach((agent, i) => {
      if (!isPlainObject(agent)) return;
      checkUnknownKeys(agent, AGENT_KEYS, `document.agents[${i}]`, errors);
      checkNonEmptyString(agent.name, `document.agents[${i}].name`, errors);
      checkKebabCase(agent.name, `document.agents[${i}].name`, errors);
      checkNonEmptyString(agent.model, `document.agents[${i}].model`, errors);
      for (const key of ["inheritProjectContext", "inheritSkills"]) {
        if (agent[key] !== undefined && typeof agent[key] !== "boolean") {
          errors.push(`document.agents[${i}].${key} must be a boolean`);
        }
      }
      if (agent.description !== undefined && !isNonEmptyString(agent.description)) {
        errors.push(`document.agents[${i}].description must be a non-empty string`);
      }
      if (agent.prompt !== undefined && !isNonEmptyString(agent.prompt)) {
        errors.push(`document.agents[${i}].prompt must be a non-empty string`);
      }
      if (agent.tools !== undefined) {
        checkStringArray(agent.tools, `document.agents[${i}].tools`, errors);
      }
    });
  }

  // ── skills ──────────────────────────────────────────────────
  const skillNames = collectNames(doc.skills, "document.skills", errors);
  if (doc.skills !== undefined && Array.isArray(doc.skills)) {
    doc.skills.forEach((skill, i) => {
      if (!isPlainObject(skill)) return;
      checkUnknownKeys(skill, SKILL_KEYS, `document.skills[${i}]`, errors);
      checkNonEmptyString(skill.name, `document.skills[${i}].name`, errors);
      checkKebabCase(skill.name, `document.skills[${i}].name`, errors);
      if (skill.description !== undefined && !isNonEmptyString(skill.description)) {
        errors.push(`document.skills[${i}].description must be a non-empty string`);
      }
      if (skill.body !== undefined && !isNonEmptyString(skill.body)) {
        errors.push(`document.skills[${i}].body must be a non-empty string`);
      }
    });
  }

  // ── integrations ────────────────────────────────────────────
  const mcpNames = new Set();
  if (doc.integrations !== undefined) {
    if (!isPlainObject(doc.integrations)) {
      errors.push("document.integrations must be an object");
    } else {
      checkUnknownKeys(doc.integrations, INTEGRATIONS_KEYS, "document.integrations", errors);

      if (doc.integrations.mcp !== undefined) {
        if (!Array.isArray(doc.integrations.mcp)) {
          errors.push("document.integrations.mcp must be an array");
        } else {
          doc.integrations.mcp.forEach((mcp, i) => {
            if (!isPlainObject(mcp)) {
              errors.push(`document.integrations.mcp[${i}] must be an object`);
              return;
            }
            checkUnknownKeys(mcp, MCP_KEYS, `document.integrations.mcp[${i}]`, errors);
            checkNonEmptyString(mcp.name, `document.integrations.mcp[${i}].name`, errors);
            checkKebabCase(mcp.name, `document.integrations.mcp[${i}].name`, errors);
            if (isNonEmptyString(mcp.name)) {
              if (mcpNames.has(mcp.name)) {
                errors.push(`document.integrations.mcp[${i}] duplicates name "${mcp.name}"`);
              }
              mcpNames.add(mcp.name);
            }
            if (!isPlainObject(mcp.config) || Object.keys(mcp.config).length === 0) {
              errors.push(
                `document.integrations.mcp[${i}].config must be a non-empty object ` +
                  "(url, or command + args)",
              );
            }
          });
        }
      }

      if (doc.integrations.env !== undefined) {
        if (!Array.isArray(doc.integrations.env)) {
          errors.push("document.integrations.env must be an array");
        } else {
          doc.integrations.env.forEach((env, i) => {
            if (!isPlainObject(env)) {
              errors.push(`document.integrations.env[${i}] must be an object`);
              return;
            }
            checkUnknownKeys(env, ENV_KEYS, `document.integrations.env[${i}]`, errors);
            checkNonEmptyString(env.name, `document.integrations.env[${i}].name`, errors);
            if (env.secret !== undefined && typeof env.secret !== "boolean") {
              errors.push(`document.integrations.env[${i}].secret must be a boolean`);
            }
          });
        }
      }
    }
  }

  // ── workflows ───────────────────────────────────────────────
  const workflowNames = collectNames(doc.workflows, "document.workflows", errors);
  if (doc.workflows !== undefined && Array.isArray(doc.workflows)) {
    doc.workflows.forEach((wf, i) => {
      if (!isPlainObject(wf)) return;
      checkUnknownKeys(wf, WORKFLOW_KEYS, `document.workflows[${i}]`, errors);
      checkNonEmptyString(wf.name, `document.workflows[${i}].name`, errors);
      checkKebabCase(wf.name, `document.workflows[${i}].name`, errors);
      if (wf.description !== undefined && !isNonEmptyString(wf.description)) {
        errors.push(`document.workflows[${i}].description must be a non-empty string`);
      }
      if (wf.skill !== undefined) checkNonEmptyString(wf.skill, `document.workflows[${i}].skill`, errors);
      if (wf.entry !== undefined) checkNonEmptyString(wf.entry, `document.workflows[${i}].entry`, errors);
      if (wf.approval !== undefined) checkNonEmptyString(wf.approval, `document.workflows[${i}].approval`, errors);
      if (wf.verify !== undefined) checkNonEmptyString(wf.verify, `document.workflows[${i}].verify`, errors);
      if (wf.agents !== undefined) checkStringArray(wf.agents, `document.workflows[${i}].agents`, errors);
      if (wf.inputs !== undefined) checkStringArray(wf.inputs, `document.workflows[${i}].inputs`, errors);
      if (wf.outputs !== undefined) checkStringArray(wf.outputs, `document.workflows[${i}].outputs`, errors);

      if (wf.trigger !== undefined) {
        if (!isPlainObject(wf.trigger)) {
          errors.push(`document.workflows[${i}].trigger must be an object`);
        } else {
          checkUnknownKeys(wf.trigger, TRIGGER_KEYS, `document.workflows[${i}].trigger`, errors);
          if (
            wf.trigger.kind !== undefined &&
            !["manual", "headless"].includes(wf.trigger.kind)
          ) {
            errors.push(
              `document.workflows[${i}].trigger.kind must be "manual" or "headless" ` +
                `(got "${wf.trigger.kind}")`,
            );
          }
        }
      }

      // A workflow must name at least the orchestrating skill or an entry agent.
      if (!isNonEmptyString(wf.skill) && !isNonEmptyString(wf.entry)) {
        errors.push(
          `document.workflows[${i}] must declare at least one of "skill" or "entry"`,
        );
      }
    });
  }

  // ── policies ────────────────────────────────────────────────
  if (doc.policies !== undefined) {
    if (!isPlainObject(doc.policies)) {
      errors.push("document.policies must be an object");
    } else {
      checkUnknownKeys(doc.policies, POLICIES_KEYS, "document.policies", errors);

      if (doc.policies.enforced !== undefined) {
        if (!Array.isArray(doc.policies.enforced)) {
          errors.push("document.policies.enforced must be an array");
        } else {
          doc.policies.enforced.forEach((rule, i) => {
            const path = `document.policies.enforced[${i}]`;
            if (!isPlainObject(rule)) {
              errors.push(`${path} must be an object`);
              return;
            }
            checkUnknownKeys(rule, ENFORCED_KEYS, path, errors);

            const hasAgent = isNonEmptyString(rule.agent);
            const hasMcp = isNonEmptyString(rule.mcp);
            if (hasAgent === hasMcp) {
              errors.push(
                `${path} must have exactly one of "agent" or "mcp"`,
              );
            }
            if (rule.agent !== undefined) {
              checkNonEmptyString(rule.agent, `${path}.agent`, errors);
              checkStringArray(rule.tools, `${path}.tools`, errors);
            }
            if (rule.mcp !== undefined) {
              checkNonEmptyString(rule.mcp, `${path}.mcp`, errors);
              checkStringArray(rule.hide, `${path}.hide`, errors);
            }
          });
        }
      }

      if (doc.policies.advisory !== undefined) {
        checkStringArray(doc.policies.advisory, "document.policies.advisory", errors);
      }
    }
  }

  // ── References ──────────────────────────────────────────────
  const declaredTiers = [...tierNames].sort().join(", ");
  const tierErr = (ref, path) =>
    `${path} references tier "${ref}" which is not declared` +
    (declaredTiers ? ` (declared: ${declaredTiers})` : " (no tiers declared)");

  if (isPlainObject(doc.models)) {
    if (isNonEmptyString(doc.models.parentTier) && !tierNames.has(doc.models.parentTier)) {
      errors.push(tierErr(doc.models.parentTier, "document.models.parentTier"));
    }
    if (isPlainObject(doc.models.subagents)) {
      for (const [agent, tierName] of Object.entries(doc.models.subagents)) {
        if (isNonEmptyString(tierName) && !tierNames.has(tierName)) {
          errors.push(tierErr(tierName, `document.models.subagents.${agent}`));
        }
      }
    }
  }

  if (isPlainObject(doc.orchestrator) && isNonEmptyString(doc.orchestrator.model)) {
    if (!tierNames.has(doc.orchestrator.model)) {
      errors.push(tierErr(doc.orchestrator.model, "document.orchestrator.model"));
    }
  }

  if (doc.agents !== undefined && Array.isArray(doc.agents)) {
    doc.agents.forEach((agent, i) => {
      if (isPlainObject(agent) && isNonEmptyString(agent.model) && !tierNames.has(agent.model)) {
        errors.push(tierErr(agent.model, `document.agents[${i}].model`));
      }
    });
  }

  const agentOrOrchestrator = (name, path) => {
    if (name !== orchestratorName && !agentNames.has(name)) {
      const available = [orchestratorName, ...agentNames].filter(Boolean).sort();
      errors.push(
        `${path} references "${name}" which is neither the orchestrator` +
          (available.length ? ` (${available.join(", ")})` : " (no agents declared)") +
          " nor a declared agent",
      );
    }
  };

  if (doc.workflows !== undefined && Array.isArray(doc.workflows)) {
    doc.workflows.forEach((wf, i) => {
      if (!isPlainObject(wf)) return;
      if (isNonEmptyString(wf.skill) && !skillNames.has(wf.skill)) {
        const available = [...skillNames].sort().join(", ");
        errors.push(
          `document.workflows[${i}].skill references "${wf.skill}" which is not a ` +
            (available ? `declared skill (declared: ${available})` : "declared skill (no skills declared)"),
        );
      }
      if (isNonEmptyString(wf.entry)) {
        agentOrOrchestrator(wf.entry, `document.workflows[${i}].entry`);
      }
      if (Array.isArray(wf.agents)) {
        wf.agents.forEach((name, j) => {
          if (typeof name === "string") {
            agentOrOrchestrator(name, `document.workflows[${i}].agents[${j}]`);
          }
        });
      }
    });
  }

  if (
    doc.policies !== undefined && isPlainObject(doc.policies) &&
    Array.isArray(doc.policies.enforced)
  ) {
    doc.policies.enforced.forEach((rule, i) => {
      if (!isPlainObject(rule)) return;
      if (isNonEmptyString(rule.agent) && !agentNames.has(rule.agent)) {
        const available = [...agentNames].sort().join(", ");
        errors.push(
          `document.policies.enforced[${i}].agent references "${rule.agent}" which ` +
            (available ? `is not a declared agent (declared: ${available})` : "is not a declared agent (no agents declared)"),
        );
      }
      if (isNonEmptyString(rule.mcp) && !mcpNames.has(rule.mcp)) {
        const available = [...mcpNames].sort().join(", ");
        errors.push(
          `document.policies.enforced[${i}].mcp references "${rule.mcp}" which ` +
            (available ? `is not a declared MCP server (declared: ${available})` : "is not a declared MCP server (no servers declared)"),
        );
      }
    });
  }

  return { ok: errors.length === 0, errors };
}
