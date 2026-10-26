/** Configuration maintenance reuses the Factory's existing model/ownership seams. */
import { changeModel, parsedModel } from './changes.mjs';
import { loadYaml } from './yaml-loader.mjs';
import { managedPaths, generateProject } from './generate.mjs';
import { modifyPlan } from './modify.mjs';
import { effectiveCapabilities, checkCapabilities } from './capabilities.mjs';
import { diffLines } from './diff.mjs';
import { infrastructureFiles } from './maintenance-infra.mjs';
import { redacted, redactForModel, assertNoNewSecrets } from './maintenance-secrets.mjs';
import { vendoredSkills } from './skill-sources.mjs';
import { readText, readJson, fingerprints, transact, json } from './maintenance-store.mjs';

function pinsAt(root) {
  return readJson(root, '.pi/settings.json').packages ?? [];
}
export function inspectProject(root) {
  const text = readText(root, '.pi/system.yaml');
  const model = parsedModel(text);
  const settings = readJson(root, '.pi/settings.json');
  const mcpJson = readJson(root, '.pi/mcp.json');
  const caps = effectiveCapabilities(model, { piPackages: pinsAt(root) });
  return redactForModel(root, {
    systemYaml: loadYaml().stringify(redacted(loadYaml().parse(text))), systemYamlRedacted: true,
    parsedModel: redacted(model), effectiveCapabilities: caps,
    consistency: checkCapabilities(model, { settings, mcpJson }, { piPackages: pinsAt(root) }),
    generated: Object.fromEntries(managedPaths(model).filter(p => p.startsWith('.pi/')).map(p => {
      const content = readText(root, p);
      return [p, p.endsWith('.json') && content !== null ? json(redacted(JSON.parse(content))) : content];
    })),
    evidence: 'No execution evidence inferred from configuration. Only cite execution evidence the user supplies or explicitly authorizes reading; never read auth files or environment secrets. Credential redaction is best-effort, not a general secret scanner.',
  });
}
export function planChange(root, operations) {
  const oldText = readText(root, '.pi/system.yaml');
  // Legacy schemas can only enter through an explicit, separately previewed replacement.
  const oldModel = parsedModel(oldText);
  const { model, text } = changeModel(oldText, operations);
  assertNoNewSecrets(loadYaml().parse(oldText), model);
  // Vendored skills come from user-supplied directories that only the host CLI
  // can read. The project copy must exist before a declaration may rely on it,
  // and a removed declaration must not leave a still-discoverable copy behind.
  const skillDir = (s) => `.pi/skills/${s.name}/SKILL.md`;
  const missing = vendoredSkills(model).filter(s => readText(root, skillDir(s)) === null);
  if (missing.length) throw new Error(`Vendored skill not present in the project: ${missing.map(s => `${s.name} (copy ${s.source} to .pi/skills/${s.name}/ or run factory generate)`).join(', ')}`);
  const kept = new Set(vendoredSkills(model).map(s => s.name));
  const orphaned = vendoredSkills(oldModel).filter(s => !kept.has(s.name) && readText(root, skillDir(s)) !== null);
  if (orphaned.length) throw new Error(`Removed vendored skill still loads: delete ${orphaned.map(s => `.pi/skills/${s.name}/`).join(', ')} explicitly first`);
  const opts = { piPackages: pinsAt(root) };
  const paths = [...new Set([...managedPaths(oldModel), ...managedPaths(model)])];
  const existing = Object.fromEntries(paths.map(p => [p, readText(root, p)]).filter(([,v]) => v !== null));
  const infrastructure = Object.keys(infrastructureFiles());
  const installed = readText(root, '.factory/installation.json') ? readJson(root, '.factory/installation.json') : {};
  for (const [path, hash] of Object.entries(installed.entrypoints ?? {})) {
    if (fingerprints(root, [path])[path] !== hash) throw new Error(`Maintenance infrastructure conflict: ${path}`);
  }
  const baseline = generateProject(oldModel, existing, opts);
  const drift = baseline.files.filter(f => ['run', '.pi/settings.json', '.pi/mcp.json'].includes(f.path) && f.action !== 'none').map(f => f.path);
  const reconcile = operations.length === 1 && operations[0].op === 'reconcile';
  if (drift.length && !reconcile) throw new Error(`Existing generated configuration drift: ${drift.join(', ')}; use /factory-update reconcile for a separate explicit preview`);
  const plan = modifyPlan(model, existing, opts);
  // Protocol-1 front doors are stable. Their versioned workflow/engine updates
  // behind the installation pointer; future scaffold copy changes are not
  // treated as operational conflicts or silently written over the old loader.
  plan.files = plan.files.filter(f => !infrastructure.includes(f.path));
  plan.conflicts = plan.conflicts.filter(f => !infrastructure.includes(f.path));
  if (plan.errors.length) throw new Error(plan.errors.join('\n'));
  if (plan.conflicts.length) throw new Error(`Authored file conflicts (nothing applied): ${plan.conflicts.map(f => f.path).join(', ')}`);
  const oldScaffolds = generateProject(oldModel, {}, opts).files;
  const newScaffolds = generateProject(model, {}, opts).files;
  // The scaffold-once generator quite correctly leaves unmarked authored files
  // alone. A maintenance request must not claim its prompt/tool/skill change
  // took effect when such a file would still shadow the new declaration.
  for (const f of plan.files.filter(f => f.action === 'none' && (f.path === '.pi/APPEND_SYSTEM.md' || f.path.startsWith('.pi/agents/') || f.path.startsWith('.pi/skills/')))) {
    const before = oldScaffolds.find(s => s.path === f.path)?.content;
    const after = newScaffolds.find(s => s.path === f.path)?.content;
    if (before !== after && existing[f.path] !== after) throw new Error(`Authored file conflict: ${f.path}; reconcile the content explicitly before changing its declaration`);
  }
  const writes = { '.pi/system.yaml': text };
  const files = plan.files.filter(f => ['write', 'create'].includes(f.action));
  for (const f of files) writes[f.path] = f.content;
  // Removed capabilities must stop loading. Delete only fingerprint-intact
  // scaffolds; authored/edited files are a conflict, not a silent orphan.
  for (const path of managedPaths(oldModel).filter(p => !managedPaths(model).includes(p))) {
    if (existing[path] === undefined) continue;
    const scaffold = oldScaffolds.find(f => f.path === path)?.content;
    if (scaffold !== existing[path]) throw new Error(`Authored removal conflict: ${path}; preserve or relocate it explicitly first`);
    writes[path] = null;
    files.push({ path, action: 'remove', content: '' });
  }
  const settings = JSON.parse(writes['.pi/settings.json'] ?? existing['.pi/settings.json']);
  const mcpJson = JSON.parse(writes['.pi/mcp.json'] ?? existing['.pi/mcp.json']);
  const consistency = checkCapabilities(model, { settings, mcpJson }, opts);
  if (!consistency.ok) throw new Error(consistency.errors.join('\n'));
  const beforeCapabilities = effectiveCapabilities(oldModel, opts);
  const afterCapabilities = effectiveCapabilities(model, opts);
  writes['.factory/capabilities.json'] = json(afterCapabilities);
  return {
    kind: 'configuration', writes,
    expected: fingerprints(root, [...paths, ...Object.keys(writes), '.factory/installation.json']),
    preview: {
      reconciliation: reconcile ? drift : [],
      executionSurface: {
        addedPackages: afterCapabilities.packages.filter(p => !beforeCapabilities.packages.includes(p)),
        changedMcp: (model.integrations?.mcp ?? []).filter(m => JSON.stringify(oldModel.integrations?.mcp?.find(o => o.name === m.name)) !== JSON.stringify(m)),
        toolsAndPoliciesChanged: JSON.stringify([oldModel.orchestrator?.tools, oldModel.agents, oldModel.policies]) !== JSON.stringify([model.orchestrator?.tools, model.agents, model.policies]),
        warning: 'Packages and stdio MCP servers execute code at next launch. MCP URLs expose data to their operators. Approval authorizes this declared execution surface.',
      },
      modelDiff: diffLines(oldText, text),
      files: files.map(f => ({ path: f.path, action: f.action, diff: diffLines(existing[f.path] ?? '', f.content) })),
      capabilitiesDiff: diffLines(json(beforeCapabilities), json(afterCapabilities)),
      restart: 'Restart ./run after applying: tool, package, MCP and resource changes are not hot-activated.',
    },
  };
}
/** The model gets a credential-redacted structural diff; the human's local
 * confirmation retains the exact original formatting/content diff. */
export function publicChangePreview(root, plan) {
  const modelDiff = diffLines(
    loadYaml().stringify(redacted(loadYaml().parse(readText(root, '.pi/system.yaml')))),
    loadYaml().stringify(redacted(loadYaml().parse(plan.writes['.pi/system.yaml']))),
  );
  const files = plan.preview.files.map(f => {
    if (!f.path.endsWith('.json')) return f;
    const before = JSON.parse(readText(root, f.path) ?? '{}');
    const after = JSON.parse(plan.writes[f.path] ?? '{}');
    return { ...f, diff: diffLines(json(redacted(before)), json(redacted(after))) };
  });
  return redactForModel(root, { ...plan.preview, modelDiff, files });
}
export function applyChange(root, plan, approved = false) {
  if (plan?.kind !== 'configuration') throw new Error('Expected a configuration proposal');
  transact(root, plan.writes, plan.expected, approved);
  // Verification is deterministic and credential-free.
  try {
    const report = inspectProject(root);
    if (!report.consistency.ok) return `${plan.preview.restart} Applied, but verification reports: ${report.consistency.errors.join('; ')}`;
  } catch (error) { return `${plan.preview.restart} Applied, but verification could not complete: ${error.message}`; }
  return plan.preview.restart;
}
