import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '../../..');

test('a live model completes a declared workflow through ./run', { skip: process.env.RUN_FACTORY_LIVE_TESTS !== '1', timeout: 180000 }, t => {
  const model = process.env.FORGE_LIVE_MODEL;
  assert.ok(model && model.includes('/'), 'Set FORGE_LIVE_MODEL=provider/model and the provider API key for the isolated project');
  const root = mkdtempSync(join(tmpdir(), 'forge-workflow-live-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi'));
  writeFileSync(join(root, '.pi/system.yaml'), `schema: 1
name: live-workflow
orchestrator:
  name: lead
  model: ${JSON.stringify(model)}
  tools: [read]
  prompt: Answer the workflow request directly.
skills:
  - name: hello
    description: Return a short greeting
    body: Return exactly the text "Hello from Forge". Do not call any tools.
workflows:
  - name: greeting
    skill: hello
    entry: lead
`);
  const generated = spawnSync(process.execPath, [join(repo, 'skills/forge/forge.mjs'), 'generate', root], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const settingsPath = join(root, '.pi/settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.packages = [repo];
  writeFileSync(settingsPath, JSON.stringify(settings));
  const env = { ...process.env };
  delete env.PI_SUBAGENT_CHILD;
  const result = spawnSync(join(root, 'run'), ['--workflow', 'greeting', '--timeout', '2m'], { env, encoding: 'utf8', timeout: 150000 });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(summary.status, 'ok');
  assert.match(summary.answer, /Hello from Forge/i);
});
