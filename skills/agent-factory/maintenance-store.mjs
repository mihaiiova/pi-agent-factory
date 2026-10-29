/** Local maintenance IO: safe relative paths, fingerprints, checked writes. */
import { existsSync, lstatSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const digest = data => createHash('sha256').update(data).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export function safePath(root, rel) {
  if (typeof rel !== 'string' || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..') || rel.startsWith('/')) throw new Error(`Unsafe maintenance path: ${rel}`);
  const target = resolve(root, rel);
  if (relative(root, target).startsWith('..')) throw new Error('Path outside project');
  let current = root;
  for (const part of rel.split('/')) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${rel}`);
    // Also catches dangling symlinks.
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${rel}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return target;
}
export function readText(root, rel) {
  const path = safePath(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
export function readJson(root, rel) {
  const text = readText(root, rel);
  if (text === null) throw new Error(`Missing ${rel}`);
  return JSON.parse(text);
}
export function atomicWrite(root, rel, content) {
  const path = safePath(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, content, { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
  if (rel === 'run') chmodSync(path, 0o755);
}
export function fingerprints(root, paths) {
  return Object.fromEntries([...new Set(paths)].sort().map(p => [p, readText(root, p) === null ? null : digest(readText(root, p))]));
}
export function assertUnchanged(root, expected) {
  for (const [p, hash] of Object.entries(expected)) if (fingerprints(root, [p])[p] !== hash) throw new Error(`Project changed since preview: ${p}; preview again`);
}
/** Write a previewed change if the project still matches the preview.
 * Git is the history: there is no journal, rollback or recovery here. */
export function applyWrites(root, writes, expected, approved = false) {
  if (approved !== true) throw new Error('Explicit user approval required');
  assertUnchanged(root, expected);
  for (const p of Object.keys(writes)) safePath(root, p);
  for (const [p, content] of Object.entries(writes)) {
    if (content === null) rmSync(safePath(root, p), { force: true });
    else atomicWrite(root, p, content);
  }
}
