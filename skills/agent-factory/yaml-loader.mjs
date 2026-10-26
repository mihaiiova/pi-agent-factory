/**
 * yaml-loader — resolve the pinned `yaml` package from Pi's package install dir.
 *
 * pi-config is a Pi *package*, not an application: its npm dependencies live in
 * the Pi package install dir (`~/.pi/agent/npm/node_modules`), not in the
 * pi-config clone. `loadYaml` resolves `yaml` from there via `createRequire`
 * (the same `~/.pi/agent/` convention `extensions/pi-sync` already uses for
 * `~/.pi/agent/settings.json`), with an actionable error when it is absent.
 */
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from 'node:url';
import { homedir } from "node:os";

/** Directory where Pi installs its pinned npm packages. */
export const PI_NPM_DIR = resolve(homedir(), ".pi", "agent", "npm");

/**
 * Load the `yaml` package from Pi's package install dir.
 *
 * @returns {typeof import("yaml")} the yaml module (has `parse`, `stringify`, …)
 * @throws {Error} with an actionable message when yaml is not installed.
 */
export function loadYaml() {
  // Standalone maintenance bundles resolve only their own pinned dependency.
  // Never fall back to the host's Pi directory from inside a bundle.
  const local = createRequire(import.meta.url);
  if (import.meta.url.includes('/.factory/runtime/')) {
    const bundled = resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/yaml');
    try { return local(bundled); }
    catch { throw new Error('Bundled yaml dependency is missing; restore maintenance installation'); }
  }
  try { return local("yaml"); } catch { /* main pi-config installation */ }
  const require = createRequire(resolve(PI_NPM_DIR, "package.json"));
  try {
    return require("yaml");
  } catch {
    throw new Error(
      "The `yaml` package (pinned as npm:yaml@2.8.3) is not installed in Pi's " +
        `package directory (${PI_NPM_DIR}). Run /pi-sync (or pi install) to ` +
        "install the pinned packages, then retry.",
    );
  }
}
