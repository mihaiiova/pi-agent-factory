/** Filesystem discovery shared by the extension and every cost-report command. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { activeBranch, attachSubagents, sessionLedger, summarize, deduplicate, timestamp } from './accounting.mjs';
import { listSessions } from './state.mjs';

export function sessionDirectory(cwd, root = join(homedir(), '.pi', 'agent', 'sessions')) {
  return join(root, `--${resolve(cwd).replace(/^\/+|\/+$/g, '').replaceAll('/', '-')}--`);
}
function names(dir, suffix) {
  try { return readdirSync(dir).filter(n => n.endsWith(suffix)).map(n => join(dir, n)); }
  catch { return []; }
}
export function readTranscript(file) {
  try {
    const entries = [], warnings = [];
    for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      if (!line.trim()) continue;
      try { const row = JSON.parse(line); if (row && typeof row === 'object' && !Array.isArray(row)) entries.push(row); else warnings.push(`Invalid entry at ${file}:${index + 1}; omitted.`); }
      catch { warnings.push(`Unreadable entry at ${file}:${index + 1}; omitted.`); }
    }
    return { entries, header: entries.find(e => e.type === 'session') ?? {}, warnings };
  } catch { return null; }
}
function lineage(source, file, snapshots, visited = new Set()) {
  if (visited.has(file)) return { root: source.header.id ?? file, missing: true };
  visited.add(file);
  if (!source.header.parentSession) return { root: source.header.id ?? file, missing: false };
  const parent = resolve(dirname(file), source.header.parentSession);
  const parentSource = readTranscript(parent);
  if (parentSource) return lineage(parentSource, parent, snapshots, visited);
  const snapshot = snapshots.find(r => r.piSessionFile && resolve(r.piSessionFile) === parent);
  if (snapshot?.accounting?.lineageRoot) return { root: snapshot.accounting.lineageRoot, missing: false };
  return { root: parent, missing: true };
}

export function collectProject(cwd, { records, sessionRoot, sessionFiles, latest = false, live = [] } = {}) {
  cwd = resolve(cwd);
  records ??= listSessions(join(cwd, '.pi'), { allSnapshots: true });
  const allRecords = records;
  const byPath = new Map();
  for (const record of records) if (record.piSessionFile && !byPath.has(resolve(record.piSessionFile))) byPath.set(resolve(record.piSessionFile), record);
  let files = sessionFiles ? sessionFiles.map(f => resolve(f))
    : [...new Set([...names(sessionDirectory(cwd, sessionRoot), '.jsonl'), ...byPath.keys()])];
  if (latest && files.length) files = [files.reduce((a, b) => {
    const mtime = p => { try { return statSync(p).mtimeMs; } catch { return 0; } };
    return mtime(b) > mtime(a) ? b : a;
  })];
  const liveByFile = new Map(live.map(item => [resolve(item.sessionFile || join(cwd, `.live-${item.header.id}`)), item]));
  if (!sessionFiles && !latest) files = [...new Set([...files, ...liveByFile.keys()])];
  const ledgers = [], warnings = [], loadedSessions = new Set();
  for (const file of files) {
    const override = liveByFile.get(file);
    const source = override ?? readTranscript(file);
    const record = byPath.get(file);
    if (!source) {
      if (record?.accounting?.version === 1 && Array.isArray(record.accounting.samples)) {
        ledgers.push({ ...record.accounting, references: [], phases: [], warnings: [...(record.accounting.warnings ?? []), 'Raw transcript unavailable; using the last recorded accounting snapshot.'] });
        loadedSessions.add(record.piSessionId ?? record.sessionId);
      } else if (record) warnings.push('A legacy session transcript is unavailable; its unverified aggregate is omitted.');
      continue;
    }
    warnings.push(...(source.warnings ?? []));
    const ancestry = lineage(source, file, allRecords);
    let branch = source.branch;
    const raw = source.entries.filter(e => e.type !== 'session');
    const snapshot = record?.accounting;
    if (!branch && snapshot?.version === 1 && snapshot.sourceCount === raw.length && snapshot.sourceTip === (raw.at(-1)?.id ?? null)) {
      branch = activeBranch(source.entries, snapshot.leafId);
    }
    const ledger = sessionLedger({ entries: source.entries, branch, header: source.header, sessionFile: file,
      lineageRoot: ancestry.root, hintSpec: override?.hintSpec ?? record?.activeSpec?.number ?? null });
    if (ancestry.missing) {
      const inherited = new Set((branch ?? activeBranch(source.entries)).filter(e => {
        return timestamp(e) < timestamp(source.header);
      }).map(e => e.id));
      // Missing ancestry cannot prove inherited observation identity. Drop it
      // rather than count a possibly duplicated parent's bill again.
      const knownKeys = new Set(sessionLedger({ entries: source.entries,
        branch: (branch ?? activeBranch(source.entries)).filter(e => !inherited.has(e.id)),
        header: source.header, sessionFile: file, lineageRoot: ancestry.root, hintSpec: override?.hintSpec ?? record?.activeSpec?.number ?? null }).samples.map(s => s.key));
      ledger.samples = ledger.samples.filter(s => knownKeys.has(s.key));
      ledger.references = []; // inherited launches cannot establish new ownership
      ledger.warnings.push('Fork ancestry unavailable; inherited usage and unproven subagent ownership are omitted.');
    }
    ledger.lineageRoot = ancestry.root;
    ledger.sourceCount = raw.length;
    ledger.sourceTip = raw.at(-1)?.id ?? null;
    ledgers.push(ledger);
    loadedSessions.add(ledger.sessionId);
  }
  // Ephemeral native sessions have no transcript path yet; recorded snapshots
  // remain useful without being silently replaced by legacy aggregate totals.
  if (!sessionFiles && !latest) for (const record of records) {
    if (loadedSessions.has(record.piSessionId ?? record.sessionId)) continue;
    if (!record.piSessionFile && record.accounting?.version === 1 && Array.isArray(record.accounting.samples)) {
      ledgers.push({ ...record.accounting, references: [], phases: [], warnings: record.accounting.warnings ?? [] });
    } else if (!record.piSessionFile) warnings.push('A legacy session has no transcript or verifiable observations; omitted.');
  }
  const artifactPaths = new Set();
  for (const file of files) for (const path of names(join(dirname(file), 'subagent-artifacts'), '_meta.json')) artifactPaths.add(resolve(path));
  for (const ledger of ledgers) for (const reference of ledger.references) if (reference.path) artifactPaths.add(reference.path);
  const artifacts = [];
  for (const path of artifactPaths) {
    try {
      const meta = JSON.parse(readFileSync(path, 'utf8'));
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) artifacts.push({ path, meta });
      else warnings.push('Malformed subagent metadata omitted.');
    } catch { warnings.push('Unreadable subagent metadata omitted.'); }
  }
  const unattributed = attachSubagents(ledgers, artifacts);
  if (!sessionFiles && !latest && unattributed.length) warnings.push(`${unattributed.length} subagent artifacts lack unambiguous ownership; omitted.`);
  warnings.push(...ledgers.flatMap(l => l.warnings));
  const samples = deduplicate(ledgers.flatMap(l => l.samples));

  const summaries = ledgers.map(ledger => ({ sessionId: ledger.sessionId, sessionFile: ledger.sessionFile,
    ...summarize(ledger.samples), warnings: ledger.warnings }));
  return { version: 1, ledgers, sessions: summaries, ...summarize(samples), warnings: [...new Set(warnings)] };
}

export function specReport(project, specs) {
  specs = [...new Set(specs)].sort((a, b) => a - b);
  const selected = project.samples.filter(s => specs.includes(s.spec));
  const groups = new Map();
  for (const sample of selected) {
    const key = `${sample.spec}:${sample.workflow}`;
    const row = groups.get(key) ?? { spec: sample.spec, workflow: sample.workflow, samples: [] };
    row.samples.push(sample); groups.set(key, row);
  }
  const rows = [...groups.values()].map(row => {
    const totals = summarize(row.samples);
    return { spec: row.spec, workflow: row.workflow, main_cost: totals.mainCost, subagent_cost: totals.subagentCost,
      known_cost: totals.totalCost, missing_cost_records: totals.coverage.unpriced };
  }).sort((a, b) => a.spec - b.spec || a.workflow.localeCompare(b.workflow));
  const totals = summarize(selected);
  const warnings = [...project.warnings];
  if (project.samples.some(s => s.spec === null)) warnings.push("Some usage is not linked to a spec; excluded from spec-scoped totals.");
  const absent = specs.filter(n => !rows.some(r => r.spec === n));
  if (absent.length) warnings.push(`No linked local usage for ${absent.map(n => `#${n}`).join(', ')}.`);
  return { specs, rows, implementation_cost: summarize(selected.filter(s => s.workflow === 'spec-start')).totalCost,
    known_cost: totals.totalCost, missing_cost_records: totals.coverage.unpriced, warnings,
    scope: 'Known local active-branch cost at this snapshot; excludes unlinked work, unavailable prices, other machines, and later turns (including the final closing response).' };
}
export function money(value) { return value === null || value === undefined ? 'unavailable' : `$${value.toFixed(4)}`; }
export function renderSpecReport(report) {
  const lines = [`Known local cost — ${report.specs.map(n => `spec #${n}`).join(', ')}`,
    `Implementation (/spec-start): ${money(report.implementation_cost)}`, '',
    '| Spec | Workflow | Main agent | Subagents | Known subtotal |', '| --- | --- | ---: | ---: | ---: |'];
  for (const row of report.rows) lines.push(`| #${row.spec} | ${row.workflow} | ${money(row.main_cost)} | ${money(row.subagent_cost)} | ${money(row.known_cost)} |`);
  lines.push('', `Known lifecycle subtotal: ${money(report.known_cost)}`, report.scope);
  if (report.missing_cost_records) lines.push(`Missing cost in ${report.missing_cost_records} linked usage records; subtotal is partial.`);
  return [...lines, ...report.warnings].join('\n');
}
