/**
 * deps — compute the declared runtime `packages` for a generated project.
 *
 * Pure seam: `runtimePackages(piPackages, declared) -> string[]`.
 *
 * A generated system is self-contained by declaration, not by wholesale
 * package inheritance. The runtime keeps only the two Pi runtime primitives it
 * needs — `pi-subagents` (subagent support) and `pi-mcp-adapter` (MCP support)
 * — plus whatever the model explicitly declares. pi-config's own dev-only
 * packages (web access, the YAML parser, question helpers) and any git pin are
 * never emitted; local-path and secret-shaped entries are rejected.
 */

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

/** A declared package must be an `npm:` or `git:` spec, never a local path. */
function isValidDeclaredSpec(spec) {
  return isString(spec) && !LOCAL_PATH_RE.test(spec) && /^(npm|git):[^\s]+$/.test(spec);
}

/**
 * @param {string[]} [piPackages] pi-config's own `pi.packages` (`npm:<name>@<version>`).
 * @param {string[]} [declared] the model's declared `packages` (npm:/git: specs).
 * @returns {string[]} the runtime `packages` list (primitives first, then declared).
 */
export function runtimePackages(piPackages, declared = []) {
  const pins = [];

  const byName = new Map();
  for (const entry of Array.isArray(piPackages) ? piPackages : []) {
    const parsed = parseNpmSpec(entry);
    if (parsed) byName.set(parsed.name, entry);
  }

  for (const name of RUNTIME_PRIMITIVES) {
    const entry = byName.get(name);
    if (entry) pins.push(entry);
  }

  for (const spec of Array.isArray(declared) ? declared : []) {
    if (isValidDeclaredSpec(spec) && !pins.includes(spec)) pins.push(spec);
  }

  return pins;
}
