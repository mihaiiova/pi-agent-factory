import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { skillSourceKind } from '../skill-sources.mjs';
import { validateSystem } from '../validate.mjs';
import { parseRegistrySource, searchSkills, previewRegistrySkill, resolveRegistrySkill, installRegistrySkill, removeRegistrySkill, SKILLS_CLI } from '../registry-skills.mjs';
import { generateProject } from '../generate.mjs';
import { planChange, applyChange, withSkillPreviews } from '../maintenance.mjs';
import { loadYaml } from '../yaml-loader.mjs';

const SHA = '17772c7a80b7b8c7a47af30f648374cd8bd8adc5';
const SOURCE = `skills:acme/skills/skills/seo-audit@${SHA}`;
const SKILL_MD = '---\nname: seo-audit\ndescription: Audit SEO\n---\nAudit.\n';
const sha = (t) => createHash('sha256').update(t).digest('hex');

/** A fake GitHub + skills.sh: only the URLs the module is expected to request. */
function fakeFetcher(seen = []) {
  return async (url) => {
    seen.push(url);
    const docs = {
      [`https://skills.sh/api/search?q=seo&limit=10`]: { skills: [{ id: 'a/b/low', name: 'low', source: 'a/b', installs: 5 }, { id: 'acme/skills/seo-audit', name: 'seo-audit', source: 'acme/skills', installs: 900 }] },
      [`https://api.github.com/repos/acme/skills/commits/HEAD`]: { sha: SHA },
      [`https://api.github.com/repos/acme/skills/git/trees/${SHA}?recursive=1`]: { truncated: false, tree: [
        { type: 'blob', path: 'README.md' },
        { type: 'blob', path: 'skills/seo-audit/SKILL.md' },
        { type: 'blob', path: 'skills/seo-audit/references/checks.md' },
        { type: 'blob', path: 'skills/other/SKILL.md' },
      ] },
    };
    if (url === `https://raw.githubusercontent.com/acme/skills/${SHA}/skills/seo-audit/SKILL.md`) return { text: SKILL_MD };
    if (url === `https://raw.githubusercontent.com/acme/skills/${SHA}/skills/other/SKILL.md`) return { text: '---\nname: other\n---\n' };
    if (!(url in docs)) throw new Error(`unexpected fetch ${url}`);
    return { text: JSON.stringify(docs[url]) };
  };
}

/** A fake `npx skills` that behaves like `add --agent pi --copy` / `remove`. */
function fakeCli(calls, { content = SKILL_MD, ref = SHA } = {}) {
  return (cmd, args, opts) => {
    calls.push([cmd, ...args].join(' '));
    assert.equal(cmd, 'npx');
    assert.deepEqual(args.slice(0, 2), ['-y', SKILLS_CLI]);
    assert.ok(!args.includes('-g') && !args.includes('--global'), 'never global');
    const lockPath = join(opts.cwd, 'skills-lock.json');
    const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : { version: 1, skills: {} };
    if (args[2] === 'add') {
      const name = args[3].split('/').pop();
      mkdirSync(join(opts.cwd, '.agents/skills', name), { recursive: true });
      writeFileSync(join(opts.cwd, '.agents/skills', name, 'SKILL.md'), content);
      lock.skills[name] = { source: 'acme/skills', ref, sourceType: 'github' };
    } else {
      rmSync(join(opts.cwd, '.agents/skills', args[3]), { recursive: true, force: true });
      delete lock.skills[args[3]];
    }
    writeFileSync(lockPath, JSON.stringify(lock));
  };
}

test('skills: sources must pin one skill directory to a full commit', () => {
  assert.equal(skillSourceKind(SOURCE), 'registry');
  for (const bad of ['skills:acme/skills/seo@main', 'skills:acme/skills@' + SHA, `skills:acme/skills/../x@${SHA}`, `skills:acme/skills/a b/../c@${SHA}`]) {
    assert.equal(skillSourceKind(bad), null, bad);
  }
  assert.equal(parseRegistrySource(SOURCE).url, `https://github.com/acme/skills/tree/${SHA}/skills/seo-audit`);
  const doc = { schema: 1, name: 'x', orchestrator: { name: 'lead', model: 'p/m' }, skills: [{ name: 'seo-audit', source: SOURCE }], agents: [{ name: 'a', model: 'p/m', skills: ['seo-audit'] }] };
  assert.deepEqual(validateSystem(doc).errors, []);
});

