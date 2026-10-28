import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryConfig, updateMemory, readEntries, memoryPrompt, failedTools, MEMORY_FILE } from '../memory.mjs';
import { registerMaintenance } from '../maintenance-extension.mjs';
import { validateSystem } from '../validate.mjs';

function project(t, memory) {
  const root = mkdtempSync(join(tmpdir(), 'factory-memory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi'), { recursive: true });
  const memoryLine = memory === undefined ? '' : `  memory: ${JSON.stringify(memory)}\n`;
  writeFileSync(join(root, '.pi/system.yaml'), `schema: 1\nname: demo\norchestrator:\n  name: lead\n  model: provider/model\n${memoryLine}`);
  return root;
}

function adapter() {
  const events = {}, tools = {};
  const pi = {
    registerTool: (tool) => { tools[tool.name] = tool; }, registerCommand: () => {},
    on: (name, cb) => { (events[name] ??= []).push(cb); },
    getActiveTools: () => [], setActiveTools: () => {}, getAllTools: () => [], sendUserMessage: () => {},
  };
  const Type = Object.fromEntries(['Object', 'Union', 'Literal', 'Optional', 'String', 'Number'].map((k) => [k, (v) => v]));
  const fire = (name, event = {}) => events[name]?.map((cb) => cb(event, { hasUI: false, ui: {} })).find((r) => r !== undefined);
  return { pi, Type, tools, fire };
}

test('memory is off unless the orchestrator opts in, with a configurable cap', () => {
  assert.equal(memoryConfig({ orchestrator: { name: 'lead' } }), null);
  assert.equal(memoryConfig({ orchestrator: { memory: false } }), null);
  assert.deepEqual(memoryConfig({ orchestrator: { memory: true } }), { maxChars: 4000 });
  assert.deepEqual(memoryConfig({ orchestrator: { memory: { maxChars: 900 } } }), { maxChars: 900 });
});

test('orchestrator.memory validates as a boolean or { maxChars }', () => {
  const doc = (memory) => ({ schema: 1, name: 'demo', orchestrator: { name: 'lead', model: 'provider/model', memory } });
  assert.equal(validateSystem(doc(true)).ok, true);
  assert.equal(validateSystem(doc({ maxChars: 2000 })).ok, true);
  assert.ok(validateSystem(doc('yes')).errors.some((e) => e.includes('orchestrator.memory must be')));
  assert.ok(validateSystem(doc({ maxChars: 0 })).errors.some((e) => e.includes('maxChars must be a positive integer')));
  assert.ok(validateSystem(doc({ size: 1 })).errors.some((e) => e.includes('unknown key "size"')));
});

test('memory entries are added, replaced and removed within the cap', (t) => {
  const root = project(t, true);
  updateMemory(root, { action: 'add', text: 'User wants briefs under 300 words.' });
  updateMemory(root, { action: 'add', text: 'seo-analyst fails without OpenSEO;\n check the server first.' });
  assert.deepEqual(readEntries(root), ['User wants briefs under 300 words.', 'seo-analyst fails without OpenSEO; check the server first.']);
  updateMemory(root, { action: 'replace', match: '300 words', text: 'User wants briefs under 250 words.' });
  updateMemory(root, { action: 'remove', match: 'seo-analyst' });
  assert.deepEqual(readEntries(root), ['User wants briefs under 250 words.']);
  assert.throws(() => updateMemory(root, { action: 'remove', match: 'nothing like this' }), /No entry contains/);
  assert.throws(() => updateMemory(root, { action: 'add', text: 'x'.repeat(200) }, { maxChars: 100 }), /Remove or shorten entries first/);
  assert.deepEqual(readEntries(root), ['User wants briefs under 250 words.'], 'a rejected write changes nothing');
  assert.match(memoryPrompt(root), /## Memory[\s\S]*- User wants briefs under 250 words\./);
});

test('failed tool calls are collected, ignoring memory and maintenance tools', () => {
  assert.deepEqual(failedTools([
    { role: 'toolResult', toolName: 'subagent', isError: true },
    { role: 'toolResult', toolName: 'subagent', isError: true },
    { role: 'toolResult', toolName: 'memory', isError: true },
    { role: 'toolResult', toolName: 'read', isError: false },
    { role: 'assistant' },
  ]), ['subagent']);
});

test('the extension loads memory for the orchestrator and nudges after failed tool calls', (t) => {
  const root = project(t, true);
  writeFileSync(join(root, MEMORY_FILE), '# Memory\n\n- Drafts go to Google Drive.\n');
  const mock = adapter();
  registerMaintenance(mock.pi, mock.Type, root);
  mock.fire('session_start');
  assert.ok(mock.tools.memory, 'memory tool registered');
  const first = mock.fire('before_agent_start', { systemPrompt: 'BASE' });
  assert.match(first.systemPrompt, /^BASE\n\n## Memory[\s\S]*- Drafts go to Google Drive\./);
  assert.doesNotMatch(first.systemPrompt, /failed tool calls/);
  mock.fire('agent_end', { messages: [{ role: 'toolResult', toolName: 'subagent', isError: true }] });
  assert.match(mock.fire('before_agent_start', { systemPrompt: 'BASE' }).systemPrompt, /failed tool calls \(subagent\)/);
  assert.doesNotMatch(mock.fire('before_agent_start', { systemPrompt: 'BASE' }).systemPrompt, /failed tool calls/, 'the nudge is shown once');
});

test('the memory tool writes .pi/MEMORY.md', async (t) => {
  const root = project(t, { maxChars: 500 });
  const mock = adapter();
  registerMaintenance(mock.pi, mock.Type, root);
  mock.fire('session_start');
  const result = await mock.tools.memory.execute('id', { action: 'add', text: 'Prefers tables over prose.' });
  assert.match(result.content[0].text, /\/500 characters/);
  assert.match(readFileSync(join(root, MEMORY_FILE), 'utf8'), /^- Prefers tables over prose\.$/m);
});

test('memory stays off without opt-in, and subagent processes never get it', (t) => {
  const off = adapter();
  registerMaintenance(off.pi, off.Type, project(t));
  off.fire('session_start');
  assert.equal(off.tools.memory, undefined);
  assert.equal(off.fire('before_agent_start', { systemPrompt: 'BASE' }), undefined);

  process.env.PI_SUBAGENT_CHILD = '1';
  t.after(() => { delete process.env.PI_SUBAGENT_CHILD; });
  const child = adapter();
  registerMaintenance(child.pi, child.Type, project(t, true));
  child.fire('session_start');
  assert.equal(child.tools.memory, undefined);
  assert.equal(child.fire('before_agent_start', { systemPrompt: 'BASE' }), undefined);
});
