/** Stable, infrastructure-owned entrypoints (not operational skills). */
export const MAINTENANCE_SKILL = `---
name: factory-update
description: Maintain this generated system through validated declarative changes. Explicit invocation only.
disable-model-invocation: true
---

# Factory maintenance

Invoke /factory-update <request> to enter maintenance. Use factory_plan to inspect
and propose changes; never edit generated settings, MCP configuration or runtime
files directly. system.yaml is authoritative. /factory-update apply previews and
asks the human to approve a pending proposal. /factory-update done exits.

Use /factory-update review for read-only recommendations. For tooling use
/factory-update check, update, or rollback. No startup installation. recover repairs
interrupted transactions; reconcile separately previews existing generated drift.
PI_NO_UPDATE_CHECK=1 disables automatic discovery without disabling maintenance.
`;

// TypeBox is supplied by Pi, not duplicated in the maintenance dependency tree.
// Only this loader is discovered as an extension; versioned engines are data
// until their trusted installation metadata is activated.
export const MAINTENANCE_LOADER = `import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Type } from 'typebox';
export default async function(pi) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const installation = JSON.parse(readFileSync(join(root, '.factory/installation.json'), 'utf8'));
  if (installation.source !== 'mihaiiova/pi-config' || !/^runtime\\/[a-f0-9-]+$/.test(installation.runtime)) throw new Error('Invalid Factory installation');
  const base = join(root, '.factory', installation.runtime);
  const hash = text => createHash('sha256').update(text).digest('hex');
  const hashes = JSON.parse(readFileSync(join(base, 'bundle.json'), 'utf8'));
  if (hash(JSON.stringify(hashes, null, 2) + '\\n') !== installation.integrity) throw new Error('Factory bundle manifest integrity mismatch');
  for (const [path, expected] of Object.entries(hashes)) {
    if (path.startsWith('/') || path.includes('\\\\') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe Factory bundle path');
    let current = root;
    for (const part of ['.factory', ...installation.runtime.split('/'), ...path.split('/')]) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink in Factory runtime');
    }
    if (hash(readFileSync(join(base, path))) !== expected) throw new Error('Factory bundle integrity mismatch: ' + path);
  }
  const engine = await import(pathToFileURL(join(base, 'skills/agent-factory/maintenance-extension.mjs')).href);
  engine.registerMaintenance(pi, Type, root);
}
`;
export function infrastructureFiles() {
  return {
    '.pi/extensions/factory-update/index.ts': MAINTENANCE_LOADER,
    '.pi/skills/factory-update/SKILL.md': MAINTENANCE_SKILL,
  };
}