test('search, preview and resolve read skills.sh and GitHub at the pinned commit', async () => {
  const seen = [];
  const fetcher = fakeFetcher(seen);
  const results = await searchSkills('seo', { fetcher });
  assert.deepEqual(results.map((r) => [r.name, r.installs, r.page]), [['seo-audit', 900, 'https://skills.sh/acme/skills/seo-audit'], ['low', 5, 'https://skills.sh/a/b/low']]);
  const preview = await previewRegistrySkill(SOURCE, { fetcher });
  assert.deepEqual(preview.files, ['SKILL.md', 'references/checks.md']);
  assert.equal(preview.skillMdSha256, sha(SKILL_MD));
  const resolved = await resolveRegistrySkill('acme/skills@seo-audit', { fetcher });
  assert.equal(resolved.source, SOURCE);
  await assert.rejects(resolveRegistrySkill('acme/skills@missing', { fetcher }), /No SKILL.md named "missing"/);
});

test('install runs the pinned skills CLI project-locally and verifies the result', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'registry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  installRegistrySkill(root, { name: 'seo-audit', source: SOURCE }, { expectedSha256: sha(SKILL_MD), run: fakeCli(calls) });
  assert.match(calls[0], new RegExp(`^npx -y ${SKILLS_CLI.replace('.', '\\.')} add https://github.com/acme/skills/tree/${SHA}/skills/seo-audit --agent pi --copy -y$`));
  assert.ok(existsSync(join(root, '.agents/skills/seo-audit/SKILL.md')));

  // Content other than what was previewed is removed again.
  assert.throws(() => installRegistrySkill(root, { name: 'seo-audit', source: SOURCE }, { expectedSha256: sha(SKILL_MD), run: fakeCli(calls, { content: 'changed' }) }), /differs from the previewed/);
  assert.ok(!existsSync(join(root, '.agents/skills/seo-audit')));
  // A lock that does not record the pinned commit is refused too.
  assert.throws(() => installRegistrySkill(root, { name: 'seo-audit', source: SOURCE }, { run: fakeCli(calls, { ref: 'main' }) }), /does not record commit/);
  // A skill whose own name differs is reported, not silently kept.
  assert.throws(() => installRegistrySkill(root, { name: 'renamed', source: SOURCE }, { run: fakeCli(calls) }), /nothing was installed at \.agents\/skills\/renamed/);
  removeRegistrySkill(root, 'seo-audit', { run: fakeCli(calls) });
});

test('maintenance previews skill contents, installs on apply and removes on undeclare', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'registry-maint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const model = { schema: 1, name: 'registry-test', orchestrator: { name: 'lead', model: 'p/m', tools: ['read'] }, agents: [{ name: 'auditor', model: 'p/m', tools: ['read'] }] };
  const piPackages = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).pi.packages;
  for (const f of generateProject(model, {}, { piPackages }).files) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.content);
  }
  writeFileSync(join(root, '.pi/system.yaml'), loadYaml().stringify(model));
  const calls = [];
  const plan = await withSkillPreviews(planChange(root, [
    { op: 'add', target: 'skill', name: 'seo-audit', value: { source: SOURCE } },
    { op: 'update', target: 'agent', name: 'auditor', value: { skills: ['seo-audit'] } },
  ]), { fetcher: fakeFetcher() });
  assert.deepEqual(plan.preview.skills.install, [{ name: 'seo-audit', source: SOURCE, into: '.agents/skills/seo-audit/' }]);
  assert.equal(plan.preview.skills.contents[0].skillMd, SKILL_MD);
  assert.throws(() => applyChange(root, plan, false, { run: fakeCli(calls) }), /approval/);
  assert.equal(calls.length, 0);
  applyChange(root, plan, true, { run: fakeCli(calls) });
  assert.ok(existsSync(join(root, '.agents/skills/seo-audit/SKILL.md')));
  assert.match(readFileSync(join(root, '.pi/agents/auditor.md'), 'utf8'), /skills: \[seo-audit\]/);

  const removal = planChange(root, [
    { op: 'update', target: 'agent', name: 'auditor', value: { skills: [] } },
    { op: 'remove', target: 'skill', name: 'seo-audit' },
  ]);
  assert.deepEqual(removal.preview.skills.remove, ['.agents/skills/seo-audit/']);
  applyChange(root, removal, true, { run: fakeCli(calls) });
  assert.ok(!existsSync(join(root, '.agents/skills/seo-audit')));
  assert.match(calls.at(-1), / remove seo-audit --agent pi -y$/);
});
