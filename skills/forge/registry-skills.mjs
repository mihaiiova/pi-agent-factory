/**
 * registry-skills — skills from the open Agent Skills ecosystem (skills.sh).
 *
 * Built on the ecosystem's own primitives instead of reimplementing them:
 * search uses the skills.sh API (the backend of `npx skills find`), and
 * installation runs the pinned `skills` CLI with `--agent pi`, which copies the
 * skill into the project's `.agents/skills/<name>/` and records it in
 * `skills-lock.json`. Installs are always project-local, never global (`-g`).
 *
 * A declaration pins one skill directory to a commit:
 *   source: skills:<owner>/<repo>/<path-to-skill-dir>@<40-hex commit>
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fetchDocument } from './maintenance-fetch.mjs';
import { REGISTRY_SOURCE_RE } from './skill-sources.mjs';

/** The `skills` CLI release the Forge installs with. */
export const SKILLS_CLI = 'skills@1.7.4';
const INSTALL_TIMEOUT = 180000;

export function parseRegistrySource(source) {
  const match = typeof source === 'string' ? source.match(REGISTRY_SOURCE_RE) : null;
  if (!match || match[3].split('/').some((seg) => seg === '..' || seg === '.')) return null;
  const [, owner, repo, path, ref] = match;
  return { owner, repo, path, ref, url: `https://github.com/${owner}/${repo}/tree/${ref}/${path}` };
}

export function registrySkills(model) {
  return (Array.isArray(model?.skills) ? model.skills : [])
    .filter((skill) => skill && typeof skill.name === 'string' && parseRegistrySource(skill.source));
}

export const installedDir = (name) => `.agents/skills/${name}`;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Search skills.sh. Results are untrusted discovery data, sorted by installs. */
export async function searchSkills(query, { fetcher = fetchDocument, limit = 10 } = {}) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const doc = await fetcher(`https://skills.sh/api/search?${params}`);
  const data = JSON.parse(doc.text);
  return (Array.isArray(data?.skills) ? data.skills : [])
    .filter((s) => typeof s?.id === 'string')
    .map((s) => ({ name: String(s.name ?? s.skillId ?? ''), source: String(s.source ?? ''), installs: Number(s.installs) || 0, page: `https://skills.sh/${s.id}` }))
    .sort((a, b) => b.installs - a.installs);
}

/**
 * Read what a pinned skill would install, from GitHub at that exact commit:
 * its file list and SKILL.md text (plus its hash, checked after install).
 */
export async function previewRegistrySkill(source, { fetcher = fetchDocument } = {}) {
  const parsed = parseRegistrySource(source);
  if (!parsed) throw new Error(`Not a pinned skills: source: ${source}`);
  const { owner, repo, path, ref } = parsed;
  const skillMd = (await fetcher(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}/SKILL.md`)).text;
  let files = [];
  let fileListComplete = false;
  try {
    const tree = JSON.parse((await fetcher(`https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`)).text);
    files = (tree.tree ?? []).filter((e) => e.type === 'blob' && e.path.startsWith(`${path}/`)).map((e) => e.path.slice(path.length + 1));
    fileListComplete = tree.truncated !== true;
  } catch { /* the file list is informational; SKILL.md is what gets verified */ }
  return { source, page: parsed.url, ref, files, fileListComplete, skillMd, skillMdSha256: sha256(skillMd) };
}

/**
 * Pin a search result ("owner/repo" plus skill name, or "owner/repo@name") to
 * a declaration: the repository's current commit and the directory whose
 * SKILL.md declares that name. Returns the `skills:` source and its preview.
 */
export async function resolveRegistrySkill(spec, { fetcher = fetchDocument } = {}) {
  const match = String(spec).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@([A-Za-z0-9_.: -]+)$/);
  if (!match) throw new Error('Expected owner/repo@skill-name (as listed by skills.sh)');
  const [, owner, repo, name] = match;
  const commit = JSON.parse((await fetcher(`https://api.github.com/repos/${owner}/${repo}/commits/HEAD`)).text);
  const ref = commit?.sha;
  if (!/^[0-9a-f]{40}$/.test(ref ?? '')) throw new Error(`Could not read the current commit of ${owner}/${repo}`);
  const tree = JSON.parse((await fetcher(`https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`)).text);
  const dirs = (tree.tree ?? []).filter((e) => e.type === 'blob' && /(^|\/)SKILL\.md$/.test(e.path)).map((e) => e.path.replace(/\/?SKILL\.md$/, ''));
  const byBasename = dirs.filter((d) => d.split('/').pop() === name);
  // Directories named after the skill first; a few others in case the
  // directory name differs from the skill's declared name.
  const candidates = [...byBasename, ...dirs.filter((d) => d && !byBasename.includes(d)).slice(0, 10)];
  for (const dir of candidates) {
    const source = `skills:${owner}/${repo}/${dir}@${ref}`;
    const preview = await previewRegistrySkill(source, { fetcher });
    if (preview.skillMd.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1] === name) return { name, source, preview };
  }
  throw new Error(`No SKILL.md named "${name}" found in ${owner}/${repo} at ${ref.slice(0, 12)}`);
}

function runCli(root, args, run) {
  return run('npx', ['-y', SKILLS_CLI, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: INSTALL_TIMEOUT, env: process.env });
}

function lockEntry(root, name) {
  try { return JSON.parse(readFileSync(join(root, 'skills-lock.json'), 'utf8'))?.skills?.[name] ?? null; } catch { return null; }
}

/**
 * Install one pinned skill into the project with the skills CLI, then verify
 * the result: the expected directory, the pinned commit in skills-lock.json,
 * and (when previewed) the exact SKILL.md the user saw. A failed check removes
 * the installed copy again.
 */
export function installRegistrySkill(root, skill, { expectedSha256, run = execFileSync } = {}) {
  const parsed = parseRegistrySource(skill.source);
  if (!parsed) throw new Error(`skill "${skill.name}": not a pinned skills: source`);
  try {
    runCli(root, ['add', parsed.url, '--agent', 'pi', '--copy', '-y'], run);
  } catch (error) {
    throw new Error(`skills CLI could not install "${skill.name}" from ${parsed.url}: ${String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ')}`);
  }
  const file = join(root, installedDir(skill.name), 'SKILL.md');
  const problem = !existsSync(file) ? `nothing was installed at ${installedDir(skill.name)}/ (the skill's own name may differ; declare it under that name)`
    : lockEntry(root, skill.name)?.ref !== parsed.ref ? `skills-lock.json does not record commit ${parsed.ref}`
    : expectedSha256 && sha256(readFileSync(file, 'utf8')) !== expectedSha256 ? 'the installed SKILL.md differs from the previewed one'
    : null;
  if (problem) {
    if (existsSync(file)) removeRegistrySkill(root, skill.name, { run });
    throw new Error(`skill "${skill.name}": ${problem}; nothing kept`);
  }
}

export function removeRegistrySkill(root, name, { run = execFileSync } = {}) {
  try {
    runCli(root, ['remove', name, '--agent', 'pi', '-y'], run);
  } catch { /* fall back to removing the copy directly */ }
  rmSync(join(root, installedDir(name)), { recursive: true, force: true });
}
