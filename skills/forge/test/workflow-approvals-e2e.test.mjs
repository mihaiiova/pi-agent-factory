import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '../../..');
const forge = join(repo, 'skills/forge/forge.mjs');
const server = join(import.meta.dirname, 'fixtures/mcp/server.mjs');
const pi = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim();
const bin = dirname(realpathSync(pi));
const ai = pathToFileURL(resolve(bin, '../../node_modules/@earendil-works/pi-ai/dist/index.js')).href;

function project(t, tool, input) {
  const root = mkdtempSync(join(tmpdir(), 'forge-workflow-approval-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi')); mkdirSync(join(root, 'no-scope'));
  writeFileSync(join(root, 'no-scope/systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const called = join(root, 'called');
  writeFileSync(join(root, '.pi/system.yaml'), `schema: 1
name: approval-workflow
orchestrator:
  name: lead
  model: faux/faux-1
  tools: [read, cli:make-file, mcp]
  prompt: Test approvals.
integrations:
  cli:
    - name: make-file
      command: touch
      args: [${JSON.stringify(called)}]
  mcp:
    - name: seo
      config:
        command: ${JSON.stringify(process.execPath)}
        args: [${JSON.stringify(server)}]
        env: { MCP_LOG: ${JSON.stringify(called)} }
        includeTools: [run_audit]
        approveTools: [run_audit]
workflows:
  - name: test
    entry: lead
`);
  const generated = spawnSync(process.execPath, [forge, 'generate', root], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const provider = join(root, '.pi/provider.mjs');
  writeFileSync(provider, `import {createFauxCore,fauxAssistantMessage,fauxToolCall} from ${JSON.stringify(ai)};
export default pi => {
 const faux=createFauxCore({api:'faux-test',provider:'faux',models:[{id:'faux-1'}]});
 faux.setResponses([fauxAssistantMessage([fauxToolCall(${JSON.stringify(tool)},${JSON.stringify(input)})]), fauxAssistantMessage('done')]);
 pi.registerProvider('faux',{baseUrl:'http://localhost',apiKey:'test',api:'faux-test',streamSimple:faux.streamSimple,models:[{type:'chat',id:'faux-1',name:'faux',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}]});
 if (${JSON.stringify(tool)}.startsWith('mcp__')) pi.on('before_agent_start', async () => {
   for(let i=0;i<100 && !pi.getAllTools().some(t=>t.name===${JSON.stringify(tool)});i++) await new Promise(r=>setTimeout(r,50));
 });
};`);
  const settings = JSON.parse(readFileSync(join(root, '.pi/settings.json'), 'utf8'));
  settings.packages = [repo]; settings.extensions = [provider];
  writeFileSync(join(root, '.pi/settings.json'), JSON.stringify(settings));
  const env = { ...process.env, PATH: `${root}/no-scope:${process.env.PATH}`, PI_OFFLINE: '1' };
  delete env.PI_SUBAGENT_CHILD;
  return { root, env, called };
}

function run(t, tool, input) {
  const projectInfo = project(t, tool, input);
  const started = Date.now();
  const result = spawnSync(join(projectInfo.root, 'run'), ['--workflow', 'test', '--timeout', '15s'], { env: projectInfo.env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 3, `${result.stderr}\n${result.stdout}`);
  assert.ok(Date.now() - started < 12000, 'approval does not wait for the workflow timeout');
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(summary.status, 'blocked');
  assert.equal(existsSync(projectInfo.called), false, 'approval-gated side effect never ran');
  return { summary, ...projectInfo };
}

test('declared CLI approval yields workflow exit 3 and names the call', t => {
  const { summary } = run(t, 'cli_make_file', {});
  assert.match(summary.message, /make-file.*touch/);
});

test('request_permission yields workflow exit 3 without queuing or executing', t => {
  const { summary, root } = run(t, 'request_permission', { name: 'create-directory', command: 'mkdir', args: ['created'], reason: 'Need a directory' });
  assert.match(summary.message, /request_permission create-directory: mkdir created/);
  assert.equal(existsSync(join(root, 'created')), false);
  assert.equal(existsSync(join(root, '.forge/permission-requests.json')), false);
});

test('MCP approveTools yields workflow exit 3 and names the call', t => {
  const { summary } = run(t, 'mcp__seo__run_audit', {});
  assert.match(summary.message, /seo: run_audit/);
});
