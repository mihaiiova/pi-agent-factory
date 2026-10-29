import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const repo = resolve(import.meta.dirname, '../../..');

test('clean launcher installs the pinned package and registers its commands', {
  skip: process.env.FACTORY_CLEAN_MACHINE_TEST !== '1' && 'set FACTORY_CLEAN_MACHINE_TEST=1 after publishing the pinned release; requires network and Pi',
  timeout: 180000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-clean-machine-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(home);
  mkdirSync(join(project, '.pi'), { recursive: true });
  copyFileSync(join(import.meta.dirname, 'fixtures/generate/minimal/.pi/system.yaml'), join(project, '.pi/system.yaml'));
  execFileSync(process.execPath, [join(repo, 'skills/agent-factory/factory.mjs'), 'generate', project]);

  // The launcher supplies PI_CODING_AGENT_DIR itself. Do not inherit the
  // caller's Pi home, credentials, npm cache or Git configuration.
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache') };
  const child = spawn(join(project, 'run'), ['--mode', 'rpc', '--no-session'], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => { stderr += text; });
  const lines = createInterface({ input: child.stdout });
  t.after(() => lines.close());
  const response = await new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for Pi startup: ${stderr}`)), 165000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Pi exited ${code} before responding: ${stderr}`)); });
    lines.on('line', line => {
      let value;
      try { value = JSON.parse(line); } catch { return; }
      if (value.id !== 'commands') return;
      clearTimeout(timer);
      resolveResponse(value);
    });
    child.stdin.write(JSON.stringify({ id: 'commands', type: 'get_commands' }) + '\n');
  });
  assert.equal(response.success, true, stderr);
  const names = response.data.commands.map(command => command.name);
  assert.equal(names.filter(name => name === 'factory-update').length, 1, stderr);
  assert.equal(names.filter(name => name === 'factory-permission').length, 1, stderr);
});
