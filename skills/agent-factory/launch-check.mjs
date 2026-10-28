/**
 * launch-check — will each subagent actually get what it is declared to have?
 *
 * Deterministic and model-free: compares each agent's tools and skills with
 * what this project provides (MCP tool lists cached by pi-mcp-adapter, tools
 * registered by loaded extensions, installed skill directories, background
 * launch setup). Run at session start and on inspection so a broken specialist
 * is reported before a workflow depends on it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { enforcedAgentTools } from './policy.mjs';
import { needsBackground, SUBAGENT_CONFIG } from './generate.mjs';
import { skillSourceKind } from './skill-sources.mjs';
import { cliEntries, cliRef } from './cli-tools.mjs';
import { probeClis } from './discover.mjs';

const BUILTIN = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);

function readJson(root, rel) {
  try { return JSON.parse(readFileSync(join(root, rel), 'utf8')); } catch { return null; }
}

const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

/** Tool names a server exposes after its include/exclude filters, or null when never cached. */
function serverTools(server, config, cache) {
  const cached = cache?.servers?.[server]?.tools;
  if (!Array.isArray(cached)) return null;
  const names = cached.map((t) => t?.name).filter((n) => typeof n === 'string');
  const include = Array.isArray(config?.includeTools) ? config.includeTools.map(glob) : null;
  const exclude = Array.isArray(config?.excludeTools) ? config.excludeTools.map(glob) : [];
  return names.filter((n) => (!include || include.some((r) => r.test(n))) && !exclude.some((r) => r.test(n)));
}

/**
 * @param {string} root project directory
 * @param {object} model validated system.yaml
 * @param {{ registeredTools?: string[], probe?: (cli: string) => boolean }} [opts]
 *   tool names registered in this session (from pi.getAllTools()); extension
 *   tools are checked only when given. `probe` checks a command is on PATH.
 * @returns {{ ok: boolean, problems: Array<{ agent: string, problem: string }> }}
 */
export function launchCheck(root, model, { registeredTools, probe } = {}) {
  const problems = [];
  const mcpServers = readJson(root, '.pi/mcp.json')?.mcpServers ?? {};
  const cache = readJson(root, '.factory/pi-home/mcp-cache.json');
  const registered = Array.isArray(registeredTools) ? new Set(registeredTools) : null;
  const forced = readJson(root, SUBAGENT_CONFIG)?.forceTopLevelAsync === true;
  const skills = new Map((Array.isArray(model?.skills) ? model.skills : []).map((s) => [s.name, s]));
  const commands = new Map(cliEntries(model).map((c) => [c.name, c]));
  const installed = (command) => (command.includes('/') ? existsSync(resolve(root, command)) : probeClis([command], probe ? { probe } : {})[command] === true);
  const checkCommands = (agentName, tools) => {
    for (const name of (Array.isArray(tools) ? tools : []).map(cliRef).filter(Boolean)) {
      const entry = commands.get(name);
      if (entry && !installed(entry.command)) problems.push({ agent: agentName, problem: `cli:${name}: "${entry.command}" is not installed or not on PATH` });
    }
  };
  if (model?.orchestrator) checkCommands(model.orchestrator.name, Array.isArray(model.orchestrator.tools) ? model.orchestrator.tools : cliEntries(model).map((c) => `cli:${c.name}`));
  for (const agent of Array.isArray(model?.agents) ? model.agents : []) {
    const report = (problem) => problems.push({ agent: agent.name, problem });
    const tools = enforcedAgentTools(agent.name, model.policies, agent.tools);
    checkCommands(agent.name, tools);
    for (const tool of Array.isArray(tools) ? tools : []) {
      if (BUILTIN.has(tool) || cliRef(tool)) continue;
      if (tool.startsWith('mcp:')) {
        const [server, name] = tool.slice(4).split('/');
        if (!mcpServers[server]) { report(`${tool}: MCP server "${server}" is not configured in .pi/mcp.json`); continue; }
        const available = serverTools(server, mcpServers[server], cache);
        if (available === null) report(`${tool}: "${server}" has never connected, so its tools are unknown; use it once in ./run, then restart`);
        else if (name && !available.includes(name)) report(`${tool}: "${server}" does not expose "${name}" (after includeTools/excludeTools)`);
        else if (!name && available.length === 0) report(`${tool}: "${server}" exposes no tools after includeTools/excludeTools`);
        continue;
      }
      if (registered && !registered.has(tool)) report(`${tool}: no loaded extension registers this tool`);
    }
    if (needsBackground(tools)) {
      const file = existsSync(join(root, `.pi/agents/${agent.name}.md`)) ? readFileSync(join(root, `.pi/agents/${agent.name}.md`), 'utf8') : '';
      if (!/\nasync: true\n/.test(file) || !forced) report('uses MCP or extension tools but is not set to run in the background, so they would be missing; run /factory-update reconcile');
    }
    for (const name of Array.isArray(agent.skills) ? agent.skills : []) {
      const kind = skillSourceKind(skills.get(name)?.source);
      const dir = kind === 'registry' ? `.agents/skills/${name}` : kind === 'package' ? null : `.pi/skills/${name}`;
      if (dir && !existsSync(join(root, dir, 'SKILL.md'))) report(`skill "${name}" is not installed at ${dir}/`);
    }
  }
  return { ok: problems.length === 0, problems };
}
