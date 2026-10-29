import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const forge = resolve(import.meta.dirname, '../forge.mjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'forge-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi')); mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, '.pi/system.yaml'), `schema: 1
name: workflow-test
orchestrator:
  name: lead
  model: faux/faux
  tools: [read, subagent]
skills:
  - name: draft
    description: Draft a report
workflows:
  - name: report
    skill: draft
    entry: lead
    inputs: [data/]
    outputs: [data/]
`);
  const generated = spawnSync(process.execPath, [forge, 'generate', root], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'The report is ready.'}]}}));
`, { mode: 0o755 });
  return { root, env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` } };
}

test('declared workflow returns its final answer in a machine-readable result', t => {
  const { root, env } = fixture(t);
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report', '--input', 'topic=hello world'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(summary.status, 'ok');
  assert.equal(summary.answer, 'The report is ready.');
  assert.equal(summary.workflow, 'report');
});

test('an approval block ends the workflow promptly with the named call', t => {
  const { root, env } = fixture(t);
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
require('fs').writeFileSync(process.env.FORGE_APPROVAL_FILE, 'seo: run_audit');
setTimeout(() => {}, 30000);
`, { mode: 0o755 });
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 3, result.stderr);
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(summary.status, 'blocked');
  assert.match(summary.message, /seo: run_audit/);
});

test('timeout terminates the workflow and its child processes', t => {
  const { root, env } = fixture(t);
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
const child = require('child_process').spawn('sleep', ['30'], {stdio:'ignore'});
require('fs').writeFileSync(${JSON.stringify(join(root, 'child-pid'))}, String(child.pid));
setTimeout(() => {}, 30000);
`, { mode: 0o755 });
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report', '--timeout', '1s'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 4, result.stderr);
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(summary.status, 'timeout');
  const pid = Number(readFileSync(join(root, 'child-pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});
