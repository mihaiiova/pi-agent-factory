#!/usr/bin/env node
/** Installed/staged credential-free compatibility check. No model or network. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSystem } from './parse.mjs';
import { validateSystem } from './validate.mjs';
import { generateProject, managedPaths } from './generate.mjs';
import { checkCapabilities } from './capabilities.mjs';
import { readText } from './maintenance-store.mjs';
import { backgroundAskingIssues } from './asking.mjs';
const root = process.argv[2];
const model = parseSystem(readFileSync(join(root, '.pi/system.yaml'), 'utf8'));
// Issues the project already has don't block an upgrade; the new version's
// launch check and change preview report them with a fix.
const asking = backgroundAskingIssues(model);
const validation = validateSystem(model, { tolerate: asking.map(i => i.message) });
if (!validation.ok) throw new Error(validation.errors.join('\n'));
const settings = JSON.parse(readText(root, '.pi/settings.json'));
const mcpJson = JSON.parse(readText(root, '.pi/mcp.json'));
const opts = { piPackages: settings.packages };
const check = checkCapabilities(model, { settings, mcpJson }, opts);
if (!check.ok) throw new Error(check.errors.join('\n'));
const existing = Object.fromEntries(managedPaths(model).map(p => [p, readText(root, p)]).filter(([,v]) => v !== null));
const plan = generateProject(model, existing, opts);
if (plan.errors.length) throw new Error(plan.errors.join('\n'));
// An upgrade never rewrites operational files. Configuration the new generator
// would derive differently is reconciled afterwards, as its own preview: the
// old version can only reproduce its own output, so requiring it first would
// block every release that changes generated configuration.
const drift = plan.files.filter(f => ['.pi/settings.json', '.pi/mcp.json'].includes(f.path) && f.action !== 'none').map(f => f.path);
console.log('Factory maintenance compatibility checks passed (no model/network)');
if (drift.length) console.log(`After restarting, run /factory-update reconcile: this version generates ${drift.join(' and ')} differently.`);
if (asking.length) console.log(`After restarting, fix the subagents that can reach calls that ask the user (${asking.map(i => i.agent).join(', ')}); /factory-update review shows a ready fix.`);
