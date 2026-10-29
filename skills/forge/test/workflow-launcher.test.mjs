import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const forge = resolve(import.meta.dirname, '../forge.mjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'forge-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi')); mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(root, '.pi/system.yaml'), `schema: 1
name: workflow-test
orchestrator:
  name: lead
  model: faux/faux
  tools: [read, subagent]
agents:
  - name: researcher
    description: Research
    model: faux/faux
    tools: [read]
    prompt: Research.
skills:
  - name: draft
    description: Draft a report
workflows:
  - name: report
    skill: draft
    entry: lead
    inputs: [data/]
    outputs: [data/]
  - name: research
    entry: researcher
    inputs: [notes/]
    outputs: [results/]
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

test('workflow locking is default and concurrency is explicit opt-in', async t => {
  const { root, env } = fixture(t);
  const marker = join(root, 'started');
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(marker)}, 'started');
setTimeout(() => console.log(JSON.stringify({type:'message_end', message:{role:'assistant', stopReason:'stop', content:[{type:'text',text:'done'}]}})), 1500);
`, { mode: 0o755 });
  const { spawn } = await import('node:child_process');
  const first = spawn(join(root, 'run'), ['--workflow', 'report'], { env, stdio: 'ignore' });
  t.after(() => { try { first.kill(); } catch {} });
  for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(existsSync(marker));
  const second = spawnSync(join(root, 'run'), ['--workflow', 'report'], { env, encoding: 'utf8', timeout: 4000 });
  assert.equal(second.status, 2);
  assert.match(second.stdout, /already running/);
  const parallel = spawnSync(join(root, 'run'), ['--workflow', 'report', '--allow-concurrent'], { env, encoding: 'utf8', timeout: 4000 });
  assert.equal(parallel.status, 0, parallel.stderr);
});

test('tool and agent failures cannot produce a successful workflow result', t => {
  const { root, env } = fixture(t);
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
console.log(JSON.stringify({type:'tool_execution_end',toolName:'read',isError:true}));
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'Failed to read.'}]}}));
`, { mode: 0o755 });
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report'], { env, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).status, 'error');
});

