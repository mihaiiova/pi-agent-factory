/**
 * deps — compute the declared runtime `packages` for a generated project.
 *
 * Pure seam: `runtimePackages(piPackages, declared) -> string[]`.
 *
 * A generated system is self-contained by declaration, not by wholesale
 * package inheritance. The runtime keeps only the two Pi runtime primitives it
 * needs — `pi-subagents` (subagent support) and `pi-mcp-adapter` (MCP support)
 * — plus whatever the model explicitly declares. The factory's own dev-only
 * packages (web access, the YAML parser, question helpers) and any git pin are
 * never emitted; local-path and secret-shaped entries are rejected.
 */

import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
/** The Factory package source; generated projects pin it to a release tag. */
export const FACTORY_SOURCE = 'git:github.com/mihaiiova/pi-agent-factory';
const FACTORY_PACKAGE = `${FACTORY_SOURCE}@v${VERSION}`;
const LOCAL_PATH_RE = /^(file:|link:|\/|\.\.?\/)/;
const RUNTIME_PRIMITIVES = ["pi-subagents", "pi-mcp-adapter"];

function isString(value) {
  return typeof value === "string";
}

/** Parse `npm:name@version` into `{ name, version }` (scoped-name aware). */
function parseNpmSpec(entry) {
  if (!isString(entry) || !entry.startsWith("npm:")) return null;
  const rest = entry.slice(4);
  const at = rest.lastIndexOf("@");
  if (at <= 0) return null;
  const name = rest.slice(0, at);
  const version = rest.slice(at + 1);
  if (!name || !version) return null;
  return { name, version };
}

/** A declared package must be an `npm:`/`git:` spec, pinned, never a local path. */
function declaredSpecError(spec) {
  if (!isString(spec) || spec === "") return "declared package must be a non-empty string";
  if (LOCAL_PATH_RE.test(spec)) {
    return `declared package "${spec}" must not be a local path (file:/link:/abs/./../)`;
  }
  if (spec.startsWith("npm:")) {
    const parsed = parseNpmSpec(spec);
    if (!parsed || !parsed.version) {
      return `declared package "${spec}" must be a pinned npm:<name>@<version>`;
    }
    return null;
  }
  if (spec.startsWith("git:")) {
    const rest = spec.slice(4);
    const at = rest.lastIndexOf("@");
    if (at <= 0 || at === rest.length - 1) {
      return `declared package "${spec}" must be a pinned git:<repo>@<ref>`;
    }
    return null;
  }
  return `declared package "${spec}" must be an npm: or git: spec`;
}

/**
 * @param {string[]} [piPackages] the factory's own `pi.packages` (`npm:<name>@<version>`).
 * @param {string[]} [declared] the model's declared `packages` (npm:/git: specs).
 * @returns {{ packages: string[], errors: string[] }} primitives first, then declared;
 *   `errors` is non-empty when a required primitive is missing/unpinned or a
 *   declared spec is invalid/conflicting (never silently incomplete).
 */
export function runtimePackages(piPackages, declared = []) {
  const errors = [];
  const pins = [FACTORY_PACKAGE];

  const byName = new Map();
  for (const entry of Array.isArray(piPackages) ? piPackages : []) {
    const parsed = parseNpmSpec(entry);
    if (parsed) byName.set(parsed.name, entry);
  }

  for (const name of RUNTIME_PRIMITIVES) {
    const entry = byName.get(name);
    if (!entry) {
      errors.push(`required runtime dependency "${name}" is not present in the factory's pi.packages`);
      continue;
    }
    const parsed = parseNpmSpec(entry);
    if (!parsed || !parsed.version) {
      errors.push(`required runtime dependency "${name}" must be a pinned npm:<name>@<version> (got "${entry}")`);
      continue;
    }
    pins.push(entry);
  }

  for (const spec of Array.isArray(declared) ? declared : []) {
    const parsed = parseNpmSpec(spec);
    if (parsed && RUNTIME_PRIMITIVES.includes(parsed.name)) {
      const pinned = byName.get(parsed.name);
      if (pinned && pinned !== spec) {
        errors.push(`declared package "${spec}" conflicts with the pinned runtime primitive "${pinned}"`);
      }
      continue; // primitive already pinned above; never re-emit
    }
    const err = declaredSpecError(spec);
    if (err) errors.push(err);
    else if (!pins.includes(spec)) pins.push(spec);
  }

  return { packages: pins, errors };
}
