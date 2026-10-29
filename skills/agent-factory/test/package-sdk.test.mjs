import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '../../..');
test('Pi loads a generated project from the Factory package', async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-sdk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi'));
  copyFileSync(join(import.meta.dirname, 'fixtures/generate/minimal/.pi/system.yaml'), join(root, '.pi/system.yaml'));
  execFileSync(process.execPath, [join(repo, 'skills/agent-factory/factory.mjs'), 'generate', root], { stdio: 'ignore' });
  const binary = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim();
  const sdk = await import(pathToFileURL(resolve(dirname(realpathSync(binary)), '../index.js')).href);
  const agentDir = join(root, '.factory/pi-home');
  const settingsManager = sdk.SettingsManager.inMemory({ packages: [repo], defaultTools: ['read'] });
  settingsManager.setProjectTrusted(true);
  const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noContextFiles: true });
  const oldCwd = process.cwd();
  const child = process.env.PI_SUBAGENT_CHILD;
  delete process.env.PI_SUBAGENT_CHILD;
  process.chdir(root);
  t.after(() => { process.chdir(oldCwd); if (child !== undefined) process.env.PI_SUBAGENT_CHILD = child; });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await sdk.createAgentSession({ cwd: root, agentDir, resourceLoader: loader, settingsManager, sessionManager: sdk.SessionManager.inMemory(root), tools: ['read'] });
  try {
    await session.bindExtensions({ onError: error => { throw new Error(JSON.stringify(error)); } });
    const commands = session.extensionRunner.getRegisteredCommands().map(c => c.name);
    assert.ok(commands.includes('factory-update'));
    assert.ok(commands.includes('factory-permission'));
    assert.ok(session.extensionRunner.getAllRegisteredTools().some(t => t.definition.name === 'memory'));
    assert.ok(session.extensionRunner.getAllRegisteredTools().some(t => t.definition.name === 'request_permission'));
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: 'v0.20.0' }), { status: 200 });
    try {
      const notices = [];
      const command = session.extensionRunner.getCommand('factory-update');
      await command.handler('check', { hasUI: true, ui: { notify: message => notices.push(message) } });
      assert.match(notices.join('\n'), /v0\.19\.0/);
      assert.match(notices.join('\n'), /v0\.20\.0/);
    } finally { globalThis.fetch = oldFetch; }
  } finally { session.dispose(); }
});
