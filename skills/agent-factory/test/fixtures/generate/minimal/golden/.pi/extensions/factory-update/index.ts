import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Type } from 'typebox';
export default async function(pi) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const installation = JSON.parse(readFileSync(join(root, '.factory/installation.json'), 'utf8'));
  if (installation.source !== 'mihaiiova/pi-agent-factory' || !/^runtime\/[a-f0-9-]+$/.test(installation.runtime)) throw new Error('Invalid Factory installation');
  const base = join(root, '.factory', installation.runtime);
  const hash = text => createHash('sha256').update(text).digest('hex');
  const hashes = JSON.parse(readFileSync(join(base, 'bundle.json'), 'utf8'));
  if (hash(JSON.stringify(hashes, null, 2) + '\n') !== installation.integrity) throw new Error('Factory bundle manifest integrity mismatch');
  for (const [path, expected] of Object.entries(hashes)) {
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe Factory bundle path');
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
