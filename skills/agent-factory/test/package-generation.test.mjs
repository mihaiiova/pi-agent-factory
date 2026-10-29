import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rebuildPlan } from '../maintenance.mjs';

const repo = resolve(import.meta.dirname, '../../..');
test('CLI generation installs no copied Factory tooling', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi'));
  copyFileSync(join(import.meta.dirname, 'fixtures/generate/minimal/.pi/system.yaml'), join(root, '.pi/system.yaml'));
  execFileSync(process.execPath, [join(repo, 'skills/agent-factory/factory.mjs'), 'generate', root]);
  const settings = JSON.parse(readFileSync(join(root, '.pi/settings.json'), 'utf8'));
  assert.ok(settings.packages.includes('git:github.com/mihaiiova/pi-agent-factory@v0.19.0'));
  assert.deepEqual(readdirSync(join(root, '.factory')).sort(), ['build.json', 'capabilities.json']);
});

test('CLI no longer offers bootstrap or recovery commands', () => {
  const output = execFileSync(process.execPath, [join(repo, 'skills/agent-factory/factory.mjs'), '--help'], { encoding: 'utf8' });
  assert.doesNotMatch(output, /bootstrap-update|recover/);
  for (const command of ['bootstrap-update', 'recover']) {
    assert.throws(() => execFileSync(process.execPath, [join(repo, 'skills/agent-factory/factory.mjs'), command, '.'], { stdio: 'pipe' }));
  }
});

test('rebuild identifies the package version used for generated files', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-package-rebuild-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi'));
  copyFileSync(join(import.meta.dirname, 'fixtures/generate/minimal/.pi/system.yaml'), join(root, '.pi/system.yaml'));
  execFileSync(process.execPath, [join(repo, 'skills/agent-factory/factory.mjs'), 'generate', root]);
  const plan = rebuildPlan(root);
  assert.equal(plan.rebuild.version, '0.19.0');
  assert.equal(plan.rebuild.unchanged, true);
});
