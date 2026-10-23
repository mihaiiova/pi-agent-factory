/**
 * migrate — forward migration of supported older `system.yaml` schema versions
 * to the current schema (v1).
 *
 * Pure seam: `migrate(doc) -> doc`. Returns a new document; never mutates the
 * input. Version history:
 *
 *   v0 → v1  — v0 documents omitted the `schema` field and used
 *              `models.subagentTiers` (the `generate-settings.mjs` spelling);
 *              v1 sets `schema: 1` and renames it to `models.subagents`.
 */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Migrate a parsed document to the current schema version.
 *
 * @param {unknown} doc parsed YAML document.
 * @returns {unknown} a new document at schema v1 (non-objects pass through).
 */
export function migrate(doc) {
  if (!isPlainObject(doc)) return doc;

  const out = { ...doc, schema: 1 };

  if (isPlainObject(out.models)) {
    if (out.models.subagentTiers !== undefined && out.models.subagents === undefined) {
      out.models = { ...out.models, subagents: out.models.subagentTiers };
    }
    delete out.models.subagentTiers;
  }

  return out;
}
