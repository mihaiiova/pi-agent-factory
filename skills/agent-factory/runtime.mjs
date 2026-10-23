/**
 * runtime — the hermetic runtime launcher plan for a generated system.
 *
 * Pure seam: `buildRuntimePlan(model, opts) -> { agentDir, packages,
 * launcherScript, warnings }`. A generated system runs with its own Pi config
 * directory (set via `PI_CODING_AGENT_DIR`) so it never inherits the host's
 * global skills, MCP servers, extensions, instructions, settings, or
 * credentials. No filesystem or CLI work happens here; `generate.mjs` composes
 * the launcher content into the generated `run` file.
 */
import { runtimePackages } from "./deps.mjs";

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
    "# context (`pi --login`), or export PI_API_KEY / a provider-specific key.",
    'exec pi "$@"',
    "",
  ].join("\n");
}

/**
 * @param {object} model the migrated, validated `system.yaml` document.
 * @param {object} [opts] `{ piPackages?: string[] }` — pi-config's `pi.packages`.
 * @returns {{ agentDir: string, packages: string[], launcherScript: string, warnings: string[] }}
 */
export function buildRuntimePlan(model, opts = {}) {
  const piPackages = opts?.piPackages;
  const declared = model?.packages;

  return {
    agentDir: AGENT_DIR,
    packages: runtimePackages(piPackages, declared),
    launcherScript: launcherScript(),
    warnings: [
      "credentials are not inherited from the host; run `pi --login` once in the isolated context or export PI_API_KEY / a provider key",
      "AGENTS.md/CLAUDE.md context files in parent directories are not suppressed by agent-dir isolation; keep generated projects out of a host tree that carries them",
    ],
  };
}
