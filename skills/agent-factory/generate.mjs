/**
 * generate — materialize a `system.yaml` model into a single-agent Pi project.
 *
 * Pure seam: `generateProject(model, existingFiles) -> { files[] }` where each
 * file is `{ path, content, action }` and `action` is one of
 * `create | write | conflict | none`. `existingFiles` maps a project-relative
 * path to its current text content. No filesystem or CLI work happens here —
 * the CLI reads disk, calls this, and applies the result.
 *
 * Ownership (see schema.md §4 / docs §C.6):
 *   - Derived files (`.pi/settings.json`, `.pi/mcp.json`) regenerate every run,
 *     merge-preserving unknown keys.
 *   - Authored files (`.pi/APPEND_SYSTEM.md`, `README.md`, `.gitignore`,
 *     `.env.example`) scaffold once and are fingerprint-protected with a
 *     header marker; a user edit is never silently overwritten.
 */
import { createHash } from "node:crypto";
import { generateSettings } from "../../extensions/pi-config/generate-settings.mjs";
import { workflowSkill } from "./workflowSkill.mjs";

const MARKER = "agent-factory:generated v1";
const MARKER_HTML_RE = /^<!-- agent-factory:generated v1 sha256=([0-9a-f]{64}) -->$/;
const MARKER_PLAIN_RE = /^# agent-factory:generated v1 sha256=([0-9a-f]{64})$/;
const MARKER_HTML_TRAILING_RE = /\n<!-- agent-factory:generated v1 sha256=([0-9a-f]{64}) -->[ \t]*\n?$/;

const GITIGNORE_BODY = [
  "data/*",
  "!data/knowledge/",
  "data/knowledge/*",
  "!data/knowledge/.gitkeep",
  ".env",
  ".pi/state.json",
  ".pi/sessions/",
  "",
].join("\n");

