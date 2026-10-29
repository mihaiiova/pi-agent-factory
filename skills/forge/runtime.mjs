/**
 * runtime — the hermetic runtime launcher plan for a generated system.
 *
 * Pure seam: `buildRuntimePlan(model, opts) -> { agentDir, packages,
 * launcherScript, warnings, errors }`. A generated system runs with its own Pi config
 * directory (set via `PI_CODING_AGENT_DIR`) so it never inherits the host's
 * global Pi skills, MCP servers, extensions, instructions, settings, or
 * credentials. Pi still reads the shared Agent Skills folders
 * (`~/.agents/skills/`, project `.agents/skills/`) by design. No filesystem or CLI work happens here; `generate.mjs` composes
 * the launcher content into the generated `run` file.
 */
import { runtimePackages } from "./deps.mjs";
import { declaredPackages } from "./skill-sources.mjs";

/** Project-relative isolated Pi config directory. */
export const AGENT_DIR = ".forge/pi-home";

/**
 * Load only the declared `integrations.env` names from the gitignored `.env`.
 * Lines are parsed, never sourced, so `.env` cannot run commands; variables
 * already set in the caller's environment take precedence.
 */
function envLoader(names) {
  if (!names.length) return [];
  return [
    "# Declared integration variables (integrations.env) from the gitignored .env.",
    "# Lines are parsed, never executed; values already exported take precedence.",
    `FORGE_ENV_NAMES=" ${names.join(" ")} "`,
    "forge_dq='^\"(.*)\"$'",
    "forge_sq=\"^'(.*)'\\$\"",
    'if [[ -f .env ]]; then',
    '  while IFS= read -r forge_line || [[ -n "$forge_line" ]]; do',
    "    forge_line=\"${forge_line%$'\\r'}\"",
    '    [[ "$forge_line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue',
    '    forge_name="${BASH_REMATCH[2]}"',
    '    forge_value="${BASH_REMATCH[3]}"',
    '    [[ "$FORGE_ENV_NAMES" == *" $forge_name "* ]] || continue',
    '    [[ -z "${!forge_name+x}" ]] || continue',
    '    if [[ "$forge_value" =~ $forge_dq || "$forge_value" =~ $forge_sq ]]; then forge_value="${BASH_REMATCH[1]}"; fi',
    '    export "$forge_name=$forge_value"',
    '  done < .env',
    'fi',
    'unset FORGE_ENV_NAMES forge_dq forge_sq forge_line forge_name forge_value',
    "",
  ];
}

/** Declared env names, in declaration order. */
export function envNames(model) {
  const env = model?.integrations?.env;
  return Array.isArray(env) ? [...new Set(env.map(e => e?.name).filter(n => typeof n === "string"))] : [];
}

/** The generated `run` launcher script content. */
/** The lead's prompt files: the authored instructions, then the generated
 * "What you can use" section. Passing them explicitly (which replaces Pi's
 * APPEND_SYSTEM.md discovery) puts build output in the prompt, not runtime code. */
const PROMPT_FILES = [
  "# The orchestrator's prompt: authored instructions, then what it can use.",
  "prompts=()",
  "for f in .pi/APPEND_SYSTEM.md .pi/CAPABILITIES.md; do",
  '  if [[ -f "$f" ]]; then prompts+=(--append-system-prompt "$f"); fi',
  "done",
];
const LAUNCH = 'pi --approve --no-context-files ${prompts[@]+"${prompts[@]}"} "$@"';
export function launcherScript(names = [], workflows = [], lead = '') {
  const manifest = Buffer.from(JSON.stringify(workflows.map(w => ({ ...w, lead })))).toString('base64');
  return [
    "#!/usr/bin/env bash",
    "# Hermetic runtime launcher for a generated Pi agent system.",
    "# Resolves the project root from this script's own location, then cd's into",
    "# it so project .pi/ resources are discovered regardless of the caller's",
    "# working directory. Gives the system its own Pi config dir so the host's",
    "# global skills/MCP/extensions/instructions/credentials never leak in.",
    "set -euo pipefail",
    "",
    'ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    "",
    'if ! command -v pi >/dev/null 2>&1; then',
    '  echo "run: pi is not installed or not on PATH" >&2',
    "  exit 1",
    "fi",
    "",
    'cd "$ROOT"',
    "",
    'if [[ ! -f ".pi/system.yaml" ]]; then',
    '  echo "run: .pi/system.yaml not found in $ROOT" >&2',
    "  exit 1",
    "fi",
    "",
    'export PI_CODING_AGENT_DIR="$ROOT/.forge/pi-home"',
    'mkdir -p "$PI_CODING_AGENT_DIR"',
    "",
    ...envLoader(names),
    "# Credentials are NOT inherited from the host. Log in once for this isolated",
    "# context (`./run`, then `/login`), or export PI_API_KEY / a provider-specific key.",
    // Pi's agent-dir does not suppress ancestor instruction discovery.
    // APPEND_SYSTEM.md still supplies the project's operational instructions.
    ...PROMPT_FILES,
    'if [[ "${1:-}" == "--workflow" ]]; then',
    `  exec node "$ROOT/.pi/forge-workflow.mjs" '${manifest}' "\${prompts[@]}" -- "$@"`,
    'fi',
    `exec ${LAUNCH}`,
    "",
  ].join("\n");
}

/**
 * @param {object} model the validated `system.yaml` document.
 * @param {object} [opts] `{ piPackages?: string[] }` — the forge's `pi.packages`.
 * @returns {{ agentDir: string, packages: string[], launcherScript: string, warnings: string[], errors: string[] }}
 */
export function buildRuntimePlan(model, opts = {}) {
  const piPackages = opts?.piPackages;
  const declared = declaredPackages(model);
  const { packages, errors } = runtimePackages(piPackages, declared);

  return {
    agentDir: AGENT_DIR,
    packages,
    launcherScript: launcherScript(envNames(model), model.workflows ?? [], model.orchestrator?.name ?? ''),
    warnings: [
      "credentials are not inherited from the host; start ./run and use /login, or export PI_API_KEY / a provider key",
      "the launcher disables AGENTS.md/CLAUDE.md discovery with --no-context-files; declare project instructions in system.yaml / APPEND_SYSTEM.md. Inherited subagent project context is an explicit opt-in.",
    ],
    errors,
  };
}
