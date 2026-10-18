/** Shared, provider-reported accounting. No token pricing or time-window ownership. */
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';

export const ACCOUNTING_VERSION = 1;
export const CONTEXT_ENTRY = 'pi-config:accounting-context';
export const hash = value => createHash('sha256').update(stable(value)).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function price(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function costOf(usage) {
  return price(usage?.cost && typeof usage.cost === 'object' ? usage.cost.total : usage?.cost);
}
export function timestamp(entry) {
  const value = entry?.timestamp ?? entry?.message?.timestamp;
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.parse(value) || 0;
}
export function userText(message) {
  return typeof message?.content === 'string' ? message.content
    : Array.isArray(message?.content) ? message.content.filter(x => x?.type === 'text').map(x => x.text ?? '').join('\n') : '';
}
export function invocation(text) {
  const expanded = text.match(/<skill\s+name="([^"]+)"/);
  const match = text.trim().match(/^\/(?:skill:)?([a-z0-9][a-z0-9-]*)(?:\s|$)/);
  const name = expanded?.[1] ?? match?.[1] ?? null;
  const args = expanded ? (text.includes('</skill>') ? text.slice(text.lastIndexOf('</skill>') + 8).trim() : '')
    : match ? text.trim().slice(match[0].length).trim() : '';
  const target = args.match(/^(?:#?([1-9]\d*)(?=\s|$)|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/([1-9]\d*)(?=[\s/?#]|$))/);
  return { name, spec: target ? Number(target[1] ?? target[2]) : null };
}

/** Disk reopen uses the last appended entry as Pi does, not the largest timestamp. */
export function activeBranch(entries, leafId = undefined) {
  const rows = (entries ?? []).filter(e => e && typeof e === 'object' && e.type !== 'session');
  const indexed = rows.filter(e => typeof e.id === 'string');
  if (!indexed.length) return rows;
  if (leafId === null) return [];
  const byId = new Map(indexed.map(e => [e.id, e]));
  const chain = [], seen = new Set();
  let next = leafId ?? indexed.at(-1).id;
  while (next && byId.has(next) && !seen.has(next)) {
    seen.add(next);
    const entry = byId.get(next);
    chain.push(entry);
    next = entry.parentId;
  }
  return chain.reverse();
}
function mainUsage(entry) {
  if (entry.type === 'message' && entry.message?.role === 'assistant') return entry.message.usage ?? {};
  if (['compaction', 'branch_summary', 'usage'].includes(entry.type)) return entry.usage ?? {};
  return null;
}

/** A ledger snapshot contains stable observations, not copied prompts or outputs. */
export function sessionLedger({ entries = [], branch, header = {}, sessionFile = '', lineageRoot, hintSpec = null }) {
  const selected = branch ?? activeBranch(entries);
  const identity = header.id ?? sessionFile;
  const root = lineageRoot ?? identity;
  const commands = selected.filter(e => e.type === 'message' && e.message?.role === 'user')
    .map(e => invocation(userText(e.message))).filter(c => c.name?.startsWith('spec-'));
  const explicit = new Set(commands.map(c => c.spec).filter(Boolean));
  const hint = explicit.size === 0 || (explicit.size === 1 && explicit.has(hintSpec)) ? hintSpec : null;
  let spec = hint, workflow = 'general', phase = 'root', startedAt = timestamp(header);
  const samples = [], calls = new Map(), references = [], ignoredCalls = new Set();
  const phases = new Map();
  const context = () => ({ spec, workflow, phase, startedAt });
  function reference(details, owner, depth = 0) {
    if (!details || typeof details !== 'object' || depth > 12) return;
    if (typeof details.runId === 'string') references.push({ runId: details.runId, ...owner });
    if (typeof details.metadataPath === 'string') references.push({ path: resolve(header.cwd ?? dirname(sessionFile || '.'), details.metadataPath), ...owner });
    for (const value of Object.values(details)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(v => reference(v, owner, depth + 1));
        else reference(value, owner, depth + 1);
      }
    }
  }
  for (let index = 0; index < selected.length; index++) {
    const entry = selected[index];
    if (entry.type === 'custom' && entry.customType === CONTEXT_ENTRY) {
      if (entry.data && Object.hasOwn(entry.data, 'spec')) spec = Number.isInteger(entry.data.spec) ? entry.data.spec : null;
      if (typeof entry.data?.workflow === 'string') workflow = entry.data.workflow;
    }
    if (entry.type === 'message' && entry.message?.role === 'user') {
      const command = invocation(userText(entry.message));
      if (command.name?.startsWith('spec-')) {
        spec = command.spec ?? (command.name === 'spec-new' ? hint : spec);
        workflow = command.name;
      } else if (command.name && command.name !== 'spec-cost') {
        spec = null;
        workflow = command.name;
      }
      phase = entry.id ?? `user-${index}`;
      startedAt = timestamp(entry);
    }
    phases.set(phase, context());
    if (entry.type === 'message' && entry.message?.role === 'assistant') {
      for (const block of Array.isArray(entry.message.content) ? entry.message.content : []) {
        if (block?.type === 'toolCall' && block.name === 'subagent') {
          const action = block.arguments?.action;
          if (action && action !== 'resume') ignoredCalls.add(block.id);
          else calls.set(block.id, context());
        }
      }
    }
    if (entry.type === 'message' && entry.message?.role === 'toolResult' && entry.message.toolName === 'subagent' && !ignoredCalls.has(entry.message.toolCallId)) {
      reference(entry.message.details, calls.get(entry.message.toolCallId) ?? { spec: null, workflow: 'unattributed', phase: 'unknown' });
    }
    if (entry.type === 'custom' && entry.customType === 'pi-config:subagent-owner') reference(entry.data, context());
    const usage = mainUsage(entry);
    if (usage !== null) {
      // Inherited fork entries retain id/time/usage, but Pi may rewrite parentId.
      const key = `main:${hash([root, entry.id ?? index, timestamp(entry), entry.type, usage])}`;
      samples.push({ key, kind: 'main', sessionId: identity, ...context(), usage, cost: costOf(usage) });
    }
  }
  return { version: ACCOUNTING_VERSION, lineageRoot: root, sessionId: identity, sessionFile, samples, references,
    phases: [...phases.values()], warnings: [], leafId: selected.at(-1)?.id ?? null };
}

/** Attach each artifact only with explicit ownership. Metadata time is completion time. */
export function attachSubagents(ledgers, artifacts) {
  const unattached = [];
  for (const { path, meta } of artifacts) {
    const candidates = [];
    for (const ledger of ledgers) {
      const refs = ledger.references.filter(ref => (ref.path && ref.path === resolve(path)) || (meta.runId && ref.runId === meta.runId));
      const owners = [...new Map(refs.map(ref => [`${ref.spec}:${ref.workflow}:${ref.phase}`, ref])).values()];
      const explicitParent = meta.parentSessionId && meta.parentSessionId === ledger.sessionId;
      if (owners.length === 1) candidates.push({ ledger, owner: owners[0], exact: true });
      else if (!owners.length && explicitParent) {
        const cached = ledger.samples.find(s => s.kind === 'subagent' && s.key === `sub:${meta.runId ?? ledger.sessionId}:${basename(path)}`);
        const contexts = cached ? [cached] : [...new Map(ledger.phases.filter(p => p.phase !== 'root').map(p => [`${p.spec}:${p.workflow}`, p])).values()];
        candidates.push({ ledger, owner: contexts.length === 1 ? contexts[0] : { spec: null, workflow: 'unattributed', phase: 'unknown' }, exact: false });
      }
    }
    // Forked transcripts can reference the same launch. Count the observation once;
    // conflicting spec/workflow associations are ambiguous and must remain unassigned.
    const contexts = new Set(candidates.map(c => `${c.owner.spec}:${c.owner.workflow}`));
    if (!candidates.length || contexts.size !== 1) { unattached.push(path); continue; }
    const chosen = candidates.find(c => c.ledger.sessionId === meta.parentSessionId) ?? candidates[0];
    const { ledger, owner } = chosen;
    const run = typeof meta.runId === 'string' ? meta.runId : null;
    const artifactName = basename(path);
    const key = `sub:${run ?? ledger.sessionId}:${artifactName}`;
    ledger.samples.push({ key, kind: 'subagent', sessionId: ledger.sessionId, spec: owner.spec,
      workflow: owner.workflow, phase: owner.phase, startedAt: owner.startedAt, usage: meta.usage ?? {}, cost: costOf(meta.usage),
      observedAt: timestamp(meta),
      agent: typeof meta.agent === 'string' ? meta.agent : 'subagent',
      status: Number.isInteger(meta.exitCode) ? (meta.exitCode === 0 ? 'completed' : 'failed') : null,
      model: typeof meta.model === 'string' ? meta.model : null });
  }
  for (const ledger of ledgers) {
    const runRefs = new Set(ledger.references.map(r => r.runId).filter(Boolean));
    if (runRefs.size && !ledger.samples.some(s => s.kind === 'subagent')) {
      ledger.warnings.push('Referenced subagent usage is unavailable; omitted.');
    }
  }
  return unattached;
}

export function deduplicate(samples) {
  const groups = new Map();
  for (const sample of samples ?? []) {
    if (!sample || typeof sample.key !== 'string') continue;
    const values = groups.get(sample.key) ?? [];
    values.push(sample);
    groups.set(sample.key, values);
  }
  const result = [];
  for (const values of groups.values()) {
    const sample = { ...values.reduce((a, b) => (b.observedAt ?? 0) > (a.observedAt ?? 0) ? b : a) };
    if (values.some(v => v.spec !== sample.spec || v.workflow !== sample.workflow)) {
      sample.spec = null;
      sample.workflow = 'unattributed';
    }
    result.push(sample);
  }
  return result;
}

export function summarize(samples) {
  const unique = deduplicate(samples);
  const known = unique.filter(s => price(s.cost) !== null);
  const sum = kind => {
    const values = known.filter(s => s.kind === kind);
    return values.length ? values.reduce((n, s) => n + s.cost, 0) : null;
  };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0,
    cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null } };
  for (const sample of unique.filter(s => s.kind === 'main')) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens']) usage[key] += price(sample.usage?.[key]) ?? 0;
    for (const key of Object.keys(usage.cost)) {
      const value = key === 'total' ? price(sample.cost) : price(sample.usage?.cost?.[key]);
      if (value !== null) usage.cost[key] = (usage.cost[key] ?? 0) + value;
    }
  }
  return { mainCost: sum('main'), subagentCost: sum('subagent'),
    totalCost: known.length ? known.reduce((n, s) => n + s.cost, 0) : null,
    coverage: { priced: known.length, unpriced: unique.length - known.length }, usage, samples: unique };
}

export function agentSummary(samples) {
  const groups = new Map();
  for (const sample of deduplicate(samples).filter(s => s.kind === 'subagent')) {
    const rows = groups.get(sample.agent) ?? []; rows.push(sample); groups.set(sample.agent, rows);
  }
  if (!groups.size) return null;
  const agents = [...groups].map(([agent, rows]) => ({ agent, runs: rows.length,
    cost: summarize(rows).totalCost,
    status: rows.some(r => r.status === 'failed') ? 'failed' : rows.every(r => r.status === 'completed') ? 'completed' : null,
    model: rows.every(r => r.model === rows[0].model) ? rows[0].model : null }));
  agents.sort((a, b) => a.agent.localeCompare(b.agent));
  return { agents, totalCost: summarize(samples.filter(s => s.kind === 'subagent')).totalCost };
}
