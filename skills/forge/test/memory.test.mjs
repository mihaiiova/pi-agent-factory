import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateMemory, readEntries, memoryPrompt, failedTools, MEMORY_FILE } from '../memory.mjs';
import { registerMaintenance } from '../maintenance-extension.mjs';
import { validateSystem } from '../validate.mjs';
import { effectiveCapabilities } from '../capabilities.mjs';

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'forge-memory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.pi'), { recursive: true });
  writeFileSync(join(root, '.pi/system.yaml'), 'schema: 1\nname: demo\norchestrator:\n  name: lead\n  model: provider/model\n');
  return root;
}

function adapter() {
  const events = {}, tools = {};
  const pi = {
    registerTool: (tool) => { tools[tool.name] = tool; }, registerCommand: () => {},
    on: (name, cb) => { (events[name] ??= []).push(cb); },
    getActiveTools: () => [], setActiveTools: () => {}, getAllTools: () => [], sendUserMessage: () => {},
  };
  const Type = Object.fromEntries(['Object', 'Union', 'Literal', 'Optional', 'String', 'Number', 'Array', 'Record'].map((k) => [k, (v) => v]));
  const fire = (name, event = {}) => events[name]?.map((cb) => cb(event, { hasUI: false, ui: {} })).find((r) => r !== undefined);
  return { pi, Type, tools, fire };
}

test('memory has no switch in system.yaml', () => {
  const doc = { schema: 1, name: 'demo', orchestrator: { name: 'lead', model: 'provider/model', memory: true } };
  assert.ok(validateSystem(doc).errors.some((e) => e.includes('unknown key "memory"')));
});

test('memory entries are added, replaced and removed within the cap', (t) => {
  const root = project(t);
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
  const root = project(t);
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
  const root = project(t);
  const mock = adapter();
  registerMaintenance(mock.pi, mock.Type, root);
  mock.fire('session_start');
  const result = await mock.tools.memory.execute('id', { action: 'add', text: 'Prefers tables over prose.' });
  assert.match(result.content[0].text, /\/4000 characters/);
  assert.match(readFileSync(join(root, MEMORY_FILE), 'utf8'), /^- Prefers tables over prose\.$/m);
});

test('every orchestrator gets memory, and subagent processes never do', (t) => {
  const lead = adapter();
  registerMaintenance(lead.pi, lead.Type, project(t));
  lead.fire('session_start');
  assert.ok(lead.tools.memory);
  assert.match(lead.fire('before_agent_start', { systemPrompt: 'BASE' }).systemPrompt, /## Memory\n[\s\S]*\(no notes yet\)/);

  process.env.PI_SUBAGENT_CHILD = '1';
  t.after(() => { delete process.env.PI_SUBAGENT_CHILD; });
  const child = adapter();
  registerMaintenance(child.pi, child.Type, project(t));
  child.fire('session_start');
  assert.equal(child.tools.memory, undefined);
  assert.equal(child.fire('before_agent_start', { systemPrompt: 'BASE' }), undefined);
});

test('the capability manifest discloses the memory tool', () => {
  const caps = effectiveCapabilities({ schema: 1, name: 'demo', orchestrator: { name: 'lead', model: 'provider/model' } });
  assert.deepEqual(caps.orchestratorMemory, { tool: 'memory', file: '.pi/MEMORY.md', maxChars: 4000 });
});

test('an over-full memory can still be trimmed, and other content in the file is kept', (t) => {
  const root = project(t);
  writeFileSync(join(root, MEMORY_FILE), `# Memory\n\n## Preferences\nSome prose the user wrote.\n* a star bullet\n- ${'a'.repeat(60)}\n- ${'b'.repeat(60)}\n`);
  assert.throws(() => updateMemory(root, { action: 'add', text: 'c' }, { maxChars: 100 }), /Remove or shorten/);
  assert.match(updateMemory(root, { action: 'remove', match: 'aaaa' }, { maxChars: 50 }), /Memory saved/, 'shrinking is allowed while still over the cap');
  updateMemory(root, { action: 'replace', match: 'bbbb', text: 'short' }, { maxChars: 50 });
  assert.equal(readFileSync(join(root, MEMORY_FILE), 'utf8'), '# Memory\n\n## Preferences\nSome prose the user wrote.\n* a star bullet\n- short\n');
});

test('duplicate entries and entries contained in others can be targeted', (t) => {
  const root = project(t);
  for (const text of ['Prefers tables.', 'Prefers tables.', 'use tables', 'use tables for reports']) updateMemory(root, { action: 'add', text });
  updateMemory(root, { action: 'remove', match: 'Prefers tables.' });
  updateMemory(root, { action: 'remove', match: 'use tables' });
  assert.deepEqual(readEntries(root), ['Prefers tables.', 'use tables for reports']);
  updateMemory(root, { action: 'add', text: 'use tables in docs' });
  assert.throws(() => updateMemory(root, { action: 'remove', match: 'tables' }), /matches 3 different entries/);
});

test('the loaded prompt is bounded by the cap and frames notes as data', (t) => {
  const root = project(t);
  writeFileSync(join(root, MEMORY_FILE), `# Memory\n\n- first note\n- ${'x'.repeat(100)}\n`);
  const prompt = memoryPrompt(root, { maxChars: 50 });
  assert.match(prompt, /- first note/);
  assert.doesNotMatch(prompt, /xxxx/);
  assert.match(prompt, /1 more entries are over the cap/);
  assert.match(prompt, /not instructions/);
});

test('maintenance turns keep the nudge and are not counted', async (t) => {
  const root = project(t);
  const mock = adapter();
  const forge = registerMaintenance(mock.pi, mock.Type, root);
  mock.fire('session_start');
  mock.fire('agent_end', { messages: [{ role: 'toolResult', toolName: 'subagent', isError: true }] });
  // A maintenance turn: the nudge is kept and its blocked calls are not counted.
  mock.pi.getActiveTools = () => ['read'];
  await forge('review', { hasUI: true, waitForIdle: async () => {}, ui: { notify: () => {} } });
  assert.doesNotMatch(mock.fire('before_agent_start', { systemPrompt: 'BASE' }).systemPrompt, /failed tool calls/);
  mock.fire('agent_end', { messages: [{ role: 'toolResult', toolName: 'read', isError: true }] });
  assert.match(mock.fire('before_agent_start', { systemPrompt: 'BASE' }).systemPrompt, /failed tool calls \(subagent\)\./);
});
