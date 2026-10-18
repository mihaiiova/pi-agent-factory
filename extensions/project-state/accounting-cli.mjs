import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve, basename } from 'node:path';
import { collectProject, money, renderSpecReport, specReport } from './accounting-project.mjs';
import { summarize } from './accounting.mjs';

export function phaseRows(project) {
  const grouped = new Map();
  for (const sample of project.samples) {
    const key = `${sample.sessionId}:${sample.phase}:${sample.workflow}`;
    const row = grouped.get(key) ?? { skill: sample.workflow, sessionId: sample.sessionId,
      session: basename(project.ledgers.find(l => l.sessionId === sample.sessionId)?.sessionFile ?? sample.sessionId), samples: [] };
    row.samples.push(sample); grouped.set(key, row);
  }
  return [...grouped.values()].map(row => {
    const result = summarize(row.samples);
    const subagents = {};
    for (const sample of row.samples.filter(s => s.kind === 'subagent')) {
      const group = subagents[sample.agent] ?? { runs: 0, cost: null };
      group.runs++;
      if (sample.cost !== null) group.cost = (group.cost ?? 0) + sample.cost;
      subagents[sample.agent] = group;
    }
    const { cost, ...tokens } = result.usage;
    return { skill: row.skill, session: row.session, session_id: row.sessionId,
      start_ms: row.samples[0]?.startedAt ?? 0,
      main_cost: result.mainCost, main_tokens: { ...tokens, ...Object.fromEntries(Object.entries(cost).map(([key, value]) => [`cost_${key}`, value])) }, subagents,
      total_cost: result.totalCost, missing_cost_records: result.coverage.unpriced };
  });
}
export function renderWorkflowReport(project, verbose = false) {
  const groups = new Map();
  for (const sample of project.samples) {
    const rows = groups.get(sample.workflow) ?? []; rows.push(sample); groups.set(sample.workflow, rows);
  }
  const lines = ['| Workflow | Main agent | Subagents | Known subtotal |', '| --- | ---: | ---: | ---: |'];
  for (const [name, samples] of [...groups].sort()) {
    const result = summarize(samples);
    lines.push(`| ${name} | ${money(result.mainCost)} | ${money(result.subagentCost)} | ${money(result.totalCost)}${result.coverage.unpriced ? ' (partial)' : ''} |`);
  }
  lines.push('', `Known local active-branch total: ${money(project.totalCost)}`,
    `Main agent: ${money(project.mainCost)}; subagents: ${money(project.subagentCost)}`,
    `Sessions scanned: ${project.sessions.length}; priced observations: ${project.coverage.priced}; unpriced: ${project.coverage.unpriced}.`,
    'Shared fork observations are counted once. Unavailable prices are not zero. Later turns and other machines are excluded.');
  if (verbose) {
    lines.push('', '| Session | Workflow | Known subtotal |', '| --- | --- | ---: |');
    for (const row of phaseRows(project)) lines.push(`| ${row.session} | ${row.skill} | ${money(row.total_cost)} |`);
  }
  return [...lines, ...project.warnings].join('\n');
}
export function run(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs({ args, options: { cwd: { type: 'string', default: process.cwd() },
      session: { type: 'string' }, all: { type: 'boolean' }, latest: { type: 'boolean' },
      verbose: { type: 'boolean' }, json: { type: 'boolean' },
      spec: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } } }).values;
    if (options.help) {
      console.log('Usage: cost.mjs [--cwd DIR] [--session FILE | --latest | --all] [--spec NUMBER ...] [--json] [--verbose]');
      return 0;
    }
    if (options.spec?.some(s => !/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s)))) throw new Error('--spec requires a positive issue number');
    if (options.spec?.length && (options.latest || options.session)) throw new Error('--spec cannot be combined with --latest or --session');
  } catch (error) { console.error(error.message); return 2; }
  try {
    const project = collectProject(options.cwd, { sessionFiles: options.session ? [resolve(options.session)] : undefined, latest: options.latest });
    if (options.spec?.length) {
      const report = specReport(project, options.spec.map(Number));
      console.log(options.json ? JSON.stringify(report, null, 2) : renderSpecReport(report));
    } else console.log(options.json ? JSON.stringify(phaseRows(project), null, 2) : renderWorkflowReport(project, options.verbose));
    return 0;
  } catch (error) { console.error(`Cost unavailable: ${error.message}`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = run();
