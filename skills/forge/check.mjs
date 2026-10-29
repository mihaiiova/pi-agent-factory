import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsedModel } from './changes.mjs';
import { checkProject } from './maintenance.mjs';
import { atomicWrite, json } from './maintenance-store.mjs';

const BUILTIN = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);

/** Check declarations without making a model call. */
export function checkAgent(root, options = {}) {
  const model = parsedModel(readFileSync(join(root, '.pi/system.yaml'), 'utf8'));
  const checked = options.toolCheck;
  const registeredTools = options.registeredTools ?? (checked && !checked.error && !checked.missing.length ? Object.keys(checked.providers) : undefined);
  const checks = checkProject(root, { ...options, registeredTools });
  const capabilities = [];
  for (const agent of [model.orchestrator, ...(model.agents ?? [])]) {
    for (const name of agent.tools ?? []) {
      if (BUILTIN.has(name)) capabilities.push({ agent: agent.name, name, provider: 'built-in', status: 'verified now', fix: 'None.' });
      else if (!name.startsWith('mcp:') && !name.startsWith('cli:') && name !== 'mcp') {
        const provider = checked?.providers[name];
        const present = provider || options.registeredTools?.includes(name);
        const known = registeredTools !== undefined;
        capabilities.push({ agent: agent.name, name, provider: provider || 'extension', status: present ? 'verified now' : known ? 'missing' : 'not verifiable', fix: present ? 'None.' : 'Install or enable the providing extension; use /forge check to verify the live session.' });
      }
    }
  }
  const result = { timestamp: new Date().toISOString(), ok: checks.ok && !capabilities.some(c => c.status === 'missing'), capabilities, checks, ...(checked?.error ? { extensionDiagnostic: checked.error } : {}), ...(checked?.missing.length ? { unresolvedPackages: checked.missing } : {}) };
  atomicWrite(root, '.forge/check.json', json(result));
  return result;
}

/** Use Pi's non-installing package resolver; never load ambiguous autodiscovery. */
export async function loadProjectTools(root) {
  const { existsSync, readdirSync, realpathSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  try {
    let sdk;
    try { sdk = await import('@earendil-works/pi-coding-agent'); }
    catch {
      const executable = (process.env.PATH ?? '').split(':').map(p => join(p, 'pi')).find(p => existsSync(p));
      if (!executable) throw new Error('Pi is not installed on PATH');
      let dir = dirname(realpathSync(executable));
      while (dirname(dir) !== dir && !existsSync(join(dir, 'package.json'))) dir = dirname(dir);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name !== '@earendil-works/pi-coding-agent' || !pkg.main) throw new Error('Cannot locate the Pi SDK');
      sdk = await import(pathToFileURL(resolve(dir, pkg.main)).href);
    }
    const agentDir = join(root, '.forge/pi-home');
    // The SDK's public discoverAndLoadExtensions also auto-loads these paths,
    // bypassing resolver filters. Refuse ambiguity rather than execute disabled code.
    for (const dir of [join(root, '.pi/extensions'), join(agentDir, 'extensions')]) {
      if (existsSync(dir) && readdirSync(dir).length) throw new Error(`Cannot safely verify extension autoload at ${dir}; use /forge check in a running session`);
    }
    const settings = sdk.SettingsManager.create(root, agentDir);
    settings.setProjectTrusted(true);
    await settings.reload();
    const manager = new sdk.DefaultPackageManager({ cwd: root, agentDir, settingsManager: settings });
    const missing = [];
    const resolved = await manager.resolve(async source => { missing.push(source); return 'skip'; });
    const paths = resolved.extensions.filter(e => e.enabled && !e.path.startsWith('builtin:')).map(e => e.path);
    const loaded = await sdk.discoverAndLoadExtensions(paths, root, agentDir);
    if (loaded.errors.length) throw new Error(loaded.errors.map(e => `${e.path}: ${e.error}`).join('; '));
    return { providers: Object.fromEntries(loaded.extensions.flatMap(e => [...e.tools.keys()].map(name => [name, e.path]))), missing };
  } catch (error) { return { providers: {}, missing: [], error: error.message }; }
}
