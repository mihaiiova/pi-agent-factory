/**
 * cli-tools — command-line tools declared in system.yaml (`integrations.cli`).
 *
 * Each entry is a fixed command shape. The agent supplies only the values of
 * its `{placeholders}`; the command runs directly (no shell), so a value can't
 * add commands, pipes or redirections. `{name:file}` writes the value to a
 * temporary file and passes its path (for options like `--body-file`).
 * Agents reach an entry through `cli:<name>` in their tools, registered in Pi
 * as `cli_<name>`. Anything not declared can only run through an explicit
 * per-call permission request.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite, readText } from './maintenance-store.mjs';

export const PLACEHOLDER_RE = /^\{([a-z][a-z0-9_]*)(?::(file))?\}$/;
export const REQUESTS_FILE = '.factory/permission-requests.json';
const TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_CHARS = 50000;

/** The Pi tool name for a declared command. */
export const cliToolName = (name) => `cli_${String(name).replace(/-/g, '_')}`;
/** The declared command a `cli:<name>` tool reference points at, or null. */
export const cliRef = (tool) => (typeof tool === 'string' && tool.startsWith('cli:') ? tool.slice(4) : null);

export function cliEntries(model) {
  const list = model?.integrations?.cli;
  return Array.isArray(list) ? list : [];
}

/** Placeholders in order of first use: [{ name, file }]. */
export function placeholders(args) {
  const seen = new Map();
  for (const arg of Array.isArray(args) ? args : []) {
    const match = typeof arg === 'string' ? arg.match(PLACEHOLDER_RE) : null;
    if (match && !seen.has(match[1])) seen.set(match[1], { name: match[1], file: match[2] === 'file' });
  }
  return [...seen.values()];
}

/** Agents that may run a declared command: names whose tools list `cli:<name>`. */
export function cliAgents(model, name, enforcedTools) {
  const out = [];
  const orchestrator = model?.orchestrator;
  if (orchestrator && (!Array.isArray(orchestrator.tools) || orchestrator.tools.includes(`cli:${name}`))) out.push(orchestrator.name);
  for (const agent of Array.isArray(model?.agents) ? model.agents : []) {
    const tools = enforcedTools ? enforcedTools(agent) : agent.tools;
    if (Array.isArray(tools) && tools.includes(`cli:${name}`)) out.push(agent.name);
  }
  return out;
}

const quote = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
/** A command line for people to read and approve. */
export function formatCommand(command, argv) {
  return [command, ...argv].map(quote).join(' ');
}

/**
 * Split a command line typed by a person into words: whitespace separates,
 * single and double quotes group, backslash escapes inside double quotes and
 * bare words. Nothing is expanded or substituted.
 */
export function splitCommandLine(line) {
  const words = [];
  let word = null;
  let quoteChar = null;
  const text = String(line ?? '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoteChar) {
      if (c === quoteChar) quoteChar = null;
      else if (c === '\\' && quoteChar === '"' && i + 1 < text.length) word += text[++i];
      else word += c;
    } else if (c === "'" || c === '"') { quoteChar = c; word ??= ''; }
    else if (/\s/.test(c)) { if (word !== null) words.push(word); word = null; }
    else if (c === '\\' && i + 1 < text.length) word = (word ?? '') + text[++i];
    else word = (word ?? '') + c;
  }
  if (quoteChar) throw new Error('Unclosed quote in the command line');
  if (word !== null) words.push(word);
  return words;
}

/** What one call will run, for the person approving it: the command line,
 * with each file placeholder's content shown below it. */
export function describeCall({ command, args }, values) {
  const given = values && typeof values === 'object' ? values : {};
  const line = formatCommand(command, (Array.isArray(args) ? args : []).map((arg) => {
    const match = arg.match(PLACEHOLDER_RE);
    return match ? (match[2] === 'file' ? `<${match[1]} file>` : String(given[match[1]] ?? arg)) : arg;
  }));
  const files = placeholders(args).filter((p) => p.file && typeof given[p.name] === 'string')
    .map((p) => `\n<${p.name} file>:\n${given[p.name].length > 2000 ? `${given[p.name].slice(0, 2000)}\n[… ${given[p.name].length - 2000} more characters]` : given[p.name]}`);
  return line + files.join('');
}

