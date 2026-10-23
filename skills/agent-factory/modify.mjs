/**
 * modify — diff a validated model against the current project and produce a
 * plan for surgical application.
 *
 * Pure seam: `modifyPlan(model, existingFiles) -> { files, conflicts, warnings, errors }`. It
 * reuses `generateProject` (identical ownership contract: derived files
 * regenerate merge-preserving; authored files are scaffold-once and
 * fingerprint-protected, never silently overwritten) and annotates every
 * `write`/`conflict` entry with a computed `diff` (old → new/desired) so the
 * CLI can present the planned change without re-deriving it. No fs/CLI work.
 */
import { generateProject } from "./generate.mjs";
import { diffLines } from "./diff.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {object} model the migrated, validated `system.yaml` document.
 * @param {Record<string, string>} [existingFiles] project-relative path → text.
 * @returns {{ files: Array<{path, content, action, desired?, diff?}>, conflicts: Array }}
 */
export function modifyPlan(model, existingFiles = {}, opts = {}) {
  const existing = isPlainObject(existingFiles) ? existingFiles : {};
  const { files, warnings, errors } = generateProject(model, existing, opts);

  const annotated = files.map((f) => {
    if (f.action === "write") {
      return { ...f, diff: diffLines(existing[f.path] ?? "", f.content) };
    }
    if (f.action === "conflict") {
      return { ...f, diff: diffLines(existing[f.path] ?? "", f.desired ?? "") };
    }
    return f;
  });

  const conflicts = annotated.filter((f) => f.action === "conflict");
  return { files: annotated, conflicts, warnings, errors };
}
