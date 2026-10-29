/** Local maintenance IO: safe relative paths, fingerprints, recoverable writes. */
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
/** Journal persists before the first write; partial application rolls back.
 * No author data is discarded: crash recovery refuses externally changed files. */
export function recoverTransaction(root) {
  const journal = readText(root, '.factory/transaction.json');
  if (!journal) return false;
  const { before, after } = JSON.parse(journal);
  for (const p of Object.keys(before)) {
    if (!(p.startsWith('.pi/') || ['run', 'README.md', '.gitignore', '.env.example', 'data/knowledge/.gitkeep', '.factory/build.json', '.factory/installation.json', '.factory/previous-installation.json', '.factory/capabilities.json'].includes(p))) throw new Error(`Unexpected recovery path: ${p}`);
    if (before[p] !== null && typeof before[p] !== 'string') throw new Error(`Invalid recovery content: ${p}`);
    const current = readText(root, p);
    if (current !== before[p] && current !== after[p]) throw new Error(`Recovery conflict: ${p}; retain .factory/transaction.json and resolve manually`);
  }
  for (const [p, content] of Object.entries(before)) {
    if (content === null) rmSync(safePath(root, p), { force: true });
    else atomicWrite(root, p, content);
  }
  rmSync(safePath(root, '.factory/transaction.json'));
  return true;
}
function assertStaleLock(root) {
  const lock = readText(root, '.factory/lock');
  if (lock === null) return;
  const pid = Number(lock);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Unknown maintenance lock owner; inspect .factory/lock manually');
  try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return; throw e; }
  throw new Error(`Maintenance process ${pid} is still running; do not recover an active transaction`);
}
export function recoveryPlan(root) {
  assertStaleLock(root);
  const journal = readText(root, '.factory/transaction.json');
  const paths = journal ? Object.keys(JSON.parse(journal).before) : [];
  return { kind: 'recovery', expected: fingerprints(root, ['.factory/lock', '.factory/transaction.json']), preview: { paths, staleLock: readText(root, '.factory/lock') !== null, warning: 'Restore pre-transaction contents only if current files still match the journal before/after states. Later user edits cause a conflict, never data loss.' } };
}
export function applyRecovery(root, plan, approved = false) {
  if (approved !== true) throw new Error('Explicit user approval required');
  if (plan?.kind !== 'recovery') throw new Error('No recovery proposal');
  assertUnchanged(root, plan.expected);
  assertStaleLock(root);
  const lock = safePath(root, '.factory/lock');
  rmSync(lock, { force: true });
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try { recoverTransaction(root); } finally { rmSync(lock, { force: true }); }
  return 'Maintenance transaction recovered. Restart ./run and preview your change again.';
}
export function transact(root, writes, expected, approved = false) {
  if (approved !== true) throw new Error('Explicit user approval required');
  safePath(root, '.factory/lock');
  mkdirSync(join(root, '.factory'), { recursive: true });
  const lock = join(root, '.factory/lock');
  writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    if (readText(root, '.factory/transaction.json')) throw new Error('Interrupted maintenance transaction; recover it before applying');
    assertUnchanged(root, expected);
    const before = Object.fromEntries(Object.keys(writes).map(p => [p, readText(root, p)]));
    atomicWrite(root, '.factory/transaction.json', json({ before, after: writes }));
    try {
      for (const [p, content] of Object.entries(writes)) {
        if (content === null) rmSync(safePath(root, p), { force: true });
        else atomicWrite(root, p, content);
      }
      rmSync(safePath(root, '.factory/transaction.json'));
    } catch (e) { recoverTransaction(root); throw e; }
  } finally { rmSync(lock, { force: true }); }
}
