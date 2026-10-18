import { summarize } from './accounting.mjs';
import { money } from './accounting-project.mjs';

function totals(record) {
  return record?.accounting?.version === 1 ? { ...summarize(record.accounting.samples), warnings: record.accounting.warnings ?? [] } : null;
}
function label(summary) {
  return `${money(summary?.totalCost)}${summary?.coverage?.unpriced || summary?.warnings?.length ? ' (partial)' : ''}`;
}
export function formatStatus(state, current) {
  const spec = state?.activeSpec;
  return [
    `branch: ${state?.branch ?? '(none)'}`,
    `spec: ${spec?.number ? `#${spec.number}${state?.phase ? ` (${state.phase})` : ''}` : '(none)'}`,
    `phase: ${state?.phase ?? '(none)'}`,
    `pending: ${state?.pendingWork ?? '(none)'}`,
    `last session: ${state?.lastSessionId ?? '(none)'}`,
    `current session cost: ${label(current)}`,
  ].join('\n');
}
export function formatHistory(records, { limit = 10 } = {}) {
  const list = (records ?? []).slice(0, limit);
  if (!list.length) return 'No recorded sessions yet.';
  return list.map(r => {
    const agents = r.subagentUsage?.agents?.map(a => `${a.agent ?? '?'}(${a.status ?? '?'})`).join(',') || '-';
    return `${(r.finalizedAt ?? r.startedAt ?? '-').slice(0, 10)}  spec=${r.activeSpec?.number ? `#${r.activeSpec.number}` : '-'}  workflow=${r.workflow ?? 'general'}  outcome=${r.outcome ?? '-'}  cost=${label(totals(r))}  subagents=${agents}${r.summary ? ` — ${r.summary}` : ''}`;
  }).join('\n');
}
export function formatCost(current, records, { limit = 10, project } = {}) {
  const recent = (records ?? []).slice(0, limit);
  const recentIds = new Set(recent.map(r => r.piSessionId ?? r.sessionId));
  const recentSamples = project ? project.ledgers.filter(l => recentIds.has(l.sessionId)).flatMap(l => l.samples)
    : recent.flatMap(r => r.accounting?.version === 1 ? r.accounting.samples : []);
  const recentTotal = summarize(recentSamples);
  const aggregate = project ?? summarize((records ?? []).flatMap(r => r.accounting?.version === 1 ? r.accounting.samples : []));
  const lines = [
    `current session: ${label(current)} (main ${money(current?.mainCost)}, subagents ${money(current?.subagentCost)})`,
    `recent (${recent.length} native sessions): ${label(recentTotal)}`,
    `project aggregate: ${label(aggregate)} (main ${money(aggregate.mainCost)}, subagents ${money(aggregate.subagentCost)})`,
    'Known local active-branch costs; shared fork observations are counted once in aggregates. Unpriced usage is not zero.',
  ];
  if ((records ?? []).some(r => !r.accounting)) lines.push('Legacy records without verifiable observations are omitted from snapshot totals.');
  lines.push(...(project?.warnings ?? []));
  return lines.join('\n');
}
