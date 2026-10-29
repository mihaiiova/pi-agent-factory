import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { generateProject } from '../generate.mjs';
import { launchCheck } from '../launch-check.mjs';

const SHA = '17772c7a80b7b8c7a47af30f648374cd8bd8adc5';
const model = {
  schema: 1, name: 'launch', orchestrator: { name: 'lead', model: 'p/m' },
  agents: [
    { name: 'seo', model: 'p/m', tools: ['read', 'mcp:seo/audit', 'web_search'], skills: ['audit'] },
    { name: 'all', model: 'p/m', tools: ['mcp:seo'] },
    { name: 'gh', model: 'p/m', tools: ['mcp:github'] },
    { name: 'plain', model: 'p/m', tools: ['read'] },
  ],
  skills: [{ name: 'audit', source: `skills:acme/skills/audit@${SHA}` }],
  integrations: { mcp: [{ name: 'seo', config: { url: 'http://x', excludeTools: ['delete_*'] } }, { name: 'github', config: { url: 'https://y' } }] },
};

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'launch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const f of generateProject(model, {}).files) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.content);
  }
  return root;
}
const problems = (root, opts) => launchCheck(root, model, opts).problems.map((p) => `${p.agent}: ${p.problem}`);

test('launch check reports missing MCP tools, extension tools, skills and background setup', (t) => {
  const root = project(t);
  const mcpTools = [{ name: 'mcp__seo__delete_all', exposure: 'hidden' }, { name: 'mcp__seo__list', exposure: 'deferred' }];
  const found = problems(root, { registeredTools: ['read'], mcpTools });
  assert.ok(found.includes('seo: mcp:seo/audit: "seo" does not offer "audit"'));
  assert.ok(found.includes('seo: web_search: no loaded extension registers this tool'));
  assert.ok(found.includes('seo: skill "audit" is not installed at .agents/skills/audit/'));
  assert.ok(found.includes('gh: mcp:github: "github" has not connected or offers no tools; /mcp shows why'));
  assert.ok(!found.some((p) => p.startsWith('all:')), 'list is exposed');
  assert.ok(!found.some((p) => p.startsWith('plain:')));
  assert.ok(!found.some((p) => p.includes('background')), 'generated agents are set up for background launch');
  assert.ok(!problems(root, { registeredTools: ['read'] }).some((p) => p.includes('"github"')), 'servers connect after session start; without mcpTools they are not checked');

  // A hidden tool can't be selected.
  const hidden = launchCheck(root, { ...model, agents: [{ name: 'del', model: 'p/m', tools: ['mcp:seo/delete_all'] }] }, { mcpTools }).problems;
  assert.ok(hidden.some((p) => p.problem === 'mcp:seo/delete_all: "delete_all" is hidden by includeTools, excludeTools or a hide policy'));

  // Everything present: no problems.
  mkdirSync(join(root, '.agents/skills/audit'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/audit/SKILL.md'), '---\nname: audit\n---\n');
  assert.deepEqual(problems(root, { registeredTools: ['web_search'], mcpTools: [{ name: 'mcp__seo__audit', exposure: 'deferred' }, { name: 'mcp__github__issue_read', exposure: 'deferred' }] }), []);

  // A project generated before background launch is told to reconcile.
  rmSync(join(root, '.forge/pi-home/extensions'), { recursive: true });
  assert.ok(problems(root, {}).some((p) => p.startsWith('seo: uses MCP or extension tools but is not set to run in the background')));
});

test('launch check warns about unignored secrets in a git work tree', t => {
  const root = project(t);
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  const found = problems(root, {});
  assert.ok(found.some(p => p.includes('.env') && p.includes('not ignored')));
  assert.ok(found.some(p => p.includes('.forge/') && p.includes('not ignored')));
  writeFileSync(join(root, '.gitignore'), '.env\n.forge/\n');
  assert.ok(!problems(root, {}).some(p => p.includes('not ignored')));
});

test('launch check respects git negation and skips unavailable git', t => {
  const root = project(t);
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, '.gitignore'), '.env\n.forge/\n!.env\n!.forge/\n');
  assert.equal(problems(root, {}).filter(p => p.includes('not ignored')).length, 2);
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.ok(!problems(root, {}).some(p => p.includes('not ignored')));
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test('launch check reports missing orchestrator extension tools', t => {
  const root = project(t);
  const configured = { ...model, orchestrator: { ...model.orchestrator, tools: ['read', 'missing_extension'] }, agents: [] };
  assert.ok(launchCheck(root, configured, { registeredTools: ['read'] }).problems.some(p => p.agent === 'lead' && p.problem.includes('missing_extension')));
});

test('capability report distinguishes connected and cached MCP evidence', async t => {
  const { checkAgent } = await import('../check.mjs');
  const { loadYaml } = await import('../yaml-loader.mjs');
  const root = project(t);
  writeFileSync(join(root, '.pi/system.yaml'), loadYaml().stringify(model));
  const connected = [{ name: 'seo', state: 'connected', tools: ['audit'] }, { name: 'github', state: 'connected', tools: ['issue_read'] }];
  const live = checkAgent(root, { mcpServers: connected });
  assert.ok(live.capabilities.some(c => c.agent === 'seo' && c.name === 'mcp:seo/audit' && c.status === 'verified now'));
  const cached = checkAgent(root);
  assert.ok(cached.capabilities.some(c => c.agent === 'seo' && c.name === 'mcp:seo/audit' && c.status.startsWith('last seen ')));
});
