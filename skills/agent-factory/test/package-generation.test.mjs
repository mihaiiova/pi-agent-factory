import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

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