test('workflow validates options and input key-value pairs before invoking Pi', t => {
  const { root, env } = fixture(t);
  for (const args of [ ['--workflow', 'missing'], ['--workflow', 'report', '--input', 'bad'], ['--workflow', 'report', '--bogus'], ['--workflow', 'report', '--timeout', '0s'] ]) {
    const result = spawnSync(join(root, 'run'), args, { env, encoding: 'utf8' });
    assert.equal(result.status, 2, `${args}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout.trim()).status, 'configuration_error');
  }
});

test('skill-less specialist workflows pass boundaries, inputs, and run metadata to Pi', t => {
  const { root, env } = fixture(t);
  const capture = join(root, 'invocation');
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2), workflow:process.env.FORGE_WORKFLOW, trigger:process.env.FORGE_TRIGGER, runId:process.env.FORGE_RUN_ID}));
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'done'}]}}));
`, { mode: 0o755 });
  const result = spawnSync(join(root, 'run'), ['--workflow', 'research', '--input', 'topic=one=two'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(readFileSync(capture, 'utf8'));
  assert.equal(call.workflow, 'research');
  assert.equal(call.trigger, 'headless');
  assert.match(call.runId, /^[0-9a-f-]{36}$/);
  const prompt = call.args.at(-1);
  assert.match(prompt, /researcher/);
  assert.match(prompt, /notes\//);
  assert.match(prompt, /results\//);
  assert.match(prompt, /one=two/);
});

test('timeout stops only invocation-owned detached subagent runs', async t => {
  const { root, env } = fixture(t);
  const { spawn } = await import('node:child_process');
  const unrelated = spawn('sleep', ['30'], { stdio: 'ignore' });
  t.after(() => unrelated.kill());
  const unrelatedDir = join(root, 'unrelated', 'async-subagent-runs', 'other');
  mkdirSync(unrelatedDir, { recursive: true });
  writeFileSync(join(unrelatedDir, 'status.json'), JSON.stringify({ runId: 'other', state: 'running', pid: unrelated.pid }));
  env.PI_SUBAGENTS_TEMP_ROOT = join(root, 'unrelated');
  const marker = join(root, 'detached-pid');
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
const {spawn}=require('child_process');
const fs=require('fs'), path=require('path');
const dir=path.join(process.env.PI_SUBAGENTS_TEMP_ROOT,'async-subagent-runs','own');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({runId:'own',state:'running'}));
const program = ${JSON.stringify(`const fs=require('fs'),path=require('path'); const dir=process.argv[1]; setInterval(()=>{const d=path.join(dir,'control/stop-requests'); if(fs.existsSync(d)&&fs.readdirSync(d).length){fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({runId:'own',state:'stopped'}));process.exit(0)}},20);`)};
const child=spawn(process.execPath,['-e',program,dir],{detached:true,stdio:'ignore'}); child.unref();
fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));
setTimeout(()=>{},30000);
`, { mode: 0o755 });
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report', '--timeout', '1s'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 4, result.stderr);
  const pid = Number(readFileSync(marker, 'utf8'));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  assert.equal(existsSync(join(unrelatedDir, 'control', 'stop-requests')), false);
});

test('timeout stops a real pi-subagents background run', { skip: !process.env.FORGE_SUBAGENTS_PACKAGE, timeout: 30000 }, async t => {
  const { root } = fixture(t);
  const { realpathSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const pi = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim();
  const bin = dirname(realpathSync(pi));
  const ai = pathToFileURL(resolve(bin, '../../node_modules/@earendil-works/pi-ai/dist/index.js')).href;
  const repo = resolve(import.meta.dirname, '../../..');
  const provider = join(root, '.pi/provider.mjs');
  writeFileSync(provider, `import { createFauxCore, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(ai)};
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export default pi => {
 pi.events.on('subagent:async-started', event => { const capture=()=>{ try { const status=JSON.parse(readFileSync(join(event.asyncDir,'status.json'),'utf8')); writeFileSync(${JSON.stringify(join(root, 'actual-subagent.json'))},JSON.stringify({event,status,at:Date.now()})); } catch(e) { writeFileSync(${JSON.stringify(join(root, 'actual-subagent-error'))},String(e)); } }; capture(); setInterval(capture,50).unref(); });
 const faux=createFauxCore({api:'faux-test',provider:'faux',models:[{id:'faux'}]});
 faux.setResponses(process.env.PI_SUBAGENT_CHILD === '1'
  ? [fauxAssistantMessage([fauxToolCall('bash',{command:'sleep 30'})]), fauxAssistantMessage('done')]
  : [fauxAssistantMessage([fauxToolCall('subagent',{agent:'researcher',task:'Wait',async:true})]), fauxAssistantMessage('done')]);
 pi.registerProvider('faux',{baseUrl:'http://localhost',apiKey:'test',api:'faux-test',streamSimple:faux.streamSimple,models:[{type:'chat',id:'faux',name:'faux',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}]});
};`);
  const settings = JSON.parse(readFileSync(join(root, '.pi/settings.json'), 'utf8'));
  settings.packages = [repo, process.env.FORGE_SUBAGENTS_PACKAGE];
  settings.extensions = [provider];
  settings.defaultProvider = 'faux'; settings.defaultModel = 'faux';
  writeFileSync(join(root, '.pi/settings.json'), JSON.stringify(settings));
  // This test delegates a long-running child through the actual pinned extension.
  const agent = join(root, '.pi/agents/researcher.md');
  let body = readFileSync(agent, 'utf8').replace('  - read', '  - bash');
  writeFileSync(agent, body);
  const noScope = join(root, 'no-scope');
  mkdirSync(noScope);
  if (!process.env.FORGE_TEST_SCOPE) writeFileSync(join(noScope, 'systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${noScope}:${process.env.PATH}`, PI_OFFLINE: '1' };
  delete env.PI_SUBAGENT_CHILD;
  const result = spawnSync(join(root, 'run'), ['--workflow', 'research', '--timeout', '6s'], { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 4, `${result.stderr}\n${result.stdout}`);
  assert.doesNotMatch(result.stderr, /cleanup incomplete/);
  assert.ok(existsSync(join(root, 'actual-subagent.json')), existsSync(join(root, 'actual-subagent-error')) ? readFileSync(join(root, 'actual-subagent-error'), 'utf8') : result.stderr);
  const record = JSON.parse(readFileSync(join(root, 'actual-subagent.json'), 'utf8'));
  assert.equal(record.status.state, 'running');
  assert.ok(Date.now() - record.at < 2500, 'background run was active until timeout');
  assert.ok(record.status.pid);
  assert.throws(() => process.kill(record.status.pid, 0), /ESRCH/);
});

test('cleanup reports incomplete when terminal state precedes runner exit', t => {
  const { root, env } = fixture(t);
  const pidfile = join(root, 'pid');
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
const fs=require('fs'), path=require('path'), {spawn}=require('child_process');
const dir=path.join(process.env.PI_SUBAGENTS_TEMP_ROOT,'async-subagent-runs','slow'); fs.mkdirSync(dir,{recursive:true});
const child=spawn('sleep',['30'],{detached:true,stdio:'ignore'}); child.unref(); fs.writeFileSync(${JSON.stringify(pidfile)},String(child.pid));
fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({runId:'slow',state:'stopped',pid:child.pid})); setTimeout(()=>{},30000);
`, { mode: 0o755 });
  t.after(() => { try { process.kill(Number(readFileSync(pidfile, 'utf8')), 'SIGKILL'); } catch {} });
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report', '--timeout', '1s'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 4, result.stderr);
  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.cleanup, 'incomplete');
  assert.ok(existsSync(summary.stateDir));
  rmSync(summary.stateDir, { recursive: true, force: true });
});

test('a missing system model is a machine-readable configuration failure', t => {
  const { root, env } = fixture(t);
  rmSync(join(root, '.pi/system.yaml'));
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report'], { env, encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).status, 'configuration_error');
});

test('a supported systemd user scope terminates independently detached descendants', { timeout: 15000 }, t => {
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--', 'true'], { encoding: 'utf8', timeout: 3000 });
  if (probe.status !== 0) return t.skip('systemd user scopes are unavailable');
  const { root, env } = fixture(t);
  rmSync(join(root, 'bin/systemd-run'));
  const marker = join(root, 'detached');
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
const fs=require('fs'), {spawn}=require('child_process');
const child=spawn('sleep',['30'],{detached:true,stdio:'ignore'}); child.unref(); fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));
setTimeout(()=>{},30000);
`, { mode: 0o755 });
  t.after(() => { try { process.kill(Number(readFileSync(marker, 'utf8')), 'SIGKILL'); } catch {} });
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report', '--timeout', '1s'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 4, result.stderr);
  assert.throws(() => process.kill(Number(readFileSync(marker, 'utf8')), 0), /ESRCH/);
});

test('a systemd scope is cleaned after a successful workflow', { timeout: 10000 }, t => {
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--', 'true'], { encoding: 'utf8', timeout: 3000 });
  if (probe.status !== 0) return t.skip('systemd user scopes are unavailable');
  const { root, env } = fixture(t);
  rmSync(join(root, 'bin/systemd-run'));
  const marker = join(root, 'success-child');
  writeFileSync(join(root, 'bin/pi'), `#!/usr/bin/env node
const fs=require('fs'), {spawn}=require('child_process'); const child=spawn('sleep',['30'],{detached:true,stdio:'ignore'}); child.unref(); fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'done'}]}}));
`, { mode: 0o755 });
  t.after(() => { try { process.kill(Number(readFileSync(marker, 'utf8')), 'SIGKILL'); } catch {} });
  const result = spawnSync(join(root, 'run'), ['--workflow', 'report'], { env, encoding: 'utf8', timeout: 8000 });
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => process.kill(Number(readFileSync(marker, 'utf8')), 0), /ESRCH/);
});
