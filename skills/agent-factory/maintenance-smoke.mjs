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
// An upgrade never rewrites operational files: agents keep the previous build
// until /factory-update rebuild regenerates the project with this version.
const changed = plan.files.filter(f => ['write', 'create'].includes(f.action)).map(f => f.path);
console.log('Factory maintenance compatibility checks passed (no model/network)');
if (changed.length) console.log(`After restarting, run /factory-update rebuild: agents keep the previous build until then (this version changes ${changed.join(', ')}).`);
if (asking.length) console.log(`After restarting, fix the subagents that can reach calls that ask the user (${asking.map(i => i.agent).join(', ')}); /factory-update review shows a ready fix.`);
