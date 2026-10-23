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
import { buildModelSettings } from "../../extensions/pi-config/generate-settings.mjs";

const MARKER = "agent-factory:generated v1";
const MARKER_HTML_RE = /^<!-- agent-factory:generated v1 sha256=([0-9a-f]{64}) -->$/;
const MARKER_PLAIN_RE = /^# agent-factory:generated v1 sha256=([0-9a-f]{64})$/;

const GITIGNORE_BODY = "data/\n.env\n.pi/state.json\n.pi/sessions/\n";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function markerLine(style, body) {
  const hash = sha256(body);
  return style === "html"
    ? `<!-- ${MARKER} sha256=${hash} -->`
    : `# ${MARKER} sha256=${hash}`;
}

function markedContent(style, body) {
  return `${markerLine(style, body)}\n${body}`;
}

/** Split a marked file into `{ hash, body }`, or null when no marker is present. */
function parseMarked(content, style) {
  if (typeof content !== "string") return null;
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

  const modelSettings = buildModelSettings({
    tiers: models.tiers,
    parentTier: models.parentTier,
    subagentTiers: models.subagents,
  });

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

  for (const key of ["defaultProvider", "defaultModel", "defaultThinkingLevel"]) {
    if (modelSettings[key] !== undefined) out[key] = modelSettings[key];
    else delete out[key];
  }

  if (modelSettings.subagents !== undefined) {
    out.subagents = {
      ...(isPlainObject(out.subagents) ? out.subagents : {}),
      agentOverrides: modelSettings.subagents.agentOverrides,
    };
  } else if (isPlainObject(out.subagents) && "agentOverrides" in out.subagents) {
    const rest = { ...out.subagents };
    delete rest.agentOverrides;
    if (Object.keys(rest).length > 0) out.subagents = rest;
    else delete out.subagents;
  }

  const tools = Array.isArray(orchestrator.tools) && orchestrator.tools.length > 0
    ? orchestrator.tools
    : undefined;
  if (tools !== undefined) out.defaultTools = tools;
  else delete out.defaultTools;

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
    derivedFile(".pi/mcp.json", `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, existing[".pi/mcp.json"]),
    authoredFile(".pi/APPEND_SYSTEM.md", "html", prompt, existing[".pi/APPEND_SYSTEM.md"]),
    authoredFile("README.md", "html", readmeBody(model), existing["README.md"]),
    authoredFile(".gitignore", "plain", GITIGNORE_BODY, existing[".gitignore"]),
    authoredFile(".env.example", "plain", envBody(model), existing[".env.example"]),
    sentinelFile("data/knowledge/.gitkeep", existing["data/knowledge/.gitkeep"]),
  ];

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}
