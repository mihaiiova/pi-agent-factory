/** Trusted-source discovery and versioned maintenance-only activation. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { SOURCE, SHA, validateIdentity, validateManifest, yamlPin, buildBundle, installedYamlDir, stageBundle, verifyBundle } from './maintenance-bundle.mjs';
import { readText, readJson, fingerprints, assertUnchanged, transact, json, safePath, atomicWrite } from './maintenance-store.mjs';
import { loadYaml } from './yaml-loader.mjs';
import { managedPaths } from './generate.mjs';
import { diffLines } from './diff.mjs';
const exec = promisify(execFile);
const TTL = 24 * 60 * 60 * 1000;
const FAILURE = '.factory/update-failure.json';
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
// Statuses meaning "try again later"; anything else is the source answering.
const TRANSIENT_HTTP = new Set([403, 408, 429]);
function transient(error) {
  error.transient = true;
  return error;
}
function cleanEnv(home) {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, TMPDIR: home, LANG: 'C.UTF-8', PI_OFFLINE: '1', PI_CODING_AGENT_DIR: join(home, 'pi-home') };
}
export async function fetchJson(url, { fetcher = fetch, signal } = {}) {
  // Network failures and timeouts are transient; a definite answer that the
  // check cannot use (404, malformed metadata) is a persistent failure.
  let response, text;
  try {
    response = await fetcher(url, { redirect: 'error', headers: { Accept: 'application/vnd.github+json' }, signal: signal ?? AbortSignal.timeout(4000) });
  } catch (error) { throw transient(error); }
  if (!response.ok) {
    const error = new Error(`Update source unavailable (HTTP ${response.status})`);
    throw response.status >= 500 || TRANSIENT_HTTP.has(response.status) ? transient(error) : error;
  }
  try { text = await response.text(); } catch (error) { throw transient(error); }
  if (text.length > 1000000) throw new Error('Oversized update response');
  return JSON.parse(text);
}
async function revisionInfo(installed, revision, opts) {
  if (!SHA.test(revision ?? '')) throw new Error('Invalid revision from update source');
  const prefix = `https://raw.githubusercontent.com/${SOURCE}/${revision}`;
  const [pkg, manifest] = await Promise.all([
    fetchJson(`${prefix}/package.json`, opts),
    fetchJson(`${prefix}/skills/agent-factory/maintenance-manifest.json`, opts),
  ]);
  // Unknown future protocols can be reported as incompatible without executing
  // them or pretending a successful request was a network failure.
  if (!Number.isInteger(manifest.protocol) || manifest.protocol < 1 || !Array.isArray(manifest.schemas) || !manifest.schemas.length || !manifest.schemas.every(Number.isInteger)) throw new Error('Invalid maintenance compatibility metadata');
  if (manifest.protocol === 1) validateManifest(manifest);
  const latest = { source: SOURCE, channel: installed.channel, revision, version: pkg.version, protocol: manifest.protocol, schemas: manifest.schemas, dependencies: manifest.protocol === 1 ? { yaml: yamlPin(pkg) } : null };
  return validateIdentity(latest);
}
function report(installed, latest, schema, target = latest, comparison = null) {
  const migrationRequired = !target.schemas.includes(schema);
  const ordering = installed.revision === target.revision ? 'identical' : comparison?.from === installed.revision && comparison?.to === target.revision ? comparison.status : 'unknown';
  const compatible = target.protocol === installed.protocol && !migrationRequired && ordering !== 'diverged';
  const updateAvailable = ordering === 'ahead' ? true : ['identical', 'behind'].includes(ordering) ? false : null;
  return { status: 'checked', installed, latest, target, ordering, updateAvailable, migrationRequired, compatible, compatibility: compatible ? 'Protocol and schema compatible; revision ordering must be established and staged checks still required' : 'Cannot activate: unsupported protocol/schema or diverged source history; preview a model migration separately or bootstrap with a compatible Factory' };
}
export async function checkForUpdates(root, { force = false, now = Date.now(), fetcher, signal } = {}) {
  const installed = validateIdentity(readJson(root, '.factory/installation.json'));
  const schema = loadYaml().parse(readText(root, '.pi/system.yaml'))?.schema;
  const key = `${installed.source}/${installed.channel}`;
  if (!force) {
    try {
      const cache = readJson(root, '.factory/update-cache.json');
      validateIdentity(cache.latest);
      validateIdentity(cache.target ?? cache.latest);
      if (cache.key === key && cache.latest.channel === installed.channel && cache.checkedAt <= now && now - cache.checkedAt < TTL) return { ...report(installed, cache.latest, schema, cache.target ?? cache.latest, cache.comparison), cached: true };
    } catch { /* no successful cached check */ }
  }
  try {
    // The releases channel follows the highest vX.Y.Z tag; other channels name
    // a git ref (the development branch or one pinned tag).
    const releases = installed.channel === 'releases' ? await releaseRevisions({ fetcher, signal }) : null;
    const ref = installed.channel.startsWith('tags/') ? installed.channel.slice(5) : installed.channel;
    const head = releases ? releases[0] : (await fetchJson(`https://api.github.com/repos/${SOURCE}/commits/${encodeURIComponent(ref)}`, { fetcher, signal })).sha;
    const latest = await revisionInfo(installed, head, { fetcher, signal });
    let target = latest;
    // Explicit checks/updates can resolve the newest compatible revision behind
    // an incompatible channel head (older releases or development history).
    // Startup stays at a few lightweight requests (or uses a compatible
    // candidate cached by an explicit check).
    if (force && (releases || installed.channel === 'development') && installed.schemas?.includes(schema) && !report(installed, latest, schema).compatible) {
      const history = releases ?? await fetchJson(`https://api.github.com/repos/${SOURCE}/commits?sha=development&per_page=20`, { fetcher, signal }).then(entries => {
        if (!Array.isArray(entries)) throw new Error('Invalid compatible-revision history');
        return entries.map(entry => entry?.sha);
      });
      for (const sha of history.slice(0, 20)) {
        if (sha === latest.revision) continue;
        try {
          const candidate = await revisionInfo(installed, sha, { fetcher, signal });
          if (report(installed, candidate, schema).compatible) { target = candidate; break; }
        } catch { /* older revisions may predate the maintenance manifest */ }
      }
    }
    let comparison = null;
    if (installed.revision !== target.revision) {
      const compared = await fetchJson(`https://api.github.com/repos/${SOURCE}/compare/${installed.revision}...${target.revision}`, { fetcher, signal });
      if (!['ahead', 'behind', 'identical', 'diverged'].includes(compared.status)) throw new Error('Could not establish Factory revision ordering');
      comparison = { from: installed.revision, to: target.revision, status: compared.status };
    }
    // Cache only successful checks, never a network failure mistaken for current.
    try { atomicWrite(root, '.factory/update-cache.json', json({ key, checkedAt: now, latest, target, comparison })); } catch { /* read-only project: successful check is still useful */ }
    try { rmSync(safePath(root, FAILURE), { force: true }); } catch { /* best effort */ }
    return report(installed, latest, schema, target, comparison);
  } catch (error) {
    const result = { status: 'unavailable', installed, latest: null, updateAvailable: null, compatible: null, migrationRequired: null, error: error.message, transient: error?.transient === true };
    if (!result.transient) result.failure = recordFailure(root, error.message, now);
    return result;
  }
}
/** Release tag revisions, newest version first. */
async function releaseRevisions(opts) {
  const tags = await fetchJson(`https://api.github.com/repos/${SOURCE}/tags?per_page=100`, opts);
  if (!Array.isArray(tags)) throw new Error('Invalid release tag list');
  const releases = tags
    .filter(tag => RELEASE_TAG.test(tag?.name ?? '') && SHA.test(tag?.commit?.sha ?? ''))
    .map(tag => ({ sha: tag.commit.sha, key: tag.name.match(RELEASE_TAG).slice(1).map(Number) }))
    .sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2]);
  if (!releases.length) throw new Error('No release tags published');
  return releases.map(release => release.sha);
}
/** Persist a non-transient failure so it is not swallowed on every start. */
function recordFailure(root, message, now) {
  let previous = null;
  try { previous = readJson(root, FAILURE); } catch { /* first failure */ }
  const failure = {
    firstFailedAt: Number.isFinite(previous?.firstFailedAt) && previous.firstFailedAt <= now ? previous.firstFailedAt : now,
    lastFailedAt: now,
    error: message,
    ...(Number.isFinite(previous?.notifiedAt) ? { notifiedAt: previous.notifiedAt } : {}),
  };
  try { atomicWrite(root, FAILURE, json(failure)); } catch { /* read-only project */ }
  return failure;
}
export function checkSummary(result) {
  const installed = result.installed;
  const lines = [
    `Installed Factory: ${installed.version} (${installed.revision})`,
    `Source: ${installed.source}`, `Channel: ${installed.channel}`,
    `Latest revision: ${result.latest ? `${result.latest.version} (${result.latest.revision})` : 'unknown'}`,
  ];
  if (result.target && result.target.revision !== result.latest?.revision) lines.push(`Compatible target: ${result.target.version} (${result.target.revision})`);
  if (result.status !== 'checked') {
    lines.push(`Could not check: ${result.error}`);
    if (result.failure) lines.push(`Failing since: ${new Date(result.failure.firstFailedAt).toISOString()}`);
    if (/HTTP 404/.test(result.error ?? '')) lines.push(`If this project was generated from an unpushed Factory commit (${installed.revision.slice(0, 12)}), push it to ${installed.source} so updates can be compared.`);
  }
  else lines.push(`Update: ${result.updateAvailable === true ? 'available' : result.updateAvailable === null ? 'ordering unknown/diverged; not installable' : result.ordering === 'behind' ? 'channel is older than installed revision' : 'up to date with compatible channel revisions'}`);
  lines.push(`Schema migration required: ${result.migrationRequired === null ? 'unknown' : result.migrationRequired ? 'yes' : 'no'}`);
  lines.push(`Compatibility: ${result.compatibility ?? 'could not establish before installation'}`);
  if (installed.developmentSnapshot) lines.push('Installed bundle is a content-addressed development snapshot, not pristine HEAD.');
  return lines.join('\n');
}
export function updateNotice(result) {
  return result.status === 'checked' && result.updateAvailable === true && result.compatible
    ? `Factory update available: ${result.target.version} (${result.target.revision.slice(0, 12)})\nRun /factory-update update to upgrade.` : null;
}
export function startupCheck(root, notify, opts = {}) {
  // Do not return/await this promise from session_start: Pi startup stays live.
  if (process.env.PI_NO_UPDATE_CHECK === '1' || process.env.PI_OFFLINE === '1' || process.argv.includes('--offline')) return Promise.resolve();
  return checkForUpdates(root, opts).then(result => {
    const message = updateNotice(result) ?? failureNotice(root, result, opts.now ?? Date.now());
    if (message) notify(message);
  }).catch(() => {});
}
/** At most one notice per day for a check that keeps failing; offline stays silent. */
function failureNotice(root, result, now) {
  const failure = result.failure;
  if (result.status === 'checked' || !failure || (Number.isFinite(failure.notifiedAt) && now - failure.notifiedAt < TTL)) return null;
  try { atomicWrite(root, FAILURE, json({ ...failure, notifiedAt: now })); } catch { /* read-only project */ }
  return `Factory update check is failing: ${result.error}\nRun /factory-update check for details.`;
}
export async function verifiedSource(revision, run = exec) {
  if (!SHA.test(revision)) throw new Error('Invalid update revision');
  const temp = mkdtempSync(join(tmpdir(), 'factory-source-'));
  const git = args => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'http.followRedirects=false', '-C', temp, ...args], { timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...cleanEnv(temp), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0' } });
  try {
    await git(['init', '--quiet']);
    await git(['fetch', '--quiet', '--depth=1', `https://github.com/${SOURCE}.git`, revision]);
    const { stdout } = await git(['rev-parse', 'FETCH_HEAD']);
    if (stdout.trim() !== revision) throw new Error('Fetched Factory revision mismatch');
    // Read blobs without checking out, running hooks, or trusting archive paths.
    const source = {};
    const get = async path => {
      const result = await git(['show', `${revision}:${path}`]);
      source[path] = result.stdout;
      return result.stdout;
    };
    const manifest = validateManifest(JSON.parse(await get('skills/agent-factory/maintenance-manifest.json')));
    await get('package.json');
    for (const path of manifest.files) await get(path);
    return p => { if (!(p in source)) throw new Error(`Missing verified source: ${p}`); return source[p]; };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
async function dependencyDir(version, temp) {
  const local = installedYamlDir();
  if (JSON.parse(readFileSync(join(local, 'package.json'), 'utf8')).version === version) return local;
  // npm verifies registry tarball integrity; lifecycle scripts and peer installs
  // are disabled. Only the dependency graph explicitly supported by buildBundle
  // is accepted. No downloaded Factory code is executed here.
  writeFileSync(join(temp, 'package.json'), json({ private: true, dependencies: { yaml: version } }));
  await exec('npm', ['install', '--prefix', temp, '--ignore-scripts', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], { timeout: 60000, env: { ...cleanEnv(temp), NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_GLOBALCONFIG: '/dev/null', NPM_CONFIG_CACHE: join(temp, 'npm-cache') } });
  return join(temp, 'node_modules/yaml');
}
export async function prepareUpdate(root, opts = {}) {
  const result = await checkForUpdates(root, { ...opts, force: true });
  if (result.status !== 'checked') throw new Error(`Could not check: ${result.error}`);
  if (result.updateAvailable === null) throw new Error('Factory revision ordering is unknown or diverged; no installation attempted');
  if (!result.updateAvailable) return { kind: 'current', preview: result };
  if (!result.compatible) throw new Error(result.compatibility);
  const target = result.target;
  if (json(readJson(root, '.factory/installation.json')) !== json(result.installed)) throw new Error('Installation changed during update check; retry');
  verifyBundle(root, result.installed);
  const model = loadYaml().parse(readText(root, '.pi/system.yaml'));
  const expected = fingerprints(root, ['.factory/installation.json', '.factory/previous-installation.json', ...managedPaths(model), '.pi/system.yaml', '.factory/capabilities.json']);
  const readSource = await (opts.sourceReader ? opts.sourceReader(target.revision) : verifiedSource(target.revision));
  const temp = mkdtempSync(join(tmpdir(), 'factory-deps-'));
  try {
    const yamlDir = opts.yamlDir ?? await dependencyDir(target.dependencies.yaml, temp);
    const bundle = buildBundle(readSource, { source: SOURCE, channel: result.installed.channel, revision: target.revision, version: target.version, developmentSnapshot: false }, yamlDir);
    bundle.installation.entrypoints = result.installed.entrypoints;
    const manifest = validateManifest(JSON.parse(readSource('skills/agent-factory/maintenance-manifest.json')));
    if (manifest.protocol !== result.installed.protocol || !manifest.schemas.includes(model.schema)) throw new Error('Staged compatibility differs from discovery');
    stageBundle(root, bundle);
    const oldHashes = readJson(root, `.factory/${result.installed.runtime}/bundle.json`);
    const newHashes = JSON.parse(bundle.files['bundle.json']);
    const changes = [...new Set([...Object.keys(oldHashes), ...Object.keys(newHashes)])].filter(p => oldHashes[p] !== newHashes[p]);
    const toolingDiffs = changes.filter(p => !p.startsWith('node_modules/')).map(path => {
      const diff = diffLines(readText(root, `.factory/${result.installed.runtime}/${path}`) ?? '', bundle.files[path] ?? '');
      return { path, diff: diff.slice(0, 3000), truncated: diff.length > 3000 };
    });
    return { kind: 'upgrade', bundle, installed: result.installed, expected, preview: { from: result.installed, to: bundle.installation, channelHead: result.latest, changes, toolingDiffs, fullSource: `.factory/${bundle.installation.runtime}/`, schemaMigration: 'None. system.yaml and all operational files remain byte-for-byte unchanged.', dependencies: bundle.installation.dependencies, restart: 'Restart ./run to use the new maintenance implementation.' } };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export async function activateUpdate(root, plan, approved = false) {
  if (!approved) throw new Error('Explicit user approval required');
  if (plan?.kind !== 'upgrade') throw new Error('No staged upgrade');
  assertUnchanged(root, plan.expected);
  verifyBundle(root, plan.bundle.installation);
  const base = safePath(root, `.factory/${plan.bundle.installation.runtime}`);
  // Run credential-free syntax and consistency checks only after source verification
  // AND approval. A failing check never changes the active installation pointer.
  const checkHome = mkdtempSync(join(tmpdir(), 'factory-check-'));
  try {
    for (const p of Object.keys(plan.bundle.files).filter(p => p.endsWith('.mjs') && !p.includes('node_modules/'))) await exec(process.execPath, ['--check', join(base, p)], { timeout: 10000, env: cleanEnv(checkHome) });
    await exec(process.execPath, [join(base, 'skills/agent-factory/maintenance-smoke.mjs'), root], { timeout: 15000, env: cleanEnv(checkHome) });
  } finally { rmSync(checkHome, { recursive: true, force: true }); }
  transact(root, {
    '.factory/previous-installation.json': json(plan.installed),
    '.factory/installation.json': json(plan.bundle.installation),
  }, plan.expected, true);
  return plan.preview.restart;
}
export function rollbackPlan(root) {
  const installed = validateIdentity(readJson(root, '.factory/installation.json'));
  if (!readText(root, '.factory/previous-installation.json')) throw new Error('No previous working Factory installation is available for rollback');
  const previous = validateIdentity(readJson(root, '.factory/previous-installation.json'));
  verifyBundle(root, previous);
  const model = loadYaml().parse(readText(root, '.pi/system.yaml'));
  if (!previous.schemas?.includes(model.schema)) throw new Error('Current schema is incompatible with the previous maintenance version. Do not reverse later user edits; preview an explicit model migration first.');
  return { kind: 'rollback', writes: { '.factory/installation.json': json(previous), '.factory/previous-installation.json': json(installed) }, expected: fingerprints(root, ['.factory/installation.json', '.factory/previous-installation.json', '.pi/system.yaml', ...managedPaths(model), '.factory/capabilities.json']), preview: { from: installed, to: previous, schema: 'No schema reversal: current model is preserved.', restart: 'Restart ./run to use the restored maintenance version.' } };
}
export function applyRollback(root, plan, approved = false) {
  if (plan?.kind !== 'rollback') throw new Error('No rollback proposal');
  if (!approved) throw new Error('Explicit user approval required');
  const previous = JSON.parse(plan.writes['.factory/installation.json']);
  verifyBundle(root, previous);
  assertUnchanged(root, plan.expected);
  // Validate the CURRENT model with the OLD engine, rather than assuming that
  // an unchanged schema number guarantees backwards-compatible semantics.
  const checkHome = mkdtempSync(join(tmpdir(), 'factory-rollback-check-'));
  try {
    execFileSync(process.execPath, [safePath(root, `.factory/${previous.runtime}/skills/agent-factory/maintenance-smoke.mjs`), root], { timeout: 15000, stdio: 'pipe', env: cleanEnv(checkHome) });
  } finally { rmSync(checkHome, { recursive: true, force: true }); }
  transact(root, plan.writes, plan.expected, approved);
  return plan.preview.restart;
}
