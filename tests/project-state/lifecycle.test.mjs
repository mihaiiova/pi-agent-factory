import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listSessions } from '../../extensions/project-state/state.mjs';
import { summarize } from '../../extensions/project-state/accounting.mjs';

const stub = 'data:text/javascript,' + encodeURIComponent('export const CONFIG_DIR_NAME=".pi"; export const CURRENT_SESSION_VERSION=3; export const VERSION="test";');
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === '@earendil-works/pi-coding-agent' ? { url: stub, shortCircuit: true } : next(specifier, context);
} });
const { default: register } = await import('../../extensions/project-state/index.ts');
hooks.deregister();

test('actual extension callbacks account the active native branch across shutdown, resume, reload and compaction', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-state-lifecycle-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd });
    execFileSync('git', ['checkout', '-q', '-b', 'spec/42-test'], { cwd });
    const file = join(cwd, 'native.jsonl');
    const header = { type: 'session', id: 'native', timestamp: '2026-01-01T00:00:00Z', cwd };
    const user = { type: 'message', id: 'u', parentId: null, timestamp: '2026-01-01T00:00:01Z', message: { role: 'user', content: '/spec-start #42' } };
    let branch = [user];
    const abandoned = { type: 'message', id: 'abandoned', parentId: 'u', timestamp: '2026-01-01T00:00:02Z', message: { role: 'assistant', usage: { cost: { total: 99 } } } };
    let all = [user, abandoned];
    const save = () => writeFileSync(file, [header, ...all].map(e => JSON.stringify(e)).join('\n') + '\n'); save();
    const handlers = new Map(), commands = new Map(), output = [];
    const pi = { on: (name, fn) => handlers.set(name, fn), registerCommand: (name, def) => commands.set(name, def),
      appendEntry(customType, data) { const e = { type: 'custom', customType, data, id: `context-${all.length}`, parentId: branch.at(-1)?.id, timestamp: new Date().toISOString() }; all.push(e); branch.push(e); save(); } };
    const ctx = { cwd, model: null, ui: { notify: text => output.push(text) },
      sessionManager: { getSessionId: () => 'native', getSessionFile: () => file, getHeader: () => header, getEntries: () => all, getBranch: () => branch } };
    register(pi);
    await handlers.get('session_start')({ reason: 'startup' }, ctx);
    await handlers.get('before_agent_start')({ messageType: 'user', prompt: '/spec-start #42' }, ctx);
    const add = (id, value) => { const e = { type: 'message', id, parentId: branch.at(-1).id, timestamp: new Date().toISOString(), message: { role: 'assistant', usage: value === null ? { input: 10 } : { cost: { total: value } } } }; branch.push(e); all.push(e); save(); };
    add('a', 1);
    await handlers.get('session_before_compact')({}, ctx);
    await handlers.get('session_shutdown')({ reason: 'quit' }, ctx);
    let records = listSessions(join(cwd, '.pi'));
    assert.equal(records.length, 1);
    assert.equal(summarize(records[0].accounting.samples).totalCost, 1);
    const original = readFileSync(join(cwd, '.pi', 'sessions', 'native.json'), 'utf8');
    await handlers.get('session_start')({ reason: 'resume' }, ctx);
    add('b', 0.5); add('c', null);
    await commands.get('session-cost').handler('', ctx);
    assert.match(output.at(-1), /project aggregate: \$1.5000 \(partial\)/);
    await handlers.get('session_shutdown')({ reason: 'reload' }, ctx);
    assert.equal(listSessions(join(cwd, '.pi'), { allSnapshots: true }).length, 1);
    await handlers.get('session_start')({ reason: 'reload' }, ctx);
    await handlers.get('session_shutdown')({ reason: 'quit' }, ctx);
    records = listSessions(join(cwd, '.pi'));
    assert.equal(records.length, 1);
    assert.equal(records[0].snapshotRevision, 2);
    assert.equal(summarize(records[0].accounting.samples).totalCost, 1.5);
    assert.equal(summarize(records[0].accounting.samples).coverage.unpriced, 1);
    assert.equal(readFileSync(join(cwd, '.pi', 'sessions', 'native.json'), 'utf8'), original);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
