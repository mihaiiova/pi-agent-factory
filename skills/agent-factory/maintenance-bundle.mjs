/** Minimal standalone engine packaging; no operational packages or credentials. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { infrastructureFiles } from './maintenance-infra.mjs';
import { loadYaml } from './yaml-loader.mjs';
import { assertValid } from './changes.mjs';
import { launcherScript } from './runtime.mjs';
import { digest, json, readText, readJson, fingerprints, atomicWrite, transact } from './maintenance-store.mjs';
import { effectiveCapabilities, checkCapabilities } from './capabilities.mjs';

export const SOURCE = 'mihaiiova/pi-agent-factory';
export const CHANNEL = 'development';
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SHA = /^[a-f0-9]{40}$/;
const LEGACY_SETTINGS_GENERATOR = 'extensions/pi-config/generate-settings.mjs';
export function validateIdentity(meta) {
  if (meta?.source !== SOURCE || !(meta.channel === CHANNEL || /^tags\/v[0-9]+\.[0-9]+\.[0-9]+$/.test(meta.channel))) throw new Error('Untrusted Factory source/channel; reconfigure only through a reviewed bootstrap');
  if (!SHA.test(meta.revision) || typeof meta.version !== 'string' || !/^[0-9A-Za-z.+-]{1,80}$/.test(meta.version)) throw new Error('Invalid Factory revision/version');
  if (meta.runtime !== undefined && !/^runtime\/[a-f0-9-]+$/.test(meta.runtime)) throw new Error('Invalid runtime path');
  return meta;
}
export function yamlPin(pkg) {
  const spec = pkg?.pi?.packages?.find(p => typeof p === 'string' && p.startsWith('npm:yaml@'));
  const version = spec?.slice('npm:yaml@'.length);
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Factory must pin an exact yaml dependency');
  return version;
}
function walk(dir, prefix = '') {
  const files = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new Error('Symlink in bundled dependency');
    if (e.isDirectory()) Object.assign(files, walk(join(dir, e.name), rel));
    else files[rel] = readFileSync(join(dir, e.name), 'utf8');
  }
  return files;
}
export function validateManifest(manifest) {
  if (manifest?.protocol !== 1 || !Array.isArray(manifest.schemas) || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100) throw new Error('Unsupported maintenance protocol');
  for (const p of manifest.files) {
    // Published revisions before per-agent models also bundled the tier settings
    // generator; their manifests must still validate for checks and rollback.
    if (!(p === LEGACY_SETTINGS_GENERATOR || /^skills\/agent-factory\/[a-z0-9-]+\.(mjs|md)$/.test(p))) throw new Error(`Unsafe bundle source path: ${p}`);
  }
  for (const required of ['maintenance-extension.mjs', 'maintenance-smoke.mjs', 'maintenance-bundle.mjs', 'maintenance-updates.mjs']) {
    if (!manifest.files.includes(`skills/agent-factory/${required}`)) throw new Error(`Missing ${required}`);
  }
  return manifest;
}
/** readSource is supplied by the local tree or verified git objects. */
export function buildBundle(readSource, identity, yamlDir) {
  validateIdentity(identity);
  const manifest = validateManifest(JSON.parse(readSource('skills/agent-factory/maintenance-manifest.json')));
  const pkg = JSON.parse(readSource('package.json'));
  if (pkg.version !== identity.version) throw new Error('Factory version does not match its source');
  const dependency = JSON.parse(readFileSync(join(yamlDir, 'package.json'), 'utf8'));
  if (dependency.name !== 'yaml' || dependency.version !== yamlPin(pkg) || Object.keys(dependency.dependencies ?? {}).length) throw new Error('Unexpected YAML dependency graph/version');
  const files = Object.fromEntries(manifest.files.map(p => [p, readSource(p)]));
  files['skills/agent-factory/maintenance-manifest.json'] = json(manifest);
  files['package.json'] = json({ private: true, version: pkg.version, dependencies: { yaml: dependency.version }, pi: { packages: pkg.pi.packages.filter(p => /^npm:(yaml|pi-subagents|pi-mcp-adapter)@/.test(p)) } });
  // Only yaml's actual runtime and license, not its browser copy or development files.
  for (const [p, content] of Object.entries(walk(yamlDir))) if (p === 'package.json' || p === 'LICENSE' || p === 'util.js' || p.startsWith('dist/')) files[`node_modules/yaml/${p}`] = content;
  const hashes = Object.fromEntries(Object.keys(files).sort().map(p => [p, digest(files[p])]));
  const integrity = digest(json(hashes));
  const runtime = `runtime/${identity.revision}-${integrity.slice(0, 16)}`;
  files['bundle.json'] = json(hashes);
  return { files, installation: { ...identity, runtime, integrity, protocol: manifest.protocol, schemas: manifest.schemas, dependencies: { yaml: dependency.version } } };
}
export function installedYamlDir() {
  if (import.meta.url.includes('/.factory/runtime/')) {
    const bundled = resolve(REPO, 'node_modules/yaml');
    readFileSync(join(bundled, 'package.json')); // no ancestor/global fallback
    return bundled;
  }
  const local = createRequire(import.meta.url);
  try { return dirname(local.resolve('yaml/package.json')); } catch { /* main Pi package */ }
  return dirname(createRequire(resolve(homedir(), '.pi/agent/npm/package.json')).resolve('yaml/package.json'));
}
export function localBundle(repo = REPO) {
  const readSource = p => readFileSync(join(repo, p), 'utf8');
  const revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const version = JSON.parse(readSource('package.json')).version;
  // The source digest makes development snapshots reproducible without claiming
  // that uncommitted maintenance code was contained in HEAD.
  const dirty = !!execFileSync('git', ['-C', repo, 'status', '--porcelain', '--', 'skills/agent-factory', 'package.json'], { encoding: 'utf8' }).trim();
  return buildBundle(readSource, { source: SOURCE, channel: CHANNEL, revision, version, developmentSnapshot: dirty }, installedYamlDir());
}
export function verifyBundle(root, installation) {
  validateIdentity(installation);
  const hashes = readJson(root, `.factory/${installation.runtime}/bundle.json`);
  if (digest(json(hashes)) !== installation.integrity) throw new Error('Maintenance manifest integrity mismatch');
  for (const [p, hash] of Object.entries(hashes)) {
    const content = readText(root, `.factory/${installation.runtime}/${p}`);
    if (content === null || digest(content) !== hash) throw new Error(`Maintenance integrity mismatch: ${p}`);
  }
  return true;
}
export function stageBundle(root, bundle) {
  for (const [p, content] of Object.entries(bundle.files)) {
    const rel = `.factory/${bundle.installation.runtime}/${p}`;
    const existing = readText(root, rel);
    if (existing !== null && existing !== content) throw new Error(`Staging collision: ${rel}`);
    if (existing === null) atomicWrite(root, rel, content);
  }
  verifyBundle(root, bundle.installation);
}
export function bootstrapPlan(root, bundle = localBundle()) {
  const text = readText(root, '.pi/system.yaml');
  if (!text) throw new Error('Missing .pi/system.yaml; use factory import for non-Factory projects');
  // Deliberately do not normalize/migrate a bootstrap target behind the user's back.
  assertValid(loadYaml().parse(text));
  for (const p of ['.pi/settings.json', '.pi/mcp.json']) {
    const value = readJson(root, p);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${p}`);
  }
  if (readText(root, '.factory/installation.json')) throw new Error('Maintenance already installed; use /factory-update update');
  const writes = infrastructureFiles();
  for (const [p, content] of Object.entries(writes)) {
    const existing = readText(root, p);
    if (existing !== null && existing !== content) throw new Error(`Maintenance infrastructure conflict: ${p}`);
  }
  const launcher = readText(root, 'run');
  const desiredLauncher = launcherScript();
  const oldLauncher = desiredLauncher.replace('exec pi --no-context-files', 'exec pi');
  const historicalComment = text => text.replace('# context (`./run`, then `/login`)', '# context (`pi --login`)');
  const historicalTuiComment = text => text.replace(
    '# context (`./run`, then `/login`), or export PI_API_KEY / a provider-specific key.',
    '# context (`/login` inside the TUI), or export DEEPSEEK_API_KEY / pass --api-key.',
  );
  // Exact historical templates only: comment-only variants are recognized,
  // but customized environment exports, flags and commands remain conflicts.
  const knownLaunchers = [desiredLauncher, oldLauncher, historicalComment(desiredLauncher), historicalComment(oldLauncher), historicalTuiComment(desiredLauncher), historicalTuiComment(oldLauncher)];
  if (launcher !== null && !knownLaunchers.includes(launcher)) throw new Error('Authored launcher conflict: inspect run before bootstrapping');
  writes.run = desiredLauncher;
  const model = loadYaml().parse(text);
  const settings = readJson(root, '.pi/settings.json');
  const mcpJson = readJson(root, '.pi/mcp.json');
  const opts = { piPackages: settings.packages };
  const consistency = checkCapabilities(model, { settings, mcpJson }, opts);
  // Infrastructure bootstrapping never reconciles operational drift implicitly.
  // Report it and preserve the files; subsequent change previews can repair it.
  writes['.factory/capabilities.json'] = json(effectiveCapabilities(model, opts));
  const installation = { ...bundle.installation, entrypoints: Object.fromEntries(Object.entries(infrastructureFiles()).map(([path, content]) => [path, digest(content)])) };
  writes['.factory/installation.json'] = json(installation);
  const expected = fingerprints(root, [...Object.keys(writes), '.pi/system.yaml', '.pi/settings.json', '.pi/mcp.json', 'run']);
  return { kind: 'bootstrap', bundle, writes, expected, preview: { files: [...Object.keys(writes), `.factory/${bundle.installation.runtime}/…`], consistency, installation, restart: 'Restart ./run to load /factory-update. Existing operational configuration is unchanged.' } };
}
export function applyBootstrap(root, plan, approved = false) {
  if (!approved) throw new Error('Explicit user approval required');
  stageBundle(root, plan.bundle);
  transact(root, plan.writes, plan.expected, approved);
  return plan.preview;
}
