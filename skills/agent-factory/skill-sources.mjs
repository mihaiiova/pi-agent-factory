/**
 * skill-sources — where a declared skill's content comes from.
 *
 * Pure module. The factory ships no skills of its own: a skill is either
 * authored inline (`body`), provided by a pinned package (`source:
 * npm:<name>@<version>` / `git:<repo>@<ref>`), or vendored from a directory the
 * user supplies (`source: ./path`, `../path`, `/abs/path`, `~/path`). Packaged
 * skills join the runtime `packages`; vendored skills are copied into
 * `.pi/skills/<name>/` by the factory CLI so the generated system stays
 * standalone.
 */

export const PACKAGE_SOURCE_RE = /^(npm:(@[^/\s]+\/)?[^@\s]+@[^@\s]+|git:[^\s]+@[^\s]+)$/;
const PATH_SOURCE_RE = /^(\.\.?\/|\/|~\/)/;

/** `"package" | "path" | null` for a skill `source` value. */
export function skillSourceKind(source) {
  if (typeof source !== "string" || source === "") return null;
  if (PACKAGE_SOURCE_RE.test(source)) return "package";
  if (PATH_SOURCE_RE.test(source)) return "path";
  return null;
}

function skillList(model) {
  return (Array.isArray(model?.skills) ? model.skills : [])
    .filter((skill) => skill && typeof skill === "object" && typeof skill.name === "string");
}

/** Skills whose SKILL.md the generator writes (inline or workflow-derived). */
export function authoredSkills(model) {
  return skillList(model).filter((skill) => skill.source === undefined);
}

/** Skills vendored from a user-supplied directory. */
export function vendoredSkills(model) {
  return skillList(model).filter((skill) => skillSourceKind(skill.source) === "path");
}

/**
 * The model's declared runtime packages: explicit `packages` first, then each
 * packaged skill source (deduplicated, order-preserving).
 */
export function declaredPackages(model) {
  const out = [];
  for (const spec of Array.isArray(model?.packages) ? model.packages : []) {
    if (!out.includes(spec)) out.push(spec);
  }
  for (const skill of skillList(model)) {
    if (skillSourceKind(skill.source) === "package" && !out.includes(skill.source)) out.push(skill.source);
  }
  return out;
}
