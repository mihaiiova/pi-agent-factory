/**
 * runtime — the hermetic runtime launcher plan for a generated system.
 *
 * Pure seam: `buildRuntimePlan(model, opts) -> { agentDir, packages,
 * launcherScript, warnings, errors }`. A generated system runs with its own Pi config
 * directory (set via `PI_CODING_AGENT_DIR`) so it never inherits the host's
 * global skills, MCP servers, extensions, instructions, settings, or
 * credentials. No filesystem or CLI work happens here; `generate.mjs` composes
 * the launcher content into the generated `run` file.
 */
import { runtimePackages } from "./deps.mjs";
import { declaredPackages } from "./skill-sources.mjs";

/** Project-relative isolated Pi config directory. */
export const AGENT_DIR = ".factory/pi-home";

/** The generated `run` launcher script content. */
export function launcherScript() {
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
    'export PI_CODING_AGENT_DIR="$ROOT/.factory/pi-home"',
    'mkdir -p "$PI_CODING_AGENT_DIR"',
    "",
    "# Credentials are NOT inherited from the host. Log in once for this isolated",
    "# context (`./run`, then `/login`), or export PI_API_KEY / a provider-specific key.",
    // Pi's agent-dir does not suppress ancestor instruction discovery.
    // APPEND_SYSTEM.md still supplies the project's operational instructions.
    'exec pi --no-context-files "$@"',
    "",
  ].join("\n");
}

/**
 * @param {object} model the validated `system.yaml` document.
 * @param {object} [opts] `{ piPackages?: string[] }` — the factory's `pi.packages`.
 * @returns {{ agentDir: string, packages: string[], launcherScript: string, warnings: string[], errors: string[] }}
 */
export function buildRuntimePlan(model, opts = {}) {
  const piPackages = opts?.piPackages;
  const declared = declaredPackages(model);
  const { packages, errors } = runtimePackages(piPackages, declared);

  return {
    agentDir: AGENT_DIR,
    packages,
    launcherScript: launcherScript(),
    warnings: [
      "credentials are not inherited from the host; start ./run and use /login, or export PI_API_KEY / a provider key",
      "the launcher disables AGENTS.md/CLAUDE.md discovery with --no-context-files; declare project instructions in system.yaml / APPEND_SYSTEM.md. Inherited subagent project context is an explicit opt-in.",
    ],
    errors,
  };
}
