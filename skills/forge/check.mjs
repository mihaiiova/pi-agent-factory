import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsedModel } from './changes.mjs';
import { checkProject } from './maintenance.mjs';
import { atomicWrite, json } from './maintenance-store.mjs';

const BUILTIN = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);

/** Check declarations without making a model call. */
export function checkAgent(root, options = {}) {
  const model = parsedModel(readFileSync(join(root, '.pi/system.yaml'), 'utf8'));
  const checks = checkProject(root, options);
  const capabilities = [];
  for (const agent of [model.orchestrator, ...(model.agents ?? [])]) {
    for (const name of agent.tools ?? []) {
      if (BUILTIN.has(name)) capabilities.push({ agent: agent.name, name, provider: 'built-in', status: 'verified now', fix: 'None.' });
    }
  }
  const result = { timestamp: new Date().toISOString(), ok: checks.ok, capabilities, checks };
  atomicWrite(root, '.forge/check.json', json(result));
  return result;
}