/** Throws when a command shape is malformed (used for agent proposals). */
export function checkShape({ name, command, args }) {
  if (typeof name !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error('name must be kebab-case, e.g. create-issue');
  if (typeof command !== 'string' || !command.trim() || /[\s\0]/.test(command)) throw new Error('command must be one program name or path, without spaces (put arguments in args)');
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error('args must be an array of strings');
  const bad = args.find((a) => /[{}]/.test(a) && !PLACEHOLDER_RE.test(a));
  if (bad !== undefined) throw new Error(`"${bad}": a placeholder must be a whole argument ("{name}" or "{name:file}", lowercase)`);
}

/**
 * The exact argv for one call. Every placeholder needs a string value; a value
 * for a plain placeholder may not start with "-", so it can't become an option.
 * File placeholders are written under `dir`.
 */
export function buildArgv(args, values, dir) {
  const given = values && typeof values === 'object' ? values : {};
  const wanted = placeholders(args);
  const unknown = Object.keys(given).filter((k) => !wanted.some((p) => p.name === k));
  if (unknown.length) throw new Error(`Unknown values: ${unknown.join(', ')} (this command takes ${wanted.map((p) => p.name).join(', ') || 'none'})`);
  const files = {};
  for (const p of wanted) {
    const value = given[p.name];
    if (typeof value !== 'string') throw new Error(`Missing value for {${p.name}}`);
    if (value.includes('\0')) throw new Error(`{${p.name}} contains a NUL character`);
    if (!p.file && value.startsWith('-')) throw new Error(`{${p.name}} may not start with "-"`);
    if (p.file) {
      files[p.name] = join(dir, `${p.name}.txt`);
      writeFileSync(files[p.name], value, { mode: 0o600 });
    }
  }
  return (Array.isArray(args) ? args : []).map((arg) => {
    const match = arg.match(PLACEHOLDER_RE);
    return match ? (match[2] === 'file' ? files[match[1]] : given[match[1]]) : arg;
  });
}

const clip = (s) => (s.length > OUTPUT_CHARS ? `${s.slice(0, OUTPUT_CHARS)}\n[… ${s.length - OUTPUT_CHARS} more characters]` : s);

/** Run one call of a command shape in the project. Never uses a shell. */
export function runCommand(root, { command, args }, values, { spawn = spawnSync } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-cli-'));
  try {
    const argv = buildArgv(args, values, dir);
    const result = spawn(command, argv, { cwd: root, encoding: 'utf8', shell: false, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: process.env });
    const line = formatCommand(command, argv.map((a) => (a.startsWith(dir) ? `<${a.slice(dir.length + 1)}>` : a)));
    if (result.error) return { ok: false, text: `${line}\nCould not run: ${result.error.code === 'ENOENT' ? `${command} is not installed or not on PATH` : result.error.message}` };
    const parts = [`${line}\nexit ${result.status ?? result.signal}`];
    if (result.stdout) parts.push(clip(result.stdout.trimEnd()));
    if (result.stderr) parts.push(`stderr:\n${clip(result.stderr.trimEnd())}`);
    return { ok: result.status === 0, text: parts.join('\n') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Permission requests waiting for the user (from headless sessions). */
export function readRequests(root) {
  try { const list = JSON.parse(readText(root, REQUESTS_FILE) ?? '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}
export function writeRequests(root, list) {
  atomicWrite(root, REQUESTS_FILE, `${JSON.stringify(list, null, 2)}\n`);
}

/**
 * Change operations that declare a command and give it to agents. An agent
 * whose tools are omitted already has every command; an enforced policy rule
 * for an agent is its capability ceiling, so the rule is what gets extended.
 */
export function grantOps(model, entry, agentNames) {
  const ref = `cli:${entry.name}`;
  const value = { command: entry.command, args: entry.args, ...(entry.description ? { description: entry.description } : {}), ...(entry.approve === false ? { approve: false } : {}) };
  const ops = [{ op: 'add', target: 'cli', name: entry.name, value }];
  return [...ops, ...toolOps(model, agentNames, (tools) => (tools.includes(ref) ? tools : [...tools, ref]))];
}

/** Change operations that remove a declared command from the model and every agent. */
export function revokeOps(model, name) {
  const ref = `cli:${name}`;
  const holders = [model?.orchestrator?.name, ...(Array.isArray(model?.agents) ? model.agents.map((a) => a.name) : [])].filter(Boolean);
  return [{ op: 'remove', target: 'cli', name }, ...toolOps(model, holders, (tools) => tools.filter((t) => t !== ref))];
}

function toolOps(model, agentNames, edit) {
  const ops = [];
  const names = new Set(agentNames);
  const orchestrator = model?.orchestrator;
  if (orchestrator && names.has(orchestrator.name) && Array.isArray(orchestrator.tools)) {
    const tools = edit(orchestrator.tools);
    if (tools !== orchestrator.tools && JSON.stringify(tools) !== JSON.stringify(orchestrator.tools)) ops.push({ op: 'set', target: 'orchestrator', value: { ...orchestrator, tools } });
  }
  const enforced = Array.isArray(model?.policies?.enforced) ? model.policies.enforced : [];
  let policiesChanged = false;
  const rules = enforced.map((rule) => {
    if (rule && names.has(rule.agent) && Array.isArray(rule.tools)) {
      const tools = edit(rule.tools);
      if (JSON.stringify(tools) !== JSON.stringify(rule.tools)) { policiesChanged = true; return { ...rule, tools }; }
    }
    return rule;
  });
  if (policiesChanged) ops.push({ op: 'set', target: 'policies', value: { ...model.policies, enforced: rules } });
  for (const agent of Array.isArray(model?.agents) ? model.agents : []) {
    if (!names.has(agent.name) || !Array.isArray(agent.tools)) continue;
    if (enforced.some((rule) => rule?.agent === agent.name && Array.isArray(rule.tools))) continue;
    const tools = edit(agent.tools);
    if (JSON.stringify(tools) !== JSON.stringify(agent.tools)) ops.push({ op: 'update', target: 'agent', name: agent.name, value: { tools } });
  }
  return ops;
}
