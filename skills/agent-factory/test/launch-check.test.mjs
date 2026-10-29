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
  writeFileSync(join(root, '.factory/pi-home/mcp-cache.json'), JSON.stringify({ servers: { seo: { tools: [{ name: 'delete_all' }, { name: 'list' }] } } }));
  const found = problems(root, { registeredTools: ['read', 'mcp'] });
  assert.ok(found.includes('seo: mcp:seo/audit: "seo" does not expose "audit" (after includeTools/excludeTools)'));
  assert.ok(found.includes('seo: web_search: no loaded extension registers this tool'));
  assert.ok(found.includes('seo: skill "audit" is not installed at .agents/skills/audit/'));
  assert.ok(found.some((p) => p.startsWith('gh: mcp:github: "github" has never connected')));
  assert.ok(!found.some((p) => p.startsWith('all:')), 'list is exposed');
  assert.ok(!found.some((p) => p.startsWith('plain:')));
  assert.ok(!found.some((p) => p.includes('background')), 'generated agents are set up for background launch');

  // Everything present: no problems.
  writeFileSync(join(root, '.factory/pi-home/mcp-cache.json'), JSON.stringify({ servers: { seo: { tools: [{ name: 'audit' }] }, github: { tools: [{ name: 'issue_read' }] } } }));
  mkdirSync(join(root, '.agents/skills/audit'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/audit/SKILL.md'), '---\nname: audit\n---\n');
  assert.deepEqual(problems(root, { registeredTools: ['web_search'] }), []);

  // A project generated before background launch is told to reconcile.
  rmSync(join(root, '.factory/pi-home/extensions'), { recursive: true });
  assert.ok(problems(root, {}).some((p) => p.startsWith('seo: uses MCP or extension tools but is not set to run in the background')));
});

test('launch check warns about unignored secrets in a git work tree', t => {
  const root = project(t);
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  const found = problems(root, {});
  assert.ok(found.some(p => p.includes('.env') && p.includes('not ignored')));
  assert.ok(found.some(p => p.includes('.factory/') && p.includes('not ignored')));
  writeFileSync(join(root, '.gitignore'), '.env\n.factory/\n');
  assert.ok(!problems(root, {}).some(p => p.includes('not ignored')));
});
