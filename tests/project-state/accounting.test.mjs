import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { activeBranch, sessionLedger, summarize, attachSubagents, agentSummary } from '../../extensions/project-state/accounting.mjs';
import { collectProject, sessionDirectory, specReport } from '../../extensions/project-state/accounting-project.mjs';
import { createSession, checkpointSession, listSessions, finalizeSession } from '../../extensions/project-state/state.mjs';
import { formatCost } from '../../extensions/project-state/presentation.mjs';
import { phaseRows } from '../../extensions/project-state/accounting-cli.mjs';

const root = mkdtempSync(join(tmpdir(), 'pi-accounting-'));
after(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;
function fixture() {
  const cwd = join(root, String(++counter)); mkdirSync(cwd);
  const sessionRoot = join(cwd, 'native');
  const dir = sessionDirectory(cwd, sessionRoot); mkdirSync(dir, { recursive: true });
  return { cwd, dir, sessionRoot };
}
const msg = (id, parentId, role, content, total, time = 100) => ({ type: 'message', id, parentId, timestamp: time,
  message: { role, content, ...(role === 'assistant' ? { usage: total === undefined ? { input: 10 } : { input: 10, cost: { total } } } : {}) } });
function raw(f, name, entries, extra = {}) {
  const file = join(f.dir, `${name}.jsonl`);
  const header = { type: 'session', id: name, cwd: f.cwd, timestamp: 1, ...extra };
  writeFileSync(file, [header, ...entries].map(e => JSON.stringify(e)).join('\n') + '\n');
  return { file, header };
}
function metadata(f, name, meta) {
  const dir = join(f.dir, 'subagent-artifacts'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}_meta.json`); writeFileSync(file, JSON.stringify(meta)); return file;
}
function launch(id, parentId, runId, args = {}) {
  return [msg(id, parentId, 'assistant', [{ type: 'toolCall', id: `call-${id}`, name: 'subagent', arguments: args }], 0.1),
    { type: 'message', id: `result-${id}`, parentId: id, timestamp: 101,
      message: { role: 'toolResult', toolName: 'subagent', toolCallId: `call-${id}`, details: { runId } } }];
}
const project = f => collectProject(f.cwd, { sessionRoot: f.sessionRoot });

test('native branch uses last appended leaf even with timestamp skew; abandoned cost excluded', () => {
  const rows = [msg('u', null, 'user', '/spec-start #42'), msg('old', 'u', 'assistant', '', 99, 9000), msg('new', 'u', 'assistant', '', 1, 200)];
  assert.deepEqual(activeBranch(rows).map(e => e.id), ['u', 'new']);
  assert.equal(summarize(sessionLedger({ entries: rows, header: { id: 'x' } }).samples).totalCost, 1);
  assert.equal(activeBranch(rows, null).length, 0);
});

test('explicit zero differs from missing, negative, boolean, and nonfinite prices', () => {
  const rows = [msg('u', null, 'user', '/spec-start #42'), msg('zero', 'u', 'assistant', '', 0), msg('unknown', 'zero', 'assistant', '', undefined),
    msg('neg', 'unknown', 'assistant', '', -1), msg('bool', 'neg', 'assistant', '', true), msg('nan', 'bool', 'assistant', '', NaN)];
  const summary = summarize(sessionLedger({ entries: rows, header: { id: 'x' } }).samples);
  assert.equal(summary.totalCost, 0);
  assert.deepEqual(summary.coverage, { priced: 1, unpriced: 4 });
  assert.equal(summary.usage.cost.input, null);
});

test('compaction, branch summaries, and native usage entries included; tool-result usage excluded', () => {
  const rows = [msg('u', null, 'user', '/spec-start #42'), msg('a', 'u', 'assistant', '', 1),
    { type: 'compaction', id: 'c', parentId: 'a', usage: { cost: { total: 0.2 } } },
    { type: 'branch_summary', id: 'b', parentId: 'c', usage: { cost: { total: 0.3 } } },
    { type: 'usage', id: 'w', parentId: 'b', usage: { cost: { total: 0.4 } } },
    { type: 'message', id: 't', parentId: 'w', message: { role: 'toolResult', usage: { cost: { total: 100 } } } }];
  assert.equal(summarize(sessionLedger({ entries: rows, header: { id: 's' } }).samples).totalCost, 1.9);
});

test('subagents are owned by run identity, never shared directory or completion timestamp', () => {
  const f = fixture();
  raw(f, 'a', [msg('u', null, 'user', '/spec-start #42'), ...launch('l', 'u', 'run-a'), msg('later', 'result-l', 'user', '/spec-review #42')]);
  raw(f, 'b', [msg('v', null, 'user', '/spec-start #43'), ...launch('m', 'v', 'run-b')]);
  metadata(f, 'run-a_worker', { runId: 'run-a', agent: 'worker', timestamp: 999999, usage: { cost: 2 }, exitCode: 0 });
  metadata(f, 'run-b_worker', { runId: 'run-b', agent: 'worker', timestamp: 100, usage: { cost: 30 } });
  metadata(f, 'no-owner', { timestamp: 100, agent: 'worker', usage: { cost: 900 } });
  const p = project(f);
  assert.equal(p.totalCost, 32.2);
  assert.equal(specReport(p, [42]).implementation_cost, 2.1);
  assert.equal(p.sessions.find(s => s.sessionId === 'b').subagentCost, 30);
  assert.match(p.warnings.join('\n'), /lack unambiguous ownership/);
});

test('explicit artifact links establish ownership when metadata has no runId', () => {
  const file = '/tmp/example-worker_meta.json';
  const entries = [msg('u', null, 'user', '/spec-start #42'), ...launch('l', 'u', 'parent')];
  entries.at(-1).message.details.results = [{ artifactPaths: { metadataPath: file } }];
  const ledger = sessionLedger({ entries, header: { id: 'owner' } });
  attachSubagents([ledger], [{ path: file, meta: { agent: 'worker', usage: { cost: 3 } } }]);
  assert.equal(summarize(ledger.samples).subagentCost, 3);
});

test('missing metadata and unpriced subagent metadata disclose gaps', () => {
  const ledger = sessionLedger({ entries: [msg('u', null, 'user', '/spec-start #42'), ...launch('l', 'u', 'run')], header: { id: 's' } });
  attachSubagents([ledger], []);
  assert.match(ledger.warnings.join(' '), /unavailable/);
  attachSubagents([ledger], [{ path: '/tmp/run_worker_meta.json', meta: { runId: 'run', agent: 'worker', usage: { input: 12 } } }]);
  assert.equal(summarize(ledger.samples).subagentCost, null);
  assert.equal(summarize(ledger.samples).coverage.unpriced, 1);
  assert.equal(agentSummary(ledger.samples).totalCost, null);
});

test('resume updates raw totals immediately and appends a snapshot without changing the first', () => {
  const f = fixture(); const entries = [msg('u', null, 'user', '/spec-start #42'), msg('a', 'u', 'assistant', '', 1)];
  const source = raw(f, 'native-id', entries);
  const record = createSession({ sessionId: 'native-id', cwd: f.cwd, piSessionFile: source.file });
  record.accounting = project(f).ledgers[0];
  const first = checkpointSession(join(f.cwd, '.pi'), record); const bytes = readFileSync(first.path, 'utf8');
  assert.equal(checkpointSession(join(f.cwd, '.pi'), record).status, 'exists');
  appendFileSync(source.file, JSON.stringify(msg('b', 'a', 'assistant', '', 0.5)) + '\n');
  assert.equal(project(f).totalCost, 1.5);
  record.accounting = project(f).ledgers[0];
  checkpointSession(join(f.cwd, '.pi'), record);
  assert.equal(readFileSync(first.path, 'utf8'), bytes);
  const latest = listSessions(join(f.cwd, '.pi'));
  assert.equal(latest.length, 1);
  assert.equal(latest[0].snapshotRevision, 2);
  assert.equal(summarize(latest[0].accounting.samples).totalCost, 1.5);
  assert.equal(listSessions(join(f.cwd, '.pi'), { allSnapshots: true }).length, 2);
});

test('fork ancestry is deduplicated in project/spec totals while unrelated sessions keep independent costs', () => {
  const f = fixture(); const ancestry = [msg('u', null, 'user', '/spec-start #42'), msg('a', 'u', 'assistant', '', 1)];
  const parent = raw(f, 'parent', ancestry);
  raw(f, 'fork', [...ancestry, msg('v', 'a', 'user', 'Another approach', undefined, 300), msg('b', 'v', 'assistant', '', 0.5, 400)], { parentSession: parent.file, timestamp: 250 });
  assert.equal(project(f).totalCost, 1.5);
  raw(f, 'unrelated', ancestry);
  assert.equal(project(f).totalCost, 2.5);
  assert.equal(specReport(project(f), [42]).known_cost, 2.5);
});

test('unavailable ancestry is omitted with a warning rather than double charging inherited usage', () => {
  const f = fixture();
  raw(f, 'fork', [msg('u', null, 'user', '/spec-start #42', undefined, 100), msg('a', 'u', 'assistant', '', 50, 150), msg('b', 'a', 'assistant', '', 1, 300)],
    { parentSession: join(f.dir, 'missing.jsonl'), timestamp: 200 });
  assert.equal(project(f).totalCost, 1);
  assert.match(project(f).warnings.join(' '), /Fork ancestry unavailable/);
});

test('ledger snapshots retain evidence if raw logs disappear; legacy aggregates remain unverified', () => {
  const f = fixture(); const source = raw(f, 's', [msg('u', null, 'user', '/spec-start #42'), msg('a', 'u', 'assistant', '', 1)]);
  const record = createSession({ sessionId: 's', cwd: f.cwd, piSessionFile: source.file }); record.accounting = project(f).ledgers[0];
  checkpointSession(join(f.cwd, '.pi'), record); rmSync(source.file);
  assert.equal(project(f).totalCost, 1);
  const legacy = createSession({ sessionId: 'old', piSessionFile: join(f.dir, 'old.jsonl') }); legacy.usage = { cost: { total: 100 } };
  finalizeSession(join(f.cwd, '.pi'), legacy);
  assert.equal(project(f).totalCost, 1);
  assert.match(project(f).warnings.join(' '), /legacy session transcript/);
});

test('mixed specs, expanded skills and free-text followups have exact attribution', () => {
  const f = fixture();
  raw(f, 's', [msg('u', null, 'user', '<skill name="spec-start">Example #999</skill>\n#42'), msg('a', 'u', 'assistant', '', 1),
    msg('v', 'a', 'user', 'Simpler'), msg('b', 'v', 'assistant', '', 0.5),
    msg('w', 'b', 'user', '/spec-start #420'), msg('c', 'w', 'assistant', '', 20)]);
  const p = project(f);
  assert.equal(specReport(p, [42]).known_cost, 1.5);
  assert.equal(specReport(p, [42, 42, 420]).known_cost, 21.5);
  assert.equal(phaseRows(p).reduce((n, row) => n + (row.total_cost ?? 0), 0), 21.5);
});

test('known zero and unknown-only reports are distinct; project-state is not attribution', () => {
  const f = fixture(); mkdirSync(join(f.cwd, '.pi')); writeFileSync(join(f.cwd, '.pi', 'state.json'), JSON.stringify({ activeSpec: { number: 42 } }));
  raw(f, 's', [msg('u', null, 'user', 'Hello'), msg('a', 'u', 'assistant', '', undefined)]);
  assert.equal(project(f).totalCost, null);
  assert.equal(specReport(project(f), [42]).known_cost, null);
});

test('malformed and partial JSONL lines are disclosed without discarding valid observations', () => {
  const f = fixture(); const s = raw(f, 's', [msg('u', null, 'user', '/spec-start #42'), msg('a', 'u', 'assistant', '', 1)]);
  appendFileSync(s.file, '{partial');
  assert.equal(project(f).totalCost, 1);
  assert.match(project(f).warnings.join(' '), /Unreadable entry/);
});

test('live native branch overrides disk tree and agrees with session-cost presentation', () => {
  const f = fixture(); const entries = [msg('u', null, 'user', '/spec-start #42'), msg('a', 'u', 'assistant', '', 10), msg('b', 'u', 'assistant', '', 1)];
  const s = raw(f, 's', entries);
  const p = collectProject(f.cwd, { sessionRoot: f.sessionRoot, live: [{ sessionFile: s.file, header: s.header, entries, branch: activeBranch(entries, 'a') }] });
  assert.equal(p.totalCost, 10);
  assert.match(formatCost(p.sessions[0], [], { project: p }), /project aggregate: \$10.0000/);
});

test('Node and Python cost entry points use identical project/spec numbers and reject partial-scope spec requests', () => {
  const f = fixture(); const home = join(f.cwd, 'home'); const dir = sessionDirectory(f.cwd, join(home, '.pi', 'agent', 'sessions')); mkdirSync(dir, { recursive: true });
  raw({ ...f, dir }, 's', [msg('u', null, 'user', '/spec-start #42'), msg('a', 'u', 'assistant', '', 1)]);
  const env = { ...process.env, HOME: home };
  const args = ['--cwd', f.cwd, '--spec', '42', '--json'];
  const node = spawnSync(process.execPath, ['skills/spec-cost/cost.mjs', ...args], { env, encoding: 'utf8' });
  const python = spawnSync('python3', ['skills/spec-cost/cost.py', ...args], { env, encoding: 'utf8' });
  assert.equal(node.status, 0, node.stderr); assert.equal(python.status, 0, python.stderr);
  assert.deepEqual(JSON.parse(node.stdout), JSON.parse(python.stdout));
  assert.equal(JSON.parse(node.stdout).known_cost, 1);
  const invalid = spawnSync(process.execPath, ['skills/spec-cost/cost.mjs', ...args, '--latest'], { env, encoding: 'utf8' });
  assert.equal(invalid.status, 2);
});

test('inspecting another run through a status call never transfers ownership or changes launch attribution', () => {
  const f = fixture();
  const entries = [msg('u', null, 'user', '/spec-start #42'), ...launch('l', 'u', 'run'), msg('v', 'result-l', 'user', '/spec-review #42'), ...launch('status', 'v', 'run', { action: 'status', id: 'run' })];
  raw(f, 's', entries);
  metadata(f, 'run_worker', { runId: 'run', agent: 'worker', usage: { cost: 2 }, timestamp: 99999 });
  const p = project(f);
  assert.equal(specReport(p, [42]).implementation_cost, 2.1);
  assert.equal(specReport(p, [42]).rows.find(r => r.workflow === 'spec-review').subagent_cost, null);
  const onlyStatus = sessionLedger({ entries: [msg('x', null, 'user', '/spec-review #43'), ...launch('q', 'x', 'foreign', { action: 'status', id: 'foreign' })], header: { id: 'viewer' } });
  attachSubagents([onlyStatus], [{ path: '/tmp/foreign_worker_meta.json', meta: { runId: 'foreign', usage: { cost: 9 } } }]);
  assert.equal(summarize(onlyStatus.samples).subagentCost, null);
});

test('archived observations and refreshed metadata count the latest run cost once', () => {
  const f = fixture(); const s = raw(f, 's', [msg('u', null, 'user', '/spec-start #42'), ...launch('l', 'u', 'run')]);
  const path = metadata(f, 'run_worker', { runId: 'run', parentSessionId: 's', agent: 'worker', usage: { cost: 1 }, timestamp: 100 });
  const record = createSession({ sessionId: 's', cwd: f.cwd, piSessionFile: s.file });
  record.accounting = project(f).ledgers[0]; checkpointSession(join(f.cwd, '.pi'), record); rmSync(s.file);
  writeFileSync(path, JSON.stringify({ runId: 'run', parentSessionId: 's', agent: 'worker', usage: { cost: 2 }, timestamp: 200 }));
  const p = project(f);
  assert.equal(p.subagentCost, 2);
  assert.equal(specReport(p, [42]).known_cost, 2.1);
});

test('a malformed original snapshot cannot prevent saving a valid resume revision', () => {
  const f = fixture(); const directory = join(f.cwd, '.pi', 'sessions'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 's.json'), '{broken');
  const record = createSession({ sessionId: 's', cwd: f.cwd });
  record.accounting = sessionLedger({ entries: [msg('u', null, 'user', '/spec-start #42'), msg('a', 'u', 'assistant', '', 1)], header: { id: 's' } });
  const result = checkpointSession(join(f.cwd, '.pi'), record);
  assert.equal(result.status, 'created');
  assert.equal(readFileSync(join(directory, 's.json'), 'utf8'), '{broken');
  assert.equal(listSessions(join(f.cwd, '.pi')).length, 1);
});

test('older snapshot identity survives closing the branch, without charging later unlinked work to that spec', () => {
  const f = fixture(); const entries = [msg('u', null, 'user', '/spec-start'), msg('a', 'u', 'assistant', '', 1)];
  const s = raw(f, 's', entries);
  const record = createSession({ sessionId: 's', cwd: f.cwd, piSessionFile: s.file });
  record.activeSpec = { number: 42 };
  record.accounting = sessionLedger({ entries, header: s.header, sessionFile: s.file, hintSpec: 42 });
  checkpointSession(join(f.cwd, '.pi'), record);
  appendFileSync(s.file, JSON.stringify({ type: 'custom', id: 'context', parentId: 'a', customType: 'pi-config:accounting-context', data: { spec: null, workflow: 'general' } }) + '\n');
  appendFileSync(s.file, JSON.stringify(msg('b', 'context', 'assistant', '', 2)) + '\n');
  record.activeSpec = null; record.accounting = project(f).ledgers[0]; checkpointSession(join(f.cwd, '.pi'), record);
  assert.equal(project(f).totalCost, 3);
  assert.equal(specReport(project(f), [42]).known_cost, 1);
});
