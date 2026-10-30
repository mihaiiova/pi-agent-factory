import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateSystem } from '../validate.mjs';
import { generateProject } from '../generate.mjs';
import { effectiveCapabilities, checkCapabilities } from '../capabilities.mjs';
import { launchCheck } from '../launch-check.mjs';
import { checkAgent } from '../check.mjs';
import { configurationAdvisories } from '../advisories.mjs';

const model = { schema: 1, name: 'coding', orchestrator: { name: 'lead', model: 'p/m', tools: ['read'], projectContext: ['AGENTS.md', "docs/team's guide.md", 'missing.md', 'outside.md'] } };
const packages = ['npm:pi-subagents@0.83.1'];

test('project context rejects traversal and absolute or nonportable paths', () => {
  for (const path of ['/tmp/a', '../secret', 'a/../b', 'C:/a', 'a\\b', '', './a', '--', 'a\nfile']) {
    assert.equal(validateSystem({ ...model, orchestrator: { ...model.orchestrator, projectContext: [path] } }).ok, false, path);
  }
  assert.equal(validateSystem(model).ok, true);
});

test('context adds edit to effective tools and generated settings, without adding it for an empty list', () => {
  const { files } = generateProject(model, {}, { piPackages: packages });
  const settings = JSON.parse(files.find(f => f.path === '.pi/settings.json').content);
  assert.deepEqual(settings.defaultTools, ['read', 'edit']);
  assert.deepEqual(effectiveCapabilities(model, { piPackages: packages }).orchestratorTools, ['edit', 'read']);
  assert.equal(checkCapabilities(model, { settings, mcp: {} }, { piPackages: packages }).ok, true);
  assert.match(files.find(f => f.path === '.pi/CAPABILITIES.md').content, /Built-in tools:\*\* read, edit/);
  const empty = { ...model, orchestrator: { ...model.orchestrator, projectContext: [] } };
  assert.deepEqual(effectiveCapabilities(empty, { piPackages: packages }).orchestratorTools, ['read']);
});

test('check and configuration advisories expose implied edit access', t => {
  const root = mkdtempSync(join(tmpdir(), 'forge-context-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const simple = { ...model, orchestrator: { ...model.orchestrator, projectContext: ['AGENTS.md'] } };
  for (const file of generateProject(simple, {}, { piPackages: packages }).files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.content);
  }
  mkdirSync(join(root, '.pi'), { recursive: true });
  writeFileSync(join(root, '.pi/system.yaml'), 'schema: 1\nname: coding\norchestrator:\n  name: lead\n  model: p/m\n  tools: [read]\n  projectContext: [AGENTS.md]\n');
  writeFileSync(join(root, 'AGENTS.md'), 'instructions');
  assert.ok(checkAgent(root).capabilities.some(c => c.agent === 'lead' && c.name === 'edit'));
  assert.ok(configurationAdvisories(simple).some(s => s.includes('edit for any accessible file')));
});

test('launcher appends project files in order, skips missing and external symlinks, and reports them', t => {
  const root = mkdtempSync(join(tmpdir(), 'forge-context-'));
  const outside = mkdtempSync(join(tmpdir(), 'forge-context-outside-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  mkdirSync(join(root, '.pi')); mkdirSync(join(root, 'bin')); mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, '.pi/system.yaml'), 'schema: 1\n');
  writeFileSync(join(root, '.pi/APPEND_SYSTEM.md'), 'prompt');
  writeFileSync(join(root, '.pi/CAPABILITIES.md'), 'capabilities');
  writeFileSync(join(root, 'AGENTS.md'), 'instructions');
  writeFileSync(join(root, "docs/team's guide.md"), 'guide');
  writeFileSync(join(outside, 'secret'), 'outside');
  symlinkSync(join(outside, 'secret'), join(root, 'outside.md'));
  writeFileSync(join(root, 'bin/pi'), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n', { mode: 0o755 });
  const { files } = generateProject(model, {}, { piPackages: packages });
  writeFileSync(join(root, 'run'), files.find(f => f.path === 'run').content, { mode: 0o755 });
  const run = spawnSync(join(root, 'run'), [], { encoding: 'utf8', env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH } });
  assert.equal(run.status, 0, run.stderr);
  const args = JSON.parse(run.stdout);
  const prompts = args.flatMap((arg, i) => arg === '--append-system-prompt' ? [args[i + 1]] : []);
  assert.deepEqual(prompts, ['.pi/APPEND_SYSTEM.md', '.pi/CAPABILITIES.md', 'AGENTS.md', "docs/team's guide.md"]);
  const problems = launchCheck(root, model).problems.map(p => p.problem);
  assert.ok(problems.some(p => p.includes('missing.md')));
  assert.ok(problems.some(p => p.includes('outside.md')));
});