/** Project-relative paths the single-agent generator materializes. */
export const GENERATED_PATHS = [
  ".pi/settings.json",
  ".pi/mcp.json",
  ".pi/APPEND_SYSTEM.md",
  "README.md",
  ".gitignore",
  ".env.example",
  "data/knowledge/.gitkeep",
];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function yamlString(value) {
  const s = String(value);
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function markerLineText(style, hash) {
  return style === "plain" ? `# ${MARKER} sha256=${hash}` : `<!-- ${MARKER} sha256=${hash} -->`;
}

function markedContent(style, body) {
  const line = markerLineText(style, sha256(body));
  if (style === "trailing-html") return `${body}\n${line}\n`;
  return `${line}\n${body}`;
}

/** Split a marked file into `{ hash, body }`, or null when no marker is present. */
function parseMarked(content, style) {
  if (typeof content !== "string") return null;
  if (style === "trailing-html") {
    const match = content.match(MARKER_HTML_TRAILING_RE);
    if (!match) return null;
    return { hash: match[1], body: content.slice(0, match.index) };
  }
  const nl = content.indexOf("\n");
  const firstLine = nl === -1 ? content : content.slice(0, nl);
  const body = nl === -1 ? "" : content.slice(nl + 1);
  const match = firstLine.match(style === "html" ? MARKER_HTML_RE : MARKER_PLAIN_RE);
  if (!match) return null;
  return { hash: match[1], body };
}

function derivedFile(path, desiredContent, existing) {
  if (existing === undefined) return { path, content: desiredContent, action: "create" };
  if (existing === desiredContent) return { path, content: existing, action: "none" };
  return { path, content: desiredContent, action: "write" };
}

function authoredFile(path, style, desiredBody, existing) {
  if (existing === undefined) {
    return { path, content: markedContent(style, desiredBody), action: "create" };
  }

  const parsed = parseMarked(existing, style);
  if (parsed === null) {
    // No factory marker: the user authored this file by hand. Never touch it.
    return { path, content: existing, action: "none" };
  }

  const { hash: recordedHash, body: currentBody } = parsed;
  const currentHash = sha256(currentBody);
  const desiredHash = sha256(desiredBody);

  if (currentHash === recordedHash) {
    // Factory-owned and unedited.
    if (desiredBody === currentBody) {
      return { path, content: existing, action: "none" };
    }
    return { path, content: markedContent(style, desiredBody), action: "write" };
  }

  // The user edited a factory scaffold (hash no longer matches the marker).
  if (desiredBody === currentBody) {
    // Their edit already equals what the model wants; refresh the marker.
    return { path, content: markedContent(style, desiredBody), action: "write" };
  }
  if (desiredHash === recordedHash) {
    // The model did not change since the factory last wrote: authored wins.
    return { path, content: existing, action: "none" };
  }

  // Both the user edited AND the model changed: report, never overwrite.
  return { path, content: existing, desired: desiredBody, action: "conflict" };
}

function sentinelFile(path, existing) {
  if (existing === undefined) return { path, content: "", action: "create" };
  return { path, content: existing, action: "none" };
}

function buildSettings(model, existingText) {
  const models = isPlainObject(model.models) ? model.models : {};
  const orchestrator = isPlainObject(model.orchestrator) ? model.orchestrator : {};

  // The orchestrator's declared tier is authoritative for the primary session;
  // fall back to the models block's parentTier when it is absent.
  const parentTier =
    typeof orchestrator.model === "string" && orchestrator.model
      ? orchestrator.model
      : models.parentTier;

  let existing = {};
  if (typeof existingText === "string") {
    try {
      existing = JSON.parse(existingText);
    } catch {
      existing = {};
    }
  }
  if (!isPlainObject(existing)) existing = {};

  const out = generateSettings(
    { tiers: models.tiers, parentTier, subagentTiers: models.subagents },
    existing,
  );

  const tools = Array.isArray(orchestrator.tools) && orchestrator.tools.length > 0
    ? orchestrator.tools
    : undefined;
  if (tools !== undefined) out.defaultTools = tools;
  else delete out.defaultTools;

  return `${JSON.stringify(out, null, 2)}\n`;
}

function buildMcpJson(existingText) {
  let existing = {};
  if (typeof existingText === "string") {
    try {
      existing = JSON.parse(existingText);
    } catch {
      existing = {};
    }
  }
  if (!isPlainObject(existing)) existing = {};

  const out = { ...existing };
  if (!isPlainObject(out.mcpServers)) out.mcpServers = {};
  return `${JSON.stringify(out, null, 2)}\n`;
}

function readmeBody(model) {
  const name = typeof model.name === "string" ? model.name : "";
  const description = typeof model.description === "string" ? model.description : "";
  return [
    `# ${name}`,
    "",
    description,
    "",
    "## Run",
    "",
    "```sh",
    "cd <project-dir> && pi",
    "```",
    "",
  ].join("\n");
}

function envBody(model) {
  const env = isPlainObject(model.integrations) && Array.isArray(model.integrations.env)
    ? model.integrations.env
    : [];
  if (env.length === 0) return "";
  return env
    .filter((entry) => isPlainObject(entry) && typeof entry.name === "string")
    .map((entry) => `${entry.name}=`)
    .join("\n") + "\n";
}

function agentBody(agent, tiers) {
  const tier = isPlainObject(tiers[agent.model]) ? tiers[agent.model] : {};
  const lines = ["---"];
  lines.push(`name: ${agent.name}`);
  if (isNonEmptyString(agent.description)) lines.push(`description: ${yamlString(agent.description)}`);
  if (Array.isArray(agent.tools) && agent.tools.length > 0) {
    lines.push(`tools: [${agent.tools.join(", ")}]`);
  }
  if (isNonEmptyString(tier.model)) lines.push(`model: ${tier.model}`);
  if (isNonEmptyString(tier.thinking)) lines.push(`thinking: ${tier.thinking}`);
  const prompt = isNonEmptyString(agent.prompt) ? agent.prompt : "";
  if (prompt) {
    lines.push("systemPrompt: |");
    for (const line of prompt.replace(/\n$/, "").split("\n")) lines.push(`  ${line}`);
  } else {
    lines.push('systemPrompt: ""');
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

function skillFileBody(skill, workflowBySkill) {
  const lines = ["---"];
  lines.push(`name: ${skill.name}`);
  if (isNonEmptyString(skill.description)) lines.push(`description: ${yamlString(skill.description)}`);
  lines.push("---");

  let body = "";
  if (isNonEmptyString(skill.body)) {
    body = skill.body;
  } else {
    const wf = workflowBySkill.get(skill.name);
    if (wf) body = workflowSkill(wf).body;
  }
  return lines.join("\n") + "\n\n" + body;
}

function agentFiles(model, existing) {
  const agents = Array.isArray(model.agents) ? model.agents : [];
  const tiers = isPlainObject(model.models) && isPlainObject(model.models.tiers)
    ? model.models.tiers
    : {};
  return agents
    .filter((agent) => isPlainObject(agent) && isNonEmptyString(agent.name))
    .map((agent) => {
      const path = `.pi/agents/${agent.name}.md`;
      return authoredFile(path, "trailing-html", agentBody(agent, tiers), existing[path]);
    });
}

function skillFiles(model, existing) {
  const skills = Array.isArray(model.skills) ? model.skills : [];
  const workflows = Array.isArray(model.workflows) ? model.workflows : [];
  const workflowBySkill = new Map();
  for (const wf of workflows) {
    if (isPlainObject(wf) && isNonEmptyString(wf.skill)) workflowBySkill.set(wf.skill, wf);
  }
  return skills
    .filter((skill) => isPlainObject(skill) && isNonEmptyString(skill.name))
    .map((skill) => {
      const path = `.pi/skills/${skill.name}/SKILL.md`;
      return authoredFile(path, "trailing-html", skillFileBody(skill, workflowBySkill), existing[path]);
    });
}

/** Every project-relative path `generate` may write for a given model. */
export function managedPaths(model) {
  const paths = [...GENERATED_PATHS];
  for (const agent of Array.isArray(model.agents) ? model.agents : []) {
    if (isPlainObject(agent) && isNonEmptyString(agent.name)) paths.push(`.pi/agents/${agent.name}.md`);
  }
  for (const skill of Array.isArray(model.skills) ? model.skills : []) {
    if (isPlainObject(skill) && isNonEmptyString(skill.name)) paths.push(`.pi/skills/${skill.name}/SKILL.md`);
  }
  return paths;
}

/**
 * Compute the planned file writes for a validated model against the current
 * project files on disk.
 *
 * @param {object} model the migrated, validated `system.yaml` document.
 * @param {Record<string, string>} [existingFiles] project-relative path → text.
 * @returns {{ files: Array<{ path: string, content: string, action: string, desired?: string }> }}
 */
export function generateProject(model, existingFiles = {}) {
  const existing = isPlainObject(existingFiles) ? existingFiles : {};
  const prompt = isPlainObject(model.orchestrator) && typeof model.orchestrator.prompt === "string"
    ? model.orchestrator.prompt
    : "";

  const files = [
    derivedFile(".pi/settings.json", buildSettings(model, existing[".pi/settings.json"]), existing[".pi/settings.json"]),
    derivedFile(".pi/mcp.json", buildMcpJson(existing[".pi/mcp.json"]), existing[".pi/mcp.json"]),
    authoredFile(".pi/APPEND_SYSTEM.md", "html", prompt, existing[".pi/APPEND_SYSTEM.md"]),
    authoredFile("README.md", "html", readmeBody(model), existing["README.md"]),
    authoredFile(".gitignore", "plain", GITIGNORE_BODY, existing[".gitignore"]),
    authoredFile(".env.example", "plain", envBody(model), existing[".env.example"]),
    sentinelFile("data/knowledge/.gitkeep", existing["data/knowledge/.gitkeep"]),
    ...agentFiles(model, existing),
    ...skillFiles(model, existing),
  ];

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}
